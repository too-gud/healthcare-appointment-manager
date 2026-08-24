# System Design Write-up

*(≈780 words)*

## 1. Slot hold mechanism

Booking is split into two steps so a patient can safely fill out the symptom form without
losing their slot to someone else, but also without permanently blocking it if they abandon
the flow.

1. `POST /appointments/hold` creates an `Appointment` row with `status = HELD` and
   `holdExpiresAt = now + SLOT_HOLD_MINUTES` (default 5).
2. The patient fills the symptom form.
3. `POST /appointments/:id/confirm` flips the row to `status = BOOKED`, clears
   `holdExpiresAt`, and only *then* triggers the LLM summary, emails, and calendar events.

If the patient never confirms, a cron job (`jobs/slotHoldCleanup.js`) runs every minute and
flips any `HELD` row whose `holdExpiresAt` has passed to `CANCELLED`, freeing the slot. The
slot-search endpoint (`GET /doctors/:id/slots`) also excludes `HELD` rows whose hold hasn't
expired yet, so the same slot isn't offered to two people simultaneously even before the
cleanup job runs.

## 2. Double-booking prevention

The core defense is a **database-level unique constraint**: `@@unique([doctorId, slotStart])`
on `Appointment`. A `HELD` or `BOOKED` row for a given doctor+time occupies that constraint
regardless of which patient created it. This means two patients racing for the same slot
can't both succeed — whichever `INSERT` reaches the database second gets a unique-constraint
violation (Prisma error code `P2002`), which the `/appointments/hold` route catches and turns
into a clean `409 Conflict` ("this slot was just taken, please pick another"), prompting the
frontend to refresh the slot list.

This approach is deliberately **database-enforced rather than application-enforced**
(e.g. "check if a row exists, then insert") because a check-then-insert pattern has a race
window between the two operations under concurrent requests. A unique constraint is atomic at
the storage layer: the database itself guarantees only one insert can win, no matter how many
requests arrive in the same millisecond. It also requires no explicit row locking
(`SELECT ... FOR UPDATE`) and works identically whether the deployment uses SQLite (single
writer, so this is almost automatic) or Postgres (constraint enforcement is independent of
transaction isolation level) — the same code path is correct on both, which matters since the
project ships with SQLite for local dev but recommends Postgres for production.

## 3. Doctor leave conflict handling

When an admin calls `POST /admin/doctors/:profileId/leave` for a date, the handler does two
things atomically within the same request: it upserts the `DoctorLeave` row, then queries all
`BOOKED`/`HELD` appointments for that doctor on that date. Each affected appointment is:

1. Marked `CANCELLED`.
2. Has its Google Calendar events deleted for both patient and doctor (best-effort).
3. Triggers a cancellation email to the patient with the leave reason, encouraging them to
   rebook.

Doing the leave-write and the cascade-cancel in one handler (rather than, say, a delayed
background reconciliation) means the admin gets an immediate, honest response — "leave
recorded, N appointments cancelled and patients notified" — rather than a leave being applied
silently while stale bookings linger. Marking leave also prevents *future* bookings on that
date at the source: both `GET /doctors/:id/slots` and `POST /appointments/hold` check
`DoctorLeave` before returning/reserving anything.

## 4. Notification failure handling

Every outbound email is first written to a `NotificationLog` row (`status = PENDING`) *before*
the send is attempted — so even a hard crash mid-send leaves an auditable, retryable record
rather than a silently lost notification. The immediate send attempt then updates that row to
`SENT`, or on failure to `FAILED` with `retryCount += 1`, `lastError`, and an exponential
backoff (`nextAttemptAt = now + 2^retryCount minutes`).

A separate cron job (`jobs/notificationRetry.js`) runs every `NOTIFICATION_RETRY_INTERVAL_MIN`
minutes, picks up any `FAILED` row whose `nextAttemptAt` has passed, and retries it — resending
the **original stored `bodyHtml`**, not a generic placeholder, so a delayed confirmation still
contains the real appointment details. After `maxRetries` (default 5, ~31 minutes of backoff),
a notification is marked `ABANDONED` rather than retried forever; these are surfaced in the
admin **Notifications** view (`GET /admin/notifications`) for manual follow-up (e.g. calling
the patient), rather than failing invisibly.

This same "always log, never let a side-effect throw" philosophy is applied everywhere a
side-effect could fail: LLM calls (`lib/llm.js`) return a typed `{ok, data, error}` result with
a safe fallback so a booking or visit-completion is never blocked or corrupted by an LLM outage,
and Google Calendar calls (`lib/googleCalendar.js`) catch and log internally, returning `null`
on failure rather than throwing — calendar sync is explicitly best-effort and never rolls back
a booking that already succeeded in the database.
