# Architecture

One Next.js app and one background worker, from the same codebase, running in Docker Compose on a
single server at a UK or EU Docker host (chosen later), with the host's managed Postgres 16
database (or, if the host has none, Postgres in Compose). Every firm's data is in the same
database, separated by `firm_id` and Row Level Security. Email goes out over SMTP through any
provider. AI is Claude through the Anthropic API, off until it's switched on. No AWS (ADR-021).

Scale is small (tens to a couple of hundred messages per firm per day, spiking on event
mornings). Reliability matters far more than scale.

## Diagram

```
 Casual workers (phone browser)     WhatsApp / SMS / calls        Firm's Google Sheet
          |                                  |                           |
          | HTTPS (firm domain)              | webhooks                  | sync job (1–2 min)
          v                                  v                           v
 +----------------------- A UK or EU Docker host (chosen later) ------------------------+
 |  Server (Docker Compose)                                                             |
 |   caddy   -> HTTPS for our domain + firm custom domains (on-demand TLS, "ask" check) |
 |   web     -> Next.js: staff portal, office dashboard, /api/webhooks/*                |
 |   worker  -> pg-boss jobs: offer waves, escalations, syncs, digests, AI calls        |
 |                 |                        |                                           |
 |                 v                        v                                           |
 |   The host's managed Postgres 16    Out of the host (listed below):                  |
 |   (data + job queue + RLS),         the Anthropic API and the email provider         |
 |   TLS checked against the host's CA file at /app/db-ca.pem.                          |
 |   If the host has none: Postgres 16 in Compose, over a Unix socket.                  |
 |                                                                                      |
 |   The host's own alerts and its billing alert (£50)                                  |
 +--------------------------------------------------------------------------------------+
          |
     Twilio: UK number per firm, WhatsApp templates, SMS fallback, voice (call-to-text)
     Anthropic API: Claude, off unless AI_TRANSPORT=anthropic. Haiku: sort/summarise.
       Sonnet: only if needed
     Email: any provider over SMTP (digests, office emails); console in dev and tests
     An outside uptime check on /api/health
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
  - The owner (in production the host's managed-Postgres admin user, not a superuser either;
    locally the `shiftdesk_owner` role) runs migrations, `db:seed` and nothing else. The web and
    worker never hold its credentials.
- **The scoped client** (`withFirm(firmId, tx => ...)` in `src/lib/db/scoped.ts`) opens a
  transaction and runs `select set_config('app.current_firm_id', $1, true)`: `SET LOCAL` with a
  bound parameter, ended by COMMIT/ROLLBACK so a pooled connection never carries a firm into the
  next request. Nesting throws. The pool refuses to run as a superuser, a BYPASSRLS role or a
  table owner. ESLint blocks app code from importing the raw pool, the owner connection or `pg`.
- **Time limits per transaction** (P4.2, ADR-027): the same statement sets `statement_timeout` and
  `idle_in_transaction_session_timeout`, so they end with the transaction too. Each process has a
  profile (`src/lib/db/pool.ts`): the web app a pool of 10, a 5 s wait for a connection, 15 s
  statements and 30 s idle; the worker (`chooseDbProfile("worker")`) a pool of 15, 30 s, 60 s and
  60 s. The credential scan's lock holder, the firm's data export, the retention purge and the
  metrics roll-up take longer ones with `allowLonger()`.
- **RLS** is enabled and forced on every table, with one policy:
  `firm_id = (select app_current_firm_id())`, where `app_current_firm_id()` returns NULL when no
  firm is set, so a query outside `withFirm` sees nothing and can write nothing.
- **Before the firm is known** (host lookup), `resolveFirmBySlug()` calls `app_resolve_firm()`,
  a `SECURITY DEFINER` function with a pinned `search_path` that returns only directory fields
  (id, slug, name, timezone, sign-off). Only the app role may execute it. Two more look-ups work
  the same way: an incoming message's number (`resolveFirmByLine()`, `app_firm_by_line()`, the
  same directory fields) and a planner's API key (`resolveApiKey()`, `app_api_key_lookup()`, 12J.1,
  ADR-022): given the sha256 of the key, it returns only the firm id and key id of a key that isn't
  revoked, and a hash of any other length never reaches the database. The API's work then runs in
  `withFirm()` for that firm: on `/api/v1` the key, never the host, path or body, decides the firm.
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
  plus `scoped-client`, `directory`, `api.keys`, `jobs.envelope` and `lint.db-boundary`.

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
6. Rate limits (`src/lib/auth/throttle.ts`), in fixed 15-minute windows per firm: 60 link
   requests per IP (anything typed, junk included; raised from 10 in 13.5 so a team briefed on one
   venue's Wi-Fi isn't locked out; the backstop is an ops alert when a firm sends more than 100
   login links by WhatsApp and text in an hour, or 300 in a day, 14.2) and 3 per number, plus at most 10 per number
   a day (Phase 10, audit L49: each link is a billed message); 20 failed link uses per IP
   (successful logins don't count; the strikes team's confirmation links count here too, 12B.7).
   Those confirmation links are emails too: a firm sends at most 3 every 15 minutes and 10 a day
   (`STRIKES_LINK_LIMITS`, `src/lib/office/strikes-email.ts`). Checked IP first, stopping at the first refusal, so a refused
   IP can't use up a worker's allowance. Link requests are counted in their own transaction before
   the real work (a request that fails still counts), with one conditional upsert (parallel
   requests can't lose a count). Failed link uses are counted in the login's own transaction,
   after a check of the current count, so a burst can let a few extra through (a soft limit:
   it exists to stop guessing and log flooding). Buckets are HMACs (SESSION_SECRET) of the number or IP, never the value; IPv6 counts
   per /64. The IP is `X-Real-IP` only, which Caddy sets (Phase 8); without it all clients share
   one bucket. A refusal says "Too many tries. Try again in {n} minutes."; `auth.rate_limited` is
   logged once per window, when a limit is first reached. Known and unknown numbers are treated
   identically. Known trade-off: people behind one shared IP (venue Wi-Fi, mobile carrier NAT)
   share the per-IP request limit (docs/runbooks.md); at 60 it covers a briefing of about 50, and
   one address can then cost the firm up to 240 link messages an hour (the per-number limits stop
   any one number being flooded).

**Office users:** email magic link; roles `admin`, `resourcer`, `payroll`. Add TOTP later.
Same flow as workers (`src/lib/auth/office-login.ts`, shared parts in `link-login.ts`): work
email → the same answer whether or not it's known → `send-portal-link` emails a one-time link to
`/office/l#<token>` (15 minutes, single use, hashed) → a 30-day session in the `__Host-sd_office`
cookie (a worker and an office session can exist side by side; neither works as the other).
Limits: 3 links per address and 10 per IP every 15 minutes, and 10 per address a day. Each office area lists the roles
that may use it (`src/lib/auth/roles.ts`); pages check with `requireOfficeArea()` and a role
without access gets the not-found page. An admin can turn someone's office access off or back on,
change their role, or log them out on every device (the office team page, or `firm:office-user`;
`src/lib/office/team.ts`): turning access off ends their sessions and unused login links at once,
turning it back on revives nothing (they log in afresh), and a role is read again at their next
request. A worker whose mobile or status changes is likewise logged out everywhere. Every change is
logged, and the firm always keeps an active admin.

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
| Google Sheets | Most target firms | Firm shares the sheet with our service account. Column mapping per firm, by header text (`roster_sources.mapping`, `src/lib/roster/sheets/mapping.ts`): a staff tab with a staff id column, a shifts tab with a shift id column and an "Assigned" column listing staff ids in slot order. Sync every minute on event days, every 15 minutes otherwise. One read of the sheet's locale, one batch read and at most one batch write per sync (plus a re-read of two columns before writing). Never read the sheet per request (Google rate limits): the portal uses `sheetsRosterPlug`, our mirror of the sheet, and only the sync job touches Google. |
| CSV/Excel | Onboarding and firms emailing spreadsheets | Import workers, credentials, shifts and pay records (the `pay` kind: staff ID or mobile, period start and end, hours, rate, gross, pay date; one line per worker, period and rate, re-imports update). `src/lib/imports/`: `readTable()` reads a .csv (commas, semicolons or tabs; UTF-8, or Windows-1252 as Excel on Windows writes it) or .xlsx (our own small reader on Node's zlib: first sheet, Excel dates, whose day a time near midnight never moves, size and zip-bomb limits; old .xls refused); `runImport()` finds columns by header name (with common aliases), checks every row, then creates or updates inside the firm's `withFirm` transaction, logging each change with the office user. Workers go through the same `upsertWorker()` as the Sheets sync: a match by mobile alone must have the worker's name too, or the row is refused (`name_mismatch`), so a mistyped or recycled number never renames someone (Phase 10, audit L71, L78). Dates, times and mobiles are read by the same functions as the Sheets sync and the office's editor (`parseSheetDate`, `shiftWindow()` in `src/lib/roster/shift-window.ts`, `spreadsheetMobile`). A re-import never reopens a shift the office marked filled; one it does reopen is logged `shift.reopened`. On a live database, saving needs the firm's signing recorded (Gate B, `src/lib/imports/gate-b.ts`). Bad rows are skipped and reported by row number and code. A dry run does the same work and rolls back. Until the office screen (Phase 5): `npm run import`. |
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
with the same mobile and no staff id is linked if the name is the same, never renamed into someone
else; a staff id whose name and mobile both change is refused; both counted in `roster.synced`'s
words for the office) and shifts (by shift id), then merge who holds each
shift three ways: the sheet now, our bookings now, and what the sheet held after the last sync
(`shifts.synced_holders`). A name removed on either side is removed; a booking made here is always
kept (the worker was told it's confirmed); a name added in the sheet goes through the rules first
and is booked while places remain (a refused name doesn't use up a place). The office's changes in
the sheet are applied through the roster plug and logged like any firm change (golden rule 12): a
removed name is a cancellation by the firm with notice hours, a "Cancelled" status cancels each
booking, new times or a new site are logged per booked worker as moved or curtailed, and new
shifts, changed fields and status changes each get an event. The office editor's rules hold for
the sheet too (Phase 10): a new role, times or site on a booked shift is made only if everyone
booked can still work it (`recheckHolders()`, the same check as the office's move, with the
sheet's overrides), otherwise our copy keeps them. Shifts that have started are history: never
booked, cancelled, re-timed, re-roled or moved by a sync (so a first sync books no old names). What
the sheet asks for and didn't get is kept on the shift (`shifts.sheet_issues`) and shown on the
office dashboard's Needs attention ("From your rota sheet"); a refused change is logged once
(`roster.sheet_change_refused`). Names the sync couldn't book stay in the sheet's cell while there
is room, and each sync tries them again; only a name with no room left is taken out (on the dashboard and
in the log). The merge base becomes the "Assigned" cell as read, less those names. Then one batch write puts our bookings back into
every cell that differs, after re-reading (one request) each target row's id and "Assigned" cells:
a row that moved or a cell the office edited meanwhile is left for the next sync. Each written cell
becomes the new base. A failed or skipped write loses nothing: the next sync pushes the same
bookings and still sees any newer office edit. Draft rows' names are left alone. Bad rows are
skipped and reported by row number and a code, never their contents. Staff changes are logged by
field name; a worker blocked here stays blocked whatever the sheet says, and a changed mobile
or status revokes the worker's sessions and unused login links (login goes by mobile; made active
again, nothing old comes back). The sync's lease on
`roster_sources` fences every later write, so an overrunning sync can't clobber the next one.
A name the office puts in its sheet is booked through `checkBooking()` with the office's overrides
(rest, weekly hours, availability; started shifts are never booked by a sync), logged with the
reason "Put on the rota sheet by the office" and the notice hours: a name that fails
anything else (credentials, role, account, a double booking, a blocked site; golden rule 6) isn't
booked, is logged `roster.sheet_booking_refused` with the reason codes, and, like a name added to a
full shift, drops out of the sheet at the next write.

**A sheet is bound to its firm** (Phase 10, audit L45). Every firm shares its sheet with the same
service account, so the spreadsheet id is all that ties a sheet to a firm. Only the owner connects,
replaces or switches off a firm's sheet (`npm run firm:sheet`, logged `roster.source_connected` /
`roster.source_disabled`); the app role can't add a source or change its sheet or mapping, only the
sync's four status columns (a column-level grant, `COLUMN_UPDATES` in `src/lib/db/admin/access.ts`);
and a unique index on `roster_sources.spreadsheet_id` (across firms: RLS can't see them, an index
can) lets one spreadsheet belong to one firm only. An office settings form for the sheet would need
proof that the firm owns it first (parked).

**Only a United Kingdom sheet is read** (audit M17). Cells are read as the sheet shows them
(`FORMATTED_VALUE`), and a date as day/month/year. A sheet in another locale shows dates the other
way round ("6/12/2027" is 12 June in a US sheet), so each sync first reads the spreadsheet's locale
(one small request) and, unless it's `en_GB`, fails with `sheet_locale_not_uk` without reading or
writing anything; the office's action log says how to fix it (File → Settings → Locale). Not read as
serial numbers: unformatted values would also turn a number-formatted staff id ("000123") or mobile
into a bare number.

**Switched on by** `SHEETS_TRANSPORT=google` and `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` in the worker's
environment (`src/lib/roster/sheets/transport.ts`); `none` (the default) schedules no sync. Off until
a Google account exists: the steps are "Connect the real Google Sheets" in the `PLAN.md` Parking lot.

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
3. Every credential the role needs, and every extra requirement of the session (12B.3), is
   present, valid and in date for every day the shift touches; a suspended one always fails; no
   rule for the role fails.
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
2. Tap "Take shift" → counted against the worker's limit first (20 taps every 15 minutes, booked
   or not: `LIMITS.takePerWorker`, 13.5; over it, "Too many tries. Try again in {n} minutes." and
   nothing else happens) → `bookShift()`: lock the shift and the worker → re-check the rules on the
   current rows → the firm's allocation mode (fair rotation may hold a new place a few minutes for
   the workers with the fewest hours that week) → re-check the live source → `UPDATE assignments ... WHERE shift slot is unfilled`
   (one statement).
3. 1 row changed: confirm + event. 0 rows: "Just filled — here are similar shifts."

**Cancel**
1. Worker taps Cancel → the strike warning (`strikeDecision()`, 12C.1: worked out when the step
   opens) → reason → confirm (sending which warning they saw: if the decision has changed since,
   nothing is cancelled and the new warning is shown).
2. `cancelBooking()` (`src/lib/roster/cancel.ts`, the one path for people; the office uses it too,
   golden rule 12): the plug stores `cancelled_at`, the reason, who cancelled and
   `notice_hours = starts_at - cancelled_at` on the row, frees the place, and the `shift.cancelled`
   event is written in the same transaction. Always recorded. The reason is typed by a person, so it
   stays on the row (which can be corrected or anonymised) and never goes into the append-only
   event. A worker can't cancel a shift that has started; the office can until it ends (negative
   notice; the place isn't reopened). No fresh sheet copy is needed. In the same transaction the
   strike decision runs (`src/lib/strikes/decide.ts`; its code goes in `shift.cancelled`): the
   office's cancellation is never a strike; a casual's own is one only with less notice than the
   firm's `strikes.notice_hours` (48), on a booking they made themselves that the office hasn't
   moved or re-priced since, and then a `strikes` row and `strike.issued` are added, and its
   evidence email to the strikes team is queued (`strikes.evidence_email`, 12C.4: only to a
   confirmed address, with the record's PDF). The booking records `cancel_via` and the warning's
   version and time.
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

**What casuals see (the event and session switches)** (12B.4; docs/office-v2.md 3.3)
Every shift belongs to an event (`shift_events`), and both carry a "showing to casuals" switch.
One check, `src/lib/roster/visibility.ts` (the session's switch and its event's), is used on every
path a casual reaches a shift by: Open shifts, the urgent board and the Home count (all
`openShiftsFor()`), the shift page ("This shift isn't available"; someone whose place on it was
cancelled still sees it was cancelled, started or filled), a casual's own `bookShift()` (refused as
not found), "Ask the office to review" (refused as not open), offer waves and the waves after a dropout (none start; one queued earlier
stops, `offer.waves_stopped` {reason: "hidden"}), and the office's own offers (refused; one queued
earlier isn't sent). The office still sees and assigns a hidden session, booked casuals keep their
bookings (and still see them), and the office's escalation email still goes. `setShowing()`
(`src/lib/office/showing.ts`, active admins and resourcers) switches an event or a session, logged
`event.shown` / `event.hidden` / `session.shown` / `session.hidden` with who; showing one again
starts offers for each urgent session it brings back with a place free. A casual's booking, a
review request, the offer jobs and `startOfferWaves()` share-lock the event row after the shift, so
switching an event waits for one that read it, and one after it sees the new switch; only
`setShowing()` locks an event row exclusively, and it waits on nothing after that, so the share
lock can't deadlock (`tests/integration/showing.test.ts`, "a switch in progress"). A display choice, not an eligibility rule: it
stays out of the rules engine. Personal enquiry replies (12D.2) must use the same check.

**Pay query**
1. Worker (after OTP) fills a structured form.
2. Code assigns grouping keys: the issue and the week, plus the pay line's rate for a wrong
   rate or the site for missing hours (`src/lib/pay/grouping.ts`). Haiku writes a one-line
   summary per group from the group's facts only, checked before use, with the app's own line as
   the fallback and always shown as the heading (the Anthropic client is built, Phase 12 task
   12X.3, and off until `AI_TRANSPORT=anthropic`). The app stops waiting after 5 seconds
   a group; a failed, late or unusable answer changes nothing else.
3. Digest to payroll at a set time (built: `src/lib/pay/digest.ts`, the firm's `pay_digest`
   setting, default 09:00 Monday to Friday): the new queries, grouped, emailed to payroll with the
   list attached (names and workers' words only in the attachment), marked `in_digest`. Payroll can
   also send it at once from its page.
4. Payroll marks a group sorted with a note (built: `src/lib/pay/resolve.ts`); each worker gets a
   message that payroll has answered, with the pay page's link (`pay_query_update`, quiet hours
   respected), and sees "Sorted on {day}" with the note on their pay page, behind the pay code (the
   note is never in the message: 13.4). The note is always a person's words: no AI answers a pay dispute. A test
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
   Phase 7, `src/lib/inbound/reply.ts`: the AI only picks one of four labels and the reply is
   always the app's fixed text. The Anthropic client is built (12X.3) and off until "Connect the
   Anthropic API", so meanwhile unclear text goes to the office.)
3. Unknown number → polite reply + office alert. (Built in Phase 7: the first message from a
   number in 24 hours gets `unknown_number` and emails the office's admins and resourcers, without
   the number or the message; a former worker gets no reply, the office is alerted; every such
   message is on Enquiries, waiting for a person.)

**Call-to-text**
1. Twilio voice webhook returns a short recorded message.
2. Immediately send WhatsApp (or SMS) with the portal link.
3. Optional voicemail → transcription → request for the office.
(Built in Phase 7 short of Twilio: `src/lib/inbound/voice.ts`. The message is spoken by Twilio's
text-to-speech from `callGreeting()`, not a recording. The link is the login page's own request, so
only a worker's number gets one and the caller hears the same either way; a withheld number is
told we can't send one. The voicemail's text goes through the `inbound-message` job: a worker's
becomes a request for the office, answered by the channel they chose; a caller we don't know is
on Enquiries and the office is alerted, with no message to them.)
4. Twilio fallback URL forwards calls to the manager's mobile if our app is down. (Made in Phase 8,
   not set yet: `npm run firm:call-fallback` prints the TwiML for a firm's bin, `callFallbackTwiml()`:
   why, then the manager's phone for up to 30 seconds (their voicemail usually answers first), then
   a closing line true however that call went; Twilio serves it itself. Messages aren't covered:
   WhatsApps and texts reach the same app.)

## Webhooks to a firm's planner (12J.2)

**The action log is the outbox.** `recordEvent()` (`src/lib/events/record.ts`) writes every state
change in the transaction that makes it. For the three entries a planner hears about
(`shift.assigned`, `shift.cancelled`, `strike.withdrawn`) it also calls `queueWebhooks()`
(`src/lib/integrations/outbox.ts`): when the firm has a webhook address, one `webhook-deliver` job
(ids only) is queued in the same transaction. A rollback queues nothing; every path that books or
cancels (the app, the office, the rota sheet, the planner's API, an offer accepted) already writes
these entries, so none is missed. `recordEvents()` (bulk, no ids back) refuses them.

```
 booking change ──► recordEvent() ──► events row ─┐ same transaction
                                     queueWebhooks() ──► pgboss.job (ids only)
 worker: webhook-deliver ──► build the body from the rows ──► sign (Standard Webhooks)
        ──► resolve, check public, POST to that address (no redirects, 5 s / 10 s)
        ──► 2xx: webhook.delivered │ else retry (6, ~1 h) │ last try: webhook.failed, Needs attention
```

The body is the API's own record (`src/lib/integrations/records.ts`) under a strict zod contract
(`src/lib/integrations/webhooks.ts`, printed in `docs/integrations.md`). Delivery runs in the worker
only (`WEBHOOK_TRANSPORT`: `console` in development and tests, `https` in production), on 4 loops of
one job, one at a time per firm (a pg-boss group), so one firm's hanging endpoint can't hold up
another's. The safe sender (`src/lib/integrations/send.ts`) refuses every private, loopback,
link-local (the cloud metadata address), multicast and reserved range, IPv4 and IPv6 (mapped,
NAT64 and 6to4 forms too), and connects only to the address it checked. The address is a secret:
log lines name the host only.

## Notifications

Order: web push (free) → WhatsApp template → SMS fallback.
- Web push works on Android browsers. On iPhone it only works when the portal is added to the
  home screen, so prompt for it after first login. Built in Phase 3: My shifts and Profile show
  iPhone and iPad users "Put your shifts on your home screen" (`src/app/home-screen-hint.tsx`)
  until they tap "Don't show again". A per-firm web app manifest (`src/app/manifest.ts`) names
  the portal "{Firm} shifts" on the home screen.
- Offline: a service worker (`public/sw.js`, ADR-016) keeps the last copy of My shifts, so it
  opens without signal, marked "No signal. These are your shifts from {time}".
- Web push: the profile subscribes this phone (`POST /api/push/subscribe`,
  `push_subscriptions`); offers, reminders and the office's notices push to the worker's phones as
  well as WhatsApp/SMS; the same service worker shows the notification and opens the page (our own
  pages only). The real sender (13.3: the `web-push` library, the deployment's VAPID keys, the
  browser makers' push services) is `PUSH_TRANSPORT=webpush`; each push goes after its message,
  with no transaction open (14.1). Production keeps `none` until the keys are made on the server
  (PLAN.md Parking lot, "Connect the real web push").
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
- Claude through the Anthropic API: `AnthropicAiClient` (`src/lib/ai/anthropic.ts`, the official
  `@anthropic-ai/sdk`, pinned) behind `AiClient` (`src/lib/ai/client.ts`). `getAi(env)` gives
  `noAi` unless `AI_TRANSPORT=anthropic`; `noAi` answers "unavailable" to every request, and the
  code's fallback runs. The shifts line's reply job (`src/lib/inbound/reply.ts`) and the payroll
  digest (`src/lib/pay/digest.ts`) use `getAi`. Built in Phase 12 task 12X.3; real calls wait for
  "Connect the Anthropic API" (PLAN.md Parking lot).
- Settings, worker only: `AI_TRANSPORT` (`none`, the default, or `anthropic`, which needs a key and
  is refused under `NODE_ENV=test`), `ANTHROPIC_API_KEY` (a secret, only in the server's `.env`,
  given to the worker alone by `deploy/docker-compose.yml`), `AI_MODEL` (`claude-haiku-4-5` by
  default). The tests and the browser tests' servers pin AI off (`scripts/invariants.sh` checks).
- Each call is one request: no retries, a 5-second limit (the SDK's timeout, plus an `AbortSignal`
  that also stops a reply that is slow after its headers). The SDK would read some settings from
  the environment (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_LOG`); the client sets
  each in code instead: the API's own address, the settings' key only, the SDK's logging off.
- An error (a 429, a 5xx, no reply in time), a refusal or an empty answer is `AiUnavailableError`.
  One log line per call: purpose, model, token counts (under `usage`) and the stop reason (or why
  there was no answer: `timeout`, `http_429` and so on). Never the prompt, the answer or the key.
- The 5-second limit in `askAi()` (`src/lib/ai/ask.ts`) is unchanged: the app stops waiting after
  5 seconds whatever the client does. A failed, late or unusable answer means the code's fallback,
  as before.
- Where requests are processed: Anthropic's API may process requests outside the UK. Before AI is
  switched on, its data processing agreement and UK transfer terms are checked, and the privacy
  notice's line on where Anthropic processes requests is filled in (docs/privacy-notice.md,
  ADR-021, docs/compliance.md).
- No prompt caching: the system texts are a few dozen tokens, and Haiku 4.5 only caches a prefix
  of 4,096 tokens or more (a cache marker would silently do nothing).
- AI never decides eligibility, assignment or pay.

## Postcodes and travel (Phase 12, `src/lib/travel/`)

- `Geocoder` (`src/lib/travel/geocoder.ts`): a postcode to its central point, "not found" or
  "unavailable". Two: the fake (fixed points for the made-up `ZZ` postcodes; every other postcode
  is not found) and postcodes.io (one GET of the postcode alone, a 5-second limit, the answer
  checked with zod). Chosen by the server's `TRAVEL_PROVIDER` (`fake`, the default, or
  `traveltime`, refused under `NODE_ENV=test`; pinned to `fake` for the tests and the browser
  tests' servers). Built in 12G.1; real look-ups wait for "Connect postcodes.io and TravelTime"
  (PLAN.md Parking lot).
- A postcode is looked up when it's saved (a site's on Settings, a casual's on `/profile/travel`),
  before the database transaction, never inside it, and saved with its point in one write.
  Unknown postcodes and failed look-ups save nothing.
- The casual's travel area is `worker_travel` (S8). The office reads the district only, cut out in
  SQL. It is deleted on "They've left" and on erasure, and is never in the action log
  (`docs/dpia-travel.md`).
- Travel times (12G.2): a `TravelProvider` (`src/lib/travel/provider.ts`: the fake, or
  TravelTime's time-filter, given coordinates and meaningless ids only) used by the worker's
  `travel.estimates` job (`src/lib/travel/estimates.ts`), queued in the same transaction as the
  change that needs it (`src/lib/travel/estimate-queue.ts`) and nightly for the 28-day window.
  Estimates go in `travel_estimates`, keyed by postcode. Pages read them (`travelFor()`,
  `src/lib/travel/lines.ts`) and never reach the provider (`tests/unit/travel.boundary.test.ts`);
  with none yet, the line falls back to the straight-line distance, labelled.
- The travel filter (12G.3) builds on these.

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
  `<slug>.<our-domain>`); only then is it served (`firmForHost()`) or approved. A login started on
  the firm's own domain gets its link back on that domain (Phase 10, audit M7: the job is told
  which of the firm's two addresses the request came in on, and uses the domain from the firm's
  own record only while it's verified), so the session, a host-only cookie, is held there. Other
  links in messages still use `<slug>.<our-domain>`: parked. A session belongs to one address, so
  someone logged in on the firm's domain who taps such a link logs in again on
  `<slug>.<our-domain>`, and then has a session on each, each logged out on its own address.)
- Branding per firm: name, logo, primary colour, sign-off "[Firm] Shift Team". (Built in Phase 8:
  every firm page, portal and office, opens with the firm's bar (`src/app/brand-bar.tsx`, from the
  root layout): its logo, if set, and its name, on its colour, with black or white text, whichever
  contrasts more (at least 4.5:1 for any colour). Read from the firm's own row for the request's
  host (`src/lib/tenancy/brand.ts`); the logo is an https:// address on the firm's site, shown
  with no referrer; values are checked again before they reach a page and only ever reach it as
  an `<img>` address or a React style colour. The home-screen theme colour follows it. Set by the
  owner: `npm run firm:brand` (name, colour, logo, sign-off), logged `firm.branding_changed`. The
  office settings screen can offer it later: PLAN.md Parking lot.)
- Office emails can later be sent from the firm's domain through our email provider (the firm adds
  the DKIM records the provider shows).

## Deployment

- The server: any UK or EU host that runs Docker, chosen later (PLAN.md Deploy 9, Parking lot
  "Connect hosting"). What it needs: Ubuntu 24.04, 2 CPUs and 4 GB, a static IP, only ports 80 and
  443 open to the internet, SSH by key only or the host's own console. On a host that takes
  cloud-init, `deploy/cloud-init.sh` sets it up on first boot: automatic security updates (with a
  reboot at 02:30 UTC when one needs it), Docker from Docker's repository, and a root-only
  `/opt/shiftdesk`. Steps: docs/runbooks.md "Set up the server (once)".
- The database: the host's managed Postgres 16, in the same region, on a private network, not
  public, with nightly backups and point-in-time restore on. Every connection is encrypted and the
  database's certificate checked: the three database addresses in `.env` end with
  `?sslmode=verify-full&sslrootcert=/app/db-ca.pem` (`deploy/env.example`). The CA file is the
  host's own, saved on the server as `/opt/shiftdesk/secrets/db-ca.pem` (in `secrets/`, next to
  the compose file; docs/runbooks.md "Set up the server (once)" step 8), readable (`chmod 644`).
  `deploy/docker-compose.yml` mounts it read-only at `/app/db-ca.pem` into `web`, `worker`,
  `migrate` and `owner`, and never creates it: if the file is missing, Docker refuses to start. The
  app refuses a production database address without that ending (`src/lib/env.ts`,
  `src/lib/db/tls.ts`). Nothing about the database is in the image.
- If the host has no managed Postgres: Postgres 16 in Compose, reached over a Unix socket (no TLS
  needed: `src/lib/db/tls.ts` counts a socket as this machine). Backups and restores then become
  ours (below). Not in `deploy/docker-compose.yml` yet: added only if the chosen host needs it.
- Docker Compose: `web`, `worker`, `caddy`. GitHub Actions builds the image; the server pulls it
  and runs `up -d` (no SSH). (As built in Phase 8, short of a server: deploys pull. `.github/workflows/deploy.yml` builds the
  image (`Dockerfile`: one image, non-root, no secrets, production dependencies only since 13.5:
  the build prunes the development tools, and `tsx`, which runs the worker and migrate, is a
  dependency) after CI passes on `main` and pushes it to
  GitHub's registry; `deploy/deploy.sh`, every 2 minutes on the server (a systemd timer), pulls a
  new image, runs the one-off `migrate` step, then `up -d`, never between 05:30 and 09:00 UK.
  `deploy/docker-compose.yml`: only Caddy published (80/443), each service given only the secrets
  it needs (the owner's login only to `migrate`), everything `restart: unless-stopped`, the web
  app's health check `GET /api/health`, the worker behind a profile until the Twilio sender exists.
  Only a push to this repository's `main` that passed CI publishes `:main`, and only while it's the
  tip. Nothing SSHes in to deploy: SSH is closed, or open only to the owner's own address
  (docs/runbooks.md "Set up the server (once)" step 3).)
- Secrets in a root-only `.env` on the server (`/opt/shiftdesk/.env`, `chmod 600`;
  `deploy/env.example`), never in the image or the repo. Each service gets only the values it
  needs.
- Email: over SMTP, through any provider with SMTP credentials and a verified sending domain
  (chosen later: PLAN.md Deploy 8). Worker only (the web app sends no email): switched on by
  `EMAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`.
  In development and tests the console sender prints each email instead. Phase 12 task 12X.2
  builds the SMTP sender; real sending waits for "Connect an email provider (SMTP)" (PLAN.md
  Parking lot).
- AI: the Anthropic API, worker only, off unless `AI_TRANSPORT=anthropic` with an
  `ANTHROPIC_API_KEY` (made in a workspace with a monthly spend limit). See "Where AI is used".
- Backups: the host's own snapshots of its managed Postgres (nightly, with point-in-time restore);
  a snapshot before schema changes; a restore tested monthly with the host's backups. A `pg_dump`
  as the owner is no backup: forced RLS hides every firm's rows from it (ADR-011). With Postgres in
  Compose, backups are a `pg_dump` run as the `postgres` superuser (ADR-011 as amended). Steps:
  docs/runbooks.md "Restore the database", "Restore drill (monthly)".
- A demo server (Phase 16; ADR-025): the same image with `DEMO_MODE=on`, holding only the made-up
  demo firms and people. The worker prints every text and email (and planner webhook) into the
  outbox file instead of sending it (production refuses that without demo mode), and nothing else
  leaves the server either (push, Sheets and AI off, made-up postcodes). It refuses to run, and
  stops within a minute, while any firm isn't a demo firm or anyone in one has a real number or
  email (`src/lib/demo/guard.ts`), and refuses any other firm's job and any message to someone
  who isn't made up; the web app finds no other firm (`src/lib/demo/scope.ts`). Each outbox line is stamped
  with the firm whose job sent it (`src/lib/tenancy/job-firm.ts`); each demo firm's Demo phone
  (`/demo`) shows only its own lines, to its own people, read inside its withFirm transaction
  (`src/lib/demo/phone.ts`), so a login link can be tapped there as it would be on a phone; a demo
  bar on every page links to it. The web app and the worker share the outbox file. The whole site
  needs one password, the app's own check (`src/lib/demo/gate.ts`). The server runs
  `deploy/docker-compose.demo.yml` with the real compose file (Postgres in Compose over a socket,
  the outbox a shared volume) and loads the demo afresh every night (`deploy/demo-reset.sh`); its
  database refuses real numbers and emails itself. Steps: docs/runbooks.md "A demo server".
- Monitoring: an outside uptime check on `/api/health` (a free one, with its phone app), plus the
  host's own alerts (the server down, CPU, database storage, as far as the host offers them) and
  its billing alert at £50. Steps: docs/runbooks.md "Monitoring and alerts (once)"; PLAN.md Parking
  lot "Connect monitoring". The app's own alerts (failing jobs and syncs): docs/runbooks.md "Alerts
  from the app".

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

- HTTPS everywhere; HSTS. (Phase 10 task 17: Caddy serves only HTTPS, redirecting plain HTTP, and every answer
  carries `Strict-Transport-Security: max-age=31536000` (`deploy/Caddyfile`, checked by Caddy itself
  in `tests/integration/deploy.caddy.test.ts`). The database connection is encrypted and its
  certificate checked in production (`sslmode=verify-full` against the host's CA file, mounted
  read-only at `/app/db-ca.pem`; the app refuses a production database address without the
  `sslmode=verify-full&sslrootcert=/app/db-ca.pem` ending, and Docker refuses to start without the
  file).)
- Verify Twilio signatures on every webhook.
- Rate limit login and OTP.
- No personal data in logs (mask phone numbers). (Built: `src/lib/log/mask.ts` masks numbers,
  emails, query strings and quoted values in every log line, cutting each string to 2,000
  characters and request paths to 512 first (never leaving part of a number, email or token at
  the cut), every pattern a single pass, so a huge request can't stall the web app. Every e2e run
  checks the servers' whole output for numbers, emails, login tokens and unexpected errors:
  `docs/testing.md`.)
- Least privilege: three database roles (ADR-011), and each service gets only the secrets it needs.
  MFA on all accounts.
- Dependency updates weekly; `npm audit` in CI.
