# Decisions (ADRs)

Short records of why things are the way they are. Add new ones at the bottom.
Status: Accepted unless noted. Date: September 2026. Decider: Dylan.

---

## ADR-001: One cloud system for all firms, sold as a subscription (not a local install)

**Context:** Idea of selling firms a licence to run it on their own PC/server.
**Decision:** Multi-tenant SaaS on our servers, sold as a subscription under a written licence
agreement + DPA.
**Options:**
- Multi-tenant SaaS — cheapest, one deploy, fix bugs once. ✅
- Single-tenant per firm — later, for big firms who pay for it (setup fee + ~£150+/month).
- Local install — fails: cancellations arrive at 5am when office PCs are off; webhooks need a
  public address; updates on every PC; backups and breaches become our problem; no rota
  competitor sells on-premise.
**Revisit when:** a 300+ staff firm asks for its own tenant.

## ADR-002: AWS London — Lightsail + managed Postgres + pg-boss + Bedrock + SES

**Status:** superseded by ADR-021 (2026-10-06) for hosting, the database, AI and email; the pg-boss
decision stands.
**Context:** Want fewest sign-ups, UK data residency, low cost, low ops.
**Decision:** One AWS account (eu-west-2). Lightsail 4 GB (~$24) + managed Postgres (~$15) ≈
£29/month. Jobs and timers in pg-boss (Postgres). Claude via Bedrock EU profile. SES for email.
**Options considered:**
| Option | Verdict |
|---|---|
| Lightsail + Postgres (chosen) | Fixed monthly bill, UK region, one vendor for hosting/AI/email |
| AWS serverless (Lambda, SQS, Step Functions) | Great later; too much wiring for evenings now |
| Supabase + Vercel + Inngest | Easy, but 3 vendors and AI still separate |
| Hetzner VPS | No UK region; prices rose twice in 2026 |
| Cloudflare Workers + D1 | EU not UK; SQLite; rewrite |
**Consequences:** we run Docker ourselves on one box; single server is a risk on event mornings
(mitigated by Twilio fallback). **Revisit when:** 5+ paying firms.

## ADR-003: Twilio for numbers, SMS and WhatsApp; WhatsApp first, SMS fallback

**Context:** Staff live on WhatsApp. SMS costs ~4p each in the UK.
**Decision:** Twilio (one account covers UK numbers, SMS, WhatsApp, voice; ElevenLabs imports
Twilio numbers natively). Order: web push → WhatsApp → SMS. (As built: the worker's chosen channel,
WhatsApp or text, with a text when WhatsApp is refused, **and** a push as well, not push instead:
`src/lib/notify/send.ts`. Which it should be is in PLAN.md, "Decisions waiting for Dylan".)
**Consequences:** Meta business verification per firm; approved templates for offers and login
links; service messages beyond 1,000 per number per month are charged from 1 October 2026.
**Revisit when:** SMS volume makes Telnyx worth a look.

## ADR-004: Call-to-text by default; AI voice as a paid add-on

**Context:** ~10 calls a day per firm. An AI voice agent costs ~£30/month per firm at that volume
but adds complexity.
**Decision:** Default: short recorded message + instant WhatsApp/SMS link (as built: by WhatsApp
only; the SMS fallback for login links is parked). AI phone line
(existing ElevenLabs agent) is a £149/month add-on in Stage 2.
**Consequences:** cuts calls instead of just answering them; pushes staff to the portal.

## ADR-005: AI reads, code decides

**Context:** Accuracy, liability, trust (only ~10% of UK AI-using firms use it heavily; many
sectors distrust AI).
**Decision:** Eligibility, credentials, assignments and pay facts are plain code over firm data.
AI only classifies text, drafts and summarises, with validated outputs and an office fallback.
**Consequences:** cheaper and more accurate; the pitch leads with the log and the shift board,
not "AI".

## ADR-006: Web portal via WhatsApp link, not a native app (yet)

**Context:** App fatigue; staff juggle several agency apps; smartphone ownership is high
but lower among over-65s.
**Decision:** Mobile-first web portal (installable), login by link on WhatsApp/SMS (as built: by
WhatsApp only, the SMS fallback is parked; office users by email).
**Consequences:** iPhone push only after "add to home screen"; WhatsApp covers urgent alerts.
**Revisit when:** geofencing (Stage 3) needs a native app (Flutter).

## ADR-007: Price per active worker, with a floor

**Context:** Flat £599 overcharges small firms; a cut of payroll is unverifiable and feels like
a tax; security margins are tight.
**Decision (hypothesis to test in discovery):** £299 paid pilot month; then ~£3 per active
worker per month (anyone who worked a shift that month), £199 minimum. Add-ons: AI phone line
£149/month. Annual: 2 months free. Monthly rolling.
**Consequences:** revenue rises in busy season automatically; small firms can start cheaply.
**Revisit when:** after 10 discovery calls and the first pilot.

## ADR-008: Target firms without Deputy/Parim; native rota mode

**Context:** Firms on Deputy, Parim, Timegate or Guardhouse already have staff apps; Deputy
launched its own AI in November 2025.
**Decision:** Target spreadsheet/WhatsApp firms. Ask "what do you use to plan your rota?" on
the first call and move on politely if it's one of those. Offer native mode for firms with nothing.
**Consequences:** no Deputy/Parim plugs planned.

## ADR-009: Sell one sector at a time; credentials are generic

**Context:** Rail, civils, construction and cleaning have the same pain.
**Decision:** Sell events/security first (credibility, CSP pilot). Rules engine treats
credentials as data per sector (SIA, PTS, Sentinel, CSCS, DBS). Next sector: rail/civils via
Teamforce and Coyle contacts.
**Consequences:** references stay sector-specific; product stays reusable.

## ADR-010: AI disclosure — no banners, no fake names, legal minimum met

**Context:** Want replies to feel like the firm, without announcing AI everywhere.
**Decision:** Replies signed "[Firm] Shift Team". Never a fake human name. The firm knows (it's
the controller and signs the DPA listing sub-processors). Staff: one line in the firm's privacy
notice about automated handling. Anyone significantly affected by an automated decision can ask
for a human. Pay disputes always go to a person.
**Consequences:** low friction, no deception, compliant.

## ADR-011: Three database roles, forced RLS, a firm directory function and a guarded job queue

**Context:** Postgres superusers and table owners bypass RLS, and the dev database user was a
superuser, so tenancy tests would have passed without testing anything (Phase 0 review). The
production owner (Lightsail master) is not a superuser, so migrations that only ever ran as a
superuser could fail for the first time on deploy. Before a request knows its firm (host lookup)
the app must read `firms` without a firm set. Jobs carry a firm id that the worker trusts.
**Decision:**
- Roles: `shiftdesk_app` (web + worker data; restricted), `shiftdesk_jobs` (worker's pg-boss;
  owns `pgboss`), and the owner (migrations and admin scripts only; never in the web or worker
  env). Locally the owner is a NOLOGIN, non-superuser `shiftdesk_owner` role that the admin URL
  switches to (`options=-c role=shiftdesk_owner`), so dev, CI and prod run migrations the same
  way. Tests connect as `shiftdesk_app` and abort if it could bypass RLS.
- RLS enabled and **forced** on every table (binds the owner too), one tenant policy per table,
  composite `(firm_id, x_id)` foreign keys. drizzle-kit writes tables and policies; `db:migrate`
  applies FORCE and grants from `src/lib/db/admin/access.ts`.
- Host lookup through one owner-owned `SECURITY DEFINER` function returning directory fields only,
  instead of a separate read-only role (fewer moving parts, no role memberships).
- pg-boss owned by `shiftdesk_jobs`, not the web's role: owning it would let the web queue (or
  schedule) work for any firm. The web may only insert into `pgboss.job_common`, and an RLS
  policy there requires the job's `firmId` to equal the current firm.
**Options:** app role owning pgboss (simpler, but a way round RLS); a separate read-only
directory role (needs role memberships the managed master user may not be able to grant).
**Consequences:** every new table needs a `TABLE_ACCESS` entry and isolation fixtures (tests fail
by name without them). `pg_dump` as the owner sees no firm rows under forced RLS: backups use
Lightsail snapshots, firm exports go through the app. Local dev databases from Phase 0 need a
one-time `npm run db:reset`.
**Amended 2026-10-06 (ADR-021, no AWS):** read "Lightsail master" as the host's managed-Postgres
admin user (also not a superuser, so the same reasoning holds). Backups are the host's own
snapshots; with Postgres in Compose (a host with no managed Postgres), a `pg_dump` run as the
`postgres` superuser, because the owner still sees no firm rows under forced RLS.
**Revisit when:** a second service needs database access, or pg-boss changes its table layout
(the `rls.every-table` test checks the `job_common` policies still exist).

## ADR-012: Host → firm in two steps: shape check in proxy.ts, firm lookup in each page and action

**Context:** PLAN.md asks for host → firm resolution "as middleware". Next 16 renamed middleware to
`proxy.ts` (Node.js runtime by default). Its docs advise against database work there (it runs on
every request, prefetches included), and a firm check in a layout does not stop the page itself
from rendering.
**Decision:** `src/proxy.ts` parses the Host header (`src/lib/tenancy/host.ts`, no database): the
base domain is the ShiftDesk home page, `<slug>.<base>` is a firm's portal, and every other host
gets a plain 404 before any page runs. It also sets the request ID. Every page, server action
and route handler that touches firm data then calls `getCurrentFirm()`, which resolves the slug
through `app_resolve_firm()` (cached per render) and shows the 404 page for unknown firms. Only
the Host header is read, never `X-Forwarded-Host` (client-controllable when Next is reached
directly).
**Consequences:** one directory lookup per render or action. Pages and actions reach firm data
through `withCurrentFirm(fn)` (`getCurrentFirm()` then `withFirm(firm.id)`); ESLint stops
`src/app` importing `withFirm` directly, so a page can't pick a firm id from input. Custom domains (Phase 8) extend
`parseHost` and `app_resolve_firm`.

## ADR-013: Google Sheets sync: a mirrored rota with a three-way merge

**Context:** most target firms keep their rota in a Google Sheet and will keep editing it while
workers book in the portal. Google's quota is per minute, reads are slow, and a request must never
wait on Google (architecture.md: never read the sheet per request).
**Decision:** the sheet is mirrored into our own tables by a sync job (every minute on event days,
every 15 otherwise); the portal books against the mirror with the same first-yes-wins code as
native firms (`sheetsRosterPlug`). Who holds each shift is merged three ways against what the sheet
held after the last sync (`shifts.synced_holders`), so both sides' changes survive; a confirmed
portal booking always stands. The sheet's staff and shift id columns are the keys (row numbers
move when the office sorts). One batch read and at most one batch write per sync; the base moves
only after a successful write, so a failed write is retried, never lost. Our service account's key
lives in the worker's environment (`GOOGLE_SERVICE_ACCOUNT_JSON_PATH`), never in the database.
**Options:** read-through (the sheet as the live source for every request: quota and latency);
last-writer-wins (office edits and portal bookings overwrite each other); an outbox of pending
sheet writes (more state, same result as the merge base).
**Consequences:** the office sees portal bookings in the sheet within about a minute on event
days. A name added in the sheet to an already-full shift isn't booked (logged as a conflict).
Started shifts are history: a sync never books, cancels or re-times them. A worker blocked here
stays blocked; a mobile changed in the sheet signs the worker out. The sheet's names go through
the rules engine with the office's overrides (ADR-014); one that fails a credential, role,
account, double-booking or site check isn't booked and is logged for the office; it stays in the
sheet while there's room and is tried again at each sync. A new role, times or site on a booked
shift is made only if everyone booked can still work it (the office editor's check), and a started
shift is never re-timed, re-roled, moved or cancelled: what isn't done is shown on the office
dashboard (Phase 10, audit M1, M2, L12; on Today until 12E.1).
The live transport is off by default (`SHEETS_TRANSPORT=none`); `google` with the service
account's key switches it on, once a Google account exists. Phase 10 (audit M17, L45): only a sheet
whose locale is United Kingdom is read (its dates read day first), and a spreadsheet is bound to one
firm, connected only by the owner (`npm run firm:sheet`), never by the app.
**Revisit when:** a firm needs one row per slot instead of an "Assigned" list, or sheets get big
enough that one read per minute is too slow.

## ADR-014: One booking path; "re-check the live source" means current rows and a fresh sheet copy

**Context:** the architecture said to re-read the live source before confirming a booking ("for
Sheets, re-fetch that row"), while ADR-013 forbids reading Google per request. The rules engine
issues an `EligibilityPass`, but nothing forced a booking through it.
**Decision:** every booking goes through `bookShift()` (people) or `checkBooking()` (the Sheets
sync) in `src/lib/roster/book.ts`: lock the shift, then the worker; load the rules input from the
current rows; run the rules; re-check the live source; the plug's one conditional update; the
event, all in one transaction. `RosterPlug.assign` demands a single-use pass for exactly that
worker and shift. The live source for our own and imported shifts is our tables (already current
under the lock). For a Sheets shift, the booking is confirmed only if our copy synced successfully
within 20 minutes (the quiet cadence, 15, plus slack); otherwise `source_stale`. Locks are taken
shift, then worker, then (only for a booking relying on the "applied" allowance) the firm's day,
so two portal bookings can't deadlock. The Sheets sync can still deadlock with a portal booking
(its one long transaction takes worker locks before later shift locks): Postgres aborts one side,
nothing is double-booked, and both retry (`retryAborted()`: `bookShift()`, and the sync's
database step on the same read of the sheet). A refusal by the rules is logged
(`shift.booking_refused`, codes only).
**Options:** re-fetch the sheet row per booking (quota, latency, and a request waiting on Google);
confirm against any copy however old (a failing sync would take bookings the sheet never sees);
lock the worker first (the opposite order to the sync's).
**Consequences:** a Sheets firm whose sync has been failing for 20 minutes can't take portal
bookings until it recovers (the worker is told to try again shortly). Two tabs can't double-book
one person. The office's overrides are limited to checks 0 and 6-8 and always carry a reason (since
Phase 10 task 13 kept on the booking, `assignments.override_reason`; the action log only says a
reason was given). Bookings relying on the "applied" allowance queue per firm and day, so two
applicants can't both take the day's last allowed place.
**Revisit when:** event-day bookings need a tighter freshness window than 20 minutes, or a
sheet row deleted by the office must stop being bookable before the sync notices (parked).

## ADR-015: Fair rotation on the Open shifts board is a short priority window

**Context:** firms choose first come, first served or fair rotation (fewest hours this week first).
The offer waves (Phase 4) rank by it, but the board lets anyone eligible take a shift instantly,
which favours the people who sit on their phones (docs/business.md).
**Decision:** under fair rotation, a newly opened place (a new shift, or a place freed by a
cancellation) is held for the firm's `wave_minutes` (default 15) for the `wave_size` (default 4)
workers with the fewest confirmed hours in the shift's week, ties included, among active workers
with the shift's role who aren't on it. `bookShift()` enforces it for a worker's own booking
(`not_yet` with the time it opens); the board shows the time instead of "Take shift". The office,
and names in the office's sheet, are never held; nor is a shift starting within the firm's
`urgent_window_hours` (default 24), and a place is never held past its shift's start.
**Options:** collect requests and allocate at a deadline (no instant answer); only reorder the
list (no fairness); run the full rules for every worker to find the group (too slow per page).
**Consequences:** a busy worker waits up to 15 minutes for a new place; the group is by role and
hours, so one of the fewest-hours workers may not be eligible and the place still waits for the
window. **Revisit when:** pilot firms say the window is too long or the group too small, or the
offer waves (Phase 4) should replace it.

## ADR-016: An offline copy of My shifts, kept by a small service worker

**Context:** workers open their shifts at venues with poor signal (docs/screens.md copy rules;
product spec P1-9: "last loaded shifts open without signal; clearly marked as last updated").
**Decision:** a hand-written service worker (`public/sw.js`) handles only two things: opening My
shifts (`/`) and the site's own styles and scripts. It goes to the network first, and shows the
copy kept from the last good load when there's no signal or no answer within 4 seconds. The copy's
"No signal" notice is part of the page, hidden; the service worker unhides it, so it needs no
JavaScript. The page always says "Updated {time}". It is also kept when My shifts is shown
without a full load (after logging in, or going back to it): the page sends the service worker a
"keep" message. Besides the page, only same-origin `/_next/static/` files are kept, checked after
resolving the path and fetched without cookies (the page's text includes what the firm typed).
The copy lives only on the worker's phone. It is deleted on logout, on login, when the server
answers "not logged in", and is never shown after 14 days. Every other page (pay, requests, the
office) is never cached. `OFFLINE_COPY` switches it: on in production, off in development (a slow
first compile would show an old copy); off also removes the service worker from phones that
open My shifts.
**Options:** a PWA library such as Workbox (caches far more than one page, another dependency);
caching every page (more personal data on the phone, stale pay and requests); no offline copy.
**Consequences:** the phone holds the worker's upcoming shifts, including instructions, until
one of those events (docs/compliance.md). Taking, cancelling and other pages still need signal. A
broken service worker would stick on phones until replaced: docs/runbooks.md says how to replace
it. "Not logged in" is recognised because My shifts answers with a redirect; if a loading screen
(`loading.tsx` or Suspense) is ever put above the login check, that answer changes and this needs
revisiting. Since web push (Phase 4), a phone with notifications on keeps the service worker even
when `OFFLINE_COPY=off` (it carries the notifications), and that service worker still keeps the
copy; turning notifications off removes it. **Revisit when:** the real web push sender is
connected.

## ADR-017: Shift reminders come from a 5-minute tick and a table of what was sent

**Context:** Phase 4, "Shift reminders 24 h and 2 h before start (cuts no-shows)". The job catalogue
said "cron hourly". Bookings come from several places (the portal, the office, the Google Sheet
sync), and shifts can move.
**Decision:** a cron tick every 5 minutes (`shift-reminder-tick`) looks for confirmed bookings on
open or filled shifts with a reminder due, and queues one `shift-reminders` job per firm that has
any. The job is a firm task: per reminder, one short transaction claims it in `shift_reminders`
(status `sending`, unique per booking, reminder and start time, only if the booking is still
there) and commits; the message goes outside any transaction; a second short transaction records
`sent` (with the push and the event) or `failed`. A job that stops between the two leaves
`sending`, meaning "may have gone": it's never sent again. (The first version held one transaction
across every send, so a failure after a message went rolled back its record and a retry resent it:
caught in review.) The rules for when are pure functions (`src/lib/rules/reminders.ts`):
- the 24 h window runs from 24 h before the start to 2 h before;
- the 2 h window runs from then to the start;
- a booking made after a reminder's time doesn't get that one;
- quiet hours hold reminders (they aren't urgent), if they end at least two runs (10 minutes)
  before the window closes. Otherwise the reminder is recorded as skipped.
**Options:** one delayed job per booking, queued when it's made (every booking path, the sheet sync
and every move or cancellation would have to queue or cancel them); an hourly cron (a 2-hour
reminder could come only 1 hour before); columns on `assignments` (no history, and a moved shift
couldn't be reminded again); checking `events` for a sent reminder (no unique key, so two jobs
could both send).
**Consequences:** a reminder goes at most once (at-most-once: one that may have gone is never retried), at most about 5 minutes late while the worker process runs. After
an outage, a still-open window's reminder goes when it's back (the 24 h one then says "today" if
that's right), and a closed one is never sent. The tick reads each firm's upcoming bookings every
5 minutes: cheap at pilot size. **Revisit when:** a firm has thousands of bookings a day, or asks
for other reminder times (a firm setting).

## ADR-018: One shifts line per firm, stored on the firm, found by number for incoming messages

**Context:** Phase 7, "One business WhatsApp number per firm ("the shifts line") via Twilio". Staff
should message one number that is their firm's; every message to them should come from it; and an
incoming WhatsApp, text or call must be matched to its firm before anything else knows the firm.
**Decision:** a column, `firms.shifts_line_e164` (E.164, unique: one number belongs to one firm;
null until one is bought), set only by `npm run firm:line` with the owner connection (we buy and own
the numbers; changing a number already set needs `--replace`). That owner-only script lives in
`scripts/` (`scripts/shifts-line-owner.ts`), not `src/`: the app itself never sets the firm outside
`withFirm()` (invariant 5 in `scripts/invariants.sh` allows only the seed's provisioning besides). Incoming messages find their firm with `app_firm_by_line()`, a SECURITY DEFINER
function like `app_resolve_firm()` for web hosts (directory fields only), through
`resolveFirmByLine()`: the second look-up allowed before a firm is known, beside
`resolveFirmBySlug()`. Outgoing WhatsApps and texts carry `from` (the firm's line); every sender to a
worker passes it (`sendToWorker()`/`notifyWorker()` require it; a test holds the direct senders). The
same number serves WhatsApp, texts and calls.
**Options:** a `messaging_numbers` table (several numbers per firm, per channel); a shared ShiftDesk
number routing by the sender's mobile (one worker at two firms would be ambiguous); the transport
looking the firm up (a database call inside the sender).
**Consequences:** a firm without a line still builds its messages, with no `from`: what the Twilio
sender does then (a shared ShiftDesk number, or no messages) is decided when it's connected. A
second number per firm needs a table. **Revisit when:** a firm wants separate numbers (by site or
sector), or numbers move between firms.

## ADR-019: A firm's own domain is served only once verified, and Caddy asks before each certificate

**Context:** Phase 8, "Custom domains: firm adds a CNAME (e.g. `shifts.firmname.co.uk`); Caddy
on-demand TLS with an `ask` endpoint that only approves domains in the firms table". Staff trust a
portal on their firm's own address; but any name could be pointed at our server, and Caddy fetching
certificates for any name that arrives would be abused.
**Decision:** a host that isn't ours is a possible custom domain (`parseHost()`: a proper public
host name, no port in production); `firmForHost()` looks it up with `app_resolve_firm_by_domain()`,
a SECURITY DEFINER function like `app_resolve_firm()` that returns a firm only if the name is its
`custom_domain` **and** `domain_verified`. Caddy (`deploy/Caddyfile`) gets our own domain's
certificate normally and every other name on demand after `GET /api/caddy/ask`, which approves only a
verified custom domain or `<slug>.<base>` of an existing firm (so no wildcard certificate, which
would need a DNS provider's API). The owner saves and verifies a domain with `npm run firm:domain`
(the CNAME must point to the firm's own subdomain, `<slug>.<base>`, so a domain can only be verified
for the firm it points to), like the shifts line and the brand, since the app role can't change
firms.
**Options:** serve a domain as soon as it's saved (a typo or an unpointed name would be served and
get certificates); a wildcard certificate for subdomains (DNS-01); an office settings action with a
`domain-verify` job (needs the settings screen and an update grant on firms).
**Consequences:** onboarding a domain is a two-step owner task (save, then check once the CNAME is
there); a domain whose CNAME goes away keeps being served until someone runs `--check` (a periodic
re-check is parked). Links in messages still use `<slug>.<base>`, except a login link asked for on
the firm's domain, which goes back to it (Phase 10, audit M7: otherwise the domain could never hold
a session, as the session cookie is host-only on purpose). That makes the verified mark matter
more: it's only as fresh as the last `--check`, and a domain that stopped pointing to us (a
changed CNAME, or a lapsed domain someone else registered) would still get login links, which
whoever holds it could use. So the periodic re-check must exist before any real firm's domain is
verified (`docs/testing.md`, pre-pilot checklist). **Revisit when:** firms set their own
domains in the office, or links should use the firm's domain.

## ADR-020: A GDPR deletion erases the person and keeps the anonymous evidence; messages go only through two owner-run functions

**Context:** Phase 8, "GDPR: worker data export (JSON + CSV) and delete; firm data export;
retention purge job". Offers, bookings, cancellations, reminders and pay lines point at the worker
with foreign keys that have no ON DELETE action (on purpose: the notice report's history can't be
erased by accident), the app role can't delete them, and events are append-only. The runbook said
"keep the anonymised events if the firm requires it; otherwise full delete".
**Decision:** a deletion erases: the worker row stays as "Deleted worker" (no mobile, email or
staff id; a CHECK holds an erased row to exactly that, so `mobile_e164` is nullable only for it),
and everything personal about them is deleted or cleared (credentials, logins, phones, days off,
messages, the free text on requests and pay queries). The rows that are evidence stay on the
anonymous row, with any typed text on them cleared (a worker's "Something else: …" cancellation
note becomes "Something else"; the app's fixed wording stays). The app role still has no DELETE on
messages: `app_erase_worker()` (the row made anonymous and its messages deleted in one call, by the
number the row held, once per worker) and `app_purge_old_messages()` (messages older than the
firm's own `retention.message_days`, 90 unless set, read inside the function from the firm's
settings, which only the owner can change, and nothing during a hold: Phase 10 task 13; at first
the age was fixed at 90 days) run as the owner, bound to the current firm by forced RLS. Admins only
(a new `data` area). Retention purges messages, closed requests' notes, the office's override
reasons and login leftovers nightly; the 12-month purge of the log, requests and offers is not
built.
**Options:** a full delete (would need ON DELETE on evidence and deleting events); one shared
"Deleted worker" row (loses which anonymous person did what); a DELETE grant on messages for the
app role (any bug could delete them); a message function taking a number from its caller (a bug
could delete anyone's unknown-number messages); a placeholder mobile instead of null (could be sent
to; with null the type checker flagged the Drizzle readers, and the raw-SQL readers filter it out).
**Consequences:** the notice report keeps its rows, showing "Deleted worker"; a firm's rota sheet
or staff file can add the person back (the runbook says to remove them there too); unknown-number
messages from their old number are deleted with them. Not reachable: Twilio's own copy of messages
(by the ids in events), once Twilio is connected. (The office's typed reason for placing someone
despite a rule was in the append-only log at first; since Phase 10 task 13 it's on the booking,
replaced by an erasure and cleared by the nightly purge.) **Revisit when:** the 2027 rules set how long
notice records are kept (then decide the log's purge: it needs a delete policy on events, which a
pinned test forbids today).

## ADR-021: No AWS: email over SMTP, Claude through the Anthropic API, any UK or EU Docker host

**Context:** Dylan, 2026-10-06: "only thing im against atm is aws services". ADR-002 put hosting
(Lightsail), the database (Lightsail Postgres), AI (Bedrock) and email (SES) in one AWS account.
None of it had run: the Lightsail scripts (`deploy/lightsail.sh`, `alarms.sh`, `restore-drill.sh`)
were written and tested but never run, and Bedrock and SES were never built (the app has `noAi` and
a console email sender). Nothing AWS is in `package.json`; the image fetches Amazon's RDS
certificate bundle.
**Decision:** supersedes ADR-002 for hosting, the database, AI and email; pg-boss stays. No AWS
means no AWS account, SDK or AWS-branded service. Whether a provider that itself runs on AWS (see
its sub-processor list: some email providers and Docker hosts, and parts of Anthropic's own
infrastructure) is acceptable is Dylan's call when the accounts are chosen (PLAN.md Deploy 8 and
9).
- **Email:** one SMTP sender (nodemailer) behind `MessagingTransport`, email only, switched on by
  `EMAIL_TRANSPORT=smtp`. Any provider with SMTP credentials and a verified sending domain works;
  which one is chosen when the accounts are created (PLAN.md Deploy 8). Console stays the default
  in development and tests and is refused in production.
- **AI:** Claude through the Anthropic API (the official `@anthropic-ai/sdk`) behind `AiClient`,
  switched on by `AI_TRANSPORT=anthropic`, the model from `AI_MODEL` (Haiku by default). Off by
  default. The 5-second limit, the checks on every answer and the code's fallback are unchanged
  (ADR-005).
- **Hosting:** Docker Compose (web, worker, Caddy) on any UK or EU Docker host. Postgres 16 is the
  host's managed database (checked TLS, its CA file mounted at `/app/db-ca.pem`; backups are the
  host's snapshots) or, if the host has none, Postgres in Compose over a Unix socket (backups a
  `pg_dump` as the `postgres` superuser: ADR-011 as amended). Which host is chosen later (PLAN.md
  Deploy 9).
- **Removed** (Phase 12 task 12X.1): the three Lightsail scripts and their tests, and the RDS
  bundle in the image. A test fails if an AWS SDK, endpoint, command, setting (`AWS_*`,
  `BEDROCK_*`) or name (Lightsail, Bedrock, the RDS bundle) comes back in the code, the image, the
  deploy files, the env examples or CLAUDE.md.
**Options considered:**
| Option | Verdict |
|---|---|
| Keep ADR-002 (AWS) | Ruled out by Dylan |
| One email provider's own HTTP API or SDK | Ties us to that provider; SMTP works with all of them |
| Plain `fetch` to the Anthropic API | Works, but the official SDK gives typed errors and timeouts and can switch retries off, for one dependency |
| Claude on another cloud (Google Vertex AI, Microsoft Foundry) for EU-only processing | Another cloud account; revisit if a firm requires it |
| Postgres only in Compose | One bill, but backups and restores become ours; only if the host has no managed Postgres |
**Consequences:** three accounts (the host, the email provider, Anthropic) instead of one, each
replaceable on its own and each a sub-processor (PLAN.md Legal 2). Anthropic's API may process
requests outside the UK, and its processing-region option doesn't cover every model, so before AI
is switched on its data processing agreement and UK transfer terms are checked and the privacy
notice's "runs in the EU" wording changes. The host's billing alert and an outside uptime check
replace the AWS budget and the Lightsail alarms. Phase 12 builds the SMTP sender and the AI client
(12X.2, 12X.3); real use waits for "Connect an email provider (SMTP)" and "Connect the Anthropic
API" (PLAN.md Parking lot). **Revisit when:** a firm requires UK- or EU-only AI processing, or 5+
paying firms (server size).


## ADR-022: The planner integration layer: an API in by key, signed webhooks out

**Context:** Dylan, 2026-10-06: "plug in and play with all planners using webhooks and apis not
another sheet" (`docs/office-v2.md` §5.3; S11 approved the same day). A firm's planner or CRM
should send its sessions to ShiftDesk and hear about bookings and cancellations, with no adapter
per planner. Today every way in is a person (the office pages), a provider webhook (Twilio, signed
and answered by jobs), the rota sheet or a file, and every look-up before a firm is known goes by
host (`resolveFirmBySlug()`) or by shifts-line number (`resolveFirmByLine()`).
**Decision:**
- **A small REST API** at the platform address only (`https://{APP_BASE_DOMAIN}/api/v1`):
  `PUT` and `GET /sessions/{ref}` (by the planner's own id) and `GET /cancellations` (keyset pages).
  JSON only, at most 64 KB, every body checked by a strict zod schema; errors are
  `{"error": {"code", "message", "request_id"}}` and never echo a value.
- **Signed webhooks out** (12J.2): `booking.created`, `booking.cancelled` (the full record and the
  strike result), `strike.withdrawn` and `test.ping`, signed by the open Standard Webhooks spec, so
  receivers can use its libraries. **The action log is the outbox:** `recordEvent()` queues one
  `webhook-deliver` job (ids only) in the same transaction as each `shift.assigned`,
  `shift.cancelled` and `strike.withdrawn` entry when the firm has an address, so no booking path can
  skip one and a rollback queues nothing; `recordEvents()` refuses those actions. The body is built
  when it is sent, from the rows, by the API's own record builder (so `booking.cancelled`'s `data`
  is `GET /cancellations`' record), and checked against a strict zod contract that
  `docs/integrations.md` prints. The signing secret and event ids are HMACs of `INTEGRATIONS_SECRET`
  (`whsec_…` from the firm and `webhook.signing_version`, which only `app_set_firm_setting()` raises:
  on each add, change, removal and "New signing secret"), never stored and shown once. Delivery is
  from the worker only (`WEBHOOK_TRANSPORT`, `https` in production), through a sender that resolves
  the name, refuses any non-public address (an explicit `BlockList`), connects only to the address it
  checked, follows no redirect and times out at 5 and 10 seconds. Retries are the queue's own (6,
  from a minute, doubling to at most 30 minutes: about an hour); the last try logs `webhook.failed`,
  raises a Needs attention item and completes the job, so a firm's own endpoint never alerts Dylan.
  One firm's deliveries are one pg-boss group, run one at a time on 4 loops of one job each.
- **API keys:** `shiftdesk_` plus 43 random characters, shown once. Only the sha256 and the last 4
  characters are stored, in `api_keys` (forced RLS; the app may read and add rows and change only
  `last_used_at`, `revoked_at` and `revoked_by`; never deleted, since a key's id is the actor on
  what it changed; left out of the firm's export). Admins create (at most 10 live) and revoke.
- **The key decides the firm**, never the host, path or body: `app_api_key_lookup(hash)`, an
  owner-run `SECURITY DEFINER` function like `app_firm_by_line()`, returns only the firm id and key
  id of a key that isn't revoked; the call then runs in `withFirm()`. A key of the wrong shape is
  refused before any look-up, and each web process counts refused keys per client address (30 a
  minute, then 429). Each key gets 300 calls a minute through `throttle()`.
- **Work happens in the request** (an exception to golden rule 3, written into CLAUDE.md): the
  planner needs the answer ("the rules refused this move for 2 casuals"). Each write is one short
  transaction, made safe to repeat by the planner's ref. Offer waves, notices, travel estimates and
  webhooks still go to jobs.
- **A second, narrower caller** of the office's whole-session move and cancel
  (`moveShiftByFirm()`, `cancelShiftByFirm()`): `{ type: "api", keyId }`, checked live in the same
  transaction, allowed only on the API's own sessions, with every failed rules check blocking (no
  person is there to override rest, weekly hours or a day off), `cancel_via` `api` and never a
  strike, logged with the `system` actor and `{ by: "firm", via: "api", keyId }`. The office gets a
  "planner" refusal for those sessions, as it gets "sheet" for the rota sheet's.
- **Gate B** applies: on a live database no key is created and no write is taken until the firm's
  agreement is recorded. With `INTEGRATIONS_SECRET` unset, every call answers 503.
**Amends:**
- **ADR-008** ("no Deputy/Parim plugs planned"): still no adapter per planner, but any planner can
  now connect through this one API and its webhooks, directly or through Zapier, Make or n8n.
- **ADR-011:** a third owner-run look-up before a firm is known, `app_api_key_lookup()`, returning
  ids only and only for live keys. `api_keys` has a `TABLE_ACCESS` entry of `SELECT, INSERT` plus
  three updatable columns, so the app can never rewrite a key's hash or label.
- **ADR-012:** on `/api/v1` the key, not the host, decides the firm. The API answers only on the
  platform address: a firm's subdomain or own domain gets 404. The proxy's trailing-punctuation
  redirect skips every `/api/` path (a 308 would carry the key to another address), and a ref must
  end with a letter or a digit.
**Options:**
| Option | Verdict |
|---|---|
| An adapter per planner (Deputy, Parim, …) | Many integrations to keep up; the firms we sell to first mostly have none |
| Another sheet, or a daily "changes for your planner" email | Ruled out by Dylan |
| OAuth client credentials | More moving parts for small firms and their no-code tools; a revocable key does the job |
| Signed tokens (JWT) instead of stored keys | Can't be revoked at once without a table anyway |
| Doing the API's work in a job | The planner needs the answer in the response |
| Webhooks queued by each booking path itself | One path forgotten would be one planner never told; the log entry already exists on every path |
| An outbox table of its own | A second record of the same change; the action log is append-only and already in the transaction |
| Webhook bodies built when queued | Personal data in the queue (no RLS there), and a retry would send an erased casual's name |
| Our own signing scheme | Receivers would need our code; Standard Webhooks has libraries in most languages |
| pg-boss's default retries (2, no wait) | An endpoint down for a minute would lose the webhook |
**Consequences:** a new machine login path: keys are shown once and never logged (a test checks the
servers' logs for any `shiftdesk_` key or `Bearer`), refused keys and calls are rate-limited, and
each request writes one log line with the route, status, time, firm and key id. Webhooks are a new
way out to an address a firm chooses: it is treated as a secret (host and last 4 characters only on
the page; never logged), and only public addresses are ever reached. A webhook can arrive twice
(receivers drop repeats by `webhook-id`) and out of order (they apply the latest status). Rotating
`INTEGRATIONS_SECRET` changes every firm's signing secret (`docs/runbooks.md`). Planners must send
one ref's PUTs one at a time with no automatic replays (`docs/integrations.md`). **Revisit when:** a
planner needs OAuth or per-key scopes, a firm needs more than 10 keys, or `/api/v2`.
