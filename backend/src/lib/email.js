import nodemailer from "nodemailer";
import { prisma } from "./prisma.js";

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

/**
 * Queue an email notification. We ALWAYS write a NotificationLog row first
 * (status PENDING) and only then attempt an immediate send. If the send
 * fails, the row is left PENDING/FAILED with a nextAttemptAt, and the
 * background retry job (jobs/notificationRetry.js) will pick it up —
 * this way a transient SMTP outage never silently drops a notification.
 */
export async function queueEmail({ appointmentId, type, recipient, subject, html }) {
  const log = await prisma.notificationLog.create({
    data: {
      appointmentId,
      type,
      channel: "email",
      recipient,
      subject,
      bodyHtml: html,
      status: "PENDING",
    },
  });

  await attemptSend(log.id, { recipient, subject, html });
  return log;
}

export async function attemptSend(notificationLogId, { recipient, subject, html }) {
  const t = getTransporter();
  try {
    if (!t) throw new Error("SMTP not configured (missing SMTP_HOST)");
    await t.sendMail({
      from: process.env.EMAIL_FROM || "no-reply@clinic.local",
      to: recipient,
      subject,
      html,
    });
    await prisma.notificationLog.update({
      where: { id: notificationLogId },
      data: { status: "SENT", sentAt: new Date() },
    });
    return true;
  } catch (err) {
    const log = await prisma.notificationLog.findUnique({ where: { id: notificationLogId } });
    const retryCount = (log?.retryCount || 0) + 1;
    const exhausted = retryCount >= (log?.maxRetries ?? 5);
    // Exponential backoff: 1, 2, 4, 8, 16 minutes
    const backoffMin = Math.pow(2, retryCount - 1);
    await prisma.notificationLog.update({
      where: { id: notificationLogId },
      data: {
        status: exhausted ? "ABANDONED" : "FAILED",
        retryCount,
        lastError: err.message?.slice(0, 500) || "Unknown email error",
        nextAttemptAt: new Date(Date.now() + backoffMin * 60 * 1000),
      },
    });
    return false;
  }
}

// ---- Templates ----

export function bookingConfirmationEmail({ name, doctorName, specialisation, slotStart }) {
  return {
    subject: "Appointment Confirmed",
    html: `<p>Hi ${name},</p>
      <p>Your appointment with <strong>Dr. ${doctorName}</strong> (${specialisation}) is confirmed for
      <strong>${new Date(slotStart).toLocaleString()}</strong>.</p>
      <p>A calendar invite has been sent to your Google Calendar (if connected).</p>`,
  };
}

export function reminderEmail({ name, doctorName, slotStart }) {
  return {
    subject: "Appointment Reminder",
    html: `<p>Hi ${name},</p><p>Reminder: your appointment with Dr. ${doctorName} is coming up on
      <strong>${new Date(slotStart).toLocaleString()}</strong>.</p>`,
  };
}

export function cancellationEmail({ name, doctorName, slotStart, reason }) {
  return {
    subject: "Appointment Cancelled",
    html: `<p>Hi ${name},</p><p>Your appointment with Dr. ${doctorName} on
      <strong>${new Date(slotStart).toLocaleString()}</strong> has been cancelled.
      ${reason ? `<br/>Reason: ${reason}` : ""}</p>
      <p>Please rebook at your convenience.</p>`,
  };
}

export function medicationReminderEmail({ name, medication, dosage }) {
  return {
    subject: `Medication Reminder: ${medication}`,
    html: `<p>Hi ${name},</p><p>This is a reminder to take your medication:
      <strong>${medication}${dosage ? ` (${dosage})` : ""}</strong>.</p>`,
  };
}
