import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { attemptSend } from "../lib/email.js";

/**
 * Runs every N minutes (NOTIFICATION_RETRY_INTERVAL_MIN). Picks up any
 * notification log rows in FAILED status whose nextAttemptAt has passed
 * and retries them, using the same exponential-backoff bookkeeping as
 * the original send. Rows that exceed maxRetries are marked ABANDONED
 * and surfaced in the admin notifications view for manual follow-up.
 */
export function startNotificationRetry() {
  const intervalMin = Number(process.env.NOTIFICATION_RETRY_INTERVAL_MIN || 5);
  cron.schedule(`*/${intervalMin} * * * *`, async () => {
    try {
      const due = await prisma.notificationLog.findMany({
        where: { status: "FAILED", nextAttemptAt: { lt: new Date() } },
        take: 50,
      });
      for (const log of due) {
        await attemptSend(log.id, { recipient: log.recipient, subject: log.subject, html: log.bodyHtml || "" });
      }
      if (due.length > 0) console.log(`[notificationRetry] retried ${due.length} notification(s)`);
    } catch (err) {
      console.error("[notificationRetry] error:", err.message);
    }
  });
}
