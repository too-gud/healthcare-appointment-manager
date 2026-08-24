import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { queueEmail, medicationReminderEmail } from "../lib/email.js";

/**
 * Runs every MEDICATION_REMINDER_CHECK_INTERVAL_MIN minutes. For every
 * active MedicationReminder, checks whether "now" matches one of its
 * sendTimes for today and that today falls within [startDate, startDate +
 * durationDays). If so and we haven't already sent in the last ~55 minutes
 * (via lastSentAt), queue a reminder email. Reminder auto-deactivates once
 * the course finishes.
 */
export function startMedicationReminders() {
  const intervalMin = Number(process.env.MEDICATION_REMINDER_CHECK_INTERVAL_MIN || 1);
  cron.schedule(`*/${intervalMin} * * * *`, async () => {
    try {
      const reminders = await prisma.medicationReminder.findMany({
        where: { active: true },
        include: { appointment: { include: { patient: true } } },
      });

      const now = new Date();
      const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      for (const r of reminders) {
        const start = new Date(`${r.startDate}T00:00:00`);
        const courseEnd = new Date(start.getTime() + r.durationDays * 86400000);
        if (now >= courseEnd) {
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { active: false } });
          continue;
        }
        if (now < start) continue;

        const sendTimes = JSON.parse(r.sendTimes);
        const isDueNow = sendTimes.includes(nowHHMM);
        const alreadySentRecently = r.lastSentAt && now.getTime() - r.lastSentAt.getTime() < 55 * 60000;
        if (!isDueNow || alreadySentRecently) continue;

        const content = medicationReminderEmail({
          name: r.appointment.patient.name,
          medication: r.medication,
          dosage: r.dosage,
        });
        await queueEmail({
          appointmentId: r.appointmentId,
          type: "MEDICATION_REMINDER",
          recipient: r.appointment.patient.email,
          ...content,
        });
        await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: now } });
      }
    } catch (err) {
      console.error("[medicationReminders] error:", err.message);
    }
  });
}
