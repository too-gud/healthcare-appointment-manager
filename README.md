# Healthcare Appointment & Follow-up Manager

A full-stack clinic platform with separate **patient**, **doctor**, and **admin** portals:
booking with double-booking prevention, an LLM-generated pre-visit symptom summary for
doctors, an LLM-generated patient-friendly post-visit summary, medication reminders, and
email + Google Calendar sync on every booking, reschedule, and cancellation.

Also see `SYSTEM_DESIGN.md` for the write-up on slot conflicts, leave handling, and
notification reliability.

## Stack

- **Backend:** Node.js, Express, Prisma ORM, SQLite (dev) / PostgreSQL (prod), JWT auth
- **Frontend:** React (Vite), React Router, Tailwind CSS, Axios
- **LLM:** Anthropic API (`@anthropic-ai/sdk`)
- **Email:** Nodemailer (SendGrid / Mailgun / SMTP)
- **Calendar:** Google Calendar API v3 via OAuth 2.0 (`googleapis`)
- **Background jobs:** `node-cron`

## Project layout

```
healthcare-appointment-manager/
├── backend/
│   ├── prisma/schema.prisma      # DB schema (see below)
│   ├── prisma/seed.js            # demo admin/doctor/patient accounts
│   └── src/
│       ├── index.js              # app entry, wires routes + cron jobs
│       ├── lib/                  # auth, prisma client, llm, email, google calendar
│       ├── routes/                auth, doctors, appointments, admin, calendarAuth
│       └── jobs/                  slotHoldCleanup, notificationRetry,
│                                   medicationReminders, appointmentReminders
├── frontend/
│   └── src/
│       ├── pages/patient/         BookAppointment, MyAppointments
│       ├── pages/doctor/          Schedule (pre-visit view + post-visit notes)
│       ├── pages/admin/           Doctors (create/leave), Notifications (delivery log)
│       └── context/AuthContext.jsx
└── .env.example
```

## Setup guide

### 1. Prerequisites
- Node.js 18+
- An Anthropic API key (for the LLM summaries)
- An SMTP-capable email provider (SendGrid, Mailgun, or a Gmail App Password for dev)
- A Google Cloud project with the Calendar API enabled (for calendar sync)

### 2. Backend

```bash
cd backend
npm install
cp ../.env.example .env      # then fill in the real values (see below)
npx prisma migrate dev --name init
npm run seed                 # creates demo admin/doctor/patient logins
npm run dev                  # http://localhost:4000
```

> Note: `npx prisma generate` downloads a query-engine binary from
> `binaries.prisma.sh` on first run — make sure that domain isn't blocked by
> any outbound firewall/proxy in your environment.

### 3. Frontend

```bash
cd frontend
npm install
echo "VITE_API_URL=http://localhost:4000/api" > .env
npm run dev                  # http://localhost:5173
```

### 4. Demo logins (after `npm run seed`)
| Role    | Email                  | Password       |
|---------|-------------------------|----------------|
| Admin   | admin@clinic.local       | Admin@12345    |
| Doctor  | dr.smith@clinic.local    | Doctor@12345   |
| Patient | patient@clinic.local     | Patient@12345  |

## .env reference

See `.env.example` at the repo root for every variable with inline comments. Copy it into
`backend/.env`. Key groups: server/DB, JWT, `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`, SMTP
credentials, Google OAuth client ID/secret/redirect URI, and job intervals
(`SLOT_HOLD_MINUTES`, `NOTIFICATION_RETRY_INTERVAL_MIN`, `MEDICATION_REMINDER_CHECK_INTERVAL_MIN`).

## Google Calendar setup steps

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → configure it (External is fine for testing;
   add your test Google accounts under "Test users" while the app is unpublished).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type
   "Web application".
   - Authorized redirect URI: `http://localhost:4000/api/calendar/oauth/callback`
     (matches `GOOGLE_REDIRECT_URI` in `.env`; update for your deployed backend URL).
5. Copy the generated **Client ID** and **Client Secret** into `.env` as
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. In the app, a logged-in user visits **Settings → Connect Google Calendar**, which hits
   `GET /api/calendar/oauth/connect` and redirects to Google's consent screen. On success,
   Google redirects to `GOOGLE_REDIRECT_URI` with a `code`, which the backend exchanges for
   access/refresh tokens and stores on the `User` row (`googleRefreshToken`, etc.).
7. From then on, every booking confirmation / cancellation / reschedule calls
   `createCalendarEvent` / `updateCalendarEvent` / `deleteCalendarEvent`
   (`backend/src/lib/googleCalendar.js`) for both the patient and the doctor, refreshing
   access tokens transparently via the stored refresh token. Calendar sync is always
   **best-effort** — a failure here never blocks or rolls back the booking itself.

## Database schema

Full schema lives in `backend/prisma/schema.prisma`. Summary of the core tables:

- **User** — patients, doctors, admins in one table (`role` enum), plus Google OAuth tokens.
- **DoctorProfile** — specialisation, slot duration, working hours (JSON per weekday),
  linked 1:1 to a `User`.
- **DoctorLeave** — `(doctorId, date)` unique — one row per leave day.
- **Appointment** — the core booking record. `status` moves
  `HELD → BOOKED → COMPLETED` (or `CANCELLED`/`NO_SHOW` at various points). Stores raw
  symptoms + the LLM pre-visit JSON, and post-visit notes/prescription + the LLM post-visit
  JSON, plus both parties' Google Calendar event IDs.
  **`@@unique([doctorId, slotStart])`** is the single most important constraint in the
  schema — see `SYSTEM_DESIGN.md`.
- **MedicationReminder** — one row per prescribed medication, with computed send times.
- **NotificationLog** — every email attempt (booking confirmation, reminder, cancellation,
  medication reminder), with `status`, `retryCount`, `nextAttemptAt`, and the original
  `bodyHtml` so retries resend the *real* content, not a placeholder.

## API docs (summary)

All routes are prefixed `/api`. Authenticated routes require `Authorization: Bearer <jwt>`.

| Method & path | Role | Purpose |
|---|---|---|
| `POST /auth/register` | public | Patient self-registration (doctor/admin accounts are admin-created) |
| `POST /auth/login` | public | Returns `{ token, user }` |
| `GET /doctors?specialisation=` | any | Search doctors |
| `GET /doctors/:id/slots?date=YYYY-MM-DD` | any | Computed open slots for a day |
| `POST /appointments/hold` | patient | Step 1: reserve a slot for `SLOT_HOLD_MINUTES` |
| `POST /appointments/:id/confirm` | patient | Step 2: submit symptoms, triggers pre-visit LLM summary, email, calendar sync |
| `POST /appointments/:id/cancel` | patient/doctor/admin | Cancels, cleans up calendar events, emails both sides |
| `GET /appointments` | any | Role-scoped list (own appointments for patient/doctor, all for admin) |
| `POST /appointments/:id/postvisit` | doctor | Submit notes + prescription, triggers post-visit LLM summary and schedules medication reminders |
| `POST /admin/doctors` | admin | Create a doctor account + profile |
| `PUT /admin/doctors/:profileId` | admin | Update specialisation/hours/slot duration |
| `POST /admin/doctors/:profileId/leave` | admin | Mark a leave day — auto-cancels & notifies affected patients |
| `GET /admin/notifications` | admin | Notification delivery log (for debugging failures) |
| `GET /calendar/oauth/connect` | any | Returns the Google consent URL |
| `GET /calendar/oauth/callback` | public (Google redirect) | Exchanges code for tokens |

## LLM prompts (used verbatim, per spec)

**Pre-visit summary** (`backend/src/lib/llm.js` → `generatePrevisitSummary`):
> "Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint,
> and three suggested questions for the doctor. Symptoms: `<symptoms>`"

The system prompt additionally constrains the model to return only JSON in a fixed shape
(`{urgency, chiefComplaint, suggestedQuestions[]}`), which the backend validates and clamps
(unknown urgency values fall back to `"Medium"`, at most 3 questions kept).

**Post-visit summary** (`generatePostvisitSummary`):
> "Convert these clinical notes into a patient-friendly summary with medication schedule and
> follow-up steps: `<notes>`"

Same pattern: JSON-only system prompt, shape `{summary, medicationSchedule[], followUpSteps[]}`.

**Failure handling:** both functions wrap the API call in a try/catch with a 15s abort
timeout. On any failure (missing API key, network error, timeout, malformed JSON), they
return `{ ok: false, error, data: <safe fallback> }` — the fallback is saved to the DB and
surfaced to the UI as a dismissible warning banner, but the booking/visit-completion flow
**always** proceeds. This satisfies the spec's "LLM failures must be handled gracefully,
system should not break."

## Deliverable notes

This response includes the complete source code (this repo), this README, `.env.example`,
the DB schema, LLM prompts, and Google Calendar setup steps above, and `SYSTEM_DESIGN.md`.

**On hosting:** I can't provision a live URL on Vercel/Render/Railway myself (no ability to
create accounts or deploy from this environment), but the app is deploy-ready:
- **Backend** → Render/Railway "Web Service" from `backend/`, add the env vars, set
  `DATABASE_URL` to a managed Postgres instance and switch `provider` in `schema.prisma`
  from `sqlite` to `postgresql`, then run `npx prisma migrate deploy` as the build step.
- **Frontend** → Vercel/Netlify from `frontend/`, set `VITE_API_URL` to the deployed
  backend's `/api` URL.
- Update `GOOGLE_REDIRECT_URI` and the OAuth client's authorized redirect URI to the
  deployed backend domain once hosted.
