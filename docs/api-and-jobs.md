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

Workers never call APIs directly; the portal uses server actions:

`requestLoginLink(mobile)` · `verifyOtp(code)` · `takeShift(shiftId)` · `cancelShift(assignmentId, reason)` ·
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
| `send-portal-link` | voice webhook, login | `{firm_id, worker_id or mobile, purpose}` | Sends WhatsApp template; SMS fallback if not delivered in 60 s. | 3× |
| `notify` | many | `{firm_id, worker_id, template, vars, priority}` | Applies the notification policy: push → WhatsApp → SMS; respects quiet hours unless urgent. Writes `events`. | 3× |
| `offer-wave` | cancel/urgent | `{firm_id, shift_id, wave}` | If shift still open: rank eligible workers, send wave to next N, record `offers`, schedule next wave in `wave_minutes`. Stop when filled. | 3× |
| `escalate-shift` | scheduled at start − X h | `{firm_id, shift_id}` | If still unfilled: notify resourcer (push + email); mark shift "needs attention". | 3× |
| `offer-expire` | scheduled +wave_minutes | `{firm_id, offer_id}` | Mark expired offers; tell workers if filled elsewhere. | 3× |
| `shift-reminder` | cron hourly | — | 24 h and 2 h before start: reminder to assigned workers (cuts no-shows). | — |
| `sheets-sync` | cron (every 1–2 min on event days, 15 min otherwise) | `{firm_id}` | Pull shifts/staff from the sheet; push confirmed assignments; batch writes; record `last_sync_at`; alert office on auth/permission errors. | 5× |
| `credential-scan` | cron daily 06:00 | `{firm_id}` | Expiring in 30/14/7 days → warn worker + office. Expired → status `expired`, block. | — |
| `pay-digest` | cron per firm setting | `{firm_id}` | Group open pay queries by `group_key`; Haiku one-liner per group; email payroll; mark `in_digest`. | 3× |
| `metrics-rollup` | cron daily 00:30 | `{firm_id}` | Fill `metrics_daily` from events and messages. | — |
| `purge-retention` | cron nightly 03:00 | `{firm_id}` | Delete per retention settings; write an event per run. | — |
| `domain-verify` | office action | `{firm_id}` | Check CNAME resolves to us; set `domain_verified`; notify. | 5× |

**Idempotency keys:** `offer-wave` uses `${shift_id}:${wave}`; `notify` uses
`${worker_id}:${template}:${entity_id}:${date}`; `sheets-sync` uses `${firm_id}` as a singleton.

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

- Structured logs (JSON), phone numbers masked, request IDs.
- Alerts to the founder: job failure after final retry, webhook signature failures spike,
  sync errors, health check down, Twilio delivery error rate > 5%.
- Weekly digest of job stats.
