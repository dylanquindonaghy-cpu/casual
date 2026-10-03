# Architecture

One Next.js app and one background worker, from the same codebase, running in Docker on a
single AWS Lightsail server in London, with a managed Postgres database. Every firm's data is
in the same database, separated by `firm_id` and Row Level Security.

Scale is small (tens to a couple of hundred messages per firm per day, spiking on event
mornings). Reliability matters far more than scale.

## Diagram

```
 Casual workers (phone browser)     WhatsApp / SMS / calls        Firm's Google Sheet
          |                                  |                           |
          | HTTPS (firm domain)              | webhooks                  | sync job (1–2 min)
          v                                  v                           v
 +---------------------------- AWS London (eu-west-2) ---------------------------------+
 |  Lightsail server (Docker Compose)                                                   |
 |   caddy   -> HTTPS for our domain + firm custom domains (on-demand TLS, "ask" check) |
 |   web     -> Next.js: staff portal, office dashboard, /api/webhooks/*                |
 |   worker  -> pg-boss jobs: offer waves, escalations, syncs, digests, AI calls        |
 |                 |                        |                                           |
 |                 v                        v                                           |
 |   Lightsail managed Postgres      Amazon Bedrock (Claude, EU profile)                |
 |   (data + job queue + RLS)        Haiku: sort/summarise. Sonnet: only if needed      |
 |                                                                                      |
 |   Amazon SES (digests, office emails)       AWS Budgets (alert at £50)               |
 +--------------------------------------------------------------------------------------+
          |
     Twilio: UK number per firm, WhatsApp templates, SMS fallback, voice (call-to-text)
     Stage 2: ElevenLabs agent on the same Twilio number (AI phone add-on)
```

## Tenancy

- Every request resolves a firm from the hostname: `firmslug.<our-domain>` or the firm's own
  custom domain (built in Phase 8: `app_resolve_firm_by_domain()`, only a verified one).
  `src/proxy.ts` rejects hosts we don't serve (404) without touching the database (a name that
  could be a firm's own domain goes through; the firm lookup decides); pages and actions call `getCurrentFirm()` for the
  firm itself (ADR-012). Slugs: 2-20 characters a-z, 0-9 and hyphens; `www`, `portal`, `api`,
  `app`, `admin` and punycode (`xn--`) are refused. Dev: `http://<slug>.localhost:3000`.
- **Three database roles** (ADR-011):
  - `shiftdesk_app` for the web and the worker's data access. No superuser, no BYPASSRLS, owns
    nothing, member of no role, no TRUNCATE, no temp tables.
  - `shiftdesk_jobs` for the worker's pg-boss connection only. It owns the `pgboss` schema.
  - The owner (Lightsail master user; locally the `shiftdesk_owner` role) runs migrations,
    `db:seed` and nothing else. The web and worker never hold its credentials.
- **The scoped client** (`withFirm(firmId, tx => ...)` in `src/lib/db/scoped.ts`) opens a
  transaction and runs `select set_config('app.current_firm_id', $1, true)`: `SET LOCAL` with a
  bound parameter, ended by COMMIT/ROLLBACK so a pooled connection never carries a firm into the
  next request. Nesting throws. The pool refuses to run as a superuser, a BYPASSRLS role or a
  table owner. ESLint blocks app code from importing the raw pool, the owner connection or `pg`.
- **RLS** is enabled and forced on every table, with one policy:
  `firm_id = (select app_current_firm_id())`, where `app_current_firm_id()` returns NULL when no
  firm is set, so a query outside `withFirm` sees nothing and can write nothing.
- **Before the firm is known** (host lookup), `resolveFirmBySlug()` calls `app_resolve_firm()`,
  a `SECURITY DEFINER` function with a pinned `search_path` that returns only directory fields
  (id, slug, name, timezone, sign-off). Only the app role may execute it.
- **Scheduled jobs that visit every firm** (the Sheets sync tick) list firms through
  `app_firm_ids()` (`listFirmIds()`), another `SECURITY DEFINER` function that returns ids only,
  then work inside each firm's own `withFirm` transaction.
- **Jobs** extend a zod envelope `{ firmId, idempotencyKey }` (`src/lib/jobs/firm-job.ts`); the
  worker runs each handler inside `withFirm(payload.firmId)`. The web queues a job inside its own
  `withFirm` transaction (`sendFirmJob`), taking `firmId` from that transaction. An RLS policy on
  `pgboss.job_common` rejects any job whose `firmId` isn't the current firm, so the web can't
  start work in another firm. That RLS is enabled but not forced and binds only the app role;
the jobs role owns the pgboss tables and isn't firm-restricted there, so payloads carry ids only.
- Tests (all as `shiftdesk_app`): every table's catalogue entry (`rls.every-table`), Firm A
  can't read, change, insert into or point at Firm B's rows with a control showing Firm B can
  (`tenancy.isolation`), the same probes catch a deliberately broken policy (`rls.mutation`),
  plus `scoped-client`, `directory`, `jobs.envelope` and `lint.db-boundary`.

## Login

**Workers (no passwords):**
1. Enter mobile number on the firm's portal.
2. If the number belongs to an active worker in this firm, send a one-time link by WhatsApp
   (template) or SMS. Same response either way, so numbers can't be probed.
3. Link token: random 32 bytes, stored as a hash, single use, 15-minute expiry. The token goes
   in the URL fragment (`/l#<token>`), never the path or query string: browsers don't send the
   fragment to the server, so it never reaches request logs, proxies or Referer headers.
4. Session cookie `__Host-sd_session`: httpOnly, Secure, SameSite=Lax, host-only (the `__Host-`
   prefix stops another firm's subdomain setting it). The session lasts 30 days from login; its
   token is replaced daily by a server action while the portal is in use, and the old token keeps
   working for 60 seconds. Every lookup checks the session kind and that the worker is still
   active. Only token hashes are stored. The link page asks "Log me in" (a POST), so link
   previews and email scanners can't use the link up.
5. Pay pages need a step-up code (`src/lib/auth/step-up.ts`): 6 digits by WhatsApp, 10 minutes,
   5 tries, one live code per session (asking again replaces it), 3 requests per worker per 15
   minutes and 10 a day. After a reload the page offers the code field while a sent code still
   works. Created inside the `send-login-code` job and stored as an HMAC bound to the session.
   Each try is taken by one conditional UPDATE (parallel guesses can't get more than 5), then
   compared in constant time. A correct code opens the pay pages for 30 minutes
   (`sessions.stepped_up_until`).
6. Rate limits (`src/lib/auth/throttle.ts`), in fixed 15-minute windows per firm: 10 link
   requests per IP (anything typed, junk included) and 3 per number; 20 failed link uses per IP
   (successful logins don't count). Checked IP first, stopping at the first refusal, so a refused
   IP can't use up a worker's allowance. Link requests are counted in their own transaction before
   the real work (a request that fails still counts), with one conditional upsert (parallel
   requests can't lose a count). Failed link uses are counted in the login's own transaction,
   after a check of the current count, so a burst can let a few extra through (a soft limit:
   it exists to stop guessing and log flooding). Buckets are HMACs (SESSION_SECRET) of the number or IP, never the value; IPv6 counts
   per /64. The IP is `X-Real-IP` only, which Caddy sets (Phase 8); without it all clients share
   one bucket. A refusal says "Too many tries. Try again in {n} minutes."; `auth.rate_limited` is
   logged once per window, when a limit is first reached. Known and unknown numbers are treated
   identically. Known trade-off: people behind one shared IP (venue Wi-Fi, mobile carrier NAT)
   share the per-IP request limit (docs/runbooks.md).

**Office users:** email magic link; roles `admin`, `resourcer`, `payroll`. Add TOTP later.
Same flow as workers (`src/lib/auth/office-login.ts`, shared parts in `link-login.ts`): work
email → the same answer whether or not it's known → `send-portal-link` emails a one-time link to
`/office/l#<token>` (15 minutes, single use, hashed) → a 30-day session in the `__Host-sd_office`
cookie (a worker and an office session can exist side by side; neither works as the other).
Limits: 3 links per address and 10 per IP every 15 minutes. Each office area lists the roles
that may use it (`src/lib/auth/roles.ts`); pages check with `requireOfficeArea()` and a role
without access gets the not-found page. Disabling an office user ends their sessions at their
next request.

## Roster plugs

The firm's rota can live in different places. The app talks to all of them the same way:

```ts
// src/lib/roster/plug.ts (one plug per firm)
interface RosterPlug {
  readonly source: "native" | "sheets" | "csv";
  readonly canWrite: boolean; // false: nothing changes, writes return needs_approval, office taps approve
  listStaff(): Promise<RosterStaff[]>;                    // keyed by ref, the source's own key
  getShifts(from: Date, to: Date): Promise<RosterShift[]>; // starting in [from, to), every status, with slot holders
  assign(shiftId: string, workerId: string, pass: EligibilityPass): Promise<AssignResult>;
  //   assigned {assignmentId, slot} | filled | already_assigned | not_open | not_found | needs_approval
  //   throws unless pass is an unused EligibilityPass for exactly this worker and shift
  markCancelled(shiftId: string, workerId: string,
    cancel: { reason: string; by: "worker" | "firm"; at: Date }): // at: when the person asked
    Promise<CancelResult>; // cancelled {assignmentId, noticeHours} | not_assigned | not_found | needs_approval
}
```

Reads return records keyed by `ref` (our id for native, the sheet or file's row key otherwise,
stored as `shifts.external_ref`); writes take our ids, and each adapter maps between them.
Adapters reading an outside source (Sheets, CSV) check its data with the zod schemas in `plug.ts`
(`rosterStaffSchema`, `rosterShiftSchema`); the native adapter maps our own rows, whose CHECKs
already hold. Every adapter computes notice with `noticeHours()` (`src/lib/roster/notice.ts`) from
`cancel.at`, never from when the call runs (a retried job must not shrink a worker's notice). A
plug records; it never decides eligibility (the rules engine does, before `assign`, whose
`EligibilityPass` it demands and uses up). Adapters that
write our tables are built on the caller's `withFirm` transaction, and the caller writes the
`events` row from the result in that same transaction. On `needs_approval` nothing is recorded;
the caller keeps the pending change for the office. Every adapter must pass the shared contract
suite, `describeRosterContract()` in `tests/helpers/roster-contract.ts`: first yes wins, slot
order, cancel and reopen, the stored cancellation evidence (who, why, notice hours), read-only
behaviour, the `[from, to)` window, and another firm's rows out of reach.

| Adapter | When | Notes |
|---|---|---|
| Native | Firm has no rota system, or wants ours | Our tables are the source of truth. `nativeRosterPlug(tx, { clock })` in `src/lib/roster/native.ts`, on the caller's `withFirm` transaction. `assign` locks the shift row, creates any missing open slot rows up to the headcount, then does the one conditional update; the shift becomes `filled` with its last slot and `open` again on a cancel. |
| Google Sheets | Most target firms | Firm shares the sheet with our service account. Column mapping per firm, by header text (`roster_sources.mapping`, `src/lib/roster/sheets/mapping.ts`): a staff tab with a staff id column, a shifts tab with a shift id column and an "Assigned" column listing staff ids in slot order. Sync every minute on event days, every 15 minutes otherwise. One batch read and at most one batch write per sync. Never read the sheet per request (Google rate limits): the portal uses `sheetsRosterPlug`, our mirror of the sheet, and only the sync job touches Google. |
| CSV/Excel | Onboarding and firms emailing spreadsheets | Import workers, credentials, shifts and pay records (the `pay` kind: staff ID or mobile, period start and end, hours, rate, gross, pay date; one line per worker, period and rate, re-imports update). `src/lib/imports/`: `readTable()` reads a .csv (commas, semicolons or tabs) or .xlsx (our own small reader on Node's zlib: first sheet, Excel dates, size and zip-bomb limits; old .xls refused); `runImport()` finds columns by header name (with common aliases), checks every row, then creates or updates inside the firm's `withFirm` transaction, logging each change with the office user. Workers go through the same `upsertWorker()` as the Sheets sync. Bad rows are skipped and reported by row number and code. A dry run does the same work and rolls back. Until the office screen (Phase 5): `npm run import`. |
| Approve-only | Any system we can read but not write | We prepare the change; office applies it with one tap. |

Firms already on Deputy or Parim are not targets, so no plugs for them are planned.

**Booking** (`src/lib/roster/book.ts`): every "yes" goes through `bookShift()` (people) or
`checkBooking()` (the Sheets sync). Inside one transaction: lock the shift, then the worker (so two
tabs can't both pass the overlap, rest or weekly-hours checks), then, only for a booking relying on
the "applied" allowance, the firm's day; build the rules input from the current rows
(`loadEligibilityInput()` in `eligibility-input.ts`); run the rules (a refusal is logged
`shift.booking_refused` with the codes); **re-check the live source**; then the plug's one
conditional update and the `shift.assigned` event. Only `book.ts` and the sync may run the rules
for a booking or call a plug's `assign` (`tests/unit/booking.boundary.test.ts`). The live source is our tables for native and imported shifts (the lock and
the conditional update work on them directly). For a shift from a Google Sheet it's the sheet,
which is never read per request (ADR-013): the booking is confirmed only if our copy of the sheet
synced successfully in the last 20 minutes, else `source_stale` (ADR-014). A deadlock (possible
only against the Sheets sync, whose long transaction takes worker locks before later shift locks)
retries the whole booking, twice at most; the sync retries its own database step the same way. A worker books only themselves;
the office (active admins and resourcers) may override checks 0 and 6-8 with a reason.

**The Sheets sync** (`src/lib/roster/sheets/sync.ts`, run by the `sheets-sync` job): claim the
firm's sync lease; read the sheet once; in one transaction mirror staff (by staff id; a worker
with the same mobile and no staff id is linked) and shifts (by shift id), then merge who holds each
shift three ways: the sheet now, our bookings now, and what the sheet held after the last sync
(`shifts.synced_holders`). A name removed on either side is removed; a booking made here is always
kept (the worker was told it's confirmed); a name added in the sheet is booked while places
remain, and any left over is logged as a conflict for the office. The office's changes in the sheet
are applied through the roster plug and logged like any firm change (golden rule 12): a removed
name is a cancellation by the firm with notice hours, a "Cancelled" status cancels each booking,
new times are logged per booked worker as moved or curtailed, and new shifts, changed fields and
status changes each get an event. Shifts that have started are mirrored but their bookings are
history: never booked, cancelled or re-timed by a sync (so a first sync books no old names). The
merge base becomes the "Assigned" cell as read. Then one batch write puts our bookings back into
every cell that differs, after re-reading (one request) each target row's id and "Assigned" cells:
a row that moved or a cell the office edited meanwhile is left for the next sync. Each written cell
becomes the new base. A failed or skipped write loses nothing: the next sync pushes the same
bookings and still sees any newer office edit. Draft rows' names are left alone. Bad rows are
skipped and reported by row number and a code, never their contents. Staff changes are logged by
field name; a worker blocked here stays blocked whatever the sheet says, and a changed mobile
revokes the worker's sessions and unused login links (login goes by mobile). The sync's lease on
`roster_sources` fences every later write, so an overrunning sync can't clobber the next one.
A name the office puts in its sheet is booked through `checkBooking()` with the office's overrides
(rest, weekly hours, availability; started shifts are never booked by a sync), logged with the
reason "Put on the rota sheet by the office" and the notice hours: a name that fails
anything else (credentials, role, account, a double booking, a blocked site; golden rule 6) isn't
booked, is logged `roster.sheet_booking_refused` with the reason codes, and, like a name added to a
full shift, drops out of the sheet at the next write. **Not live yet:** `SHEETS_TRANSPORT` accepts
only `none` until the real service account is connected (parked).

## Rules engine

Pure functions in `src/lib/rules/` (`checkEligibility()`). Input: worker, their credentials, the
shift (with its role's required credential types), the worker's other assignments, unavailable
dates, firm settings, `now` and the firm's time zone. Output: `{ ok, reasons, codes, overridden }`
plus an `EligibilityPass` when ok (only this function makes one; `isEligibilityPass()` checks).
Full table of checks and test cases: `docs/rules-and-credentials.md`.

Checks, in order (all failures are reported):
0. The shift hasn't started (the office may override for a late replacement).
1. The worker's account is active.
2. Qualification/role match.
3. Every credential the role needs is present, valid and in date for every day the shift touches;
   a suspended one always fails; no rule for the role fails.
4. Firm "applied/in progress" allowance (e.g. SIA ACS firms may deploy a capped share of staff
   whose licence is in progress — cap is a firm setting; confirm current SIA rules).
5. No overlapping assignment (including travel buffer if set).
6. Minimum rest between shifts (office may override).
7. Weekly hours cap, in every Monday-Sunday week the shift touches (office may override).
8. Not marked unavailable (office may override).
9. Worker not blocked for this site/client.

Credential rules are data (`credential_rules` table) per sector and role:

| Sector | Examples |
|---|---|
| Security / events | SIA door supervisor, SIA security guard, steward qualification |
| Rail | PTS (Personal Track Safety), Sentinel card, drugs and alcohol test in date |
| Construction / civils | CSCS card (type), specific tickets |
| Cleaning | DBS where the site requires it |

Reasons are shown to workers in plain English ("Your SIA licence expired on 3 Oct. Renew it,
then send the new number to the office").

## Key flows

**Take an open shift**
1. Worker opens Open shifts → only eligible shifts listed (rules engine).
2. Tap "Take shift" → `bookShift()`: lock the shift and the worker → re-check the rules on the
   current rows → the firm's allocation mode (fair rotation may hold a new place a few minutes for
   the workers with the fewest hours that week) → re-check the live source → `UPDATE assignments ... WHERE shift slot is unfilled`
   (one statement).
3. 1 row changed: confirm + event. 0 rows: "Just filled — here are similar shifts."

**Cancel**
1. Worker taps Cancel → reason → confirm.
2. `cancelBooking()` (`src/lib/roster/cancel.ts`, the one path for people; the office uses it too,
   golden rule 12): the plug stores `cancelled_at`, the reason, who cancelled and
   `notice_hours = starts_at - cancelled_at` on the row, frees the place, and the `shift.cancelled`
   event is written in the same transaction. Always recorded. The reason is typed by a person, so it
   stays on the row (which can be corrected or anonymised) and never goes into the append-only
   event. A worker can't cancel a shift that has started; the office can until it ends (negative
   notice; the place isn't reopened). No fresh sheet copy is needed.
3. If the cancellation reopened a place and the shift starts within the firm's
   `urgent_window_hours` (default 24): the shift is marked urgent in the same transaction and
   logged (`shift.marked_urgent`, by the system, cause "dropout"; `markUrgentAfterDropout()` in
   `src/lib/roster/urgent.ts`, window rule in `src/lib/rules/urgent.ts`). The same happens when the
   office removes a name from its Google Sheet close to the start. Then offer waves start (next
   Phase 4 task).

Every booking and every cancellation, by every path (portal, office, the Sheets sync), writes one
event with its notice hours (`tests/integration/notice-log.test.ts`), and only `cancel.ts` and the
sync may call a plug's `markCancelled` (`tests/unit/booking.boundary.test.ts`).

**Offer waves (pg-boss)** (built in Phase 4: `src/lib/offers/waves.ts`; details in
docs/api-and-jobs.md, `offer-wave` and `escalate-shift`)
1. Rank eligible workers (fair rotation: fewest hours this week first; or first come first served).
2. Send wave 1 (3–5 people): web push + WhatsApp template ("Shift available: Sat 14:00 Gate C.
   Tap to take it"). Link opens the shift.
3. Schedule `offer-wave` job for +15 min. If still open, next wave.
4. Schedule `escalate` at start minus X hours: alert resourcer if unfilled.
5. When filled, cancel remaining jobs and tell open offers "now filled".
Each wave claims one worker at a time (the shift locked for milliseconds), then sends with no
transaction open, then records: a booking never waits for a wave's messages, and a retry never
messages anyone twice (the reminders' claim → send → record).

**Pay query**
1. Worker (after OTP) fills a structured form.
2. Code assigns grouping keys: the issue and the week, plus the pay line's rate for a wrong
   rate or the site for missing hours (`src/lib/pay/grouping.ts`). Haiku writes a one-line
   summary per group from the group's facts only, checked before use, with the app's own line as
   the fallback and always shown as the heading (Bedrock not connected yet). The app stops waiting
   after 5 seconds a group; a failed, late or unusable answer changes nothing else.
3. Digest to payroll at a set time (built: `src/lib/pay/digest.ts`, the firm's `pay_digest`
   setting, default 09:00 Monday to Friday): the new queries, grouped, emailed to payroll with the
   list attached (names and workers' words only in the attachment), marked `in_digest`. Payroll can
   also send it at once from its page.
4. Payroll marks a group sorted with a note (built: `src/lib/pay/resolve.ts`); each worker gets it
   by message (`pay_query_update`, quiet hours respected) and sees "Sorted on {day}" with the note on
   their pay page. The note is always a person's words: no AI answers a pay dispute. A test
   (`tests/unit/ai.boundary.test.ts`) keeps AI code out of the code that builds what workers see or
   receive and out of payroll's sorting path, and pins which files may use the AI modules.

**WhatsApp shifts line**
0. Each firm has its own number (`firms.shifts_line_e164`, one number per firm; built in Phase 7
   short of Twilio). Its WhatsApps and texts go from it (`from` on each message: every sender
   passes it, held by `tests/unit/notify.from-line.test.ts`), and an incoming message finds its
   firm from the number it was sent to (`resolveFirmByLine()`, `app_firm_by_line()`). The number is
   bought in Twilio and set with `npm run firm:line` (PLAN.md Parking lot, "Connect Twilio").
1. Twilio webhook → verify signature → store message (idempotent) → queue job → 200. (Built for
   WhatsApp and SMS in Phase 7: `src/lib/inbound/webhook.ts`. A text that is only STOP or START
   turns that worker's texts off or on, `src/lib/inbound/opt-out.ts`; no sender texts them while
   off.)
2. Known worker: keyword match (shifts, cancel, pay, help) → instant reply with the right link.
   Unclear text → Haiku classifies → reply with link or create a request for the office. (Built in
   Phase 7, `src/lib/inbound/reply.ts`, short of Bedrock: the AI only picks one of four labels and
   the reply is always the app's fixed text; no AI yet, so unclear text goes to the office.)
3. Unknown number → polite reply + office alert. (Built in Phase 7: the first message from a
   number in 24 hours gets `unknown_number` and emails the office's admins and resourcers, without
   the number or the message; a former worker gets no reply, the office is alerted; every such
   message is on Today.)

**Call-to-text**
1. Twilio voice webhook returns a short recorded message.
2. Immediately send WhatsApp (or SMS) with the portal link.
3. Optional voicemail → transcription → request for the office.
(Built in Phase 7 short of Twilio: `src/lib/inbound/voice.ts`. The message is spoken by Twilio's
text-to-speech from `callGreeting()`, not a recording. The link is the login page's own request, so
only a worker's number gets one and the caller hears the same either way; a withheld number is
told we can't send one. The voicemail's text goes through the `inbound-message` job: a worker's
becomes a request for the office, answered by the channel they chose; a caller we don't know is
on Today and the office is alerted, with no message to them.)
4. Twilio fallback URL forwards calls to the manager's mobile if our app is down. (Made in Phase 8,
   not set yet: `npm run firm:call-fallback` prints the TwiML for a firm's bin, `callFallbackTwiml()`:
   why, then the manager's phone for up to 30 seconds (their voicemail usually answers first), then
   a closing line true however that call went; Twilio serves it itself. Messages aren't covered:
   WhatsApps and texts reach the same app.)

## Notifications

Order: web push (free) → WhatsApp template → SMS fallback.
- Web push works on Android browsers. On iPhone it only works when the portal is added to the
  home screen, so prompt for it after first login. Built in Phase 3: My shifts and Profile show
  iPhone and iPad users "Put your shifts on your home screen" (`src/app/home-screen-hint.tsx`)
  until they tap "Don't show again". A per-firm web app manifest (`src/app/manifest.ts`) names
  the portal "{Firm} shifts" on the home screen.
- Offline: a service worker (`public/sw.js`, ADR-016) keeps the last copy of My shifts, so it
  opens without signal, marked "No signal. These are your shifts from {time}".
- Web push (Phase 4, built short of real sends): the profile subscribes this phone
  (`POST /api/push/subscribe`, `push_subscriptions`); offer waves push each urgent offer to the
  worker's phones as well as WhatsApp/SMS; the same service worker shows the notification and
  opens the shift (our own pages only). The sender is a console transport: the real one (VAPID
  keys, the `web-push` library, Google/Apple push services) is parked.
- WhatsApp: business-initiated messages must use approved templates (utility category for
  offers and login links). From 1 October 2026 Meta charges per service message beyond the
  free tier of 1,000 per number per month, and a payment method must be on file.
- SMS costs about 4p per message in the UK via Twilio. Use it only as a fallback.
- Quiet hours per firm (urgent offers can override if the firm allows).
- Shift reminders (Phase 4, ADR-017): a tick every 5 minutes finds bookings with a 24 h or 2 h
  reminder due and queues one job per firm. Each reminder is claimed in `shift_reminders` and
  committed before it's sent (outside any transaction), then its outcome recorded: a retry never
  sends it again, and a job that stops part-way leaves it `sending` ("may have gone"). Offers and
  reminders send through one helper (`src/lib/notify/send.ts`: the worker's channel, the
  WhatsApp-to-text fallback, the push).

## Where AI is used

| Use | Model | Pilot? |
|---|---|---|
| Classify unclear WhatsApp text | Haiku | Yes |
| One-line summaries for pay query groups | Haiku | Yes |
| Classify and draft email replies (approve mode) | Haiku, Sonnet for hard cases | Stage 2 |
| AI phone agent | ElevenLabs (existing agent) | Stage 2 add-on |

- All model calls go through `src/lib/ai/` with zod-validated JSON outputs and a fallback
  ("send to office") when validation fails or confidence is low.
- Bedrock EU inference profile keeps processing in EU/UK regions. Anthropic's direct API has no
  EU option, so we use Bedrock.
- Cache system prompts (prompt caching) to cut cost.
- AI never decides eligibility, assignment or pay.

## Custom domains and branding

- Firm adds `CNAME shifts.firmname.co.uk -> portal.<our-domain>`. (As built in Phase 8: to the firm's
  own subdomain, `<slug>.<our-domain>`, so the domain is tied to that firm when it's verified.)
- Caddy uses on-demand TLS and calls our `ask` endpoint, which only returns OK for domains in
  `firms.custom_domain` with `domain_verified = true`. This stops abuse. (Built in Phase 8, short of
  running Caddy: `deploy/Caddyfile` gets our own domain's certificate the ordinary way and every
  other name on demand after asking `GET /api/caddy/ask`, which also approves `<slug>.<our-domain>`
  for firms that exist, so no wildcard certificate (and no DNS provider API) is needed. Requests reach
  the web app with their real Host and an `X-Real-IP` Caddy sets itself. The owner saves and
  verifies a firm's domain with `npm run firm:domain` (its CNAME must point to
  `<slug>.<our-domain>`); only then is it served (`firmForHost()`) or approved. Links in messages
  still use `<slug>.<our-domain>`: parked.)
- Branding per firm: name, logo, primary colour, sign-off "[Firm] Shift Team". (Built in Phase 8:
  every firm page, portal and office, opens with the firm's bar (`src/app/brand-bar.tsx`, from the
  root layout): its logo, if set, and its name, on its colour, with black or white text, whichever
  contrasts more (at least 4.5:1 for any colour). Read from the firm's own row for the request's
  host (`src/lib/tenancy/brand.ts`); the logo is an https:// address on the firm's site, shown
  with no referrer; values are checked again before they reach a page and only ever reach it as
  an `<img>` address or a React style colour. The home-screen theme colour follows it. Set by the
  owner: `npm run firm:brand` (name, colour, logo, sign-off), logged `firm.branding_changed`. The
  office settings screen can offer it later: PLAN.md Parking lot.)
- Office emails can later be sent from the firm's domain via SES (they add DKIM records).

## Deployment

- Lightsail instance: 2 vCPU, 4 GB, London, static IP (~$24/month).
- Lightsail managed Postgres (~$15/month), automatic backups, not public.
  (Written in Phase 8, not run yet: `deploy/lightsail.sh` creates both with the AWS CLI, pinned to
  eu-west-2: Ubuntu 24.04 on the active 4 GB bundle with `deploy/cloud-init.sh` (automatic security
  updates, Docker from Docker's repository, a root-only `/opt/shiftdesk`), a static IP, a firewall
  with only 80 and 443 open to the internet (SSH only from Lightsail's browser console), and
  Postgres 16 not publicly accessible with nightly backups and an AWS-generated owner password.
  Steps: docs/runbooks.md "Set up AWS (once)".)
- Docker Compose: `web`, `worker`, `caddy`. Deploy via GitHub Actions (SSH, pull, up -d). (As
  built in Phase 8, short of a server: deploys pull. `.github/workflows/deploy.yml` builds the
  image (`Dockerfile`: one image, non-root, no secrets) after CI passes on `main` and pushes it to
  GitHub's registry; `deploy/deploy.sh`, every 2 minutes on the server (a systemd timer), pulls a
  new image, runs the one-off `migrate` step, then `up -d`, never between 05:30 and 09:00 UK.
  `deploy/docker-compose.yml`: only Caddy published (80/443), each service given only the secrets
  it needs (the owner's login only to `migrate`), everything `restart: unless-stopped`, the web
  app's health check `GET /api/health`, the worker behind a profile until the Twilio sender exists.
  Only a push to this repository's `main` that passed CI publishes `:main`, and only while it's the
  tip. SSH stays closed.)
- Secrets in a root-only `.env` on the server; move to AWS Secrets Manager later.
- IAM user for the app with only: `bedrock:InvokeModel`, `ses:SendEmail` (+ S3 read in Stage 2).
- Unattended security updates; snapshot before schema changes; test a restore monthly.
  (Written in Phase 8, not run: `deploy/restore-drill.sh` restores the latest backup to a separate
  private database and deletes only that; `deploy/alarms.sh` sets Lightsail's email alarms for the
  server being down, CPU and database storage; plus a free outside uptime check on `/api/health`.
  docs/runbooks.md "Restore drill (monthly)", "Monitoring and alerts (once)".)
- AWS Budget alert at £50.

## Reliability

| Risk | Fix |
|---|---|
| Same webhook twice | Unique `provider_message_id`; `INSERT ... ON CONFLICT DO NOTHING`. |
| Two people take the same shift | Single conditional UPDATE; loser sees "just filled". |
| Stale rota copy | Rules re-run on the current rows inside the booking transaction; a Sheets shift is confirmed only against a copy synced in the last 20 minutes. |
| Server restart mid-wave | pg-boss jobs are stored in Postgres and resume. |
| App down on an event morning | Twilio fallback forwards calls to the manager; status alert to you. |
| AI returns junk | zod validation; fallback to office queue. |

## Security checklist

- HTTPS everywhere; HSTS.
- Verify Twilio signatures on every webhook.
- Rate limit login and OTP.
- No personal data in logs (mask phone numbers).
- Least-privilege IAM; MFA on all accounts.
- Dependency updates weekly; `npm audit` in CI.
