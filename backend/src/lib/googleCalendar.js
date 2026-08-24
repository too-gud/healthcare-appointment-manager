import { google } from "googleapis";
import { prisma } from "./prisma.js";

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state, // carries the userId so the callback knows whose tokens these are
  });
}

export async function handleOAuthCallback(code, userId) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await prisma.user.update({
    where: { id: userId },
    data: {
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token ?? undefined, // only present on first consent
      googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });
}

async function getClientForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.googleRefreshToken) return null; // user hasn't connected Google Calendar

  const client = getOAuthClient();
  client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    // Persist refreshed access tokens so we don't re-prompt the user.
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: tokens.access_token ?? undefined,
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });
  });

  return client;
}

/**
 * Create a calendar event for a user. Returns the eventId, or null if the
 * user hasn't connected Google Calendar or the API call fails — calendar
 * sync is best-effort and must never block a booking.
 */
export async function createCalendarEvent(userId, { summary, description, start, end }) {
  try {
    const auth = await getClientForUser(userId);
    if (!auth) return null;
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        reminders: { useDefault: true },
      },
    });
    return res.data.id;
  } catch (err) {
    console.error("Google Calendar create event failed:", err.message);
    return null;
  }
}

export async function updateCalendarEvent(userId, eventId, { summary, description, start, end }) {
  try {
    if (!eventId) return false;
    const auth = await getClientForUser(userId);
    if (!auth) return false;
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        summary,
        description,
        start: start ? { dateTime: start } : undefined,
        end: end ? { dateTime: end } : undefined,
      },
    });
    return true;
  } catch (err) {
    console.error("Google Calendar update event failed:", err.message);
    return false;
  }
}

export async function deleteCalendarEvent(userId, eventId) {
  try {
    if (!eventId) return false;
    const auth = await getClientForUser(userId);
    if (!auth) return false;
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: "primary", eventId });
    return true;
  } catch (err) {
    console.error("Google Calendar delete event failed:", err.message);
    return false;
  }
}
