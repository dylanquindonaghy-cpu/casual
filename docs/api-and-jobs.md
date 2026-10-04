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
| `POST /api/webhooks/twilio/whatsapp` | Twilio | Built in Phase 7 (`src/app/api/webhooks/twilio/whatsapp/route.ts`, `handleTwilioWhatsApp()` in `src/lib/inbound/webhook.ts`), on the platform address (not a firm's). `TWILIO_AUTH_TOKEN` unset: 503, nothing stored. A form post of at most 64 KB (else 415 / 413); `X-Twilio-Signature` checked (HMAC-SHA1 of the configured webhook URL and the sorted fields, constant-time; else 403); the fields checked with zod (MessageSid, `whatsapp:` From and To, Body at most 1600; else 400). The firm is the one whose shifts line is `To` (`resolveFirmByLine()`); none: 200 and nothing stored. One `messages` row (a repeated MessageSid stores nothing) and one `inbound-message` job, in one transaction (`receiveWhatsApp()`); an empty TwiML 200. Nothing from the message is logged. |
| `POST /api/webhooks/twilio/sms` | Twilio | Built in Phase 7 short of Twilio (`src/app/api/webhooks/twilio/sms/route.ts`, `handleTwilioSms()` in `src/lib/inbound/webhook.ts`). The same shared checks (`readTwilioRequest()`); fields checked with zod (MessageSid, From and To E.164, Body, OptOutType; else 400). The firm by `To`; none: 200 and nothing stored. One `messages` row (channel sms; `twilio_opt_out` stop / start when Twilio's own opt-out handling acted on it, HELP and anything else ignored) and one `inbound-message` job, in one transaction (`receiveSms()`); a repeat stores nothing; an empty TwiML 200. STOP itself is the job's (below). |
| `POST /api/webhooks/twilio/voice` | Twilio | Built in Phase 7 short of Twilio (`src/app/api/webhooks/twilio/voice/route.ts`, `handleTwilioVoice()` in `src/lib/inbound/voice.ts`). The same checks as the WhatsApp webhook, shared (`readTwilioRequest()` in `src/lib/inbound/twilio-request.ts`: 503 / 415 / 413 / 400 for a field sent twice / 403 for a signature that isn't for this address); fields checked with zod (CallSid `CA…`, To E.164; else 400). No firm has the number called: "Sorry, this number isn't in use." and hang up. Otherwise one `messages` row (channel voice, the CallSid as `provider_message_id`, no body, already handled: a call needs no reply job; no `from_e164` when the number is withheld: "anonymous", missing, or one of Twilio's placeholder numbers for a hidden caller ID; a repeat stores nothing and does nothing more) and `call.received` {linkRequested, withheld} (entity: the stored call; no number, no Twilio ids). From a real number, the login page's own request (`requestWorkerLoginLink()`, throttled by the caller's number): a worker's number gets their login link by `send-portal-link` (by WhatsApp: the SMS fallback for login links is parked), any other number nothing, and the answer is the same; its own events say what came of it. The TwiML: the doc's `callGreeting()` spoken in en-GB (a withheld number isn't promised a link; nor is a number the login limits stopped, or when asking failed: that is logged with an error code and the call is still answered), `<Record transcribe>` (2 minutes at most, its transcription callback and action the two webhooks below), `<Hangup/>`. |
| `POST /api/webhooks/twilio/voice/transcription` | Twilio | Built in Phase 7 short of Twilio (`handleTwilioTranscription()`). The same checks; fields RecordingSid `RE…`, TranscriptionStatus, TranscriptionText, From, To. One `messages` row (channel voice, the RecordingSid as `provider_message_id`; the text, at most 1600, only when the status is "completed" and it isn't blank, else none; no `from_e164` when withheld) and one `inbound-message` job, in one transaction; a repeat stores nothing. An empty TwiML 200 (also for a number no firm has). |
| `POST /api/webhooks/twilio/voice/done` | Twilio | Built in Phase 7 short of Twilio (`handleTwilioVoiceDone()`): `<Record>`'s action after the voicemail. The same checks; "Thank you. Goodbye." and hang up. |
| `POST /api/webhooks/twilio/status` | Twilio | Delivery status updates on `messages`. Not built yet: it comes with the Twilio sender, which sets the callback, and the 60-second text fallback (PLAN.md Parking lot, Connect Twilio step 4). It must use the same checks and store once, like every Twilio webhook (see "Twilio webhooks" below; `tests/unit/twilio.webhooks.test.ts` fails until a new route is listed there and follows them). |
| `POST /api/push/subscribe` | Portal (session) | Save web push subscription for the worker. Built (`src/app/api/push/subscribe/route.ts`, `src/lib/push/subscriptions.ts`): the worker from the session, the firm from the host, only from the portal's own page (Origin must be this host; none: 403), zod-checked, only a browser maker's push service address (Google, Apple, Mozilla, Microsoft), body at most 4 KB (413 before reading when declared); saving the same one again is a no-op; at most 10 phones per worker (the oldest go); `DELETE` removes this phone's (also when already gone); logged `push.subscribed` / `push.unsubscribed` with no address. Logout and login forget this phone's subscription (a shared phone). The service worker re-saves a renewed one (`pushsubscriptionchange`). The real push sender isn't connected (PLAN.md Parking lot). |
| `GET /api/caddy/ask?domain=` | Caddy | Built in Phase 8 (`src/app/api/caddy/ask/route.ts`, `approveCertificate()` in `src/lib/tenancy/caddy-ask.ts`): 200 only for a name in the firms table: a firm's verified custom domain (`app_resolve_firm_by_domain()`) or `<slug>.<base>` of a firm that exists (so subdomains get certificates on demand too, with no wildcard). 404 for anything else: our base domain (its certificate comes the ordinary way), `portal.<base>`, unknown names, a port, a malformed or over-long name. Caddy calls it at `http://web:3000`, so `src/proxy.ts` lets this one path through on any host; from outside, Caddy answers `/api/caddy/*` with a 404 itself (`deploy/Caddyfile`). `Cache-Control: no-store`; logs only whether it approved. |
| `GET /api/health` | Uptime check, Docker | Built in Phase 8 (`src/app/api/health/route.ts`, `webHealthy()` in `src/lib/db/health.ts`): 200 `{"ok":true}` when the web app reaches its database as the app role within 3 seconds, else 503 `{"ok":false}`; nothing more said (no versions, hosts or errors); `no-store`. Let through `src/proxy.ts` on any host (Docker calls `http://localhost:3000`). The queue and the worker's own health: with the alerts task. |
| Stage 2: `POST /api/webhooks/ses` | SNS | Inbound email notification → fetch from S3 → `classify-email`. |

### Twilio webhooks: checks and storing once (Phase 7)

Every Twilio webhook hands the request to one handler in `src/lib/inbound/` whose first step is
`readTwilioRequest()` (`src/lib/inbound/twilio-request.ts`), and a refusal returns at once:

1. no `TWILIO_AUTH_TOKEN` configured: 503 (Twilio isn't connected);
2. not a form post: 415; bigger than 64 KB (by its declared length before reading, then by what
   arrived): 413;
3. a field sent twice (Twilio never does): 400;
4. `X-Twilio-Signature` missing or wrong: 403. It's checked against the webhook's own address as
   configured (`platformUrl(APP_BASE_DOMAIN, path)`), never the address the request claims, so a
   request signed for one webhook isn't valid at another. HMAC-SHA1 of the address and the sorted
   fields, compared in constant time (`src/lib/inbound/twilio-signature.ts`, which reproduces
   Twilio's published example).

Only then are the fields checked (zod: 400) and the firm found by the number (none: 200, nothing
stored, so Twilio doesn't retry). Nothing from a request is logged.

| Webhook | Stored once by | A repeat (Twilio's retry, or a replayed request) |
|---|---|---|
| `whatsapp` | MessageSid | stores nothing, queues nothing |
| `sms` | MessageSid | stores nothing, queues nothing |
| `voice` | CallSid (a withheld number's too) | the same answer; no second row, event or login link |
| `voice/transcription` | RecordingSid | stores nothing, queues nothing |
| `voice/done` | nothing (it only says goodbye) | the same goodbye |

Twilio's signature has no timestamp, so a captured request stays valid: storing each Twilio id at
most once is the defence. The key is unique within the firm (`messages (firm_id,
provider_message_id)`); the insert is `ON CONFLICT DO NOTHING`, and the job (or event, or login
link) follows only when a row came back. Two copies at the same moment: `ON CONFLICT DO NOTHING`
waits for the other's insert, then inserts nothing. `tests/unit/twilio.webhooks.test.ts` holds every webhook, now
and future, to this shape; each webhook's integration tests prove it (refusals store nothing, a
repeat stores and sends nothing more), with `tests/integration/webhook.idempotent.test.ts` (ten
copies at once) and `tests/integration/twilio.contract.test.ts` (Twilio-shaped requests signed as
Twilio signs them).

Workers never call APIs directly; the portal uses server actions. Built so far (Phase 1): request
a login link (`src/app/login/actions.ts`), use it (`src/app/l/actions.ts`), log out and refresh the
session token (`src/app/session-actions.ts`), ask for and check a pay-page code
(`src/app/pay/actions.ts`); office login, link login, logout and refresh (`src/app/office/**`). Actions return a result and the browser navigates
itself: they never call `redirect()`, because Next renders an action's redirect target by fetching
it from the server's own origin, which loses the firm's Host header. Planned:

`takeShift(shiftId)` (built: `takeShiftAction` in `src/app/shifts/open/actions.ts` → `takeShift()`
in `src/lib/portal/take-shift.ts` → `bookShift()`, with the firm from the host and the worker from
the session; outcomes: booked with a confirmation, filled, already_assigned, gone, not_eligible
with reasons, try_again, logged_out, error) · `cancelShift(shiftId, reason)` (built: `cancelShiftAction(shiftId, choice, note)` in `src/app/shifts/actions.ts` → `cancelMyShift()` in `src/lib/portal/cancel-shift.ts` → `cancelBooking()`; firm from the host, worker from the session; outcomes: cancelled with the notice given and the booking's reference, started, not_booked, invalid_reason, logged_out, error) ·
`createRequest(type, payload)` (built for time changes and swaps: `createRequestAction(shiftId,
kind, fields)` in `src/app/requests/actions.ts` → `createRequest()` in
`src/lib/portal/requests.ts`; own upcoming booking only, one open request per shift and kind, a
`request.created` event) · "Ask the office to review" (built: `askForReviewAction(shiftId, note)`
in `src/app/shifts/[id]/actions.ts` → `askForReview()` in `src/lib/portal/review.ts`; under a lock
on the shift row, only for an open shift that hasn't started, with a place left, not already the
worker's, that the rules still refuse; one waiting review per worker and shift; a `review` request
with the rules' codes, the reasons shown and the note, and a `request.created` event {type,
shiftId}; outcomes: created with a reference, already_open, eligible_now, already_booked, not_open,
invalid, logged_out, error) · `setAvailability(dates)` (built one day at a time:
`setUnavailableAction(day, on)` in `src/app/profile/actions.ts` → `setUnavailable()` in
`src/lib/portal/profile.ts`; today to 180 days ahead, at most 60 upcoming days; outcomes: added
(with whether a booking falls that day; it is never cancelled), removed, already, not_marked, past,
too_far, too_many, invalid, logged_out, error; events `worker.unavailable_added` /
`worker.unavailable_removed` with the day only) · `raisePayQuery(form)` (built:
`raisePayQueryAction(fields)` in `src/app/pay/query/actions.ts` → `raisePayQuery()` in
`src/lib/portal/pay-queries.ts`; only for a session with the pay code from the last 30 minutes,
checked in both; a shift of the worker's that started in the last 8 weeks, or a day in the last 90
days; an issue; details required for "Something else"; one open query per worker, day, shift and
issue (asking again returns its reference, under a per-worker lock); a `pay_query.created` event
{issueType, shiftId, workDate}, never the details; outcomes: created with a reference, already_open,
invalid with problems, not_yours, needs_code, logged_out, error) ·
`updateNotificationPrefs(...)` (built: `saveNotificationSettingsAction(channel, offerAlerts)` in
`src/app/profile/actions.ts` → `setNotificationSettings()`; WhatsApp or SMS, and open-shift alerts
on or off; a `worker.notification_settings_changed` event only when something changed. The Phase 4
sender must read both: `notify_channel` picks WhatsApp or SMS, and `offer_alerts = false` means no
open-shift offers, while login links and codes are always sent)

Office server actions: `createShift` (built: `createShifts()` in `src/lib/office/shift-editor.ts`,
one shift or up to 12 for an event, all checked before any is saved; logged `shift.created` {by:
"firm"}), `updateShift` (built as `editShift()`: anything with nobody booked; with people booked,
places and instructions only, never below a booked place (moves and curtailments are the
firm-initiated flow below); logged `shift.changed` {by: "firm", fields}),
`cancelShiftByFirm(shiftId, reason)`, `cancelBookingByFirm(shiftId, workerId, reason)`
(`cancelBooking()` with `by: office`) and `moveShift(shiftId, times, site, reason)` (all built:
`cancelShiftAction`, `cancelBookingAction`, `moveShiftAction`; see "Firm-initiated changes"), `makeUrgent(shiftId)` (built as `setShiftUrgent()` in
`src/lib/roster/urgent.ts`: mark or clear, active admins and resourcers only, not on a draft,
cancelled or started shift (clearing works until the end), logged `shift.marked_urgent` {by:
"firm", cause: "office", hoursToStart} / `shift.urgent_cleared`; "Mark urgent" / "Not urgent" on
Today, `setUrgentAction`), `offerTo(shiftId, workerId)` (built: `queueOfficeOffer()` in
`src/lib/offers/office-offer.ts`, "Offer to someone" on Today, `offerShiftAction`: active admins
and resourcers, an open shift that hasn't started, a worker on the candidate list now (the rules,
offer messages on, never offered it, the daily cap unless urgent); queues `office-offer` and logs
`offer.office_queued` {shiftId, workerId}), `markFilled(shiftId)` / `openAgain(shiftId)` (built:
`closeShift()` / `reopenShift()` in `src/lib/roster/close.ts`, "Mark as filled" / "Open it again"
on Today: status `filled` with places free, unanswered offers filled elsewhere, waves and
escalation stop; logged `shift.closed` / `shift.reopened` {by: "firm", placesLeft}; not a sheet's
shift),
`assignManually(shiftId, workerId, override?)` (`bookShift()` with `by: office`; overrides only
of checks 0 and 6-8, with a reason; active admins and resourcers only; built as `assignWorker()`,
"Assign" on the shift's page, `assignAction`), `markNoShow` (built as `markAttendance()` /
`markRestWorked()` in `src/lib/roster/attendance.ts`, "Mark as worked" / "Mark as not attended" /
"Mark the {n} not marked yet as worked" on the shift's page, `markAttendanceAction` /
`markRestWorkedAction`: active admins and resourcers; once the shift has started (the rest: once it
has ended), no end limit; a live booking (confirmed, completed or no_show) becomes `completed` or
`no_show`, a marked one can be changed; the shift locked first, then the booking; logged
`shift.completed` / `shift.no_show` {by: "firm", shiftId, workerId, from}; any source, since the
Google Sheets sync only changes `confirmed` bookings; the worker isn't messaged, and sees "Worked" /
"Marked as not attended" in their past shifts), `resolveRequest` (built: `resolveRequest()` in
`src/lib/requests/resolve.ts`, `answerRequestAction` on `/office/requests`: an active admin or
resourcer; the request row locked, only an open or escalated one; approved or declined with a note
(optional to approve, required to decline, at most 500 characters, kept in
`requests.resolution_note`, never in an event); logged `request.approved` / `request.declined`
{type, shiftId, withNote}; queues `request-update`; any kind; the shift itself isn't changed), `importCsv(kind, file)` (built as `readTable()` + `runImport()` in `src/lib/imports/` for workers, credentials, shifts and pay, dry run first; the shifts screen is built: `importShiftsFile()`, `importShiftsAction`, files up to 1 MB on the web; the pay records screen too: `importPayFile()` in `src/lib/office/pay-import.ts`, `importPayAction` on `/office/pay/import`, payroll and admins, regrouping waiting pay queries after a real import that added or changed lines; both on `importOfficeFile()` in `src/lib/office/office-import.ts`),
`sendPayDigestNow` (built: `queuePayDigestNow()` in `src/lib/pay/digest.ts`, `sendDigestNowAction`
on `/office/pay-queries`: an active payroll user or admin; no new (open) pay queries → nothing; no
one to send it to → nothing; else queues a `pay-digest` with a key of its own and who asked, one a
minute at most: a second press within the minute is told to wait),
`resolvePayQueryGroup` (built: `resolvePayQueries()` in `src/lib/pay/resolve.ts`, `sortPayQueriesAction`
in `src/app/office/pay-queries/sort-actions.ts`: an active payroll user or admin; the query ids shown
in the group (at most 2,000, the page's own limit), so nothing payroll didn't see is sorted; a note to the workers, required, at most 500
characters, on the row and never in an event; only queries still open or in a digest, locked in id
order; each marked `resolved` with who and when, logged `pay_query.resolved` {workerId, previous, withNote},
and a `pay-query-update` job queued; the result counts those already sorted by someone else; none
still waiting → "already"),
`upsertCredential`, `verifyCredential`, `updateSettings`, `verifyDomain`,
`exportWorkerData` (built, Phase 8: `src/lib/gdpr/worker-export.ts`, the route
`GET /office/data/workers/[id]/export?format=json|csv`: an active admin, checked in the firm's
transaction; every row about the worker, less login secrets; logged `worker.data_exported`
{workerId, format}), `eraseWorker` (built: `src/lib/gdpr/worker-erase.ts`, `eraseWorkerAction` in
`src/app/office/data/workers/[id]/actions.ts`: an active admin; the box ticked; the worker row
locked; refused while booked on a shift that hasn't ended; personal details deleted and the row
made "Deleted worker" and their messages deleted by `app_erase_worker()` (owner-run, the number
read from the row it erases); typed text cleared from their requests (`note`, `swapWith`, the
office's answer), pay queries and cancellations (fixed wording kept: `src/lib/gdpr/free-text.ts`);
logged `worker.erased` {workerId, licences, loginLinks, sessions, devices, daysUnavailable,
siteBlocks, messages, requests, payQueries, cancelReasons}; the sites the office kept them off
(Phase 10) are deleted too, and are in their data download), `exportFirmData` (built: `src/lib/gdpr/firm-export.ts`, `GET /office/data/export`:
an active admin; every firm table less login secrets, one JSON file; logged `firm.data_exported`
{tables, rows}), `changeOfficeAccess` (built, Phase 10: `src/lib/office/team.ts`,
`changeOfficeAccessAction` on `/office/team`, and `npm run firm:office-user -- … --disable |
--enable | --set-role <role> | --sign-out` as the system: an active admin, never on their own
access; the firm's active admins locked first, then the person; turn off (status `disabled`, every
session and unused login link ended at once: `endEverySession()`), turn back on (anything left
ended too, so no old session revives), change role (read again at their next request), or log out
on every device; the firm always keeps an active admin; logged `office_user.disabled` /
`office_user.enabled` {officeUserId, role, sessionsEnded, linksSpent}, `office_user.role_changed`
{officeUserId, from, to}, `office_user.signed_out` {officeUserId, sessionsEnded, linksSpent}; a
change that changes nothing logs nothing), and a worker's access (built, Phase 10:
`src/lib/office/worker-access.ts`, the actions in `src/app/office/workers/actions.ts` on
`/office/workers/[id]`: an active admin or resourcer, the worker locked FOR NO KEY UPDATE, never an
erased one; each with a reason code from a fixed list, `src/lib/office/worker-reasons.ts`):
`changeWorkerStatus` (make inactive, from active: status `inactive` and `office_deactivated_at`
set, so no rota sheet or file makes them active again; every session and unused link ended and
their phones' notifications removed; their future bookings flagged on Today; `worker.deactivated`
{workerId, reason, sessionsEnded, linksSpent, futureBookings, devicesForgotten}. Make active again,
from inactive, and unblock, from blocked: status `active` and the mark cleared (unblocking someone
the office had made inactive leaves them inactive, `stillInactive`), anything left ended;
`worker.reactivated` / `worker.unblocked` {workerId, reason, sessionsEnded, linksSpent}; any of
the three clears "kept" on their bookings ahead, so each is looked at again; each retried on a
deadlock), `signOutWorker` (sessions, links and push
subscriptions; `worker.signed_out` {workerId, sessionsEnded, linksSpent, devicesForgotten}),
`blockFromSite` / `unblockFromSite` (a `worker_site_blocks` row added or deleted; rules check 9;
bookings there flagged; `worker.site_blocked` {workerId, siteId, reason, futureBookings} /
`worker.site_unblocked` {workerId, siteId, reason}), and `keepFlaggedBooking` (Today's "Bookings
to check", `keepBookingAction`: an admin or resourcer; a confirmed booking ahead whose worker isn't
active or is blocked from the site gets `office_kept_at`; `booking.kept` {shiftId, workerId,
cause}). A status change by a rota sheet or file (`upsertWorker()`, which holds a changing worker's
row from its read to its write, so it takes turns with the office) likewise ends sessions and
links, clears "kept" on their bookings ahead, removes push subscriptions when it isn't to active
and on a mobile change; a sheet moving a shift to another site clears "kept" on its bookings. A
kept booking's "not active" or "blocked site" doesn't stop the office moving the shift's time (a
move to another site still does) (`worker.updated` {fields, sessionsRevoked, linksSpent, devicesForgotten,
futureBookings}, each only when there were some).

## Job catalogue (pg-boss)

| Job | Trigger | Payload | What it does | Retry |
|---|---|---|---|---|
| `classify-message` | — | — | Replaced by `inbound-message` (Phase 7): keywords first, then the AI's label (`classifyMessage()`, no confidence score: an answer that isn't exactly one label counts as none), else the office. STOP handling is the SMS task. | — |
| `send-portal-link` | voice webhook, login | `{firmId, idempotencyKey, purpose, subjectId}` (ids only; `subjectId` null for an unknown number or address; `purpose` worker_login or office_login) | Login (Phase 1): creates the one-time link (the token exists only inside the job), sends the `login_link` WhatsApp template to a worker or the `office_login_link` email to an office user, logs `auth.link_sent`. Queued for every request, known number or not. A firm task, at most once (claim → send → record): the link is created and marked sent in a committed transaction before the message, which goes with no transaction open; then `auth.link_sent`, or `auth.link_send_failed` {purpose, channel, code}. A retry finds the link sent and sends nothing (the link it may have sent still works; someone who got nothing asks again). SMS fallback if not delivered in 60 s (Phase 4/7). | 3× |
| `send-login-code` | pay-page step-up | `{firmId, idempotencyKey, sessionId}` | Creates the 6-digit code (only inside the job), retires the session's earlier code, stores an HMAC (SESSION_SECRET, bound to the session) keyed by the job (`otp_codes.request_id`), all committed before it sends `login_code` with no transaction open; then logs `auth.otp_sent`, or `auth.otp_send_failed` {channel, code}. A firm task, at most once: a retry finds its code and sends nothing. | 3× |
| `notify` | many | `{firm_id, worker_id, template, vars, priority}` | Applies the notification policy: push → WhatsApp → SMS; respects quiet hours unless urgent. Writes `events`. | 3× |
| `offer-wave` | cancel/urgent | `{firmId, idempotencyKey, shiftId, wave}` (`offer-wave:<shift>:<wave>`) | Built (`src/lib/offers/waves.ts`, candidates in `candidates.ts`). Queued by `startOfferWaves()` in the same transaction as a place reopening inside the urgent window, or the office marking the shift urgent. A firm task (`runFirmTask`): several short transactions, never one held across a message, so a worker's Take shift, the office's Assign, a STOP or an erasure never wait for the wave (`tests/integration/offers.waves.lock.test.ts`). First a check under the shift's lock: a wave already sent that the shift has outgrown does nothing; a shift filled, started or closed stops the chain (`offer.waves_stopped` {reason, wave}; a filled shift's unanswered offers become `filled_elsewhere`). Candidates: active workers with the role and open-shift messages on, who never held a place on it and weren't offered it, whom the rules allow (`previewBooking`). Fair rotation: the `wave_size` best by `rankForFairRotation`, next wave after `wave_minutes`; first come, first served: everyone at once, no second wave. Each gets `shift_urgent` by their channel (WhatsApp or SMS) with a link to `/shifts/<id>`, an `offers` row and an `offer.sent` event {shiftId, workerId, wave, noticeHours (from the offer to the start, for the notice report), channel, providerMessageId, pushes}; each offer is also pushed to the worker's subscribed phones (`urgentPush`, the path `/shifts/<id>`; a phone the push service says is gone is deleted and logged `push.forgotten` {reason}). Then, per worker: a claim (the shift re-locked and re-checked; the wave not full; the worker's count lock; the worker re-read as they are now, still reachable and wanting offers, not offered or booked it since the list was read, and allowed by the rules (`previewBooking`); their `offers` row written and committed), the message to their contact as read in the claim with no transaction open, then the push and the event in a short transaction. If the office changed the shift's role, times or site mid-wave, the wave is queued again at once from the shift as it is now. A claim never recorded (a crash between) means the message may have gone: it's never sent again, and the next run of the wave logs it as `offer.sent` {…, unconfirmed: true} with its notice hours, so the notice report keeps it (`src/lib/offers/unconfirmed.ts`; the office's offer does the same). `offer.send_failed` carries the `offerId`. If the shift fills mid-wave, the rest aren't messaged and the chain stops (`filled`). A retried or second copy of a wave carries on with whoever is left, up to the wave size; the next fair-rotation wave is queued once (a pg-boss singleton key `offer-wave-next:<shift>:<wave>`, 24 hours). No one left: stops (`no_candidates`). A worker booked onto a shift they were offered (they took it, or the office placed them) has that offer `accepted`; the moment the shift fills, by any route (a booking, the office's Assign or "Mark as filled", an edit, an import or a sheet sync), every other offer still waiting is closed: holders' `accepted`, the rest `filled_elsewhere`, logged `offer.closed` {reason, accepted, filledElsewhere} (`src/lib/offers/close.ts`, in every allocation mode). Quiet hours: a wave is held (`offer.wave_held` {wave, until, reason}) and re-queued for when they end, unless the firm lets urgent override them (the default); within a minute of the end it just goes. A WhatsApp the provider refuses (`ChannelRefusedError`) goes by SMS (the offer's channel updated, `fellBackFrom` in the event); any other failed send is marked `failed` on the offer and logged `offer.send_failed` {workerId, wave, channel, code}, the rest of the wave still goes, and that worker can be offered it again in the next wave. The daily cap (at most 3 offers per worker per firm-local day unless urgent, `src/lib/rules/offer-cap.ts`) is applied in the candidate list; waves are always urgent, so it never holds one back. Only this job writes offers or builds the offer message and push, and only for the candidate list's workers (`tests/unit/offers.boundary.test.ts`). | pg-boss default |
| `escalate-shift` | scheduled at start − X h | `{firmId, idempotencyKey, shiftId}` (`escalate-shift:<shift>`) | Built. Queued with the first wave, to run at the start minus `escalate_hours_before_start` (default 3; at once if already past). If a place is still free and the shift hasn't started: `shift.escalated` {freePlaces, offersSent, notified, hoursToStart} is recorded first (the Today view's "needs attention"; once per shift), then, per office user (active admins and resourcers), a claim (`shift.escalation_emailed` {officeUserId}, committed) and the `shift_escalation` email with no transaction open. A retry or second copy emails only those not yet claimed; an address that fails is logged `shift.escalation_failed` {officeUserId, code} and the rest still go. Push to the office: with web push. | pg-boss default |
| `offer-expire` | scheduled +wave_minutes | `{firm_id, offer_id}` | Mark expired offers; tell workers if filled elsewhere. | 3× |
| `firm-change-notice` | the office's cancel, move or shorten | `{firmId, idempotencyKey, eventId, assignmentId}` (`firm-change:<event id>`, `:after-quiet` when held) | Built (`src/lib/notices/firm-change.ts`), a firm task. At most once: (1) claims the notice under an advisory lock on the booking (`shift.change_notice` {changeEventId, workerId, status: sending}; a second run finds it and does nothing), (2) sends outside any transaction, (3) pushes and logs `shift.change_notice_sent` {changeEventId, workerId, channel, providerMessageId, pushes, fellBackFrom?} or `_failed` {…, code}. `shift_cancelled_by_firm` for a cancellation, `shift_changed_by_firm` for a move or curtailment (what changed; the new time, with the day when it moved to another day), by the worker's channel with the fallback. Each message starts from what the worker was last told (the old times and site of the earliest move since their last notice) and ends at the shift as it is now, so a superseded notice loses nothing; a cancellation after an untold move names the shift they knew. Quiet hours: urgent when the shift starts within the firm's urgent window (the soonest start still ahead of the one they knew and the new one) or is under way; else held until they end, logged `shift.change_notice_held` {changeEventId, workerId, until, afterStart} and queued again (never dropped). Out of date: skipped and logged `shift.change_notice_skipped` {reason: superseded (a later change to the same booking) / not_booked / unchanged (moved back to what they knew)}. | pg-boss default |
| `request-update` | the office answering a request | `{firmId, idempotencyKey, requestId}` (`request-update:<request id>`, `:after-quiet` when held) | Built (`src/lib/notices/request-update.ts`), a firm task. At most once: (1) claims under an advisory lock on the request (`request.update_notice` {workerId, status: sending}; a second run finds it and does nothing), (2) sends outside any transaction, (3) pushes (`requestUpdatePush()`, opening My requests) and logs `request.update_sent` {workerId, channel, providerMessageId, pushes, fellBackFrom?} or `_failed` {…, code}. `request_update` with the office's note on one line, or `request_update_no_note`, by the worker's channel with the fallback. Quiet hours: held (`request.update_held` {workerId, until}, queued again) unless the request's shift starts within the firm's urgent window or is under way. A request that isn't approved or declined: nothing. The office's page shows whether the worker was told. | pg-boss default |
| `office-offer` | office action | `{firmId, idempotencyKey, shiftId, workerId, officeUserId}` (`office-offer:<shift>:<worker>`, `:after-quiet` when held) | Built (`src/lib/offers/office-offer.ts`). Under the shift lock: already offered by the office → nothing; the office user still an active admin or resourcer, the shift open, not started, with a place free and not marked filled, the worker still on the candidate list, else `offer.office_not_sent` {workerId, reason}. Quiet hours hold it (`offer.office_held` {workerId, until}, re-queued for when they end) unless the shift is urgent and the firm lets urgent through. The offer row (`offered_by`, no wave: one per worker per shift), committed under the shift lock (a firm task: claim → send → record), then `shift_offer` (or `shift_urgent` for an urgent shift) by the worker's channel with no transaction open, then the push (`src/lib/notify/send.ts`); a retry finds the offer and sends nothing; logged `offer.sent` {shiftId, workerId, offeredBy, channel, providerMessageId, pushes, fellBackFrom?} or `offer.send_failed`. | pg-boss default |
| `shift-reminders` | `shift-reminder-tick`, cron every 5 minutes | `{firmId, idempotencyKey}` (`shift-reminders:<5-minute slot>`; firm-scoped singleton, one per firm per slot) | Built (`src/lib/reminders/send.ts`, rules in `src/lib/rules/reminders.ts`, ADR-017). A firm task (several short transactions, none held across a send). The tick queues a firm's job only when a reminder is due. Due: every confirmed booking on an open or filled shift, for active workers only (Phase 10: one made inactive or blocked by any path gets none, checked again at the claim); the 24 h reminder from 24 h before the start until 2 h before, the 2 h one from then until the start, each only for a booking made before its time (someone who books 5 hours before gets only the 2 h one). Per reminder: (1) its `shift_reminders` row is written as `sending` (only if the booking is still confirmed at that start time; unique per booking, reminder and start time) and committed; (2) `shift_reminder_24h` / `shift_reminder_2h` goes by the worker's channel with the same fallback as offers (`src/lib/notify/send.ts`), outside any transaction; (3) the row becomes `sent`, the push goes (the path `/shifts/<id>`) and `shift.reminder_sent` {shiftId, workerId, kind, channel, providerMessageId, pushes, fellBackFrom?} is logged. A failed send: the row `failed`, `shift.reminder_failed` {shiftId, workerId, kind, channel, code}, never resent. A job that stops after a send leaves the row `sending` (it may have gone): a retry, and later runs, never send it again. A shift moved to a new time gets new reminders. Quiet hours hold a reminder until they end if they end at least 10 minutes (two runs) before its window closes; otherwise it's recorded `skipped` and logged `shift.reminder_skipped` {shiftId, workerId, kind, reason: quiet_hours}. Output `{sent, failed, skipped}`. | pg-boss default |
| `sheets-sync-tick` | cron every minute (`* * * * *`), no firm | — | Lists firms (`app_firm_ids()`); for each with an enabled sheet that is due (every minute on an event day: a shift on now, in the last 6 h or the next 24 h; else every 15 min; while syncs are failing, every 5 min on an event day, else 30), queues one `sheets-sync`. Scheduled only when the worker has a Sheets client (`SHEETS_TRANSPORT=google`). | — |
| `sheets-sync` | the tick | `{firmId, idempotencyKey}` (`sheets-sync:<minute>`; firm-scoped singleton key, 50 s) | A firm task (`runFirmTask`: several transactions, network between them). Expires after 4 minutes, inside the sync's 5-minute lease. `syncSheet()`: lease, the sheet's locale (anything but `en_GB` fails with `sheet_locale_not_uk`, nothing read), one batch read, mirror + three-way merge in one transaction, at most one id-column read and one batch write, then record the merge base, `last_synced_at` and a `roster.synced` event. The office editor's rules hold (Phase 10), per row in this order: the people the sheet took off since the last sync are cancelled first (at the times they knew); then a new role, times or site on a booked shift is tried in a savepoint and kept only if everyone still booked can work it (`recheckHolders()`, the sheet's overrides; broken rules settings fail closed), while a started shift (our copy's start) is never re-timed, re-roled, moved or cancelled, a move into the past is refused, and a shift cancelled in the same edit keeps its old times that sync (notice from the start its people knew); then the rest of the row (headcount, instructions; open / filled refreshed before names); then the status; then the sheet's new names. A refusal leaves our copy as it is and is logged `roster.sheet_change_refused` {fields, wanted, reason: rules / settings / started / in_past, workers: [{workerId, codes}]} when what the office is told changes (against the shift's `sheet_issues`, which Today reads; written only when it changes). An applied move is logged per worker with `rulesOk` and the codes the sheet's overrides let through (`shift.changed` carries `overridden` too), its reason "Site changed on the rota sheet" when only the site moved. A name in the sheet goes through the rules before it's given a place; one not booked (`roster.sheet_booking_refused` {workerId, codes, droppedFromSheet?}, when what's said about it changes; codes may be `no_place`, `not_found` or `settings_invalid`) stays in the cell while there's room and is tried again each sync; only a name with no room left is taken out of the cell (`droppedFromSheet`). The merge base and the shift's status are written only when they change. Failures store a code in `roster_sources.last_error_code` and log `roster.sync_failed` (once per new code, not every retry). Office alerts on errors: Phase 5. | pg-boss default |
| `credential-scan-tick` | cron daily 08:00 Europe/London (`0 8 * * *`, pg-boss `tz`), no firm | — | Lists firms (`app_firm_ids()`) and queues one `credential-scan` per firm for its local date. 08:00 is outside the default quiet hours (22:00–07:00). A day it didn't run is caught up the next day (warnings go by thresholds crossed). Always scheduled. | — |
| `credential-scan` | the tick | `{firmId, idempotencyKey}` (`credential-scan:<yyyy-mm-dd>`, the date scanned for, so a retry after midnight scans the same day; firm-scoped singleton key, one a day) | A firm task (`src/lib/credentials/scan.ts`), at most once (claim → send → record, never a transaction held across a message). Per valid credential with an expiry date, a short transaction re-reads and locks the row and decides: at 30, 14 and 7 days a `credential_expiring` WhatsApp to the worker (active workers only; one message for the nearest threshold if several were crossed; `credentials.expiry_warned_for`/`expiry_warned_days` are set as the claim, before it goes), logged `credential.expiry_warning` once sent, or `credential.expiry_warning_failed` {code}. The day after the expiry date: status `expired` and `credential.expired` {type, expiresOn, notified} in the claim, then `credential_expired` to the worker if active, logged `credential.expiry_notice_sent` or `credential.expiry_notice_failed`. A row the worker has already replaced (a valid row of the same type lasting longer) gets no warning or message. An import renewing a licence never waits for a message. Mondays only: the `credential_weekly_list` email to active admins and resourcers (next 30 days, last 7 days, at most 40 lines a section), once (`credential.weekly_list_sent`, written first as the claim), only when there's something to list; an address the email can't go to is skipped and counted, and one that fails is logged `credential.weekly_list_failed` {officeUserId, code} while the rest still go. Blocking doesn't wait for it: the rules engine refuses a past date whatever the status. Safe to re-run: a retry sends nothing already claimed. Output: `{date, warned, expired, failed, weeklyList}`. | pg-boss default |
| `pay-digest-tick` | cron every 5 minutes (`*/5 * * * *`), no firm | — | Lists firms (`app_firm_ids()`) and, for each whose digest is due (the firm setting `pay_digest`: a digest day, at or after its time, firm-local; default 09:00 Monday to Friday; `src/lib/pay/digest-schedule.ts`), queues one `pay-digest` keyed by the firm-local date. Later ticks that day queue nothing new (a firm-scoped singleton, and the job's own check). A digest missed while the worker was down goes later the same day; a day missed entirely isn't caught up (the next digest has its queries). Always scheduled. | — |
| `pay-digest` | the tick, or "Send the digest now" on `/office/pay-queries` | `{firmId, idempotencyKey, officeUserId?}` (`pay-digest:<yyyy-mm-dd>`, or `pay-digest:<yyyy-mm-dd>:now:<uuid>` with who asked) | Built (`src/lib/pay/digest.ts`), a firm task, at most once per key. (1) Transaction 1, under an advisory lock for the firm: nothing if the key already ran (its `pay_digest.sending` or `pay_digest.skipped` event); `regroupPayQueries()` (a pay line imported since moves a query to the right group); the oldest 1,000 `open` pay queries (none: `pay_digest.skipped` {key, date, reason: nothing_new}); the recipients, active payroll users with a usable address, else active admins (none: `pay_digest.skipped` {reason: no_recipients, queries}, the queries stay open); the queries marked `in_digest`, so a second digest can't send them; their groups (`loadPayQueryGroups(tx, { ids })`); `pay_digest.sending` {key, date, queries, groups, recipients} and one `pay_query.in_digest` {digestKey} per query (`recordEvents()`, in the same transaction as the change). (2) Outside any transaction: the AI's line for the 10 biggest groups (`summariseGroups()`, at most 5 seconds a group, `AI_SUMMARY_TIMEOUT_MS`; any failure, a late answer or a line that fails the check leaves the group with the app's line only; `noAi` until "Connect Bedrock"), then the `pay_digest` email with the list attached (`payDigestCsv()` in `src/lib/pay/digest-list.ts`) to each recipient; one failure doesn't stop the others. (3) Transaction 2, under the same lock and run again if Postgres aborts it (`retryAborted()`): sent to anyone, `pay_digest.sent` {key, date, queries, groups, recipients, failed, skipped}; sent to no one, the queries go back to `open` (each logged `pay_query.back_to_open` {digestKey, reason: send_failed}) and `pay_digest.failed` {key, date, queries, recipients, code}. Any failed send counts as not sent, even one that might have been delivered (a timeout): a query listed twice beats one payroll never sees. A crash after transaction 1 leaves the queries `in_digest` (on payroll's page, not sent again); after 30 minutes the page says that digest may not have gone. A digest payroll asked for is logged as theirs. Output `{status, …}`. | pg-boss default |
| `inbound-message` | the WhatsApp and SMS webhooks storing a message; the transcription webhook storing a voicemail | `{firmId, idempotencyKey, messageId}` (`inbound-message:<message id>`); its pg-boss group is the sender's worker id (`w:<id>`), or the message id for an unknown number | Built (`src/lib/inbound/reply.ts`), a firm task. Nothing is written before the point of no return, so a failure before the reply is retried; after it, the reply never goes twice. (1) A read: the message, the firm, the sender among the firm's active workers by number, and a keyword (never for a voicemail: it goes to the office; whole words, in this order: cancel; pay, paid, wages, payslip; shifts, work, available, but not with a dropout word such as "can't", "not", "sick", "late"; help, office, talk). A text that is only one of Twilio's standard opt-out words (whole message, any case: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT; START, UNSTOP, and YES for a number with texts off) or that Twilio's own handling acted on (`answerOptOut()`, `src/lib/inbound/opt-out.ts`, the same claim / send / record shape): the message locked and marked `opt_out`; the worker with that number (any status) has `sms_opted_out_at` set or cleared, logged `worker.sms_opted_out` / `worker.sms_opted_in` {via: sms, byTwilio} only when it changes; `message.received` {channel: sms, handledAs: opt_out, optOut, changed, workerId}; then, only when it changed and Twilio didn't confirm it itself, one text from the line (`sms_stopped` / `sms_started`), stored, `message.replied` {channel: sms, reply, workerId, replyId} or `message.reply_failed`. A stranger's STOP marks nobody and gets nothing. A number that isn't an active worker's, or a withheld one (`answerUnknown()`, the same claim / send / record shape): the message (locked) is marked `handled_as` unknown (with the worker when it's a former worker's number) and `message.received` {channel, handledAs: unknown, repeat, formerWorker} logged. One at a time per number (an advisory lock), and only a first one goes further: a message is a repeat when the number's last answered message (logged `repeat: false`) was under 24 hours ago, so a number gets at most one reply and one alert in any 24 hours (no loops with auto-replies, one email for the office). a WhatsApp from a number nobody here has gets `unknown_number` from the firm's line (a voicemail gets no message: we don't message callers we don't know; a withheld number has no earlier messages to match, so each of its voicemails is a first) (stored; `message.replied` {channel, reply: unknown_number, replyId} or `message.reply_failed`), a former worker's gets no reply; either way the office's active admins and resourcers get `unknown_number_alert` (no number, no text) and `message.office_alerted` {reason: unknown_number / former_worker, recipients, failed, skipped} (or `message.office_alert_failed` when every email failed, or `message.office_alert_skipped` {reason, skipped} when there was nobody to email). Today lists the messages. (2) No keyword: the AI's label (`classifyMessage()`, the worker's text only, one of shifts / cancel / pay / office or it counts as none, 5 seconds at most); none, a failure or a photo with no text: the office. (3) The claim, in one transaction: the message locked and, if nobody has handled it, marked (`handled_at`, `handled_as`, `intent`); for the office, a `general` request (note: the message, at most 500 characters, or "(A voicemail we couldn't turn into text.)"; `via: whatsapp` or `voicemail`; `request.created` {type, shiftId: null, via, workerId}); `message.received` {channel, handledAs, intent, workerId}. (4) The reply (`shiftsLineReply()`, or for a voicemail the `voicemail_received` template: the doc's fixed words, never the AI's; signed), from the number they contacted, at once: by WhatsApp to a WhatsApp (a text if WhatsApp refuses it: `sendToWorker()`), and for a voicemail by the channel the worker chose. (5) Stored as an outbound message answering theirs, and `message.replied` {channel (the one it went by), intent, fellBackFrom (when it fell back to a text), workerId, replyId} (the provider's id is on the stored reply, not in the event), or `message.reply_failed` {…, code}, never retried. No AI connected yet (`noAi`): unclear messages go to the office. | pg-boss default; a job held by a worker that crashed is back to be retried within about a minute (the firm queues' heartbeat: `src/worker/jobs/queues.ts`, `tests/integration/jobs.crash.test.ts`). Run by 8 loops at once, one job per sender at a time (`INBOUND_WORK_OPTIONS`, `src/worker/jobs/index.ts`); before a message, the job answers any older unanswered one from the same number first (at most 50; one that fails is logged and left to its own job's retries), so a STOP is handled before the text after it (`tests/integration/inbound.load.test.ts`: 200 workers answered within 20 s with a 300 ms send, never two sends to one number at once). |
| `pay-query-update` | payroll sorting a query | `{firmId, idempotencyKey, payQueryId}` (`pay-query-update:<query id>`, `:after-quiet` when held) | Built (`src/lib/notices/pay-query-update.ts`), a firm task. At most once: (1) claims under an advisory lock on the query (`pay_query.update_notice` {workerId, status: sending}; a second run finds it and does nothing), (2) sends outside any transaction, (3) pushes (`payQueryUpdatePush()`: "Pay query sorted", nothing about the pay, opening `/pay`) and logs `pay_query.update_sent` {workerId, channel, providerMessageId, pushes, fellBackFrom?} or `_failed` {…, code}. `pay_query_update` with payroll's note on one line, by the worker's channel with the fallback. Quiet hours always hold it (a pay answer is never urgent): `pay_query.update_held` {workerId, until}, queued again. A query that isn't sorted: nothing. No AI anywhere on this path (`tests/unit/ai.boundary.test.ts`). | pg-boss default |
| `metrics-rollup` | `metrics-rollup-tick` cron daily 00:30 London (one job per firm per local date), or "Update the figures now" on `/office/reports/pilot` (the same code, at once) | `{firmId, idempotencyKey}` (`metrics-rollup:<local date>`) | Built (`src/lib/metrics/rollup.ts`), a firm task. Recomputes `metrics_daily` (kind `daily`) for the last 7 days and today (upserts; running it again changes nothing), so late facts count. Per firm-local day: worker_logins (workers, each once), portal_actions (workers doing it themselves: takes, cancels, days off, settings, pay page), requests_created (for the office), requests_due (answered, or 24 hours old), requests_slow (of those, answered after 24 hours or still waiting), worker_cancellations, firm_cancellations, short_notice_cancellations (under the firm's threshold), urgent_shifts, urgent_filled_by_wave (shifts a worker took themselves, by Take shift, after a wave offer: an office placement or a sheet name doesn't count; the page works out the fill rate live over its dates, each shift once), no_shows (by the shift's day). From events and rows only: inbound messages come in Phase 7. | pg-boss default |
| `retention-purge-tick` | cron daily 03:30 Europe/London (`30 3 * * *`, pg-boss `tz`), no firm | — | Lists firms (`app_firm_ids()`) and queues one `retention-purge` per firm for its local date (a firm-scoped singleton, one a day; one firm's failure never stops the others). Always scheduled. | — |
| `retention-purge` | the tick | `{firmId, idempotencyKey}` (`retention-purge:<local date>`) | Built (`src/lib/gdpr/retention.ts`), a firm task, one transaction: messages over 90 days old and replies to them (`app_purge_old_messages()`, owner-run: the app role can't delete messages), `payload.note` and `payload.swapWith` (typed text) removed from requests over 90 days old, rate-limit counters a day after their window started, login links and codes 7 days after expiry, sessions 30 days after expiry or revocation; then `retention.purged` {messages, requestNotes, throttle, loginLinks, sessions, codes}, every run. Running it again deletes nothing more. Events, requests and offers (12 months in docs/compliance.md) aren't purged yet (PLAN.md Parking lot). | pg-boss default |
| `ops-alerts-tick` | cron every 5 minutes (`*/5 * * * *`), no firm | — | Built (`src/lib/ops/tick.ts`, Phase 8): alerts to the founder, from the last hour. Failed jobs (pg-boss `failed`, i.e. after the last retry), by queue (the 5 with the most, then how many more), read through the worker's pg-boss connection (`failedJobCounts()`, not the `ops-alert` queue itself). Each firm (`app_firm_ids()`, inside its own transaction): an enabled rota sheet still being tried (an attempt in the last hour) whose last sync failed and that hasn't synced for 30 minutes; its WhatsApp and text sends by the senders that also log their failures (`offer.sent`, `shift.reminder_sent`, `shift.change_notice_sent`, `request.update_sent`, `pay_query.update_sent`, `message.replied`, with `channel` whatsapp or sms) against those failures (`offer.send_failed`, `shift.reminder_failed`, `shift.change_notice_failed`, `request.update_failed`, `pay_query.update_failed`, `message.reply_failed`; not `sms_opted_out`, the worker's own choice): an alert above 5% of at least 20, with the commonest code. (A login link, login code or credential message that fails fails its job instead: the failed-jobs alert.) The web app's health check from inside the server (`HEALTH_CHECK_URL`, three tries 5 s apart). Each alert (`src/lib/ops/alerts.ts`: counts, queue names, firm slugs, or the id's start when a slug would look like a phone number, and codes only; refused if the log masker would change it) is queued as an `ops-alert` job by `queueOpsAlert()` unless one with the same key was queued in the last hour (plus pg-boss's singleton for two ticks at once). One part failing (listing firms, a firm, failed jobs, the health check, queueing one alert) never stops the others. Twilio's delivery receipts aren't counted yet (no status webhook). | — |
| `ops-alert` | the tick | `{kind, key, text}` (no personal data) | Built: checks the payload again and sends it through `ALERTS_TRANSPORT` (`console`, also when unset: one `ops alert` error line in the log; `none`, refused in production). `npm run -s ops:test-alert` sends a test alert the same way. The phone sender comes with "Connect alerts to your phone" (PLAN.md Parking lot). | pg-boss default |
| `domain-verify` | — | — | Not a job for now (Phase 8): the owner sets and checks a firm's domain with `npm run firm:domain` (`--domain`, `--check`, `--clear`; `scripts/firm-domain-owner.ts`), since the app role can't change firms. It looks up the CNAME (before locking anything): verified only if it points to that firm's own subdomain, `<slug>.<base>` (so a domain can't be verified for another firm); a domain whose CNAME has gone is unverified by `--check`. Logged `firm.domain_changed` {change, verified, domain, before (when replacing)}. An office action and a periodic re-check come with the settings screen (PLAN.md Parking lot). | — |

**How the worker takes firm jobs** (`FIRM_WORK_OPTIONS`, `src/worker/jobs/index.ts`): up to 5 per
fetch, run one after another in the order they were queued (so a worker's STOP is handled before
their next text, and an offer wave holds its shift only while it runs), and while a fetch comes
back full it fetches again at once; a short fetch goes back to pg-boss's 2-second poll. A batch
shares one expiry (15 minutes by default): one job hanging past it fails the batch and pg-boss
retries its jobs, which every job here tolerates (send-login-code sends a fresh code); give the
Twilio client a request timeout when it's connected. pg-boss's default (one job, then a 2-second wait, every time)
answered 200 WhatsApps in about 400 seconds; the pre-pilot load smoke (`tests/e2e/load.smoke.spec.ts`)
now sees every reply stored within seconds of the last message arriving.

**Idempotency keys:** `offer-wave` uses `${shift_id}:${wave}`; `notify` uses
`${worker_id}:${template}:${entity_id}:${date}`; `sheets-sync` uses a firm-scoped singleton key
(one per firm per 50 s) plus the sync's own lease on `roster_sources`, so two syncs of one firm
never overlap.

## Offer-wave ranking

1. Eligible per rules engine (credentials, overlap, rest, hours cap, not blocked, available).
2. Exclude workers who declined this shift or were offered it in an earlier wave.
3. Sort:
   - `fair_rotation`: fewest confirmed hours this week → longest since last offer → worker id (a
     stable tie break; make it random per wave in Phase 4 if the same people keep winning ties).
   - `first_come_first_served`: everyone eligible gets the offer in wave 1 (no waves); first tap wins.
   (`rankForFairRotation()` in `src/lib/rules/allocation.ts` is the fair-rotation order.)

**On the Open shifts board** (built, Phase 3): under `fair_rotation` a newly opened place (the
shift's creation, or its latest cancellation) is held for `wave_minutes` for the `wave_size`
eligible-role workers with the fewest confirmed hours in the shift's week (ties included), unless
the shift starts within `urgent_window_hours` (default 24: late dropouts fill at once), the window
would run past the start, the shift isn't open, or the worker is already on it; `bookShift()` answers a worker outside that group `not_yet`
with the time it opens to them and logs `shift.booking_held`
(`loadAllocationGate()` in `src/lib/roster/allocation-input.ts`, `allocationGate()` in
`src/lib/rules/allocation.ts`). Office bookings and the office's sheet are never held. Settings:
`allocation_mode` (default `first_come_first_served`), `wave_size` (4), `wave_minutes` (15); a value
that makes no sense stops the booking.
4. Wave size and minutes from firm settings. Cap: max 3 offers per worker per day unless urgent
   (built: `mayOfferToday()` in `src/lib/rules/offer-cap.ts`, asked by `waveCandidates()` for every
   worker; "urgent" is the shift's own `is_urgent`, read by the candidate list, never passed in). "A
   day" is the firm's calendar day (midnight to midnight, in the firm's time zone). Every offer the
   worker got that day counts, urgent ones too; one that failed to send doesn't. The 3 is fixed
   policy, not a firm setting.
5. Quiet hours: hold non-urgent offers until the window opens; urgent may override if the firm
   allows it.

## Firm-initiated changes (compliance-critical)

When the office cancels, moves or shortens a shift with workers assigned:
1. Require a reason.
2. For each assigned worker: write an event with `notice_hours` and the change type
   (`cancelled_firm`, `moved`, `curtailed`), old and new times.
3. Notify each worker (template `shift_changed_by_firm`).
4. These rows feed the notice report; short-notice flag uses the firm threshold.

Built in Phase 5, on the office's shift page ("Move, shorten or cancel"; each booking's "Cancel
{name}'s booking"):
- **Reasons** are a fixed list (`src/lib/roster/firm-reasons.ts`): "The event's times or place
  changed", "The event was cancelled", "The client needs fewer staff", "Weather or safety",
  "Another reason", and for one person's booking only (Phase 10, from Today's "Bookings to
  check") "They've left, or can't work here". The words go in the log; free text never does.
- **Cancel a shift** (`cancelShiftByFirm()` in `src/lib/roster/cancel.ts`): each confirmed booking
  is cancelled through the plug (`cancelled_firm`, the reason's words on the row, notice hours from
  the start), logged `shift.cancelled` {by: "firm", shiftId, workerId, reason, noticeHours}. Then
  the shift is `cancelled`, offers still out expire, and `shift.cancelled_by_firm` {by, reason,
  bookings} is logged. Not a started shift, and not a Google Sheet's.
- **Cancel one booking**: `cancelBooking()` with `by: office` and a reason from the list, whose
  words also go in its event. The worker is told. (How the office records a worker's own
  cancellation when they ring in is parked for Dylan: for now any office cancellation is the
  firm's.)
- **Move or shorten** (`moveShiftByFirm()` in `src/lib/roster/firm-change.ts`): new date, times
  and/or site. It's curtailed when the new times sit inside the old ones at the same site,
  otherwise moved. First the rules are run for each booked worker at the new time: if anyone fails a
  check the office can't override (a credential not in date through the new day, their role, a
  clash; or no answer at all, their record missing), nothing moves (`blocked`, with their names and
  reasons: cancel those bookings first), and the refusal is logged in a short transaction of its
  own: `shift.move_refused` {by, reason, workers: [{workerId, codes}]}.
  Per confirmed worker: `shift.curtailed` / `shift.moved` {by, shiftId, workerId, reason,
  oldStartsAt, oldEndsAt, newStartsAt, newEndsAt, oldSiteId, newSiteId, noticeHours (from the
  earlier of the old and new start, Phase 10: a move earlier records the warning the worker had of
  the new time, so the notice report flags it; the Sheets sync counts the same way), rulesOk,
  codes?}. Each booked worker's row is held (after the shift's, in id order) before the rules run
  for them, so a booking of theirs at that moment finishes first and is seen. Plus
  `shift.changed` for the shift (from/to times and site), and offers
  still out expire. Workers with only overridable problems (rest, hours, a day off) stay booked and
  are listed for the office.
- **Telling each worker**: every one of those events queues `firm-change-notice` (below).

## Errors and observability

- Structured logs (JSON), phone numbers masked, request IDs. `src/lib/log`: one JSON line per
  event; every string is masked (phone numbers in any format, emails), secret and name fields are
  replaced, database error details and drizzle's query parameters are withheld. `src/proxy.ts`
  gives every request a fresh `x-request-id` (client values are overwritten); pages and actions
  log through `requestLog()`. Jobs log `queue`, `jobId` and `firmId`. pg-boss errors keep only
  whitelisted fields and repeat at most once a minute.
- Alerts to the founder: job failure after final retry, webhook signature failures spike,
  sync errors, health check down, Twilio delivery error rate > 5%. Built in Phase 8 short of the
  phone (`ops-alerts-tick` and `ops-alert` above; `src/lib/ops/`): every alert today is an
  `ops alert` error line in the log. Bad webhook signatures are counted in the web process's memory
  (`src/lib/ops/signature-spike.ts`: per-minute counts for the last hour; 20 or more send one
  alert, then at most one an hour; a restart starts again; the webhook doesn't wait for it), since the web can only queue firm jobs
  and a row per bad request would let anyone fill the database. The server being down altogether
  is the outside uptime check's to report (docs/runbooks.md "Monitoring and alerts (once)").
- Weekly digest of job stats.
