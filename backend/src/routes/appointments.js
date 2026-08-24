import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { generatePrevisitSummary, generatePostvisitSummary } from "../lib/llm.js";
import {
  queueEmail,
  bookingConfirmationEmail,
  cancellationEmail,
} from "../lib/email.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
} from "../lib/googleCalendar.js";

const router = Router();
const HOLD_MINUTES = Number(process.env.SLOT_HOLD_MINUTES || 5);

/**
 * POST /api/appointments/hold
 * Step 1 of booking: reserve a slot for HOLD_MINUTES while the patient
 * fills the symptom form. This is the slot-hold mechanism.
 *
 * Concurrency safety: we rely on the DB-level UNIQUE(doctorId, slotStart)
 * constraint. If two patients race for the same slot, only one insert
 * succeeds; the second gets a unique-constraint violation (Prisma error
 * P2002), which we translate into a clean 409 Conflict. This works
 * correctly under SQLite (single-writer) and Postgres (constraint is
 * enforced atomically regardless of isolation level) alike — see
 * SYSTEM_DESIGN.md for the full argument.
 */
router.post("/hold", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const schema = z.object({ doctorId: z.string(), slotStart: z.string(), slotEnd: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { doctorId, slotStart, slotEnd } = parsed.data;

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  const dateStr = slotStart.slice(0, 10);
  const leave = await prisma.doctorLeave.findUnique({ where: { doctorId_date: { doctorId, date: dateStr } } });
  if (leave) return res.status(409).json({ error: "Doctor is on leave that day" });

  try {
    const held = await prisma.appointment.create({
      data: {
        patientId: req.user.id,
        doctorId,
        slotStart: new Date(slotStart),
        slotEnd: new Date(slotEnd),
        status: "HELD",
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60000),
      },
    });
    res.status(201).json({ appointmentId: held.id, holdExpiresAt: held.holdExpiresAt });
  } catch (err) {
    if (err.code === "P2002") {
      // Someone else holds or booked this exact slot already.
      return res.status(409).json({ error: "This slot was just taken. Please pick another." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not hold slot" });
  }
});

/**
 * POST /api/appointments/:id/confirm
 * Step 2: patient submits symptoms and confirms the held slot.
 * Triggers the pre-visit LLM summary, sends confirmation emails, and
 * creates Google Calendar events for both patient and doctor.
 */
router.post("/:id/confirm", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const schema = z.object({ symptomsText: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const appt = await prisma.appointment.findUnique({
    where: { id: req.params.id },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });
  if (appt.patientId !== req.user.id) return res.status(403).json({ error: "Not your appointment" });
  if (appt.status !== "HELD") return res.status(409).json({ error: `Appointment is ${appt.status.toLowerCase()}, cannot confirm` });
  if (appt.holdExpiresAt && appt.holdExpiresAt < new Date()) {
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });
    return res.status(410).json({ error: "Hold expired, please pick a new slot" });
  }

  // LLM pre-visit summary — failure is handled gracefully inside generatePrevisitSummary,
  // so this never throws and never blocks confirmation.
  const llmResult = await generatePrevisitSummary(parsed.data.symptomsText);

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: "BOOKED",
      holdExpiresAt: null,
      symptomsText: parsed.data.symptomsText,
      previsitSummary: JSON.stringify(llmResult.data),
      previsitLlmError: llmResult.ok ? null : llmResult.error,
    },
  });

  // Best-effort Google Calendar sync for both parties (never blocks the response).
  const patientEventId = await createCalendarEvent(appt.patientId, {
    summary: `Appointment with Dr. ${appt.doctor.user.name}`,
    description: `Specialisation: ${appt.doctor.specialisation}`,
    start: appt.slotStart.toISOString(),
    end: appt.slotEnd.toISOString(),
  });
  const doctorEventId = await createCalendarEvent(appt.doctor.userId, {
    summary: `Appointment with ${appt.patient.name}`,
    description: `Chief complaint: ${JSON.parse(updated.previsitSummary).chiefComplaint || "N/A"}`,
    start: appt.slotStart.toISOString(),
    end: appt.slotEnd.toISOString(),
  });
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { patientCalendarEventId: patientEventId, doctorCalendarEventId: doctorEventId },
  });

  // Email both sides (queued + retried on failure — see lib/email.js).
  const patientEmailContent = bookingConfirmationEmail({
    name: appt.patient.name,
    doctorName: appt.doctor.user.name,
    specialisation: appt.doctor.specialisation,
    slotStart: appt.slotStart,
  });
  await queueEmail({
    appointmentId: appt.id,
    type: "BOOKING_CONFIRMATION",
    recipient: appt.patient.email,
    ...patientEmailContent,
  });
  await queueEmail({
    appointmentId: appt.id,
    type: "BOOKING_CONFIRMATION",
    recipient: appt.doctor.user.email,
    subject: "New Appointment Booked",
    html: `<p>New appointment booked with ${appt.patient.name} on ${appt.slotStart.toLocaleString()}.</p>`,
  });

  res.json({
    appointment: { ...updated, previsitSummary: JSON.parse(updated.previsitSummary) },
    llmWarning: llmResult.ok ? null : "AI summary generation failed; a fallback summary was used.",
  });
});

/**
 * POST /api/appointments/:id/cancel
 * Patient, the assigned doctor, or admin can cancel. Cleans up calendar
 * events and notifies both parties.
 */
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const { reason } = req.body || {};
  const appt = await prisma.appointment.findUnique({
    where: { id: req.params.id },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });

  const isOwnerPatient = req.user.role === "PATIENT" && appt.patientId === req.user.id;
  const isOwnerDoctor = req.user.role === "DOCTOR" && appt.doctor.userId === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  if (!isOwnerPatient && !isOwnerDoctor && !isAdmin) return res.status(403).json({ error: "Not authorized" });

  if (["CANCELLED", "COMPLETED"].includes(appt.status)) {
    return res.status(409).json({ error: `Appointment already ${appt.status.toLowerCase()}` });
  }

  await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });

  await deleteCalendarEvent(appt.patientId, appt.patientCalendarEventId);
  await deleteCalendarEvent(appt.doctor.userId, appt.doctorCalendarEventId);

  const emailContent = cancellationEmail({
    name: appt.patient.name,
    doctorName: appt.doctor.user.name,
    slotStart: appt.slotStart,
    reason,
  });
  await queueEmail({ appointmentId: appt.id, type: "CANCELLATION", recipient: appt.patient.email, ...emailContent });
  await queueEmail({
    appointmentId: appt.id,
    type: "CANCELLATION",
    recipient: appt.doctor.user.email,
    subject: "Appointment Cancelled",
    html: `<p>Appointment with ${appt.patient.name} on ${appt.slotStart.toLocaleString()} was cancelled.${reason ? ` Reason: ${reason}` : ""}</p>`,
  });

  res.json({ ok: true });
});

// GET /api/appointments — role-scoped listing
router.get("/", requireAuth, async (req, res) => {
  let where = {};
  if (req.user.role === "PATIENT") {
    where = { patientId: req.user.id };
  } else if (req.user.role === "DOCTOR") {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.json([]);
    where = { doctorId: profile.id };
  } // ADMIN sees all

  const appts = await prisma.appointment.findMany({
    where,
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      patient: { select: { name: true, email: true } },
    },
    orderBy: { slotStart: "desc" },
  });

  res.json(
    appts.map((a) => ({
      ...a,
      previsitSummary: safeParse(a.previsitSummary),
      postvisitSummary: safeParse(a.postvisitSummary),
      prescriptionJson: safeParse(a.prescriptionJson),
    }))
  );
});

/**
 * POST /api/appointments/:id/postvisit
 * Doctor submits clinical notes + prescription after the visit.
 * Triggers the patient-friendly post-visit LLM summary and schedules
 * medication reminders derived from the prescription.
 */
router.post("/:id/postvisit", requireAuth, requireRole("DOCTOR"), async (req, res) => {
  const schema = z.object({
    notes: z.string().min(1),
    prescription: z
      .array(
        z.object({
          medication: z.string(),
          dosage: z.string().optional(),
          frequencyPerDay: z.number().int().min(1).max(6),
          durationDays: z.number().int().min(1).max(90),
        })
      )
      .default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const appt = await prisma.appointment.findUnique({
    where: { id: req.params.id },
    include: { doctor: true, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });
  if (appt.doctor.userId !== req.user.id) return res.status(403).json({ error: "Not your appointment" });
  if (appt.status !== "BOOKED") return res.status(409).json({ error: `Appointment is ${appt.status.toLowerCase()}` });

  const llmResult = await generatePostvisitSummary(parsed.data.notes, parsed.data.prescription);

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: "COMPLETED",
      postvisitNotes: parsed.data.notes,
      prescriptionJson: JSON.stringify(parsed.data.prescription),
      postvisitSummary: JSON.stringify(llmResult.data),
      postvisitLlmError: llmResult.ok ? null : llmResult.error,
    },
  });

  // Schedule medication reminders, evenly spaced across waking hours (08:00-20:00).
  const today = new Date().toISOString().slice(0, 10);
  for (const p of parsed.data.prescription) {
    const times = evenlySpacedTimes(p.frequencyPerDay);
    await prisma.medicationReminder.create({
      data: {
        appointmentId: appt.id,
        medication: p.medication,
        dosage: p.dosage,
        timesPerDay: p.frequencyPerDay,
        durationDays: p.durationDays,
        startDate: today,
        sendTimes: JSON.stringify(times),
      },
    });
  }

  await queueEmail({
    appointmentId: appt.id,
    type: "BOOKING_CONFIRMATION",
    recipient: appt.patient.email,
    subject: "Your Visit Summary is Ready",
    html: `<p>Hi ${appt.patient.name},</p><p>Your visit summary is ready. ${JSON.parse(updated.postvisitSummary).summary}</p>`,
  });

  res.json({
    appointment: { ...updated, postvisitSummary: JSON.parse(updated.postvisitSummary) },
    llmWarning: llmResult.ok ? null : "AI summary generation failed; a fallback summary was used.",
  });
});

function evenlySpacedTimes(n) {
  const startMin = 8 * 60; // 08:00
  const endMin = 20 * 60; // 20:00
  const step = n > 1 ? (endMin - startMin) / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => {
    const m = Math.round(startMin + step * i);
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    return `${h}:${mm}`;
  });
}

function safeParse(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export default router;
