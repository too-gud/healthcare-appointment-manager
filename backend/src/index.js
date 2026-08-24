import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import doctorRoutes from "./routes/doctors.js";
import appointmentRoutes from "./routes/appointments.js";
import adminRoutes from "./routes/admin.js";
import calendarAuthRoutes from "./routes/calendarAuth.js";

import { startSlotHoldCleanup } from "./jobs/slotHoldCleanup.js";
import { startNotificationRetry } from "./jobs/notificationRetry.js";
import { startMedicationReminders } from "./jobs/medicationReminders.js";
import { startAppointmentReminders } from "./jobs/appointmentReminders.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60_000, max: 120 });
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/calendar", calendarAuthRoutes);

// Central error handler — guarantees an unexpected exception (including an
// uncaught LLM/email/calendar error that slipped past local try/catch)
// still returns clean JSON instead of crashing the process.
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Healthcare Appointment Manager API listening on :${PORT}`);
  startSlotHoldCleanup();
  startNotificationRetry();
  startMedicationReminders();
  startAppointmentReminders();
});
