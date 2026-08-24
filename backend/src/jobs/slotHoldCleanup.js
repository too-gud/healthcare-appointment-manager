import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

/**
 * Runs every minute. Any HELD appointment whose holdExpiresAt has passed
 * is released (set to CANCELLED) so the slot becomes bookable again.
 * Because HELD rows occupy the UNIQUE(doctorId, slotStart) constraint,
 * an abandoned hold would otherwise permanently block that slot.
 */
export function startSlotHoldCleanup() {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await prisma.appointment.updateMany({
        where: { status: "HELD", holdExpiresAt: { lt: new Date() } },
        data: { status: "CANCELLED" },
      });
      if (result.count > 0) {
        console.log(`[slotHoldCleanup] released ${result.count} expired hold(s)`);
      }
    } catch (err) {
      console.error("[slotHoldCleanup] error:", err.message);
    }
  });
}
