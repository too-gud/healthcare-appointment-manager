import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { queueEmail, reminderEmail } from "../lib/email.js";

/**
 * Runs every 15 minutes. Sends a reminder email ~24h before each BOOKED
 * appointment's slotStart. We only ever have one NotificationLog of type
 * REMINDER per appointment (checked before sending) so restarts / overlapping
 * runs don't double-send.
 */
export function startAppointmentReminders() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const windowStart = new Date(Date.now() + 23.75 * 3600000);
      const windowEnd = new Date(Date.now() + 24.25 * 3600000);

      const due = await prisma.appointment.findMany({
        where: { status: "BOOKED", slotStart: { gte: windowStart, lte: windowEnd } },
        include: { patient: true, doctor: { include: { user: true } }, notifications: true },
      });

      for (const appt of due) {
        const alreadySent = appt.notifications.some((n) => n.type === "REMINDER");
        if (alreadySent) continue;

        const content = reminderEmail({ name: appt.patient.name, doctorName: appt.doctor.user.name, slotStart: appt.slotStart });
        await queueEmail({ appointmentId: appt.id, type: "REMINDER", recipient: appt.patient.email, ...content });
        await queueEmail({
          appointmentId: appt.id,
          type: "REMINDER",
          recipient: appt.doctor.user.email,
          subject: "Upcoming Appointment Reminder",
          html: `<p>Reminder: appointment with ${appt.patient.name} on ${appt.slotStart.toLocaleString()}.</p>`,
        });
      }
    } catch (err) {
      console.error("[appointmentReminders] error:", err.message);
    }
  });
}
