import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { queueEmail, cancellationEmail } from "../lib/email.js";
import { deleteCalendarEvent } from "../lib/googleCalendar.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

// POST /api/admin/doctors — create a doctor account + profile in one call
router.post("/doctors", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    specialisation: z.string().min(1),
    slotDurationMin: z.number().int().min(5).max(180).default(30),
    // workingHours: [{day:1,start:"09:00",end:"17:00"}, ...] day 0=Sun..6=Sat
    workingHours: z.array(z.object({ day: z.number().min(0).max(6), start: z.string(), end: z.string() })),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, name, specialisation, slotDurationMin, workingHours } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "DOCTOR",
      doctorProfile: {
        create: { specialisation, slotDurationMin, workingHours: JSON.stringify(workingHours) },
      },
    },
    include: { doctorProfile: true },
  });

  res.status(201).json({ id: user.id, doctorProfileId: user.doctorProfile.id, name: user.name, email: user.email });
});

// PUT /api/admin/doctors/:profileId — update specialisation / hours / slot duration
router.put("/doctors/:profileId", async (req, res) => {
  const schema = z.object({
    specialisation: z.string().optional(),
    slotDurationMin: z.number().int().min(5).max(180).optional(),
    workingHours: z.array(z.object({ day: z.number().min(0).max(6), start: z.string(), end: z.string() })).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.workingHours) data.workingHours = JSON.stringify(data.workingHours);

  const updated = await prisma.doctorProfile.update({ where: { id: req.params.profileId }, data });
  res.json(updated);
});

router.get("/doctors", async (_req, res) => {
  const doctors = await prisma.doctorProfile.findMany({ include: { user: true, leaves: true } });
  res.json(doctors);
});

/**
 * POST /api/admin/doctors/:profileId/leave  { date: "YYYY-MM-DD", reason }
 *
 * Leave-conflict handling: creating a leave day auto-cancels every
 * BOOKED/HELD appointment for that doctor on that date, deletes the
 * associated calendar events, and emails every affected patient with
 * the cancellation reason so they can rebook. This is done inside a
 * single handler so the leave record and the cancellations are applied
 * together — see SYSTEM_DESIGN.md for the full reasoning.
 */
router.post("/doctors/:profileId/leave", async (req, res) => {
  const schema = z.object({ date: z.string(), reason: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { date, reason } = parsed.data;
  const { profileId } = req.params;

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: profileId }, include: { user: true } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  const leave = await prisma.doctorLeave.upsert({
    where: { doctorId_date: { doctorId: profileId, date } },
    update: { reason },
    create: { doctorId: profileId, date, reason },
  });

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  const affected = await prisma.appointment.findMany({
    where: {
      doctorId: profileId,
      slotStart: { gte: dayStart, lte: dayEnd },
      status: { in: ["BOOKED", "HELD"] },
    },
    include: { patient: true },
  });

  const notified = [];
  for (const appt of affected) {
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });
    await deleteCalendarEvent(appt.patientId, appt.patientCalendarEventId);
    await deleteCalendarEvent(doctor.userId, appt.doctorCalendarEventId);

    const emailContent = cancellationEmail({
      name: appt.patient.name,
      doctorName: doctor.user.name,
      slotStart: appt.slotStart,
      reason: reason || "Doctor is unavailable (leave)",
    });
    await queueEmail({ appointmentId: appt.id, type: "CANCELLATION", recipient: appt.patient.email, ...emailContent });
    notified.push(appt.patient.email);
  }

  res.json({ leave, cancelledAppointments: affected.length, notifiedPatients: notified });
});

router.delete("/doctors/:profileId/leave/:date", async (req, res) => {
  await prisma.doctorLeave.delete({
    where: { doctorId_date: { doctorId: req.params.profileId, date: req.params.date } },
  });
  res.json({ ok: true });
});

// GET /api/admin/notifications — inspect notification delivery health
router.get("/notifications", async (req, res) => {
  const logs = await prisma.notificationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(logs);
});

export default router;
