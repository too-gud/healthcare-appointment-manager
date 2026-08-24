import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getAuthUrl, handleOAuthCallback } from "../lib/googleCalendar.js";

const router = Router();

// GET /api/calendar/oauth/connect — returns the Google consent URL for the
// logged-in user to open. `state` carries the userId so the callback (which
// Google calls with no auth header) knows whose account to attach tokens to.
router.get("/oauth/connect", requireAuth, (req, res) => {
  const url = getAuthUrl(req.user.id);
  res.json({ url });
});

// GET /api/calendar/oauth/callback — Google redirects here after consent.
router.get("/oauth/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).send("Missing code or state");
  try {
    await handleOAuthCallback(String(code), String(userId));
    res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=connected`);
  } catch (err) {
    console.error("Calendar OAuth callback failed:", err.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?calendar=error`);
  }
});

export default router;
