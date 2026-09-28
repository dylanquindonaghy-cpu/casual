# API, webhooks and jobs

## Principles

- Public HTTP surface is tiny: webhooks, push subscription, Caddy's domain check, health.
  Everything else is Next.js server actions behind sessions.
- Webhooks: verify signature → insert message (idempotent) → enqueue job → return 200 within
  a second. Never do AI or Sheets work inside a webhook.
- Every job payload includes `firm_id` and an idempotency key. Jobs are safe to retry.

## HTTP endpoints

| Method + path | Who calls it | What it does |
|---|---|---|
| `POST /api/webhooks/twilio/whatsapp` | Twilio | Verify `X-Twilio-Signature`. Insert `messages` (provider_message_id = MessageSid). Enqueue `classify-message`. |
| `POST /api/webhooks/twilio/sms` | Twilio | Same as above for SMS (incl. STOP handling → mark worker opted out of SMS). |
| `POST /api/webhooks/twilio/voice` | Twilio | Return TwiML: short recorded message; optional `<Record>` with transcription callback. Enqueue `send-portal-link` for the caller. |
| `POST /api/webhooks/twilio/voice/transcription` | Twilio | Store transcript as a message → `classify-message`. |
| `POST /api/webhooks/twilio/status` | Twilio | Delivery status updates on `messages`. |
| `POST /api/push/subscribe` | Portal (session) | Save web push subscription for the worker. |
| `GET /api/caddy/ask?domain=` | Caddy | 200 only if `firms.custom_domain` matches and `domain_verified` is true. |
| `GET /api/health` | Uptime check | DB + queue ping. |
| Stage 2: `POST /api/webhooks/ses` | SNS | Inbound email notification → fetch from S3 → `classify-email`. |

Workers never call APIs directly; the portal uses server actions. Built so far (Phase 1): request
a login link (`src/app/login/actions.ts`), use it (`src/app/l/actions.ts`), log out and refresh the
session token (`src/app/session-actions.ts`), ask for and check a pay-page code
(`src/app/pay/actions.ts`); office login, link login, logout and refresh (`src/app/office/**`). Actions return a result and the browser navigates
itself: they never call `redirect()`, because Next renders an action's redirect target by fetching
it from the server's own origin, which loses the firm's Host header. Planned:

`takeShift(shiftId)` · `cancelShift(assignmentId, reason)` ·
`createRequest(type, payload)` · `setAvailability(dates)` · `raisePayQuery(form)` · `updateNotificationPrefs(...)`

Office server actions: `createShift`, `updateShift` (logs firm-initiated moves/curtailments),
`cancelShiftByFirm(shiftId, reason)`, `makeUrgent(shiftId)`, `offerTo(shiftId, workerIds)`,
`assignManually(shiftId, workerId, override?)`, `markNoShow`, `resolveRequest`, `importCsv(kind, file)`,
`upsertCredential`, `verifyCredential`, `resolvePayQueryGroup`, `updateSettings`, `verifyDomain`,
`exportWorkerData(workerId)`, `deleteWorker(workerId)`.

## Job catalogue (pg-boss)

| Job | Trigger | Payload | What it does | Retry |
|---|---|---|---|---|
| `classify-message` | webhook | `{firm_id, message_id}` | Keyword match first (shifts, cancel, pay, help, stop). Else Haiku → zod-validated `{intent, shift_ref?, confidence}`. Low confidence → `requests` for the office. Reply with the right link. | 3× backoff |
| `send-portal-link` | voice webhook, login | `{firmId, idempotencyKey, purpose, subjectId}` (ids only; `subjectId` null for an unknown number or address; `purpose` worker_login or office_login) | Login (Phase 1): creates the one-time link (the token exists only inside the job), sends the `login_link` WhatsApp template to a worker or the `office_login_link` email to an office user, logs `auth.link_sent`. Queued for every request, known number or not; a retry after sending does nothing. SMS fallback if not delivered in 60 s (Phase 4/7). | 3× |
| `send-login-code` | pay-page step-up | `{firmId, idempotencyKey, sessionId}` | Creates the 6-digit code (only inside the job), retires the session's earlier code, stores an HMAC (SESSION_SECRET, bound to the session), sends `login_code`, logs `auth.otp_sent`. | 3× |
| `notify` | many | `{firm_id, worker_id, template, vars, priority}` | Applies the notification policy: push → WhatsApp → SMS; respects quiet hours unless urgent. Writes `events`. | 3× |
| `offer-wave` | cancel/urgent | `{firm_id, shift_id, wave}` | If shift still open: rank eligible workers, send wave to next N, record `offers`, schedule next wave in `wave_minutes`. Stop when filled. | 3× |
| `escalate-shift` | scheduled at start − X h | `{firm_id, shift_id}` | If still unfilled: notify resourcer (push + email); mark shift "needs attention". | 3× |
| `offer-expire` | scheduled +wave_minutes | `{firm_id, offer_id}` | Mark expired offers; tell workers if filled elsewhere. | 3× |
| `shift-reminder` | cron hourly | — | 24 h and 2 h before start: reminder to assigned workers (cuts no-shows). | — |
| `sheets-sync-tick` | cron every minute (`* * * * *`), no firm | — | Lists firms (`app_firm_ids()`); for each with an enabled sheet that is due (every minute on an event day: a shift on now, in the last 6 h or the next 24 h; else every 15 min; while syncs are failing, every 5 min on an event day, else 30), queues one `sheets-sync`. Scheduled only when the worker has a Sheets client (`SHEETS_TRANSPORT=google`). | — |
| `sheets-sync` | the tick | `{firmId, idempotencyKey}` (`sheets-sync:<minute>`; firm-scoped singleton key, 50 s) | A firm task (`runFirmTask`: several transactions, network between them). Expires after 4 minutes, inside the sync's 5-minute lease. `syncSheet()`: lease, one batch read, mirror + three-way merge in one transaction, at most one id-column read and one batch write, then record the merge base, `last_synced_at` and a `roster.synced` event. Failures store a code in `roster_sources.last_error_code` and log `roster.sync_failed` (once per new code, not every retry). Office alerts on errors: Phase 5. | pg-boss default |
| `credential-scan` | cron daily 06:00 | `{firm_id}` | Expiring in 30/14/7 days → warn worker + office. Expired → status `expired`, block. | — |
| `pay-digest` | cron per firm setting | `{firm_id}` | Group open pay queries by `group_key`; Haiku one-liner per group; email payroll; mark `in_digest`. | 3× |
| `metrics-rollup` | cron daily 00:30 | `{firm_id}` | Fill `metrics_daily` from events and messages. | — |
| `purge-retention` | cron nightly 03:00 | `{firm_id}` | Delete per retention settings; write an event per run. | — |
| `domain-verify` | office action | `{firm_id}` | Check CNAME resolves to us; set `domain_verified`; notify. | 5× |

**Idempotency keys:** `offer-wave` uses `${shift_id}:${wave}`; `notify` uses
`${worker_id}:${template}:${entity_id}:${date}`; `sheets-sync` uses a firm-scoped singleton key
(one per firm per 50 s) plus the sync's own lease on `roster_sources`, so two syncs of one firm
never overlap.

## Offer-wave ranking

1. Eligible per rules engine (credentials, overlap, rest, hours cap, not blocked, available).
2. Exclude workers who declined this shift or were offered it in an earlier wave.
3. Sort:
   - `fair_rotation`: fewest confirmed hours this week → longest since last offer → random.
   - `first_come_first_served`: everyone eligible gets the offer in wave 1 (no waves); first tap wins.
4. Wave size and minutes from firm settings. Cap: max 3 offers per worker per day unless urgent.
5. Quiet hours: hold non-urgent offers until the window opens; urgent may override if the firm
   allows it.

## Firm-initiated changes (compliance-critical)

When the office cancels, moves or shortens a shift with workers assigned:
1. Require a reason.
2. For each assigned worker: write an event with `notice_hours` and the change type
   (`cancelled_firm`, `moved`, `curtailed`), old and new times.
3. Notify each worker (template `shift_changed_by_firm`).
4. These rows feed the notice report; short-notice flag uses the firm threshold.

## Errors and observability

- Structured logs (JSON), phone numbers masked, request IDs. `src/lib/log`: one JSON line per
  event; every string is masked (phone numbers in any format, emails), secret and name fields are
  replaced, database error details and drizzle's query parameters are withheld. `src/proxy.ts`
  gives every request a fresh `x-request-id` (client values are overwritten); pages and actions
  log through `requestLog()`. Jobs log `queue`, `jobId` and `firmId`. pg-boss errors keep only
  whitelisted fields and repeat at most once a minute.
- Alerts to the founder: job failure after final retry, webhook signature failures spike,
  sync errors, health check down, Twilio delivery error rate > 5%.
- Weekly digest of job stats.
