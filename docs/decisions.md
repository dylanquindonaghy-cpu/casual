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
Twilio numbers natively). Order: web push → WhatsApp → SMS.
**Consequences:** Meta business verification per firm; approved templates for offers and login
links; service messages beyond 1,000 per number per month are charged from 1 October 2026.
**Revisit when:** SMS volume makes Telnyx worth a look.

## ADR-004: Call-to-text by default; AI voice as a paid add-on

**Context:** ~10 calls a day per firm. An AI voice agent costs ~£30/month per firm at that volume
but adds complexity.
**Decision:** Default: short recorded message + instant WhatsApp/SMS link. AI phone line
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
**Decision:** Mobile-first web portal (installable), login by link on WhatsApp/SMS.
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
account, double-booking or site check isn't booked and is logged for the office. The live
transport stays off (`SHEETS_TRANSPORT` is `none` only) until the real service account is
connected.
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
one person. The office's overrides are limited to checks 0 and 6-8 and always carry a reason in
the action log. Bookings relying on the "applied" allowance queue per firm and day, so two
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

