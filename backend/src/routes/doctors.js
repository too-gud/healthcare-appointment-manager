import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

// GET /api/doctors?specialisation=Cardiology
router.get("/", async (req, res) => {
  const { specialisation } = req.query;
  const doctors = await prisma.doctorProfile.findMany({
    where: specialisation ? { specialisation: { contains: String(specialisation) } } : undefined,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(
    doctors.map((d) => ({
      id: d.id,
      name: d.user.name,
      specialisation: d.specialisation,
      slotDurationMin: d.slotDurationMin,
    }))
  );
});

// GET /api/doctors/:id/slots?date=YYYY-MM-DD
// Computes bookable slots for a given date from working hours minus
// existing HELD/BOOKED appointments minus leave days.
router.get("/:id/slots", async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param (YYYY-MM-DD) is required" });

  const doctor = await prisma.doctorProfile.findUnique({ where: { id } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  const leave = await prisma.doctorLeave.findUnique({ where: { doctorId_date: { doctorId: id, date } } });
  if (leave) return res.json({ available: false, reason: "Doctor on leave", slots: [] });

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const workingHours = JSON.parse(doctor.workingHours);
  const dayConfig = workingHours.find((w) => w.day === dayOfWeek);
  if (!dayConfig) return res.json({ available: false, reason: "Doctor does not work this day", slots: [] });

  // Build candidate slots
  const [startH, startM] = dayConfig.start.split(":").map(Number);
  const [endH, endM] = dayConfig.end.split(":").map(Number);
  const dayStart = new Date(`${date}T00:00:00`);
  dayStart.setHours(startH, startM, 0, 0);
  const dayEnd = new Date(`${date}T00:00:00`);
  dayEnd.setHours(endH, endM, 0, 0);

  const candidates = [];
  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const slotEnd = new Date(cursor.getTime() + doctor.slotDurationMin * 60000);
    if (slotEnd <= dayEnd) candidates.push({ start: new Date(cursor), end: slotEnd });
    cursor = slotEnd;
  }

  // Exclude slots already HELD (and not expired) or BOOKED
  const dayRangeStart = dayStart;
  const dayRangeEnd = dayEnd;
  const taken = await prisma.appointment.findMany({
    where: {
      doctorId: id,
      slotStart: { gte: dayRangeStart, lt: dayRangeEnd },
      OR: [{ status: "BOOKED" }, { status: "HELD", holdExpiresAt: { gt: new Date() } }],
    },
    select: { slotStart: true },
  });
  const takenTimes = new Set(taken.map((t) => t.slotStart.getTime()));

  const now = new Date();
  const slots = candidates
    .filter((c) => !takenTimes.has(c.start.getTime()) && c.start > now)
    .map((c) => ({ start: c.start.toISOString(), end: c.end.toISOString() }));

  res.json({ available: true, slots });
});

export default router;
