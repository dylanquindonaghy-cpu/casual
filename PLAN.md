# Build plan

Two tracks run side by side: **Build** (Claude Code) and **Sell** (conversations). Selling
starts in week 1, before most of the code exists. Gates stop you building past the point the
evidence supports.

Legend: `[ ]` to do, `[x]` done, `[~]` in progress.

## The pilot, defined

One firm uses the product for real for 4 weeks, paid (£299 upfront), and we can show:

- Shift queries answered: from ~40% unanswered to near 0% (instant portal answers).
- Resourcer time saved per week (self-reported + message counts), normal week vs busy week.
- Share of active workers who used the portal at least once (target 50%+).
- Every offer, change and cancellation logged with timestamps and notice period.

## Time budget

- Pace: 12–15 hours a week, evenings and weekends.
- This plan: ~200–290 hours to a pilot-ready product (~17–21 weeks). The council's narrowest
  pilot was 150–250 hours; this plan also includes the payroll digest, the WhatsApp line,
  firm-initiated change logging (compliance), availability, reminders and GDPR export/delete.
- If time gets tight, cut in this order: call-to-text → payroll digest → fair rotation →
  offline My shifts. Never cut: tenancy, rules engine, event log, notice report.
- Don't trust how fast AI makes you *feel*. A 2025 randomised trial found experienced developers
  were 19% slower with AI tools while believing they were 20% faster. Log real hours below with
  `/log-hours`.

## Timeline

| Weeks | Build | Sell |
|---|---|---|
| 1 | Phase 0: repo, tooling, guardrails | 20 minutes with a contractor contact on how a big contractor manages agency labour. Build a list of 30 target firms. |
| 2–3 | Phase 1: tenancy, data model, login | 10 discovery calls. **Gate A** at end of week 3. |
| 4–6 | Phase 2: roster core, rules, Sheets plug | Follow-ups. Rail/civils warm-lead conversation. |
| 6–8 | Phase 3: staff portal → **clickable demo** | Demo to warm leads. **Gate B.** |
| 8–10 | Phase 4: urgent board, notifications, offer waves | Sign pilot agreement + DPA. Collect baseline numbers. |
| 10–11 | Phase 5: resourcer dashboard, action log, notice report | |
| 12 | Phase 6: payroll queries + digest | |
| 13–14 | Phase 7: WhatsApp shifts line + call-to-text | Meta business verification (can take days). |
| 15–17 | Phase 8: branding, custom domains, deploy (a UK/EU Docker host), GDPR export/delete | Pilot onboarding prep. |
| 18 | Phase 9: pilot hardening, baseline week, go live | Pilot starts. **Gate C** 4 weeks later. |

## Gates

- [ ] **Gate A (end of week 3): demand.** 10 discovery calls done. At least 2 firms say they'd pay
  £299 for a pilot. If zero: stop adding features, revisit the problem with what you heard.
- [ ] **Gate B (after the Phase 3 demo): commitment.** One firm agrees a paid pilot with a written
  agreement (you own the software; they license it; DPA signed). No real data before this.
- [ ] **Gate C (pilot week 4): value.** Unanswered rate near 0%, measurable resourcer time saved,
  50%+ of active workers used it. Then convert to the paid plan and ask for a referral.

---

## Phase 0 — Repo, tooling, guardrails (10–15 h)

**Goal:** a clean, testable skeleton that makes the golden rules easy to follow.

- [x] Next.js + TypeScript strict + Tailwind + ESLint + Prettier
- [x] Docker Compose for local Postgres; `db:up`, `db:migrate`, `db:seed` scripts
- [x] Drizzle set up; first empty migration runs
- [x] Vitest wired to a real test database; Playwright installed
- [x] `src/worker/index.ts` with pg-boss connected and a hello-world job
- [x] `MESSAGING_TRANSPORT=console` transport stub
- [x] `.env.example` filled in; `.gitignore` covers `.env*`
- [x] GitHub repo + CI (typecheck, lint, test on push)

**Done when:** `npm test` and CI pass on a fresh clone; worker picks up a test job.

**Kickoff prompt:**
> Read CLAUDE.md and PLAN.md Phase 0. Propose the exact scaffold (packages, scripts, folders,
> CI file) before creating anything. After I approve, build it, then run /close-task for Phase 0.
> (Phase 0 tasks can only be ticked once verify.sh passes, so they close together.)

## Phase 1 — Tenancy, data model, login (25–35 h)

**Goal:** firms, workers and office users exist; each firm is sealed off; workers log in by a link.
Docs: `docs/data-model.md`, `docs/architecture.md` (Tenancy, Login).

- [x] Schema: firms, office_users, workers, credentials, sites, events, magic_links, sessions, otp_codes
- [x] RLS on every table using `app.current_firm_id`; scoped DB client sets it per request/job
- [x] Host → firm resolution (subdomain now; custom domain later) as middleware
- [x] Worker login: enter mobile → one-time link (15 min, single use, stored hashed) → 30-day session
- [x] OTP step-up (6 digits, 10 min) for pay pages
- [x] Office login: email magic link; roles `admin`, `resourcer`, `payroll`
- [x] Rate limit login requests per number and per IP
- [x] Seed script: the two demo firms in `docs/testing.md` (Acme Events, Northline Rail Labour)
- [x] Structured JSON logging with phone-number masking; request IDs
- [x] Tests: `rls.every-table`, `tenancy.isolation`, expired/used links rejected, events written

**Done when:** a worker from Firm A can never see Firm B data (tested); login works in console mode.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 1, docs/data-model.md and the Tenancy and Login sections of
> docs/architecture.md. Don't code yet. Propose the Drizzle schema, the RLS policies, how the
> scoped client sets the firm, and the tests. Wait for my OK, then implement and run the
> guardrails-reviewer agent, then /close-task for each task.

## Phase 2 — Roster core, rules engine, Sheets plug (30–40 h)

**Goal:** shifts exist, eligibility is decided by tested code, and a firm's Google Sheet can be the source.
Docs: `docs/architecture.md` (Roster plugs, Rules engine), `docs/compliance.md` (Credentials).

- [x] Schema: shifts, assignments, requests, offers, credential_rules (per sector/role)
- [x] `RosterPlug` interface: `listStaff`, `getShifts`, `assign`, `markCancelled`, `canWrite`
- [x] Native adapter (our tables are the rota) — for firms with nothing else
- [x] Google Sheets adapter: service account, column mapping per firm, sync job every 1–2 min
      on event days, batch writes, never read the sheet per request
- [x] CSV/Excel import for workers, credentials and shifts
- [x] Rules engine (pure functions): credential in date for the role; qualification match;
      no overlapping assignment; minimum rest; weekly hours cap; firm "applied" allowance;
      returns `{ ok, reasons[] }`
- [x] Credential packs seeded from `docs/rules-and-credentials.md` (security live; rail and
      construction types present but unused until a firm needs them)
- [x] Credential expiry scan job (30/14/7-day warnings; block on expiry)
- [x] Atomic assign ("first yes wins") + re-check live source before confirming
- [x] Every assign/cancel writes events with `notice_hours`
- [x] Tests: `rules.table` (every case in the doc), `assign.race`, `sheets.sync`

**Done when:** rules tests pass; a seeded Sheet syncs both ways; double-assign impossible under a race test.
Docs: `docs/rules-and-credentials.md`, `docs/api-and-jobs.md`.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 2 and the Roster plugs + Rules engine sections of
> docs/architecture.md. Start with the rules engine as pure functions and a table of test
> cases I can review. Then the RosterPlug interface and native adapter. Sheets adapter last.

## Phase 3 — Staff portal (35–45 h) → clickable demo

**Goal:** the thing you demo on calls. Mobile first. Instant answers.
Docs: `docs/product-spec.md` (Staff stories).

- [x] My shifts (upcoming, past), with site, times, role, instructions
- [x] Open shifts I'm eligible for, with a "Take shift" button (rules + atomic assign)
- [x] Cancel a shift: instant confirmation, reason, notice period recorded
- [x] Request a time change or swap: creates a request for the office
- [x] Allocation mode per firm: first come first served, or fair rotation (fewest hours this week first)
- [x] Pay info page (behind OTP): hours logged, rates, pay dates from imported pay data
- [x] Profile: credentials and expiry (read-only), mark dates unavailable, notification settings
- [x] Blocked-shift screen shows plain-English reasons + "Ask the office to review"
- [x] "My shifts" cached by a service worker (opens with poor signal); "Add to home screen" prompt on iPhone
- [x] Empty and error states written in plain language (see `docs/screens.md`)
- [x] Demo seed: Acme's Saturday event day with an urgent dropout (`docs/testing.md`)
- [x] Playwright: login → take shift → cancel → request → pay OTP

**Done when:** on a phone, a fake worker can log in, take and cancel shifts in under 30 seconds each,
and you can run the demo script from `docs/testing.md` on a call.
Docs: `docs/screens.md`.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 3 and the staff user stories in docs/product-spec.md. Propose
> the pages, components and server actions. Mobile-first, plain English copy, sign system
> messages as "[Firm] Shift Team". Build the demo seed last.

## Phase 4 — Urgent board, notifications, offer waves (27–37 h)

- [x] Urgent flag on shifts (manual or automatic when a dropout lands inside X hours)
- [x] Urgent board page for workers (only shifts they're eligible for)
- [x] Offer waves (pg-boss): best 3–5 eligible, wait 15 min, next wave; stop when filled;
      escalate to resourcer at start minus X hours (all firm-configurable)
- [ ] Web push (VAPID); iPhone push only works when the portal is added to the home screen, so
      show an "Add to home screen" prompt
- [ ] WhatsApp utility templates via Twilio for urgent offers; SMS fallback; quiet hours
- [x] Only eligible workers are ever notified; max 3 offers per worker per day unless urgent
- [x] Shift reminders 24 h and 2 h before start (cuts no-shows)
- [ ] All copy from `docs/messaging-templates.md`; templates submitted to Meta for approval
- [x] Tests: `waves.timing`, `notify.policy`, stop-on-fill, no notifications to ineligible workers
Docs: `docs/messaging-templates.md`, `docs/api-and-jobs.md` (offer-wave ranking).

## Phase 5 — Resourcer dashboard, action log, notice report (23–33 h)

- [x] Today view: gaps, urgent shifts with wave status, fresh cancellations with notice hours,
      pending requests, credential expiries this week, quick actions
- [x] Shifts: create/edit, bulk create for an event, CSV import, manual assign with logged override
- [x] **Firm-initiated cancel / move / curtail**: reason required; notice hours logged per assigned
      worker; workers notified (compliance-critical, see `docs/api-and-jobs.md`)
- [x] Mark no-show / completed
- [x] Approve/decline requests (time changes, swaps, availability, general) with a note → worker notified
- [x] Action log with filters (worker, shift, date, type)
- [x] Notice and cancellation report: every offer/change/cancel with timestamps, initiator and
      notice hours; short-notice flag at a firm-set threshold (final 2027 rules still pending); CSV export
- [x] Pilot metrics page: baseline entry form + daily rollup job (`docs/pilot-playbook.md`)
- [x] Tests: `notice.report` (worker cancel, firm cancel, move, curtail)
Docs: `docs/screens.md`, `docs/pilot-playbook.md`.

## Phase 6 — Payroll queries and digest (12–18 h)

- [x] Pay query form: shift/date, issue type (missing hours, wrong rate, late pay, other), details
- [ ] Group queries by likely cause (same rate change, same site, same week) — Haiku summarises,
      code does the grouping keys
- [x] Digest to payroll by email at a set time: "42 queries, 37 about the new rate not applied
      to 12 Sep shifts" with the list attached
- [x] Worker sees status updates; AI never answers a dispute
- [x] Pay records CSV import (period, hours, rate, gross, pay date)
- [x] Tests: `pay.grouping` (stable keys; AI failure falls back cleanly)

## Phase 7 — WhatsApp shifts line and call-to-text (15–20 h)

- [ ] One business WhatsApp number per firm ("the shifts line") via Twilio
- [ ] Inbound WhatsApp: known worker → reply instantly with the right link (keywords first:
      shifts, cancel, pay, help; Haiku only for unclear text)
- [ ] Unknown number → polite reply + office alert
- [ ] Call-to-text: short recorded message, then WhatsApp/SMS with the link; optional voicemail
      transcribed into a request
- [ ] STOP handling for SMS; opt-out respected in the notification policy
- [x] Signature checks on all Twilio webhooks; idempotent storage
- [x] Tests: `webhook.idempotent`, signature contract tests with real Twilio sample payloads
Docs: `docs/api-and-jobs.md`, `docs/messaging-templates.md`.

## Phase 8 — Branding, custom domains, deploy (18–28 h)

Docs: `docs/architecture.md` (Deployment, Custom domains).
- [x] Per-firm logo, colours and name; replies signed "[Firm] Shift Team"
- [x] Custom domains: firm adds a CNAME (e.g. `shifts.firmname.co.uk`); Caddy on-demand TLS with
      an `ask` endpoint that only approves domains in the firms table
- [ ] Server: a UK or EU Docker host + managed Postgres 16, static IP, ports 80/443 only (AWS
      ruled out on 2026-10-06: ADR-021)
- [ ] Docker Compose (web, worker, caddy); GitHub Actions deploy
- [ ] Backups on, restore tested; £50 billing alert; uptime check; error alerts to you
- [ ] Twilio fallback: if the app doesn't answer, calls forward to the manager's phone
- [x] GDPR: worker data export (JSON + CSV) and delete; firm data export; retention purge job
- [ ] Alerts to your phone: job failures, health down, Twilio error spikes, sync errors
- [ ] Runbooks in `docs/runbooks.md` tried once for real (deploy, rollback, restore)

## Phase 9 — Pilot hardening and go live (10–15 h)

- [x] Onboarding checklist for the pilot firm (see docs/go-to-market.md)
- [ ] Import real workers/credentials/shifts **only after** Gate B paperwork is signed
- [ ] Privacy notice line supplied to the firm (see docs/compliance.md)
- [ ] Pre-pilot checklist in `docs/testing.md` all ticked
- [ ] Baseline week recorded (`docs/pilot-playbook.md`)
- [ ] Run a dry-run event day with the resourcer
- [ ] Week-by-week pilot metrics review and the week-4 report

## Phase 10 — Audit fixes and local walkthrough (30–45 h)

Added 2026-10-03 at Dylan's request. An independent audit of `build/overnight` (2026-09-30) found
no high-severity problems, but 27 medium and 93 low ones. Fix them, then make the app ready for
Dylan to walk through on his own computer before he creates the AWS and other accounts. Each task
names its findings (M = medium, L = low). The evidence, with file:line references, is in
`docs/audit-2026-09-30.md`. Re-read the cited code before fixing, because lines may have moved.
No outside accounts are needed for any task here.
Docs: `docs/audit-2026-09-30.md`, plus the docs each finding cites.
Done when: every M and every assigned L is fixed with a test that would have caught it, or is
parked with a reason Dylan can see; Dylan can follow `docs/walkthrough.md` on his own machine and
every step works.

- [x] Offer waves never hold the shift lock while sending: pick and record the offers in one
      short transaction, then send outside it, then record each send (claim → send → record, as the
      reminders do). "Take shift" and the office's "Assign" on the same shift finish within 2 s
      while a 300-worker wave sends through a slow fake transport (test). Correct the Parking lot's
      "fine at pilot size" note. (M18, M19, M20, L17, L19, L72, L77)
- [x] When a shift fills, every other open offer on it is closed, in every mode (first come first
      served, after the last fair-rotation wave, office placement): the taker's offer `accepted`,
      the rest `filled_elsewhere`, logged, with a test per mode (M5)
- [x] No message is sent twice when a job retries: office offers, escalation (per recipient, so
      one bad address doesn't stop the rest and `shift.escalated` is still recorded), the credential
      scan, login links and codes, firm-change notices and request updates use claim → send →
      record. A test fails each job after its send and checks the retry sends nothing. (M10, L33)
- [x] A Twilio-shaped message id (`SM` + 32 hex characters) never makes the action log refuse an
      event after a message has gone: every sender is tested with Twilio-shaped ids (M12, L46)
- [x] Speed at pilot size: inbound replies keep a written bound when each send takes ~300 ms (load
      smoke with a slow fake transport; per-worker order kept); a worker crash strands no batch for
      15 minutes; Open shifts and the urgent board make a bounded number of queries; missing indexes
      added; the "about a second" claim corrected in the docs (M14, L42, L51, L55, L63, L73, L74,
      L75, L76)
- [x] Office access can be taken away: an admin can disable, re-enable and change the role of an
      office user (Team screen and `firm:office-user`). Disabling ends their sessions and login links
      at once, re-enabling doesn't revive old sessions, and every change is logged. (M21, L80)
- [x] Worker leavers and blocks: the office can deactivate, reactivate and unblock a worker
      (reason required, logged) and block a worker from a site (the inert rule 9 store). A worker
      made inactive or blocked by any path gets no reminders. Their future bookings are flagged on
      Today for the office to cancel (golden rule 12) or keep. A mobile change ends old links and
      push subscriptions. (M22, M23, L24, L81)
- [x] Notice hours for a move or curtailment count from the earlier of the old and new start
      (office editor and Sheets sync), so the notice report's short-notice flag never hides short
      notice. The move re-check takes the worker lock. Tests in `notice.report`. Update the
      "Dylan to confirm" note. (M6, M25, L21)
- [x] Sheets sync follows the office editor's rules: a role, time or site change to a booked shift
      re-checks the people booked (refused → not applied, flagged for the office); a started shift
      is never re-timed or cancelled by a sync (ADR-013); refused names aren't silently erased from
      the firm's sheet. Tests for each. (M1, M2, L12)
- [x] Sheets, said honestly: Google is in the accounts-to-create list and the blocked table; the
      env and worker comments are corrected; the "Connect the real Google Sheets" steps match the
      code; sheet dates are read as serial numbers, or a non-UK sheet locale is refused with a plain
      message; a sheet is bound to its firm. (M3, M17, L45)
- [x] Imports read what the file says: an Excel date with a time near midnight keeps its day; a
      pay amount with a space inside ("12 50") is refused, not read as £1,250; re-importing never
      reopens a shift the office marked filled (`shift.reopened` logged when it legitimately
      reopens); a Windows Excel CSV (Windows-1252) imports or gets a plain message; a row without a
      Staff ID never renames or re-attaches a different worker; dates, times and mobiles are checked
      the same way on every import path; the office imports respect the Gate B guard. (M11, M15,
      M16, L39, L67, L68, L69, L70, L71, L78)
- [x] The offline My shifts copy is gone after logout: logging out or in while a page is still
      loading leaves no copy on the phone; a slow but working connection shows the fresh page; a
      kept copy from an older build can still log out; logging out with no signal says what happened.
      Service-worker tests with a slow network. (M27, L90, L91, L92, L93)
- [x] The retention purge and privacy wording match the spec: per-firm retention settings with the
      spec's defaults and a hold for disputes; open or escalated requests keep their words until
      closed; replies newer than the cut-off are kept; the office's override reason is not typed
      into the append-only log; `docs/compliance.md`, `docs/privacy-notice.md` and the data page
      say exactly what a deletion removes and keeps. New choices marked "Dylan to confirm".
      (M24, L23, L30, L41, L85, L86, L87)
- [x] "Try again" on the error screens really retries (Next 16 `retry()`), proven by a browser test
      that fails a page once and recovers (M4)
- [x] A firm's own domain holds a login: a worker or office user who starts on the firm's domain is
      sent a link back to it and stays logged in there; an e2e test logs in on a custom host
      (M7, L84)
- [x] Logs are safe and checked: request paths and log strings are capped before masking, and
      every masking pattern runs in linear time (timing tests); the e2e log scan also catches
      numbers before a full stop and login tokens; regression tests for the search and token
      fixes; the "destination stream closed early" error seen on every e2e run is explained and
      fixed, and unexpected server errors fail the run (M13, L11, L52, L53, L54, L64)
- [x] Deploy and runbooks work as written: `deploy.sh` applies `.env` changes and starts a newly
      enabled worker; the runbook trial is moved to after SES and Twilio, with a test-firm step, so
      its checks can pass; the Caddyfile is checked by Caddy itself; HSTS is sent; database TLS is
      on in the production settings; runbook steps match the scripts (M8, M9, L29, L38, L43, L50)
- [x] Every decision waiting for Dylan is in one place: a "Decisions waiting for Dylan" section in
      `PLAN.md` lists each open decision once (from `PLAN.md`, the decision tables in
      `docs/overnight-log.md`, `docs/compliance.md` and `docs/privacy-notice.md`), grouped, with the
      safe default now in force. The Parking lot steps say who does each step (Dylan, or Claude
      after Dylan), and stale references are fixed. (M26, L13, L36, L37, L59, L60, L89)
- [x] Walkthrough polish: the low findings a walkthrough would hit (L7, L8, L10, L15, L18, L20,
      L22, L28, L31, L32, L40, L44, L47, L49, L79, L82, L83). This includes: an office-placed worker
      is told they're booked; login links aren't followed by a full stop; an office cancellation
      for "the client needs fewer staff" doesn't re-offer the place; `npm run build` logs no brand
      errors; the action log shows per-firm numbers
- [x] Local walkthrough pack: `docs/walkthrough.md` gives Dylan numbered steps on Windows + WSL
      (Docker Desktop, the folder, `db:up`, `db:reset`, `dev`, which browser, the production-mode
      run with `npm run build`) to try every screen as a worker and as admin, resourcer and payroll.
      A dev-only fake phone (`npm run sim:*`) sends signed WhatsApp, SMS and call webhooks to the
      local server, and outbound messages show in the terminal. The demo seed covers every screen
      and state the walkthrough visits. It includes a "found a bug" template. A browser test,
      `walkthrough.spec.ts`, runs every step, with the office at desktop size. (L16, L25, L58, L66,
      L88)

## Phase 11 — UI clarity and how-to guides

Added 2026-10-05 at Dylan's request: "the UI needs to be worked on a lot … make it a lot easier to
see and understand where everything is; also put in a how-to guide page to learn the basics."
Layout, hierarchy, colour and two guide pages only. Every existing word on every screen stays as
it is (tests pin them); new words are listed in `docs/screens.md`. No schema, auth, rules or
messaging changes.
Docs: `docs/ui-design.md`, `docs/screens.md`
Done when: every logged-in office page sits in one shell with the same menu and the current page
marked; every page opens with a header that names it; status words carry their tone and an icon;
Today opens with counts, its sections in the order things need doing; `/office/guide` and `/help`
explain the basics; every existing test passes unchanged; `scripts/verify.sh` with `RUN_E2E=1`
prints VERIFIED.

- [x] Design tokens and shared components: the colour tokens, focus ring and file-input button in
      `src/app/globals.css`; `src/app/ui/` (`classes.ts` for buttons, fields, cards, rows, chips and
      tables; `StatusChip`; `PageHeader`; `Icon`), dependency-free and hook-free
- [x] Office shell and menu: `src/app/office/layout.tsx` puts every logged-in office page in one
      shell. The menu is grouped, shows only what the role can open (`canAccess`), marks the current
      page (`aria-current`), and is a sideways-scrolling row on a phone. The footer holds the name,
      role, the one "Log out" and the session keeper. An office not-found page keeps the menu. Tab
      titles read "{page} · {firm} shifts". (`tests/unit/office.shell.test.ts`)
- [x] Today: a summary of counts at the top, each a link to its section; the sections in the order
      things need doing; urgent shifts as action cards, long lists as compact rows
      (`tests/unit/office.today-summary.test.ts`)
- [x] Office screens restyled to `docs/ui-design.md`: shifts (list, new, event, import, one shift,
      offer), requests, workers, action log, notice report, pilot metrics, pay queries, import pay
      records, office team, data requests, office login
- [x] Staff screens restyled: My shifts ("See open shifts" always on the page, a "Help" link, the
      Upcoming / Past 30 days switch looks like a switch), open shifts, the urgent board, one shift,
      cancel, requests, pay, pay query, profile, login and the error pages
- [x] `/office/guide` ("How-to guide" in the menu): the everyday jobs step by step, in the order of
      a working day, showing only the parts the user's role can open (`tests/unit/guides.test.ts`)
- [x] `/help` for workers: how it works in plain words, readable without logging in, checked by
      `tests/unit/copy.plain-language.test.ts`. No shifts-line number or privacy notice link yet
      (both in the Parking lot)
- [x] Docs: `docs/ui-design.md`; `docs/screens.md` (the office shell, Today, both guides, every new
      string); `docs/walkthrough.md` (where the office's "Log out" is now)

## Phase 12 — Compact office and casual app v2

Added 2026-10-06 at Dylan's request: a compact office that sits beside each firm's own planner and
CRM instead of copying them, built to the approved mock-up ("ShiftDesk Office Mock-up"), and "give
the casuals a status of their qualifications too and if anything needs updating and their staff
picture last time uploaded … shifts available to them need to be limited by their location … so if
'zoe' sees she has shifts she can apply for urgently or not it shows how far it is from her AND how
long it'll take via car or public transport". Trimmed the same day on his word, "it needs to be
debloat not pro bloat": only what he asked for, plus what the law requires; everything cut is one
line each in the Parking lot ("Phase 12 cuts (2026-10-06, Dylan: debloat)"). Also on 2026-10-06 he
took the recommended defaults for D1–D4, D7 and D8 (§8), approved database changes S2 to S10 (S1
was already approved), ruled out AWS (ADR-021: email over SMTP, Claude through the Anthropic API,
any UK/EU Docker host), and asked for planners to plug in "using webhooks and apis not another
sheet", which replaces D5 (an API in, signed webhooks out; no new sheet features); D6, booking by
reply number, is deferred. The spec is `docs/office-v2.md`: "§" in a task always means a section
of that file, the id at the end of a task (such as "12A.1") is its row in the file's §9, and §1.1
describes the mock-up in words because builders can't open it. S11 (§5.1, "How the build is run"
19), the planner integration layer, is an auth and schema change: Dylan approved it on 2026-10-06
("Yes, add S11"). Every
task that touches schema, auth or tenancy still shows Dylan its short plan first (CLAUDE.md "How
to work each task" step 2). Each task adds the demo-seed rows its own screens and tests need
(made-up data only, golden rule 7), keeps every test green (a task that moves a page or menu link
updates the specs and walkthrough steps that use it; §10 lists each test that changes because the
product changes, and none is weakened) and updates the docs it changes. Close Phase 11's tasks
first (Checks 18), because this phase replaces the shell and Today they pin. Real emails, AI
sorting and WhatsApp still wait for "Connect an email provider (SMTP)", "Connect the Anthropic API"
and "Connect Twilio" (Parking lot).
Docs: `docs/office-v2.md`, plus `docs/screens.md`, `docs/ui-design.md`, `docs/data-model.md`,
`docs/messaging-templates.md`, `docs/rules-and-credentials.md`, `docs/compliance.md`,
`docs/api-and-jobs.md` and the new `docs/integrations.md`, as each task names them
Done when: every logged-in office page sits in the v2 shell (a sidebar at 1024px and wider, a
drawer below that; light and dark) with each role's menu as in §3.1; no casual's screen or
shifts-line reply shows a hidden event or session, or a shift outside their travel area (a direct
link still opens), and offer waves skip both; every shift a casual sees in the app (Home, Open,
Booked, `/urgent`, the shift page) and in shifts-line replies shows the distance and the time by
car and by public transport, or says why it can't; a casual's cancellation under 48 hours records
the strike in the same transaction as the cancellation, with the warning they saw, and the
evidence goes only to a confirmed strikes-team address; casuals see a status on every
qualification and on their staff photo; a planner can push sessions with an API key and receives
signed webhooks for bookings, cancellations (the full record) and strike withdrawals; no AWS
dependency is left in the code, the image, the deploy files or the docs that describe the current
stack (a test holds the code side); every new table has isolation tests; `scripts/verify.sh` with
`RUN_E2E=1` prints VERIFIED and `npm run e2e:walkthrough` passes on the production build. A task
still waiting for Dylan's OK stays unticked, with the reason in the Parking lot.

- [x] The mock-up in the repo (Checks 17, OK'd 2026-10-06): `docs/mockups/office-v2.html`, the
      approved mock-up with made-up data only and its role-switch control labelled "mock-up only";
      §1.1 stays as its description in words. Tests: new `tests/unit/repo.made-up-data.test.ts`
      fails on any email address in `src/`, `drizzle/`, `tests/`, `docs/` or the seed outside the
      reserved example domains (`.example`, `example.com`, `example.org`, `.test`, `.invalid`,
      `.localhost`, with a short reviewed allow-list for strings that only look like one), and on
      any postcode in the mock-up outside `ZZ` (an employer's name can't be tested for without
      writing it into the repo, so a person checks that once) (12A.0)
- [x] Remove AWS from the image and deploy (§5.8; ADR-021): delete `deploy/lightsail.sh`,
      `deploy/alarms.sh` and `deploy/restore-drill.sh` and the tests that only test them
      (`tests/unit/deploy.monitoring.test.ts`, and the Lightsail part of
      `tests/unit/deploy.lightsail.test.ts`, whose `cloud-init.sh` tests move to a new
      `tests/unit/deploy.cloud-init.test.ts`): removing a feature Dylan cancelled, not weakening a
      test, so do it in a normal session (not overnight) and record why in the task's decisions; the
      `Dockerfile` stops fetching Amazon's RDS certificate bundle, and the database's CA file comes
      from the host at `/app/db-ca.pem`, mounted read-only by `deploy/docker-compose.yml`
      (`src/lib/env.ts`, `src/lib/db/tls.ts` comments, `deploy/env.example`); the dead AWS lines in
      `.env.example` (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_*`,
      the "Lightsail master user" note) replaced by §5.8's email and AI settings; the AWS comments
      in `src/` reworded (Bedrock, SES and Lightsail in `src/lib/ai/client.ts`,
      `src/lib/pay/digest.ts`, `src/lib/inbound/reply.ts`, `src/lib/office/pay-query-groups.ts`,
      `src/lib/auth/send-portal-link.ts`, `src/lib/db/admin/{roles,bootstrap}.ts`,
      `src/lib/db/tls.ts`, `src/lib/env.ts`), and the Lightsail comments in `docker-compose.dev.yml`
      and the kept `deploy/cloud-init.sh`. Tests: new `tests/unit/no-aws.test.ts` (fails on an AWS
      SDK in `package.json`, an `aws` command, or a match for
      `/\b(aws-sdk|@aws-sdk|amazonaws\.com|AWS_[A-Z_]+|BEDROCK_[A-Z_]+|rds-ca\.pem|lightsail|bedrock)\b/i`
      in `.env.example`, `deploy/env.example`, `docker-compose*.yml`, the `Dockerfile`, `deploy/`,
      `src/` or `CLAUDE.md`; history docs (work log, overnight log, audit, Hours log) excluded);
      `tests/unit/deploy.database-tls.test.ts` pins `/app/db-ca.pem`, the compose mounts and nothing
      fetched from Amazon; `tests/unit/imports.gate-b.test.ts` takes a non-AWS example host;
      `guardrails-reviewer` (database TLS). Docs: `CLAUDE.md`'s repo layout (`ai/  # Anthropic
      client behind AiClient, prompts, zod-validated outputs`; `messaging/  # transport interface:
      console (dev) | twilio for phones, SMTP for email; templates`), first, so no later builder
      reads "Bedrock client"; `docs/architecture.md` (stack, diagram, deployment);
      `docs/api-and-jobs.md` (the Stage 2 row becomes "`POST /api/webhooks/email`: the chosen
      provider's inbound webhook"; "Connect Bedrock" becomes "Connect the Anthropic API");
      `docs/messaging-templates.md` ("SES later" becomes "SMTP"; Bedrock becomes "the Anthropic
      API"); `docs/screens.md:138` ("email (SES)"); `docs/runbooks.md` ("Set up the server (once)"
      for any UK/EU Docker host; restore and the restore drill for the host's managed Postgres, or a
      `pg_dump` as the `postgres` superuser for Postgres in Compose (ADR-011 as amended); monitoring
      as an outside uptime check plus the host's own alerts), `docs/compliance.md`,
      `docs/privacy-notice.md`, `docs/business.md`, `docs/product-spec.md` (12X.1)
- [x] Email over SMTP (§5.8): `SmtpEmailTransport` in `src/lib/messaging/smtp.ts` (nodemailer;
      email only), which `getTransport()` (`src/lib/messaging/index.ts`) uses for email when
      `EMAIL_TRANSPORT=smtp`, WhatsApp and texts unchanged; worker-only settings
      `EMAIL_TRANSPORT` (`console` by default and refused in production; `smtp` refused when
      `NODE_ENV=test`), `SMTP_HOST`, `SMTP_PORT` (465 means implicit TLS, any other port requires
      STARTTLS: never plain text), `SMTP_USER` and `SMTP_PASS`, `SMTP_FROM`; §5.8's transport
      settings (`connectionTimeout` 10000, `greetingTimeout` 10000, `socketTimeout` 30000,
      `logger` and `debug` false, TLS 1.2 or later with certificates checked); an
      `EmailNotSentError` for a failure or timeout before the message was accepted (connecting,
      EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO: safe to retry), anything during or after DATA
      re-thrown as "may have arrived"; attachments widened to CSV and PDF
      (`src/lib/messaging/transport.ts`: bytes or base64, a limit per type, at most 3, about 7 MB
      in total); `EMAIL_TRANSPORT` `console` and `SMTP_PASS` empty pinned in `serverEnv()`
      (`playwright.config.ts`) and `tests/setup/env.ts`, because both load `.env`. Real sending
      waits for "Connect an email provider (SMTP)". Tests (no network): the TLS settings for each
      port and every setting above pinned; a fake server that stalls after DATA gives "may have
      arrived" within the socket timeout, and one that stalls before it gives `EmailNotSentError`;
      message mapping through nodemailer's JSON transport (from, to, subject, body, a CSV and a PDF
      attachment); error mapping before and after the message is accepted; routing (email to
      SMTP, phone messages unchanged); settings (`smtp` without a host or sender refused;
      `console` refused in production; `smtp` refused under `NODE_ENV=test`; `SMTP_PASS` never
      given to the web app, pinned on `deploy/docker-compose.yml`);
      `tests/unit/messaging.console.test.ts` unchanged; `guardrails-reviewer` (messaging). Docs:
      `docs/runbooks.md` ("Email not arriving"), `deploy/env.example`, and CLAUDE.md's convention
      "Never hit Twilio from tests" widened to "never hit Twilio, an SMTP server, Anthropic,
      TravelTime, postcodes.io or a planner from tests", with the matching check in
      `scripts/invariants.sh` (12X.2)
- [x] Claude through the Anthropic API (§5.8): `AnthropicAiClient` in `src/lib/ai/anthropic.ts`
      (the official `@anthropic-ai/sdk`) behind `AiClient`, and `getAi(env)` returning `noAi`
      unless `AI_TRANSPORT=anthropic`; worker-only settings `AI_TRANSPORT` (`none` by default;
      `anthropic` refused when `NODE_ENV=test`, and `none` with an empty `ANTHROPIC_API_KEY` pinned
      in `serverEnv()` and `tests/setup/env.ts`), `ANTHROPIC_API_KEY` (passed to the client, never
      read from `process.env` inside it) and
      `AI_MODEL` (default `claude-haiku-4-5`; check the id with the `claude-api` skill when
      building); a 5-second timeout with an `AbortSignal` and no retries; it logs purpose, model,
      tokens and stop reason, never the prompt or the answer; any error, refusal or empty answer is
      `AiUnavailableError`, so the code's fallback runs; wired into the shifts-line reply job
      (`src/lib/inbound/reply.ts`) and the payroll digest (`src/lib/pay/digest.ts`), both on `noAi`
      today. Real calls wait for "Connect the Anthropic API". Tests (a fake `fetch` given to the
      SDK, no network): a text answer comes back; 429, 5xx, a timeout, a refusal and empty content
      each throw `AiUnavailableError`; `AI_MODEL` is sent and nothing is retried; nothing is logged
      beyond purpose, model, tokens and stop reason; the settings checks (including `anthropic`
      refused under `NODE_ENV=test`);
      `tests/unit/ai.boundary.test.ts` lists `anthropic.ts` and still forbids the SDK outside
      `src/lib/ai/`; the pay-summary and classifier fallbacks unchanged; `guardrails-reviewer`.
      Docs: `docs/architecture.md` (AI use), `deploy/env.example` (12X.3)
- [x] Colours and theme (§3.1; D7 navy): light and navy dark colour tokens in `src/app/globals.css`
      with §3.1's contrast fixes; no hard-coded colours left (29 `bg-white` in 16 files under
      `src/` today); an `sd-theme` cookie (`light` or `dark`; none means follow the device) read in
      `src/app/layout.tsx` into `data-theme` on `<html>`, so nothing flashes on load, plus
      `<meta name="color-scheme">` and a `prefers-color-scheme` block for the device setting
      (there is no dark mode today); Plus Jakarta Sans self-hosted with `next/font` (nothing
      fetched from Google while running); one type scale, fixed-width digits. Tests: new
      `tests/unit/ui.contrast.test.ts` (every token pair meets its ratio in both themes); a
      theme-cookie test; `tests/e2e/brand.spec.ts` unchanged. Docs: `docs/ui-design.md` (12A.1)
- [x] Office shell and menu (§3.1): one server-rendered `<nav>` of real links: a 272px sidebar at
      1024px and wider; below that a "Menu" button opening the same links in a native `<dialog>`
      drawer (Escape and the backdrop close it, focus returns to the button, a closed drawer can't
      be tabbed into, no `menu` roles); the v2 groups (Operations, Pay, Records, Configuration,
      Help) holding today's pages, each later task adding its own link; the current page and its
      parent marked (`aria-current`); badge counts outside the link's name; the top bar: the Menu
      button (phones), ShiftDesk's own mark with the firm's name under it (no reference-portal logo
      or colours), the moon/sun button (a visible tooltip; it sets `sd-theme`), and the account
      button (initials, name, role) opening How-to guide and Log out; "Data requests (download or
      delete)" renamed "Data requests". Tests: `tests/unit/office.shell.test.ts` rewritten (the
      phone row's edge-arrow tests go with the row), `tests/unit/office.roles.test.ts`, new e2e
      `office.shell.spec.ts` (the drawer opens, Escape closes it and focus returns to the button,
      no tabbing into it when closed; the theme button switches the theme and keeps it after a
      reload with no flash; the account button shows the name and role; the spec runs in both
      themes), and a `menuLink(page, name)` helper in `tests/e2e/fixtures.ts` used by every spec in
      §10 that clicks the menu. Docs: `docs/screens.md` office shell (12A.2)
- [x] Pay dashboard (§3.8; D8): `/office/pay` with the firm's shifts-line number under its header
      (as on today's `/office`), its four counts and two sections ("Waiting, grouped by likely
      cause" and "Recently sorted"), and payroll's home (`/office` sends payroll there);
      `nextDigestAt()` beside `digestDueOn()` in `src/lib/pay/digest-schedule.ts`; the top bar's
      pay-week pill from one pure function in a new `src/lib/pay/pay-week.ts` (the ISO week,
      Monday to Sunday, paid the Friday after: "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct"; hidden
      on phones); the Pay queries menu badge; payroll still never sees strikes; resourcers never
      see pay record figures (Office 2), though session pay rates show to them on event cards and
      records (§3.8). Tests: unit tests for `nextDigestAt()` and the pay week (a 53-week year, the
      clock change); a loader integration test; new e2e `office.pay-dashboard.spec.ts` (including
      the shifts-line number) replacing the payroll placeholder check in
      `tests/e2e/office.today.spec.ts`. Docs: `docs/screens.md` (12A.3)
- [x] Events and session fields (§3.3, §5.1 S1's core and S2, approved; one migration): the
      `shift_events` table (RLS, `TABLE_ACCESS`, isolation fixtures), `shifts.event_id`, and S2's
      `pay_rate_pence`, `post`, `meeting_point`, `uniform`, `required_credentials` and session
      showing switch on `shifts`; the migration groups existing shifts by date and site into
      automatic events ("Acme Demo Arena · Sat 10 Oct"), and the sheet sync and the file import do
      the same for new rows, with no new sheet or import columns (Dylan, 2026-10-06), so every
      session has an event; "Shifts for an event" creates the event row; events are never deleted,
      only hidden; the switches are ShiftDesk's own, never read from or written to a planner; the
      office shift editor (`src/lib/office/shift-editor.ts`) and "Shifts for an event" gain the S2
      fields, including on sheet and file sessions, whose sync and import never touch them; the
      editor's `shift.changed` entry names the changed fields in §6.1's shape (`requirements`,
      never a field name holding "credential", which the log masker refuses). Tests: isolation;
      the backfill, and automatic events from the sync and the import; a sync or import never
      changes a switch or an S2 field; a `shift.changed` entry for every new field passes the log
      check; pay in whole pence ("12 50" still refused); `guardrails-reviewer`. Docs:
      `docs/data-model.md`, `docs/screens.md` (12B.1)
- [x] Session requirements and CSAS (§3.3): a session's `required_credentials` are checked on top
      of the role's, each valid until the session ends (`src/lib/roster/eligibility-input.ts`,
      `src/lib/rules/eligibility.ts`); CSAS and manual handling qualification types and a
      `csas_officer` role in the security pack (`src/lib/rules/packs.ts`). Tests: rules unit tests
      (an extra requirement refuses a casual without it and allows one with it; one expiring
      mid-session refuses), the rules-doc parity test, `tests/unit/credential.packs.test.ts`;
      `guardrails-reviewer` (rules). Docs: `docs/rules-and-credentials.md`, including that CSAS
      accreditation belongs to the firm's own scheme (§3.7) (12B.3)
- [x] What casuals see: the event and session switches everywhere (§3.3 "What a switch does"): a
      `setShowing()` action for admins and resourcers on an event or a session; one
      `visibleToCasuals` check (the event's switch and the session's) used by open shifts, the
      urgent board, the Home count, the shift page (it says the shift isn't available),
      `bookShift` (refuses a casual; the office can still assign), offer waves and dropout waves,
      and personal replies once 12D.2 lands; booked casuals keep their bookings; `event.shown`,
      `event.hidden`, `session.shown` and `session.hidden` logged with who, with words in
      `log-types.ts` and `event-words.ts` (`src/lib/portal/open-shifts.ts`, `shift-detail.ts`,
      `src/lib/roster/book.ts`, `src/lib/offers/`, `src/lib/roster/urgent.ts`). Tests: one
      parameterised integration test per path (open shifts, the urgent board, the Home count, the
      shift page, `bookShift`, no wave starts, a booked casual keeps the shift, the office can
      still assign), run for a hidden event and for a hidden session inside a showing event; the
      whole-log words test; `guardrails-reviewer` (12B.4)
- [x] Events & sessions pages (§3.3): `/office/events` (All, Showing, Hidden, Urgent not filled,
      as links) and `/office/events/[id]` (sessions, booked casuals, "Mark who worked"); event
      cards with the event switch, a uniquely labelled switch per session on the event page, one
      status tag, and "Hidden from casuals. Booked casuals keep their shifts." after switching
      off; each session row: role, start–end, "Urgent" on an urgent gap, a chip per requirement
      (SIA DS, CSAS, First aid), "N/M filled", £/hour, post, meeting point and uniform; the "…"
      menu reaching today's offer, assign, urgent, change and cancel forms (a sheet session still
      refused as a whole); "Add shifts" and "Import shifts" for firms without a planner; "Events &
      sessions" replaces "Shifts" in the menu (the shift routes stay). Tests: unit tests for card
      text, switch labels and a session row with every field; a resourcer sees a session's £/hour
      but never a pay record's amount; new e2e `office.events.spec.ts` (switching an event off
      hides it from a casual's open shifts; switching it back on brings it back);
      `office.shifts.spec.ts` follows the menu change. Docs: `docs/screens.md` (12B.5)
- [x] Settings (§3.10; S10, approved, built narrower): an owner-run database function,
      `app_set_firm_setting(key, value)` (a migration; `SECURITY DEFINER` like migration 0034's),
      the only way the app may change `firms.settings`: it accepts only `strikes.email` and
      `strikes.email_verified_at`, refuses `retention.*` and every other key, and clears the
      confirmed time whenever the address changes; `/office/settings` (admin only, checked on the
      server) with two sections: the strikes-team email, confirmed by a signed (HMAC) link valid
      for 7 days that signs the firm id, the address and the expiry, and evidence only ever to a
      confirmed address; and the Sites list with each site's postcode editable (the location
      status joins with 12G.1), a change refused while the site has live bookings on sessions
      still to come ("{n} booked sessions use this site: move them first");
      `firm.settings_changed` logged with the key only for the address and its confirmed time, and
      `site.changed` with the site id and field name only (§6.1); the other Phase 12 values stay
      with the owner command `firm:settings` (§5.2). Tests: only admins
      can write; the app's login can't change `retention.message_days`, `retention.hold_until` or
      any key outside the list, directly or through the function; a tampered or expired link is
      refused, and a link sent for one address doesn't confirm a later one; a site's postcode
      change is refused while it has live future bookings and allowed without them; every entry
      passes the log check; isolation; `guardrails-reviewer` (auth). Docs: `docs/data-model.md`,
      `docs/compliance.md` (retention still owner-only), `docs/runbooks.md` onboarding (12B.7)
- [x] Strikes on cancel (§3.5, §4.5; S3 and S4, approved, S4 built narrower; Legal 16): the
      migration (S3's `cancel_via` and warning columns on `assignments`; the `strikes` table; an
      owner-run `app_purge_old_strikes()` like `app_purge_old_messages()` in migration 0034, because
      the app can't delete strike rows); a pure `strikeDecision()` in `src/lib/strikes/decide.ts`
      (cancelled by the office, the planner or the sheet: none; 48 hours' notice or more
      (`strikes.notice_hours`): none; booked by the office, including over a rules override, or the
      session changed by the office or the planner after booking: exempt, with the reason; otherwise
      a strike, flagged for review for "I'm unwell" or "Family or caring"), run inside
      `cancelBooking()`'s transaction (`src/lib/roster/cancel.ts`), its result a code in the
      `shift.cancelled` entry and a `strikes` row only when one is issued (`strike.issued` logged:
      ids, codes and hours only); the casual's cancel step shows the one warning sentence the same
      decision gives (§5.7 item 4) with their live strike count, the four reasons as today
      (`src/lib/portal/cancel-reasons.ts`), "Confirm cancellation" and "Keep this shift"; the
      warning's version and time stored on the booking; the done screen shows the reference, the
      strike result and "Tell us what happened" (a `review` request about that booking, its
      reference filled in: an existing request type, no new columns); the retention job purges
      strikes at `strikes.keep_months` (12), never during `retention.hold_until`; nothing else
      happens automatically; `docs/dpia-strikes.md`, with a template for firms, written before
      strikes are switched on for a real firm. Tests: a table test of every `strikeDecision()` case
      and boundary (office-assigned, a rules override, changed after booking, exactly 48 hours,
      "Family or caring" flagged, a session taken inside 48 hours not flagged); a unit test per
      warning sentence; integration (an office cancellation gives none; one strike per booking; a
      rolled-back cancellation leaves no strike row; the purge at 12 months; nothing purged during a
      hold); isolation; e2e: a cancellation under 48 hours shows the warning and records a strike,
      one over 48 hours records none; `guardrails-reviewer`. Docs: `docs/screens.md`,
      `docs/data-model.md` (12C.1)
- [x] Cancellation records (§3.4): `/office/cancellations` (this week's two counts; All, Under 48
      hours and By the office as links; each row a link to its record) and
      `/office/cancellations/[ref]` with every field in §3.4's table and its "Then" line (what
      happened from the log; the times from the bookings' own times: the cancellation and the
      replacement's confirmation); a PDF per record (`pdf-lib` with `@pdf-lib/fontkit` and an
      embedded font, Noto Sans or the self-hosted Plus Jakarta Sans, so names such as Łukasz,
      Ştefan or Gülşen and "✓" print; `src/lib/pdf/record.ts`) and a CSV of the chosen view
      (§3.4's columns, at most 20,000 rows); in both, every quick reason a casual gave reads
      "Casual's own reason (see ShiftDesk)", office reasons keep their fixed words, and the real
      reason and the casual's note stay on screen for admins and resourcers only; each download
      logged `export.downloaded`; the menu's Cancellations link. Tests: the loader; the "Then"
      builder; CSV columns and escaping; the record page and PDF show the session's role, site,
      date, start–end, post, pay rate, requirements, meeting point and uniform; a PDF for a casual
      named "Łukasz Ştefan"; "unwell" and "health" never in the CSV or PDF; downloads logged;
      isolation; new e2e `office.cancellations.spec.ts` (including: no Approve, Decline or Deny
      button or link on any cancellations page). Docs: `docs/screens.md` (12C.3)
- [x] Evidence email to the strikes team (§5.6): a `strikes.evidence_email` job (ids only,
      `firmJobEnvelope`) that claims the send, then sends the record PDF through the SMTP transport
      (12X.2), like the other notices (`src/lib/notices/request-update.ts`): retried only on
      `EmailNotSentError`, otherwise `failed`, the Needs attention item and "Resend evidence" on
      the record (logged); sent only to a confirmed `strikes.email` (12B.7), otherwise
      `not_set_up`; `strike.evidence_sent` and `strike.evidence_failed` logged; §5.6's subject and
      body, with "Casual's own reason (see ShiftDesk)" for every quick reason. Real sending waits
      for "Connect an email provider (SMTP)". Tests (a fake transport): nothing sent to an
      unconfirmed address; sent once the address is confirmed; an unclear failure is never resent
      on its own; "Resend evidence" sends once more and is logged; "unwell" and "health" never in
      the subject, body or PDF; `guardrails-reviewer` (messaging) (12C.4)
- [x] Strikes page and the casual's strikes (§3.5, §4.6): `/office/strikes` (admins and
      resourcers; Live, Needs review and All as links; casual, live count, latest strike, review
      flag and evidence status, sorted by live count; stacked cards on a phone; no menu badge);
      "Withdraw strike…" with a reason (1–500 characters, kept on the strike row, not in the log;
      `strike.withdrawn` logged) and "Keep strike" (clears the review flag; `strike.reviewed`
      logged); the casual's Strikes section on today's `/profile` (the count in the last 90 days,
      and each strike's date, session, notice, until when and status); erasing a casual clears the
      withdrawal reason (`src/lib/gdpr/worker-erase.ts`). Tests: withdrawing needs a reason, is
      logged without it and lowers the live count; keeping clears the flag; erasure clears the
      reason; payroll can't open the page or see a strike anywhere; isolation; e2e: withdrawing a
      strike. Docs: `docs/screens.md` (12C.5)
- [x] Postcode look-ups and the casual's travel area (§4.6, §5.4; S8, approved; D2; Data 21): a
      `Geocoder` (fake and postcodes.io; answers parsed with zod) in `src/lib/travel/`, chosen by
      `TRAVEL_PROVIDER` (a server setting, never per firm; `fake` pinned in `serverEnv()` and
      `tests/setup/env.ts`, and `traveltime` refused when `NODE_ENV=test`); site postcodes looked up
      into the existing `sites.lat` and `lng` when saved (the Settings page's Sites list with its
      location status, the sheet sync, the file import, and the API from 12J.1); the migration (S8's
      `worker_travel`); `/profile/travel` (start-from postcode; Car, Public transport or Both; 30,
      45, 60 or 90 minutes; the line saying the office sees only the district), looked up on save
      and logged `travel.profile_changed` (which settings changed and the time limit, never the
      postcode or coordinates, §6.1); the office sees the district only ("ZZ1"); deleted when the
      office makes the casual inactive as "They've left" (`DEACTIVATE_REASONS.left`,
      `src/lib/office/worker-reasons.ts`) or the casual is erased; in the casual's export;
      `docs/dpia-travel.md` with the legitimate-interests balancing test and a template for firms,
      written before the travel area is switched on for a real firm. Tests: contract tests against
      the fake and recorded postcodes.io answers (never the network); `traveltime` refused under
      `NODE_ENV=test`; an unknown postcode; only a postcode is ever sent; isolation; the
      erased-worker check unchanged; erase and export; deleted on "They've left"; the office never
      gets more than the district; the change logged without the postcode; `guardrails-reviewer`
      (12G.1)
- [x] Travel estimates (§5.4; S9, approved, built narrower; D1): a `TravelProvider` (fake and
      TravelTime; answers parsed with zod); the migration (S9's `travel_estimates`, keyed by
      postcode and site, not by person); the travel job: one provider search per session and way of
      travelling (arriving 30 minutes before the start; up to 2,000 postcodes a search; a
      90-minute ceiling; the distance by car), queued when a session is created, imported, synced
      or changed (and sent by the API from 12J.1) or marked urgent, when a site's postcode
      changes, and when a casual's postcode or ways of travelling change, plus a nightly run for
      sessions in the open-shifts window (`OPEN_WINDOW_DAYS`, 28 days,
      `src/lib/portal/open-shifts.ts:23`) that have no estimate yet; purged 7 days after the
      session; pages never call the provider; with the provider down, straight-line miles labelled
      "(straight line)" and "Travel time not known yet"; only coordinates with meaningless ids
      leave the server. Tests: contract tests against the fake and recorded TravelTime answers;
      nothing personal in a request; batching at 2,000; arrive-by across the clock change; a newly
      synced session gets estimates without waiting for the nightly run; an urgent session created
      with under 24 hours to go gets them before its first wave; the nightly run covers the whole
      `OPEN_WINDOW_DAYS` window; the fallback; the purge; isolation. Docs: `docs/runbooks.md`
      (travel provider outage) (12G.2)
- [x] The travel filter and travel lines (§4.3, §5.4; D2, Rules 14): the area filter inside the
      open-shifts query before the 50-row cap (`src/lib/portal/open-shifts.ts`), and on the urgent
      board, Home and offer waves (outside the area: no offer; an unknown estimate: offered,
      `src/lib/offers/candidates.ts`); urgent first, then the nearest, then the date; an unknown
      estimate shown as "Distance not known yet", never hidden; no home area: everything shown,
      with the prompt; a shift opened from a direct link stays bookable; Booked rows carry the
      travel line too; both times always shown, whichever ways she chose (her choice only drives
      the filter); the "N more shifts are further than you travel" count. Tests: a near shift is
      never cut off by the cap; out-of-area casuals get no wave offers; in the area when any chosen
      way is within the limit (car 40 min, public transport 50 min, limit 45: in for Both and Car,
      out for Public transport only); `/urgent` and Home are filtered; an unknown distance is shown;
      no home area: unfiltered, with the prompt; a direct link outside the area still books; both
      times shown whichever ways she chose; Booked rows' and `/urgent` rows' travel line; the "N
      more" count; `guardrails-reviewer` (offers) (12G.3)
- [x] Qualification statuses and the Casuals pages (§3.7, §4.6; Rules 15): pure
      `qualificationStatus()` and `needsUpdating()` in `src/lib/credentials/status.ts` (Valid,
      Expiring soon, Expired, Missing, Applied for and Suspended from today's data; "Being checked"
      and "Not accepted" join with 12F.2); the types listed (every type her roles need, plus right
      to work as a status only; a listed type with no record is Missing, "Needed for {role}
      shifts"); needs updating in §4.2's four levels; one set of reminder timings shared by the
      expiry job, the office and My shifts (`src/lib/credentials/expiry.ts`); shown on today's
      `/profile` (each status, date line and what it means) and My shifts; `/office/casuals` (All
      and Need updating as links with their counts; columns for qualifications, staff photo (from
      12F.2), travel district, live strikes and needs updating; stacked cards on a phone) and
      `/office/casuals/[id]` (needs updating, qualifications, travel area, strikes, bookings ahead,
      and the access controls moved from `/office/workers/[id]`); the existing find-a-worker form
      (`FindWorkerForm`) moves to `/office/casuals` as built; the `/office/workers` routes
      redirect; the `casuals` area in `roles.ts`; staff-facing words say "qualifications", never
      "credential". Tests: a full status table with boundary dates; Missing for a role's type, and
      a type nothing needs isn't listed; the four-level order; `tests/unit/portal.profile.test.ts`
      and `portal.my-shifts.test.ts` updated for the new words; new e2e `casual.app.spec.ts`
      (Profile statuses for Zoe: one Valid, one Expiring soon, one Missing);
      `tests/e2e/office.workers.spec.ts` follows the rename (Workers → Casuals), its find-a-worker
      steps included; isolation. Docs:
      `docs/screens.md`, `docs/rules-and-credentials.md` (12F.1)
- [x] Uploads, the check view and the staff photo (§3.7, §4.6, §5.5; S6, approved, built
      narrower, and S7, approved; D3, Data 20): the migration (S6's `check_state`,
      `rejected_reason` and `evidence_upload_id`, and filling `verified_at` and `verified_by`;
      S7's `uploads`); photo and certificate uploads (resized on the phone to 1,600px JPEG; on the
      server the type checked from its first bytes, re-encoded with `sharp`, which drops location
      data, and refused over 1 MB; the Dockerfile checked for sharp's library); `/files/[id]`
      serving only to the casual and their firm's admins and resourcers (`Cache-Control: private,
      no-store`, never in the offline copy); approve (expiry and number as read by a person; the
      GOV.UK register linked for an SIA licence) or reject with a reason, on the casual's page and
      in Casuals' "Uploads to check" view (oldest first; the Casuals menu badge); only checked,
      in-date items count in the rules; CSAS recorded by the office only, after confirming it's
      under this firm's own scheme (§3.7); the staff photo: its status from the latest approved
      photo (`photo.renewal_months` 36; "Due soon" 30 days before), "Upload a new photo" with the
      front camera and one line of SIA photo guidance; replaced photos deleted 30 days after the
      new one is approved and rejected uploads after 30 days (the retention job);
      `credential_expiring` and `credential_expired` point to the upload link (§5.7 item 5, the
      three copies kept in step); `upload.received`, `upload.approved` and `upload.rejected`
      logged in §6.1's shape (a type under `qualificationType`, never a field name holding
      "credential"); erase and export include uploads, the casual's and the firm's JSON exports
      carry each upload's details only (kind, date, status, a fingerprint), never the image bytes
      (`firmExportTables()` in `src/lib/gdpr/firm-export.ts` picks up every firm table on its own),
      and each image is its own download. Tests: the type checked from bytes; the size limit;
      location data gone; another firm's or casual's file refused; the rules ignore unchecked
      items; the photo status at each boundary date; a waiting photo never replaces the approved
      one; the Casuals table's Staff photo column shows the upload date and its status; the
      purges; erase and export, and the JSON exports have no bytes column;
      `copy.templates-doc`; isolation; `guardrails-reviewer`. Docs: `docs/screens.md`,
      `docs/data-model.md`, `docs/messaging-templates.md`, `docs/compliance.md` (no biometrics)
      (12F.2)
- [x] Enquiries (§3.6; S5, approved): the migration (S5); a loader joining messages, their replies
      and office questions (`src/lib/office/enquiries.ts`); `/office/enquiries` (All, Need a person,
      Requests from the app and Pay as links; counts for today and for need a person) and
      `/office/enquiries/[id]` (the conversation as the casual saw it, and "How it was answered"
      from logged facts only, with a casual's home shown as the district at most; its step 3 "Checks
      made by code" and "Considered but not offered" say "No checks recorded" until 12D.2 writes and
      renders them); outcome labels from code only; the banner "AI sorting isn't connected yet:
      messages without a keyword go to a person." while `AI_TRANSPORT=none`; Need a person worked
      out with no new table (§3.6 "Data"): the reply box (free text inside WhatsApp's 24-hour
      window, otherwise the `request_update` template, chosen automatically and said in one line),
      stored as an outgoing `messages` row with `reply_to` (an unknown number's too), and "Close
      without a reply" with a reason code from a fixed list (dealt with by phone, not for us,
      duplicate, spam, other), logged `enquiry.closed`, never typed text; requests from the app as
      their own view, "approved" shown as "Answered" for questions (stored `approved`: no migration;
      `src/lib/office/request-queue.ts`, `src/app/office/requests/answer-form.tsx`,
      `src/lib/notices/request-update.ts`); `/office/requests` redirects there; the menu's Enquiries
      link and badge. Tests: the join (including failed replies and the text fallback); each outcome
      label from its logged facts; the stored reply row; the window at exactly 24 hours; an unknown
      number's message leaves Need a person when replied to or closed with a reason, and the log
      entry holds no typed text; the redirect; the request-update wording; no office page or loader
      output holds more of a casual's postcode than the district; isolation; new e2e
      `office.enquiries.spec.ts`; the walkthrough's unknown-numbers step; the specs that used
      Requests (§10). Docs: `docs/screens.md` (12D.1)
- [x] Personal replies (§3.6, §5.7 items 1–3): the shifts and cancel replies built in
      `src/lib/inbound/personal-reply.ts` from `openShiftsFor()` with the casual app's filters
      (eligibility, `visibleToCasuals` and the travel area) and their travel lines; at most 5
      shifts, urgent first, then the nearest, inside a character budget (names cut to set lengths,
      fewer shifts until it fits, then "+ N more: {link}"; never over 1,600 characters); always
      "Take one here: {link}" (no booking by reply number: D6 deferred); the booked line and day
      words only when §5.7 says; "from your home area", never the postcode; "Automatic reply. Send
      OFFICE to reach a person." before every instant reply's sign-off; `checkEligibility()` also
      returns `checks: { code, passed, detail }[]` for every check it ran (credential and expiry,
      role, overlap, rest gap in hours, weekly hours used and cap, days off, blocked site), with
      `ok`, `reasons` and `codes` unchanged (`src/lib/rules/eligibility.ts`); `enquiry.checks`
      logged in §6.1's shape (each check, the offered session ids in order, at most 50 not-offered
      sessions with reason codes and a count of the rest, the bookings a cancel reply named, the
      template, travel as minutes only) and the AI fallback reason in the event data; step 3
      "Checks made by code" and "Considered but not offered" rendered on
      `/office/enquiries/[id]` from that entry (§3.6). Tests: only eligible, showing sessions
      inside the travel area are listed; a session is left out, and
      appears in not-offered with its reason, for each of: missing or expired qualification, one
      expiring mid-session, a clash with a booking, under the rest gap, over the weekly cap, a day
      off, a blocked site, a hidden event or session, outside the travel area; each listed line
      has role · event, site, date, start–end, £/h, post and the travel line; every check appears
      with its data on a pass and a fail, and `ok` is unchanged for every existing rules case;
      CSAS only to holders; five shifts with every field at its longest stay within 1,600
      characters on WhatsApp and by text; the cancel reply names the booking, has the strike
      sentence only when a strike would apply, and adds "Your other shifts" only with two or more
      bookings ahead; every `enquiry.checks` sample passes the check `recordEvent` uses; the pay
      reply never gets list text; the text-message version; `office.enquiries.spec.ts`: Zoe's
      personal-list enquiry shows each check with its data (licence valid to {date} ✓, rest gap ✓,
      inside travel area {n} min ✓), the shifts listed, and a not-offered line "Response team
      lead: needs first aid at work", and a CSAS session appears in her list and not in a
      non-holder's; `tests/unit/ai.boundary.test.ts` still passes; the rules-doc parity test;
      `guardrails-reviewer` (messaging, rules). Docs: `docs/messaging-templates.md`,
      `docs/rules-and-credentials.md` (12D.2)
- [x] Dashboard and Needs attention (§3.2, §3.9): `/office` for admins and resourcers: the firm's
      shifts-line number under the header, as today; the four counts (labelled exactly "Urgent
      shifts not filled", "Events showing to casuals", "Cancellations today" and "Enquiries today";
      each a link to its filtered list, the first tinted and larger; "today" is the London calendar
      day), then the sections "Urgent shifts not filled", "Showing to casuals", "Cancellations",
      "Enquiries" and "Needs attention", with their empty and error words; each urgent card's line
      written by code ("Offered to {n} casuals", or "Offers stopped: nobody else can take it."); a
      hidden event with an urgent gap warns "Hidden from casuals: nobody can see this gap."; Needs
      attention holds Today's to-dos (bookings to check, from your rota sheet, who worked?) plus a
      qualification expired on a booked session, uploads to check, and a strike evidence email that
      failed or a strikes-team address not confirmed, each linking to where it's dealt with; the
      bell in the top bar shows the count and links there; `/office/today` redirects to `/office`;
      `src/lib/office/dashboard.ts` reusing `today.ts`'s queries. Tests: count definitions; empty
      and error wording; no dashboard link repeating a menu link's name; each card line from its
      data; the hidden warning; each Needs attention item appears and links to its page; dashboard
      tests replace `tests/unit/office.today-summary.test.ts` and `office.today-view.test.ts`; new
      e2e `office.dashboard.spec.ts` (the four count labels exactly, the section headings in order,
      the shifts-line number, the Cancellations hint "Recorded automatically, never approved or
      declined", and no Approve, Decline or Deny button or link) replaces `office.today.spec.ts` and
      the walkthrough's Today steps; the "Who worked?" check (`tests/e2e/office.attendance.spec.ts`)
      and the "Bookings to check" check (`office.workers.spec.ts`) follow their items to the
      dashboard; `tests/unit/copy.plain-language.test.ts` fails on "urgently looking for" anywhere
      in `src/` or `docs/screens.md` (the wording Dylan turned down). Docs: `docs/screens.md`
      (12E.1)
- [x] Planner API and API keys (S11, approved 2026-10-06; an auth and schema change, so its short
      plan goes to Dylan first) (§5.3.2, §5.3.4): written first, before any code: ADR-022 in
      `docs/decisions.md` (the planner integration layer, amending ADR-008, ADR-011 (a second
      look-up before a firm is known) and ADR-012 (the key, not the host, decides the firm)), and
      CLAUDE.md's allowed look-ups, `scripts/invariants.sh` and golden rule 3 ("Every provider
      webhook (Twilio, email) stores `provider_message_id` … Work happens in jobs. The planner API
      (`/api/v1`) is not a provider webhook: each write is one short transaction answered in the
      request, made idempotent by the planner's ref (`docs/office-v2.md` §5.3.2)."); the migration
      (S11's `api_keys`, which the app may only read, add to, and change `last_used_at`,
      `revoked_at` and `revoked_by` in (`TABLE_ACCESS` `["SELECT", "INSERT"]` plus
      `COLUMN_UPDATES`), and owner-run `app_api_key_lookup(hash)`; `api` as a session, event and
      cancel source; RLS, isolation fixtures, left out of the firm's export);
      `handleApiRequest()` in a new `src/lib/integrations/api.ts` (the platform address only; JSON
      of at most 64 KB; a key of the wrong shape refused with `looksLikeToken()` before any
      look-up, and refused keys counted per client address in each web process's memory, 30 a
      minute, then 429; a Bearer key → the look-up → `withFirm()`; 300 calls a minute per key
      through `throttle()`; Gate B for key creation and writes; one log line per request, never a
      key or the `Authorization` header; the error shape); `/api/` paths exempt from the proxy's
      trailing-punctuation redirect (`src/lib/http/proxy.ts`), and refs that end in a letter or a
      digit; `INTEGRATIONS_SECRET` (`src/lib/env.ts`; unset: 503 `not_configured`; a made-up value
      pinned in `serverEnv()`, a non-example one for the walkthrough's production build, and in
      `tests/setup/env.ts`); `PUT /api/v1/sessions/{ref}`, `GET /api/v1/sessions/{ref}` and
      `GET /api/v1/cancellations` (`since=` or `cursor=`; keyset pages by cancellation time and
      booking id) as §5.3.2 says: `role` one of the firm's role codes, else 422 `unknown_role`; a
      site's postcode only filled when it has none, else 409 `site_postcode_differs`; a postcode the
      API fills is looked up first, outside the transaction, through `serverGeocoder()` (12G.1,
      `src/lib/travel/`) and saved with its point in `sites.lat`/`lng`, with the same handling as
      `editSitePostcode` (an unknown postcode is 422 `unknown_postcode`; a failed look-up is 503
      `lookup_failed` and saves nothing; look-ups off saves the postcode without a point), tested
      with the fake geocoder; sessions the API creates or changes (time, role or site) queue the
      travel job (`queueTravelEstimates()`, 12G.2) in the same transaction, tested; new sites and
      events made with `insert … on conflict do nothing`; places lowered only as far as the
      highest booked place, else 409 `places_below_booked`; a booked session's move or
      cancellation through `moveShiftByFirm()` or `cancelShiftByFirm()` with S11's API caller
      (`by: { type: "api", keyId }`: the key checked still live in the same transaction, API
      sessions only, every failed check blocking, `cancel_via` `api`, never a strike), logged with
      the `system` actor and `{ by: "firm", via: "api", keyId }`; an office caller gets a new
      `planner` refusal for whole-session edits, moves and cancels of API sessions; a refused
      planner change (`shift.move_refused` with `via: "api"`, or a new `api.change_refused {
      shiftId, code }`) raises §3.9's Needs attention item, which clears on a later change or
      cancellation of that session; travel estimates queued for a newly filled site postcode;
      `/office/settings/integrations` (admin only) with "Your planner", "API keys" (create, shown
      once; revoke) and "Codes your planner can use"; `api_key.created` and `api_key.revoked`
      logged (`keyId` only). Tests: unit (the key format, hashing and hint; every zod schema at
      its limits; a ref ending in "." gets 400 `bad_ref`, never a 308, and the proxy never
      redirects `/api/v1/*`; error bodies never echo values; the page is admin only; §6.1's exact
      samples (`{ by: "firm", via: "api", keyId }`, `api_key.created { keyId }`) pass the
      `recordEvent()` check); integration (isolation and `rls.every-table`; the app can't update
      `token_hash` or `label`; the look-up returns only live keys and only ids; the 31st bad key
      in a minute from one address gets 429 without a look-up; the host matrix: the platform
      address answers, a firm subdomain and a custom domain give 404; 413 over 64 KB and 415 for
      anything but JSON; firm A's key on firm B's ref gives 404, the same ref in two firms is two
      sessions, and neither read ever returns another firm's booking; a `PUT` creates, updates,
      and leaves an unchanged session alone; an unknown role gives 422 `unknown_role` and creates
      nothing; a new postcode for a site that has one is refused and changes nothing; two parallel
      `PUT`s naming one new event and site both succeed and share one row each; lowering places
      below a booking in the top place is refused, without bookings it applies, and after any
      places change no confirmed booking sits above the headcount; an API move and cancel work
      with no office user, the office's move and cancel of an API session are refused, and a
      just-revoked key is refused inside the transaction; a booked session's move gives notice to
      each casual and queues their notices; a move that breaks a casual's rest gap gets 409 and
      changes nothing; a refused change raises the Needs attention item and a later successful
      `PUT` clears it; an API cancel or move carries `cancel_via` `api` and gives no strike (or
      an exempt one); a started session and a cancelled one are refused; two `PUT`s at once give
      one session; `GET /sessions/{ref}` returns live and cancelled bookings; `GET /cancellations`
      pages oldest first, 100 a page, and 250 cancellations at one time come back exactly once
      across 3 pages; Gate B; the 301st call in a minute gives 429 while another key is
      unaffected; a revoked key gives 401 at once; "unwell" and "health" never in an API record);
      e2e `office.integrations.spec.ts` (an admin creates a key, shown once and gone after a
      reload; the key `PUT`s a session that then shows on Events; revoking it gives 401;
      resourcers and payroll can't open the page; the page works at phone width; the teardown
      finds no `shiftdesk_` key and no `Bearer` in the servers' logs); `guardrails-reviewer`
      (auth, tenancy). Docs: ADR-022 and CLAUDE.md (above, first); new `docs/integrations.md`
      (connecting in three steps, keys, each call with a curl example, the order of PUTs (one at a
      time per ref, no automatic replays), errors including `unknown_role`, limits),
      `docs/api-and-jobs.md`, `docs/data-model.md` (12J.1)
- [x] Webhooks to the planner (S11, approved 2026-10-06) (§5.3.3, §5.3.4): S11's `webhook.url`,
      `webhook.rotate` and the self-raised `webhook.signing_version` in `app_set_firm_setting()`;
      `queueWebhooks()` (new `src/lib/integrations/outbox.ts`) called from `recordEvent()` for
      `shift.assigned`, `shift.cancelled` and `strike.withdrawn` when the firm has a webhook
      address, queuing one `webhook-deliver` job (ids only, one group per firm) in the same
      transaction, and `recordEvents()` throwing if handed one of those actions; the body built
      when it is sent, by 12J.1's record builder, with the full record and the strike result,
      every casual quick reason as `casual_own_reason`, and nothing personal beyond names and
      staff refs; one zod schema per webhook type, the same one `docs/integrations.md` prints;
      Standard Webhooks signing with the derived secret (`secrets.ts`); the safe HTTPS sender
      (`send.ts`: §5.3.3's explicit `BlockList`, `https.request` with a `lookup` that returns only
      the checked address, no redirects, a 5-second connect and 10-second total limit, errors
      carrying a code and log lines the host only, never the address); `WEBHOOK_TRANSPORT` (worker
      only: `console` or `https`, `https` required in production and refused under
      `NODE_ENV=test`, `console` pinned in `serverEnv()` and `tests/setup/env.ts`); the
      `webhook-deliver` queue's own retry settings (`retryLimit` 6, `retryDelay` 60,
      `retryBackoff`, `retryDelayMax` 1800: about an hour in all), registered with
      `includeMetadata`, `localConcurrency` 4 and `localGroupConcurrency` 1, with `runFirmTask()`
      passing the try number on (`src/lib/jobs/firm-job.ts`); the last try logs `webhook.failed`,
      raises the Needs attention item ("Your planner's webhook is failing") and completes the job
      rather than failing it; `webhook.delivered` logged; the Integrations page's "Webhook" section
      (add, its secret shown once; the address shown as its host and last 4 characters; new
      signing secret; "Send test event", which queues a `test.ping` job; remove); the
      cancellation record's "Your planner" line. Tests: unit (a signer written from the Standard
      Webhooks spec reproduces its published example; the address guard refuses each listed range
      one by one, IPv4-mapped, NAT64 and 6to4 forms, the metadata address, a name resolving to one
      public and one private address, and redirects; the body never holds a mobile, email,
      postcode or free text, "unwell" and "health" never appear, all four quick reasons read
      `casual_own_reason`, and an erased casual reads `null`; each type's zod contract parsed
      against real bodies for a casual cancel at 15 hours (strike issued), an office cancel of one
      booking (`by: "office"`, strike none) and an API session cancel (`by: "planner"`), each
      carrying the session ref, booking ref, role, start and end, site name and postcode, pay
      rate, post, meeting point, uniform, requirements, the casual's staff ref, and the
      cancellation and strike objects; a `booking.cancelled` body's `data` equals the
      `GET /cancellations` object; event ids stay the same within a firm and differ between firms;
      `recordEvents()` with `shift.cancelled` throws; the app can't lower or set
      `webhook.signing_version`; a failing delivery's log lines and job output never hold the
      address's path; every new log entry passes the log check, `firm.settings_changed` for adding
      a webhook and for a new signing secret included); integration (each path queues exactly one
      delivery, and none after a rollback: take shift, assign, sheet booking, casual cancel, office
      cancel of one booking, office cancel of a session, sheet removal, API cancel, strike
      withdrawn; firm B never receives firm A's events; with firm A's endpoint hanging (a fake
      transport), firm B's webhook is still delivered within a set time; a 2xx logs
      `webhook.delivered`; failures retry, then the last try logs `webhook.failed` once, raises one
      Needs attention item and leaves no failed job (`failedJobCounts()` unchanged); the test
      event; removing the address stops new deliveries); e2e: an admin adds a webhook, a casual
      cancels, and the record shows "Sent to your planner" (console transport);
      `guardrails-reviewer` (messaging, tenancy). Docs: `docs/integrations.md` (webhook types, the
      body and its schemas, verification code, retries, and that webhooks need the worker, which
      runs in production once Twilio is connected; since P2.5, from the first deploy), `docs/compliance.md` (what goes to the
      planner and what never does), `docs/runbooks.md` (a failing webhook, a leaked key, rotating
      `INTEGRATIONS_SECRET`), `docs/architecture.md` ("the action log is the outbox"), ADR-022's
      webhook part (12J.2)
- [x] Casual app tab bar and Home (§4.1–§4.2): a bottom tab bar (Home, Shifts, Pay, Profile; a dot
      on Profile when something needs updating), the firm's bar kept, the theme following the
      phone; Booked moves to `/shifts` (Upcoming / Past 30 days, `?view=past` as today;
      `/?view=past` redirects there); the offline copy covers Home's next shift and Booked; Log out
      is the last item on Profile; "My requests" (`/requests`) linked from Profile and from "Ask
      for a change"; Home with "Hello {first name}", Needs updating (one action per row, in
      §4.2's order), the urgent shifts she can take (role · event, site) with their travel lines,
      her next shift in full (role · event, site and address, post, pay and estimate, report to,
      bring, getting there, "Open in maps", "Ask for a change", "Cancel this shift") and the top 3
      shifts she can apply for, with "N more shifts are further than you travel. Change how far".
      Tests: `tests/e2e/login.worker.spec.ts` counts and its Booked route updated; the offline
      copy still renders the next shift; Log out from Profile; `/requests` reachable from
      Profile; `tests/unit/portal.my-shifts.test.ts`; the plain-language test;
      `casual.app.spec.ts` (Home: the urgent card and the next shift show the site name; the next
      shift and each urgent card show "{miles} · {n} min by car · {n} min by public transport";
      the Needs updating card's photo row says "Last uploaded {date}" with the seeded upload
      date). Docs:
      `docs/screens.md` (12H.1)
- [x] Shifts list and shift page (§4.3–§4.4): Open and Booked at `/shifts`; each Open row: role ·
      event, site, date and time, £/hour, post, requirement chips, places left, then the travel
      line, urgent or not; the existing day, site and role filters kept as built (the 50-row cap's
      message still points to them); `/urgent` as the urgent-only view; the shift page's chips,
      facts (pay with the estimate, meeting point, post, uniform, places left), "Getting there"
      (miles, car, public transport, "Open in maps"), "What it needs" with her status for each,
      "Take shift" or the plain reasons, and the strike note. Tests: `casual.app.spec.ts` (Zoe
      sees the Arena shift with "3.1 miles · 12 min by car · 24 min by public transport"); the
      shift page shows pay with the estimate, the meeting point, post, uniform and places left; an
      Open row shows role · event, site, date and time, £/hour and post; the existing filters
      still narrow the list; each requirement status. Docs: `docs/screens.md` (12H.2)
- [x] Profile and help (§4.6–§4.7; Rules 15): "Your details" (read-only; "To change your name or
      number, ask the office.") and Notifications (WhatsApp or text, open-shift alerts, the
      texts-off notice, this phone's notifications) kept as built, restyled; the staff photo card
      (72px, "Last uploaded {date} · renew by {date}" and its status), every qualification with
      its status, date line and what it means, "Upload a certificate", right to work as a status
      only ("Not checked yet: ask the office" when there's none), Where you work (→
      `/profile/travel`), Strikes, Days you can't work, My requests, Help, Log out; `/help` gains
      "Cancelling and strikes", "Your travel area" and "Qualifications and photos", and the
      postcode data's attribution line (OS, Royal Mail, National Statistics, ONS; the licence
      requires it). Tests: `tests/unit/copy.plain-language.test.ts`; `portal.profile.test.ts`
      (the right-to-work words; its existing details and notification tests unchanged);
      `casual.app.spec.ts` (Profile: "Last uploaded {date} · renew by {date}" and its status).
      Docs: `docs/screens.md` (12H.3)
- [x] Demo seed, after every task above (§9 "Demo seed"): the rows each task seeded, joined into
      the mock-up's made-up story with dates relative to now (Acme Events and its confirmed
      `strikes@acme-events.example`; the six events, Hillside Christmas Market switched off; Zoe,
      Kieran, Ben, Priya, Leah, Jamal, Mo and Tom with their qualifications, photos, strikes and
      travel areas; the cancellations; Zoe's personal list, Ben's pay question and Kieran's cancel
      built with the real reply functions and their log entries; fixed fake travel times; uploads
      waiting), fixed ids from `seedId()` avoiding the demo-login workers 0–4; no real employer,
      venue, staff or address; every time a page shows comes from row times the seed sets, because
      log entries can't be backdated (`src/lib/db/admin/seed-saturday.ts:20-21`). Tests: the seed
      run twice changes nothing; every walkthrough step has its data (12I.1)
- [x] Guides and docs (§10 "Docs to update"): `/office/guide` rewritten for the new menu and pages
      ("Getting around" describes the drawer and where Log out is now; "Connect your planner" in
      three steps); `/help` as 12H.3; `CLAUDE.md` lines 13–25 (the office is planner-first; the
      dashboard and Enquiries replace Today and Requests) and `src/lib/integrations/` in its repo
      layout (the `ai/` and `messaging/` lines are 12X.1's); every doc in §10's list that its
      task didn't already update, including `docs/compliance.md` and `docs/privacy-notice.md`
      (the sub-processors: the host, the email provider, Anthropic once AI is on, TravelTime,
      postcodes.io; the firm's planner as a recipient; no biometrics; the travel and strikes
      DPIAs; strike cautions; the UK GDPR Article 9 condition firms rely on for "I'm unwell"
      (employment: DPA 2018 Schedule 1 paragraph 1) and the appropriate policy document it needs;
      the retention schedule, with strike log entries kept as long as the action log); ADRs for D1
      (TravelTime) and D3 (images in Postgres) in `docs/decisions.md`; fact-checked by the
      `doc-fact-checker` agent. Tests: `tests/unit/guides.test.ts` (the new section titles) (12I.3)
- [x] Verify and the walkthrough: `docs/walkthrough.md` and `tests/e2e/walkthrough*` cover the
      menu, Log out and every new page, including connecting a planner; `scripts/verify.sh` with
      `RUN_E2E=1` prints VERIFIED; `npm run e2e:walkthrough` passes on the production build; the
      `claims-auditor` checks the phase against its "Done when" (12I.4)
- [x] Phase 12 loose ends (added 2026-10-15, Dylan's choice: the code-only items Phase 12's
      reviews and audits parked that need no account and no decision of his): (a) travel
      estimates' three untested paths (12G.2 re-audit): the nightly tick is worked and scheduled
      "20 2 * * *" Europe/London; `markUrgentAfterDropout()` queues `travel.estimates` for the
      session `AFTER_WAVE_DELAY_SECONDS` later; the offer wave's worker deps (`offerWorkerDeps()`,
      `src/lib/offers/waves.ts`) fill estimates through `estimatesBeforeWave`; (b) the older
      downloads (`/office/data/export`, `/office/data/workers/[id]/export`,
      `/office/reports/notice/export`) refuse one another site started (`fromOwnPages`), as the
      cancellations files do; (c) shifts-line replies name an event as the app does
      (`casualEventName`: an automatic event's name, which only repeats the site and day, is left
      out) in the list, the booked line and the cancel reply; (d) day words: a word keeps its
      apostrophes ("c'mon" isn't "mon"), and "sat", "sun" and "wed" are days unless the word
      before makes them ordinary English ("I sat", "the sun", "getting wed"); (e) Home's urgent
      cards' requirement chips, pinned by a test; (f) "Download CSV" on today's Cancellations
      exports today's only, named with the date and logged with `day: "today"`; (g) Enquiries,
      its badge, a message's page and the office's reply read the firm's
      `retention.message_days` (90 by default), and the empty words there and on the dashboard
      say that number; (h) the unknown-number alert email links Enquiries' Need a person
      (`/office/enquiries?view=person`); (i) the planner API answers a method an address doesn't
      take with its own 405 `method_not_allowed` and an `Allow` header; (j) the office guide's
      "Change or cancel a shift" says what a planner's session keeps here; (k) tests for the
      theme following the phone on Home, and for the AI's fallback reasons end to end; (l) the
      guardrails reviews' finds: the office note is cut by characters (an emoji at the 500th no
      longer fails the shifts line's job and loses the message), every `/api/v1` address answers
      OPTIONS itself (its methods on the platform address, the API's 404 elsewhere), and today's
      CSV logs its date. Tests:
      each item's own (listed in the 2026-10-15 loose-ends entry of `docs/overnight-log.md`),
      each break-checked; `guardrails-reviewer` (messaging, offers). Docs: `docs/screens.md`,
      `docs/messaging-templates.md`, `docs/integrations.md`; the Parking lot items marked done
      (12L.1)

---

## Phase 13 — Before the accounts

Added 2026-10-16, Dylan's choice: the code that needs no outside account, and his decisions of the
same day ("Decided on 2026-10-16" under "Decisions waiting for Dylan"). Docs: `docs/verification.md`,
`docs/api-and-jobs.md`, `docs/messaging-templates.md`, `docs/compliance.md`,
`docs/privacy-notice.md`, `docs/screens.md`, `docs/runbooks.md`, `docs/audit-2026-09-30.md`.

- [x] Safety net (How the build is run 1 to 4, approved 2026-10-16; audit L1 to L6, L61, L62, L65):
      `scripts/verify.sh` takes the files' fingerprint when it starts and refuses its stamp if they
      changed during the run (L4), runs a production build (`npm run build`), and refuses to
      skip `scripts/invariants.sh`; a tick needs a stamp with the browser tests (`e2e=true`; L5,
      L61); the tick guard counts each task's own box, so a moved tick or `[X]` is caught (L3),
      and also watches shell commands that write `PLAN.md` (L1); the Stop hook catches more ways
      of saying done and doesn't give up after one block (L2); `scripts/invariants.sh` fails on
      Playwright's `fixme`, `fail` and runtime skips (L62), checks `scripts/` in the withFirm check
      (the owner-run admin scripts listed by name, L65) and `twilio` in tests; the reviewers and
      the auditor can't write files (L6). Tests: each hook and check run on sample input, the
      refusals included. Docs: `docs/verification.md`, `CLAUDE.md` (13.1)
- [x] The shifts line's last try (Parking lot "Inbound messages (12L.1 guardrails review)"): a
      shifts-line message whose reply job fails on its final retry is marked for a person (Need a
      person in Enquiries), with the reason logged, like the planner webhooks' last try (12J.2).
      Tests: a job that throws every time ends in Need a person, once; a later success doesn't
      double it. Docs: `docs/api-and-jobs.md` (13.2)
- [x] Web push sender ("Connect the real web push", Claude's steps; no account needed): the
      `web-push` package, an adapter next to the console one (404 and 410 mean the subscription
      is gone), `PUSH_TRANSPORT=webpush` (refused in tests; production keeps `none` until the keys
      are set), `POST /api/push/subscribe` rate-limited with the auth throttle, and the browser push
      services in `docs/compliance.md` and `docs/privacy-notice.md`. Tests: a fake push service;
      no real push is ever sent from tests. Testing on real phones waits for the server (13.3)
- [x] Privacy (Decided 2026-10-16): travel areas switched on per firm (`travel.enabled`, off by
      default): off, a casual sees no "Where you work", no "Add your home area" prompt and no
      travel lines, and Open shifts and offer waves don't filter by area; the demo firm has it on.
      Payroll's note stays behind the pay code: the `pay_query_update` message says payroll has
      answered and to see the pay page (Messages 17). Tests: both switch states, the message's
      words. Docs: `docs/screens.md`, `docs/messaging-templates.md`, `docs/dpia-travel.md` (13.4)
- [x] Tidy-ups: "Cancel with the link" in `shift_reminder_24h` (Messages 11); the per-address
      login limit raised so a team on one venue's Wi-Fi isn't locked out, the per-number limits
      unchanged (Office 10); text cut by whole characters at the webhooks, the voicemail and the
      AI's input (Parking lot "Text cuts that count UTF-16 units"); Open shifts' rules checked for
      the whole list at once (Parking lot "Before the pilot: the Open shifts list…"); a per-casual
      limit on "Take shift" (Checks 6); licence expiry messages through the normal sender, so a
      casual who chose texts gets them (Checks 7); the flaky `sheets.jobs.test.ts` fixed (Checks
      12); the image built with production dependencies only (Parking lot "Security warnings").
      Tests: each item's own, each break-checked. Docs as each item needs (13.5)

Done when: every task above is ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED, with the production build in it; no test or browser test calls a
real push service, Twilio, an email server or Anthropic; the `claims-auditor` checks the phase
against this line.

## Phase 14 — The last code before the accounts

Added 2026-10-19, Dylan's choice ("yes add phase 14 and build it"): the Parking lot's code that
needs no outside account, after Phase 13. Docs: `docs/api-and-jobs.md`, `docs/runbooks.md`,
`docs/architecture.md`, `docs/screens.md`, `docs/messaging-templates.md`.

- [x] Pushes after the record's transaction (Parking lot "Pushes inside the record's transaction";
      "Connect the real web push" step 0): each of the 7 senders reads the worker's phones in a
      short transaction of its own, pushes with none open, then forgets the gone phones and logs
      the count in its outcome transaction; a push that throws never loses the record of a message
      that went; a phone is only forgotten if it still has the keys that were pushed to; the
      worker no longer refuses `PUSH_TRANSPORT=webpush` in production. Tests: no transaction open
      during a push, for every sender; a push that throws; a phone saved again meanwhile is kept;
      production accepts webpush with its keys. Docs: `docs/api-and-jobs.md`, the Parking lot's
      "Connect the real web push" (14.1)
- [x] Login safety and the log's filters (Parking lot "13.5 guardrails review" 1 and 2): an ops
      alert when a firm sends more login links in an hour, or in a day, than a set number (the
      backstop for the 60-per-address limit; an alert, not a firm-wide ceiling, so nobody is
      locked out); the office log files each limit reached by its name ("Take shift" under
      Bookings, phones under Workers, the planner's key and the strikes team's links under Firm
      settings, the rest under Logins), in the filter and the list. Tests: the alert's threshold
      both sides, its words pass the log masker; each limit in its group. Docs:
      `docs/api-and-jobs.md`, `docs/runbooks.md`, `docs/screens.md` (14.2)
- [x] Small fixes (Parking lot "13.5 guardrails review" 3 to 5): the shifts reply's last resort is
      signed (golden rule 8) with a shorter cut; automatic event names cut the site's name between
      whole characters; a licence warning caught up after a crash doesn't guess the channel it went
      by. Tests: each one's own, each break-checked (14.3)

Done when: every task above is ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED; no test or browser test calls a real push service, Twilio, an
email server or Anthropic; the `claims-auditor` checks the phase against this line.

## Phase 15 — Texts through our own system (go-ahead for the sender only: Dylan, 2026-10-29, "build it now, switched off")

**Go-ahead, 2026-10-29** (Dylan: "build it now, switched off"): the second task, the Webex Interact
sender, is built now and stays off (no firm's key is set, and it is refused in tests); it reads the
firm's key from P5's secret store, so it comes after P5's framework. The first task changes screens
(after the UI chat's Phase 24, mock-ups first) and the third waits for the firm to turn replies on.

Proposed 2026-10-19 after Dylan's decision ("we wont need whatsapp or twillio notifications will
come through our own text system and app"; see "Decided on 2026-10-19" under Decisions). Not
started: it waits for Dylan's go-ahead and the text system's details (how a text is sent, whether
incoming texts can be passed on, delivery reports, the sending number or name). It replaces
Phases 4 and 7's unticked WhatsApp, Twilio and call items, "Connect Twilio" and "Submit the
WhatsApp templates".
Docs: `docs/messaging-templates.md`, `docs/architecture.md`, `docs/screens.md`.

- [ ] Texts only: every casual reached by text (the `notify_channel` default and the rows already
      there), no WhatsApp choice on Profile; the login link, the pay code and the reply to an
      unknown number by text (`src/lib/auth/send-portal-link.ts`, `src/lib/auth/send-login-code.ts`,
      `src/lib/inbound/reply.ts`: WhatsApp only today); a casual who replied STOP gets the app's
      notifications only (today they'd switch to WhatsApp); every "WhatsApp or text" on screen
      says "text" (login, pay code, Profile, Help, the office's offer list, Enquiries, the
      dashboard's shifts line, the guide). Tests: each message by text, STOP, the words
- [ ] Our text system's sender: a `MessagingTransport` (`src/lib/messaging/transport.ts`) for the
      firm's text provider (`MESSAGING_TRANSPORT` takes only `console` today, so nothing is sent
      for real), refused in tests like every real sender; its delivery reports if it has them
- [ ] Replies by text, only if the text system can pass incoming texts on: its webhook (signature
      checked, one row per message id, a fast 200), into the shifts line (`receiveSms`,
      `src/lib/inbound/receive.ts`) with STOP and START. Call-to-text goes (it needed Twilio voice)

**The text system's details, found 2026-10-26** (from public docs; to confirm with the pilot firm,
`docs/discovery-axlr8.md`): AXLR8, the firm's CRM, sends its texts through **Webex Interact**. Webex
Interact has a send API (`https://api.webexinteract.com/v1/sms/`, an access token in the
`X-AUTH-KEY` header) and webhooks for "Inbound SMS Received" (a unique event `id`, the sender's
number, the number it came in on, the text and its time), "Outbound SMS - Delivered" and "Failed",
and "SMS Opt Out Received", with an optional signature. Replies need a "dedicated inbound number":
texts sent under a name can't be replied to. So the three tasks above have a provider. Two changes
follow from the 2026-10-19 decision ("our own text system"): the sender is chosen **per firm**, with
the firm's key in the secret store from proposal P5 (today one sender serves the whole server,
`src/lib/messaging/index.ts`); and replies come to ShiftDesk only if AXLR8 doesn't already read
replies on that number. A "who sends what" setting (proposal P2) keeps ShiftDesk from repeating a
confirmation or reminder AXLR8 already sends. **Confirmed by Dylan, 2026-10-26:** Webex Interact,
the firm's own account, about 20p a text, replies turned off. So the first two tasks apply (texts
out, delivery reports); the third (replies) waits until the firm turns replies on with a dedicated
inbound number, and casuals answer in the app meanwhile. Who sends what (Dylan, 2026-10-26,
"Connecting the firm's systems" 9): ShiftDesk sends the offer, the confirmation and the reminders
for bookings made in ShiftDesk; AXLR8, which can send any texts the firm chooses, keeps texting
about the office's own bookings.

Messages 2, decided (Dylan, 2026-10-26): the app's notification first and a text only when the
phone has no notifications on (fewer texts to pay for); built in P2.4.

Done when: every task above is ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED; no test or browser test sends a real text; the `claims-auditor`
checks the phase against this line.

## Phase 16 — The demo online

Added 2026-10-20, Dylan's choice (he bought a Hetzner server and a domain, and picked the "Demo
phone page"): the made-up demo on a small server, so his boss can click through it online. No real
text or email sender exists yet (Phase 15), so in demo mode every message the app would send shows
on a "Demo phone" page instead: only ever for the made-up demo firms, behind one password. Built
before Phase 15. Docs: `docs/runbooks.md`, `docs/screens.md`, `docs/architecture.md`,
`docs/decisions.md`.

- [x] Demo mode in the app: `DEMO_MODE=on` lets production print texts and emails into the outbox
      file instead of sending them (refused without it, as now), and nothing else leaves the server
      (webhooks printed; push, Sheets and AI off; made-up postcodes); the worker refuses to start,
      and stops, while any firm in the database isn't one of the made-up demo firms or anyone in
      one has a real number or email, and refuses other firms' jobs; the "Demo phone" page (`/demo`
      on a firm's address): the texts and emails that firm sent its own people (each outbox line
      stamped with the sending firm), newest first, its links tappable, checked again every few
      seconds; not found without demo mode or on any other firm; a demo bar on every page of a
      demo firm, linking to it; any other firm not found at all (its addresses, shifts line and
      planner keys); the whole site behind one password, the app's own check. Tests: the settings both ways, the guard, one firm never sees
      another's messages (a number in both firms included), the password, the page's words, and a
      browser test on the production build, worker included (a casual and the office log in from
      the Demo phone) (16.1)
- [x] The demo server: Postgres in Compose over a socket only (`deploy/docker-compose.demo.yml`),
      the outbox shared by the web app and the worker, demo mode and its site password (16.1) set
      by that file and the server's `.env`, the demo loaded and reset by one command (refused
      unless demo mode, a database on the server itself and only the demo firms) and again every
      night so its dates stay fresh, its database refusing real numbers and emails;
      `docs/runbooks.md` "A demo server": the Hetzner server and the domain's DNS, step by step.
      Tests: the compose files checked by Docker itself, the reset's refusals and a real reset (16.2)

Done when: both tasks are ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED; no test sends a real message; demo mode can't run with a firm
that isn't a made-up demo firm; the `claims-auditor` checks the phase against this line.

## Phase 17 — Easier to scan

Added 2026-10-20, Dylan's ask after clicking through the demo online: "easy for both office and
casuals to scan and see where they are looking to go; right now there is too much information
showing at once; graphics and colours need work." A redesign of the look and of how much each main
screen shows at once, not of what the app does: every action, rule and log entry stays. Guided by the
UI skills Dylan chose (Anthropic's frontend-design, design-taste-frontend, ui-ux-pro-max), read before
use. Mock-ups: the "ShiftDesk: easier to scan" canvas. Docs: `docs/screens.md`.

- [x] The look and the casual app: flat (no shadows at rest, hairline cards, 1px office controls),
      24px page titles, no label above a page's heading (the firm's bar names the firm) and no
      divider under it, a way back on a record's own page instead; the firm's own colour (checked
      `#rrggbb`, set on the page only when the firm has one) on the casual app's main buttons, its
      current tab and the office's current menu item, every token pair still passing the contrast
      test; urgent tags as pale tints. Home: the next shift reads when, what, where, then its facts
      as a list, "Open in maps" and "Ask for a change" side by side and "Cancel this shift" as
      quiet red words; urgent and open shifts as rows in one card. Open shifts: lighter cards, no
      "Back to my shifts" (the tab bar goes there). Pay: the newest week first and largest, every
      line of it, the earlier weeks as compact rows, no "Back to my shifts". Booked: its next shift
      a hairline card too, its Upcoming / Past switch in the same track as Open | Booked. Tests:
      the changed screens' words, the look's rules (no shadows but the floating menus, hairline
      cards, 1px office controls, the 24px title, pale tags, the current tab's tint, Home's
      buttons and rows), pay lines grouped by week in the loader's order, the firm's colour only
      from a checked value, and the browser tests (each firm's button in its own colour) (17.1)
- [x] The office: the dashboard leads with what needs someone: the counts in one strip (the first
      red only when there are urgent shifts), urgent shifts and Needs attention beside the latest
      cancellations and enquiries, and what casuals can see last as a table, a row per event with
      its switch; Events & sessions folds each event's full sessions under "{n} filled sessions";
      the casuals list shows a tag only for a problem (a valid licence or an up-to-date photo as
      quiet words, a missing photo as a small dot). Tests: the dashboard's order and words, the
      fold, and the browser tests (17.2)

Done when: both tasks are ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED; no action, rule or log entry is lost (every flow's browser test
still passes); `docs/screens.md` says what each changed screen shows; the `claims-auditor` checks
the phase against this line.

## Phase 18 — The redesign

Added 2026-10-21, Dylan's ask: "Implement this design in this codebase" (the Claude Design
"ShiftDesk redesign", https://claude.ai/code/artifact/f003545d-7a44-4a78-a778-16696db200a4, made
from the hand-off after Phase 17: "less information blurting out at you … easily understanding
with clean animations graphics and layout"), "but still the fonts and colours will still need to
be reworked use your available skills to do so". The design is the approved mock-up for its
layouts, parts and motion; its fonts and colours are reworked with the UI skills (frontend-design,
design-taste-frontend, ui-ux-pro-max), shown to Dylan as a before/after picture on 2026-10-21. Like
Phase 17, a redesign of the look and of how much each screen shows at once, not of what the app
does: every action, rule and log entry stays reachable. Docs: `docs/screens.md`, `docs/ui-design.md`.

- [x] Fonts, colours and motion: Public Sans for words and Barlow Condensed (drawn from road signs)
      for times, dates, gates and counts, both self-hosted from their npm packages; one type scale
      (the existing six sizes plus one 40px size for a shift's time and date); colours on the UK
      safety-sign roles (red: act now, sign yellow: needs doing, exit-sign green: done), navy ink and
      the navy dark theme kept (D7), every pair passing the contrast test; the firm's colour worked
      out per theme from its checked `#rrggbb` (its top band, its main button and its text colour
      each at least 4.5:1); the design's parts as shared components (the date tile, the sign plate,
      the seats); motion as the design's spec (150/200/250ms, one easing, a 150ms fade with reduced
      motion, CSS only); the firm's bar a white header with its initial or logo. Tests: the tokens'
      contrast in both themes, the firm colours for 30 colours in both themes, the type scale, the
      parts, reduced motion (18.1)
- [x] The casual Home: the next shift as a pass that opens in place into its details (travel, where
      to report, what to bring and wear, pay, "Open in maps", "Ask for a change", "Can't make it?");
      "Can't make it?" a sheet with the notice, the reason and "Cancel this shift", "Ask for a
      change instead" and "Keep my shift"; the cancelled confirmation; no shifts booked as an empty
      pass with "Find a shift"; "For you" as at most four rows (urgent shifts, what needs doing, her
      home area while she has none, shifts to apply for); the no-signal copy as the design's; the
      tab bar's words at 15px and Profile's count. Tests: each state, the sheet's cancel (reason,
      notice, strike), the browser tests (18.2)
- [x] Open shifts and taking one: the next 8 days as a strip (booked, urgent and open days), urgent
      shifts first then the rest, one card each with the date tile, time, role, place, seats and
      pay; the shift's page as the design's detail (places as seats, what it needs, pay, travel)
      with "Take shift" in a bar at the bottom, and its answers: booked (it moves into your
      shifts), someone else took it, offered first to people with fewer hours. Tests: the strip,
      the order, the seats, each answer, the browser tests (18.3)
- [x] The office: the menu in four groups (Today, Pay, People, Admin and records folded) with the
      How-to guide at the bottom and counts that are yellow only when they need someone; the
      dashboard as the design's: how many things need you, this week as a strip, one urgent place
      at a time with its seats and actions, "After that", "Waiting on others", "Sorted today"; the
      full Needs attention items on their own page (the bell goes there). Tests: the menu's groups
      and roles, the headline, the week, the focus card's actions, every Needs attention part still
      reachable, the browser tests (18.4)
- [x] Events & sessions as a two-week rota board: an event per row, its sessions as filled/needed
      pills on their days (red: urgent gap, outlined: places open, grey: full), the filters with
      counts (All, Need people, Urgent, Hidden), Earlier and Later; a row opens in place into its
      sessions' table (places as seats, pay, post, meeting point, uniform, the urgent switch, the
      "…" menu), with its showing switch, "Add a session" and the event's own page. Tests: the board's
      days and pills, the filters, the open row, the browser tests (18.5)

Done when: all five tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no action, rule or log entry is lost (every
flow's browser test still passes); `docs/screens.md` says what each changed screen shows; the
`claims-auditor` checks the phase against this line.

## Phase 19 — The strike's answer stays on screen

Added 2026-10-21, Dylan's answer to "When should I fix it?": "Fix it first", a small task on its
own, before any more work on the look. A bug on main since 12C.5, not from the redesign: on a
cancellation's record, "Withdraw strike…" answers "Withdrawn. It no longer counts, and the casual
sees it as withdrawn.", then the record refreshes. The page drew the buttons (and with them that
answer) only while the strike was live, so the refresh removed them, and the answer went before
anyone could read it. `tests/e2e/office.strikes.spec.ts` failed now and then because of it (a
NOT VERIFIED on `36b7468`). "Resend evidence" already works the right way (12E.1). No change to
what the screen shows when it works: `docs/screens.md` already promises the answer.

- [x] The strike's answers outlive the refresh: on a cancellation's record, the strike's buttons
      are always drawn in the same place for whoever may change strikes, "Withdraw strike…" only
      while the strike is live and the casual's details aren't deleted, "Keep strike" only while
      it's live and not reviewed, and nothing at all when there's no button and no answer; so
      "Withdrawn. …" (and any other answer, such as "Kept, …" on a deleted casual's strike) stays
      on screen after the record refreshes and the buttons go, and the withdraw form closes once
      the strike can't be withdrawn. Tests: which buttons show (both, one, none), and the browser
      test checks the answer is still there once the heading reads "Strike: Issued, then
      withdrawn" (19.1)

Done when: 19.1 is ticked with a stamp that includes the browser tests; `scripts/verify.sh` with
`RUN_E2E=1` prints VERIFIED; `docs/screens.md` says the answer stays after the refresh; the
`claims-auditor` checks the phase against this line.

## Phase 20 — The pass redesign

Added 2026-10-21, Dylan's answer to the mock-up made from his five reference screenshots (Steep,
Shopify, hilos, Neo Financial, Apple Wallet) with the UI skills
(https://claude.ai/artifact/W7srZZDKzGMyag4pJDNXUi, version 2, "with depth and what's different on
each screen"): "yes build this this is great". With it he took the mock-up's four proposals: dark
greys instead of navy (D7 changes), a Pay day tile on Home, one count of what needs the office (the
bell becomes a "Needs attention" menu item), and the board's show/hide switch moved into the opened
row. A redesign of the look and of where things sit, not of what the app does: every action, rule
and log entry stays reachable. The mock-up's "What's different" lists are the spec, screen by
screen. Docs: `docs/screens.md`, `docs/ui-design.md`.

- [x] The look: Instrument Sans for words, times and counts (its own fixed-width digits) and
      Instrument Serif for the greetings only, both self-hosted from their npm packages (SIL Open
      Font License), in place of Public Sans and Barlow Condensed; neutral ink and greys in light,
      and true dark greys in dark in place of navy (D7 changed); the status colours as tiles
      (urgent, to do, waiting, done) with their words, every pair passing the contrast test in
      both themes; depth as five tokens (a card lifted off the page, a panel, the pass, a bar that
      floats over the page, a sunk track), and no other shadow anywhere; the firm's colour worked
      out per theme as now, plus a quieter shade for the pass's second line, at least 4.5:1 on its
      band for any colour. Tests: the tokens and their contrast in both themes, the firm colours
      (30 colours, both themes), the fonts, where each depth token is used (20.1)
- [x] The casual Home: "Hi {first name}" in the serif; the next shift as a pass in the firm's
      colour (the firm, how soon, the date in words, the time large, the role and event, the gate on
      a white plate, the place), with Directions, Details and Can't make it? under it; Details
      opens a card under the pass (it works without JavaScript) in label and value rows: getting
      there as three tiles, report to, bring and wear (what the firm gives marked "We provide it"),
      pay, the instructions, then Open in maps and Ask for a change; "For you" as tiles (urgent
      near you, needs doing, more to apply for, the home area to add, and Pay day: the pay week's
      Friday, D8), each in the colour of what it is; the tab bar floating over the page, the current
      tab filled in the firm's colour; "Can't make it?" with the reasons as four large buttons, the
      problem right under them with the first reason focused, the strike notice in its own box,
      and a handle that pulls the sheet down. Tests: each state, the pay day, the sheet (reasons,
      notice, focus, pulling it down), the browser tests (20.2)
- [x] Open shifts, a shift's page and Booked: the strip's days lifted off the page (urgent days
      pale red, your booked day in the firm's colour with a tick) with its key in words; the filters
      right under the strip; urgent shifts first, then "More shifts you can apply for" in date
      order like the strip; "N places left" red only on urgent shifts; a shift's page with the
      urgent band, the time beside a pale red date tile, one card of label and value rows, and Take
      shift with its strike warning in a bar floating at the bottom; Booked with the same pass and
      three buttons as Home, and "Later" kept with "Find open shifts" when nothing else is booked.
      Tests: the strip, the order, the seats' colour, each answer, the browser tests (20.3)
- [x] The office shell, Dashboard and Needs attention: from 1024px no top bar, the page a white
      sheet on the grey frame; the menu with the firm at the top, "Needs attention" under Dashboard
      with its count (the bell goes), the groups, and the How-to guide, you (Log out) and dark mode
      at the bottom; below 1024px the top bar keeps Menu. One count of what needs you everywhere:
      the Dashboard's "N things need you" is the urgent places plus Needs attention's items (which
      now include enquiries that need a person), the same as the menu's. The Dashboard: a greeting
      with that count and where to start, today's date, the pay week and the shifts line; four
      count tiles (urgent places, needs attention, waiting on others, sorted today); every urgent
      place listed with "Offer to someone" and the rest under "…"; this week as bars per day with
      places still to fill; Needs attention, Waiting on others and Sorted today as panels of rows.
      Needs attention's page: its parts as panels, the sessions to mark one row per role, place
      and time (with how many sessions and people), each upload by name and time with its own
      Check, and "Also needs you" with the urgent places. Tests: the menu (groups, roles, the count),
      the count adding up, the tiles, the urgent places' actions, every Needs attention part still
      reachable, the browser tests (20.4)
- [x] Events & sessions: no show/hide switch on the board's rows (a hidden event says "Hidden
      from casuals"); event names in full, on two lines when needed; today marked in the firm's
      colour and weekends a shade darker; the filters and the dates on one row with the key under
      them in plain words; an opened row set into the board a step darker, with "Show to casuals",
      "Add a session" and the event's page; each session on two lines (role, when, places as seats
      with the count, pay on the right, the urgent switch and "…"; then post, meeting point and
      uniform). Tests: the board's days and pills, the switch only in the opened row, the two
      lines, the browser tests (20.5)

Done when: all five tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no action, rule or log entry is lost (every
flow's browser test still passes); `docs/screens.md` says what each changed screen shows;
`docs/ui-design.md` has the new tokens; the D7 row says what Dylan chose; the `claims-auditor`
checks the phase against this line.

## Phase 21 — The office's look

Added 2026-10-22, Dylan's brief: "Redesign the visual layer of the office dashboard and every page
that shares its components. Keep all features, routes, data and labels working exactly as they do
now. This is a visual and layout pass only." With the taste and ui-ux-pro-max skills and his five
references (hilos, Apple Wallet, Steep, Shopify, Neo Financial), and his list for the dashboard,
the menu, the colours and the system ("Build the system first ... Every component uses these
tokens. No one-off values."). The office only: every page under `/office`; the casual app keeps
its Phase 20 look (Dylan approved it). Where the brief names a change of words, the brief wins:
an urgent place says "3 of 4 filled" (not "1 of 4 places free") and its button shows "Offer" (still
named "Offer to someone"), and the dashboard's four cards jump to their own sections. His brief
asks for no mock-up first: it says screenshot, plan, build, then screenshot beside the references
and review. Docs: `docs/ui-design.md`, `docs/screens.md`.

- [x] The office's system: its own tokens for every office page (light and dark, from one set):
      a warm off-white page, white cards, near-black main buttons, and red, amber, blue and green
      only for statuses and the dashboard's tinted cards, each tint with a 1px border a shade
      darker; Geist for words (tabular figures), Instrument Serif for each page's headline only,
      and one face for the big numbers (heavy Geist or Geist Mono, both tried and one picked);
      sizes 12, 13, 15, 17, 20, 28 and 40px; spacing 4, 8, 12, 16, 24, 32 and 48px; corners 20px
      for cards, 14px for rows and round for pills; one soft shadow; 150–200ms transitions; hover,
      focus and pressed states; AA contrast in both themes. Tests: the office's tokens and their
      contrast in both themes, the fonts, and that no office file uses a size, gap, corner or
      shadow outside the system (21.1)
- [x] The menu and the shared parts: the menu on the page's ground with a grey pill for the page
      you're on, small grey group labels, one count style (a grey pill), and a tidy week and pay
      day at its foot; below 1024px the top bar and the drawer with 44px targets; buttons (main
      near-black, others grey pills, destructive red words on grey), cards, rows, tables, chips
      and page headers; and the dark round button over the menu's foot fixed where it comes from.
      Tests: the menu's states, the parts' classes, the browser tests (21.2)
- [x] The dashboard: a small date line over the headline, the shifts line quiet with its phone;
      four tinted cards (an icon, the label, the number, one grey line), each jumping to its
      section; the urgent places as one rounded list (a neutral date tile, the role as the title,
      the place and time in grey, a slim bar with "3 of 4 filled", "Not offered yet" in red, a
      small black "Offer" and a quiet "…"); this week as a bar per day, Monday to Sunday (filled
      against places, a dashed line for every place filled, red only on a day with urgent gaps,
      today's label filled, "No sessions" on an empty day) with "Open the rota board" as a grey
      pill; Needs attention, Waiting on others and Sorted today as tinted panels of white rows;
      a loading skeleton, and an empty and an error state, for every section. Tests: the
      dashboard's parts, the counts still adding up, every link and action, the browser tests
      (21.3)
- [x] Every other office page on the system: Needs attention, Events & sessions, Casuals,
      Enquiries, Cancellations, Pay, the records and settings, each with its loading skeleton,
      at 390px and 1440px in both themes. Tests: the browser tests of every office flow (21.4)

Done when: all four tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no route, label (but the two the brief
changes), link or action is lost; screenshots at 390px and 1440px, light and dark, are compared
with the references and reviewed with the taste skill; `docs/ui-design.md` has the office's
tokens; the `claims-auditor` checks the phase against this line.

## Phase 22 — The office's look, round 2

Added 2026-10-22. Dylan saw Phase 21 live: "the use of colours it just looks very bland theres
still no depth to any of the individual sections and a tacky scroll wheel on the left side you've
missed out on shaders layers and depth this whole time i also asked for animations still none not
ai slop just subtle reactive on click responses". He sent more references (dark admin dashboards:
Dashdark X, HITE EQ, notion>ision, PMD Digital, ovniscale) and picked the hilos direction (DM Sans,
DM Mono, a semibold serif). The mock-up (`docs/mockups/phase-22/`) was approved the same day with
one change: "remove the gradients theres no need for that". The office only; every route, label,
link and action stays. Where the real office differs from the mock-up: "Offer" opens the offer
page (it never sent anything by itself), so it shows a spinner while that page opens rather than
the mock-up's tick. Docs: `docs/ui-design.md`, `docs/screens.md`.

- [x] The system, round 2: DM Sans for words, DM Mono for the big numbers and Newsreader semibold
      for each page's headline, self-hosted; the window (a grey ground) with the page as a sheet on
      it, white surfaces with a lit top edge and a shadow of their own, and grooves set into them;
      the dashboard's four colours as full flat colour (coral, amber, blue, green) with a coloured
      shadow and a fine grain, and their panels as flat washes; no gradients; everything you press
      dips and springs back (about 90ms down, 300ms back), nothing moves on its own, and reduced
      motion turns movement off; AA contrast in both themes. Tests: the tokens and their contrast
      in both themes, the fonts, no gradient in the office's styles, every shadow pinned, the press
      feedback (22.1)
- [x] The shell and the menu: from 1024px the menu on the ground and the page as a sheet set into
      the window; below it, the top bar over a sheet with rounded top corners; menu rows 34px with
      a mouse and 44px on touch (always 44px in the drawer); the highlight slides to the page you
      pick; no scrollbar in the menu: an admin's whole menu fits a 1280 × 640 window, and a shorter
      one scrolls with no bar and a fade at the edge that has more; the how-to guide in the account
      menu; each count in its card's colour. Tests: the menu's rows and states, the fit at
      1280 × 640, the guide in the account menu on every page, the browser tests (22.2)
- [x] The dashboard: the four cards in full colour, lifting under the pointer and dipping when
      pressed, each jumping to its section, which shows where you landed; the urgent places' date
      tiles as small calendar pages with a red band and their fill bars set in grooves; "Offer"
      dipping and showing a spinner while its page opens; the "…" menu growing out of its button;
      this week's bars set in grooves (striped on a day with no sessions) with the day's numbers
      under the pointer or on focus; Needs attention, Waiting on others and Sorted today as washes
      of raised white rows. Tests: the dashboard's parts, its counts and links unchanged, the
      browser tests (22.3)
- [ ] Every other office page on round 2's parts (cards, list cards, tables, buttons, chips, fields,
      menus and confirmations), the skeletons pulsing rather than still, at 390px and 1280px in both
      themes. Tests: the browser tests of every office page (22.4)

Done when: all four tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no route, label, link or action is lost;
screenshots at 390px and 1280px, light and dark, sit beside the approved mock-up in
`docs/mockups/phase-22/`; `docs/ui-design.md` has round 2's system; the `claims-auditor` checks the
phase against this line.

22.4 stays open: Phase 23 replaces round 2's look before it was finished (22.4's fourth audit round
was stopped on 2026-10-23 when Dylan asked for a flat look instead).

## Phase 23 — The office's look, round 3, and the dashboard's charts

Added 2026-10-23. Dylan saw round 2 live: "i told you to remove the gradients and the colours are
still wrong what your making is like 2008 apple notes app look it needs to be modern these are your
last references" (two screenshots of a flat dark and light admin dashboard). The round 3 mock-up
(flat, cool greys, hairline cards, one sky blue for main actions, tinted chips, Plus Jakarta Sans,
a full-width top bar and the menu in its own card) was approved the same day: "looks good now add
more graphs and visuals that help the office team what needs work on instead of a lot of data and
words on the screen make more graphs that show what needs working on and upon clicking into the
graph it then shows the actual data". The mock-up with six charts and their panels of rows was then
approved with "go build it" (`docs/mockups/phase-23/`). The office only; every route, label, link
and action stays. Where the real office differs from the mock-up: the offers chart's third part is
"Said no or closed" (said no, filled by someone else, the session changed, or no reply before it
started: offers never run out by themselves); a licence is "soon" within 30 days, the same window as
Casuals' "Need updating"; short notice is the firm's strike notice setting, not a fixed 24 hours;
the Needs attention items with no date (bookings to check, changes from the sheet, licences that
won't be in date) are named under the waiting chart instead of put in an age; pay's part of that
chart and its rows show only to roles that can open Pay; the pay week in the top bar is words, not a
button. Docs: `docs/ui-design.md`, `docs/screens.md`.

- [x] The system, round 3: Plus Jakarta Sans for every office word, number and headline,
      self-hosted (DM Sans, DM Mono and Newsreader removed); cool greys (a light grey ground with
      white cards, near-black with dark grey cards), 1px hairline edges, corners of 28px (the page
      and the menu), 22px (cards inside a page) and 14px (rows), pills for buttons and chips; no
      shadow at rest, one soft shadow only on what floats (menus, the drawer, the toast, the
      tooltip and the chart panel); no grain, glows, coloured shadows or gradients; one sky blue
      for the main button with near-black words; tinted chips in red, amber, blue and green; every
      press still dips and springs back; AA contrast in both themes. Tests: the tokens and their
      contrast in both themes, the font files and packages, no shadow at rest, no grain and no
      gradient in the office's styles, the blue main button, the chips, the press feedback (23.1)
- [x] The shell and the menu: a full-width top bar at every width with the firm's mark and name,
      the pay week ("Week 43 · 19 Oct – 25 Oct · Pay Fri 30 Oct", with "This week"), the shifts
      line's number, a square light or dark button, and your initials and name opening the account
      menu (How-to guide, the light or dark switch, Log out); from 1024px the menu in its own white
      card under the bar with its groups' names in small capitals, and the page in another white
      card; below 1024px Menu opens the drawer; an admin's whole menu still fits a 1280 × 640
      window; the loading skeletons flat. Tests: the shell's parts and states, the fit at
      1280 × 640, the browser tests (23.2)
- [x] Every other office page on round 3's parts (cards, lists, tables, tabs, buttons, chips, fields,
      menus, confirmations, answer slips and code boxes: hairlines, no shadows), the events board and
      the logged-out pages included, and the how-to guide's words matching the new layout, at 390px
      and 1280px in both themes. Tests: the browser tests of every office page, record and login
      page (23.3)
- [x] The dashboard's charts: the four counts as white cards that open their lists; the urgent
      places as cards with a wide Offer; six charts in place of the week strip and the three text
      panels: places to fill over the next 14 days (urgent apart), which events need people
      (hidden ones marked), offers this week (said yes, waiting for a reply, said no or closed)
      with the sessions still waiting, how long things have waited (what needs you and what's with
      payroll), cancellations over the last 14 days (short notice apart), and licences running out
      in the next 8 weeks (those booked after they run out marked); every bar, dot and count opens
      a panel of the real rows with their actions (from the side from 1024px, from the bottom on a
      phone); each chart has a Numbers table and its figures on pointer or keyboard focus; every
      link the old panels had is still on the dashboard; every new query goes through the firm's
      data layer, each in its own part; the demo's made-up data gains this week's offers. Tests:
      the loaders (with the clock change on 25 Oct and another firm's rows), the chart builders,
      the browser tests (23.4)

Done when: all four tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no route, label, link or action is lost;
screenshots at 390px and 1280px, light and dark (the chart panel and the phone's sheet among them),
sit beside the approved mock-up in `docs/mockups/phase-23/`; `docs/ui-design.md` has round 3's
system; the `claims-auditor` checks the phase against this line.

## Phase 24 — Liquid Glass (round 7 of the canvas)

Added 2026-10-26. Dylan's design chat built the office and the casual app up on a Design canvas
("ShiftDesk polish, before and after", https://claude.ai/artifact/3uQHabiVYTazwyCkAAH9EJ), round by
round from his references: BizLink and Haulix on Dribbble (round 4: "fold the sidebar too ... i want
it tailored a lot more like those two"), CSP Connect's off-white grounds (round 5: "replicate it more
so to the Haulix ... dont forget the apple ui stuff shadows etc ... it really doesnt need to show
whats been filled unless it was done during out of office times by the system"; "your shifts line
isnt needed"), Apple's Liquid Glass (round 6: "looks good now implement" Apple's Liquid Glass pages,
liquidglassdesign.com and the apple-liquid-glass-ui-skill), then glass on everything after
liquidglassdesign.com's examples (round 7: "it should be kinda translucent buttoms sections icon
backgrounds etc"). He approved round 7 on 2026-10-26: "keep round 7 and build it into the app", and
chose "Round 7 exactly, layout too" over glass on today's layout: the round 7 layout replaces Phase
23's dashboard (its four count cards, urgent cards and six charts) and the office shell, and the
casual app's Phase 20 screens. On pay he chose: a week's total only when payroll gave a gross for
every line of that week. The mock-up is recorded in `docs/mockups/phase-24/` (its pages, light and
dark, and a README that describes them in words, since builders can't open the canvas). Every
action, rule and log entry stays reachable; where a word changes, the mock-up's word wins unless it
would say something untrue (listed in the README under "Where the build differs").
Docs: `docs/ui-design.md`, `docs/screens.md`, `docs/office-v2.md`.

- [x] The system, round 7: Geist for every word and number in the office and the casual app,
      self-hosted from `@fontsource-variable/geist` (SIL Open Font License; Instrument Sans,
      Instrument Serif and Plus Jakarta Sans removed); one set of tokens for both, light and dark: a
      pastel wash fixed behind every page (blue, lavender, peach and mint; in dark, blue, purple,
      orange and teal light on near-black); sections as frosted glass (a translucent fill, a blur
      and saturation of what's behind, a lit rim and a soft drop); buttons, chips, tiles, avatars and
      counts as clear glass (a translucent fill with a bright rim); the main button as tinted glass
      in the firm's colour (its colour to a darker shade, a lit top edge, white words at 4.5:1 or
      more); what floats (the rail, the top bar's capsules, the tab bar, panels, menus, the toast)
      as the strongest glass; refraction (an SVG displacement before the blur) only in browsers
      that draw it (Chromium), frosted glass elsewhere; grey words a shade darker so every word
      keeps 4.5:1 over the worst point of the glass and the wash in both themes; glass controls
      swell a little and brighten under a press and spring back; reduced transparency, more
      contrast and no blur support turn every surface solid, forced colours use the system's,
      reduced motion stops movement. Tests: the tokens; every text pair's contrast worked out over
      the glass composited on the wash's worst point, both themes; the firm palette on the new
      grounds; the fonts and packages; the fallbacks; the press; the Phase 20 to 23 pins on the
      flat look replaced by pins on this system, as strict (24.1)
- [x] The office shell: an icon rail at the left (the firm's mark; Dashboard, Needs attention,
      Events & sessions, Enquiries, Cancellations, Pay with Pay dashboard, Pay queries and Import pay
      records, People with Casuals, Strikes and Notice report, Admin and records with its pages),
      a dot on an icon whose page needs you, names and counts when the button under the mark opens
      it, its name on hover or focus when shut; a top bar of three glass capsules that stays at the
      top with a soft frosted edge once the page scrolls under it: the counts (To fill, Urgent,
      Offers out, To check, Pay queries; each opens where it's worked, each only for the roles that
      can open it), Search ("Find a casual, shift or site", ⌘K or Ctrl K), and the light or dark
      button with you (initials, name, role) opening the account menu; below 1024px the rail goes
      and Menu opens the drawer as now; the pay week moves into the dashboard's subline and the
      shifts line's number leaves the top bar (Settings keeps it). Tests: the rail's states, dots and
      counts per role, the capsules' counts adding up, search (another firm's casuals never
      found), the account menu, the drawer, the browser tests (24.2)
- [x] The dashboard: "Dashboard" with the date, the pay week, its pay day and when the planner or
      sheet last sent changes; All, Urgent, This week and Next week (sessions with places to fill);
      Places to fill over this week and next, by day, split into not offered yet and offered with
      no reply; a detail card for the chosen session (date tile, role, Urgent, event, post and site,
      when, places to fill, starts in, offers sent and replies, who hasn't replied since when, "Offer
      to someone" and "Open the shift"); a board of four columns: To offer, Offered, While you were
      out (places casuals took themselves from offers between 18:00 and 08:00, with how and when),
      and Who worked? (sessions to mark from the last 7 days); a card picks into the detail card,
      its paper plane opens the offer panel, "Show N more" shows the rest; the offer panel (from
      the side, from the bottom on a phone) lists who can take it from the rules, with Send offer
      and who has been offered and how they answered; the six charts, the four count cards and the
      urgent cards leave, every action and page they led to staying reachable. Every new query
      goes through the firm's data layer. Tests: the loaders (another firm's rows, the clock change),
      the board's columns and counts, the offer panel's list matching the offer page's, the browser
      tests (24.3)
- [x] Events & sessions, Enquiries and Casuals as in the mock-up: events as cards in two columns
      (place and dates, the show-to-casuals switch on the card with its answer in words, Showing or
      Hidden, Urgent not filled, sessions and places free; each session with role, when, Urgent,
      what it needs, post, a fill meter, pay an hour and its "…" menu; filled sessions folded; View
      sessions) with All, Showing, Hidden and "Urgent, not filled"; Enquiries as the list beside the
      chosen message from 1024px (the conversation, how it was answered, the reply, "Close, no reply
      needed" asking why, since the log keeps a reason), the message's own page kept for phones and
      links; Casuals as one table (initials, name and roles, qualifications with their dates, staff
      photo, travel area, live strikes, needs updating) with All, Need updating and Uploads to
      check, and the search box over it. Tests: each page's parts and answers, the browser tests
      (24.4)
- [x] Every other office page on round 7's parts: Needs attention, Cancellations, Pay dashboard, Pay
      queries, Import pay records, Strikes, Notice report, the records and settings, a shift, an
      event, a casual, the offer page, the how-to guide (its words matching the new layout) and the
      logged-out pages, at 390px and 1280px in both themes. Tests: the browser tests of every
      office page, record and login page (24.5)
- [x] The casual app as in the mock-up: the firm's bar frosting once the page scrolls under it;
      Home ("Hi {first name}"; the next shift as a glass pass with its warm band, how soon, the date,
      the time large, role and event, the site, town and postcode with the gate on a plate,
      Directions and Details side by side, Can't make it? under them; Do this, Shifts you can take
      and Pay as rows); Open shifts (the Open and Booked switch, the strip of days, the count of
      shifts with "Site and role" opening the filters, urgent first, each shift as a card with its
      travel and places left); a shift's page (the urgent band, the time by its date tile, the
      hours, what it needs, where with the gate, getting there, places as seats, you need, report
      to, bring and wear, pay, and Take shift floating at the foot with the strike warning; "You're
      booked." over the whole screen); Pay (the code step, then each week: its total when payroll
      gave a gross for every line, otherwise each line's gross; the lines, the pay date, earlier
      weeks one row a week, your pay queries); the tab bar as a floating glass capsule with a lens
      on the current tab that shrinks to its icons while you scroll down and opens again when you
      scroll up or tap (still plain links that work with no JavaScript and offline); Booked,
      Profile, Requests and Urgent shifts on the same parts. Tests: each screen's states, the pay
      total rule, the tab bar with and without JavaScript, the offline copy, the browser tests
      (24.6)

Done when: all six tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no route, action, rule or log entry is lost;
screenshots at 390px and 1280px, light and dark, sit beside the mock-up in `docs/mockups/phase-24/`;
`docs/ui-design.md` has round 7's system; the `claims-auditor` checks the phase against this line.

## Proposed 2026-10-26: the firm's CRM and ops portal, the staffing email, a bigger firm (not started)

Dylan's ask (2026-10-26): connect ShiftDesk to how the pilot firm really works, take over "our queries
and staffing email … so we can focus on staffing events instead of working a lot on queries,
cancellations and background work", and make the codebase "handle a lot of prompts": lots of
casuals at once, lots of office users at once, and lots of Claude Code sessions. Who owns what, in
his words: **AXLR8** (the firm's CRM) is "for everything basically" (events, sessions, roles, staff,
qualifications, bookings); the firm's **ops portal**, built on AXLR8, has "our payroll check in and
out and real time on site data"; casuals use **ShiftDesk** for shifts (see, grab, cancel, change,
ask), and on-site stays in the ops portal.

**No agreement is signed** (Gate B), so golden rule 7 holds throughout: everything is built and
tested on made-up data shaped like the firm's (Acme, `ZZ` postcodes, made-up people), and nothing
names the firm, its address, its venues, clients or people. The vendor names AXLR8 and Webex
Interact may appear (products many firms use, like Deputy in ADR-008). AXLR8's API Builder PDF is
AXLR8's own confidential document: never commit it or copy its field lists; the made-up AXLR8 in
tests uses our own names. Nobody explores AXLR8's API with an employee's login before the agreement.

These are **proposals**: their tasks get boxes, a number and a "Done when" line when Dylan gives
each one the go-ahead (golden rule 10). They're labelled P1 to P8 so they can't clash with phases a
parallel chat adds. Tasks marked **attended** are built with Dylan's session open, not by `/overnight`:
those that touch `.claude/` or `scripts/invariants.sh` (which `/overnight` may not edit), and those
that add a secret or the connector (worth watching as they're built). The questions to send first are in
`docs/discovery-axlr8.md`; the decisions they needed, all taken on 2026-10-26, are under
"Connecting the firm's systems" in "Decisions waiting for Dylan". Flags: **S** schema, **A** auth, **T** tenancy, **M** messaging,
**R** rules (each needs Dylan's OK and the `guardrails-reviewer`); **UI** changes a screen (a
mock-up first).

**First answers (Dylan, 2026-10-26;** `docs/discovery-axlr8.md` "Answers"**).** AXLR8 can't be
asked for now. The ops portal has an API that can share attendance and pay lines per person, and it
copies from AXLR8 every hour. Texts go through the firm's own Webex Interact account, at about 20p
a text, with replies turned off. The staffing mailbox is on Microsoft 365. Pay is fortnightly,
always on the Friday. Bookings: the office books normally (in AXLR8); places filled overnight, out
of office hours, for the next day, and urgent places, are booked through ShiftDesk, and the office
can book through ShiftDesk too. (Those overnight places are filled by ShiftDesk's offer waves: code
and the rules decide who gets a place, never AI, golden rule 1.) So:

- **The ops portal's API is the first source** (P5 and P6), AXLR8 directly later (ADR-026). Its
  copy of AXLR8 can be up to an hour old, so ShiftDesk offers casuals only the places the office
  opens to it (urgent ones and next-day ones still open after hours), through the existing "showing
  to casuals" switch, and a session's other places stay the office's.
- **Texts cost money, and casuals can't text back.** At about 20p, a wave that texts 1,500 people
  costs about £300 for one place: the wave cap ("Connecting the firm's systems" 5) matters, and so
  does Messages 2 (Claude now recommends the app's notification first, a text only when a phone has
  no notifications on). Phase 15's replies task waits until the firm turns replies on; casuals answer
  in the app meanwhile.
- **Email:** Microsoft 365 blocks automatic forwarding to outside addresses by default, so the
  firm's IT allows it for ShiftDesk's one address (P7), or a later version reads the mailbox through
  Microsoft's own API with the firm's consent.

**Second answers (Dylan, 2026-10-26;** `docs/discovery-axlr8.md` rows 4.P1 to 4.F3**).** The ops
portal's API gives sessions, staff, qualifications and who's booked; it takes bookings and passes
them on to AXLR8; and it sends changes as they happen (to confirm from its documentation). AXLR8
can send any texts the firm chooses, and ShiftDesk sends the texts about its own bookings
("Connecting the firm's systems" 9). Pay cycle 1 ran Mon 29 Dec 2025 – Sun 11 Jan 2026, paid Fri
16 Jan: every cycle is two ISO weeks, paid the Friday after. So:

- **The ops portal is the whole source, both ways,** and AXLR8 isn't needed directly for now.
- **P5 is push first, with a pull to catch up:** the portal's webhooks in, under golden rule 3, and
  a reconcile pull as the backstop (P5).
- **Bookings made in ShiftDesk go to the portal's API,** which passes them on to AXLR8; the office's
  "Enter in AXLR8" list is only the fallback for when the portal is down or slow.
- **What stays:** a change made in AXLR8 reaches the portal on its hourly copy, so ShiftDesk still
  offers casuals only the places the office opens to it.

**Order.** Now: Dylan gets access to the ops portal's documentation and a test copy with made-up
data, and sends the follow-ups (`docs/discovery-axlr8.md` §4 and §5). After the parallel UI chat's
work is merged (it edits the same files): P1, then P2, P3 (each item as it's decided), P5's
framework and secret store, P7's core and P8, all on made-up data. P4's back end now, alongside the
UI chat (go-ahead 2026-10-26: it changes no screen), and its office pages after the merge. Once the API's shape is known: P5's first connector (the ops
portal), P6, and Phase 15's texts. After signing: the real API key, a shadow cycle (P5's sessions
come in hidden from casuals; the office compares ShiftDesk's required and booked counts with the ops
portal each day for one pay cycle), a few events live, then everything, then the email inbox.
AXLR8 directly when it can be asked.

### P1 — The repo, easier for Claude (attended; docs and config only; go-ahead: Dylan, 2026-10-29, built last)

Why: `PLAN.md` is about 470 KB (well over 100k tokens) and `/next-task` reads all of it; `docs/work-log.md`
is 858 KB and `docs/overnight-log.md` 1.1 MB, and both only grow.

- Move fully ticked phases to `docs/archive/plan-done.md`. Open items from earlier phases (the
  Gates, Phases 4, 6, 7, 8, 9, 15 and 22) stay in `PLAN.md` under "Still open from earlier phases",
  so `/next-task` and `/overnight` still find them. The archive is frozen: its sha256 is pinned in
  `scripts/invariants.sh`, so any change to it fails verify and blocks every tick until undone. (Not
  a `*PLAN.md` name: the tick guard, `.claude/hooks/guard-plan-tick.sh` with its helper
  `plan-ticks.mjs`, counts a new file with ticked lines as a tick and would refuse the move, and the
  shell hooks watch the root `PLAN.md` only.) Each open phase keeps its "Done when" line in
  `PLAN.md`, where `/close-task` and the `claims-auditor` read it.
- Move the Parking lot and the Hours log to `docs/plan/parking-lot.md` and `docs/plan/hours-log.md`,
  leaving a one-line pointer heading in `PLAN.md`: about 105 lines outside `PLAN.md` and the three
  history docs name these sections, 46 of them in code, tests, scripts and deploy files
  (`git grep -E "Parking lot|Hours log"`, 2026-10-26). Old `PLAN.md` line numbers in `docs/audit-2026-09-30.md` and the logs get a
  dated note that they point at `PLAN.md` as it was then.
- The logs by month (`docs/logs/work-YYYY-MM.md`, `docs/logs/overnight-YYYY-MM.md`), the old files
  kept as small indexes, and `docs/plan/blocked.md` so `/overnight` finds blocked tasks without
  reading a 1.1 MB log.
- Update CLAUDE.md rule 10's wording, `.claude/commands/next-task.md`, `overnight.md`,
  `log-hours.md`, `fact-check.md` and `.claude/agents/doc-fact-checker.md` to the new places
  (`close-task.md` and the `claims-auditor` need no change while "Done when" lines stay put).
- Short local `CLAUDE.md` files only under `src/lib/<area>/` (integrations, rules, roster) and
  `src/worker/`, which Claude Code reads only when working there; not under `src/app`, which unit
  tests walk (check which before adding any).
- Tests: `scripts/selftest.sh` passes; the archive pin fails on a planted change; `/fact-check`
  finds no dead links; `PLAN.md` under 100 KB (the Decisions list alone is about 50 KB: if that's
  still too much, it moves to `docs/plan/` next).

### P2 — Reach casuals in production (go-ahead for the back end: Dylan, 2026-10-28; its words on the login and Pay pages after the UI chat's Phase 24; S, A, M)

Why: casuals get their login link and their pay code by WhatsApp only
(`src/lib/auth/send-portal-link.ts`, `src/lib/auth/send-login-code.ts`), no real
text sender exists (`MESSAGING_TRANSPORT` takes only `console`, `src/lib/env.ts`), and the job worker
refuses to start in production without one (`src/lib/env.ts`, `deploy/docker-compose.yml`). Every
sync, webhook, reminder and offer wave runs in that worker. Every message to a casual goes by
WhatsApp, then a text (`sendToWorker`, `src/lib/notify/send.ts`), a push only after a text that
went; and no booking records where it came from, so the reminders go to every confirmed booking.

**This round is the back end only** (Dylan, 2026-10-28: "P2 back end"): the UI chat is still on
Phase 24.5 and 24.6, so no task here changes a screen, an office page, `src/app/`, `src/lib/office/`,
`docs/screens.md` or `docs/ui-design.md`. New words (each email's subject, the casual's login-link and
code emails) go in `docs/messaging-templates.md` first, for Dylan to approve (P2.1). Decisions:
"Connecting the firm's systems" 15 to 17.

- [x] The words (docs only; Dylan approves them before P2.4 and P2.6 are built): in
      `docs/messaging-templates.md`, a subject line for each message to a casual that can go by
      email (offer, urgent offer, booking confirmation, the 24-hour and 2-hour reminders, the firm's
      change and cancellation, a request's answer, a pay query's answer, the office's reply, the
      licence warning and notice), its body the message's own approved words (as in the WhatsApp
      templates); the casual's login-link and code emails; a policy paragraph on the order (push,
      then a text once a sender exists, then email) (P2.1)
- [x] Where a booking came from (S): `assignments.booked_via` (app: a casual's own take or an
      accepted offer; office; sheet; api, for P5), checked like `cancel_via`, written by
      `bookShift()` (`src/lib/roster/book.ts`) and the sheet sync (`src/lib/roster/sheets/sync.ts`);
      the migration fills the bookings there are from each one's `shift.assigned` event, and one
      with none counts as the office's (as `src/lib/strikes/issue.ts` already does). Tests: each
      writer, the backfill, the check, another firm's rows (P2.2)
- [x] Who sends what: an owner setting `firm_system_sends` (off unless the firm says so: ShiftDesk
      sends as today); on, no booking confirmation and no 24-hour or 2-hour reminder from ShiftDesk
      for a booking whose `booked_via` is sheet or api (the firm's own system tells those casuals);
      offers and the office's change and cancellation notices still go (decision 9). Tests:
      `shift.reminders.test.ts`, the confirmation, `onboarding.test.ts` (P2.3)
- [x] Push first, then a text, then email (M; after P2.1): one `deliverToWorker()` in
      `src/lib/notify/send.ts`: a push to the casual's phones (delivered once one phone takes it),
      else a WhatsApp or text as now (STOP respected), else an email with P2.1's subject when they
      have an address, else not sent (`no_channel`, logged); a transport with no text sender says so
      (`NoTextSenderError`), never a failed text. Every sender moves to it, keeping claim → send →
      record: offers, reminders, the booked, change, request and pay-query notices, the licence
      messages (those with no push today skip it: no new push words). The shifts line's own replies
      and STOP or START stay text only (decision 11), and so do the office's replies on Enquiries:
      each answers a message to the shifts line, so a text sender exists, and its `messages` row and
      the office's page take WhatsApp or text only (Parking lot, P2.4; Dylan, 2026-10-29: this
      sentence replaced "the office's replies" in the list above). The office's change and
      cancellation notices, the proof of the notice given, go by the WhatsApp, text or email as
      well as the push, never instead of it (Dylan, 2026-10-29). Migration:
      `shift_reminders_channel_check` takes push and email. Tests changed on purpose (Messages 2:
      a push now instead of the text, not beside it) named in the commit; new: each step, a push gone
      or failed falls to a text, no text sender falls to email, no address is `no_channel`, nothing
      twice on a retry (P2.4)
- [x] The worker runs in production with no text sender (M): `MESSAGING_TRANSPORT=none` (an empty
      value unset), allowed in production; the Compose file's worker runs without its profile,
      with `none` by default and SMTP email as production already insists; the send-failure alert
      ignores `no_text_sender`, as it does `sms_opted_out`. Tests changed on purpose: the production
      refusals (`env.test.ts`, `env.demo.test.ts`, `push*.test.ts`) and `deploy.compose.test.ts`;
      new: the worker starts in production with `none` and SMTP, and still refuses `console`.
      Docs: `docs/runbooks.md`, `docs/architecture.md` (P2.5)
- [x] Login links and pay codes by email, switched off (A, M; after P2.1): an owner setting
      `login_by_email` (off); `send-portal-link.ts` and `send-login-code.ts` choose the channel at
      the claim: a text if a sender exists, else (with the setting on and an address) P2.1's
      email, else not sent (`no_channel`); the events log the channel used, never a hard-coded
      WhatsApp. A casual's email lowercased and checked in `upsertWorker`
      (`src/lib/roster/workers.ts`), and a changed address ends their sessions, as a changed mobile
      does (audit L81). The login-link alert counts emailed links too. Tests: the login flow, its
      events, the code, no resend; off sends nothing by email; an email change logs the casual
      out. Docs: `docs/data-model.md`, `docs/compliance.md`, `docs/privacy-notice.md` (its "How we
      contact you" paragraph approved by Dylan, 2026-10-29) (P2.6)

**After the UI chat's Phase 24 merges** (not this round): the login page, the Pay code step, help
and the profile's notification note stop naming WhatsApp, `docs/screens.md` first (P2.7); then a
firm can switch `login_by_email` on.

Done when: P2.1 to P2.6 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` or `src/lib/office/`
changed, except the dashboard's one channel word "email" in `src/lib/office/board-copy.ts`
`CHANNEL_WORDS` (P2.4; Dylan, 2026-10-29), and no words but those Dylan approved in P2.1 (and the
privacy notice's "How we contact you", P2.6; Dylan, 2026-10-29); the worker starts in production with no
text sender; a casual is reached by push, else a text, else email, else the miss is logged; every
booking says where it came from, and with `firm_system_sends` on, sheet and API bookings get no
confirmation or reminders from ShiftDesk; with `login_by_email` on, a casual's login link and pay
code go by email; the `claims-auditor` checks the phase against this line.

### P3 — Fit the firm's model (go-ahead for the back end: Dylan, 2026-10-29, Rules 3 too; screens after the UI chat's Phase 24; S, T, R)

**This round is the back end** (Dylan, 2026-10-29: "just finish it all"; Rules 3 "build the rule
now"): the UI chat is still on Phase 24.6, so no task here changes a screen, `src/app/` or an office
page, and no casual-facing words beyond those Dylan approves. The proposal's items follow the tasks.

- [ ] Pay calendar (S): `payPeriod(day, calendar)` beside `payWeek()` (`src/lib/pay/pay-week.ts`,
      pure; with no calendar set, exactly today's ISO week paid the Friday after); an owner setting
      `pay_calendar` (7 or 14 days, an anchor Monday, the pay day as days after the period ends,
      the label Week or Cycle) through `src/lib/onboarding/settings.ts` (the proposal below says
      "a migration like 0037": not needed, as like every owner setting the app can't write it,
      `app_set_firm_setting()` taking only its own keys); pay-query grouping
      (`src/lib/pay/grouping.ts`) by the firm's pay period. Tests: made-up anchors, the 53-week year
      (2026), the clock change, a firm without a calendar unchanged (P3.1)
- [ ] Name map per firm (S, T): a table of outside names (role, qualification, staff type,
      cancellation reason) each mapped to a ShiftDesk code (a role with its pay rate) or to skip,
      with `firm_id`, RLS, a `TABLE_ACCESS` entry and isolation fixtures; an owner script to set it
      (like `scripts/firm-sheet-owner.ts`), each change logged; the sheet sync and the file import
      use it: role names (a skipped one is left off a worker's roles, and its shift row isn't
      brought in), and the credentials import's qualification names, with `normaliseRole`
      (`src/lib/roster/sheets/parse.ts`) and the import's own spelling as the fallbacks; an
      unmapped name neither can read is a bad role or type, logged with the sync's or the import's
      problems and never offered. Staff types and cancellation reasons (neither the sheet nor a
      file carries one) and a role's pay rate are held for the connector (P5): the sheet and the
      import never write a session's pay (S2). Tests: mapped, skipped, unmapped, another firm's
      map unused (P3.2)
- [ ] "Any of" licences (S, R; Rules 3, Dylan 2026-10-29): a rule may need one of several
      credential types (a door supervisor licence covers guarding: the security pack's
      security officer takes either), in `src/lib/rules/packs.ts`,
      `src/lib/credentials/requirements.ts`, `src/lib/rules/eligibility.ts` and
      `docs/rules-and-credentials.md` together (the parity tests hold them in step); every place
      that reads a rule's types reads the groups (with no new words: a group shows as its first
      type, and fails in its first held type's words, until the "A or B" words are approved). Tests: either licence passes, neither fails, an
      expired one doesn't count, "all of" rules unchanged (P3.3)
- [ ] Who asked for a cancellation (S, R): recorded apart from who carried it out (casual, firm,
      client, unknown), backfilled from each cancellation's own record; the casual's own cancel says
      casual, the planner API and the sheet what their data says (neither says yet: not known), the
      office firm (its form asks, after the UI chat); the notice report
      (`src/lib/office/notice-report.ts`) counts by who asked; a per-firm strikes switch
      (`src/lib/strikes/settings.ts`; off, its strike column's words are Dylan's to approve). Tests: each writer, the backfill,
      the report's counts, strikes off issues none (P3.4)

**After the UI chat's Phase 24 merges:** Home's pay day from the firm's calendar or its imported
`pay_records.pay_date` (`src/app/page.tsx`), the top bar, the dashboard and the pay dashboard;
payroll's pay-query headings and the digest email's headline for a fortnight ("the week of" today,
`src/lib/ai/pay-summary.ts`: new words, Dylan's to approve); the
Needs attention items for an unmapped name and for a skipped name on a session still to come
(the sync's `skipped_live`), the import page's "left out" count and the action log's words for a
name map change ("The firm's settings changed" today); the casual's "you need A or B" words (a
mock-up first);
the office's "who asked" choice when it cancels, and who asked on the notice report's page and file.

Done when: P3.1 to P3.4 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` changed and no screen or
casual-facing words; a firm without a pay calendar or a name map works exactly as before; a door
supervisor licence lets a casual take a security officer's shift where the firm's rule says either;
the notice report says who asked for each cancellation; the `claims-auditor` checks the phase
against this line.

The proposal (2026-10-26):


1. **Pay day** (S, UI). Quick fix first: the casual's Home takes the pay day from the imported
   `pay_records.pay_date` when there is one, as the office's pay page already does (today
   `src/app/page.tsx` works it out from the weekly rule, so a fortnightly firm's casuals would read
   the wrong day: golden rule 9). Then a per-firm pay calendar, reversing D8 (Pay 10) (the pilot
   firm: two ISO weeks a cycle, cycle 1 Mon 29 Dec 2025 – Sun 11 Jan 2026, paid the Friday after;
   the year-end rule still to ask, `docs/discovery-axlr8.md` §5): 7 or 14 days,
   an anchor Monday, the pay day as days after the period ends, and the label "Week" or "Cycle". The
   pure `payWeek()` (`src/lib/pay/pay-week.ts`) becomes `payPeriod(day, calendar)` with today's rule
   as the default; the setting goes through `src/lib/onboarding/settings.ts` and a migration like
   `drizzle/0037_firm_setting_checks.sql`; its readers are the top bar (`src/app/office/layout.tsx`,
   `office-shell.tsx`, `office-frame.tsx`), the dashboard (`dashboard-view.tsx`,
   `dashboard-charts-load.ts`), the pay dashboard (`src/lib/office/pay-dashboard.ts`), and Home
   (`src/app/page.tsx`, `src/app/home-view.tsx`, `src/lib/portal/home-copy.ts`); pay-query grouping
   (`src/lib/pay/grouping.ts`) groups by the Monday (`mondayOf`) and moves to the pay period. The weekly hours cap stays Monday to
   Sunday. Tests use made-up anchors, the 53-week year (2026) and the clock change.
2. **A name map per firm** (S, T, R): each outside name for a role, qualification, staff type or
   cancellation reason, mapped to a ShiftDesk code (and a role's pay rate), or to "skip"
   (Contracted, Holiday, "Not Set", the CRM's not-available and cancellation pseudo-events). Today a
   role code must match `^[a-z][a-z0-9_]*$` (`src/lib/db/schema/roster.ts`), so "12D" and brackets
   fail, and pay tiers (NLW, LLW) sit inside role names. `normaliseRole`
   (`src/lib/roster/sheets/parse.ts`) is the fallback; an owner-only script sets the map (like
   `scripts/firm-sheet-owner.ts`); unmapped names show in Needs attention and are never offered. A
   new table: `firm_id`, RLS, a `TABLE_ACCESS` entry and isolation fixtures.
3. **Traffic-management qualifications and roles, and "any of" rules** (R, UI): Chapter 8, NHSS
   12D, traffic marshal, supervisor and event manager, in `src/lib/rules/packs.ts`,
   `src/lib/credentials/requirements.ts`, `src/lib/rules/eligibility.ts` and
   `docs/rules-and-credentials.md` together (the parity tests check they match); a role that takes a
   door supervisor or a security guard licence (Rules 3). The casual's "you need A or B" wording: a
   mock-up first.
4. **Who asked for a cancellation** (S, R, UI): recorded apart from who carried it out (casual,
   firm, client, unknown), and used by the notice report (`src/lib/office/notice-report.ts`). Today a
   casual who phones in and is cancelled by the office in the CRM shows as a short-notice firm
   cancellation, which matters for Employment Rights Act compensation. Plus a per-firm strikes switch
   (`src/lib/strikes/settings.ts`). Planner and sheet cancellations are already never strikes
   (`src/lib/strikes/decide.ts`).
5. **Availability out** to the CRM: waits until discovery says whether AXLR8 keeps it.

### P4 — Ready for a big firm (go-ahead for the back end: Dylan, 2026-10-26; office pages after the UI chat merges; S, T, M, R)

Target: about 2,000 casuals, 110 events a fortnight, 10 office users at once, 1,000 messages in 10
minutes; the firm's texts cost about 20p each. Today the design assumes small numbers
(`docs/architecture.md`: "Scale is small (tens to a couple of hundred messages per firm per day
…)"). A first-come wave goes to everyone eligible, one at a time: an estimate, if 1,500 of 2,000
casuals are eligible at about 0.35 s each (one rules check of about 9 queries, the locks and the
send), is about 1,500 texts and about 9 minutes for one place, with other firms' waves waiting. The
pool is 10 connections per process with no timeouts, and an office page opens up to 5 transactions
one after another before its own (an admin's; fewer for a resourcer or payroll).

**This round is the back end only** (Dylan, 2026-10-26: "Mark PR ready; start P4 back end"): a
parallel chat is changing the office's screens, so no task here changes a screen, an office page,
a message's or an email's words, or anything under `src/app/`, `src/lib/office/`, `docs/screens.md`
or `docs/ui-design.md`. Build each with `/next-task P4.n` (the default would pick an older blocked
task) and close each with `/close-task`. The numbers are Dylan's ("Connecting the firm's systems"
10 to 14). Three of P4's first ideas are replaced: chunked claims (4 sends at a time instead,
P4.4), "one retry on 429" (it rarely fits in the 5 seconds, and `tests/unit/ai.anthropic.test.ts`
pins "nothing is retried", P4.6), and limits "per database role" (per transaction instead,
ADR-027, P4.2).

- [x] Indexes for a big firm's lists: `shifts (firm_id, event_id)`, `shifts (firm_id, ends_at)`,
      `assignments (firm_id, cancelled_at)`, `offers (firm_id, sent_at)` and `events (firm_id,
      action, created_at)`, declared in `src/lib/db/schema/` with one migration
      (`npm run db:generate`, plain `CREATE INDEX` like `drizzle/0028_pilot_size_indexes.sql`).
      Tests: each index and its columns in `pg_indexes` (`tests/integration/db.indexes.test.ts`)
      (P4.1)
- [x] The database's limits per process: a wait for a connection of at most 5 s (web) and 30 s
      (the worker), pools of 10 and 15 (`src/lib/db/pool.ts`); `statement_timeout` 15 s / 60 s and
      `idle_in_transaction_session_timeout` 30 s / 60 s, set in `withFirm`'s own `set_config`
      statement so they end with the transaction (ADR-027: per transaction, not per database
      role); longer only for the credential scan's lock holder, the firm's data export, the
      retention purge and the metrics roll-up. Tenancy: approved by Dylan ("Connecting the firm's
      systems" 14), then the `guardrails-reviewer`. Tests: the limits set and gone on the same
      pooled connection, a slow statement and an idle transaction ended and the pool carrying on,
      a full pool failing a wait instead of hanging (`tests/integration/scoped-client.test.ts`);
      the scan's lock holder; the two profiles (`tests/unit/db.limits.test.ts`) (P4.2)
- [x] A cap on each offer wave ("Connecting the firm's systems" 10): first come, first served sends
      to the best 5 casuals per free place by the existing ranking, at most 50, then the next wave
      after `wave_minutes` while anyone is left; a place taken shrinks the wave; the Open shifts
      board, first yes wins and fair rotation unchanged; owner setting `wave_per_place` (1 to 20,
      default 5). Then the `guardrails-reviewer`. Tests: the sizes and order
      (`tests/unit/offers.waves.test.ts`, its "everyone at once" case replaced on purpose); waves of
      5, 5 and 2, and 4 places' 20 (`offers.waves.test.ts`, `waves.timing.test.ts`); 2,000
      casuals offered 5 for one place (`tests/helpers/bulk-seed.ts`, `offers.scale.test.ts`); the
      lock test at the 50 cap with every check kept; `firm:settings` (`onboarding.test.ts`) (P4.3)
- [x] Waves send 4 at a time, each casual still claimed alone under the shift's lock; one wave per
      fetch (`OFFER_WAVE_WORK_OPTIONS`, `src/worker/jobs/index.ts`); the eligibility loader groups
      its rows by casual once (same verdicts). Then the `guardrails-reviewer`. Tests: at most 4 in
      flight, nobody messaged twice after a crash, Take shift within 2 s
      (`offers.waves.lock.test.ts`); 50 casuals with 300 ms sends within about 6 s; batch verdicts
      equal single ones at 2,000 (`eligibility.batch.test.ts`) (P4.4)
- [x] Reminders 4 at a time, at most 200 a run, the rest by a follow-up job behind other firms'
      (`src/lib/reminders/send.ts`). Then the `guardrails-reviewer`. Tests: 2,000 due in one slot
      sent once each, another firm's in between, nothing twice after a crash
      (`shift.reminders.test.ts`) (P4.5)
- [x] The AI under load, all in `src/lib/ai/anthropic.ts`: one client per worker process, at most
      4 calls at once (a call that waits past its 5 seconds goes to the office), a breaker after 5
      failures in a row (30 s, then one trial call), no retry, no timers. The model stays: moving
      to `claude-haiku-5-5` needs the live API (it thinks by default, so a 5-token label would come
      back empty). Tests: `tests/unit/ai.anthropic.test.ts` (P4.6)
- [x] No automatic replies by text ("Connecting the firm's systems" 11 and 12): a text or
      WhatsApp that comes in is stored, sorted and logged as today, but nothing is sent back
      (no automatic reply, no unknown-number reply, no STOP or START confirmation; a STOP itself is
      still recorded); an office message still makes a question in "Need a person"; a per-firm
      owner setting switches automatic text replies back on (off by default). At most 5
      unknown-number alert emails per firm an hour (`hitLimit()`, inside the claim transaction).
      `message.received` gains `replyHeld` or `alertHeld`. No new words. Then the
      `guardrails-reviewer` (STOP especially). Tests: `inbound.whatsapp.test.ts`,
      `inbound.sms.test.ts`, `enquiries.test.ts` (fixtures switch replies on where they test them,
      on purpose; new cases with them off) (P4.7)
- [x] Seeing a backlog (`src/lib/ops/tick.ts`, `alerts.ts`): the oldest waiting job (inbound over
      60 s, waves over 2 min, others over 15 min), a job past 80% of its expiry, the worker waiting
      for connections, a firm's AI fallbacks over 20% of at least 20, over 1,500 inbound messages
      or 500 offers per firm an hour. Tests: `tests/unit/ops.alerts.test.ts`,
      `tests/integration/ops.alerts.test.ts` (P4.8)
- [x] The target in one test: 1,000 messages from 1,000 casuals in a burst, all handled within a
      bound (`tests/integration/inbound.load.test.ts`); `docs/architecture.md`'s scale line at the
      target; "one worker process" and the connection budget in `docs/runbooks.md`; the pre-pilot
      checklist (`docs/testing.md`) (P4.9)

**After the UI chat's work is merged** (office pages, not this round): the layout's 5 reads in one
transaction (`src/app/office/layout.tsx`); Needs attention worked out once a request; caps on the
lists in `src/lib/office/dashboard.ts` ("and N more"); the webhook status from a small row
(`src/lib/office/webhook-settings.ts`; S); the jsonb OR chain in `src/lib/office/action-log.ts`;
and, each with its words in `docs/screens.md` first: why a reply was held (Enquiries), a stop after
25 offers per free place, one combined email past the 5.

Done when: P4.1 to P4.9 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` or `src/lib/office/`
and no message or email words changed; a first-come wave for one free place offers 5 casuals by
the ranking, not everyone; no automatic reply to a text, WhatsApp or voicemail goes out by text
unless the firm switches it on (a call's login link is the login page's answer: Dylan,
2026-10-27); the tests hold at 2,000 casuals, 1,000 messages and 2,000 reminders;
`docs/architecture.md`'s scale line names the target; the `claims-auditor` checks the phase
against this line.

### P5 — The connector: the ops portal's API first, AXLR8 directly later (attended; S, A, T, M, R, UI; go-ahead for the framework: Dylan, 2026-10-29)

**Go-ahead, 2026-10-29** (Dylan, "just finish it all"): the framework and the secret store against a
made-up portal, as boxed tasks here when the build starts. The real connector waits for the
portal's API docs and a test copy (`docs/discovery-axlr8.md` §5), and the signed agreement and DPA
before any real data flows (golden rule 7); the casual's new words go to Dylan first, and the sync
card and Needs attention items after the UI chat's Phase 24.

The framework's tasks (a made-up portal, `src/lib/connector/`, stands in for the real one: our own
field names, never AXLR8's or the portal's; its transport refused under `NODE_ENV=test`). A
connector's sessions are the firm's planner's (source `api`, `cancel_via` and `booked_via` `api`),
so the office already reads them as "From your planner" and no new words are needed:

- [ ] The secret store (S, A, T): a `firm_secrets` table the app role has no rights on, written only
      by an owner command (`npm run firm:secret`, the value read from standard input, never an
      argument), read only through an owner-run function the jobs role alone may call, each value
      AES-256-GCM under `SECRETS_KEY` (the worker's and the owner command's settings, never the web
      app's) with its firm and name bound in; the worker reads it on a jobs-role connection of its
      own. Tests: the app and web roles can't read it, another firm's secret never decrypts, a
      wrong key fails closed, the web's settings refuse the key (P5.1)
- [ ] A connector source and its caller (S, T): `roster_sources` takes a `connector` kind (its
      base address and which connector, no secret), one enabled source per firm as today; a
      `connector` caller in `src/lib/roster/firm-caller.ts`, allowed while its source is enabled,
      logged like the planner's; the planner API's session functions
      (`src/lib/integrations/sessions.ts`) take either caller, so a connector's sessions go through
      exactly the planner's rules. Tests: a connector's session made, changed, moved and cancelled
      as the planner's; a source switched off can change nothing (P5.2)
- [ ] The source's webhooks in (A, M): `POST /api/webhooks/connector/{source id}` checks the
      signature (HMAC-SHA256 with a secret we issue the source, derived from `INTEGRATIONS_SECRET`
      and its id like the planner's webhook secret and never stored: the web app can't read the
      secret store, P5.1's review; a portal that insists on its own secret is the real connector's
      ADR), stores one row per event id (unique per source), queues a job in the same transaction
      and answers 200 fast; the job fetches the changed record from the source's API rather than
      trusting the webhook's body, and applies it (P5.2's sessions; staff through
      `upsertWorker()`); an owner command (`npm run firm:connector`: connect a source, switch it
      off, show it and the webhook secret to give the firm's system, each logged as a settings
      change) like the sheet's. Tests: a bad or missing signature 403 and nothing stored, the same
      event twice stored once, a fetch that fails retried, nothing from the body trusted (P5.3)
- [ ] The reconcile pull (jobs): a tick like the Sheets sync's (lease per source, back-off on
      failure; never holding the source's row while it applies a record, since each change takes
      that row for share: P5.2's review), sessions in the next 48 hours every 15 minutes and
      everything else nightly, each record applied as a webhook's is, only changes logged; sessions
      come in hidden from casuals (the shadow cycle); the founder's alert and `firm:check` name a
      failing connector as one, not a rota sheet. Tests: a lost webhook caught by the pull, two
      pulls at once one run, a failing source backs off (P5.4)
- [ ] Bookings both ways (R): who's booked in the source mirrored through the three-way merge
      (`src/lib/roster/sheets/merge.ts`), a booking made there run through the rules like an office
      placement (refused: logged for the office, not booked), never cancelling a confirmed booking
      on its own; a booking made in ShiftDesk held as "confirming" (the same conditional `UPDATE`,
      golden rule 4), sent to the source with no transaction open, then confirmed or released;
      a read-only plug (`canWrite` false: `assign` answers `needs_approval`) for a source that takes
      no writes or is down. Notice hours for a cancellation made in the source from its own time
      only when it belongs to that booking and falls since the last pull, else the reading that
      favours the casual, the evidence recorded. Tests: each case, raced bookings, the source
      down (P5.5)

A firm's planner is its API key or a connector, never both (P5.2's review: both would write the
same sessions by the same refs): while a key is live, the connector changes nothing, and
`firm:connector` won't connect one beside a key (Dylan to confirm; the key, already in use, wins).
After the UI chat: the office's Integrations card and dashboard name a connector as the planner
(`plannerLink`, `src/lib/office/integrations.ts`, counts a live key or a sheet today), with the
sync card.

Done when (the framework): P5.1 to P5.5 are ticked, each with a stamp that includes the browser
tests; `RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; no test reaches a real source; nothing
under `src/app/` changes but the new webhook route; no casual-facing words are new; the
`claims-auditor` checks the framework against this line. The real connector, its words ("That
place has just gone", "We're confirming your place") and its office card come after.

The framework and the secret store now, against a made-up system; the first real connector, the
ops portal's API, once its shape is known (`docs/discovery-axlr8.md` §4); AXLR8 directly when it
can be asked. Under ADR-026 (`docs/decisions.md`, accepted 2026-10-26). Where the bullets below say
AXLR8, read "the source": the ops portal takes bookings and passes them on to AXLR8 (answer 4.P2),
and the office's "Enter in AXLR8" list is the fallback for when the portal is down or slow.

- A secret store, shared later with the text system's keys: a table the app role has no rights on,
  written only by an owner script, read through an owner-run function only the jobs role may call,
  encrypted (AES-GCM) with a key only the worker's settings hold. `DATABASE_JOBS_URL` is the
  worker's (and the one-off migrate and owner containers'), never the web app's; today the worker
  uses it for pg-boss only and does firm work on `DATABASE_URL`, so the connector opens a second,
  jobs-role connection for that one read.
- A new source table and source value (`roster_sources` takes only Sheets): added to the `shifts`,
  `shift_events` and `cancel_via` checks, and a "connector" caller in `src/lib/roster/firm-caller.ts`.
- Reuse: the Sheets tick, lease and cadence (`src/lib/roster/sheets/jobs.ts`, `cadence.ts`,
  `sync.ts`), the pure three-way merge `mergeHolders()` (`src/lib/roster/sheets/merge.ts`),
  `upsertWorker()`, `recheckHolders()`, `markUrgentAfterDropout()`, `retryAborted()`, the Gate B check
  (`src/lib/imports/gate-b.ts`), and the planner API's own functions for booked sessions
  (`src/lib/integrations/sessions.ts`), never a second copy.
- The source's webhooks in (the portal sends changes as they happen: answer 4.P3), as a provider
  webhook under golden rule 3: a new route, named for "a connector" and never for the firm, checks
  the signature, stores one row per event id (unique), queues a job and answers 200 fast; the job
  fetches the changed record from the source's API rather than trusting the webhook's body alone,
  and applies it through the same mirror and merge. Modelled on the shifts line's webhook
  (`src/lib/inbound/webhook.ts`, `twilio-signature.ts`, `receive.ts`). How the portal signs its
  webhooks and ids its events: `docs/discovery-axlr8.md` §5.
- A reconcile pull as the backstop, in case a webhook is lost, as jobs in the worker, never in a
  request (like the Sheets sync): sessions in the next 48 hours every 15 minutes, everything else
  nightly; one transaction per event; only syncs that changed something are logged (else up to about
  100 log rows a day per firm for the 15-minute pull alone). Sessions come in hidden from casuals,
  which gives the shadow cycle.
- Never booked twice: a casual is never told "Booked" unless AXLR8 accepted it or the office handed
  that place to ShiftDesk. The portal takes writes (answer 4.P2), so: hold the place as
  "confirming" (`bookShift()` in `src/lib/roster/book.ts`, taken by the same conditional `UPDATE`
  as any booking, golden rule 4), book through the portal's API outside any transaction (a limit of
  a few seconds, set once its API is known), then confirm or release ("That place has just gone"),
  or "We're confirming your place" while a job finishes it; re-read, and release ours if the source
  went over the count. When the portal is down or slow, or for a source that's read-only: a new read-only plug
  (`canWrite` false, so `assign` answers `needs_approval`: `src/lib/roster/plug.ts`), with
  `plugFor()` in `src/lib/roster/book.ts` taught the new source (today every source but Sheets
  gets the native plug): "Take shift" becomes a request and the office gets an "Enter in AXLR8"
  list; for urgent shifts the office hands a few places to ShiftDesk to take at once. Either way, a
  booking added in AXLR8 runs the rules like an office placement and, if refused (an expired licence),
  raises an urgent Needs attention item instead of booking; going over the count is a conflict to
  sort out; a confirmed booking is never cancelled automatically.
- Notice hours for cancellations made in AXLR8: its own cancelled time only if it belongs to that
  booking and falls between the last poll and now; the evidence used is recorded; where uncertain,
  the reading that favours the casual (less notice for a firm's cancellation, more for a casual's);
  times without a zone read in Europe/London, the doubled hour after the clocks change flagged.
- Tests against a made-up AXLR8 server; the real transport refused under `NODE_ENV=test` and pinned
  in `scripts/invariants.sh`. A sync status card on Integrations and Needs attention items for
  conflicts (mock-ups first).

### P6 — Attendance and pay lines from the ops portal's API (it has one: answer O1; S, M, UI)

- Attendance in: worked and no-show onto bookings (`src/lib/roster/attendance.ts`), so the office
  stops marking them by hand. A no-show is still never a strike.
- Pay lines in: one per casual per fortnightly cycle into `pay_records` (a new source value, S), so
  the casual's pay facts and pay day come from the firm's own figures (golden rule 9).
- Not "not checked in, so start an offer wave": a started shift can't be offered
  (`src/lib/rules/eligibility.ts`, `src/lib/offers/waves.ts`). Instead a "Still coming?" button on
  the existing 2-hour reminder, so a dropout shows while the place can still be filled (M, UI).

### P7 — The staffing email inbox (Stage 2 brought forward, decided 2026-10-26; S, A, T, M, UI; go-ahead for the back end: Dylan, 2026-10-29)

**Go-ahead, 2026-10-29** (Dylan, "just finish it all"): the back end against a made-up provider, as
boxed tasks here when the build starts. Live use waits for an email provider account (its short ADR
is Dylan's choice) and the firm's IT allowing the Microsoft 365 forward; the office's summary
email's words go to Dylan first, and the AI-drafted reply on Enquiries after the UI chat's Phase 24.

- The firm's staffing mailbox (Microsoft 365) auto-forwards to its own address at a UK or EU email
  provider with signed inbound webhooks (Microsoft 365 blocks forwarding to outside addresses by
  default: the firm's IT allows it for that one address) (no AWS: ADR-021; the provider in a short ADR), to the planned
  `POST /api/webhooks/email` (`docs/api-and-jobs.md`). The firm is found by the address, like
  `resolveFirmByLine()`; one row per Message-ID and the job queued in the same transaction (golden
  rule 3). The messages table gains an email channel (today only WhatsApp, SMS and voice, and a
  number is required: `src/lib/db/schema/messages.ts`).
- Quoted history stripped before sorting; no attachments at first (sick notes are health data);
  mail that isn't from a known casual (clients, venues, applicants) is passed to the office without
  its words stored.
- The AI only sorts (`sortMessage()`, `src/lib/ai/classify-message.ts`). Every action goes through a
  link sent to the casual's known number or email, never on the sender's word alone (a sender can be
  faked); pay disputes go to the payroll digest (golden rule 9); the rest goes to Enquiries with an
  AI-drafted reply the office approves before it's sent, and a summary every 3 hours. Replies are
  signed "[Firm name] Shift Team" (golden rule 8).

### P8 — The in-app chat (proposed 2026-10-26; a mock-up first, after the UI chat merges; S, M, UI)

Dylan, 2026-10-26: "it would be an internal chat on the app not texts being sent out". Casuals
message the office inside the app, and the shifts line's sorting (keywords, then the AI's label,
then the office: `src/lib/inbound/reply.ts`, `sortMessage()` in `src/lib/ai/classify-message.ts`)
answers there at once with the same fixed replies and links, never by text; the office answers in
Enquiries. Free (no 20p a text), logged like every message (golden rule 5), pay disputes still to
payroll (golden rule 9), replies signed "[Firm name] Shift Team" (golden rule 8).

- An `app` channel for `messages` (today only WhatsApp, SMS and voice, and a number is required:
  `src/lib/db/schema/messages.ts`; S).
- The casual's chat screen and the office's thread in Enquiries: mock-ups first (UI).
- App notifications for a reply (`src/lib/notify`).
- The guards that P4.7 doesn't need yet: at most 5 automatic replies an hour per casual ("Connecting
  the firm's systems" 11), and no automatic reply to a message carrying our own "Automatic reply."
  line, so an echo can't loop.

## Stage 2 (after 3 paying firms) — not now

- AI email inbox: firm forwards shifts inbox → the email provider's inbound webhook → classify
  (Haiku) → draft reply → approve mode → summaries every 3 hours. **Brought forward** (Dylan,
  2026-10-26): now proposal P7 ("Connecting the firm's systems" 3)
- AI phone line add-on (£149/month): the existing ElevenLabs agent on the firm's Twilio number
- Second sector credential pack live (rail: PTS/Sentinel; construction: CSCS)
- Compensation calculator once Employment Rights Act regulations are final
- Client-facing compliance report (licensed, notified, on-time staff) for venues/contractors
- Reference-period hours report per worker (guaranteed-hours rules)
- Billing (per active worker = worked ≥ 1 shift in the month) and self-serve onboarding
- Translations for common staff languages

## Stage 3 — later

- Check in / check out with location at tap
- Native app (Flutter) with geofencing for unmanaged sites — DPIA first (see compliance)
- No-show prediction from the action log

## Decisions waiting for Dylan

Every decision still waiting for you, listed once, grouped (Phase 10 task 18, from this file, the
decision tables in `docs/overnight-log.md`, `docs/compliance.md`, `docs/privacy-notice.md` and
`docs/decisions.md`). **Default now** is what the app does today. A row that starts with a bold
**When …** or **Before …** has to be settled by then; any other can stay as it is until you want it
changed. Rows added for Phase 12 on 2026-10-06 (`docs/office-v2.md`, its D and S numbers in
brackets) were settled the same day: you took the recommended defaults (D1–D4, D7 and D8, built
lean: see Phase 12), replaced D5 with a planner API and webhooks, deferred D6, and approved S2 to
S10 (S1 was already approved). A settled row says **Decided**, **Approved**, **Replaced** or
**Deferred**, and what Phase 12 builds. S11 ("How the build is run" 19) was approved on
2026-10-06. **Where** says where the details are (Parking lot items are in this file; "log" is
`docs/overnight-log.md`). To decide one, tell Claude: it changes the code if needed, then strikes
the line here. (The old way of finding these, `grep "Dylan to" PLAN.md`, misses many: use this
list.) After the decisions, a short table of checks and to-dos that aren't choices.

**Decided on 2026-10-16** (Dylan, in chat): How the build is run 1 to 4 approved (13.1); Legal
6 no; Messages 11 and 17 and Office 10 as their rows say. From the Parking lot: travel areas
switched on per firm (13.4); resourcers keep seeing pay messages' words in Enquiries; a personal
reply's log entry keeps the travel minutes; the hand-written TravelTime answers stand until the live
check. Every other row that confirms what's built stays as it is for now ("keep, and revisit with a
pilot firm"): rows tagged **Before a pilot** still need that look then.

**Decided on 2026-10-19** (Dylan, in chat): "we wont need whatsapp or twillio notifications will
come through our own text system and app". No WhatsApp and no Twilio: casuals are reached by text,
through the firm's own text system, and by the app's notifications (web push). Phase 15 (proposed,
waiting for the go-ahead) has the work. Rows tagged **Before submitting the WhatsApp templates**
and **When you create the accounts** that name Twilio or WhatsApp need a fresh look against the
text system once its details are known; Messages 2 is decided (notification first: P2.4).

**Decided on 2026-10-26** (Dylan, in chat): "go with your recommendations on the 8 decisions".
"Connecting the firm's systems" 1 to 8 take Claude's recommendations: a pay calendar per firm
(replacing D8, Pay 10), ADR-026's pull connector (accepted), the email inbox brought forward from
Stage 2 (proposal P7), casuals' login by email as a stop-gap, a cap on each offer wave, who asked
for each cancellation with a strikes switch per firm, the CRM's Casual sessions only, and a CRM
booking the rules refuse flagged, never booked. Later the same day, 9: ShiftDesk sends the texts
about its own bookings; and 10 to 14, with the go-ahead for P4's back end: waves of 5 per free
place (at most 50), no automatic replies by text (the in-app chat, P8, instead), 5 unknown-number
emails an hour, texts only for offers, confirmations and reminders (push first: Messages 2), and
the database's limits inside `withFirm`. Each is built as its proposal (P1 to P8), once that
proposal gets the go-ahead.

**When each one matters** (every row with that tag):
1. **Before any real data** (the pilot firm's staff, even a check of a file): Legal 1, 2, 4 and 6;
   Checks 1, 20 and 21.
2. **When you create the accounts:** Messages 20, 23, 24 and 25; Deploy 2 and 8; Checks 2 and 3.
3. **Before submitting the WhatsApp templates** (Meta's approval is the slow step; changing approved
   words means submitting again): Messages 11 to 17 and 29.
4. **Before the first real import:** Sheets 11; Checks 9.
5. **Before a pilot:** Data 1, 3, 6, 7, 8, 13 and 21; Rules 3 and 8 (a security firm); Messages 1
   and 3; Pay 4; Office 10; Product 2 and 7; Checks 6, 7, 8, 14 and 15.
6. **Before any Sheets firm** (if the pilot keeps its rota in a Google Sheet): Sheets 1 to 3.
7. **When you deploy:** Deploy 1 and 9; Checks 4.
8. **Before any firm uses its own address:** Checks 5.
9. **Before the pilot's data is a year old:** Data 2.
10. **Before the Phase 12 task the row names** (`docs/office-v2.md`): Checks 18.
11. **Before any Northern Ireland firm:** Checks 16.

### Legal and compliance

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before any real data:** a solicitor reads the terms, the DPA and `docs/privacy-notice.md` (or use templates; about £500–£1,500). Ask them too about health details workers may type ("I'm unwell": Data 11). Give the business's legal name for the notice | Nothing reviewed; no real data is saved on a live server until a firm's signing is recorded (`firm:agreement`) | compliance.md; privacy-notice.md; Parking lot "Send the pilot firm its privacy notice wording" |
| 2 | **Before any real data:** the sub-processors' DPAs and UK transfer terms: Twilio, Meta, the hosting provider, the email provider, Anthropic (once AI is switched on: check where it processes requests, since its region option doesn't cover every model; ADR-021), TravelTime and postcodes.io (Checks 14), Google (Sheets firms only); the browser push services once push is live; ElevenLabs only if ever used | Listed in the docs only; nothing signed | compliance.md "Sub-processors"; privacy-notice.md |
| 3 | A limited company, insurance (professional indemnity, cyber) and an accountant, once a pilot says yes | Not done | compliance.md; business.md |
| 4 | **Before any real data:** the pilot agreement: you own the software and they license it; price and term; the DPA; exclusivity; naming them as a reference. Check your own employment contract (who owns what you make, outside work) first | Not agreed | go-to-market.md |
| 5 | Short notice in the notice report until the 2027 rules are final (and any compensation rules) | 48 hours unless the owner sets the firm's `short_notice_threshold_hours` | compliance.md; Parking lot "Notice report" items |
| 6 | **Before any real data:** may a real staff file be checked (a dry run, nothing saved) on the live server before the agreement is recorded? It's still reading personal data, from the pilot firm's files (golden rule 7). Demo firms on the live server would need a made-up signing date | **Decided** (Dylan, 2026-10-16): no. A real staff file isn't read on the live server, even as a dry run, until the firm's agreement is recorded | Parking lot "Dylan to confirm (Gate B…)"; log, Phase 10 task 11 |
| 7 | Notice for a cancellation phoned in counts from when the office types it, not when the worker rang; and the office can't record a cancellation as the worker's own (always the firm's, with notice) | Typed-in time; always the firm's | Parking lot "Firm-initiated changes follow-ups"; log, Phase 5 |
| 8 | A message that may not have arrived (sent, then its record failed) still counts in the notice evidence, marked "not confirmed" | Counted and marked | log, Phase 10 task 3 |
| 9 | Workers can't cancel once a shift starts; the office can until it ends (negative notice recorded, the place not reopened) | As stated | log, Phase 3 |
| 10 | Sending someone home part-way is a curtailment with notice, not a cancellation | As stated | Parking lot "Dylan to confirm: sending someone home…" |
| 11 | A move is refused when a booked worker fails a check the office can't override (or ask each worker to confirm instead) | Refused and logged | Parking lot "Firm-initiated changes follow-ups" |
| 12 | The fixed list of reasons for the office's changes; "Another reason" has no detail | 6 reasons | `src/lib/roster/firm-reasons.ts`; log, Phase 5 |
| 13 | A change notice goes at night (urgent) when the shift starts within the urgent window or is under way; otherwise it waits for the morning | As stated | Parking lot "Firm-initiated changes follow-ups" |
| 14 | The notice report's CSV: at most 20,000 rows; downloads aren't logged | As stated | log, Phase 5 notice report |
| 15 | What an AI may see: the pay summary gets a group's facts only; the message sorter gets the worker's own words and may only return a label | No AI connected (Phase 12's Anthropic client is off unless `AI_TRANSPORT=anthropic`) | log, Phases 6 and 7; "Connect the Anthropic API" |
| 16 | The strike rules (D4): the notice that avoids a strike, the exemptions, how long a strike counts and is kept, when the office is told, and health reasons | **Decided** (Dylan, 2026-10-06: recommended default, built lean). Phase 12 builds: 48 hours' notice (`strikes.notice_hours`, separate from Legal 5's threshold), measured at the cancellation; no strike when the office, the planner or the rota sheet cancelled, on a booking the office made ("Assign", including over a rest or hours check), or after the office or the planner changed the session; "I'm unwell" or "Family or caring" still gets a strike, flagged for a person to review; in emails, PDFs, CSVs and webhooks every casual's reason reads "Casual's own reason (see ShiftDesk)"; a strike counts 90 days and its row is deleted at 12 months (not during a hold), its log entries kept as long as the action log (Data 2); nothing happens automatically; casuals see their strikes and can tell us what happened; a DPIA before a real firm uses strikes. Cut: the 15-minute grace and the review flag for a session taken inside 48 hours (the office withdraws a mis-tap's strike), notice counted from a first message, the alert at 3 strikes and the strike messages (Parking lot "Phase 12 cuts") | `docs/office-v2.md` §3.5, §6.2; Checks 15 |

### Data and retention (GDPR)

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before a pilot:** the keep-times (they go into the firm's privacy notice): messages 90 days; a closed request's words and the office's override reason 365 days; a firm may choose 30 days to 6 years; one hold covers the whole firm | As stated | Parking lot "Dylan to confirm (retention…)"; compliance.md |
| 2 | **Before the pilot's data is a year old:** purge year-old action log, requests and offers (it means changing the log's "never deleted" protection on purpose), or keep them longer once the 2027 rules say how long | Never purged | Parking lot "GDPR follow-ups"; ADR-020 |
| 3 | **Before a pilot:** how long records are kept after someone leaves (the notice's "[period]"); it mustn't promise less than is kept | Kept with no end date | privacy-notice.md |
| 4 | Typed text with no schedule: pay query details, payroll's notes, "Something else: …" cancellation notes, the office's answers. Purge them after a time? | Kept until that worker is deleted | Parking lot "GDPR follow-ups" |
| 5 | Deleting a worker leaves what other people wrote that names them (a colleague's swap request) | Unchanged | Parking lot "GDPR follow-ups"; compliance.md |
| 6 | **Before a pilot:** deleting a worker keeps their pay lines (anonymous) and their pay queries with the text cleared | As stated | Parking lot "GDPR follow-ups" |
| 7 | **Before a pilot:** deleting a worker deletes their licence and card records; security firms may have to keep screening records (BS 7858, SIA) | Deleted | Parking lot "GDPR follow-ups"; privacy-notice.md |
| 8 | **Before a pilot:** only admins delete, and not while the worker is booked on a shift that hasn't ended | As stated | Parking lot "GDPR follow-ups" |
| 9 | A hold (for a dispute) also blocks an admin deleting a worker? | It doesn't; the runbook says check first | Parking lot "GDPR follow-ups" |
| 10 | The office's reason for placing someone despite a rule: free text, or fixed reason codes? | Free text, up to 500 characters, phone numbers and emails refused; on the booking, never in the log | Parking lot "Dylan to confirm: the office's override reason…" |
| 11 | A worker's cancellation reason and note ("I'm unwell" is health data): keep free text, or fixed codes only? | Quick reasons, or "Something else" with a note of up to 200 characters (no check on what's typed); on the booking, never in the log | `src/lib/portal/cancel-reasons.ts`; log, Phase 3 |
| 12 | A swap request's "Who could take it?" is free text that can name a colleague | As stated | Parking lot "Dylan to confirm: a swap request's…" |
| 13 | **Before a pilot:** Twilio keeps its own copies of messages, recordings and transcriptions: a job to delete them (with the Twilio sender), and until then don't promise "90 days" | Nothing deletes anything at Twilio (not connected) | "Connect Twilio" step 10; privacy-notice.md notes |
| 14 | A firm's logo is loaded from its own website (which sees workers' internet addresses), or uploaded to us | Loaded from the firm's site, no referrer | compliance.md; privacy-notice.md |
| 15 | The phone keeps an offline copy of My shifts (with shift instructions) for up to 14 days | As stated | log, Phase 3 and Phase 10 task 12 |
| 16 | Resourcers see the "Data requests and deletion" group in the action log | Visible | Parking lot "GDPR follow-ups" |
| 17 | A deleted worker's sheet staff ID stays on shifts still ahead (the sheet merge needs it) | As stated | log, Phase 10 task 13 |
| 18 | The firm export is one JSON file of every firm table; every export is logged | As stated (Phase 12 leaves upload image bytes out of it: each image is its own download, 12F.2) | log, Phase 8 GDPR |
| 19 | A shift's site and address show to every worker in the firm; its instructions only to those booked | As stated | log, Phase 3; Phase 12's S2 (approved 2026-10-06) shows meeting point and uniform to every casual who can see the session |
| 20 | Where staff photos and certificate images are kept, and how often a photo is renewed (D3) | **Decided** (Dylan, 2026-10-06: recommended default). Phase 12 builds: in Postgres (S7), re-encoded, 1 MB at most, never face-matched or read by AI; only items the office has checked count; a photo renewed every 3 years (`photo.renewal_months` 36; the mock-up said 2), "Due soon" 30 days before; a replaced photo deleted 30 days after the new one is approved, rejected uploads after 30 days | `docs/office-v2.md` §5.5 |
| 21 | **Before a pilot:** the travel area's personal data | **Decided** (Dylan, 2026-10-06: recommended default); still to write before it's switched on for a real firm: the legitimate-interests balancing test and the DPIA (`docs/dpia-travel.md`, Phase 12 task 12G.1). Phase 12 builds: legitimate interests (not consent); the postcode and its central point only (no house number, GPS or movement history); the office sees the district only, and replies say "your home area"; never in the action log; TravelTime gets coordinates and meaningless ids, postcodes.io a postcode only; estimates purged 7 days after the session; the start point deleted when the office makes the casual inactive as "They've left" or they are erased | `docs/office-v2.md` §5.4, §6.3; Checks 14 |

### Rules, eligibility and credentials

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | The SIA "applied" allowance (deploying staff whose licence is in progress, reported as up to 15%): confirm the rule; whether close protection counts; a night shift counts by its start day | 0%, and no command sets it | rules-and-credentials.md; compliance.md |
| 2 | The office may book despite "shift already started", rest, weekly hours or a day off (never a worker; names typed in a rota sheet too, except "started": Sheets 5) | As stated | Parking lot "Dylan to confirm: the office may override…" |
| 3 | **Before a pilot (a security firm):** "any of" licences: a door supervisor licence also covers guarding, so door supervisors can't take security-officer shifts today | "All of" only | Parking lot; `src/lib/rules/packs.ts` |
| 4 | The sector packs' role → licence rules; each firm gets its own editable copy | As in `packs.ts` | log, Phase 1 |
| 5 | The expiry to record for cards with no fixed validity (DBS, rail drugs and alcohol, steward refreshers) | The card's own date; none means never | rules-and-credentials.md |
| 6 | A licence counts if valid and in date for every day the shift touches; a suspended card fails | As stated | log, Phase 1 |
| 7 | My shifts' licence banner also shows cards already expired (the spec asked for "expires within 30 days") | Shows both | Parking lot "Dylan to confirm: the My shifts banner…" |
| 8 | **Before a pilot (a security firm):** a licence that lapses after someone is booked: hold the reminder and alert the office? (Deploying an unlicensed guard is an offence) | The reminder still goes, and nothing flags the booking | Parking lot (credential expiry and reminders items) |
| 9 | Expiry warnings at 30, 14 and 7 days, sent at 08:00; a Monday list to admins and resourcers | As stated | log, Phase 2 credential expiry |
| 10 | Imported licences are never marked "checked" | As stated | log, Phase 2 imports |
| 11 | Days off: from today to 180 days ahead, at most 60; marking one doesn't cancel bookings | As stated | log, Phase 3 profile |
| 12 | Fair rotation's priority window (ADR-015): a place held 15 minutes for the 4 with fewest hours | Only when a firm chooses fair rotation (default first come, first served) | Parking lot "Dylan to confirm: fair rotation…"; decisions.md |
| 13 | No-shows push a worker back in fair rotation? | No (a no-show lowers their hours, so moves them up) | Parking lot "Marking who worked follow-ups" |
| 14 | How a casual's travel area limits what they see and are offered (D2). A preference, not a rules-engine check | **Decided** (Dylan, 2026-10-06: recommended default, built lean). Phase 12 builds: a hard filter on open shifts, the urgent board, Home, offer waves and shifts-line replies; in the area if any way they travel gets there within their limit (30, 45, 60 or 90 minutes; the firm's default 45); no "a bit further" for urgent shifts; a shift opened from a direct link stays bookable; an unknown distance is shown, labelled, and still offered; no home area: everything shown, with a prompt; the office may still offer outside a casual's area by hand. Cut: travel time as an offer-wave tie-breaker and the office's outside-area warning (Parking lot "Phase 12 cuts") | `docs/office-v2.md` §4.3, §5.4; Data 21 |
| 15 | Right to work: enforce it in the rules (every role needs a right-to-work check: a rules-data change through the pack apply, with checks that have no expiry), or keep it as a status only | **Decided** (Dylan, 2026-10-06: "go with your recommendations"): a status only. Not enforced: no role needs `RTW` (`src/lib/rules/packs.ts:36`, `69-72`), so a casual with no check can be booked. Phase 12 shows "Not checked yet: ask the office" (not "you can't be booked", which would be untrue). To enforce it, tell Claude | `docs/office-v2.md` §4.6 |

### Offers, reminders and messages

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before a pilot:** urgent messages go during quiet hours (22:00–07:00) unless a firm turns it off; the spec reads as "if the firm allows it" | Urgent messages go at night | `src/lib/rules/quiet-hours.ts`; log, Phase 4 (never flagged before) |
| 2 | Notifications by WhatsApp or text **and** push, or push first to save the WhatsApp fee (ADR-003 said push first). 2026-10-26: the pilot firm's texts cost about 20p each, so Claude recommends push first, a text only when a phone has no notifications on. **Decided** (Dylan, 2026-10-26): push first, a text only when a phone has no notifications on ("Connecting the firm's systems" 13) | Both, until built (Phase 15) | Parking lot "Dylan to confirm: notifications go by WhatsApp…" |
| 3 | **Before a pilot:** first come, first served sends the urgent offer to every eligible worker at once, not "the best 3–5" | Everyone at once. **Decided** (Dylan, 2026-10-26): a cap on each wave ("Connecting the firm's systems" 5; built in P4) | Parking lot "Offer waves follow-ups" |
| 4 | The 3-offers-a-day cap: fixed, or per firm; urgent offers count towards it | Fixed; urgent ones count | Parking lot (offer cap items) |
| 5 | Re-offer to workers whose earlier offers became "filled elsewhere" when the office reopens a shift? | No | Parking lot |
| 6 | A wave held by quiet hours past the shift's start | Stops as "started"; only the escalation tells the office | "Connect Twilio", last paragraph |
| 7 | Any cancellation that reopens a place inside the urgent window starts waves (the office's too); someone who cancelled is never offered it again. The office's "The client needs fewer staff" removes the place instead (one fewer needed, nobody offered it; a shift's last place stays) | As stated (fewer staff: since Phase 10 task 19) | log, Phase 4 and Phase 10 task 19 |
| 8 | The escalation email: 3 hours before the start, to admins and resourcers, once per shift (not per gap) | As stated | Parking lot "Offer waves follow-ups" |
| 9 | A message that fails isn't retried (at most once: lost, never doubled) | As stated | log, Phases 4 and 10 |
| 10 | Reminders at 24 hours and 2 hours, held by quiet hours (a 2-hour one before 07:00 is skipped); no opt-out | As stated | Parking lot "Shift reminders follow-ups" |
| 11 | **Before submitting the WhatsApp templates:** "Cancel in the app" in the 24-hour reminder (there's no app) | **Decided** (Dylan, 2026-10-16): "Cancel with the link". Built in 13.5 | Parking lot "Shift reminders follow-ups" |
| 12 | **Before submitting the WhatsApp templates:** texts: the sign-off adds a second text; "{day}" not "today"; short text versions of other messages; nothing limits a text's length; the office's 500-character note is about 9 texts | As stated | "Submit the WhatsApp templates" |
| 13 | **Before submitting the WhatsApp templates:** the copy written overnight, read once: `credential_expired`, the Monday list email, the "no site" versions, `shift_cancelled_by_firm`, request updates ("approved" can read as "booked"; "answered" for a question) | In `src/lib/messaging/templates.ts` and the docs | docs/messaging-templates.md; log, Phases 2–5 |
| 14 | **Before submitting the WhatsApp templates:** a worker who cancels gets only the on-screen confirmation; send the `cancellation_ack` message too (it needs its template)? | Not sent | Parking lot; log, Phase 3 |
| 15 | **Before submitting the WhatsApp templates:** Meta will probably put `login_code` in its "authentication" category: fixed wording and no sign-off, against golden rule 8 | Written with the sign-off | "Submit the WhatsApp templates"; docs/messaging-templates.md |
| 16 | **Before submitting the WhatsApp templates:** a change notice to a worker who's no longer active still carries the portal link (they can't log in): a version without it? Also check Meta accepts the office's free-text note as a variable | As stated | Parking lot; "Submit the WhatsApp templates" |
| 17 | **Before submitting the WhatsApp templates:** payroll's note goes in the WhatsApp or text itself (or "See it on your pay page": a different template) | **Decided** (Dylan, 2026-10-16): the note stays behind the pay code; the message says payroll has answered and to see the pay page. Built in 13.4 | Parking lot "Pay query status follow-ups" |
| 18 | "Offer to someone" uses the same checks as waves (no override); a failed one isn't resent | As stated | log, Phase 5 |
| 19 | The shifts line's keywords ("work" and "available" give open shifts; "shift" alone doesn't) | As stated | Parking lot "Unknown number follow-ups" |
| 20 | **When you create the accounts (Twilio):** "CANCEL" by text turns texts off (Twilio's list): drop it so "cancel" means a shift? And Twilio's own opt-out settings (Advanced Opt-Out on, its keyword list the same as ours) | Turns texts off | "Connect Twilio" step 5 |
| 21 | STOP by text turns texts off, not all contact: a worker who chose texts then gets WhatsApp instead | As stated | log, Phase 7 |
| 22 | Unknown numbers: a former worker gets no reply, a stranger gets "reply with your full name"; one reply and one email per number per 24 hours. An unknown caller gets no text back (their voicemail reaches the office) | As stated | Parking lot "Unknown number follow-ups"; log, Phase 7 |
| 23 | **When you create the accounts (Twilio):** a firm with no shifts line yet: a shared ShiftDesk number, or nothing until its line is live | No sending number set | "Connect Twilio" step 8 |
| 24 | **When you create the accounts (Twilio):** voicemail transcription: Twilio's basic one, or a better service later (not AWS: ADR-021) | Twilio's | "Connect Twilio" step 10 |
| 25 | **When you create the accounts (Meta):** service messages over 1,000 a month per number are charged (from 1 October 2026: a payment method on file or they stop); each firm needs Meta business verification (days) | Not connected | compliance.md |
| 26 | A firm may shorten its sign-off ("Acme Shift Team"), never a person's name | Allowed (checked again as each message is built: one stored that breaks the rule isn't used) | log, Phase 8 branding and Phase 10 task 19 |
| 27 | A worker the office places on a shift ("Assign") gets a `shift_confirmed` message (a billed WhatsApp, held by quiet hours unless the shift is soon); one who takes a shift themselves only sees it on screen | As stated | log, Phase 10 task 19 |
| 28 | Booking by reply number: "Reply 1 or 2 to take one", as in the approved mock-up (D6). Today every booking needs a logged-in session ("Take shift") or the office; booking because a phone number sent "1" is a new way of proving who the casual is (an auth change) | **Deferred** (Dylan, 2026-10-06: debloat; it also needs live WhatsApp). Replies say "Take one here: {link}" | `docs/office-v2.md` §5.7; Parking lot "Phase 12 cuts" |
| 29 | **Before submitting the WhatsApp templates:** Phase 12's words: changed `credential_expiring` and `credential_expired` (they point to the upload link), and "Automatic reply. Send OFFICE to reach a person." before the sign-off of every instant reply (free text, not a template). The strike messages, `photo_due`, `upload_rejected` and the travel and pay words in offers were cut on 2026-10-06 | Not built; written out in `docs/office-v2.md` §5.7 | `docs/office-v2.md` §5.7; "Submit the WhatsApp templates" |

### Rota sheets and imports

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before any Sheets firm:** a row deleted from the sheet, or a person who vanishes from it: a firm cancellation with notice, or a flag for the office? | Ignored | Parking lot "Before any Sheets firm goes live" |
| 2 | **Before any Sheets firm:** a booked sheet shift set to Draft | Bookings kept; no notice | Parking lot |
| 3 | **Before any Sheets firm:** tell workers when an edit in the sheet books, moves or cancels them? | Not told | Parking lot |
| 4 | Role changes on booked shifts: the sheet allows one if everyone booked can do it; the editor and imports refuse | As stated | Parking lot "Dylan to confirm: a role changed in the rota sheet…" |
| 5 | A name typed into the sheet overrides rest, weekly hours and days off (as the office can: Rules 2) | As stated | Parking lot "Dylan to confirm: (1) re-check the live source…" |
| 6 | "Re-check the live source" means our copy synced in the last 20 minutes | As stated | same |
| 7 | A name with no place left is taken out of the firm's sheet (logged) | As stated | log, Phase 10 task 9 |
| 8 | Switching a sheet off (`firm:sheet --disable`): its shifts ahead are frozen (no booking; booked stay) | Frozen | Parking lot |
| 9 | Only UK-locale sheets | Others refused | log, Phase 10 task 10 |
| 10 | A worker matched by mobile alone must have the same name | Refused otherwise | log, Phase 10 task 11 |
| 11 | **Before the first real import:** a worker who changed number, imported without a Staff ID, arrives as a new worker, and their old record keeps the old number, so whoever has that number next could log in as them. Require a Staff ID column, or flag a new worker with an existing name? | As stated | Parking lot (import items) |
| 12 | An imported shift with no Shift ID is matched by site, role and times (a new time makes a new shift); US-format dates | As stated | Parking lot (import items) |
| 13 | Imports can't change booked or started shifts | Skipped | log, Phase 2 |
| 14 | Web imports up to about 1 MB (the terminal 5 MB) | As stated | Parking lot "Dylan to confirm: new shifts are open at once…" |
| 15 | A shift of 24 hours or more is refused (sheet, imports, editor) | Refused | log, Phase 10 task 11 |
| 16 | Telling planners about cancellations (D5) | **Replaced** (Dylan, 2026-10-06: "plug in and play with all planners using webhooks and apis not another sheet"): a planner API with per-firm keys, and signed webhooks whose `booking.cancelled` carries the full record, so the planner marks its own session CANCELLATION. No sheet "Cancellations" column and no daily planner email. S11 approved (How the build is run 19): the API and keys built in 12J.1, the webhooks are 12J.2 | `docs/office-v2.md` §5.3; Phase 12 tasks 12J.1 and 12J.2 |

### Pay and payroll

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Correcting or removing a wrongly imported pay line | No way to; a corrected rate becomes a second line | Parking lot "Pay records (Dylan to decide …)" |
| 2 | How pay queries are grouped (rate, site or week by issue); a worker paid at two rates | As stated | Parking lot "Pay query grouping follow-ups" |
| 3 | A query's group freezes once it's been in a digest? | It can still move | same |
| 4 | **Before a pilot:** the digest: 09:00 Monday to Friday, to payroll only, names only in the attachment (check the firm is happy with that going to payroll's mailbox) | As stated | Parking lot "Payroll digest follow-ups" |
| 5 | A digest send that timed out (may have arrived) puts its queries back | Put back | same |
| 6 | The pay query form: behind the pay code; 8 weeks of shifts or 90 days back; details only for "Something else" | As stated | Parking lot |
| 7 | Payroll sorts a whole group with one note; no "declined" status | As stated | log, Phase 6 |
| 8 | The pay area is for payroll and admins only | As stated | log, Phase 6 |
| 9 | The AI's one line under each group in payroll's digest is used only if it restates the facts: apart from the facts' own phrases, only a short list of plain words ("staff", "queries", "the week", "rate"…), so no verdict ("paid correctly", "underpaid", "no hours missing") or promise gets through; otherwise the code's line only. Keep the AI line like this, or drop it and show only the code's line? | Allow-list; no AI connected | log, Phase 10 task 19 (audit L47) |
| 10 | The pay week number and pay day in the office's top bar (D8) | **Decided** (Dylan, 2026-10-06: recommended default, built lean): ISO weeks, Monday to Sunday, paid the Friday after the week ends ("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct"), one rule for every firm (the per-firm pay calendar setting was cut). **Replaced** (Dylan, 2026-10-26): a pay calendar per firm, with this rule as its default ("Connecting the firm's systems" 1; built in P3) | `docs/office-v2.md` §3.1, §3.8 |

### Office and access

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | An office settings screen (notice threshold, urgent window, quiet hours, waves, sign-off, digest time, retention, domain, and the rules settings: rest 11 hours, weekly cap 48, travel buffer 0)? It needs a new permission on `firms` | Owner-only commands (`firm:settings` and others); the rules settings can't be changed at all, so every firm runs on those defaults | Parking lot; compliance.md; rules-and-credentials.md; Phase 12's Settings page (task 12B.7; S10 approved) changes only the strikes-team email, and with S11 the Integrations page the planner webhook address; retention and the rest stay owner-only |
| 2 | What payroll and resourcers see (payroll: no Today, notice report or log; resourcers: that a pay record changed, never the amount) | As stated. Phase 12 also shows resourcers each session's pay rate (£/hour), never a pay record's figures | Parking lot; `src/lib/auth/roles.ts`; `docs/office-v2.md` §3.8 |
| 3 | "Mark as filled" records who and when, not how | As stated | Parking lot |
| 4 | New shifts are open at once (no draft step) | As stated | Parking lot |
| 5 | Answering requests: a note to decline, optional to approve; approving changes nothing else | As stated | Parking lot |
| 6 | Marking "didn't attend" doesn't message the worker; unmarked bookings aren't completed automatically | As stated | Parking lot "Marking who worked follow-ups" |
| 7 | The office's "make inactive" beats the sheet and files; "Bookings to check" on Today, with nothing escalating one left unanswered as the shift gets close (mark it urgent, or email the office?) | As stated | log, Phase 10 task 7; Parking lot |
| 8 | The pilot metrics' definitions and default period (the last 7 complete days) | As stated | Parking lot; log, Phase 9 |
| 9 | The action log: last 7 days by default, 92 days per search, no export; Today: no email about a new worker request | As stated | log, Phase 5 |
| 10 | **Before a pilot:** login limits at a briefing on venue Wi-Fi (one internet address for everyone): raise, or per firm? And the daily cap's trade-off: anyone who knows a worker's number can use up its 10 links for the day, and that worker then can't get a new link until midnight (UTC; a phone already logged in keeps working, and the office has no "send them a link" button yet: parked). Keep it, raise it, or drop it? | **Decided** (Dylan, 2026-10-16): raise the per-address limit, so a team on one venue's Wi-Fi isn't locked out (the per-number limits stay). Built in 13.5 | Parking lot; log, Phase 10 task 19 |
| 11 | Workers can't change their own contact details (the office does) | As stated | log, Phase 3 profile |

### Deploy, servers and security

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **When you deploy:** merge `build/overnight` into `main` (yours; it builds the first image). Check CI on GitHub's Actions tab first (or install `gh` so Claude can) | Not merged; CI unchecked | "Connect the deploy"; Parking lot "Dylan to decide: audit findings the overnight loop may not fix" |
| 2 | **When you create the accounts:** a stable server-action key (a GitHub secret; Claude wires it into the image build); pin `actions/checkout` and the Node image | Not pinned | "Connect the deploy" (4) |
| 3 | The call fallback: one TwiML Bin per firm, one manager's mobile | Command built; no bins | "Connect Twilio" step 10 |
| 4 | One server until about 5 paying firms | As stated | ADR-002, ADR-021 |
| 5 | Links in messages stay on `<slug>.<our domain>` even when a firm's own address is verified (only login links go back to it) | As stated | Parking lot "Phase 8 custom domains"; ADR-019 |
| 6 | The web app's database login can call `app_firm_ids()` (revisit if a second service needs the database) | As stated | Parking lot |
| 7 | A test-only failing page ships in the app (switched on only in the browser tests, on localhost) | As stated | log, Phase 10 task 14 |
| 8 | **When you create the accounts:** the email provider (D9). No AWS (ADR-021): any provider with SMTP credentials and a verified sending domain works; which one is your choice (a UK or EU region if it offers one; a transactional email service rather than a staff mailbox). No AWS means no AWS account, SDK or AWS-branded service. Whether a provider that itself runs on AWS (see its sub-processor list) is acceptable is your call when the accounts are chosen (the same question for the host, Deploy 9, and for Anthropic) | Not chosen. Phase 12 builds a plain SMTP sender (12X.2); the console stand-in until then | Parking lot "Connect an email provider (SMTP)"; `docs/office-v2.md` §5.8 |
| 9 | **When you deploy:** the host. Any UK or EU host that runs Docker, with managed Postgres 16 (or Postgres in Compose if it has none); AWS is ruled out (ADR-021). No AWS means no AWS account, SDK or AWS-branded service. Whether a host that itself runs on AWS (see its sub-processor list) is acceptable is your call when you choose it | Not chosen | Parking lot "Connect hosting"; `docs/office-v2.md` §5.8 |

### How the build is run

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Add `npm run build` to `scripts/verify.sh` (task 17's image break would have been caught) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | Parking lot "Dylan to confirm: add npm run build…" |
| 2 | Require the browser tests for a tick; a production-mode browser run | **Approved** (Dylan, 2026-10-16). Built in 13.1 | Parking lot "Dylan to decide: audit findings the overnight loop may not fix" |
| 3 | Widen `scripts/invariants.sh` (Playwright skips, `scripts/` in the withFirm check, `twilio` in tests) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | same |
| 4 | The safety net's gaps (the tick guard, Stop hook, stamp timing; reviewers read-only by tool) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | same |
| 5 | CLAUDE.md: add `resolveFirmByLine()` and the domain look-up to the allowed look-ups; where the "set a firm's line" code sits; and the loop's own edit to CLAUDE.md (the browser tests' port 3443 and `openssl`): keep it? | As is | Parking lot "Shifts line follow-ups"; log, Phase 10 task 15 |
| 6 | Golden rule 3's wording: message ids are unique per firm, not across all firms | Per firm | log, Phase 7 |
| 7 | Schema, auth and tenancy changes made overnight without waiting (your standing instruction), to look over once: migrations 0019 to 0034 (`drizzle/`), notably a worker's mobile may be empty once deleted, with owner-run delete and purge functions (0026); `otp_codes.request_id` (0027); the firm's agreement date (0032); the override reason on the booking (0033); per-firm retention read by the database (0034) | Done on `build/overnight` | log (each task's Decisions) |
| 8 | A database rule for "one waiting request per worker, shift and kind" (a schema change) | Held by a lock in code | Parking lot |
| 9 | S1's two extras on the new `shift_events` table: `pinned` (the office-wide star) and `public_notes` (event-wide details casuals see, such as parking) | **Not needed:** cut on 2026-10-06 (debloat; the star and event notes are in the Parking lot). S1's core (the table, `shifts.event_id`, the event's switch) is approved | `docs/office-v2.md` §5.1 S1 |
| 10 | S2, on `shifts`: `pay_rate_pence`, `post`, `meeting_point`, `uniform`, `required_credentials` (extra qualification codes, all required on top of the role's: the rules engine's input changes) and a per-session showing switch. Meeting point and uniform become visible to every casual who can see the session (changes Data 19 for those two fields only) | **Approved** (Dylan, 2026-10-06). Built in 12B.1 | `docs/office-v2.md` §5.1 S2 |
| 11 | S3, on `assignments`: `cancel_via` (app, office, sheet or import), `strike_warning_version`, `strike_warning_shown_at` | **Approved** (Dylan, 2026-10-06). Built in 12C.1 | `docs/office-v2.md` §5.1 S3 |
| 12 | S4, a new `strikes` table (one strike per booking; withdrawals, reviews, the evidence email's status; the app can't delete rows), plus an owner-run `app_purge_old_strikes()` like migration 0034's messages purge (deletes strikes at 12 months, never during a hold) | **Approved** (Dylan, 2026-10-06), built narrower: no columns for the casual's own account, a review outcome or a strike message, whose features were cut. Built in 12C.1 | `docs/office-v2.md` §5.1 S4 |
| 13 | S5: `requests.message_id` as a real link to `messages` (cleared when the message is deleted at 90 days), and an index on `messages (firm_id, reply_to)` | **Approved** (Dylan, 2026-10-06). Built in 12D.1 | `docs/office-v2.md` §5.1 S5 |
| 14 | S6, on `credentials`: `check_state`, `rejected_reason`, `evidence_upload_id` (and start filling `verified_at` and `verified_by`) | **Approved** (Dylan, 2026-10-06), built narrower: the proposal's `due_on`, `issuer`, `warn_days`, `needs_evidence` and `register_check` were cut. Built in 12F.2 | `docs/office-v2.md` §5.1 S6 |
| 15 | S7, a new `uploads` table (photo and certificate images stored in Postgres; in deletion and export) | **Approved** (Dylan, 2026-10-06). Built in 12F.2 | `docs/office-v2.md` §5.1 S7; Data 20 |
| 16 | S8, a new `worker_travel` table (start postcode and its central point, ways of travelling, time limit; a separate table so the erased-worker check is unchanged; in deletion and export) | **Approved** (Dylan, 2026-10-06). Built in 12G.1 | `docs/office-v2.md` §5.1 S8; Data 21 |
| 17 | S9, a new `travel_estimates` table (keyed by postcode and site, not by person; purged 7 days after the session) | **Approved** (Dylan, 2026-10-06), built narrower: no trip home, route or leave-by columns. Built in 12G.2 | `docs/office-v2.md` §5.1 S9 |
| 18 | S10, for the Settings page (Office 1): an owner-run database function, `app_set_firm_setting(key, value)`, the only way the app may change `firms.settings`; it refuses `retention.*` and every key it doesn't list, so the promise that the app can't shorten retention or lift a hold (migration 0034, `docs/compliance.md`) still holds | **Approved** (Dylan, 2026-10-06), built narrower: it lists only the strikes-team email and its confirmed time (S11 adds the webhook address and its signing version). Built in 12B.7 | `docs/office-v2.md` §5.1 S10, §3.10; Office 1 |
| 19 | **Approved** (Dylan, 2026-10-06: "Yes, add S11"). S11, the planner integration layer, in plain words: (1) a new `api_keys` table (only each key's hash and last 4 characters are kept; the app can add keys and mark them used or revoked, never rewrite or delete one) and an owner-run `app_api_key_lookup(hash)` that turns a key into its firm, which is **a new machine login path** (an auth change: a request is trusted because it carries a key); (2) a guard before that look-up: a key of the wrong shape is refused without touching the database, and an address that sends 30 wrong keys in a minute is turned away; (3) the office's whole-session cancel and move (golden rule 12 code that today only an admin or resourcer can run) gain a second caller, the API: it acts with no office user, only on sessions the planner sent, only while its key is still live, and every failed rules check blocks the change (nobody is there to override one); the office in turn can't edit, move or cancel the planner's sessions as a whole; (4) the webhook address added to S10's keys, with a signing version the database raises itself (never set by the app, so an old signing secret can't come back); (5) `api` added to the session, event and cancel source values; (6) the API answers in the request rather than in a job: an exception to golden rule 3 (CLAUDE.md and ADR-022, written in 12J.1 before the code). Reply "yes, approve S11" to start 12J.1 and 12J.2 | The API and keys built in 12J.1 (2026-10-11); the webhooks in 12J.2 (2026-10-12). Golden rule 3's new wording and the API's small choices (a) to (j) wait for Dylan to confirm (Parking lot "Planner API (12J.1 review)") | `docs/office-v2.md` §5.1 S11, §5.3 |

### Product and scope

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Pricing (£299 pilot, about £3 per active worker a month, £199 minimum) | A hypothesis | business.md; ADR-007 |
| 2 | **Before a pilot:** on a real iPhone, does the home-screen app stay logged in? (iPhone push only works from the home screen.) If not, a typed-code login, or remove the hint | Hint shown | Parking lot "Offline and home-screen follow-ups" |
| 3 | What an "offered" booking means | Unused; offers live in `offers` | Parking lot |
| 4 | Open shifts: 28 days ahead, at most 50 checked; My shifts: a shift on now stays under Upcoming | As stated | log, Phase 3 |
| 5 | The urgent flag stays on after a shift fills (the office clears it) | As stated | Parking lot |
| 6 | "Similar shifts" on a filled shift's page (not built) | Not built | Parking lot "Blocked-shift follow-ups" |
| 7 | **Before a pilot:** settings to agree with each pilot firm: urgent window, wave size, escalation time, quiet hours, allocation mode, sign-off | 24 h; 4; 3 h; 22:00–07:00; first come, first served; "[Firm] Shift Team" | go-to-market.md |
| 8 | Later: the next sector, an AI phone line, a firm's own copy of the system, location check-in | Not now | decisions.md |
| 9 | The travel-time service and postcode look-up (D1). (Or Google Routes: about $1,450 a month per 300-casual firm, and its results can't be stored) | **Decided** (Dylan, 2026-10-06: recommended default): TravelTime for car and public transport (its free key for development and the demo only, a fake provider in tests; a production quote before a pilot: Checks 14), postcodes.io for postcode to coordinates, and straight-line miles labelled "(straight line)" when the service is down | `docs/office-v2.md` §5.4; Checks 14 |
| 10 | The office's dark theme: navy (your first brief) or graphite (the mock-up) (D7) | **Decided, then changed** (Dylan, 2026-10-06: recommended default, navy: page #0f1626, panel #16203a, card #1b2642). **Changed 2026-10-21** (Dylan, "yes build this", on the Phase 20 mock-up that proposed it): true dark greys for the whole app: page #0b0c0e, card and panel #18191c, raised #232529, muted text #a9adb4, switch off #7d8189; the firm's colour stands out better on grey (Phase 20) | `docs/office-v2.md` §3.1 |

### Connecting the firm's systems (added 2026-10-26)

For the proposals P1 to P8 ("Proposed 2026-10-26", above Stage 2). All of them **decided** on
2026-10-26 (Dylan, in chat: "go with your recommendations on the 8 decisions"; then 9, his pick
when asked who texts about ShiftDesk's bookings). Each is built as
its proposal, once that proposal gets the go-ahead; until then the app works as "Until built" says.

| # | Decision | Until built | Where |
|---|---|---|---|
| 1 | **Decided** (Dylan, 2026-10-26: recommended): a pay calendar per firm (7 or 14 days, its own start, "Week" or "Cycle"), replacing D8 (Pay 10), with the quick fix first (the casual's Home shows the imported pay date when there is one) | One weekly rule for every firm; Home works the pay day out from it, so a fortnightly firm's casuals would see the wrong day | P3 item 1 |
| 2 | **Decided** (Dylan, 2026-10-26: recommended): ADR-026, a pull connector for AXLR8 (ShiftDesk fetches from AXLR8 on a timer, rather than waiting for AXLR8 to send), amending "no adapter per planner" (ADR-022: no special code for each planner's own system): AXLR8's API looks pull-only, the firm has nobody to write pushes, and AXLR8's customers are the firms we sell to. 2026-10-26: AXLR8 can't be asked for now, so the first connector reads the ops portal's API (it copies AXLR8 every hour), and AXLR8 directly comes later; and since the portal sends changes as they happen, the connector takes its webhooks first and pulls only to catch up | Planners push by the API; no adapters | P5; `docs/decisions.md` ADR-026 (accepted) |
| 3 | **Decided** (Dylan, 2026-10-26: recommended): the staffing email inbox brought forward from Stage 2, after P2 and P4 | Stage 2, after 3 paying firms | P7 |
| 4 | **Decided** (Dylan, 2026-10-26: recommended): casuals' login link by email, a stop-gap until texts exist | WhatsApp only, which no live server can send | P2 |
| 5 | **Decided** (Dylan, 2026-10-26: recommended): a cap on each offer wave (for example a few people per free place, by the existing ranking; the number is set when P4 is built): one place can mean about 1,500 texts today (an estimate: 1,500 of 2,000 casuals eligible), about £300 at the firm's 20p a text | First come, first served: everyone eligible at once | P4 |
| 6 | **Decided** (Dylan, 2026-10-26: recommended): record who asked for each cancellation (casual, firm, client, unknown) apart from who carried it out, and a strikes switch per firm | Not recorded; strikes always on | P3 item 4 |
| 7 | **Decided** (Dylan, 2026-10-26: recommended): import the CRM's Casual sessions only, never Contracted or Holiday ones | Nothing imported | P3 item 2 |
| 8 | **Decided** (Dylan, 2026-10-26: recommended): a booking added in the CRM that the rules refuse (an expired licence) is flagged as urgent, never booked (golden rule 6) | As the rota sheet: not booked, reported | P5 |
| 9 | **Decided** (Dylan, 2026-10-26: recommended): for bookings made in ShiftDesk, ShiftDesk sends the offer, the confirmation and the reminders, through the firm's Webex account, each logged (golden rule 5); AXLR8 keeps texting about the office's own bookings, so no casual gets the same text twice | Nothing is sent for real (no text sender yet) | P2 ("who sends what"); Phase 15 |
| 10 | **Decided** (Dylan, 2026-10-26: recommended): first come, first served texts the best 5 casuals per free place by the existing ranking, at most 50 a wave, then the next wave every `wave_minutes` (15) while it's unfilled; the board still shows the shift to everyone eligible and the first yes still wins. About £1 a wave for one place at 20p a text, instead of about £300 | Everyone eligible at once | P4.3 |
| 11 | **Decided** (Dylan, 2026-10-26): automatic replies never go by text ("it would be an internal chat on the app not texts being sent out"): a text that comes in goes to the office; the in-app chat is P8, with at most 5 automatic replies an hour per casual there. Automatic replies are the shifts line's answers to a WhatsApp, text or voicemail that comes in; a phone call still gets the caller's login link, the login page's own answer (Dylan, 2026-10-27: "Keep sending the link") | Every message gets an automatic reply on its own channel (WhatsApp today) | P4.7; P8 |
| 12 | **Decided** (Dylan, 2026-10-26: recommended): at most 5 unknown-number alert emails per firm an hour; the messages still show in "Need a person" (a cap on polite replies is moot: none go by text) | One email per number to every admin and resourcer | P4.7 |
| 13 | **Decided** (Dylan, 2026-10-26: recommended): texts go out only for offers, confirmations and reminders of ShiftDesk's own bookings, through the firm's Webex account, and preferably only when the casual's phone has app notifications off (Messages 2) | Nothing sent for real (no text sender yet) | Phase 15; P2 |
| 14 | **Decided** (Dylan, 2026-10-26: recommended): the database's time limits are set inside `withFirm`, per transaction, rather than per database role (a tenancy change) | No limits | P4.2; ADR-027 |
| 15 | **Decided** (Dylan, 2026-10-28: recommended): with no text sender yet, every message a text would carry goes to a casual whose phone has no notifications on by email, when we have their address: push first, then a text once a sender exists, then email | Nothing reaches a casual in production | P2.1; P2.4 |
| 16 | **Decided** (Dylan, 2026-10-28: recommended): login links and pay codes by email, built now and switched off per firm; the login and Pay pages' words change after the UI chat's Phase 24, `docs/screens.md` first | WhatsApp only | P2.6; P2.7 |
| 17 | **Decided** (Dylan, 2026-10-28: recommended): build "who sends what" now: every booking records where it came from, and a firm setting stops ShiftDesk's confirmation and reminders for bookings the firm's own system made | ShiftDesk sends for every booking | P2.2; P2.3 |

### Checks and to-dos (not choices)

| # | What | Who | Where |
|---|---|---|---|
| 1 | **Before any real data:** pay the ICO data protection fee (Tier 1) | You | compliance.md |
| 2 | **When you create the accounts:** check the host's monthly prices before you buy | You | "Connect hosting" |
| 3 | **When you create the accounts:** MFA on every account, least-privilege access, a one-page breach plan (72 hours to report) | You | compliance.md |
| 4 | **When you deploy:** the first deploy's database step connects with checked encryption (a certificate error: tell Claude) | You | runbooks "Deploy" |
| 5 | **Before any firm uses its own address:** a regular re-check that it still points to us | Claude | docs/testing.md pre-pilot checklist; ADR-019 |
| 6 | ~~**Before a pilot:** a per-worker limit on "Take shift"~~ **Done in 13.5**: 20 taps every 15 minutes | Claude | Parking lot |
| 7 | ~~**Before a pilot:** licence expiry messages go by WhatsApp whatever the worker chose (a worker who chose texts gets none): move them onto the normal sender~~ **Done in 13.5** | Claude | Parking lot (credential expiry items) |
| 8 | **Before a pilot:** the dry-run event day on the firm's real setup | You, with the firm | pilot-playbook.md; Phase 9 |
| 9 | **Before the first real import:** how a real file gets into the server's owner container (a mounted folder, or `docker compose cp`) | Claude, then you | Parking lot "Import the pilot firm's real data" |
| 10 | On the first restore: check a snapshot keeps the database's logins | You | "Try the runbooks for real" |
| 11 | Monitoring and alerts as the runbook says (the host's own alerts, an outside uptime check, the app's alerts to you) | You | runbooks "Monitoring and alerts" |
| 12 | ~~Fix the flaky test (`sheets.jobs.test.ts`): its fix is written out~~ **Already done** on 2026-10-06 (40a7590: the tick's key holds its minute; checked again in 13.5) | Claude | Parking lot |
| 13 | Capture real Twilio requests for the tests | You, then Claude | "Connect Twilio" step 11 |
| 14 | **Before a pilot:** a TravelTime production quote (the price isn't published; 12 months minimum; the free key is "not for commercial use") and its data processing agreement; TravelTime and postcodes.io added to the sub-processors (Legal 2) | You (the quote and agreement), Claude (the docs) | `docs/office-v2.md` §5.4; Product 9 |
| 15 | **Before a pilot:** add the strike and CSAS questions in `docs/office-v2.md` §6.4 to the solicitor's list (Legal 1) | You | `docs/office-v2.md` §6.4; Legal 16 |
| 16 | **Before any Northern Ireland firm:** Northern Ireland (BT) postcode data needs a separate licence | You | `docs/office-v2.md` §5.4 |
| 17 | **Before Phase 12 starts:** keep a copy of the approved mock-up in the repo (`docs/mockups/office-v2.html`; made-up data only), because today it is a private claude.ai artifact and a temporary file builders can't open (`docs/office-v2.md` §1.1 describes it in words meanwhile) | Claude (task 12A.0; OK'd by "go with your recommendations", 2026-10-06) | `docs/office-v2.md` §1.1; Phase 12 task 12A.0 |
| 18 | **Before Phase 12 starts:** close Phase 11's tasks with `/close-task` (built and verified in b3f3627, not yet audited or ticked); Phase 12 replaces the shell and Today they pin | Claude | Phase 11 |
| 19 | Send the questions in `docs/discovery-axlr8.md` (AXLR8, the ops portal's builder, the firm's IT) and bring back the answers | You | proposals P1 to P7 |
| 20 | **Before any real data:** ask AXLR8 whether a third-party connection needs its consent; keep its API Builder PDF out of the repo (it's AXLR8's document); no one explores the API with an employee login before the agreement | You | `docs/discovery-axlr8.md` |
| 21 | **Before any real data:** the agreement and DPA cover the staffing mailbox too (client, venue and applicant mail, not only casuals') | You, with the solicitor (Legal 1) | P7 |

## Parking lot

(Ideas that came up mid-build. Not in scope until a phase includes them.)

- From Phase 24 (24.5, 2026-10-28): an office address that doesn't exist, opened while logged out
  (a mistyped `/office/…` link), shows the casual app's "We can't find that page." with "Go to my
  shifts". Give the office's own logged-out not-found page "Go to the office login" instead.

- From Phase 24 (24.4, 2026-10-27, the guardrails review): Enquiries loads the message beside the
  list on a phone too, where it's hidden (from 1024px only): one more read of a message per phone
  visit, nothing more shown. Load it only where it shows (the pane asking for it once the page
  knows it's wide) if a pilot's phones find the page slow.

- From Phase 24 (24.3, 2026-10-27): the demo seed has no places casuals took from offers
  overnight, so the dashboard's "While you were out" shows "Nothing taken last night." in a demo.
  Add a few to the seed's story (said yes between 18:00 and 08:00 before the seed's day, booked),
  so the column shows as the mock-up does the morning after a `db:reset`.

- From Phase 17 (2026-10-20): ~~the dashboard still reads 2 sessions with each event it shows
  casuals (`SHOWING_SESSIONS`, `src/lib/office/dashboard.ts`), though its table now shows only each
  event's totals: read none.~~ (Gone with Phase 24's dashboard, 24.3.) A firm's own colour on a button isn't checked against the page behind
  it (a pale yellow on white, a dark colour in the dark theme): the words on the button always read
  (4.58:1 or more), so nothing is added for now (`docs/ui-design.md`, "A firm's own colour on
  buttons"); revisit with a pilot firm's colour. The office's other screens (a shift, a casual's
  page, the log, pay) and the casual's Profile and shift page keep their old layout under the new
  look: lay them out again if a pilot finds them busy.

- ~~**Phase 1 blocker:** the dev/CI Postgres user is a superuser, which bypasses RLS.~~ Resolved
  in Phase 1 (ADR-011): app, jobs and owner roles; tests run as `shiftdesk_app`.
- CI security layer from `docs/testing.md`: `npm audit` and a secrets scan. Note: drizzle-kit
  0.31 currently pulls 4 moderate advisories (old esbuild in `@esbuild-kit`, dev-only tooling).
- From the Phase 0 guardrails review: ~~hide the raw `createDb`~~, ~~a zod job envelope~~ and
  ~~redact pg-boss error logging~~ (all done in Phase 1).
- Invariant: fail if `twilio` is imported anywhere under `tests/` (when the SDK arrives, Phase 4).
- CI e2e job needs a Postgres service once e2e covers DB-backed flows (moved into Phase 1 with
  the worker-login e2e test).
- Phase 8: custom domains in the host lookup and the Caddy `ask` endpoint (done in the custom
  domains task: the proxy lets a possible custom domain through, and `/api/caddy/ask` on any
  host). Health checks settled in the deploy task: `/api/health` is let through on any host too.
- A short negative cache for unknown firm slugs if random subdomains ever cost noticeable load
  (each one is one `app_resolve_firm()` call).
- Phase 8: branding. The database only accepts `#rrggbb` colours and `https://` logos; still never
  render brand fields raw into CSS or HTML. (Done in the branding task: checked again in
  `src/lib/tenancy/brand.ts`, reaching the page only as an `<img>` address or a React style
  colour.) Left for later: the office settings screen's Branding section (the app role would need
  to update those `firms` columns; today `npm run firm:brand`, the owner's); uploading logos to our
  own storage instead of the firm's site; home-screen icons made from the logo (the manifest has the
  theme colour only); the brand colour on buttons too (today the bar only).
- Phase 8 custom domains, left for later: links in messages and emails on the firm's own domain
  once verified (today `<slug>.<base>`, except a login link asked for on the firm's domain, Phase 10;
  a session belongs to one address, so someone logged in on the firm's domain who taps a message's
  link logs in again on `<slug>.<base>`); a periodic re-check of each verified domain's CNAME (today
  `npm run firm:domain -- --check` by hand); an office settings section for it (separately:
  Caddy now checks `deploy/Caddyfile` itself, `tests/integration/deploy.caddy.test.ts`, Phase 10
  task 17); trying
  a firm's own domain against `npm run dev` needs an https front like the browser tests'
  (`tests/e2e/tls-front.ts`) and an `allowedDevOrigins` entry (only the browser tests' name is
  allowed); a person logged in on both addresses has two sessions, and "Log out" ends the one it's
  on (with its kept My shifts copy), so moving message links to the own domain removes that too. **The periodic re-check is a must-have before any real firm's
  domain is verified** (pre-pilot checklist in `docs/testing.md`): login links now go to a verified
  own domain, and the verified mark is only as fresh as the last `--check`.
- Phase 8: Caddy sets `X-Real-IP` (the app's only source of the client IP) and the web port is
  never published; Postgres TLS with `sslmode=verify-full` and the RDS CA bundle (12X.1: the
  host's CA at `/app/db-ca.pem`, not the RDS bundle); a compose `migrate` service that alone holds
  `DATABASE_ADMIN_URL`.
- Phase 7 STOP by text, left for later: a roster sync that changes a worker's number keeps their
  "texts off" on the row (the safe side, but it's about the old number); a HELP that Twilio's own
  handling answers also gets our office reply (two replies); if CANCEL stays an opt-out word, the
  `sms_stopped` confirmation for it could add the cancel link. The SMS fallback for login links
  (below) must go through sendToWorker() or check the opt-out itself (a test holds direct texts to
  the STOP confirmation only).
- Phase 4/7: SMS fallback for login links and codes, with an ASCII " - " sign-off (an em dash
  turns an SMS into UCS-2 and 3 segments).
- Pay data: `myPay()` (Phase 3) re-checks the stepped-up session it's given (kind, worker and the
  30-minute window) and throws `StepUpRequiredError` otherwise. The Phase 6 "Raise a pay query"
  action must do the same (call `steppedUpWorker()` itself), not rely on the /pay page.
- ~~Before Twilio (Phase 4), send-login-code too: make a retried job a no-op (a unique request id
  on otp_codes, like magic_links.request_id; a schema change).~~ Done in Phase 10 task 3
  (`otp_codes.request_id`, migration 0027; a code is sent at most once).
- ~~Before Twilio (Phase 4): send-portal-link sends inside its database transaction. Commit the
  unsent link first, then send, then mark it sent.~~ Done in Phase 10 task 3 (claim, send, record:
  a link is sent at most once). Still open: skip login requests more than a few minutes old (after
  the worker was down).
- When an office settings screen lets a firm edit `sign_off`: validate it (ends "Shift Team",
  never a person's name).
- When an office-users admin screen exists: use one email rule for storing and logging in (the
  database accepts `a@b`, which login's stricter check would never match).
- Per-IP login limits are per firm (auth_throttle is firm-scoped); a cross-firm IP limit needs a
  non-tenant table. Revisit if abuse shows up.
- ~~Before the pilot: review the per-IP login limit (10 per 15 minutes) against how the pilot firm
  onboards staff.~~ **Done in 13.5** (Dylan, 2026-10-16: raise it): 60 per 15 minutes, the
  per-number limits unchanged. A per-firm setting stays an option if a firm's briefings are bigger.
- auth_throttle holds HMACs of phone numbers; with SESSION_SECRET those can be reversed (UK
  mobiles are ~10^9), so treat the rows as pseudonymous personal data: the 1-day purge (Phase 8
  retention job) matters.
- The app role gets UPDATE on `firms` (settings, branding) only when a feature edits a firm
  (Phase 5/8), with event logging.
- Sessions: detect a rotated-out token being used again (revoke all of that person's sessions).
- Link page: show "number ending 123" before "Log me in", and ask before replacing a session
  that's already there (a forwarded link would otherwise log the colleague into the sender's
  account).
- `db:reset` and the seed accept any database on this machine. An SSH tunnel to production also
  looks like localhost: never open one while a dev `.env` points through it (or add a marker
  table that only dev databases have).
- A `db:rotate-app-password` script (the runbook has the manual steps). Create roles from a
  pre-computed SCRAM verifier so a plaintext password never reaches a server log that records DDL.
- Remove the app's DELETE grant on `office_users` (they are disabled, never deleted). The
  isolation tests' delete control is now split per privilege (Phase 2), so only the grant and a
  check that nothing deletes office users remain.
- Phase 2: eligibility must compute expiry from `credentials.expires_on`, not trust `status`.
- Phase 8 GDPR worker delete: rota rows (assignments, requests, offers) block a plain `delete from
  workers` (their foreign keys have no ON DELETE action, on purpose). Design anonymise-or-purge
  that keeps the notice report's evidence for its retention period. (Done in the Phase 8 GDPR task:
  erase to an anonymous row, ADR-020.)
- Phase 8 retention purge: the app role has no DELETE on shifts, assignments, requests or offers,
  so the purge job needs its own narrow path (a purge function or role) and writes an event per run.
  (Messages and login leftovers done in the Phase 8 GDPR task; the 12-month evidence purge is parked
  in "GDPR follow-ups".)
- Phase 5 shift edits: lowering a shift's headcount, or cancelling a shift, leaves open slot rows
  the app can't delete or cancel (a cancelled row needs a worker). Taking one is blocked while the
  shift isn't `open` (the documented first-yes-wins statement checks it), but decide then how to
  retire them (a `withdrawn` status, or a narrow delete of open rows only). Slot numbers <=
  headcount are enforced in code only (a CHECK can't see the shift).
- Phase 4 offer waves: accepting an offer (`offered → confirmed`) must be one conditional update
  (`where worker_id = $me and status = 'offered'`) so it can't race an office cancel, and go
  through `checkBooking()` like every booking (moved from the atomic assign task: what "offered"
  means is still open for Dylan).
- **Dylan to confirm:** the office may override "shift already started" (to book a late
  replacement onto a shift that has begun); workers never can. Remove `started` from
  `OVERRIDABLE_CODES` if not wanted.
- Roles need display names ("a uniformed guard", not "an uniformed guard"; the a/an rule only looks
  at the first letter): a label on credential_rules, set by the pack, when the office settings
  screen edits rules.
- Any-of credential rules: an SIA door supervisor licence also covers security guarding, but the
  pack's security_officer rule asks for SIA_SG only. Model "any of" before a firm hits it.
- Imports: warn about credential types a firm hasn't set up (today they import, and the rules engine
  finds them missing).
- Phase 5 headcount edits: a holder in a slot above a lowered headcount makes the native
  `getShifts` report a shift that fails `rosterShiftSchema` (slots 1..headcount). Don't lower a
  headcount below its held slots (cancel those bookings first, with notice), or decide how to show
  them.
- Phase 4: `AssignResult` and `CancelResult` don't say whether the shift became
  `filled` or reopened; the offer wave after a dropout needs to know. Add it to the results (or
  re-read in the caller). (Lock order is now shift then worker everywhere, and `bookShift()`
  retries on deadlock: keep it so for any new writer.)
- **Before any Sheets firm goes live:** the sheet's names now go through the rules (refused ones
  are logged `roster.sheet_booking_refused`). What's left: connect the real Google service account
  ("Connect the real Google Sheets"; since Phase 10 task 10 the code side is done:
  `SHEETS_TRANSPORT=google`, `npm run firm:sheet`, only United Kingdom sheets, one sheet per firm),
  and decide the items below (a vanished row, a Draft shift with people on it, telling workers about
  sheet edits). (Since Phase 10 task 9 the office sees what the sheet asks for and didn't get on
  Today, "From your rota sheet", and a refused name stays in its sheet while there's room.)
- Sheets, before any office settings screen for the sheet (Phase 10 task 10, audit L45): connecting
  a sheet is owner-only (`npm run firm:sheet`), a sheet belongs to one firm (even switched off,
  until `--forget`), and the app role can't change a source's sheet. If the office ever picks its
  own sheet in the app, first make the firm prove the sheet is theirs (a code we give them typed
  into a cell, say): otherwise the first firm to name a sheet that's shared with our service account
  but not yet connected gets it. Until then the owner trusts the link the firm gives:
  `firm:sheet` could also print the sheet's title from Google, to check it's the right one.
- Sheets dates, what the United Kingdom locale check doesn't catch (Phase 10 task 10, audit M17):
  a date cell with its own custom month-first format (M/d/yyyy) in a UK sheet, and dates typed while
  a sheet was set to another country (they can move when it's changed to UK). Both read wrongly
  with no error for days 1 to 12. The fix: read the Date, Start and End columns as Google's own
  values (one `spreadsheets.get` with `fields=properties.locale,sheets.data.rowData.values.effectiveValue`
  for just those ranges, which also folds in the locale request) and compare. 12-hour times ("9:00
  PM") are refused as a bad time, which is safe.
- Imports, the CSV side of M17: CSV and Excel imports read dates day first too (shifts, credential
  expiry dates, pay periods: `src/lib/imports/import.ts`), so a CSV saved by US-locale Excel swaps
  days 1 to 12. Refuse a file whose dates are all month-first-shaped, or ask which way round on the
  import screen. (Phase 10 task 11 made every import path read dates the same way, day first, but
  didn't add this: still open.)
- Imports without Staff IDs (Phase 10 task 11, audit L78): a row whose mobile is someone else's is
  now refused, but a worker who changed number arrives as a second, new worker (the file can't say
  it's them), and their old record keeps the old number: whoever has that number now can log in
  as them (their shifts, and their pay after the code). The refusal tells the office the number
  may be someone else's; flag a new worker whose name matches an existing one on another mobile,
  for the office to merge, or ask firms for a Staff ID column.
- Office: a "Change name" (and mobile) on the worker's page. The app has no rename: a worker with
  no Staff ID who changes their name needs two imports (link with a Staff ID, then rename).
- Imports, small (Phase 10 task 11 reviews): a re-import that reopens a shift doesn't restart its
  offer waves or urgent marking as the office's "Open it again" does; a check on the web doesn't say
  the live server will refuse the save until the agreement is recorded; "12,500" is read as
  £12,500 (a European-style 12.5 is possible); a Mac CSV is refused only when its accents show (é,
  ü), other letters can come through changed; an international mobile now needs 9 to 15 digits
  (Falklands and St Helena numbers are shorter).
- e2e in production mode locally (Phase 10 task 12): `verify.sh` runs the browser tests against
  `next dev`; CI runs them against a production build. Under `next dev` a kept My shifts copy
  offline can't load the dev server's reload script, so it never becomes interactive, and logging
  out from the kept copy is tested only in the service worker's sandbox. Add a production-mode e2e
  run to `verify.sh` (or a second Playwright project) and a browser test for it.
- **Dylan to confirm (retention, Phase 10 task 13, audit M24):** the defaults (messages 90 days, a
  closed request's words and the office's override reasons 12 months, as the original spec said;
  Phase 8 had built 90 days for request words without asking); the 30-day floor and 6-year ceiling
  for a firm's own numbers; and that a hold (`retention.hold_until`) covers the whole firm, not one
  worker. Also: an erasure leaves what other people wrote that names the worker (a colleague's swap
  request, someone else's message) to the retention schedule; deleting those on request too would
  mean searching other people's words for a name (docs/compliance.md "GDPR requests").
- **Dylan to confirm (Gate B, Phase 10 task 11):** a check (dry run) of a real staff file is
  allowed on the live server before the agreement is recorded (nothing is saved, but it is read,
  which counts as processing under UK GDPR). And the demo firms on the live server would need a
  made-up signing date to try the web import there, which puts an "agreement recorded" line in
  their log: use a local copy for demos instead.
- Sheets, replacing a firm's sheet: shifts and staff are matched by Shift ID and Staff ID alone, not
  by which sheet they came from, so a new sheet that reused "S7" for another shift would cancel or
  move the people booked on our S7. `firm:sheet` now refuses another sheet while sheet shifts ahead
  have people booked, unless `--same-ids` says it's a copy. The real fix: key sheet rows by their
  source as well, or treat a new sheet's first sync as a fresh import.
- Sheets, a switched-off sheet (`firm:sheet --disable`): its shifts stay but freeze (workers can't
  book them, the office is told to change them in the sheet), and people already booked stay booked
  and still get reminders. **Dylan to confirm** what switching a firm's sheet off should do to its
  shifts ahead (hand them to the app's own rota, or cancel them with notice).
- Sheets, small: two `firm:sheet` connects of the same sheet for the same firm at the same moment
  report the second as "connected to another firm"; reconnecting a sheet without `--mapping` puts
  the default headings back (said in the script's help).
- Sheets quota: each sync makes 2 to 4 Google requests (the locale, the read, then a re-read and a
  write when there's something to write), against one service account's per-minute quota (Google
  has published 60 read requests a minute per user; the Cloud console's "Quotas" page shows the real
  figure). Fine for a handful of firms; past about 20 Sheets firms on event days, read the locale
  less often (or with the cells, in one `spreadsheets.get`) or ask Google for more.
- A shift row the office deletes from its sheet stays in our copy and stays bookable (the sync
  ignores vanished rows). Decide what a vanished row means (a firm cancellation with notice, or a
  flag for the office) before any Sheets firm goes live.
- Booking: availability (Phase 3 `/profile`, `worker_unavailable_days`) and blocked sites (Phase
  10 task 7, `worker_site_blocks`, set on the office's worker page) both feed the rules now.
- **Dylan to confirm:** a role changed in the rota sheet on a booked shift is made when everyone
  booked can do the new role (Phase 10 task 9: the same rules check as a move), but the office's
  own shift editor refuses any role change once people are booked, and a CSV import refuses role
  and time changes on booked shifts. Should the sheet be as strict as the editor (refuse every
  role change on a booked shift), or the editor as flexible as the sheet?
- **Dylan to confirm:** the office's override reason is still free text (up to 500 characters, no
  phone or email), but since Phase 10 task 13 it's kept on the booking (`assignments.override_reason`),
  never in the append-only log: a worker's deletion replaces it, and the retention purge clears it
  with request words (12 months by default). The shift's page shows it with the booking. Reason
  codes instead of free text are still an option.
- Phase 3 `takeShift` and `cancelShift` actions: take the firm from `getCurrentFirm()` (ADR-012),
  never from input, and the worker from the session; `src/app` can't import `withFirm`, so add a
  small lib wrapper.
- A Sheets shift set to Draft in the sheet keeps its confirmed workers, with only a
  `shift.status_changed` event and no per-worker notice. Decide (with the vanished-row question)
  whether Draft on a booked shift means a firm cancellation.
- Phase 5 `updateSettings`: validate the rules settings (`rulesSettingsSchema`) when they're
  written. A broken value makes every booking fail and the Sheets sync book no names.
- Booking: the day's "applied" count checks others' credentials against the day the shift starts
  and counts shifts starting that day, while the rules check the applicant to the shift's last
  day. Fine for day shifts; revisit if firms rely on the allowance for night work.
- Cancelling: the worker's `cancellation_ack` WhatsApp ("We've recorded your cancellation of…")
  and the urgent-window check that starts offer waves come with Phase 3/4 (`notify`, offer waves).
- Phase 5 office cancel screen: let the office record when the worker actually asked (a phone call
  at 07:10), so notice counts from then (`markCancelled` already takes `cancel.at`); flag short
  notice in the notice report against `short_notice_threshold_hours`, not in the events.
- Demo seed task (Phase 3): the e2e login test expects Acme's worker 07700 900100 to have no
  bookings (it checks My shifts' empty state) and Acme to have no open shifts for them ("Nothing
  open right now."). Keep that worker unbooked in the demo seed, or move
  the check to a worker who stays unbooked.
- ~~**Before the pilot:** the Open shifts list checks each shift with the rules on its own~~
  **Already done** in Phase 10 ("Speed at pilot size", 0429ef0; confirmed in 13.5): one rules
  check for the whole list (`previewBookings`), the same number of queries for 5 shifts as for
  40 (`tests/integration/eligibility.batch.test.ts`, with travel areas on since 13.5). Was: (about
  ten small queries each, up to 50 shifts), holding one of the pool's connections for the whole
  page view. Batch the rules loader (one read of the worker's credentials, bookings and the firm's
  rules for the whole list) so an urgent message to many workers can't starve "Take shift".
- ~~"Take shift" has no rate limit, and every refused tap writes a `shift.booking_refused` event.~~
  **Done in 13.5**: 20 taps per worker every 15 minutes (`LIMITS.takePerWorker`), booked or not,
  then "Too many tries. Try again in {n} minutes."; logged once (`auth.rate_limited`, take:worker).
- Phase 5: let the office look a booking up by the 8-character reference on the worker's
  confirmation.
- Open shifts cards: the pay rate "if the firm shows it" comes with pay data (Phase 6).
- Pay records (**Dylan to decide**; the Phase 6 import screen is built, correcting isn't): no app
  path deletes a wrongly imported line (NO_DELETE); decide how payroll corrects or removes one, and with Phase 8 how GDPR deletion and
  retention treat pay records. A corrected rate re-imports as a second line (the rate is part of
  the key), so the worker sees both; and an update overwrites the old hours and gross (the log
  keeps field names only), so what a worker was shown before is lost. Consider superseded rows or
  a versions table in Phase 6. ~~A Windows-1252 CSV with £ is refused as "not text".~~ Since
  Phase 10 task 11 a Windows Excel CSV is read; only a garbled one is refused, with a plain
  message. Demo pay records come with the demo-seed task.
- Phase 6's "Pay records CSV import" line is effectively built in Phase 3 (the `pay` kind of the
  importer); the office screen is built in Phase 6 (`/office/pay/import`).
- Fair rotation: a shift created as a draft and opened later counts its window from creation (no
  "opened at" is stored); a cancellation restarts the window for every open place on the shift
  (even ones open for days), and counts even when no place reopened (after the start, or above a
  lowered headcount); a headcount increase or a Sheets row reopened never starts one; the group
  is by role and hours, not full eligibility (one 0-hour worker with an expired licence can hold a
  place for the window); hours this week count whole shifts starting that week (not clipped at
  midnight Sunday). Revisit with the Phase 5 shift editor and the Phase 4 waves (which reuse
  `rankForFairRotation()`).
- **Dylan to confirm:** fair rotation on the Open shifts board as a priority window (ADR-015): a
  new place is held for 15 minutes for the 4 workers with the fewest hours that week (not for
  shifts starting within 24 hours, never past the start), counted by role and hours rather than
  full eligibility.
- **Dylan to confirm:** a swap request's "Who could take it? (optional)" is free text, so it can
  hold another worker's name (stored on the request only, never in the log or shown to others).
- **Dylan to confirm:** add `npm run build` to `scripts/verify.sh`. A client component importing
  database code passed every check but broke the production build (caught in review; a unit test
  now follows client imports, but only a build proves the bundle). verify.sh can't be changed
  without Dylan.
- Worker requests, for Phase 5: approving a time change is a firm-initiated move or curtailment
  (log notice hours per worker, golden rules 5 and 12); approving a swap must put the colleague
  through the rules and `bookShift()` (golden rule 6). Open requests stay "Waiting for the office"
  after the booking is cancelled: auto-resolve them then. Office lookup by the 8-character
  reference must cope with two ids sharing a prefix. Request notes can hold health details (like
  cancel reasons: consider codes).
- Schema, needs Dylan's OK: a partial unique index on requests `(firm_id, worker_id, shift_id,
  type) where status in ('open','escalated')`, so any future path can't add duplicates (today the
  shift lock does it, tested).
- Worker requests: the office isn't told about a new one until the Phase 5 requests queue (and
  its email/push); the worker isn't told of the answer until `request_update` (Phase 4 notify).
  "General question" and "availability" requests come with their own tasks (profile, office).
- Server actions (`takeShiftAction`, `cancelShiftAction`, `createRequestAction`): no tests of their own input handling
  (logged out, a bad id, an invalid reason); they need the request's host and session. Add with
  the Playwright flow (Phase 3) or a small action-test helper.
- Worker cancellations store the quick reason as text ("I'm unwell" is health-related). Consider
  reason codes (with the office override reasons, Phase 5).
- **Dylan to confirm:** the My shifts banner also shows expired credentials (the spec asked only for
  "expires within 30 days"), limited to what the worker's roles need.
- **Dylan to confirm:** sending someone home part-way through a shift is a curtailment (Phase 5
  "curtail", notice logged), not a cancellation; the office can cancel a started shift today only
  to record a late cancellation.
- **Dylan to confirm:** (1) "re-check the live source" for a Sheets shift means our copy synced in
  the last 20 minutes (ADR-014), not a read of the sheet per booking; (2) a name the office types
  into its sheet overrides the rest (11 h) and weekly-hours (48 h) limits and availability.
- Booking: a Sheets shift is confirmed only against a copy synced in the last 20 minutes
  (`SHEET_COPY_FRESH_MS`); tighten it on event days if pilots see sheet-side clashes.
- Sheets sync performance: it updates only changed rows but locks every sheet shift row for the
  mirror transaction, so portal bookings for that firm wait for the sync. Fine for pilot-sized
  sheets; for big ones, skip unchanged rows before locking and limit to a time window.
- `app_firm_ids()` is callable by the web too (it shares the app role). Ids only and low risk; a
  worker-only role would be least privilege (revisit with ADR-011).
- Workers aren't told when an office edit in the sheet cancels, moves or books them (Phase 4
  notifications / Phase 5 firm-initiated changes).
- **Connect the real Google Sheets** (the Phase 2 Sheets plug is built, but has only been tested
  against a fake Google; nothing reads a real sheet until this is done). Needs a Google account; the
  Sheets API itself costs nothing. The code side is ready (Phase 10 task 10): `SHEETS_TRANSPORT=google`
  switches the sync on, and `npm run firm:sheet` connects a firm's sheet.
  1. **Dylan:** go to console.cloud.google.com and sign in with the business's Google account (not a
     personal one). Make a project: the project menu at the top → "New project" → name it
     `shiftdesk` → Create.
  2. **Dylan:** in that project, "APIs & Services" → "Library" → search "Google Sheets API" → open
     it → Enable.
  3. **Dylan:** "IAM & Admin" → "Service accounts" → "Create service account". Name it
     `shiftdesk-sync` and press "Create and continue", then "Done". It needs no roles: it only ever
     sees sheets someone shares with it.
  4. **Dylan:** open `shiftdesk-sync` → the "Keys" tab → "Add key" → "Create new key" → JSON →
     Create. A `.json` file downloads. It's a password: never email it, never put it anywhere else
     in the project. (If Google says key creation is blocked by an organisation policy, stop and
     tell Claude.)
  5. **Dylan:** put that file in the project's `secrets` folder (the folder is never committed).
     In the terminal, in the project folder, type these two lines, pressing Enter after each
     (change `<you>` to your Windows user name, and the file name to the one that downloaded):
     `mkdir -p secrets`
     `mv "/mnt/c/Users/<you>/Downloads/shiftdesk-1234abcd.json" secrets/google-service-account.json`
     Then `grep client_email secrets/google-service-account.json` shows the service account's email:
     that's the address firms share their sheets with.
  6. **Dylan, a test sheet first (demo people only):** make a new Google Sheet. **Before typing
     anything**, File → Settings → Locale: **United Kingdom** → "Save settings" (a sheet in another
     locale is refused, on purpose: its dates read the other way round, and dates typed while it
     was set to another country can move when it's changed). Then make two tabs:
     - `Staff`, row 1: Staff ID, First name, Last name, Mobile, Roles, Status. Then two of
       Northline's demo workers, so they keep their demo licences: look them up on
       `http://northline.localhost:3000/office/workers` by mobile, `07700 900310` and
       `07700 900311`, and copy each one's first and last name. Give them Staff IDs `N010` and
       `N011`, Roles `track_operative`, Status `Active`, and type each mobile with its space (typed
       as one long number, Google drops the 0).
     - `Shifts`, row 1: Shift ID, Date, Start, End, Site, Role, Needed, Status, Instructions,
       Assigned. Two shifts: `S1` tomorrow and `S2` the day after, each 07:00 to 15:00, Site
       `Northline Demo Depot`, Role `track_operative`, Needed `2`, Status `Open`, Assigned empty.
       Type dates day first (14/11/2026 for 14 November) and leave the Date column's format alone
       (no custom date format).
     Then "Share" → paste the `client_email` → Editor → Send.
  7. **On your computer:** in `.env`, set `SHEETS_TRANSPORT=google` and
     `GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./secrets/google-service-account.json` (stop `npm run dev`
     first if it's running, and start it again after). Run
     `npm run -s firm:sheet -- --firm northline --sheet <the sheet's link>`: it says "Connected
     northline's sheet". Then `npm run dev`. What you should see:
     - Within about two minutes, `npm run -s firm:sheet -- --firm northline` says "Last synced: …"
       and "No error", and `http://northline.localhost:3000/office/shifts` lists S1 and S2. (A shift
       starting in the next 24 hours makes it an event day, so the sync runs every minute;
       otherwise every 15 minutes.)
     - Type `N010` into S1's Assigned cell: within a minute that worker is booked on S1 (the shift
       page in the office shows them).
     - Log in to the portal as the other worker (`http://northline.localhost:3000`, mobile
       `07700 900311`; the login link is printed in the `npm run dev` terminal) and take S2:
       within a minute `N011` appears in S2's Assigned cell.
     - Set the sheet's locale to United States: at the next sync, `firm:sheet` says it's failing
       because of the locale, and the office's action log (`/office/log`) says why and how to fix
       it. Set it back to United Kingdom: syncing starts again (within 5 minutes on an event day:
       a failing sheet is tried less often).
  8. **Claude, after Dylan:** tell Claude what step 7 showed; anything that didn't match is looked
     into (some refusals are on purpose: a name the rules refuse stays in its cell and shows on
     Today's "From your rota sheet").
  9. **On the server** (after "Connect hosting" and "Connect the deploy": the worker, which runs
     the sync, runs from the first deploy since P2.5, with the SMTP settings):
     1. Get the key file onto the server: copy it over SSH (`scp`), or with the host console's
        "Upload file" if it has one (it lands in the home folder). If neither works, stop and ask Claude for another way: never paste the key into a
        chat or an email.
     2. Type, one line at a time:
        `sudo install -d -m 0755 /opt/shiftdesk/secrets`
        `sudo mv ~/shiftdesk-1234abcd.json /opt/shiftdesk/secrets/google-service-account.json`
        (the name of the file you uploaded)
        `sudo chown 1000:1000 /opt/shiftdesk/secrets/google-service-account.json`
        `sudo chmod 400 /opt/shiftdesk/secrets/google-service-account.json`
        (the app runs as user 1000 in its container, which sees the folder read-only at
        `/app/secrets`).
     3. `sudo nano /opt/shiftdesk/.env`: set `SHEETS_TRANSPORT=google` and
        `GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/app/secrets/google-service-account.json`. Save (Ctrl+O,
        Enter, Ctrl+X). Then `cd /opt/shiftdesk && sudo docker compose up -d`.
     4. Connect each firm's sheet: `sudo docker compose run --rm owner node --import tsx
        scripts/firm-sheet.ts --firm <slug> --sheet <link>`.
  10. **Before a real firm's sheet goes live:** the "Before any Sheets firm goes live" items above
      are decided and built.
- Sheets: rows or staff that disappear from the sheet are left as they are here (not cancelled or
  deactivated). Decide with the pilot firm; flag them to the office first.
- Sheets: tell the office about sync errors (`last_error_code`), clashes (`roster.sheet_conflict`)
  and bad rows (Phase 5 Today view). Today they are only in the database and events.
- Demo seed: Northline's mocked sheet. Local dev has no sheet unless `.env` says
  `SHEETS_TRANSPORT=google` with a real key ("Connect the real Google Sheets"); a file-backed dev
  transport would let the demo sync a sheet on a laptop with no Google account.
- Office import screens: shifts (`/office/shifts/import`) and pay records (`/office/pay/import`) are
  built, both on `importOfficeFile()` (`src/lib/office/office-import.ts`). Workers and credentials
  ("import CSV" on a workers screen) can reuse it with their kind.
- Imports, before the Phase 5 upload screen: the whole file is one transaction (holding shift
  locks until it ends), fine for the terminal script; for the web, consider a background job. A
  CSV row without a Staff ID can update a worker the Sheets sync owns (until the next sync puts the
  sheet's values back). Row checks are hand-written (tested), not zod schemas: convert if they grow.
- `exceljs` (dev-only, used by tests to write real .xlsx files) brings 2 moderate `uuid` advisories
  into `npm audit`; production dependencies audit clean. Revisit with the CI security layer.
- Read-only sources (`canWrite: false`): `needs_approval` records nothing. Before any read-only
  source goes live, save the pending change (a `requests` row plus an event with `cancel.at` and
  the notice hours at request time) so a worker's cancellation is never lost.
- Credential rule edits and deletes (office settings, Phase 5): log old and new `required_types`
  in `events`, since a rule change changes eligibility after the fact.
- "Any of" credentials (e.g. `SIA_SG` or `SIA_DS` for a guard): `credential_rules` supports "all
  of" only. Needed before the security pack goes live if a firm accepts either licence.
- Phase 2 CSV import / office worker editing: validate `workers.roles` as snake_case with zod
  (shifts and credential_rules enforce it in the database; workers.roles doesn't yet).
- Demo seed, still to add (see docs/testing.md): Northline's mocked sheet (Phase 2; needs a Google
  account). Done in Phase 10 task 20: the short-notice firm cancellation (Northline), 10 pay
  queries (7 about one rate change), and last Saturday's event (so "Past 30 days" and "Who worked?"
  aren't empty). (The seeded dropout's urgent mark is now logged, as the app logs it.)
- Urgent flag follow-ups (from the Phase 4 urgent flag task):
  - The office Today view (Phase 5): "Mark urgent" / "Not urgent" buttons calling
    `setShiftUrgent()`, and the flag shown on each shift.
  - The flag stays when an urgent shift fills; if the office wants filled shifts shown as not
    urgent, clear it on fill in `bookShift()` and the sync.
  - (Done in the offer waves task: waves start from "a place reopened inside the window".)
- Daily offer cap (Phase 4): offer waves are always urgent, so the cap doesn't hold them back.
  The office's "Offer to someone" (Phase 5) is the first non-urgent offer. It picks its workers
  with `waveCandidates()` and counts under a per-worker lock that waves also take before writing
  offers (`lockOfferCounts()`), so two offers at the same moment can't pass the cap (tested).
  Still open: decide whether a firm may change the 3 (fixed policy today). Scale (fixed in Phase
  10, 2026-10-03): a wave now claims one worker at a time, holding the shift's lock, that worker's
  count lock and their row for milliseconds and never across a message, so Take shift, Assign, a
  STOP and an erasure don't wait for it (`tests/integration/offers.waves.lock.test.ts`, 300
  workers). The office's single offer claims, sends, then records too (Phase 10 task 3).
- **Dylan to confirm:** urgent offers count towards a worker's 3 a day (they still land on their
  phone), so after 3 urgent offers that day they get no non-urgent ones; failed sends don't count.
- Shift reminders (Phase 4) follow-ups:
  - **Dylan to confirm:** quiet hours hold reminders; a 2-hour reminder for a shift starting
    before 07:00 (default quiet hours) is skipped and logged, not sent at 04:00. The worker still
    gets the 24-hour one the day before.
  - ~~**Dylan to confirm:** the approved `shift_reminder_24h` says "Cancel in the app", but there is
    no app to download (it's a link).~~ **Done in 13.5** (Dylan, 2026-10-16): "Can't make it? Cancel
    with the link as early as you can." (the link opens the shift, where Cancel is).
  - ~~Reminders go to every confirmed booking, including a worker the office has since made
    inactive or blocked.~~ Since Phase 10 task 7 they don't (nor for a booking at a site the
    worker is blocked from, until the office keeps it); those bookings show on Today as "Bookings
    to check", to cancel or keep. Blocking doesn't cancel bookings by itself.
  - No per-worker opt-out for reminders (only the channel). Add one if pilots ask.
  - The "no-show count tracked" half of product-spec P1-8: no-shows are now marked and logged
    (`shift.no_show`); counting them per worker and per week is parked under "Marking who worked
    follow-ups" (the `shift_reminders` rows show whether a reminder went).
  - A push transport that throws (rather than answering "gone") fails the whole offer wave after
    messages have gone (a reminder is left `sending` and never resent). The real web push sender
    must catch its own errors (note for "connect the real web push").
  - A reminder whose whole window passed while the worker process was down leaves no row. Record
    it as `skipped` (reason `missed`) if no-show disputes need it.
  - Reminder job resilience: if recording one reminder's outcome fails, the row stays `sending`
    (never resent) with no event, and the rest of that run waits for pg-boss's retry. Consider
    catching per reminder, logging the code and carrying on. Also push after the outcome commits
    (not inside it) when the real web push sender is connected (offer waves too: their push runs
    in the short record transaction, which holds no shift, worker or offer lock).
  - Office view of reminders (Phase 5 Today / no-show screens): show an old `sending` row as "may
    have gone" next to the booking.
  - Offers still waiting when the *sheet* cancels a whole shift stay "waiting": mark them `expired`
    then, as the office's whole-shift cancellation already does (`src/lib/roster/cancel.ts`).
  - Every sender now claims, sends, then records (Phase 10 tasks 1 and 3): offer waves,
    escalation, the office's single offer, login links and codes, the credential scan and its
    weekly list, firm-change notices, request updates, reminders and the pay-query notices. A job
    that fails after its message is retried and sends nothing, and logs a send it couldn't confirm
    as `unconfirmed` (`tests/integration/jobs.no-resend.test.ts`; escalation and waves also in
    `offers.waves.lock.test.ts`; reminders and pay-query notices in their own tests).

  - A reminder still goes when a credential the shift needs has expired or been suspended since
    booking. Decide whether that should hold the reminder and alert the office (Phase 5 Today
    view).
  - For Phase 10 task 19 (moved: missed by task 16, whose findings list didn't name it; found in
    the task 4 review): a date followed by a time-zone
    offset can swallow the start of a phone number in the log masker
    (`2026-11-02T09:00:00+447700900123` keeps 8 digits unmasked). Limit the offset to real values
    (`[+-](?:0\d|1[0-4])(?::?[0-5]\d)?`) and require no digit after the date.
  - Fixed in Phase 10 task 4: the log masker leaves Twilio ids alone (two capitals + 32 lowercase
    hex, standing alone), so an event logging `providerMessageId` is never refused; every sender
    is tested with Twilio-shaped ids (`tests/integration/events.twilio-ids.test.ts`).
- **Run the pilot's weekly reviews and send the week-4 report** (the Phase 9 "Week-by-week pilot
  metrics review and the week-4 report" task is blocked on it: it's a real four-week pilot).
  1. Each Friday: `docs/pilot-report.md` "Every Friday" (the resourcer's tally first, then the
     Pilot metrics page for that week, the table, the Friday update).
  2. After week 4: "The week-4 report", then the Gate C check.
  3. Tick the task (and Gate C in "Gates" if it's met).
- **Run the dry-run event day** (the Phase 9 "Run a dry-run event day with the resourcer" task is
  blocked on it: it needs the pilot firm's resourcer, real phones, and Twilio connected). After
  onboarding steps 1 to 11 and before the staff briefing:
  1. Follow `docs/pilot-playbook.md` "Dry-run event day": set up a pretend event and three
     volunteers, then do the 12 steps with the resourcer (about two hours).
  2. Fill in its table, and tell Claude anything that was confusing, slow or wrong.
  3. Once fixed, tick the task.
- **Record the baseline week** (the Phase 9 "Baseline week recorded" task is blocked on it: it's
  a real firm's real week, before go-live). After Gate B:
  1. Send the resourcer `docs/baseline-tally.md` (print it or copy it into a spreadsheet).
  2. They fill it in for one normal week (and a busy one if they can).
  3. Work out the 8 figures (the sheet says how) and enter them on the office's Pilot figures page,
     "Baseline (week 0)".
  4. `npm run -s firm:check -- --firm <slug>` shows "[x] Baseline numbers recorded" (only once all 8
     are saved; with fewer it names the ones still to enter). Tick the task.
- **Pre-pilot checks on the server** (the Phase 9 "Pre-pilot checklist in `docs/testing.md` all
  ticked" task is blocked on them: 5 of its 7 items need outside services). Two are ticked from
  the local e2e run (the load smoke, log masking); the rest, in order, once each thing exists:
  1. CI green: GitHub → the repo → Actions → the last "CI" run on `main` is green.
  2. Restore tested: "Try the runbooks for real", the restore step.
  3. The Twilio fallback with a real call: "Connect Twilio" step 10.
  4. WhatsApp templates approved and a test to 3 real phones: "Connect Twilio".
  5. Budget alert and uptime check reaching your phone: "Connect monitoring", "Connect alerts to
     your phone".
  6. Also once on the server: the load smoke against it (the spec's 200 signed webhooks, pointed at
     the live address with the real auth token, a quiet day, a test firm), and the log scan after
     the dry run (docs/runbooks.md "Checking the logs for personal data").
  Then tick the remaining boxes in `docs/testing.md` and the task.
  - The e2e log scan: truncate `.dev/e2e-*.log` only after the e2e lock is taken (a second run
    started during a first one cuts the first's log short), and have CI upload `.dev/*.log` when
    e2e fails (the servers' output no longer shows in Playwright's).
- **Send the pilot firm its privacy notice wording** (the Phase 9 "Privacy notice line supplied to
  the firm" task is blocked on it: there's no firm yet). At onboarding step 10:
  1. Have a solicitor read `docs/privacy-notice.md` once, with the terms and DPA (before the first
     pilot).
  2. Fill in the [brackets]: your business's legal name, the firm's name, its shifts line number,
     its contact, and how long it keeps records after someone leaves. Keep the Google line only if
     its rota is a Google Sheet, and the logo line only if it has a logo set.
  3. Send the firm both parts (the short line and the section). They publish it, not us.
  4. When they confirm it's in their notice, tick the task (and `firm:check`'s "[?] Privacy notice"
     is confirmed).
- **Import the pilot firm's real data** (the Phase 9 "Import real workers/credentials/shifts only
  after Gate B paperwork is signed" task is blocked on it: no firm has signed yet). Only once the
  agreement and DPA are signed:
  1. Get the firm's spreadsheets (workers, credentials, shifts) by a route the firm trusts.
  2. Record the signing: `npm run -s firm:agreement -- --firm <slug> --signed <the date>` (on the
     server, through the owner service).
  3. Follow `docs/runbooks.md` "Importing workers, credentials or shifts from a spreadsheet": a dry
     run first, then `--apply --agreement-signed <slug>` (the import refuses to save to the live
     database without both).
  4. `firm:check` should then show the workers and credentials, and any role with no rule.
  5. Then tick the task.
  - Getting a file into the owner container on the server isn't worked out yet (a mounted folder,
    or `docker compose cp`): decide it on the first real import, and delete the file afterwards.
  - ~~A record of when each firm's agreement was signed~~ (done in Phase 10 task 11:
    `firms.agreement_signed_on`, set by `npm run firm:agreement`, shown on `firm:check`, and checked
    by every import and `firm:sheet` on the live server).
- **Try the runbooks for real** (the Phase 8 "Runbooks in `docs/runbooks.md` tried once for real
  (deploy, rollback, restore)" task is blocked on it: it needs the real server). After "Connect
  hosting", "Connect the deploy", "Connect Twilio" and "Connect an email provider (SMTP)" (its checks log in to a
  test firm's office, by an emailed link the worker sends), and **before any real worker's data is
  imported** (Gate B):
  1. Open `docs/runbooks.md` → "Try the runbooks for real (once, before the pilot's data)".
  2. Do its steps in order (a test firm, deploy, rollback, restore, restore drill), about two hours
     on a weekday outside 05:30–09:00 UK.
  3. Fill in its table: the date, whether it worked, and anything wrong or unclear.
  4. Tell Claude what went wrong so the runbook is fixed, then tick the task.
  - To check on the first restore: that a restore from the host's backups keeps the database's
    user names and passwords ("Restore the database" step 2 and the drill's step 2 rely on it;
    not checked from here).
- **Connect alerts to your phone** (the Phase 8 "Alerts to your phone: job failures, health down,
  Twilio error spikes, sync errors" task is blocked on it: every check is built and tested, but an
  alert today is a line in the server's log, `ops alert`). Until then, the outside uptime check's
  phone app ("Monitoring and alerts (once)" step 3) covers the server being down.
  1. Finish "Connect Twilio" first (the alerts will come as texts from Twilio).
  2. Ask Claude to build the text sender for alerts: `ALERTS_TRANSPORT=sms`, sending each alert as a
     text from a number of the platform's own (never a firm's shifts line) to `ALERTS_TO_E164`.
     (Not built tonight: it would call Twilio. The test command, `npm run -s ops:test-alert`, is
     built and prints the alert today.)
     The web would then need the sender's secrets too (for the bad-signature alert): better, have
     the web hand that alert to the worker so only the worker holds them.
  3. Buy one more UK number in Twilio for the platform (Phone Numbers → Buy a number, with SMS).
  4. On the server, add to `.env` (Claude will give the exact names): `ALERTS_TRANSPORT=sms`, your
     own mobile as `ALERTS_TO_E164=+447...`, and the new number. Then `sudo systemctl start
     shiftdesk-deploy` to restart with them.
  5. On the server: `docker compose exec worker npm run -s ops:test-alert`. You should get a text
     starting "ShiftDesk alert: a test alert" within a minute. If not: `docker compose logs worker
     --since 5m | grep "ops alert"`.
  6. Then tick the task. The worker must be running (from the first deploy since P2.5).
- Onboarding follow-ups (Phase 9 onboarding checklist task):
  - Owner commands on the server need a long `docker compose run … web node --import tsx scripts/…`
    line (docs/runbooks.md "Onboarding a pilot firm"): not tried yet. A small wrapper script on the
    server (`/opt/shiftdesk/owner <command> …`), or an `owner` compose service with exactly the
    variables owner commands need, would make it one short line.
  - Office screens for what the owner commands do today: adding office users (turning access off
    and on, changing roles and logging out on every device are on the office team page since
    Phase 10), the firm's settings (the office settings screen, with the same read-back checks).
  - Access, left from Phase 10 task 6 (audit L80 and its reviews):
    - ~~A worker's lost phone~~: built in Phase 10 task 7 ("Log out on every device" on the
      office's worker page, which also turns off the phone's notifications).
    - **Left from Phase 10 task 7's reviews** (each narrow, or needing an outside step):
      - A firm-change notice (a cancelled or moved shift) to a worker who isn't active still has
        the portal link in it. A version without the link is a new WhatsApp template, which Meta
        must approve: add it when the templates are submitted ("Connect Twilio").
      - Offers still waiting when a worker is made inactive or blocked from the site stay open
        until their wave times out (taking one is refused by the rules); expire them then.
      - The shift page's "Check" and a refused move show the rules' worker-facing words ("This
        site isn't available to you. Contact the office.") to the office.
      - Nothing escalates a "Bookings to check" item nobody answers as the shift gets close (it
        still counts as filled): mark it urgent inside the urgent window, or email the office.
      - An offer or a reminder already being sent in the milliseconds the office makes someone
        inactive may still go (those claims don't wait on the office's lock). Today shows the
        booking either way.
    - ~~For Phase 10 task 9, from task 8's review~~: done in task 9 (a site change on the sheet is
      logged per worker with notice; a sheet re-time into the past is refused as "started").
    - ~~**A flaky test (found in Phase 10 task 9's verify; failed again in task 11's: fix it soon):** `sheets.jobs.test.ts` "queues one
      sync for each firm that is due" asserts a second tick in the same minute queues nothing.~~
      Done 2026-10-06 (CI fix after Phase 11 task 1): the singleton key holds the tick's own
      minute and the slot is pg-boss's largest, so the minute alone decides; a new test pins it
      (once within a minute, again in the next).
    - **Same fault as the sheets tick, in the shift reminders (found 2026-10-06, not failing
      today):** `runShiftReminderTick` (`src/lib/reminders/send.ts`) de-duplicates on a constant
      key `shift-reminders` with a 240 s slot of the database's clock, while its own 5-minute slot
      is only in the idempotencyKey. Two ticks either side of a slot edge can both queue. Fix it
      the same way as `sheets-sync` (the key holding the slot, pg-boss's largest slot).
    - **"A claim with no outcome means the run stopped" in other senders (found 2026-10-06 by the
      CI-flake review, not verified by a test):** the credential scan had a race where a second,
      overlapping run took the first's in-flight claim for a stopped one and logged it as sent,
      unconfirmed, losing the real outcome (fixed: one scan per firm at a time). The same pattern
      may exist where a retry can overlap a live run: `src/lib/auth/send-login-code.ts` (the
      `made` branch, `auth.otp_sent` unconfirmed), `src/lib/auth/send-portal-link.ts`
      (`auth.link_sent` unconfirmed), `src/lib/offers/waves.ts` (`logUnconfirmedOffers`) and
      `src/lib/offers/office-offer.ts`. Check each with a two-at-once test.
    - **Deploy note for the credential scan (2026-10-06):** each firm's scan now holds a
      write-free transaction (its lock) open for the length of the scan. Don't set the database's
      `idle_in_transaction_session_timeout` below the longest scan; add this to
      `docs/runbooks.md` when the host is chosen.
    - **The office blocking a whole worker** (not just from a site): today only a rota sheet or
      file sets "blocked"; the office can unblock, make inactive, or block from a site. Add
      "Block" to the worker's page if a firm asks (Phase 10 task 7 built the rest).
    - **An admin's own other devices:** an admin can't log themselves out elsewhere (only another
      admin, or you with `firm:office-user --sign-out`). Add "Log out my other devices".
    - **An office action already under way when access is turned off** can finish just after it
      (its check of the person is a plain read, milliseconds before). Holding the person's row
      (FOR SHARE) in `officeUserMay` and `officeCanPlace` would make them take turns.
    - **A worker's mobile changing at the moment they use a login link** can deadlock (the mobile
      change locks the worker row, the login holds its link). Postgres stops one, nothing is
      half-done, and the sheet sync tries again next time; the command-line import reports the
      row. Changing the order would let a link sent to the old mobile live on, so it's left as it
      is.
  - `firm:settings` covers the checklist's settings only; add the rest of `firms.settings`
    (credential allowance, rest hours, weekly cap, pay digest times) when a firm asks.
  - The agreement, privacy notice, staff briefing and dry run aren't recorded anywhere: `firm:check`
    says "confirm yourself". A firm-level checklist table would let the office tick them.
  - `firm:settings` could explain more: wave size and minutes are unused under first come first
    served; `urgent_window_hours=0` means no shift is ever urgent (no offer waves); quiet hours with
    start equal to end means none. And two already-broken fair-rotation values can't be fixed in one
    run (each step must leave the set readable).
- Ops alerts follow-ups (Phase 8 alerts task):
  - Count Twilio's delivery receipts (undelivered, failed) in the send failure rate once the
    delivery-status webhook exists (today only sends Twilio refused count).
  - Bad webhook signatures are counted per web process in memory: fine with one web container; with
    several, each counts its own (a spike split across them alerts later).
  - The weekly digest of job stats (docs/api-and-jobs.md "Errors and observability") isn't built.
  - A job that failed isn't re-run by itself: a small owner command to list and retry failed jobs
    would help (today: the logs, then fix and re-trigger by hand).
  - The worker itself down or stuck: four of the five checks run in it, and nothing checks it. Let
    `/api/health` (or a second path for the uptime monitor) say how long since the last
    `ops-alerts-tick` finished (the web can't read pgboss today: a narrow owner-run function).
  - A queue backlog (jobs waiting long past their start time) isn't alerted.
  - Send failure codes are the app's (`errorCode()` keeps string codes only); Twilio's are numbers,
    so today they'd read as the exception's name. Keep Twilio's number when the sender is built.
- **Connect monitoring** (the Phase 8 "Backups on, restore tested; £50 billing alert; uptime check;
  error alerts to you" task is blocked on it: a host and an uptime service). After "Connect
  hosting": the host's £50 billing alert, then docs/runbooks.md "Monitoring and alerts (once)" (the
  host's own resource alerts, a free uptime check on `/api/health` with its phone app) and a first
  "Restore drill (monthly)" with the host's backups (Phase 12 task 12X.1 rewrites both for any
  host; the Lightsail-only `deploy/alarms.sh` and `deploy/restore-drill.sh` go). Then tick the
  task. The app's own error alerts (failing jobs and syncs) are the alerts task.
- **Connect the deploy** (the Phase 8 "Docker Compose (web, worker, caddy); GitHub Actions deploy"
  task is blocked on it: the server from "Connect hosting", and the deploy workflow only runs on
  `main`). Everything is written: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`,
  `deploy/deploy.sh` with its systemd timer, `deploy/env.example`, `.github/workflows/deploy.yml`,
  and a CI job that builds the image on every push (check the "docker" job is green in GitHub's
  Actions tab before merging: `next build` has never run inside Docker yet). Follow
  docs/runbooks.md "Deploy" ("The first time", 6 steps), then tick the task. **Before that:**
  (1) since P2.5 the worker runs from the first deploy with no text sender
  (`MESSAGING_TRANSPORT=` empty: none), and it needs the email settings to start, so **"Connect an
  email provider (SMTP)" comes before the first deploy**: without them the worker fails its
  settings check, `up --wait` fails, and every `deploy.sh` run reports the app unhealthy (the web
  app still serves); (2) merging
  `build/overnight` into `main` is yours to do (the overnight rules never touch `main`), and it's
  what first builds the image; (3) **the database's TLS is on** (Phase 10 task 17): the three
  database addresses in `deploy/env.example` end with `sslmode=verify-full` and a CA file, which
  after Phase 12 task 12X.1 is the host's own at `/app/db-ca.pem` (no longer Amazon's RDS
  bundle), and the app refuses a production database address without them (Postgres in Compose
  over a Unix socket needs neither). **Dylan to check** on the first `./deploy.sh --now`: the
  migration step connects (a certificate error: tell Claude, and don't remove the ending); (4) **a stable server-action key** (Phase 10 task
  12, audit L92): an action's id is salted with a key Next makes afresh for each build, so a My
  shifts copy kept on a phone before a deploy can't "Cancel this shift" until it's reloaded with
  signal (Log out is a plain route now and always works). Make a key once (`openssl rand -base64
  32`), add it as a GitHub Actions secret, and pass it to `next build` in the Docker build as
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (a build secret, never a build argument, so it isn't in the
  image's history). Later: pin `actions/checkout` to a commit SHA and the Node base image to a
  digest.
- **Connect hosting** (the Phase 8 "Server: a UK or EU Docker host + managed Postgres 16" task is
  blocked on it: a hosting account and money; AWS was ruled out on 2026-10-06, ADR-021, Deploy 9).
  **You:** pick a UK or EU host that runs Docker (Ubuntu 24.04, 2 CPUs and 4 GB, a static IP, only
  ports 80 and 443 open, SSH by key only or the provider's own console) and its managed Postgres 16
  in the same region (private network, nightly backups and point-in-time restore on); check the
  monthly prices before you buy (Checks 2); put the database's CA certificate at
  `/opt/shiftdesk/secrets/db-ca.pem`; add the two DNS A records and the £50 billing alert.
  **Claude:** the host's own notes in docs/runbooks.md "Set up the server (once)" (Phase 12 task
  12X.1 writes the general steps; `deploy/cloud-init.sh` sets the server up on hosts that take
  cloud-init), then "Connect the deploy". If the host has no managed Postgres: Postgres in Compose
  over a Unix socket (no TLS needed; backups and restores become ours): Claude then adds the compose
  service (without the CA mount), its nightly `pg_dump` as `postgres` with a copy off the server,
  and the exact restore and drill commands in docs/runbooks.md (12X.1 wrote the principle only),
  and makes Gate B treat that database as live (`src/lib/db/where.ts` counts any database on the
  same machine as development's, so Gate B would be off; the demo server relies on that, ADR-025;
  the browser tests' production builds need an exemption too).
  Then tick the server task.
  **For the deploy task:** the server pulls new images itself (`deploy/deploy.sh` every 2 minutes,
  decided in Phase 8), so nothing needs to SSH in; and the server reboots itself at 02:30 UTC when
  an update needs it, so every compose service needs `restart: unless-stopped`.
- **Connect Twilio** (the Phase 4 "WhatsApp utility templates via Twilio…" task is blocked on it:
  an account, a UK number, approved templates and money). **Not needed now** (Dylan, 2026-10-19:
  no WhatsApp or Twilio; texts go through the firm's own text system: Phase 15). Kept for its
  steps that still apply to any text provider (the sending number, opt-outs, deleting the
  provider's copies):
  **Who does what:** steps marked **You** are yours (an account, a console, a phone, a decision).
  Steps marked **Claude** are code still to write after yours: the real sender for this service
  doesn't exist yet (the app has only a console or fake one), so each is a build round with its own
  tests, verify and audit, not a switch to flip. Tell Claude when your steps are done.
  1. **You:** create the Twilio account and a UK number; set up the WhatsApp sender (Meta business
     verification).
  2. **You:** submit the templates: see "Submit the WhatsApp templates" below (the pack is ready).
  3. **Claude:** write the Twilio transport next to the console one (`src/lib/messaging/`): WhatsApp by content
     id and variables, SMS by body; `MESSAGING_TRANSPORT=twilio` (production refuses `console`).
     Throw `ChannelRefusedError` only for Twilio's "not a WhatsApp number" style errors (so offer
     waves fall back to SMS only then); every other error is a failed send (logged, not retried on
     another channel). An urgent offer by text now uses the doc's short SMS copy (standard text
     characters only: usually 2 texts, not 3). Reminders still go by text in full (their dashes
     make a dearer kind of text, about 3). Credential messages always go by WhatsApp, whatever the
     worker chose (see the credential-scan item): workers who chose text get no expiry warnings
     until they move onto the shared sender.
  4. **Claude:** the status webhook (`POST /api/webhooks/twilio/status`): signature check, the `messages`
     table with `provider_message_id` (golden rule 3), then the 60-second "not delivered → SMS"
     fallback job.
  5. **You** (after Claude's step 3): STOP replies to SMS mark the channel opted out. (Built in Phase 7 short of Twilio, and the
     Phase 7 "STOP handling" task is blocked on this.) On each firm's number (Phone Numbers →
     Manage → Active numbers → the number → Messaging configuration), set "A message comes in" to
     `https://<APP_BASE_DOMAIN>/api/webhooks/twilio/sms` (HTTP POST). Check whether Twilio's own
     opt-out handling is on for UK numbers (Messaging → Services → the service → Opt-out
     management): if it is, keep its keyword list the same as ours in `src/lib/inbound/opt-out.ts`.
     To check there: (a) Twilio sends `OptOutType` (which stops us sending a second confirmation)
     only with its Advanced Opt-Out, I believe; with only its basic STOP handling, our STOP
     confirmation would be refused (logged as a failed reply) and START confirmed twice: then turn
     Advanced Opt-Out on, or its own replies off. (b) If the number is in a Messaging Service, the
     number's own webhook is only used when the service is set to "Defer to sender's webhook".
     Then text the line "STOP" from a worker's phone: you should get "You won't get texts from
     {firm} now…" (or Twilio's own reply), their profile says texts are off, and "START" turns them
     back on. Then tick the STOP task. **Dylan to decide:** drop CANCEL from Twilio's list and
     ours, so "cancel" alone by text means cancelling a shift, not stopping texts.
  6. **You:** test with 3 real phones (Android, iPhone, an older phone by SMS): the pre-pilot
     checklist.
  7. **You. One number per firm (the Phase 7 "shifts line" task is blocked on this):** buy a UK number
     for each firm in Twilio (Phone Numbers → Buy a number, with SMS, voice and WhatsApp), register
     it as a WhatsApp sender for the firm (Messaging → Senders → WhatsApp senders), and point its
     webhooks at `/api/webhooks/twilio/...` (next tasks). Then set it in the app:
     `npm run firm:line -- --firm acme --number "+44 7700 900123"` (it should say "The shifts line
     for acme is now +447700900123."). Every WhatsApp and text for that firm then carries it as
     `from`: the Twilio sender sends from `message.from`. Then tick the shifts line task.
  8. **You, a decision:** a firm with no line yet: send from a shared ShiftDesk number, or no
     WhatsApp/text until its line is live (today the app builds the message with no `from`).
  9. **You. Incoming WhatsApps:** in each WhatsApp sender's settings, set "When a message comes in" to
     `https://<APP_BASE_DOMAIN>/api/webhooks/twilio/whatsapp` (HTTP POST), and put the account's
     auth token (Account → API keys & tokens) in the web app's environment as `TWILIO_AUTH_TOKEN`
     (never in the repo). Send the line a WhatsApp saying "shifts": you should get the open shifts
     link back within seconds. Then from a phone that isn't on file: you should get "Thanks for your
     message. We don't recognise this number…", and the office's admins and resourcers an email;
     the message shows on Today. Then tick the "Unknown number" task too.
  10. **You (Claude first builds the "SMS fallback for login links" named at the end). Incoming
     calls (the Phase 7 "Call-to-text" task is blocked on this):** on each firm's
     number in Twilio (Phone Numbers → Manage → Active numbers → the number → Voice configuration),
     set "A call comes in" to Webhook, `https://<APP_BASE_DOMAIN>/api/webhooks/twilio/voice`, HTTP
     POST, with the same `TWILIO_AUTH_TOKEN` as step 9.
     **The fallback** (the Phase 8 "Twilio fallback" task is blocked on this): on your computer run
     `npm run -s firm:call-fallback -- --name "Acme Events" --phone "<the manager's mobile>"`; it
     prints one line starting `<?xml`: copy that whole line. In Twilio: TwiML Bins → Create new,
     name it "acme-fallback", paste the line, save; then on the number choose "TwiML Bin" → that bin
     for "Primary handler fails". If the app doesn't answer, the caller hears why and is put through
     to the manager (architecture.md, Call-to-text step 4). One bin per firm; when a firm's manager
     (or their number) changes, run the command again and update the bin. **To check it**, at a
     quiet time and after telling the manager their phone will ring: set the number's "A call comes
     in" webhook to `https://example.invalid/` (it can never answer), then ring the line from a
     phone that isn't the manager's (theirs would be busy). You should hear "Sorry, our system isn't
     answering right now. Putting you through to Acme Events." and the manager's phone rings; let it
     ring out once too (their voicemail usually answers), then you hear "If nobody answered, please
     call again in a few minutes. Goodbye." Twilio may log an error notice (11200) for the test:
     expected. **Then set the webhook back** exactly: Webhook,
     `https://<APP_BASE_DOMAIN>/api/webhooks/twilio/voice`, HTTP POST; ring once more and you should
     hear "Thanks for calling Acme Events…" (if not, every call is going to the manager). Then tick
     the Twilio fallback task. Voicemail transcription is Twilio's own: charged per minute on
     top of the call (check the current price) and English only. Then ring the line from
     a worker's phone: you should hear "Thanks for calling {firm}. We've just sent a link…", get
     the login link by WhatsApp within seconds, and after the tone leave a message: within a minute
     or two the worker gets "Thanks for your voicemail. The office will see it…" (the
     `voicemail_received` template, submitted with the others in step 2) and the request
     shows under Requests. Ring from a phone that isn't on file: the same message, no link, and a
     voicemail shows on Today. The link only goes by WhatsApp today: build the parked "SMS
     fallback for login links" (Phase 4/7) first, so a worker without WhatsApp gets it by text.
     Then tick the Call-to-text task.
     **Claude, before going live:** Twilio keeps each voicemail's recording and transcription in the
     account until deleted, but compliance.md says call audio isn't stored by default. Build a
     job that deletes the Recording (by its RecordingSid) once the transcription is stored, with
     the Twilio transport; or turn on Twilio's own automatic deletion if the account has it.
     **Dylan to decide:** Twilio's transcription is basic (names and places often come out wrong).
     A better transcription service is a later option (not AWS: ADR-021); the request always keeps the
     text Twilio gave, and the office can ring back.
  11. **You, then Claude. Real sample requests:** once any of steps 5, 9 or 10 is live, capture one real request to
     each webhook (a WhatsApp, a text, a call, a transcription), change the token and any real
     numbers, and add them to `tests/integration/twilio.contract.test.ts` as fixed samples, so the
     tests also run on Twilio's own bytes.
  Also: validate `quiet_hours` on the settings screen (Phase 5); and decide what a wave held past
  the shift's start should do (today it stops as "started" at the end of the quiet hours, and
  only the escalation tells the office).
- **Dylan to confirm:** notifications go by WhatsApp (or text) *and* push, not push instead. The
  docs' "push → WhatsApp → SMS" order could mean "push only, when the phone has it" to save the
  WhatsApp fee (about 2p a message), but a push can't confirm it was seen. Worth revisiting for
  reminders once pilots show how many workers turn push on.
- Today view follow-ups (Phase 5):
  - **Dylan to confirm:** payroll doesn't see Today (worker names, cancellations and gaps aren't
    payroll's job); they keep the plain dashboard until their pay queries screen (Phase 6).
  - **Dylan to confirm:** "Mark as filled" means "we filled it another way": the shift's status
    becomes `filled` with places free, and offers stop. It records who did it and when, but not
    how it was filled (events refuse free text). Add a short choice ("agency", "someone rang in")
    if firms want it in the notice report.
  - Today doesn't refresh itself: the resourcer reloads the page. Consider a gentle refresh every
    minute or two.
  - The requests line has no link until the requests queue is built (the next Phase 5 tasks).
  - "Offer to someone" offers one worker per click (the docs' `offerTo(shiftId, workerIds)` said
    several). Add "offer to these 3" if resourcers ask.
  - The urgent section runs one small query per urgent shift: fine at pilot size.
  - A CSV re-import that changes a closed shift recalculates its status and can reopen it, logged
    only as `shift.changed` (no `shift.reopened`). Decide with the Phase 5 CSV screen whether
    closed shifts stay closed.
  - A second "Send offer" before the job runs (or while one is held for quiet hours) queues a
    second job and logs a second `offer.office_queued`; nothing is sent twice. A firm-scoped
    pg-boss singleton key would stop the extra records.
  - The e2e Today test sends a real office offer in the shared e2e database (one demo worker gets
    one offer that day). Harmless today; watch for it if an e2e test ever counts offers.
  - Google Sheet sync errors, clashes and bad rows on Today (from the Sheets items above): not in
    this task's wording; do with the Phase 5 settings or action log tasks.
  - Offers restarted by "Open it again" skip workers whose earlier offers "Mark as filled" turned
    into "filled elsewhere" (their links still work, but they get no new message). Decide whether
    reopening should offer it to them again.
  - **Dylan to confirm** (copy): the office's SMS offer now ends " - {firm} Shift Team" (golden
    rule 8; the doc's line had no sign-off), which makes the demo text 163 characters: 2 texts,
    against the doc's "keep under 160".
- Shift screens follow-ups (Phase 5):
  - **Dylan to confirm:** new shifts are open at once (no draft step); a booked shift's date, times
    or site change only through "Move, shorten or cancel" (built in Phase 5, with notice), and its
    role never; the web import takes files up to 1 MB (the terminal import 5 MB).
  - The web import runs the whole file in one transaction (holding its shifts' locks until it
    ends). Fine at 1 MB; for bigger files, a background job.
  - The worker picker lists active people with the role (no search). Add a search box if firms
    have hundreds of casuals.
  - The shift list shows 4 weeks at a time with no filters (site, role, status): add them if
    resourcers ask.
  - Editing records the changed field names, and the old and new times when they change (events
    refuse free text).
  - Booked workers aren't told when the instructions change: do it with the move task's notices.
  - No upper limit on how far ahead a shift can be created; raising the places on an urgent shift
    that had filled doesn't restart its offers ("Mark urgent" again does).
- Firm-initiated changes follow-ups (Phase 5):
  - **Dylan to confirm:** the reason list ("The event's times or place changed", "The event was
    cancelled", "The client needs fewer staff", "Weather or safety", "Another reason"); "Another
    reason" carries no detail (events refuse free text).
  - **Dylan to confirm:** a move is refused while anyone booked fails a check the office can't
    override at the new time (a credential, their role, a clash): the office cancels them first,
    with notice. Anyone failing only an overridable check (rest, weekly hours, a day off) stays
    booked and is listed. Should a move ask each worker to confirm instead?
  - **Dylan to confirm:** how the office records a worker's own cancellation when they ring or
    message in. For now there's no such option: an office cancellation is always the firm's (the
    firm's reason, notice logged, the worker told). Option: a "They asked to cancel" reason that
    records it as theirs (`cancelled_worker`) and sends them the usual cancellation confirmation
    (`cancellation_ack`), so they can see it was recorded and object if it wasn't them.
  - **Dylan to confirm:** a change notice is urgent (sent at night if the firm lets urgent
    through) when the shift starts within the firm's urgent window; otherwise it waits for the
    morning.
  - Role changes for a booked shift are still refused (cancel and rebook).
  - The Sheets sync's moves, curtailments and cancellations don't queue notices yet (the parked
    "Workers aren't told when an office edit in the sheet…"): reuse `queueFirmChangeNotice()`.
  - Compensation for short-notice changes: Stage 2 (docs/compliance.md), from these events.
  - **Dylan to confirm:** "The client needs fewer staff" on one booking still reopens the place
    (and, close to the start, offer waves start for it). Lower the places instead for that reason?
  - Decided in Phase 10 task 8 (audit M6, M25): notice hours for a move or shortening count from
    the earlier of the old and new start, office editor and Sheets sync alike, so a move to an
    earlier time records the warning the worker really had and the notice report flags it. Events
    from before then counted from the old start (their old and new starts are logged, so the
    report could be recomputed if a firm needs it).
  - A move doesn't re-schedule the office's escalation email (still due at the old start minus X
    hours) or re-check urgency; workers whose offers expired aren't offered it again by later
    waves; open time-change or swap requests on a cancelled or moved shift stay open; a notice
    left "sending" by a crash isn't shown to the office; the message says "New time:" even when
    only the site changed (a template variant would fix it); a notice whose send failed still
    counts as what the worker was last told when the next change is described; firm-change
    events log the reason's words, not its code (log the code too, so the notice report groups
    reliably if the wording changes).
  - Other office client buttons (edit shift, create, import, offer, quick actions) can be clicked
    before the page is hydrated and then do nothing: give them `useHydrated()` like the assign,
    move and cancel buttons.
- Pay query follow-ups (Phase 6):
  - **Dylan to confirm:** the form sits behind the pay code; it offers shifts from the last 8
    weeks, or any day in the last 90; details are required only for "Something else".
  - Nobody in the office sees a query yet: payroll's grouped digest and "resolved → worker told"
    are the next Phase 6 tasks.
  - A query about a pay line (a week in the pay list) rather than a shift or day: add a "Which pay
    line?" choice if payroll finds weeks easier to match than days.
  - Shifts the firm cancelled aren't in the "Which shift?" list, though they may matter for pay
    from 2027; for now the worker picks "A day not in the list".
  - Asking the same question again keeps the first message only ("payroll has your first
    message"); add "add to an open query" if workers need to.
  - A partial unique index for one open query per worker, day, shift and issue (a database
    backstop), once other code (the digest, imports) writes pay queries too.
  - **Dylan to confirm:** how long pay queries are kept (docs/compliance.md has no period for
    them); the details are free text and may hold personal data despite "Don't include bank
    details."
- Pilot metrics follow-ups (Phase 5):
  - **Dylan to confirm the definitions:** portal actions = workers taking or cancelling shifts,
    days off, notification settings and opening the pay page (not logins; requests are for the
    office, counted apart); portal adoption = active workers who have *ever* logged in; refill
    time = a worker's cancellation to the next booking on that shift within 7 days; "answered
    straight away" = portal actions against portal actions plus requests (instant WhatsApp
    replies join it in Phase 7); the page's default is the 7 complete days to yesterday.
  - Refill time pairs each cancellation with the next booking on the shift, so two cancellations
    and one booking count twice, and a booking into a place that was already open counts too.
    Pair each booking with one cancellation if the numbers look off.
  - Log who pressed "Update the figures now" (`metrics.recomputed`), if wanted.
  - "Messages in" uses the office's weekly tally until inbound WhatsApp (Phase 7) is counted by
    the app; the rollup could add those then.
  - The nightly rollup recomputes 7 days: a fact older than that (a no-show marked two weeks
    late) isn't counted. Widen it, or recompute a chosen range from the page, if needed.
  - A CSV of the table for the week-4 report (the page is printable meanwhile).
- Notice report follow-ups (Phase 5):
  - **Dylan to confirm:** the short-notice threshold is read from the firm's settings (48 hours
    unless set); there's no screen to change it yet. Changing a firm's settings in the app needs
    the app to update the `firms` table (a new grant and row policy on the tenancy root), best
    done with an office settings screen, which no phase lists yet. Add one (threshold, urgent
    window, quiet hours, waves, sign-off)?
  - **Dylan to confirm:** payroll doesn't see the report (admins and resourcers do); it may want
    it once compensation is calculated (Stage 2).
  - Done in Phase 10 task 20: the demo seed's short-notice firm cancellation (Northline), shown in
    the notice report (`tests/integration/seed.test.ts`, `tests/e2e/walkthrough.spec.ts` step 36).
  - The shift column shows the shift as it is now; for a booking or cancellation made before a
    later move, the notice hours (recorded at the time) are right but the start shown is the new
    one. Record the start in those events too if the 2027 rules need it.
  - Offers logged before this task have no notice recorded (dev data only): the report counts
    them from the current start and says so.
  - Log each CSV download (`report.exported` {from, to, kind, rows}): personal data leaving the
    system. Not required by golden rule 5, but useful evidence.
- Action log follow-ups (Phase 5):
  - **Dylan to confirm:** payroll doesn't see the action log (admins and resourcers do), and
    resourcers see that a worker's pay record was added or changed (never an amount).
  - ~~The office's override reason in the append-only log~~ (Phase 10 task 13: on the booking now;
    the log says one was given; see "Dylan to confirm" above).
  - Worker list edge: past 2,000 workers the chosen one may not be in the list (the filter still
    applies; the list shows "Everyone"). The search box fixes it.
  - Worker and shift filters read `data ->> 'workerId'` / `'shiftId'` over the chosen days: fine
    at pilot size; add expression indexes (or `worker_id` / `shift_id` columns on events) before
    a firm with tens of thousands of events a week.
  - "Stayed logged in (session renewed)" lines are frequent under Logins; hide them unless asked
    for, if resourcers find them noisy.
  - A worker search box instead of the long "Worker" list, once firms have hundreds of staff.
  - Export: the notice and cancellation report (next task) has the CSV; the full log has none.
- Answering requests follow-ups (Phase 5):
  - **Dylan to confirm:** a note is required to decline and optional to approve.
  - **Dylan to confirm:** approving doesn't change anything else: the office moves the shift,
    or cancels and rebooks for a swap, on the shift's page. Apply an approved time change or swap
    automatically where it's safe (a one-person shift; a named colleague the rules allow)?
  - Requests about a shift that was cancelled, or has started, stay waiting: mark them
    `auto_resolved` ("Sorted") when the booking is cancelled or the shift ends.
  - Workers can't make "availability" or "question" requests yet (inbound messages, Phase 7;
    days off are on the profile). The queue already handles them.
  - The office's note goes into the WhatsApp template as a variable: check at submission that
    Meta accepts a free-text variable in a utility template (the fixed words "The office says:"
    help its words-to-variables check).
  - **Dylan to confirm:** "Your request (review, ref …) is approved." can read as "you're booked",
    and an approved time change as "the times changed", though neither is done until the office
    acts. Reword `request_update` per kind (e.g. "approved: the office will update the shift"),
    and something better than "approved/declined" for a question?
  - A 500-character note is about 9 text messages (the dash makes it Unicode). Lower the limit,
    or accept the cost.
  - The action log (next task) needs words for `request.approved` / `request.declined` and the
    `request.update_*` events.
- Marking who worked follow-ups (Phase 5):
  - **Dylan to confirm:** a worker isn't messaged when marked as didn't attend (they see "Marked
    as not attended" in their past shifts). Tell them, so they can say if it's wrong?
  - **Dylan to confirm:** nothing is marked automatically. Mark bookings nobody marked as worked
    some days after the end, or leave them for the office?
  - **Dylan to confirm:** should no-shows count against a worker in fair rotation (offers go to
    others first)? Code would decide from the counts, never a model. Today it's the reverse: fair
    rotation ranks by confirmed and completed hours this week, so a no-show lowers their hours and
    moves them up the queue.
  - Show each worker's no-show count (last 90 days) on their office record and in "Assign
    someone"; the pilot metrics task counts no-shows per week.
  - The demo seed has no past shifts: add last week's event with bookings to mark (also for the
    notice report and metrics demos).
  - Pilot metrics: count no-shows from the bookings' current status, not from `shift.no_show`
    events (a correction logs both).
  - A worker marked as not attended mid-shift still sees it as "On now" with no sign of the mark;
    show "Marked as not attended" on that card too.
  - "Cancel {name}'s booking" on the shift page: its confirmation ("…They'll be told.") goes when
    the page refreshes and the booking moves to "Cancelled" (the Cancelled line stays). Keep the
    confirmation like "Mark the rest as worked" does.
  - Edge cases: (since Phase 10 task 9 the Sheets sync never re-times or cancels a started shift:
    the office sees the sheet's change on Today instead); the profile's booked days count only
    `confirmed` bookings, so a day marked as worked loses its "booked" flag on the unavailable-days
    list.
- **Submit the WhatsApp templates** (**not needed now**: Dylan, 2026-10-19, no WhatsApp; the words
  still matter as the texts' words) (the Phase 4 "All copy … templates submitted to Meta" task is
  blocked on it: needs the Twilio account and WhatsApp sender from "Connect Twilio", step 1). The
  pack is `src/lib/messaging/whatsapp-templates.ts`: 20 templates (13 messages, plus 6 "no site"
  variants and a "no note" one), each
  with its category, language (English UK), body with `{{1}}`-style variables and sample values. A
  test proves the code sends exactly these words.
  All steps here are **You**, except step 4's map, which **Claude** wires into the Twilio sender.
  1. In the Twilio Console, open Messaging → Content Template Builder → Create new.
  2. For each template in the pack: type its `name` as the template name, choose the **Text**
     content type (every template is plain text with variables; `login_code` may have to be the
     WhatsApp **Authentication** type instead, see below), paste its `body`, set the language to English (UK), and give each `{{n}}` the sample value
     from `example`, in the `variables` order. Submit it for WhatsApp approval as "Utility".
  3. Wait for Meta's answer (usually minutes to a day). If one is refused or re-categorised, change
     the wording in `docs/messaging-templates.md`, the template function and the pack together
     (the test fails until all three agree), then submit again.
  4. Record each approved template's content id (starts `HX`) for the Twilio transport: a
     name → id map in the worker's environment or config, not the repo.
  Open questions to check at submission: Meta may refuse a body that ends with a variable (every
  template ends with the sign-off `{{n}}`); if so, add a full stop after it in all three places.
  Expect `login_code` to need Meta's "authentication" category (Meta usually requires it for
  one-time codes: fixed wording, no sign-off). `shift_urgent_no_site` has 6 variables in about 12
  fixed words and may be refused as too many variables for its length: if so, add words.
  **Dylan to confirm** (copy):
  - the urgent offer's SMS version now ends with the sign-off after a plain hyphen ("… {link} -
    Acme Events Shift Team"). Golden rule 8 needs a sign-off, and the doc's SMS copy had none. It
    usually makes 2 texts. Or drop the leading "{firm}" to save characters;
  - "{day}" instead of "today" in that SMS, and no "at" before the site ("needed Acme Demo Arena
    on Sat 7 Nov"), as the doc's line had it;
  - only the urgent offer has a short SMS version. Write SMS versions for the reminders and
    credential messages, so a text costs as little as possible?
  Also parked: nothing limits a text's length when it's sent (long firm or site names make 2-3
  texts): decide what to shorten first. The pack is kept in step with the code by a hand-kept list
  in the test; tagging each template function by channel would make a missing WhatsApp template
  fail by itself.
- **Connect the real web push** (the Phase 4 web push task is blocked on it: a secret key and real
  phones; no account or money). Most of Claude's steps were built in 13.3: the sender (`web-push`,
  `PUSH_TRANSPORT=webpush`, 404/410 forget the phone, an address that isn't a push service's in a
  browser's own form is never contacted), the worker's settings in the compose file, the rate limit
  on `POST /api/push/subscribe`, and the compliance and privacy wording. The last of Claude's, each
  push sent with no transaction open, was built in 14.1, and the worker now takes
  `PUSH_TRANSPORT=webpush` in production. The rest is yours, on the server. The worker sends the
  pushes; since P2.5 it runs in production from the first deploy (docs/runbooks.md), so do these
  any time after "Connect the deploy":
  1. **You:** on the server, in the app's folder, type
     `docker compose run --rm --no-deps web node_modules/.bin/web-push generate-vapid-keys`. (It
     uses the copy of web-push inside the app's image, the version the app was tested with.) It
     prints a "Public Key" and a "Private Key" (two long lines of letters and numbers). Never put
     the private one in the repo or send it to anyone.
  2. **You:** in production's `.env` (beside `deploy/docker-compose.yml`), set
     `VAPID_PUBLIC_KEY=` the public key, `VAPID_PRIVATE_KEY=` the private key,
     `VAPID_SUBJECT=mailto:` your email address, and `PUSH_TRANSPORT=webpush`. Then restart:
     `docker compose up -d`. If a key is missing or mistyped, or the two keys aren't a pair, the
     worker refuses to start and its log (`docker compose logs worker`) names the setting.
  3. (Built: the service worker re-saves a renewed subscription, `pushsubscriptionchange`.)
  4. **You:** test on a real Android phone and an iPhone (added to the home screen first): log in as
     a casual, Profile → "Turn on notifications", allow them; then have the office offer that
     casual a shift ("Offer to someone" on the Dashboard). You should see "Shift available" on the
     phone, even when it's locked. Nothing arrives? `docker compose logs worker | grep push` shows
     "push not delivered" with the push service's host and a code (an `http_403` means the keys in
     `.env` don't match the ones the phone subscribed with: turn notifications off and on again).
     "push not tried" with a code means the worker couldn't read the phones from the database at
     that moment.
  Also: push the office's escalation alert, and the push-first-then-WhatsApp order (the `notify`
  task).
- A job that stops between its push and its record (14.1 guardrails review, small): the message
  and the push went, and the retry logs it unconfirmed, without the provider's message id (as before
  14.1). With real pushes that window is up to 5 seconds longer per message. It matters once
  Twilio's delivery reports are connected (they match on that id): record first and push after, or
  keep the id in the claim. With "Connect Twilio".
- An error's name goes into the log unmasked (14.3 guardrails review, small): `redactError`
  (`src/lib/log/mask.ts`) masks an error's message but not its `name`, so an error whose name holds
  a phone number or an address would log it (`tests/integration/inbound.last-try.test.ts` sets one
  on purpose, with a made-up number). `maskText(err.name)` would close it; its tests with it.
- Identical shifts in the shifts line's reply (seen on 2026-10-19, making the boss walkthrough):
  "Any shifts this weekend?" listed three Arena steward shifts with the same site and times as
  three lines (three separate shifts in the seed). Grouping them ("Steward · Acme Demo Arena · Sat
  24 Oct 12:00–18:30 (3 places)") would read better and leave room for more; the casual app's Open
  shifts shows them as separate cards too. Small; copy and `src/lib/inbound/personal-reply.ts`.
- ~~Pushes inside the record's transaction~~ **Done in 14.1**: each sender reads the phones in a
  short transaction of its own, pushes with none open, then records the outcome
  (`pushToWorker()`, `recordPushes()`). Was (13.3, 2026-10-16; **before web push is switched on**):
  every sender pushes after its message has gone, inside the short transaction that records it
  (`pushToWorker(tx, …)`, 7 callers: offer waves, the office's offer, reminders, the firm's change
  notices, booked notices, request updates, pay query updates). A worker's phones are pushed at
  once and each push is cut off at 5 seconds, so a slow push service holds that transaction's
  database connection 5 seconds at most per message; across a wave that adds up, on the worker's
  shared pool of 10. To close it: read the phones in the record's transaction, push with none
  open, then forget gone ones and log the count in a second short one (13.3 guardrails review).
- **Connect the Anthropic API** (the Phase 6 "Group queries by likely cause … Haiku summarises"
  task is blocked on it: an Anthropic account and money; Bedrock was ruled out on 2026-10-06,
  ADR-021). The grouping is built; only the AI's one-line summary per group waits (the app writes
  its own line meanwhile). Phase 12 task 12X.3 built the client (`src/lib/ai/anthropic.ts`, off
  unless `AI_TRANSPORT=anthropic`, a 5-second timeout with an `AbortSignal`, no retries, the call
  logged without the prompt), wired it into the digest and the shifts-line reply job, and gives
  the settings to the worker only (`deploy/docker-compose.yml`).
  **Who does what:** steps marked **You** are yours (an account, a console, a decision). Steps
  marked **Claude** are code or docs to write after yours. Tell Claude when your steps are done.
  1. **You:** in the Anthropic Console, create an API key in a workspace with a monthly spend
     limit; accept the commercial terms and the data processing agreement; ask whether zero data
     retention is available for the model used; check where requests are processed and the UK
     transfer terms (Legal 2). Put `ANTHROPIC_API_KEY` and `AI_TRANSPORT=anthropic` in the
     server's `.env` (never in the repo).
  2. **Claude:** docs/compliance.md and docs/privacy-notice.md: Anthropic as a sub-processor (AI disclosure; the notice's "runs in
     the EU" wording changes); the pay summary sees only a group's facts (count, issue, week,
     site, rate), no names or workers' words; the sorter sees the worker's own message and may
     only return a label.
  3. **Claude:** the payroll page's "AI summary" line only appears once that page also calls
     `summariseGroups` (`src/lib/office/pay-query-groups.ts`): today it never does, so the line
     never shows.
  Then tick the grouping task after a real summary passes the checks. The same client serves the
  shifts line's classifier (`classify_message`, `src/lib/ai/classify-message.ts`): check a few real
  unclear messages get the right label, and (with "Connect Twilio" step 9 done too, so real
  WhatsApps arrive and replies go) tick the Phase 7 "Inbound WhatsApp" task.
  Also, with the real client (from the pay.grouping tests review):
  - after the first timeout or "unavailable" in a digest, stop asking for the remaining groups
    (an AI that hangs costs up to 10 × 5 seconds while the queries wait);
  - count fallbacks (timeout / error / failed check) in the log or in `pay_digest.sent`'s data,
    never the model's text, so an AI that always fails gets noticed (since 12X.3 each call logs
    why it stopped; an answer that fails the check isn't counted yet);
  - the same for the shifts line, before AI is switched on (12X.3 review): a hung API adds 5
    seconds to each unclear message, up to 51 calls (about 4 minutes) in one job's catch-up, so
    skip AI for a while after a few failures in a row, with a test using a hanging fake AI.
- Pay query grouping follow-ups (Phase 6):
  - **Dylan to confirm the grouping rules:** wrong rate = the week + the rate the worker's pay
    line for the day was paid at; hours missing = the week + the site; paid late = the week;
    something else = the week. Payroll may prefer others (a pay date for late pay, say). A worker
    with a day and a night pay line that week keys on both rates ("1250+1500"), so lands apart
    from colleagues on one rate: use the lowest, or the shift's own rate, if that splits groups.
  - For the digest: decide whether a query's key freezes once it's in a digest (today
    `regroupPayQueries()` re-keys in-digest queries too, so one could move out of a group payroll
    was emailed about).
  - Before connecting the Anthropic API: the AI line's number check accepts any number in the facts (so a
    wrong count equal to the week's day number would pass); the heading always shows the app's
    own facts line, so check again when the AI line is first shown to payroll.
  - `tests/integration/pay.grouping.test.ts` (the Phase 6 tests task) now covers stable keys on
    the real database and the digest's fallback for every kind of AI failure, beside the unit tests
    (`tests/unit/pay.group-keys.test.ts`, `tests/unit/ai.pay-summary.test.ts`). Our side already
    stops waiting after 5 seconds a group (`AI_SUMMARY_TIMEOUT_MS`), whatever the client does.
  - Regrouping runs when asked (`regroupPayQueries()`); the digest now runs it first, so a pay
    line imported after a query moves it to the right group (done in the digest task).
  - Payroll sorting a group and telling its workers: built in the "Worker sees status updates"
    task.
- **Connect an email provider (SMTP)** (every office email goes through the console transport until
  then: login links by email, escalations, the credential list, the payroll digest with its
  attached list, and Phase 12's strike evidence; SES was ruled out on 2026-10-06, ADR-021). Phase 12
  task 12X.2 builds the sender (`src/lib/messaging/smtp.ts`, `EMAIL_TRANSPORT=smtp`).
  **Who does what:** steps marked **You** are yours. Tell Claude when your steps are done.
  1. **You:** pick a provider (Deploy 8): any service with SMTP credentials and a verified sending
     domain, in a UK or EU region if it offers one. Verify the sending domain with the SPF, DKIM
     and DMARC records it shows, and wait for "Verified".
  2. **You:** put `EMAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
     `SMTP_FROM` in the server's `.env` (never in the repo). **Claude** passes them to the worker
     only.
  3. **Claude:** docs/compliance.md and docs/privacy-notice.md: the provider as a sub-processor
     (its DPA: Legal 2).
  4. **You:** test: send yourself a payroll digest from `/office/pay-queries` and open the list in
     Excel.
  Later, if needed: bounces and complaints through the provider's own webhook (each provider's
  differs), so the digest and the credential list skip an address that doesn't work (they already
  skip one that isn't valid, and count it).
- Payroll digest follow-ups (Phase 6 digest task):
  - **Dylan to confirm:** the default time (09:00, Monday to Friday, firm-local); only payroll gets
    it (admins only when the firm has no payroll user); each digest has the new queries, with a
    count of earlier ones still waiting; names and what workers wrote go only in the attached list
    (the list goes to payroll's mailbox: check the pilot firm is happy with that).
  - The settings screen: the digest's time and days (`firms.settings.pay_digest`, read by
    `src/lib/pay/digest-schedule.ts`). Until then it's set in the database.
  - A digest that stops after claiming its queries (before sending, or between sending and
    recording the outcome) leaves them `in_digest`, logged, and payroll's page says after 30
    minutes that it "may not have gone". There's no button to send those again yet: with the email
    provider's delivery notifications, a check could.
  - With a real email provider: record its message ids in `pay_digest.sent` (ids only), and decide
    whether a send that timed out (it might have been delivered) should still put the queries
    back for the next digest (today it does: a query listed twice beats one never seen).
  - Each weekday a firm with nothing new gets a "No pay digest: no new pay queries." line in the
    action log (it's what stops a second digest that day). Hide it from the log's list if it's
    noisy.
  - The key-freeze question above still stands: a query in a digest can still move group when
    regrouped; the digest's list shows the group it was sent in.
- Shifts line replies follow-ups (Phase 7 "Inbound WhatsApp" task, blocked on the Anthropic API):
  - Delete messages after 90 days with the retention job (Phase 8; docs/compliance.md). (Done:
    `retention-purge`.)
  - When the office answers a WhatsApp's `general` request, the worker's notice says "Your request
    (question, ref …) is approved.": for a question, "answered" would read better (the
    request-update wording).
  - Texts (SMS) to the line are a later task (answering unknown numbers is built: the next task).
- Unknown number follow-ups (Phase 7 "Unknown number → polite reply + office alert" task):
  - From Today, let the office add the number to a worker (a new phone) or mark it as nobody: today
    it can only read it. A "sorted" state would also stop it showing for 7 days.
  - **Dylan to confirm:** a former worker's message gets no reply (the office decides); a stranger
    gets the doc's "reply with your full name"; one reply and one email per number per 24 hours.
  - A flood from many different numbers means one email per number to every admin and resourcer:
    cap it per firm (say 5 an hour) and send one combined email after that.
  - **Dylan to confirm the keywords:** "work" and "available" still give the open shifts link
    (unless the message also says "can't", "not", "sick", "late"…); "shift" alone doesn't. Real
    messages from the pilot will show which words mislead.
  - Limit replies per worker (a few an hour): a WhatsApp Business away message, or another bot,
    would otherwise answer every reply for ever, at Twilio's price.
  - Many "ok"/"thanks" messages each make an office request: fold a worker's repeats into their
    open one.
  - Tell the office when a reply couldn't be sent (today it's only in the log).
  - Retention: the worker's words are also in the office request's note (`requests.payload.note`),
    not only in `messages`: delete both after 90 days. (Done: `retention-purge`.)
  - A webhook address override for a dev tunnel (ngrok) when testing with a real phone; and if
    firms ever get their own Twilio subaccounts, one auth token per subaccount.
  - (Fixed in Phase 10 task 4: Twilio ids are no longer mistaken for phone numbers by the log
    masker; see `src/lib/log/mask.ts`.)
- Shifts line follow-ups (Phase 7 "One business WhatsApp number per firm" task, blocked):
  - Show the line to workers (the home page, and `/help` when it's built: "Message the shifts line:
    {number} (WhatsApp or text)" with a WhatsApp link) once incoming messages are answered (the
    next task): until then a message to it would go unanswered.
  - The owner-only "set a firm's line" code is in `scripts/shifts-line-owner.ts`, not
    `src/lib/db/admin/`, because invariant 5 (`scripts/invariants.sh`) allows only `withFirm` and
    the seed to set the firm inside `src/`, and I may not edit the invariants. If Dylan would rather
    it sat beside the seed, add it to that invariant's allowlist.
  - Log setting or clearing a line as an event (`firm.shifts_line_set` / `_cleared`, without the
    number), with its words in the action log.
  - Make `from` a required (nullable) key on WhatsApp and text messages in the transport's schema,
    so the type checker holds direct senders too (today a pattern test does), and add behaviour
    tests for the offer wave and the login link carrying it.
  - CLAUDE.md's conventions say app code reaches the database only through `withFirm()` and
    `resolveFirmBySlug()`; `resolveFirmByLine()` is now the second look-up allowed before a firm is
    known (ADR-018). Dylan may want to add it to that line.
- Pay query status follow-ups (Phase 6 "Worker sees status updates" task):
  - ~~**Dylan to confirm:** payroll's note in the message itself?~~ **Done in 13.4** (Dylan,
    2026-10-16: the note stays behind the pay code): `pay_query_update` is now "Payroll has
    answered your pay query (ref {ref}). See their answer on your pay page: {link} — {firm} Shift
    Team" (variables ref, link, signOff: submit this wording to Meta), and payroll's own words say
    the note is on the pay page.
  - Sorting one query on its own when a group holds a few different cases (today payroll sorts the
    whole group it sees, with one note).
  - A sorted query leaves payroll's page: a "Sorted recently" list (with who sorted it and the note)
    would let payroll check what was said.
  - Make the `pay_queries_resolution` check work both ways (a sorted query must name who, when and
    the note). Every sort sets all three today; a few older test fixtures mark queries sorted
    directly without them, so they'd change with it (a new migration).
  - Sorting queues one notice job per query inside the transaction; a 2,000-query group means 2,000
    inserts there. Queue them in one batch if that's ever slow.
  - Phase 7 (the WhatsApp line): a worker's free-text message about pay must be sorted into "pay"
    and answered only with the link to raise a pay query, never with an answer. Add the new AI
    purpose to `AI_PURPOSES` and to `tests/unit/ai.boundary.test.ts` on purpose, and keep its
    output away from pay answers.
- Offer waves follow-ups (from the Phase 4 offer waves task):
  - Tell workers whose offer was "filled elsewhere" (the `offer-expire` job and `shift_filled`),
    and let a worker decline an offer (a "No thanks" on the shift page).
  - The outbox: send after commit, so a crash between sending and committing can't send an offer
    twice (with Twilio, Phase 7).
  - Waves for open shifts that aren't urgent (the docs only start them for urgent gaps).
  - The Today view (Phase 5): wave status ("wave 2, 4 offered, 0 accepted") from `offers`, and
    "needs attention" from `shift.escalated`.
  - Escalation once per gap, not once per shift (a shift escalated, filled, then dropped again an
    hour before the start isn't escalated again); and escalate straight away when a wave finds
    nobody left.
  - Sheets shifts: only start waves when the sheet copy is fresh, so a tap doesn't get "We can't
    confirm this shift right now".
  - **Dylan to confirm:** under first come, first served, the offer goes to every eligible worker
    at once (as docs/api-and-jobs.md says), not "the best 3–5".
- Credential expiry messages go straight to the transport. Once Phase 4's `notify` job exists,
  send them through it (push first, per-firm quiet hours), and through the queue-then-send outbox
  when Twilio is connected, so a retried scan can't repeat a message.
- Credential expiry and existing bookings: a worker already booked on a shift after their
  credential's expiry date isn't flagged anywhere yet. Add "booked after expiry" to the office's
  weekly list or the Today screen (Phase 5). (New bookings are safe: `bookShift()` re-runs the
  rules, so a credential that expires before the shift ends is refused.)
- Office renewal screen (Phase 5): recording a new expiry date sets status `valid` again (the
  warning columns reset themselves by date) and logs `credential.renewed` with old and new dates.
- `credential-scan-tick` skips a missed 08:00 (pg-boss `missed: skip`); the next day's run catches
  up. If workers are often down at 08:00, use `missed: "once"` plus a quiet-hours check in the job.
- Profile follow-ups (from the Phase 3 profile task):
  - Phase 4's sender must honour `workers.notify_channel` (WhatsApp or SMS) and
    `workers.offer_alerts` (false means no open-shift offers). Login links and codes are always sent.
    ~~The credential expiry reminders (`src/lib/credentials/scan.ts`) send WhatsApp today whatever
    the setting.~~ **Done in 13.5**: they go through `sendToWorker` (the casual's channel, the
    WhatsApp-to-text fallback, never a text after STOP).
    Offer waves should skip workers who marked the shift's day unavailable. The rules already refuse
    them, so this only saves sending a pointless offer.
  - Office (Phase 5): see a worker's unavailable days on their record and in the booking picker,
    and change contact details there (the profile says "To change these, ask the office").
  - Credential photos or uploads from the profile ("send the new details to the office" is manual
    for now).
- Blocked-shift follow-ups (from the Phase 3 blocked-shift task):
  - Office queue (Phase 5): show `review` requests with the codes, the reasons the worker saw and
    their note. Re-run the rules, then place the worker (with an override and reason where the rules
    allow one) or fix the data (renewed licence, role), and approve or decline the review.
  - Tell the worker the outcome of a review (Phase 4 notifications).
  - Similar shifts on a filled shift's page (docs/screens.md first listed this as the "Just filled"
    screen; for now the page says "This shift has been filled." with "See open shifts").
  - A database backstop for "one waiting request per worker, shift and kind" (a partial unique
    index over every request kind). The code holds it today by locking the shift row.
  - The demo seed has no shifts yet, so the blocked-shift e2e test adds its own shift
    (`tests/e2e/db.ts`). Once the demo seed has shifts, it can use a seeded one.
- Offline and home-screen follow-ups (from the Phase 3 service-worker task):
  - **Dylan, on a real iPhone:** add the portal to the home screen, open it from there, and check
    you're still logged in. Then log out inside the home-screen app and log in again: the WhatsApp
    link opens Safari. If the app stays logged out, workers need a typed code login (a code in
    the login message, typed into the app). Until then the hint can be removed from
    `src/app/page.tsx` and `src/app/profile/page.tsx`.
  - App icons for the home screen, in the firm's branding (with custom domains and branding).
  - An "Install" button on Android (Chrome's install prompt).
  - Web push (Phase 4) through the same service worker.
  - Privacy notice: say the offline copy of My shifts is stored on the phone (strictly necessary
    storage) and what deletes it. (Done: docs/privacy-notice.md, "On your phone".)
  - The hint's wording "Open your browser's Share menu" is meant to fit Safari's and Chrome's
    layouts; check it on the real iPhone too.
- Plain-language follow-ups (from the Phase 3 empty and error states task):
  - Phase 4 must make "We'll message you when something matches" (Open shifts, nothing open)
    true: offers to workers with open-shift messages on.
  - Office screens (Phase 5): their own empty and error states, and add them to
    `tests/unit/copy.plain-language.test.ts` (with office words allowed, e.g. "credential").
  - After a session runs out, the login page could say "Your login has run out. Log in again."
    (today it shows the normal login page).
- GDPR follow-ups (Phase 8 "GDPR: worker data export (JSON + CSV) and delete; firm data export;
  retention purge job" task):
  - **Dylan to decide (before the pilot's data is a year old):** the 12-month purge of the action
    log, requests and offers (docs/compliance.md). Events are append-only: the app can't delete them
    and no policy lets anyone (the database's owner could only by changing that on purpose:
    switching off forced row security or adding a policy), and `tests/integration/rls.every-table.test.ts` pins "no UPDATE or
    DELETE policy on events". Deleting year-old evidence needs that changed on purpose (an
    owner-only DELETE policy limited to rows over the retention age, run by the purge), or a longer
    period once the 2027 rules say how long notice records must be kept.
  - **Dylan to confirm:** a deletion keeps the worker's pay lines (hours, rates, dates, on the
    anonymous row) as payroll's evidence; their pay queries stay with the free text cleared.
  - **Dylan to confirm:** deletions are admins only (not resourcers), and are refused while the
    worker is booked on a shift that hasn't ended.
  - The firm export is built in memory: fine at pilot size; stream it table by table (or build it
    in a job and email a link) before a firm has millions of rows.
  - The worker CSV is one value per line (Section, Record, Field, Value): complete but long. A
    friendlier "one sheet per kind" file needs a zip or .xlsx library.
  - A firm-wide delete (the offboarding runbook's "delete data per agreement") has no script: an
    owner script that deletes a firm's rows in foreign-key order, with a dry run.
  - Login rate-limit rows are HMACs of numbers: erasure doesn't find the worker's (they go within a
    day anyway).
  - The worker detail page (docs/screens.md `/office/workers/[id]`) should link to the worker's
    data page once it exists.
  - After an erasure, the firm's rota sheet or staff file can add the person back as a new worker.
    The runbook says to remove them there too; nothing in the app can spot it (the number is gone).
  - **Dylan to confirm:** erasure deletes the worker's licence and card records. Security firms may
    have to keep screening and licence-check records after someone leaves (BS 7858, SIA approved
    contractor rules; UK GDPR allows keeping them). If so, keep the credential rows (type, number,
    expiry, who checked) on the anonymous row instead.
  - Race windows left (small): a shifts-line message arriving while an erasure commits can still be
    linked to the erased worker and answered (`src/lib/inbound/reply.ts` reads the worker outside
    the claim), and a portal request or pay query already in flight can land on the erased row.
    A shared `lockLiveWorker(tx, id)` (key share, status and mobile re-checked) before each insert
    that attaches to a worker would close them. Offers already re-check (`lockReachableWorkers`).
  - A request answer or pay-query answer queued for a worker who is then erased ends as "gone"
    without an event, so the office's Requests page keeps saying "… will be told." Add
    `request.update_skipped` / `pay_query.update_skipped` {reason: erased} (the office's shift
    change notices already log `shift.change_notice_skipped` {reason: erased}).
  - Before connecting Twilio: erasure can't reach Twilio's own message logs (the events hold
    `providerMessageId`s). Add a runbook step to delete a worker's messages at Twilio on erasure.
  - ~~`shifts.synced_holders` keeps an erased worker's sheet staff id~~ (Phase 10 task 13: removed
    on erasure from shifts that have ended; shifts still ahead keep it, because it decides the
    next sync's merge; and the next sync puts it back on any row the firm's sheet still names them
    on: the page and runbook say to remove them from the sheet).
  - Resourcers see the "Data requests and deletion" group in the action log (who asked for their
    data, who was deleted), though only admins can use the data page. Hide it from them if the firm
    minds.
  - **Dylan to confirm (Phase 10 task 13):** some typed text is never purged on a schedule: pay
    query details and payroll's notes, "Something else: …" cancellation notes, and the office's
    answer on a request (erasure clears each of these for the worker's own rows, never for a
    colleague's that names them). The data page and the privacy notice now say "aren't changed"
    rather than promising a schedule. Decide whether the nightly purge should clear them too (after
    `retention.request_note_days`, say).
  - **Dylan to confirm (Phase 10 task 13):** a hold (`retention.hold_until`) stops the nightly
    purge, but not an admin deleting a worker on request. Under UK GDPR a legal claim can be a
    reason to refuse a deletion (Art. 17(3)(e)); decide whether a hold should block deletions too
    (today the admin decides, and the runbook says to check with us first).
- **Dylan to decide: audit findings the overnight loop may not fix** (from
  `docs/audit-2026-09-30.md`, 2026-10-03). The loop is forbidden to edit `.claude/`,
  `scripts/verify.sh` and `scripts/invariants.sh`, so these wait for your OK:
  - L1–L6: loopholes in the safety net. The tick guard doesn't watch shell edits, a moved tick or
    an uppercase `[X]` gets through, the Stop hook only catches a few phrasings, the stamp is taken
    after the run, a tick doesn't need the browser tests, and the reviewers are read-only by
    instruction only. All 67 ticks so far were checked and none used these gaps.
  - L4, L61, L62, L65: require the browser tests for a tick, and widen `invariants.sh` (Playwright
    skips, `scripts/` in the withFirm check). (L16, L88: since Phase 10 task 20 the browser stage,
    `RUN_E2E=1`, includes a production build: the walkthrough runs against `next build`. A run
    without `RUN_E2E=1` still doesn't build: making `verify.sh` build every time is yours to
    decide.)
  - L9, L57: CI on GitHub hasn't been checked since Phase 0. Open the repo's Actions tab and check
    the latest `build/overnight` run has a green tick, or install `gh` so Claude can check.
  - L14: try the iPhone home-screen login on a real iPhone.
  - With "Connect an email provider (SMTP)": alert Dylan when office emails fail (an escalation email that
    fails is logged `shift.escalation_failed`, but no alert counts it yet).
  - With the accounts: L26 (payroll digest email) with "Connect an email provider (SMTP)", L27 (real Twilio
    sample payloads) and L34 (call-to-text by SMS) with "Connect Twilio", L35 with "Connect the real
    web push".
- **Walkthrough polish follow-ups (Phase 10 task 19):**
  - An alert to Dylan when a number or email keeps hitting the login limits (the audit's L49 asked
    for one; the daily cap is built, the alert isn't): count `auth.rate_limited` in the ops alerts.
  - An office "Send them a login link" button on a worker's page, so a worker locked out by the
    daily cap (10 links a day per number) can be helped without waiting for midnight.
  - A CSV re-import of an older file can put back a place the office took away with "The client
    needs fewer staff" (an import may raise a shift's places). Nobody is told; decide whether an
    import should skip a shift whose places the office lowered.
- /help privacy notice link: needs a per-firm privacy notice URL setting (Dylan decides; schema
  change). Until then `/help` tells workers to ask the office for a copy.
- UI follow-ups (Phase 11):
  - Tab titles for one shift (office and staff) and for My shifts: the shift page would load the
    shift twice, and `/` shares its file with the platform's home page.
  - The guides' "On this page" list could mark the section being read (needs JavaScript).
  - Shared class strings for the bordered answer rows (new request, pay query, notifications),
    the pay-code field, the answer boxes on the shift page and locked fields, in
    `src/app/ui/classes.ts`.
- Office v2 later items (Phase 12, 2026-10-06; `docs/office-v2.md` §5.1 "Parked" and §7).
  Deliberately left out of Phase 12; most need a database change, so each needs Dylan's OK. (The
  live cancellations feed and planner adapters that were here became Phase 12's planner API and
  webhooks, 12J.1 and 12J.2; what's left of them is under "Phase 12 cuts" below.)
  - Ask casuals to confirm they'll attend, and flag those who don't (code flags, a person acts;
    a confirmation timestamp).
  - Offer a shift to selected casuals only (a new table).
  - Pay status per shift for casuals (Worked → Approved → Paid) with `pay_cycles`; payroll's
    cut-off countdown and a "not ready for payroll" list.
  - A short-notice payments ledger for the Employment Rights Act, switched off until the 2027
    regulations exist.
  - A separate right-to-work checks table (in Phase 12 right to work stays a qualification type).
  - Recording a cancellation phoned in to the office as the casual's own, with strike handling
    (today and in Phase 12 it is always the firm's, with notice: Legal 7).
  - Strikes that wear off early after a run of good shifts.
  - A third-party SIA licence checker (there's no official SIA API; Phase 12 links the GOV.UK
    register on the office's approve form).
  - Self-hosted journey planning, and self-hosting postcodes.io, at volume.
  - A "bit further" stretch of the travel area for urgent shifts (Rules 14: none in Phase 12).
  - Typed notes on "Close without a reply" (a small table of their own: a database change).
    Phase 12 uses fixed codes, because typed text never goes in the log.
  - Strike entries (`strike.issued`, `strike.withdrawn`) stay in the action log after the strike
    row is deleted at 12 months, until the action log itself has a retention period (Data 2).
  - The mock-up's grouping of a daily series ("Every evening to 19 Oct"); Phase 12 shows one row
    per session.
  - Moving a session into its new day's or site's automatic event when its date or site changes
    (12B.1 keeps it in its first event, so a hidden session can't reappear without a switch).
  - An `event.created` log entry (§6.1 lists none; each session's `shift.created` is logged).
  - Renaming automatic events when their site is renamed.
  - An index on `shifts (firm_id, event_id)` if 12B.5's event page needs it at volume.
  - CSAS-specific wording in the rules' reasons (today a casual missing CSAS reads "Send it to the
    office to be checked", but only the firm's own scheme counts, §3.7).
  - Fair rotation's comparison group ignores credentials, so a session's place can be held for
    people who can't take it (a delay, never a wrong booking; true for the role's licences too).
  - Fair rotation's priority window counts from the session's creation or last cancellation, not
    from when it was shown to casuals again (12B.4), so a session shown after a while is open to
    everyone at once.
  - Offers already sent stay waiting while their session is hidden (12B.4 stops new ones; taking
    one is refused). Closing them on hiding, or saying so on the offer, if it confuses casuals.
  - A session's history (`src/lib/office/action-log.ts`) leaves out its event's `event.shown` /
    `event.hidden` entries (they're about the event): for 12B.5's event page, or a join there.
- **Phase 12 cuts (2026-10-06, Dylan: debloat).** Taken out of Phase 12 because Dylan didn't ask
  for them and the law doesn't require them ("it needs to be debloat not pro bloat"); any can come
  back as its own task if he asks. One line each:
  - The office menu's icon strip at middle widths and a saved collapse: a sidebar and a drawer are enough.
  - The top bar's search box and `/office/search`.
  - The speech bubble and the floating orange pills (enquiries, payroll's): the menu badges carry the counts.
  - A Theme choice in the account menu, a casual Appearance setting, the transition switch-off and press-scale effect.
  - Starred events, the "Starred events" menu group and personal pins (S1's `pinned`).
  - Event-wide notes for casuals (S1's `public_notes`): a session's meeting point, uniform and instructions cover them.
  - "Undo" after switching an event off: switching it back on is the undo.
  - The dashboard's "Sync with planner" button and freshness line: planners push by API; sheet errors show in Needs attention.
  - A separate Needs attention page (`/office/attention`) and payroll's version: it is a dashboard section now.
  - Pay calendar settings (`pay_calendar.*`), tax-week numbering and payroll's own pill: one rule (ISO week, paid the Friday after). The pay calendar came back (Dylan, 2026-10-26; built in P3.1); tax weeks and the pill stay cut.
  - The pay dashboard's "Pay questions on the shifts line" and "Imports" sections, and `pay_digest` as a `SETTING_KEYS` key.
  - An "Event" column and Pay rate, Post, Meeting point, Uniform, Requires and Postcode columns in rota sheets and imports ("not another sheet").
  - The sheet "Cancellations" column write-back and `planner.cancellation_written`: replaced by the `booking.cancelled` webhook.
  - The daily "changes for your planner" email and `planner.changes_email*`: replaced by webhooks and `GET /api/v1/cancellations`.
  - The Planner connection page and its read-only column mapping: Integrations replaces the page; `firm:sheet` shows the mapping.
  - Settings screens for strike hours, photo renewal, travel defaults and the enquiry reply target: the owner uses `firm:settings`.
  - A 15-minute grace period after booking: the office withdraws a mis-tap's strike.
  - The review flag for a session taken inside 48 hours (neither asked for nor required by law; the health and caring flags stay).
  - Notice counted from a casual's first shifts-line message (`toldAt`): needs live WhatsApp; the office can withdraw a strike.
  - A Needs attention alert at 3 live strikes: the strikes page sorts by live count.
  - `strike_issued` and `strike_withdrawn` messages and their send job: the cancel screen and Profile show strikes.
  - The strikes CSV, Withdrawn and Expired views, a review outcome note, and S4's account, outcome and notified columns.
  - Expected pay on office cancellations and in the notice report: until the 2027 Employment Rights Act rules exist.
  - The side-by-side cancellations list and record, the "Strikes issued" and "By casuals" views, the refill median, the "marked in your planner" count, and the reminders timeline in the PDF and evidence email.
  - Booking by reply number ("Reply 1 or 2", D6, Messages 28), on WhatsApp or by text: an auth change that needs live WhatsApp.
  - The enquiry review loop ("Right answer / Wrong answer", the weekly 5% sample, `enquiry.reviewed`).
  - Enquiry metrics (% answered, typical reply time, topics), the day, channel, topic and "check failed" filters, and text search.
  - The reply timer, `enquiries.reply_target_minutes` and the WhatsApp window countdown.
  - A rules version stamp in `enquiry.checks` (`src/lib/rules/version.ts`).
  - The SIA register check record (`credential.register_checked`) and "checked on the SIA register" for casuals: no official SIA API.
  - `photo_due` and `upload_rejected` messages: the in-app Needs updating card covers them.
  - S6's `due_on`, `issuer`, `warn_days`, `needs_evidence` and `register_check`, and the "Applied for, due {date}" status.
  - "Needed for N shifts near you", session-only types on Profile, and needs-updating's seven levels (four now).
  - A streamed zip of upload images: one download per image meanwhile.
  - "What {first name} can see now" on a casual's page, "Send reminders", and Casuals' counts row and Expiring and Photo due views.
  - The trip home, the public transport route and "Leave by" time, and `travel.check_in_buffer_minutes` (30 minutes, fixed).
  - Travel time as an offer-wave tie-breaker, and the office offer page's outside-area warning.
  - Travel and pay words in `shift_urgent` and `shift_offer` (and `_no_pay` versions), texts and pushes: the link opens the shift page.
  - A new "urgent" filter on Open (the existing day, site and role filters stay as built; `/urgent` is the urgent-only view).
  - API extras: sending casuals and qualifications (`PUT /casuals`), and booking or cancelling a named casual by API.
  - API extras: planners switching events and sessions on or off, or marking them urgent (`PATCH`).
  - API extras: a changes feed with a commit-safe cursor, an OpenAPI file, read-only keys, key expiry, IP allow-lists, OAuth, a sandbox.
  - API extras: an `ETag` and `If-Match` to stop an old PUT undoing a newer one: `docs/integrations.md` asks for one PUT at a time per ref and no automatic replays.
  - Webhook extras: several addresses per firm, choosing types per address, "Resend", turning a failing address off (automatically or by pausing) and catching up.
  - Integrations' "Recent deliveries" list: the webhook status line, "Send test event" and each record's "Your planner" line cover it.
  - Webhook types for a session filling, attendance (`booking.worked`, `booking.no_show`) and enquiries that need a person.
  - Ready-made connectors (Deputy, Planday, Connecteam, Rotaready) or a Zapier app: generic HTTP steps in Zapier, Make or n8n work meanwhile.
  - Retiring the Google Sheets plug once no firm uses it (it is frozen: no new columns or features).
  - SMTP bounce and complaint handling: it depends on the provider chosen (Deploy 8).
  - ADRs for D5 (ADR-022 covers the planner layer that replaced it), D7 and the theme cookie.
  - The enquiries research seed set (12 enquiries) and staged "AI-sorted" demo rows.

- `docs/business.md` "Usage costs": the monthly total (~£60–£110) isn't the sum of its rows (~£45–£120); fix the total or say it's a typical month (found by the 12X.1 fact-check, 2026-10-07).

- Office email's From name: `SMTP_FROM` is one bare address for every firm, so emails don't show "[Firm] Shift Team" as the sender's name (golden rule 8 still holds: no invented name). A per-firm display name when the email provider is connected (12X.2 review, 2026-10-07).
- Pay digest after "may have arrived": when every send fails, the digest puts its queries back to open, so a digest that may have arrived repeats them in the next one. 12X.2's `EmailMayHaveArrivedError` now tells the two apart if wanted (12X.2 review, 2026-10-07).

- Settings (12B.7), for Dylan: should a session already under way also stop a site's postcode
  changing? Today only sessions still to come do (the task's words); the guardrails review asked.
  Its casuals are already there, so nobody is moved. If yes: one line in
  `src/lib/office/settings-page.ts` (`starts_at` to `ends_at` in the count and the lock) and its
  test.

- Strikes (12C.1), "Tell us what happened": when the office answers that request, the casual gets
  the usual request update, "Your request (review, ref …) is approved/declined", which reads as if their
  account was accepted or rejected. A wording of its own ("The office has read what you told them about
  your cancellation") needs a new WhatsApp template (Meta's approval), so it waits for "Submit the
  WhatsApp templates". Until then the office can answer it with a note saying what they did.
- Strikes (12C.1): no per-firm switch to turn strikes off; every firm on ShiftDesk records them.
  Add one if a firm doesn't want them (`docs/dpia-strikes.md`).

- Security updates for Next.js, sharp and source-map-js: `npm audit` reports 3 high advisories in
  these (found 2026-10-09 during 12C.3; they were there before it: 12C.3 added only `pdf-lib`,
  `@pdf-lib/fontkit` and, for tests, `pdfjs-dist`). `npm audit fix` would change the Next.js
  version, which needs its own task: read the release notes, run `./scripts/verify.sh`, check the
  walkthrough.
- Downloads started from another site (12C.3 review, 2026-10-09): the cancellations CSV and PDF
  now refuse a download another site started (`src/lib/auth/own-pages.ts`), so nobody can be made
  to download, and be logged downloading, a file. The older downloads (`/office/data/export`,
  `/office/data/workers/[id]/export`, `/office/reports/notice/export`) check too since 12L.1.
- The production image holds the dev-only packages (`COPY --from=build /app /app` after `npm ci`),
  now including `pdfjs-dist` and its native canvas files (tests only). The worker and migrations run
  TypeScript through `tsx`, so pruning needs care: its own task (12C.3 review, 2026-10-09).
- Strikes (12C.5 review, 2026-10-09): when a strike is withdrawn after its evidence email went, the
  strikes team still holds the evidence. Today the record says "The evidence email had already gone
  to the strikes team: let them know it's withdrawn." An automatic "withdrawn" email (same queue
  and claim as the evidence email, its own template) would close the loop: its own task.
- **Connect postcodes.io and TravelTime** (12G.1 built the postcode look-up; 12G.2 adds travel
  times). Until then `TRAVEL_PROVIDER=fake`: made-up points for the `ZZ` postcodes only, so for a
  real postcode Settings saves it without a location and a casual's "Where you work" says postcode
  look-ups aren't switched on. postcodes.io needs no
  account or key; TravelTime needs an account and a production quote (Checks 14).
  **Who does what:** steps marked **You** are yours; steps marked **Claude** come after.
  1. **You:** sign `docs/dpia-travel.md` (with its balancing test) and decide postcodes.io and
     TravelTime are acceptable sub-processors (Legal 2); for TravelTime, get the production quote
     and accept its data processing agreement.
  2. **Claude:** check the hand-written postcodes.io answers (`tests/fixtures/postcodes-io/`)
     against one live answer for a public postcode (a council office's, never a casual's), and the
     hand-written TravelTime answers (`tests/fixtures/traveltime/`, 12G.2) against one live
     time-filter search between two public places; correct the parsers if the shapes differ.
     Nothing personal is sent. Also check against TravelTime's documented limits: the most
     locations one time-filter search takes (the job sends up to 2,000 start points plus the site:
     `SEARCH_MAX_ORIGINS`, `src/lib/travel/provider.ts`; lower it if the limit is smaller), and how
     it answers for a start point it can't place (neither reachable nor unreachable: today the job
     saves nothing for it, so every run asks again; if TravelTime does that for real, save it as
     "not known" for the day instead).
  3. **You:** put `TRAVEL_PROVIDER=traveltime` (and 12G.2's TravelTime keys) in the server's
     `.env`; then save one site's postcode on Settings and check it says "Location found."
  Also: `scripts/invariants.sh` checks the test setups' pins for email, AI and Twilio but not yet
  `TRAVEL_PROVIDER` (pinned to `fake` in `tests/setup/env.ts` and `serverEnv()` since 12G.1).
  Adding it changes a protected file, so it's Dylan's call: two lines like the AI ones.
  Before `traveltime` is switched on (12G.1 review): limit look-ups per casual and per firm (say 10
  an hour per casual), so one person can't get the server's address throttled by postcodes.io.
  The same limit caps TravelTime use (12G.2 review): each new postcode costs a search per session
  group in the window; casuals' changes already share one run per firm every 5 minutes
  (`casualMoved()`), but nothing yet stops one casual changing theirs all day.
  If a worker job ever looks postcodes up (12G.2's job doesn't: it uses the saved points), build
  its geocoder from `workerEnv()`, not `appEnv()` (`src/lib/travel/server.ts`).
- Travel areas (12G.1 review): **Done in 13.4** (Dylan, 2026-10-16: yes) whether a firm switches the travel area on
  for itself (a per-firm `travel.enabled`, off by default, hiding "Where you work"), since the DPIA's
  Part 2 is per firm and `TRAVEL_PROVIDER` is per server. Today it shows for every firm (with the
  fake look-up, a real postcode is refused with "postcode look-ups aren't switched on"). Since
  12G.3, Open shifts and the urgent board also ask every casual with no area to "Add your home
  area": the same switch should hide that prompt where travel areas are off.
  - **Needs Dylan (13.4):** a firm that switches travel areas off keeps the home areas already
    saved (kept but not used: no filter, no search, not on the office's pages; the firm's data
    export still lists their districts). Should switching off
    delete them (data minimisation), or keep them so switching back on needs nothing from casuals?
    With "Where you work" hidden a casual has no button to remove theirs (the remove action itself
    still works), and the office can't remove one either (only "They've left" does). Today: kept.
    The owner's `firm:settings travel.enabled false` could delete them, or print how many are kept;
    or Profile could offer "Remove your saved home area" while they're off. If they're deleted on
    switch-off: a casual's save that checked the switch just before it changed can still land after
    the delete (the save reads the setting without a lock; the app role can't lock `firms`), so the
    owner's script and `saveMyTravel` would take one advisory lock (exclusive / shared) around it
    (13.4 guardrails review). Deploying 13.4 flips every firm but Acme to off with no data step: fine
    before Gate B (no real firm), but a firm that had saved areas goes straight to "kept, unused".
- Travel filter (12G.3 review): before TravelTime goes live (the "Connect" step), confirm that a
  start point it lists as unreachable means "over 90 minutes" (or no public transport in time), never
  "no timetable data": the filter treats it as out of reach, so a casual who only uses public
  transport would be left out of that session's waves. If TravelTime can mean "no data", save it as
  not known instead. Also: Home works out the "further" count and the travel lines for an urgent
  count it never shows (one more rules batch per Home load); skip them there if Home gets slow.
- Travel areas of leavers the office can't mark "They've left" (12G.1 review): that reason is only
  offered for an active casual, so one a sheet or file made inactive, or one blocked, keeps their
  area until erased. Either offer "They've left" for an inactive casual too (deleting the area,
  logged), or have the nightly retention job delete areas of casuals inactive for a set time.
  `docs/dpia-travel.md` "How long" names the gap.
- Strikes' log entries (12C.5 review): when the action log's purge is built (Data 2), it should
  delete a strike's `strike.*` entries when the strike's row goes (12 months), so a `strike.reviewed`
  entry can't hint at a health or caring reason for longer than the strike itself is kept
  (`docs/dpia-strikes.md`).
- Uploads (12F.2 review):
  - a foreign key tying a record's `evidence_upload_id` to an upload of the same casual
    (composite with `worker_id`); today `saveMyUpload()` sets both in one transaction;
  - recording CSAS twice for one casual, or for one who isn't active: refuse or warn;
  - a limit on how often a casual can upload (each send replaces her waiting one, so the queue
    can't grow, but nothing stops a hundred sends an hour);
  - which types get the GOV.UK register link (`isSiaType()`, a code list) as pack data;
  - while a renewal waits for the office, the scan still sends "expired" when the old one runs
    out, and still warns before; it could skip the warnings and say "we're checking it";
  - certificate images kept after their qualification ends: §5.5 says "then follow the firm's
    retention setting", which isn't defined yet. Today a superseded one stays until erasure.
- Enquiries (12D.1 review):
  - **Decided** (Dylan, 2026-10-16: keep them): resourcers read pay messages' words in Enquiries' Pay and All views
    (the spec gives Enquiries to admins and resourcers), though the pay area itself is admins and
    payroll only. Hide the words of pay messages from resourcers, or keep them?
  - Done in 12L.1: Enquiries reads the firm's `retention.message_days`, not a fixed 90 days.
  - A template reply to an unknown number (outside WhatsApp's window) says "Your request
    (question, ref …)" with the message's own reference, though they made no request: a wording
    of its own when the templates are submitted.
  - Standing demo messages for Enquiries (a keyword reply, a question waiting, an unknown number):
    with the demo seed (12I.1).
- Personal replies (12D.2 review):
  - **Decided** (Dylan, 2026-10-16: keep the minutes) (`docs/dpia-travel.md`): a personal reply's
    `enquiry.checks` entry keeps
    the casual's travel limit and the minutes to each session offered (never the postcode), for
    the office's "Inside travel area (20 min by car, limit 45 min)"; it stays as long as the
    action log. Decision 21 above says the travel area is "never in the action log": keep these
    minutes, or log only whether each session was inside the area?
  - **Dylan to confirm:** "Automatic reply. Send OFFICE to reach a person." is on every automatic
    reply, the STOP/START confirmations included (§5.7 item 3 says every instant reply); and a
    text lists each session's distance and both times, longer than §5.7's text example, to meet
    Phase 12's Done-when.
  - The booked line ("you're booked on …") and the cancel reply name booked shifts with no travel
    line (as §5.7 words them); the Done-when's "every shift … in shifts-line replies shows the
    distance" may want one there too.
  - Done in 12L.1: day words no longer read "I sat my test" or "c'mon" as days.
  - A cancel reply names the next booking, not the day she named ("cancel my Saturday shift"), as
    the spec says.
  - "+ N more" counts only the first 50 sessions she could take (the list's cap).
  - Done in 12L.1: the AI's other fallback reasons are tested end to end, with step 2's words.
- Dashboard (12E.1 review):
  - Needs attention lists a qualification on a booking that has **expired** or runs out before
    the session ends (as the task says); one the casual never had, or one that's suspended, isn't
    listed there (the casual's page shows both). §3.9's "including a failing sync" isn't there
    either (the action log has each failed sync).
  - The bell and each Needs attention list stop at 50 ("50+").
  - Done in 12L.1: the unknown-number alert email links Enquiries' "Need a person".
  - "Plus {n} requests made in the app today" on Enquiries' today list isn't checked in a browser
    (its words are unit-tested and the count is tested on the database).
  - Done in 12L.1: "Download CSV" on today's Cancellations exports today's only.
  - The bell runs about 8 small queries on every admin and resourcer page (twice on `/office`):
    cache it per request, or count in one query, if pages get slow. The dashboard's transactions
    could be marked read only, as a backstop.
- Planner API (12J.1 review):
  - **Dylan to confirm:** golden rule 3's new wording in CLAUDE.md (the planner API answers in the
    request, made idempotent by the planner's ref; ADR-022), and S11 as built (ADR-022 amends
    ADR-008, ADR-011 and ADR-012).
  - **Dylan to confirm:** the API's ten small choices, (a) to (j), listed in
    `docs/integrations.md` and the 12J.1 entry of `docs/overnight-log.md` (for example: a reason is
    needed for every API cancellation; a cancelling PUT applies nothing else; an empty string
    clears a text field; places default to 1).
  - A planner's cancellation reads "cancelled by the office" in the strike line and in the
    casual's notice: true for the firm, but it doesn't say "planner". A wording choice.
  - Done in 12L.1: the office guide says what a planner's session keeps in the office.
  - ~~The worker will need `INTEGRATIONS_SECRET` in `deploy/docker-compose.yml`~~ done in 12J.2
    (with `WEBHOOK_TRANSPORT`, `https` by default).
  - No index on `assignments (firm_id, cancelled_at, id)` for `GET /api/v1/cancellations`' pages:
    fine at pilot scale; a migration when a firm has many thousands of cancellations.
  - The Integrations page reads the action log to show each key's last change: fine at pilot
    scale; a summary column if it gets slow.
  - The app may update `shift_events.name` for any event, not just a planner's (a column-level
    grant can't see the row's source); only the API code renames today.
  - Done in 12L.1: a method an API address doesn't take gets the API's own 405 and `Allow`.
  - The planner receives rule codes when a move is refused (`rest`, `not_active`, …) with each
    casual's id: worth a line in a DPIA when the first firm connects a planner.
  - A key revoked while a long read is running finishes that read (reads don't hold the key);
    writes check the key inside their transaction.
  - The refused-key counter is per web process and in memory: with several web processes each
    counts its own 30 a minute; a restart clears it.
  - A PUT that only fills a site's empty postcode answers `unchanged` for the session, though
    the site changed (`site.changed` is logged): say "site updated" in the answer if planners
    find it confusing.
  - A started session's otherwise unchanged PUT that names its site with a postcode still runs the
    site check before the transaction (whether the session has started isn't known yet), so it
    can get 409 `site_postcode_differs` or 503 `lookup_failed` instead of 200 `unchanged` or 409
    `session_started` (re-review NOTE 1).
  - The kept-booking test checks "not active" through the roster function the PUT uses, not
    "blocked from the site" or the HTTP PUT itself; nothing pins the rota sheet's
    `honourKept: true` (re-review NOTE 2).
- Planner webhooks (12J.2 review, 2026-10-12):
  - **Needs the worker in production**, which waits for "Connect Twilio": until then webhooks are
    queued and not sent, and records say "Sending" (planners catch up with `GET /cancellations`).
  - `webhookStatus()` (the dashboard's item and the page's status) reads the action log by
    `action`, which no index covers: fine at pilot scale; a partial index or a summary column if
    it gets slow.
  - `staff_ref` is free-form: a firm using mobiles or NI numbers as staff refs would send them to
    its planner. Worth a line in the onboarding checklist.
  - The local seed (`db:seed`) rewrites `firms.settings` whole, which puts the signing version back
    to 0 on a dev database only; nothing in the app can lower it.
  - TEST-NET ranges and Teredo (`2001::/32`) aren't in the refused list (§5.3.3 doesn't list them;
    not routable from Docker). Add them if the host's network ever routes them.
  - An unset `INTEGRATIONS_SECRET` in the worker shows the firm "Your planner's webhook is failing"
    (code `not_configured`), though it's ours: its own words on the dashboard if it ever happens.
  - The console webhook transport prints whole bodies (names) in development, with no end line for
    the log scan to skip; production refuses it.
- Casual app Home (12H.1 audit, 2026-10-12):
  - Done in 12L.1: Home's urgent cards' chips (built with 12H.2) and the theme following the phone
    on Home are tested.
  - In a browser test, "no signal" (Playwright's offline switch) didn't reach the service worker's
    own request when opening a different page; the offline test reloads each page instead. A real
    phone with no signal fails both ways the same.
- Demo seed (12I.1, 2026-10-12): **decided** (Dylan, 2026-10-12, "Allow the seed"): the seed runs
  the shifts line's reply job on its three made-up messages, with `noAi` and a sender that sends
  nothing; `tests/unit/ai.boundary.test.ts` lists `src/lib/db/admin/seed-story-load.ts` with the reason.
- Shifts list and shift page (12H.2, 2026-10-12):
  - Done in 12L.1: the shifts line's replies leave an automatic event's name out, as the app does.
  - A session's extra that none of her roles needs shows "…: ask the office.", because the upload
    page and `saveMyUpload()` take only types her roles need. Widening them to a session's extras
    is Dylan's call.
  - The office can add a right to work check as a session extra; the rules enforce it and the
    casual sees it in "What it needs" (Rules 15 calls it a status only). Refuse it as an extra in
    the editor and the planner schema if that's the intent.
- Guides and docs (12I.3, 2026-10-12):
  - "Appropriate policy document template": the UK GDPR Article 9 condition firms rely on for
    "I'm unwell" (DPA 2018 Schedule 1 paragraph 1) needs each firm to have one
    (`docs/compliance.md` "Health reasons"). Write a template for the firm's pack before a pilot;
    a solicitor checks it with the DPA.
- Inbound messages (12L.1 guardrails review, 2026-10-15; **built in 13.2**): the shifts line's reply job has no
  last-try step. A message whose job throws before its claim (a bug, or the database failing on
  every retry) is never marked handled. The casual gets no reply, and it never reaches Need a
  person. Add a last try that marks it for a person and logs why, like the planner webhooks' last
  try (12J.2). Found when a day word crashed the reply (fixed in 12L.1).
- 13.5 guardrails review, small and left for later:
  - ~~The office log's "Logins" filter also holds the casuals' own limits~~ **Done in 14.2**: each
    limit reached is filed by its name (`LIMIT_TYPES`, `src/lib/office/log-types.ts`).
  - ~~A backstop for the higher per-address login limit~~ **Done in 14.2**: an ops alert when a firm
    sends more than 100 login links by WhatsApp and text in an hour, or 300 in a day (an alert, not
    a ceiling). Both are starting numbers: revisit them with a pilot firm's real mornings.
  - ~~The shifts reply's last resort sends the unsigned text~~ **Done in 14.3**: it's signed, with
    the text cut to leave the sign-off room.
  - ~~Automatic event names cut the site's name by code point~~ **Done in 14.3**: cut between whole
    characters (`cutChars`). Only the app builds these names now: migration 0035's `left()` ran
    once, over the demo data of the time.
  - ~~A warning caught up after a crash logs the worker's channel now~~ **Done in 14.3**: it logs no
    channel, since the claim doesn't keep the one it went by.
- ~~Text cuts that count UTF-16 units~~ **Done in 13.5**: one shared cut, `src/lib/text/cut.ts`
  (`cutChars` for the database's character count, `cutUnits` for UTF-16 limits), cutting only
  between whole characters; used at both webhooks, the voicemail, the AI's input, the Enquiries
  preview, the review reasons, the office note and the shifts reply's last resort. Was (12L.1
  guardrails round 3, 2026-10-15; small, nothing lost):
  the shifts line's webhooks (`src/lib/inbound/webhook.ts`, WhatsApp and SMS) and the voicemail
  transcript (`src/lib/inbound/voice.ts`) cut at 1,600 units, so an emoji across the cut can leave
  a "�" at the end of a message that was already cut (a text column stores half an emoji as
  U+FFFD; nothing fails). Fix with one shared cut that never leaves half an emoji, also used by
  `src/lib/ai/classify-message.ts`, with a test of an emoji at unit 1,600. The same for the
  Enquiries row's 139-character preview (display only) and `src/lib/portal/review.ts`'s 300-unit
  reasons (safe today: its only non-ASCII text ends long before the cut). Optional: show the date
  in the action log's sentence for today's cancellations CSV (it's logged, not shown).
- Security warnings (2026-10-16): GitHub's warnings were fixed by `next` 16.3.8, `sharp`
  0.35.5, `source-map-js` 1.2.2 and two `overrides` in `package.json` (`drizzle-kit`'s old
  `esbuild` to 0.25.12, `exceljs`'s `uuid` to 11.1.1). One is left: `braces` (a slowdown on deeply
  nested glob patterns), reached only through `eslint-config-next` → `@next/eslint-plugin-next` →
  `fast-glob` 3.3.1. No fixed `braces` exists (3.0.3 is the latest and is affected), and even
  `@next/eslint-plugin-next` 16.4.2 still pins `fast-glob` 3.3.1. It runs only in `npm run lint`,
  on our own patterns. Recheck when either releases a fix. ~~Related, not urgent: the image copies
  every dependency, development tools included.~~ **Done in 13.5**: the build prunes development
  dependencies after `next build` (`npm prune --omit=dev`), so the linter (and `braces` with it),
  the test runners and TypeScript's compiler aren't in the image (2.22 GB to 1.73 GB, measured on a
  local build); `tsx` is a dependency now (the worker and migrate run with it). `@playwright/test`
  stays: npm keeps it as `next`'s optional peer (`--omit=peer` doesn't remove it either); nothing
  loads it at run time.
- Travel estimates, a second audit (12G.2, 2026-10-15). 12G.2 was audited DONE on 2026-10-09. A
  later re-audit found three paths no test reached; 12L.1 tests all three. It also asked Dylan to accept (**accepted** 2026-10-16) that hand-written TravelTime answers
  (`tests/fixtures/traveltime/`) stand in for recorded ones until step 2 of "Connect postcodes.io
  and TravelTime" checks them against a live answer. The first audit took that step as covering
  it.
- Messages stranded (13.2 guardrails review, 2026-10-16; small, rare): the last try passes a
  failing message to a person, but three cases still leave one unhandled and out of Need a person: a
  worker killed in the middle of a message's last try (pg-boss counts a try when it's taken, so the
  supervisor fails it for good and the mark never runs); the mark failing too (the database
  unreachable for every try and the mark, or a STOP whose own claim keeps failing: the mark retries
  that claim); and messages whose jobs failed before 13.2. Each is a failed job, so the ops alert
  reports it. To close it: Need a person (and its badge) also counts an inbound message still
  unhandled some minutes after it arrived, or a sweep marks them; optionally, a STOP whose claim
  fails falls back to the office mark (a savepoint).
- **Needs Dylan:** an answer on the shifts line's last try (13.2 guardrails review, 2026-10-16). When
  a message is passed to a person after every try failed, the casual gets nothing until the office
  replies. Should the last try also send the fixed "the office will get back to you" reply (the
  same words as a question for the office, built by code, claim / send / record), so every message
  gets an answer (golden rule 11)? The cost: if what failed was the sending, it fails again.
- The shell-tick watch is after the fact (13.1 audit round 3, 2026-10-16; small, nothing lost):
  `plan-bash-check.sh` reports a task ticked from the shell once the command has run, and only then
  refuses `git commit` and `git push`. A single command that both ticks `PLAN.md` and commits
  (`sed -i … PLAN.md && git commit -am …`) gets its commit in before the report. The tick is still
  reported, the next commit or push is refused until it's undone, and the commit itself can be
  reverted. To close it: have `plan-bash-snapshot.sh` refuse, before it runs, a command that both
  writes `PLAN.md` and commits or pushes.
- The walkthrough page (`walkthrough-site/`, 2026-10-19) is built from a screenshot run that isn't
  in the repo (a Playwright tour on the walkthrough's own demo, then a page builder, both in
  Claude's scratch space). After the app changes, its screens go stale. To keep it fresh: add the
  tour and the builder under `scripts/`, run on demand (not in verify). Its run also showed two
  things worth knowing: a text from a number nobody has gets no reply (only a WhatsApp did; the
  office is emailed), and "When's my next shift?" has no keyword, so it goes to a person until
  AI sorting is on.
- Phase 18 (2026-10-21): the dashboard still loads the "Showing to casuals" event list, today's
  cancellation rows and today's enquiry rows (`src/lib/office/dashboard.ts`: `showing`,
  `cancellations`, `enquiries`), and `dashboard-copy.ts` still has the old four counts' words
  (`COUNTS`, `countLine`, `countNumber`; `cancelledByText` is used again since Phase 23, by the
  cancellations chart's rows). The redesigned dashboard shows only their counts (Sorted today), so
  these are three queries a page load for nothing, and copy nobody sees. `EnquiryItem`'s `reply` line (`src/app/office/enquiries/enquiry-row.tsx`) was the
  dashboard's too: nothing passes it now. To close it: drop the three loaders from `Dashboard`, the
  old words and that line, with the integration and unit tests that cover only them (the counts
  stay, and their tests).
- Phase 18: the walkthrough page (`walkthrough-site/`) shows the screens from before the redesign
  (see the line above: its tour isn't in the repo yet).
- Phase 18 (the auditor's note): older rows in `docs/screens.md` (the office menu's "Operations /
  Records / Configuration" groups, and the old Home, Open shifts and Events rows) still describe
  the screens before the redesign. Its "The redesign (Phase 18)" section says it wins where they
  differ, but a reader could be misled. To close it: rewrite those rows to match, and drop the
  "wins where they differ" note.
- Phase 23 (2026-10-23, the dashboard's charts): two loaders read a week or two of rows by a time
  with no index on it. The offers chart reads this week's offers by `sent_at` (the index is
  `(firm_id, worker_id, sent_at)`), and the cancellations chart reads 14 days of cancellations by
  `cancelled_at` (no index). That is fine at pilot sizes. To close it: add `offers (firm_id,
  sent_at)` and `assignments (firm_id, cancelled_at)` with `npm run db:generate`, and check the
  plans with `explain`.
- Phase 23: a hidden session's row in a chart's panel opens the session or its event. It has no
  "Show to casuals" button of its own; the switch is on Events & sessions and the session's page.
  To close it: if resourcers ask, add the same switch to the row (its server action exists).
- Phase 23: the demo's offers chart. The seed's "said yes" offers are Saturday's bookings made
  this week, and every booking is made 72 hours or more before the seed runs; an offer is never
  dated in Acme's quiet hours, so one for a booking made before 07:20 on Monday would fall on
  Sunday and is left out. So a seed run before about 07:20 on Thursday has none yet (a run on
  Monday before 07:00 has no offers at all), and the chart shows only waiting offers. Nothing in the seed
  "said no" either: the app can't record a "no" until the decline above ("No thanks" on the shift
  page) is built.
- Phase 23 (the review): the how-to guide names a "View sessions" button that the events board
  doesn't have ("Change or cancel a shift", to hide one session). Its menu words are keyed
  "Requests", so "Enquiries" gets no line under it. Both predate Phase 23. To close it: name the
  real control, re-key the line to "Enquiries", and re-pin `tests/unit/guides.test.ts`.
- Phase 23 (the review): two small things on pages round 3 restyled, both older than it. The erase
  form's red strip (its tick box) sits inside a red wash of the same colour, so it can't be seen.
  The "Their other strikes" summary on Strikes is under 44px tall on touch. To close it: give the
  strip its `urgent-line` edge or a white ground, and give the summary `min-h-11`.
- Phase 23 (the second review): on the licences chart, a dot's figures sit over it, and lanes are
  30px apart, so they can cover a close-dated dot in the lane above. Moving the pointer straight up
  keeps the lower dot's figures showing; a click there still reaches the upper dot, and Escape
  hides them. A row of bars has its figures beside it for this reason; for dots, beside would
  cover the next dots along the line. To close it: if it bothers anyone, try the figures under
  the line for a dot in the top lane, or a dot's figures at the chart's foot.
- Phase 23 (verify, 2026-10-24): in this cloud container, the browser tests' development server
  (`next dev`, Turbopack) outgrew the memory cap late in a run. Memory sat near 2.2 GB, then jumped
  to 10 to 12 GB within a minute while it compiled two voice webhook routes for the first time. On
  the first run the container killed it (the WhatsApp test then failed); on the second a test timed
  out. The routes and what they import are unchanged but for one date helper, so it is Turbopack's
  own behaviour; `experimental.turbopackMemoryEviction: "full"` didn't stop it (tried, then taken
  out). The container caps everything a shell starts at 14.3 GB while showing 16 GB. Phase 23's
  verify ran with `CI=1`, as GitHub's CI does: the browser tests on a production build, retries
  counted as failures. To close it: if `next dev` is wanted for the local run, try
  `turbopackFileSystemCacheForDev: false` for the e2e server, or warm every route first.
- P4.1's guardrails review (2026-10-26), not blocking: (1) a `lock_timeout` for the migrations
  (`runMigrations`, `src/lib/db/admin/migrate.ts`), so a deploy fails fast instead of waiting
  behind an open transaction, and its queued lock doesn't hold up every later write; (2) an index
  for `shifts (firm_id, site_id)`, the `shifts_site_fk` foreign key's (it has none: a site's
  sessions are read through it); (3) a test that every non-unique index on a firm's table leads
  with `firm_id` (today only unique keys are checked, `tests/integration/rls.every-table.test.ts`);
  (4) a partial `assignments_firm_id_cancelled_at_idx` (`where cancelled_at is not null`) if the
  table grows large: most rows are never cancelled.
- P4.2's guardrails review (2026-10-26), not blocking: (1) let only `src/worker` import
  `chooseDbProfile` (an ESLint `importNames` rule; today any code could switch a process's profile
  before its first query); (2) `tests/unit/db.limits.test.ts` counts pg-boss's pool as 5 by hand:
  read it from `src/worker/boss.ts` if that ever changes. Its claims-auditor's note: the firm
  export's and the retention purge's longer limits (`allowLonger`) have no test of their own (the
  scan's and the roll-up's do).
- P4.3's guardrails review (2026-10-26), not blocking: a chain has no last wave before the shift
  starts, and the job's payload allows waves up to 1,000 (`offerWavePayload`,
  `src/lib/offers/waves.ts`). With 1 per place (or a fair-rotation size of 1), 1 minute apart and
  over 1,000 eligible, queueing wave 1,001 fails the job, retried, with no `offer.waves_stopped`
  row. Stop the chain with its own reason at the limit instead (its words for the office first).
- P4.4's measurements (2026-10-26), not blocking: at 2,000 casuals an offer wave's candidate list
  takes about 0.85 s once the tables are analysed, about 0.7 s of it the rules themselves
  (`checkEligibility`, about 0.35 ms a casual; the batch loader is about 0.1 s since its rows are
  grouped by casual, 0.3 s before). Profile the rules if waves at that size need to start faster.
  Before the first analyse after a big import, the hours query alone took 1.8 s (a poor plan with
  no statistics; not JIT): `docs/runbooks.md` says to run `ANALYZE` as the owner, or wait a minute.
- P4.4's guardrails review (2026-10-26), not blocking: an offer can be logged both `offer.sent`
  {unconfirmed} and `offer.send_failed`. A second copy of a wave logs the first copy's in-flight
  claims as unconfirmed (`logUnconfirmedOffers`), and if one of those sends then fails, the failure
  branch in `src/lib/offers/waves.ts` (unlike the success branch) doesn't check `lockOfferOutcome`
  first; the notice report counts the `offer.sent`. An old gap, wider with 4 sends in flight. Decide
  what the log should say then (the append-only log can't take the first back), then fix both
  branches the same way.
- P4.5's guardrails review (2026-10-26), not blocking: (1) each tick queues the next slot's job
  while the last slot's chain is still going, and each starts its own chain: nothing goes twice,
  but a big firm's backlog then gets a turn per chain to another firm's one (about 2 at 2,000 a
  slot); the tick could skip a firm whose follow-up is still waiting. (2) `shift-reminders` still
  takes 5 jobs a fetch under one 15-minute expiry: if pushes hang (5 s each), 5 runs of 200 can
  pass it and be retried while the first copy runs (the claims keep it safe); one per fetch, like
  the offer waves, if that's seen.
- P4.7's words, after the UI chat merges (no office words change this round): (1) the action log
  says a held message "sent a WhatsApp to the shifts line (a question for the office)", not that
  nothing went back (`replyHeld`) or what it was sorted as (`sortedAs`), and an alert held by the
  hour's limit (`alertHeld`) isn't named; (2) the retention purge's "old login records" now also
  counts the unknown-number alert counters (`auth_throttle`); (3) an Enquiry page's "Sorted:" line
  is wrong for a held message: a held "When do wages go in" says "They asked for a person (a
  keyword)", and one the AI sorted as shifts says 'AI sorted it as "office"' (`sortedStep` in
  `src/lib/office/enquiries.ts`): show `sortedAs`, with "automatic replies off"; (4) a held pay
  question is in Need a person but not in Enquiries' Pay view (it filters on the stored intent),
  and its page's pay flag is off (P4.7's second guardrails review).
- P2.3 (2026-10-28), for P5: a booking confirmation goes only for the office's own booking in
  ShiftDesk (`src/lib/roster/book.ts`, `by.type === "office"`), so the connector's bookings (P5)
  must come in as `booked_via` api and never through the office's path, or the confirmation must
  read `firm_system_sends` too (`src/lib/notices/who-sends.ts`). The reminders already do.
- P2.4 (2026-10-29): the office's reply on Enquiries by email (its subject is approved: "A reply
  from {firm}"). Not built: a reply answers a WhatsApp, text or call to the shifts line, so a text
  sender exists; one that can't go fails and its question is back in Need a person, as any failed
  reply. Needed once a casual's message can arrive with no text sender (the app's messages, P8):
  then the `messages` channel check, `src/lib/office/enquiry-actions.ts` and the Enquiries pages
  take email, after the UI chat.
- P2.4 (2026-10-29), for P2.5: the send-failure alert (`src/lib/ops/tick.ts`) counts WhatsApp and
  texts only, so with no text sender (P2.5) an SMTP outage that stops every casual's email, and
  casuals nobody could reach (`no_channel`), raise no alert. P2.5 should count `email` sends too.
  (P2.5, 2026-10-29: emails now have an alert of their own. Still open: a casual nobody could
  reach, `no_channel`, is in the action log only; the office's Needs attention should list them,
  after the UI chat.)
- P2.6 (2026-10-29), from its guardrails review, to decide before P2.7 switches login by email on:
  (1) a casual never confirms their email address, yet with the setting on and no text sender it's
  the only way into their account: confirm it first (a link to the address)?; (2) the unconfirmed
  catch-up of a link or code names the channel this run would choose, not the one stored (keeping
  it on the link or code row is a schema change); (3) `firm:settings` already accepts
  `login_by_email=true`: refuse it until P2.7?
- P2.4 (2026-10-29), from its guardrails review, not blocking: (1) a run that stops after sending is
  caught up as "sent, unconfirmed" with the channel it was claimed with (the offer's, the licence
  message's), though it may have gone by push or email; (2) a casual's email goes from the app's
  one address (`SMTP_FROM`), not one per firm: a firm's own sending address, or its name shown as
  the sender, needs a setting per firm; (3) a failed email offer, like a failed WhatsApp, can be
  offered again in a later wave (it may have arrived).
- P2.4 (2026-10-29), for Phase 15: email goes only when there's no text sender at all. Once texts
  exist, a casual who replied STOP and isn't on WhatsApp gets nothing (`sms_opted_out`), though an
  email couldn't reach them twice. Decide then whether that one goes by email.
- P4.8's limits (2026-10-26), not blocking: (1) the AI fallback alert counts the shifts line's
  sorting only; the payroll digest's summaries aren't logged per call, so their misses aren't
  counted (a group the AI misses keeps the app's own line). (2) The connection waits are the worker's only:
  the web app's waits (a page failing after 5 s) show in its log, not an alert. (3) Every threshold
  is a starting number (`THRESHOLDS` in `src/lib/ops/alerts.ts`): revisit them with a pilot firm's
  real weeks. (4) The queue reads scan `pgboss.job`'s waiting and running rows every 5 minutes: fine
  at the target (a day's finished jobs are kept); watch it if a queue ever holds a big backlog.
- P4.7's guardrails review (2026-10-26), for Dylan: a phone call still sends the caller's login
  link by message, as the login page does (the caller asked for it; decision 13 lists offers,
  confirmations and reminders). Keep it, or send it only by WhatsApp, or not at all? **Decided**
  (Dylan, 2026-10-27): keep sending the link, whatever `auto_replies` says (decision 11;
  `inbound.voice.test.ts` pins it).

## Hours log

| Date | Phase | Hours | What got done |
|---|---|---|---|
| 2026-09-27 | 0 | 1 | Phase 0 scaffold built, verified, audited and closed; pushed to GitHub, CI green; e2e passing locally |
| 2026-09-27 | 1 | 4.5 | Phase 1 built, verified and audited: 10 RLS-sealed tables, three database logins, worker/office login, pay-page codes, rate limits, action log, masked logging, demo seed; 595 tests + 10 e2e; pushed on `build/overnight` (0.6 h proposal + 3.9 h build; see `docs/work-log.md`) |
| 2026-09-28 | 2 | 0.5 | Schema: shifts, assignments, requests, offers, credential_rules; 5 RLS-sealed tables, 23 database checks, no deletes of rota evidence, firm-first unique keys (review fix); 733 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.4 | `RosterPlug` interface: boundary schemas, notice-hours function, 21-check adapter contract proven against 13 kinds of broken plug; 802 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.3 | Native adapter: first-yes-wins booking on our own tables (shift lock + one conditional update), cancel evidence and reopening, 19 contract checks + 10-way race tests on the real database; 833 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.8 | Google Sheets adapter: two-way sync with a three-way merge, column mapping by header, sync job every minute on event days, one read and one batch write per sync, service-account client tested with a fake network; not live until the rules engine; 1004 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.6 | CSV/Excel import for workers, credentials and shifts: CSV and .xlsx readers with size and zip-bomb limits, columns by header name, dry run, row-numbered problems, `npm run import`; 1064 tests + 10 e2e; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.4 | Rules engine: pure `checkEligibility()` (started, active, role, credentials in date for the whole shift, applied allowance, overlap, rest, weekly cap, unavailable, blocked site), plain-English reasons, office overrides limited to 0 and 6-8, an eligibility pass; 1122 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.3 | Credential packs: security, rail, construction and cleaning packs as data held to the doc by a test, per-firm `credential_types`, `applyCredentialPack()` in the demo seed, "applied" counted only for SIA licences; 1154 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.6 | Credential expiry scan: daily 08:00 job warns workers at 30, 14 and 7 days (one message per threshold, restarts on renewal), marks credentials expired the day after and tells the worker, Monday list for the office; import renewal race and Monday rollback fixed after review; 1185 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.6 | Atomic assign: one booking path (`bookShift`: who may book whom, rules on the current rows, fresh-copy check for Sheets shifts, one conditional update, logged), single-use eligibility pass required by every roster plug, worker and applied-day locks, sheet names checked by the rules; 1222 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.4 | Events with notice hours: `cancelBooking` (worker or office, reason kept on the row, never in the log; no cancelling after the end), every booking and cancellation by every path logged with notice hours (proven by a whole-log test), sync events aligned; 1236 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 2 | 0.1 | Phase 2 tests: a parity check holding `rules.table` to every case in the rules doc (proven to fail on an untested case), race and Sheets test descriptions brought up to date; 1257 tests + 10 e2e; verified and audited DONE. Phase 2 complete: 5.0 h of the 30–40 h estimate (see docs/work-log.md) |
| 2026-09-28 | 3 | 0.4 | My shifts: the portal home shows the next shift in a card (London times, role, site, maps button, instructions), every later shift opening to the same details, the last 30 days, a licence banner and plain empty states; 1275 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 3 | 0.3 | Open shifts: only shifts the rules let the worker take (next 28 days, filters by day, site and role), "Take shift" booking through the one booking path with an on-card confirmation (what, when, reference, sign-off) or a plain answer; 1290 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 3 | 0.3 | Cancel a shift: "Cancel this shift" on My shifts, quick reasons, instant confirmation (the shift, notice given, when recorded, the booking reference, sign-off), recorded through the Phase 2 cancel path; the review caught a broken production build (fixed, and a new test guards it); 1311 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 3 | 0.4 | Worker requests: "Ask for a change" on My shifts (a time change or a swap for their own upcoming shift), a confirmation with a reference, and My requests with each status in plain words; one open request per shift and kind (tested with taps at once); 1328 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-28 | 3 | 0.4 | Allocation mode: first come, first served (default) or fair rotation, where a new place is held 15 minutes for the 4 workers with the fewest hours that week (never for shifts within 24 hours, never past the start, never the office), enforced in booking, shown on Open shifts, logged; 1343 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.4 | Pay info page: new `pay_records` table (tenant-sealed, no deletes), `npm run import --kind pay` (money in exact pence, decimal commas refused), and the pay page behind the 6-digit code showing the last 8 weeks as payroll sent them; 1370 tests + 10 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.5 | Profile: the worker's details and licences (read-only, expired or suspended ones in red with what to do), days they can't work (new `worker_unavailable_days` table, which the rules now use to refuse bookings on those days; the office can override), and WhatsApp-or-text plus open-shift alerts settings; every change logged; 1412 tests + 12 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.4 | Blocked-shift screen: the shift's own page `/shifts/[id]` (booked, open, held, blocked, filled, started, cancelled, missing), the rules' reasons in plain English when blocked, and "Ask the office to review" (a new `review` request, one per shift, only while the rules still say no, tested with taps at once); Open shifts refusals link to it; 1431 tests + 14 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.6 | Offline My shifts and iPhone home screen: a small service worker keeps the last copy of My shifts on the phone and shows it with no signal, marked "No signal. These are your shifts from {time}" (deleted on logout, login and when logged out; never shown after 14 days; only the page and its own files are kept), a per-firm web app manifest, and an iPhone "Put your shifts on your home screen" hint; the review caught a path trick that could have kept other pages (fixed and tested); 1453 tests + 19 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.2 | Empty and error states: plain "We can't find that page." instead of Next's 404, plain words when a page or the whole frame fails, "No signal" instead of "Something went wrong" when there's no network, Open shifts only promises a message to workers who want them, and a lasting test that renders every staff screen state and fails on jargon, raw codes or long sentences; 1531 tests + 20 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.5 | Demo seed: Acme's Saturday event day (40 shifts over three sites, 32 booked by workers the rules allow, 8 open), the urgent 6am dropout, two open requests, 8 weeks of pay for every Acme worker, and matching log entries; re-runs add nothing and never undo a demo; the seed prints the urgent shift's link; a demo logins table in docs/testing.md; 1545 tests + 20 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 3 | 0.1 | Phase 3 Playwright flow: on a phone-sized screen, a seeded worker logs in, takes a Saturday shift, cancels it, asks for a change and sees pay with a code, with log in, take and cancel each timed under 30 seconds (2.1 s, 1.1 s and 0.5 s); the staff part of the demo script written out in docs/testing.md; 1545 tests + 21 e2e; verified and audited DONE. Phase 3 complete: 4.5 h of the 35–45 h estimate (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.4 | Urgent flag: a cancellation that reopens a place within the firm's urgent window (default 24 h) marks the shift urgent and logs it (worker, office and sheet removals; not a whole shift cancelled or a name swapped), and the office can mark or clear it by hand (admins and resourcers); the review caught a false "dropout" on sheet swaps (fixed and tested); 1565 tests + 21 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.2 | Urgent board: `/urgent` lists the urgent shifts a worker could take (the same checks as Open shifts), with big "Take shift" buttons; My shifts says "1 urgent shift needs someone"; Open shifts labels urgent cards; 1576 tests + 23 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.4 | Offer waves: when a place reopens close to the start (or the office marks a shift urgent), the best eligible workers get the urgent offer by WhatsApp or text (console only), the next group 15 minutes later, stopping when filled, started, cleared or out of people; the office is emailed if still unfilled 3 hours before (all firm settings); the review caught a cancellation-blocking setting and a false "filled elsewhere" (fixed and tested); 1597 tests + 23 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.5 | Web push, BLOCKED (not ticked: real delivery needs Google/Apple push services and a secret key): built everything short of it: phone subscriptions (new table), the subscribe route, the profile's "Notifications on this phone", pushes with each urgent offer through a console sender, the service worker showing and opening them; connecting the real sender is parked; 1649 tests + 25 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.3 | WhatsApp via Twilio, SMS fallback, quiet hours: BLOCKED (not ticked: Twilio is an outside service): built quiet hours (waves held until they end unless urgent may override, safe on clock-change nights) and the immediate SMS fallback when WhatsApp is refused, with other send failures logged per worker instead of rolling back the wave; connecting Twilio is parked with steps; 1664 tests + 25 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.4 | Only eligible workers notified, daily offer cap: at most 3 shift offers per worker per London day unless the shift is urgent (failed sends don't count), checked in the one place every offer picks its workers, which also asks the booking rules about each one; a boundary test fails if any other code writes an offer or builds its message; the review's suggestions done or parked; 1690 tests + 25 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.6 | Shift reminders: every confirmed booking gets "Reminder: tomorrow…" 24 hours before and "Your shift starts at…" 2 hours before (by the worker's channel, with a push; console only), each once, recorded in a new `shift_reminders` table before it goes; quiet hours hold or skip them; a check every 5 minutes; the review caught a way a retry could resend (fixed: claim, send, then record, each separately); 1748 tests + 25 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.4 | All copy from the messaging doc; templates to Meta: BLOCKED (not ticked: submitting needs the WhatsApp Business account): a test now holds every message (WhatsApp, text, push, email) to the doc's words and checks every message to a worker ends with the firm's sign-off; urgent offers by text use the doc's short SMS copy; the ready-to-submit WhatsApp template pack (10 templates) is tested against what the code sends; submission steps parked; 1799 tests + 25 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 4 | 0.3 | Phase 4 tests: a fake job worker runs the real queue on a fake clock, so wave timing is tested end to end (every 15 minutes, stop on fill, the office emailed once, quiet hours, the start ends it); the notification policy is tested for offers and reminders alike (channel order, quiet hours, daily cap, no double sends), and over a whole chain only eligible workers who want offers get anything; 1827 tests + 25 e2e; verified and audited DONE. Phase 4 done except the 3 blocked tasks: 3.5 h of the 27–37 h estimate (see docs/work-log.md) |
| 2026-09-29 | 5 | 1.0 | Today view: the office dashboard now shows urgent shifts with wave status, gaps in the next 7 days, cancellations in the last 24 hours with notice, requests waiting and credentials expiring this week, with quick actions (offer to someone, mark urgent or not, mark as filled and undo); office offers go through the same rules, daily cap and quiet hours as every offer (new schema: office offers on the offers table); the review caught a misleading "offer on its way" after a failed send and a daily-cap race (both fixed and tested); 1886 tests + 28 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.6 | Office shift screens: a 4-week shift list, create one shift or up to 12 for an event (nothing saved unless every line is right), edit (booked shifts: places and instructions only, moves come with the next task), import a .csv/.xlsx checked first, and each shift's page with its places, offers, history in plain words and "Assign someone" (the rules' answer first; the office may override only rest, hours, a day off or a started shift, with a logged reason); the review caught a closed shift reopening on edit and the import moving a booked shift's site (both fixed and tested); 1924 tests + 31 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 1.1 | Office cancels, moves and shortens: a reason from a fixed list is required; each booked worker's notice hours are logged; each is told by a notice job (once only, from what they last knew to what's true now, quiet hours unless the shift is close or under way); a move is refused while anyone booked fails a rule the office can't override; the reviews caught a lost message when changes stacked up and an office "they asked to cancel" that told nobody (fixed; the second parked for Dylan); two e2e root causes fixed (a shared login limit, a button clicked before the page was ready); 1965 tests + 32 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.5 | Mark who worked: on a shift's page, once it has started, the office marks each person as worked or not attended (and can put a mistake right); after the end, "mark the rest as worked" after a "Yes"; every mark logged with what it was before; a new "Who worked?" list on Today shows shifts from the last 7 days with people not marked yet; the review caught a confirmation that vanished on refresh (fixed, and the browser test now proves it stays); 1979 tests + 33 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.5 | Answering requests: a new office Requests page lists what workers asked (oldest first) with the shift and their note; the office approves or declines with a note (needed to decline), one answer only even if two people try at once; the worker gets "Your request (swap, ref …) is declined. The office says: …" by WhatsApp or text (quiet hours respected, once only) and sees the note in My requests; the office sees whether they were told; the review caught a reply about a finished shift that could go at night (fixed and tested); 2005 tests + 34 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.5 | Action log: a new office page shows every recorded event, newest first, in plain words, filtered by worker, shift, type (12 plain groups) and dates in London time (default the last 7 days; all of one shift from its page), 100 at a time; a test fails if any event the code records has no group or words; the review caught a test that would have failed on 19–22 October and two pay-record events the words had missed (both fixed); 2093 tests + 35 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.5 | Notice and cancellation report: a new office page lists every offer, booking, move, shortening and cancellation from the log, with when, who started it (worker, office, rota sheet, offer wave), the notice the worker had and a short-notice flag at the firm's threshold (48 hours unless the firm sets its own), filtered by dates, kind, who started it and short notice, and downloads as a CSV file (all rows or none, safe to open in a spreadsheet); offers now record their notice too; the review caught rota-sheet changes showing no worker, moves showing only start times and a file that could be cut short (all fixed and tested); 2103 tests + 36 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.6 | Pilot metrics: a new office page puts the week-0 baseline (a form for the playbook's 8 figures) against the app's own figures for chosen dates (portal actions, answered straight away, unanswered after 24 hours, refill time, active workers, adoption, urgent fill rate, no-shows, short-notice cancellations), plus a weekly tally form for what the app can't see; a nightly job at 00:30 (new `metrics_daily` table, isolated per firm) recomputes the last 7 days, or "Update the figures now"; the review caught requests counted as instant answers and partial days skewing the weekly figures (both fixed and tested); 2139 tests + 37 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 5 | 0.2 | Notice report tests: 7 tests drive the real paths (a worker taking and cancelling from the portal, the office cancelling a booking and a whole shift, moving and shortening, and the Google Sheets sync booking, shortening, moving and removing someone) and read the notice report and its CSV back: who started each change, notice hours, the flag exactly at 48 hours and at a firm's own threshold, negative notice after the start; no product code needed changing; 2146 tests + 37 e2e; verified and audited DONE. Phase 5 done: 5.5 h of the 23–33 h estimate (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.5 | Pay query form: behind the pay code, a worker picks one of their recent shifts (or a day), what's wrong (hours missing, wrong rate, paid late, something else) and a note, and gets "Pay query sent." with a reference; the pay page lists their queries "With payroll" or "Sorted"; new `pay_queries` table (isolated per firm); one open query per question; the typed note never goes in the log; no AI (golden rule 9); the review caught nested brackets in the log's words, a stuck logged-out screen and small buttons (all fixed); 2177 tests + 38 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.4 | Pay query grouping, BLOCKED (not ticked: "Haiku summarises" needs Claude on Amazon Bedrock, an outside service): built everything short of it: grouping keys by code (wrong rate by week and pay-line rate, hours missing by week and site, paid late and something else by week), regrouping when a pay line arrives later, payroll's read-only "Pay queries" page grouped by likely cause with the app's own summary line, and the AI summary interface (facts only, checked, with the app's line as the fallback) with a fake for tests; connecting Bedrock is parked with steps; 2191 tests + 38 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.8 | Payroll digest: at the firm's set time (default 09:00 Monday to Friday, a new `pay_digest` setting) payroll gets one email: "42 new pay queries since the last digest. 37 are about the same thing: …", the groups biggest first, and the list attached as a spreadsheet file (names and what workers wrote only in the attachment); each query goes once and is marked "In a digest", back to waiting if no email gets through; payroll's page shows the schedule, the last digest and "Send the digest now"; email through the console transport (connecting Amazon SES parked with steps); the review caught per-query log entries in the wrong transaction, an outcome step that could fail silently and a lost digest the page never mentioned (all fixed and tested); 2231 tests + 38 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.6 | Pay query status: payroll marks a group "sorted" with a note (required, at most 500 characters, never in the log; new columns on `pay_queries`); each worker gets "Update on your pay query (ref …): sorted. {note}" by WhatsApp or text (once, quiet hours respected, a push that says nothing about pay) and sees "Sorted on {day}" with "Payroll says: …" on their pay page; a new test pins which files may use AI code and fails if anything a worker sees, or payroll's sorting path, can reach it; the review caught that the test missed the office side where the note is typed (fixed: the sort path has its own modules, and the reviewer's breach now fails the test); two old test-helper root causes fixed on the way (a missing cross-firm case, ids sorted as text); 2264 tests + 38 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.5 | Pay records import screen: payroll and admins upload their payroll's .csv or .xlsx at `/office/pay/import` (Staff ID or mobile, period, hours, rate, gross, pay date), "Check the file" first (nothing saved or logged), then "Import these pay records"; problems listed by row, never the contents; waiting pay queries regroup to match the new lines (logged); the importer itself was Phase 3's, and the shifts and pay screens now share one upload path; the review found nothing to fix first, and its suggestions were done (checks can never write, a deadlock retry, more cross-firm tests, the AI tripwire extended to the import); 2275 tests + 39 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 6 | 0.3 | Phase 6 tests (`pay.grouping`): a new file on the real database proves grouping keys are stable (the same facts give the same key whoever raises it and whenever; the firm's own week, across the clocks going back; regrouping and re-importing change nothing; keys move only when their facts do; firms never share a group) and that every kind of AI failure (throwing, hanging, answering late, nonsense, advice) leaves the payroll digest word for word as it is with no AI; planning found the digest could wait for ever on an AI that never answers (fixed: a 5-second limit a group); the review's suggestions done (late answers tested in the digest, AI calls counted, no leftover timers); 2285 tests + 39 e2e; verified and audited DONE. Phase 6 done except the blocked grouping task: 3.1 h of the 12–18 h estimate (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.6 | Shifts line, BLOCKED (not ticked: the number and its WhatsApp sender only exist in Twilio, an outside service): built everything short of it: each firm's own number (`firms.shifts_line_e164`, one number per firm), every WhatsApp and text to a worker carrying it as `from` (a tripwire test holds every sender to it), finding the firm for an incoming message's number (`app_firm_by_line`), the office dashboard showing it, `npm run firm:line` to set it (asks before replacing), and a fake number for the demo firm; the review caught an invariant the owner-only script broke (moved to `scripts/`) and a test that could clash with the seed; buying and connecting the numbers is parked under "Connect Twilio"; 2299 tests + 39 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.7 | Inbound WhatsApp, BLOCKED (not ticked: "Haiku only for unclear text" needs Bedrock, and real WhatsApps need Twilio): built everything short of them: a new `messages` table, Twilio's webhook (signature checked, reproducing Twilio's own example; one row and one job per message, repeats ignored), and the reply job: keywords first (open shifts, cancelling, pay links; "help" makes an office request with a reference), the AI only ever picking one of those replies, with unclear messages going to the office meanwhile; replies from the firm's own number, at most once; the review caught a way a message could be lost and dropouts getting the open shifts link (both fixed and tested); 2344 tests + 40 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.5 | Unknown number, BLOCKED (not ticked: it's set off by a real incoming WhatsApp and replies from the firm's own number, both needing Twilio, like the last two tasks): built everything short of it: a stranger gets the doc's polite "reply with your full name", a former worker gets no reply, and the office's admins and resourcers get an email (no number or message in it); a new "Messages from numbers we don't know" list on Today; at most one reply and one email per number in any 24 hours (so auto-replies can't loop); the review caught two messages at once both being answered (fixed with a lock, and a test that fails without it) and a false "emailed 0 people" log line; 2356 tests + 41 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.8 | Call-to-text, BLOCKED (not ticked: calls, the spoken message and voicemail transcription only exist in Twilio): built everything short of it: Twilio's voice, transcription and "done" webhooks (one shared set of checks, the WhatsApp webhook moved onto it); a caller hears the firm's message in British English and a worker's number gets their login link through the login page's own request (same limits, same answer for any number; a withheld number or a stopped one isn't promised a link); every call stored once; a voicemail's text becomes a request for the office and the worker gets a new `voicemail_received` template by the channel they chose; unknown or withheld callers' voicemails on Today; the review caught 4 things (a free-text WhatsApp a call can't open, a database check that let an empty sender through, voicemails logged as WhatsApps, withheld calls not stored once): all fixed and tested; 2383 tests + 42 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.8 | STOP by text, BLOCKED (not ticked: a STOP only arrives through Twilio's SMS webhook): built everything short of it: the SMS webhook (the shared Twilio checks; one row and one job per text); a text that is only STOP (Twilio's standard words, CANCEL included, "Stop." too) turns that worker's texts off, START back on, with one confirmation text only when it changes and Twilio didn't confirm it itself; the notification policy: every sender now must say whether texts are allowed, and none texts a worker who replied STOP (WhatsApp instead if they chose texts; no text fallback); the profile says texts are off; the review caught a false "Saved… by text message" (fixed) and suggested an out-of-order guard, punctuation, and an office email that no longer claims we asked strangers for their name (all done); 2418 tests + 43 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.3 | Signature checks on all Twilio webhooks and storing once: the five webhooks built so far already started with the shared Twilio checks and kept one row per Twilio id; added a guard test that reads the source so it stays true (every Twilio route listed, its signature checked against its own configured address before anything else, every inbound row stored once with jobs only for new rows; checked it catches an unchecked new route and a missing repeat guard) and a "Twilio webhooks" section in the API doc; the delivery-status webhook is left for the Twilio sender; 2434 tests + 43 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 7 | 0.5 | Phase 7 tests: `webhook.idempotent` (each webhook that stores, the same Twilio id twice and then ten copies at once → one row and one job, the reply job ten times at once → one reply; checked they catch a missing repeat guard and a missing row lock) and signature contract tests (a signer written from Twilio's published algorithm reproduces Twilio's documented example, then signs requests shaped as Twilio sends them, with every documented field and tricky encodings: accepted and stored exactly; wrongly signed ones refused); the full run showed a login race test failing again: root cause was the test not forcing the overlap it claims (the app was right), fixed by holding both logins until they meet, same strict check; 2451 tests + 43 e2e; verified and audited DONE. Phase 7: 4.2 h of the 15–20 h estimate, 2 tasks done, 5 blocked on Twilio (see docs/work-log.md) |
| 2026-09-29 | 8 | 0.7 | Branding: every firm page (portal and office) opens with the firm's bar (its logo if set, its name, on its colour with black or white text worked out for contrast: at least 4.5:1 for any colour, checked across the colour cube); the tab title and the home-screen colour are the firm's; `npm run firm:brand` for the owner to set name, colour, logo and sign-off, every value checked and the change logged (field names only); the sign-off always ends "Shift Team" (golden rule 8, which the review caught could be broken) and empty values are refused; demo colours for Acme and Northline; 2469 tests + 45 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 8 | 0.8 | Custom domains: a firm's own address (shifts.firmname.co.uk) is served, with its bar, once verified: its CNAME must point to that firm's own subdomain (so it can't be verified for another firm); `npm run firm:domain` (owner) saves, checks (DNS before any lock) and clears it; Caddy's `/api/caddy/ask` approves only a firm's verified domain or an existing firm's subdomain (so no wildcard certificate is needed), and is blocked from outside; `deploy/Caddyfile` written and pinned by a test (not run: no Caddy here); the review caught My shifts not showing on a custom domain and a lock held during DNS (both fixed); 2503 tests + 47 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-29 | 8 | 0.5 | AWS, BLOCKED (not ticked: needs a real AWS account and money): `deploy/lightsail.sh` written (never run) to create the London server (Ubuntu 24.04, cheapest 2-CPU 4 GB plan, prices shown and a typed yes first), its firewall (only 80/443 to the internet, SSH only from Lightsail's browser console, read back and checked), a static IP and private Postgres 16 with nightly backups (checked after); `deploy/cloud-init.sh` for first boot (automatic security updates, Docker); a test pins it all; the review caught a first-boot script that would have stopped on Ubuntu's `sh`, no read-back of what AWS applied, and a password command showing two values (all fixed); runbook "Set up AWS (once)" in 9 beginner steps; 2516 tests + 47 e2e; verified (see docs/work-log.md) |
| 2026-09-29 | 8 | 0.6 | Docker Compose and deploy, BLOCKED (not ticked: no server yet, and the deploy workflow only runs on `main`): the image (`Dockerfile`: one image for web, worker and migrate, non-root, code owned by root, no secrets), `deploy/docker-compose.yml` (only Caddy published; the owner's database login only to migrate; the worker off until Twilio exists, since production refuses printed messages), `GET /api/health`, deploys that pull (a GitHub workflow builds and pushes the image after CI passes on main; a timer on the server pulls it, migrates, starts it, never 05:30–09:00 UK); a CI job builds the image on every push; the review caught a fork's pull request being able to publish, an older build rolling the server back, failed deploys never retried, nothing deploying with the documented settings, and a rollback that couldn't work (all fixed); 2542 tests + 47 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 8 | 0.5 | Backups, restore drill, budget, uptime, alerts, BLOCKED (not ticked: all AWS or an outside uptime service): `deploy/alarms.sh` (Lightsail email alarms: the server down, CPU, burst capacity, the database's storage and CPU; resends the confirmation) and `deploy/restore-drill.sh` (the latest backup restored to a separate private database, reused only if restored in the last hours, deleted only by typing its name) written and pinned by tests that can never reach AWS; runbooks "Monitoring and alerts (once)" (with a plain HTTPS uptime check on `/api/health`) and "Restore drill (monthly)" (a recency check, not a count); backups were already on, the budget is setup step 1; the review caught an old drill copy being reused (and a way to delete production by mistake), errors looking like "not there", and a missing sudo (all fixed); 2557 tests + 47 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 8 | 0.5 | Twilio call fallback, BLOCKED (not ticked: it's a setting in Twilio's console): `npm run firm:call-fallback` prints a firm's TwiML Bin (Twilio plays it itself when our app doesn't answer): why, then the manager's phone, then a closing line; the words are new doc copy, checked by tests; "Connect Twilio" step 10 explains setting and safely checking it; the review caught a closing line that played "nobody could take your call" even after a call that worked, and pointed callers to messaging, which is down too (both fixed), plus a safer check and logging calls taken by phone during an outage; 2562 tests + 47 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 8 | 1.3 | GDPR: an admin-only "Data requests" page: find a worker, download everything about them (JSON, or CSV for Excel), or delete their personal details (refused while they're booked on a shift that hasn't ended; their shift history stays under an anonymous "Deleted worker" row as the notice report's evidence; typed notes and reasons cleared); "Download all your data" for the firm (every table, no login secrets); a nightly purge (messages and typed request text after 90 days, old login leftovers), logged every run; messages only deleted through two narrow database functions; the review caught typed text surviving a delete, a function trusting a caller's phone number, and an export missing log rows (all fixed and tested); the 12-month purge of the log is parked for Dylan (it would need the append-only log changed); 2611 tests + 48 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-30 | 8 | 0.5 | Alerts to your phone, BLOCKED (not ticked: a phone needs Twilio or another outside service): every check built: each 5 minutes the worker looks at the last hour for jobs that failed after their last retry, a firm's rota sheet sync failing for 30 minutes, more than 5% of a firm's WhatsApps and texts failing (of at least 20), and the web app's health from inside the server; the web counts bad Twilio signatures (20 in an hour); each problem alerts at most once in any hour, with no personal data; alerts are "ShiftDesk alert: …" log lines until "Connect alerts to your phone"; `npm run -s ops:test-alert`; the review caught a firm-list failure stopping every alert, a long alert being dropped, "once an hour" really being "once per clock hour", and a send rate diluted by senders that never log failures (all fixed and tested); 2638 tests + 48 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 8 | 0.2 | Runbooks tried for real, BLOCKED (not ticked: needs the real server, database snapshots and GitHub's registry): an independent fact-check of the Deploy, Rollback, Restore and Restore drill runbooks against the scripts (19 claims): Rollback would have hit "Permission denied" (no `sudo -i`) and Restore said "restart", which keeps the old database settings (now `docker compose up -d`): both fixed; a new "Try the runbooks for real (once, before the pilot's data)" section with the order, what "worked" looks like and a table to fill in; 2638 tests + 48 e2e; verified. Phase 8: 5.6 h of the 18–28 h estimate, 3 tasks done, 6 blocked on outside services (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.6 | Onboarding checklist: the app couldn't create a real firm (only the demo seed could), add office users or change a firm's settings, so four owner commands: `firm:create` (the firm, its sector's credential rules and first admin, logged; finishes a setup that stopped), `firm:office-user`, `firm:settings` (shows and sets the checklist's settings, each checked by reading it back through the app's own reader) and `firm:check` (the checklist from the firm's data: done, to do, confirm yourself; counts only); a one-off `owner` compose service to run them on the server without a password on the command line; a step-by-step "Onboarding a pilot firm" runbook; the review caught the firm's row committed without its log entry and that password on the command line (both fixed and tested); 2653 tests + 48 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.2 | Import real data after Gate B, BLOCKED (not ticked: no firm has signed, and no real personal data tonight): the import command now enforces Gate B: against any database that isn't on this machine, saving (`--apply`) needs `--agreement-signed <slug>` repeating the firm's slug (you saying the agreement and DPA are signed), or nothing is saved; dry runs and local databases unchanged; runbook step and parking item; 2655 tests + 48 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.3 | Privacy notice, BLOCKED (not ticked: "supplied to the firm" needs a firm): `docs/privacy-notice.md`, ready to send: the short line and a section for the firm's own notice (what's kept and why, the shifts line's 90 days, what the AI does and doesn't, the phone's offline copy, the logo, who else handles it, retention, rights and what a deletion keeps), with notes for you on the blanks; an independent fact-check of 36 claims against the code found 4 that said more than the app does (all fixed); compliance, the onboarding runbook and `firm:check` point to it; 2655 tests + 48 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.9 | Pre-pilot checklist, BLOCKED (not ticked: 5 of its 7 items need CI on GitHub, a real restore, a real call, real phones or alerts to a phone); the 2 that can be done here, done for real and ticked in docs/testing.md: a load smoke (200 signed WhatsApps through the real app) found the worker answering only 31 of 200 in a minute (a 2-second wait after every job), fixed so all 200 are answered about a second after the last; and every e2e run now scans both servers' whole output for phone numbers and emails, which caught a mobile and a login token that Next's development logging printed (switched off) and a search that put a mobile in the address (now a form action); the review caught side-by-side jobs letting a text go out after STOP (batches now run in order); 2665 tests + 49 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.1 | Baseline week, BLOCKED (not ticked: a real firm's real week before go-live): `docs/baseline-tally.md`, the resourcer's day-by-day tally sheet (counts only) with how to turn it into exactly the 8 figures the office's Pilot figures page takes; linked from the playbook; parking item "Record the baseline week"; 2665 tests + 49 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.2 | Dry-run event day, BLOCKED (not ticked: needs the pilot firm's resourcer, volunteers' phones and Twilio): the playbook had no dry-run section though onboarding pointed to it; added "Dry-run event day": when, the set-up (three volunteers, a pretend event before go-live), 12 steps covering every flow a pilot relies on with who does each and what "worked" looks like, and a table to fill in; parking item; 2665 tests + 49 e2e; verified (see docs/work-log.md) |
| 2026-09-30 | 9 | 0.2 | Weekly pilot reviews and the week-4 report, BLOCKED (not ticked: a real four-week pilot): `docs/pilot-report.md`: the Friday review (the tally first, the dates to choose on the Pilot metrics page), a weekly table with the page's own figure names and targets, the Friday update's wording, and the week-4 report with where each number comes from, then the Gate C check; linked from the playbook; parking item; 2665 tests + 49 e2e; verified. Phase 9: 2.5 h of the 10–15 h estimate, 1 task done, 6 blocked (see docs/work-log.md) |
| 2026-10-03 | 10 | 0.8 | Offer waves never hold the shift lock while sending: claim → send → record per worker (each claim re-checks the shift and the worker under the lock; an edit mid-wave restarts it), escalation per office user, quiet hours on retries; Take shift and Assign under 2 s mid-way through a 300-worker wave (was 2.6 s with 60); 2678 tests + 49 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 0.6 | Waiting offers close the moment a shift fills, by any route and in every mode (`src/lib/offers/close.ts`, `offer.closed`): the taker accepted (also after a reopen, and when the office places them or the sheet names them), the rest filled elsewhere; the "urgent shifts filled from offers" metric counts only workers who took it themselves; 2693 tests + 49 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 1.0 | No message sent twice when a job retries: login links and codes, the office's offer and the credential scan (and its Monday list) now claim, send, then record; a send whose record step failed is logged on the next run as unconfirmed, so the notice report keeps it; new `otp_codes.request_id` (migration 0027); 2713 tests + 49 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 0.5 | Twilio message ids no longer mistaken for phone numbers by the log masker, so the action log never refuses an event after a real message has gone (about 1 send in 12 would have); every sender that logs a provider id tested with Twilio-shaped ids; 2723 tests + 49 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 1.3 | Speed at pilot size: the shifts line answers 8 messages at once (one per worker at a time, older ones first), so 200 workers are answered within 20 s even with a 300 ms send; a crashed worker's jobs come back within about a minute (heartbeat), not 15; Open shifts, the urgent board and the offer list make the same number of queries however many shifts or workers; three indexes; the "about a second" claim corrected; 2735 tests + 49 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 0.8 | Office access can be taken away: on the office team page an admin can turn someone's access off (logged out everywhere at once, unused login links spent), back on (nothing old comes back), change their role (making an admin asks "Yes" first) or log them out on every device; the same from `firm:office-user`; the firm always keeps an admin; every change logged; a worker's status change from an import or the sheet also logs them out everywhere; two reviews found a deadlock with a login at the same moment and a missed session (both fixed and tested); 2759 tests + 50 e2e; verified and audited DONE on round 2 (see docs/work-log.md) |
| 2026-10-03 | 10 | 1.1 | Worker leavers and blocks: a new Workers page where admins and resourcers make a worker inactive (logged out everywhere, no reminders, sticks against the rota sheet), active again, unblock them, block them from a site (rules check 9 made live, in both rules loaders) or log them out on every device, each with a reason from a list and logged; their bookings ahead show on Today as "Bookings to check" to cancel (with the new "They've left, or can't work here" reason and notice hours) or keep; a mobile change ends links and forgets phones; two reviews found a sheet sync race, vanishing confirmations and more (all fixed and tested, a few narrow items parked); 2816 tests + 51 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-03 | 10 | 0.5 | Notice for a moved or shortened shift counts from the earlier of the old and new start (office editor and rota sheet), so a shift moved earlier is flagged as short notice in the report (the firm's Employment Rights Act evidence); the move now holds each booked worker's row and the day's "applied" lock before re-checking them, so a booking at the same moment is seen (two race tests); "Dylan to confirm" note decided; 2822 tests + 51 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 1.2 | The rota sheet follows the office's rules: a role, time or site change to a booked shift is tried, then everyone booked is re-checked with the office move's own check (`src/lib/roster/recheck.ts`); refused → not made, logged once (`roster.sheet_change_refused`) and shown on Today's new "From your rota sheet"; a started shift is never re-timed or cancelled by a sync; refused names stay in the sheet's cell and are retried, and don't use up a place; a site change is logged per worker; new `shifts.sheet_issues` (migration 0030); two reviews' findings fixed; one older flaky test root-caused and parked; 2843 tests + 51 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.9 | Google Sheets, said honestly: `SHEETS_TRANSPORT=google` (with the service account's key file) switches the sync on; each sync first reads the sheet's locale and refuses anything but United Kingdom, with plain words in the action log; `npm run firm:sheet` (owner only) connects, replaces (guarded by `--same-ids` while sheet shifts ahead are booked), switches off, lets go or shows a firm's sheet; one sheet, one firm (a unique index), and the app can only update the sync's status columns (column-level grants); the "Connect the real Google Sheets" steps rewritten to match the code; Google added to the accounts list and the blocked table; two reviews' findings fixed or parked; an older `firm:check` crash for synced sheets found and fixed; 2911 tests + 51 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 1.1 | Imports read what the file says: an Excel date at 23:59:59 keeps its day; "12 50" refused as money; a re-import never reopens a shift the office marked filled (a real reopen is logged); Windows Excel CSVs read (garbled ones refused with a plain message); no identity swaps without a Staff ID (a mobile-only match needs the same name, licence and pay rows must name the worker, a reused Staff ID is refused); one date, shift-time and mobile reader for the editor, the sheet and every import (clock-change and equal times refused); Gate B recorded per firm (`npm run firm:agreement`, migration 0032), checked by every import and `firm:sheet` on the live server; two reviews' findings fixed or parked; the older flaky test hit again (parked, marked urgent); 2988 tests + 51 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.8 | The phone's copy of My shifts is gone after logout: a "forgotten at" mark the service worker checks, so a load still in flight at logout or login is never kept, and the copy is deleted again once the server confirms the logout; on slow but working signal the stale copy swaps itself for the fresh page (stopping at the first tap or a logout); Log out is a plain `/api/logout` route (same origin only), so copies kept from this build on can always log out; with no signal it says "No signal. You may still be logged in. …" and gives up after 10 s; the privacy notice and erase notes cover the phone's copy; two reviews found the swap fighting the logout (fixed and tested); 3004 tests + 53 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.8 | Retention and the privacy wording match the spec: per-firm `retention.message_days` (90), `retention.request_note_days` (365, the spec's 12 months) and a hold for disputes (`retention.hold_until`), set with `firm:settings` and read by the database's own messages purge (migration 0034); only closed requests lose their words; a newer reply is kept; the office's override reason is kept on the booking (migration 0033), never in the log, shown on the shift page and notice report, replaced on deletion and purged by age; the data page shows the firm's real keep-times; the data page, privacy notice and compliance say exactly what a deletion removes and keeps (other people's words aren't changed); Twilio caveat; new "Dylan to confirm" items; 3020 tests + 53 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.6 | "Try again" on the error screens really retries: the page's error screen uses Next's `retry()` (fetches the page again; `reset()` only redrew the failure), "Go to my shifts" is a full page load (recovers on My shifts itself), "Try again" is off with no signal until it's back; the whole-page error reloads through a form (works before the page's scripts, never resends a form); browser tests fail a page once and the page's frame once and recover (test-only failures behind `E2E_TEST_PAGES`, refused off localhost); two reviews' findings fixed; 3034 tests + 58 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.7 | A firm's own domain holds a login: a worker or office user who asks on it gets the link back on it (the job gets which address the request came in on as a word, takes the domain from the firm's own record and only while it's still verified, else the portal; old jobs get the portal; the log says `ownDomain`), and stays logged in there; browser tests log in on https://shifts.acme-events.test through an https stand-in for Caddy (a browser keeps no Secure cookie over http there) with the dev server allowed for that name; the guardrails review found a lost domain still marked verified would now get login links: recorded as a pre-pilot must-have (a periodic re-check, before any real firm's domain is verified); 3045 tests + 60 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.9 | Logs are safe and checked: every log string cut to 2,000 characters and request paths to 512 before masking, never leaving part of a number, email or token at the cut; every masking pattern a single pass (the old email and URL patterns took 30–60 s on a 200,000-character string; 31 timing attacks now well under a second); the e2e scan also catches numbers by a full stop, glued, dotted or tabbed, glued emails and login tokens (outside the console transport's own prints, which now end with their own line); the teardown fails on any unexpected server error, with the web app's uncaught errors and the worker's failed ticks now logged as JSON; "The destination stream closed early" explained (the connection closed mid-page) and logged as a warning; regression tests for the search address and Next's logging; two reviews' findings fixed; 3103 tests + 60 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.9 | Deploy and runbooks work as written: `deploy.sh` applies `.env` changes and starts a newly turned-on worker (same image: no migration; it says "Applied the settings in .env"), tested by running the real script against a stand-in docker; the worker has a sign of life and a health check, so a crashing one fails the deploy; images carry their commit, printed as "Deployed … (commit <SHA>)"; the Caddyfile checked by Caddy itself (validate and its JSON) and sending HSTS; database TLS on in production (`sslmode=verify-full` against Amazon's bundle in the image; the app refuses a production database address without it); the runbook trial after Twilio and SES with a test firm, rollback from the image list with the timer stopped, and other steps matched to the scripts; two reviews' findings fixed (the image build had broken: caught and guarded); 3126 tests + 60 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 0.7 | Every decision waiting for Dylan in one place: a "Decisions waiting for Dylan" section (130 decisions in 10 groups, each listed once with the default in force and where to read more, plus 13 checks and to-dos), with a "when each one matters" list built from each row's deadline (before any real data, when you create the accounts, before submitting the WhatsApp templates, before a pilot…); every "Connect …" step says You or Claude, and that each service's sender is still to be written; stale references fixed across the plan, the ADRs, the rules and compliance docs and the work log; a fact-checker (about 140 claims) and a completeness critic found 17 things to fix (all done); 3126 tests + 60 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 2.0 | Walkthrough polish: an office-placed worker gets a "Confirmed: …" message (a `shift-confirmed` job, claim → send → record, never crossing a change notice); login links survive a full stop or quote after them; "The client needs fewer staff" takes the place away (refused on the last place or a sheet shift); a repeated call hears the first answer; the sign-off rule checked as messages are built; the baseline needs all 8 figures; no shared event numbers in the log, the notice report or the data downloads; the AI pay line may only restate facts (an allow-list); 10 login links a day per number or email; `firm:line` logged and guarded; no brand errors in `npm run build`; the masker's dates are real ones; three review rounds (2 + 1 focused), all findings fixed; 3243 tests + 60 e2e; verified and audited DONE (see docs/work-log.md) |
| 2026-10-04 | 10 | 1.4 | Local walkthrough pack: `docs/walkthrough.md`, 43 numbered steps for Windows + WSL (setup, every screen as a worker and as resourcer, payroll and admin, the fake phone, the production-mode run, a "found a bug" template); a fake phone (`npm run sim:whatsapp`, `sim:sms`, `sim:call`: signed like Twilio, local only); sample import files (`npm run walkthrough:files`); the seed's yesterday event, 10 pay queries and Northline's short-notice firm cancellation; `db:reset` prints the urgent link; `walkthrough.spec.ts` does every step in its own run on a production build, office at desktop size; three reviews, all findings fixed; 3264 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.8 | Closed "Design tokens and shared components" (built in b3f3627): the first audit found nothing tested the tokens, focus ring, file-input button, tones or the hook-free rule, so a new `ui.design-system.test.ts` (8 tests, proven to fail on a misspelt class, a changed token and a planted hook) holds them, the tokens checked against `docs/ui-design.md`'s table both ways; a test that failed at random (a firm's random id holding "44") fixed at its cause; the Windows npm on this shell's PATH found and worked round; 3395 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.9 | GitHub CI fixed first (16 of 23 runs red since 2026-10-04, local always green): 6 tests that failed at random, found from CI's saved logs and checked by 4 investigators and 4 skeptics; two were real product faults: the credential scan's per-firm lock, lost in Phase 10, put back (a write-free lock transaction, waits at most 5 minutes; a dropped lent-out connection now logged, not a crash) and the Sheets tick de-duplicated on its own minute; the rest test faults (forced race order, a reserved "no firm" number, two checks reading random ids); each fix shown to bite; guardrails reviewed; 3396 tests + 60 e2e + the walkthrough's 3; verified (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.6 | Closed "Office shell and menu" (built in b3f3627): the first audit found four claims untested, now held: the tab titles (a unit test holds every office page's title to `docs/screens.md`, the browser checks "Shifts · Acme Events shifts"), the phone menu row scrolling sideways and the not-found page keeping the menu and its one "Log out" (checks added to two existing browser tests, no new logins), and the session keeper in the footer (a unit test, shown to fail without it); 3399 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.3 | CI again: the log commit's run failed on one more race "control" (`auth.magic-link`, "10 taps at the same moment"), the same fault as the session controls; it and the three like it (`auth.office`, `auth.otp`, `auth.rate-limit`) now read before any writes behind a barrier, so each control acts ten times every run; the real halves unchanged; 3399 tests + 60 e2e + the walkthrough's 3; verified (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.2 | Closed "Today" (built in b3f3627): the summary tiles at the top, each linking to its section, the nine sections in the order things need doing, urgent shifts as action cards and long lists as rows, all proven by `office.today-summary.test.ts` (12 tests) and the Today view and browser tests; nothing to fix; 3399 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.5 | Closed "Office screens restyled" (built in b3f3627): the first audit found four bullet-free lists without `role="list"` (the action log, pay queries, find a worker, a worker's site blocks) and no test of the pages themselves; the four fixed (markup only), and a new `ui.office-pages.test.ts` holds every office page to opening with `PageHeader` and every bare list to `role="list"` (shown to fail on one put back); 3401 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.5 | Closed "Staff screens restyled" (built in b3f3627): the first audit found five staff lists without `role="list"` and the pay query's problem list carrying `role="alert"` in its place, and no test of the staff pages; the lists fixed (markup only; the alert now a box around the list) and a new `ui.staff-pages.test.ts` holds every staff page to `PageHeader` (login and error pages to their one `<h1>`) and every bare list to `role="list"` (shown to fail on one put back); 3404 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.2 | Closed "`/office/guide`" (built in b3f3627): the everyday jobs step by step in the order of a working day, each part shown only to a role that can open it, proven by `guides.test.ts` (8 office-guide cases, real render) and the menu tests; every button name in the guide checked against a real screen; nothing to fix; 3404 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-06 | 11 | 0.2 | Closed "`/help` for workers" (built in b3f3627): 11 topics in plain words, open without logging in, held by `copy.plain-language.test.ts` and `guides.test.ts` (no shifts-line number, no privacy link, no buttons); every button it names and every time it states checked against the code; nothing to fix; 3404 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 11 | 0.6 | Closed "Docs" (built in b3f3627), resumed in a cloud session after the PC's loop stopped at 18:59 UTC on 2026-10-06 (`host_exit`); most of the time went on making the container match the PC (Node v22.23.3, Postgres and Docker, the browser links, `.test` off the proxy, `*.localhost` in `/etc/hosts`), no repo file changed for it; ui-design, screens and walkthrough checked against the code; nothing to fix; 3404 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.3 | The mock-up in the repo (12A.0): Dylan's copy (`10617f4`) kept as `docs/mockups/office-v2.html`, its role switch labelled "mock-up only" (words, accessible name and tooltip, the switch's own text when tapped); new `repo.made-up-data.test.ts` (every email address in `src/`, `drizzle/`, `tests/`, `docs/` and the seed on a reserved domain, a 4-entry reviewed allow-list that fails when an entry goes stale, the mock-up's postcodes all `ZZ`, a self-check); one test address moved to a reserved domain; §1.1 and `docs/testing.md` updated; 3409 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.7 | Remove AWS (12X.1; Dylan OK'd it in this session): the 3 Lightsail scripts and their 2 test files deleted (cloud-init's 4 tests moved to `deploy.cloud-init.test.ts`); no RDS bundle in the image, the host's CA from `/opt/shiftdesk/secrets/db-ca.pem` mounted read-only at `/app/db-ca.pem` (Docker refuses to start without it); `.env.example`'s AWS lines now the email and AI settings; AWS comments reworded in 9 source files; new `no-aws.test.ts`; runbooks and architecture rewritten for any UK/EU Docker host, 7 smaller docs fixed; guardrails SAFE TO COMMIT (4 small fixes made), 3 fact-checkers (all fixed but one older cost total, parked); 3391 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.8 | Email over SMTP (12X.2): `SmtpEmailTransport` (nodemailer 10.0.15, pinned) drives the SMTP conversation step by step and watches for DATA itself, because nodemailer labels every timeout "CONN": a failure before DATA is `EmailNotSentError` (safe to retry), from DATA on `EmailMayHaveArrivedError`; 465 TLS, any other port STARTTLS, never plain text, certificates checked; worker-only settings (console refused in production, smtp refused in tests); email routed to SMTP, texts unchanged; CSV and PDF attachments within the size limits; tests with a fake SMTP server; a log line per failed email (no address); runbook "Email not arriving"; the invariant and CLAUDE.md rule on real services; guardrails SAFE TO COMMIT (5 small fixes made); 3424 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.2 | CI fix: 12X.1's new db-ca mount check read `create_host_path` from `docker compose config`, which Compose versions print differently (CI's leaves the default out); the never-create rule is now read from `deploy/docker-compose.yml` itself, and both ways of breaking it fail the test; compose file unchanged; 3424 tests + 60 e2e + the walkthrough's 3; verified (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.8 | Claude through the Anthropic API (12X.3): `AnthropicAiClient` (`@anthropic-ai/sdk` 0.131.0, pinned) behind `AiClient`, and `getAi(env)` (no AI unless `AI_TRANSPORT=anthropic`), wired into the shifts-line reply job and the payroll digest; one request per call, no retries, 5 seconds with an `AbortSignal`; the SDK's settings that would come from the environment set in code, and its own `fetch` sends only the Messages API's address, a fixed set of headers and the settings' key; any error, refusal or empty answer is `AiUnavailableError`, so the code's fallback runs; one log line per call (purpose, model, token counts, stop reason); worker-only settings (anthropic refused in tests, pinned off in both test setups and checked by invariants); the key to the worker only; guardrails SAFE TO COMMIT (3 small fixes made); 3447 tests + 60 e2e + the walkthrough's 3; verified and audited DONE (round 2: round 1 found the review's record missing from the log) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.6 | Colours and theme (12A.1): light and navy dark tokens (D7, with 3.1's `#d92d20` danger fill and switch colours), every pair checked for contrast in both themes; every hard-coded colour in `src/` replaced by a token (29 `bg-white`, 8 `text-white`, the slate and red ones), same colours as before in light; the `sd-theme` cookie read in the root layout into `data-theme` (no flash), the device's setting otherwise, `color-scheme` meta; Plus Jakarta Sans self-hosted from its npm package (latin and latin-ext, nothing from Google); one type scale (12·13·15·18·24·30), fixed-width digits on every page, office fields 18px on touch screens (no iPhone zoom); new contrast, theme and browser theme tests; checked by eye at 375/390px in both themes; 3466 tests + 63 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.8 | Office shell and menu (12A.2): a top bar (Menu below 1024px, ShiftDesk's mark with the firm's name, the moon/sun button setting `sd-theme` with a visible tooltip, the account button with initials, name and role opening How-to guide and Log out); the one `<nav>` as a 272px sidebar, moved into a native `<dialog>` drawer on phones while open (Escape, backdrop and Close menu shut it, focus back to Menu, nothing tabbable when shut); the v2 groups holding today's pages; badges outside a link's name; "Data requests" renamed; the firm's bar hidden on logged-in office pages; `menuLink` and `accountMenu` helpers across 11 specs and the walkthrough; new e2e shell spec in both themes; the office guide's words; checked by eye at 375/390/1280px in both themes; first verify failed 3 of my own e2e checks (fixed); 3477 tests + 69 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-07 | 12 | 0.7 | Pay dashboard (12A.3): `/office/pay` (payroll's home; `/office` sends them there) with the shifts line, four counts (waiting with the oldest, the next digest with the last sent, sorted this week, the next pay date from records or the pay week) and two sections (the biggest groups, each opening Pay queries; "Recently sorted", one row per sorting with who, when and the note); `nextDigestAt()` (09:00 local across the clock change); `pay-week.ts` (ISO week, paid the Friday after) for the top bar's pill from 1024px; the Pay queries badge; "Pay dashboard" in place of payroll's "Home"; no strike or pay figure shown, resourcers can't open it; first verify failed 2 browser tests from payroll's new landing (fixed); 3490 tests + 71 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-08 | 12 | 1.2 | Events and session fields (12B.1): migration 0035 (the first that changes data) adds `shift_events` (RLS, no DELETE, only its switch updatable) and on `shifts` a NOT NULL `event_id` plus pay rate (whole pence), post, meeting point, uniform, extra requirements and a switch; it groups every existing shift into an automatic event per site and firm-local start day ("Acme Demo Arena · Sat 10 Oct"), proven on a scratch database at 0034 and on the demo data (48 shifts, 6 events); the sheet sync, file import, "New shift" and seed put new rows into the same events (one per site and day, held by a unique index; two at once tested); "Shifts for an event" makes its own named event; a "Session details" form on every shift (sheet and file ones too, which the sync and import never touch); `shift.changed` names `requirements`; guardrails no FIX FIRST (8 small improvements made); 3548 tests + 71 e2e + the walkthrough's 3; verified and audited DONE (round 1); planning research ran earlier in the day (see docs/work-log.md) |
| 2026-10-09 | 12 | 0.6 | Session requirements and CSAS (12B.3): the rules engine checks a session's extra requirements (`extraTypes`, required in its input) on top of the role's, each in date until the session ends, never overridable, still failing closed with no rule for the role; both loaders pass them, the day's "applied" count includes them; the security pack gains CSAS accreditation, a manual handling certificate and a `csas_officer` role needing CSAS; the rules doc (CSAS is the firm's own scheme's) and its three new test cases; guardrails FIX FIRST (the "applied" day lock skipped a session's requirements, a race test now proves it) fixed; a browser test's payroll-login race fixed; 3565 tests + 71 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 2.2 | What casuals see (12B.4): one check (`src/lib/roster/visibility.ts`: the session's switch and its event's) used by Open shifts, the urgent board and the Home count, the shift page ("This shift isn't available"; a former booker still sees cancelled), a casual's booking and review request (refused), offer waves and dropout waves (none start, a queued one stops "hidden") and the office's offers (refused); the office still assigns, booked casuals keep their place; `setShowing()` for active admins and resourcers, logged `event.shown/hidden` and `session.shown/hidden` with who, showing again restarting offers for urgent gaps; a shared lock on the event so a switch and a booking or offer take turns (no deadlock: only `setShowing()` locks events exclusively); guardrails FIX FIRST (review requests, a wrong log line) and 3 SHOULD items fixed; 3604 tests + 71 e2e + the walkthrough's 3; verified and audited DONE (round 1); includes a pause for a container restart (see docs/work-log.md) |
| 2026-10-09 | 12 | 0.7 | Events & sessions pages (12B.5): `/office/events` (tabs All, Showing, Hidden, Urgent not filled as links; a card per event with a session to come: its switch, one status tag, "N sessions · N places free", each session's role, times, "Urgent" on a gap, requirement chips, "N/M filled", £/hour, post, meeting point, uniform and a "…" menu to offer, assign, mark urgent, change or cancel; "Add shifts" and "Import shifts" without a Google Sheet) and `/office/events/[id]` (every session with its own uniquely named switch, who is booked, "Mark who worked"); "Events & sessions" replaces "Shifts" in the menu, the shift routes stay; loaders read no pay record (tested); guardrails no FIX FIRST, 8 SHOULD items fixed; checked by eye at 375/390/1280px light and dark; 3625 tests + 72 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.1 | Settings (12B.7): migration 0036 `app_set_firm_setting()` (owner-run, the app's only way to change `firms.settings`: `strikes.email` and `strikes.email_verified_at` only, a new address clears its confirmed time) and 0037 (stricter checks); `/office/settings` for admins: the strikes team's email, confirmed by an HMAC link (7 days; signs the firm, the address, which save of it and the expiry) emailed by a worker job, at most 3 links every 15 minutes and 10 a day per firm; the public `/confirm-email` (link in the fragment, confirmed only on a button, failed links counted per IP); each site's postcode, refused while booked sessions still to come use it (site and sessions locked first); guardrails FIX FIRST (a postcode change could race a booking) and every SHOULD fixed; 3674 tests + 74 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.6 | Strikes on cancel (12C.1): migrations 0038 (`assignments.cancel_via` and the strike warning's version and time; the `strikes` table, the app reads and adds rows and changes only review, withdrawal and evidence columns; the owner-run `app_purge_old_strikes()`) and 0039 (a strike kept 6 months past its counting); the pure `strikeDecision()` inside `cancelBooking()`'s transaction (the office's: none; 48 hours: none; booked or changed by the office: exempt; otherwise a strike, flagged for "I'm unwell" or "Family or caring"), its code in every `shift.cancelled`, `strike.issued` with ids and hours only; the casual's warning (worked out when the step opens, checked on confirm; a strike only against a warning that said so), the done screen and "Tell us what happened"; the owner's three strike settings; the nightly purge; strikes in the data export; `docs/dpia-strikes.md`; guardrails FIX FIRST (a cancellation's account taken for a rules review) and every SHOULD fixed; 3741 tests + 75 e2e + the walkthrough's 3; verified and audited DONE (round 2) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.4 | Cancellation records (12C.3): `/office/cancellations` (this week's counts, the views All, Under 48 hours (the firm's `strikes.notice_hours`) and By the office as links, the latest 100) and `/office/cancellations/[ref]` (every field of §3.4, opened by the reference or the booking's full id; a shared reference lists its cancellations to choose from); a PDF (`pdf-lib` and fontkit, Noto Sans cut down beforehand and embedded whole, "✓" from Noto Sans Symbols 2; black only) and a CSV (§3.4's 22 columns, counted first, refused above 20,000), a casual's reason always "Casual's own reason (see ShiftDesk)", each download logged `export.downloaded` and refused when another site starts it; every cancellation now records what became of its place in `shift.cancelled` (reopened with the row's id, started, above the places, removed, the whole session), so "Then" states only what happened; guardrails FIX FIRST ("whole session cancelled" guessed from today's status) and every SHOULD fixed; 3761 tests + 76 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.2 | Evidence email to the strikes team (12C.4): the `strikes.evidence_email` job (ids only), queued with each strike in its transaction; claim → send → record under the firm's strikes-email lock; only to a confirmed address (else `not_set_up`, sent once the address is confirmed); §5.6's subject and body (`strikeEvidenceEmail()`, no full stop after the link, the subject kept to 200 characters with its reference) with the record PDF (a casual's reason as "Casual's own reason (see ShiftDesk)", nobody else named); retried only on `EmailNotSentError` as new jobs (4 attempts), otherwise `failed`; one series at a time; "Resend evidence" on the record (logged); a "Strike evidence" to-do on Today (failed or held up, the address unconfirmed) until the dashboard (12E.1); guardrails FIX FIRST (a test never reached the address check) and every SHOULD fixed; 12 mutation checks; 3800 tests + 77 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.2 | Strikes page and the casual's strikes (12C.5): `/office/strikes` for admins and resourcers (Live, Needs review and All as links; one card per casual, sorted by live strikes, with the latest strike's session, notice, status and evidence, and links to each strike's record; first in Records, no badge); "Withdraw strike…" (a reason of 1–500 characters kept on the strike row, never in the log; `strike.withdrawn` with ids only; the casual locked first, refused once they're erased) and "Keep strike" (any live strike not yet reviewed, so `strike.reviewed` never shows the health or caring flag) on the strike's cancellation record; the casual's Strikes on `/profile` (the count in the last 90 days, each strike's session, notice, until when and status, "Tell us what happened" once per session); erasure clears the withdrawal reason; guardrails FIX FIRST (a withdrawal could race an erasure; the log entry revealed the flag) and every SHOULD fixed over two rounds; 3824 tests + 78 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 1.5 | Postcode look-ups and the casual's travel area (12G.1): a `Geocoder` (`src/lib/travel/`: the fake, made-up points for the ZZ postcodes and "off" for real ones; postcodes.io, one GET of the postcode alone with a 5-second limit and a 64 KB cap, its answer checked with zod; never called tonight: hand-written answers in its documented shape) chosen by `TRAVEL_PROVIDER` (`fake` pinned for tests and e2e, `traveltime` refused under test); site postcodes looked up on Settings before the write and saved with their point, with each site's location status; migration 0040 `worker_travel` (RLS, composite key, column-level updates only); `/profile/travel` (start-from postcode, Car / Public transport / Both, 30–90 minutes, the district line, remove) logged `travel.profile_changed` {changed, maxMinutes}; the office and the firm's export see the district only; deleted on "They've left" and erasure, in the casual's export; `docs/dpia-travel.md`; guardrails FIX FIRST (the firm export held full postcodes) and every SHOULD fixed or parked; 3884 tests + 79 e2e + the walkthrough's 3; verified and audited DONE (round 2, after carrying the planner API's look-up into 12J.1); includes about 5 minutes on an unrelated check Dylan asked for |
| 2026-10-09 | 12 | 1.6 | Travel estimates (12G.2): a `TravelProvider` (`src/lib/travel/provider.ts`: the fake, times from the straight line; TravelTime's time-filter, an arrival search 30 minutes before the start, up to 2,000 start points under meaningless ids, a 90-minute ceiling, the distance by car, its answer checked with zod under a 10-second limit and a 2 MB cap read as it streams; never called tonight: hand-written answers in its documented shape); migration 0041 `travel_estimates` (keyed by postcode, site, way and arrive-by, never by person; RLS); the `travel.estimates` job (worker only, ids only, one group at a time in short transactions, searches with no transaction open, saved only if the site hasn't moved, a 10-minute budget, retries backing off over 3 to 4 hours, one job at a time) queued by new, imported, synced, moved and urgent sessions, a site's postcode change (old estimates deleted), casuals' changes (one shared run 5 minutes later) and a nightly run at 02:20 over 29 days; the first urgent wave fills its own for at most 5 seconds; purged 7 days after the last session; `travelFor()` and the travel line's words with the straight-line fallback; guardrails FIX FIRST (two casuals sharing a postcode broke the save) and every SHOULD fixed over two rounds; 4126 tests + 79 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 0.8 | The travel filter and travel lines (12G.3): `src/lib/travel/area.ts` (`areaVerdict()`: in when any chosen way is within the limit, out only when every chosen way has an estimate and none is, otherwise unknown and still shown and offered; the same rule as SQL, `outsideArea()` and `nearestMinutes()`, held to it by a test over 25 cases × 3 ways); Open shifts, the urgent board and Home's urgent count filtered inside the query before the 50-row cap (and the day/site/role choices), urgent first, then the nearest, then the date; offer waves skip out-of-area casuals (the office's offer by hand doesn't: `byHand`, a tripwire lets only the office pass it); travel lines on Open and urgent cards and upcoming bookings; "Add your home area…" with no area; "{n} more shifts are further than you travel. Change how far"; a direct link still books; a Drizzle quirk (bare columns in a join-less query's select) fixed in the count; new e2e `travel.filter.spec.ts`; guardrails OK, every item fixed or parked; 4160 tests + 80 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-09 | 12 | 2.1 | Qualification statuses and the Casuals pages (12F.1): pure `qualificationStatus()`, `listQualifications()`, `rightToWork()` and `needsUpdating()` in `src/lib/credentials/status.ts` (Valid, Expiring soon, Expired, Missing, Applied for, Suspended, read in the rules engine's order; only the types her roles need; right to work as a status only; §4.2's four levels, an application counted only as check 4 allows); one 30-day window (`EXPIRING_SOON_DAYS`) shared by the expiry scan, the office and My shifts; one loader for every casual in five reads; Profile's "Qualifications" and My shifts' "Needs updating" card ("credential" never shown); Workers became Casuals (`/office/casuals`: All and Need updating with counts, "Find a casual", a table on a computer and cards on a phone; `/office/casuals/[id]` with needs updating, qualifications, right to work, travel area, strikes and access; the old addresses redirect); guardrails OK, every item fixed; two browser tests and the walkthrough's step 18 brought up to the new words; 4203 tests + 82 e2e + the walkthrough's 3; verified and audited DONE (round 2, after adding a browser test of the rendered office pages) (see docs/work-log.md) |
| 2026-10-10 | 12 | 2.3 | Uploads, the check view and the staff photo (12F.2): migration 0042 (`uploads`: the bytes, sha256, one waiting per casual per photo or type; on `credentials` `check_state`, `rejected_reason` and `evidence_upload_id`, with a check that an unchecked record is always stored as expired) and 0043 (`credential_types.office_recorded`); every reader the rules and messages use counts checked records only; the phone shrinks a picture to a 1,600px JPEG, the server reads its type from the first bytes, refuses it over 950,000 bytes or 40 million pixels and redraws it with `sharp` (no location data); `/files/[id]` for the casual and their firm's admins and resourcers only (`private, no-store`, never offline); approve (expiry and number as read by a person, or a deliberate "no expiry" tick; the GOV.UK register for SIA) or reject with a reason, on the casual's page and in Casuals' "Uploads to check" (oldest first, menu badge); CSAS, right to work, health and criminal record items recorded by the office only; the staff photo's status (36 months, "Due soon" at 30 days, a firm setting); rejected and replaced images purged after 30 days; exports list image details, never the bytes; expiry reminders link to the upload page only where she can upload; guardrails FIX FIRST ×2 (a resend could delete a just-approved photo; reminder links to pages that refuse the type) and every SHOULD fixed; 4296 tests + 83 e2e + the walkthrough's 3; verified and audited DONE (round 1); 16:28–17:54 on 9 Oct and 12:05–12:59 on 10 Oct, the gap an idle container (see docs/work-log.md) |
| 2026-10-10 | 12 | 1.3 | Enquiries (12D.1): migration 0044 (`requests.message_id`, a real link to the shifts-line message, cleared and never the question when the message goes (`ON DELETE SET NULL (message_id)`, by hand); one question per message; the `reply_to` index; the old payload id moved over, proven on the dev database); `/office/enquiries` (All, Need a person, Requests from the app, Pay; today's count and Need a person with the oldest's age; outcome labels worked out by code from the log; the AI banner while `AI_TRANSPORT=none`) and `/office/enquiries/[id]` (the conversation, "How it was answered" from logged facts, "No checks recorded" until 12D.2); the reply box (free text inside WhatsApp's 24 hours, else `request_update`, said in one line; stored at once, sent by the new `enquiry-reply` job from the firm's current line; a failed send puts it back) and "Close without a reply" with a reason code; Requests from the app ("Answered" for a question); `/office/requests` redirects; the menu badge; guardrails FIX FIRST ×2 (four unit lists; the reply went from the old number) and every SHOULD fixed (orphaned questions, a stranger's STOP, unknown callers, the old request path); 4358 tests + 84 e2e + the walkthrough's 3; verified and audited DONE (round 1) (see docs/work-log.md) |
| 2026-10-10 | 12 | 2.0 | Personal replies (12D.2): the shifts and cancel replies built per casual by code from the casual app's own Open shifts (`src/lib/inbound/personal-reply.ts`: at most 5 on WhatsApp and 3 by text, urgent first then nearest, each with event, site, times, pay, post and the travel line; day words and her bookings on the days she named; always within 1,600 characters; the cancel reply names her next booking, with the strike sentence only when a strike would apply); "Automatic reply. Send OFFICE to reach a person." on every automatic reply; `checkEligibility()` returns every check with its figures, the decision unchanged; the `enquiry.checks` log entry for the channel that went, and the Enquiries page's "Checks made by code" and "Considered but not offered"; guardrails FIX FIRST ×2 and six SHOULDs fixed; audit round 1 NOT DONE (the automatic line, the text's travel, the review's record), round 2 DONE; 4,420 tests + 85 e2e + the walkthrough's 3 (see docs/work-log.md) |
| 2026-10-10 | 12 | 2.1 | Dashboard and Needs attention (12E.1): `/office` is the Dashboard in place of Today (the shifts line under the title; four counts labelled as the spec says, each a link to its list, "today" being London's day, with new `?day=today` filters on Cancellations and Enquiries; the sections Urgent shifts not filled (each session's line written by code from its offers; the hidden warning on a hidden event or session), Showing to casuals, the latest cancellations and enquiries, and Needs attention (bookings to check, the rota sheet, who worked?, a new "Qualifications out of date on a booking" read as the rules read it, uploads to check, strike evidence), each part in its own savepoint with its own error words; the bell in the top bar; `/office/today` redirects); 15 docs, the guide and the walkthrough follow; guardrails SAFE (5 SHOULDs fixed: a cross-firm test, every part loads, the applied allowance, offers past 50, unsent replies); an older bug fixed (the resend evidence answer vanished on refresh); 25 break checks caught; 4,435 tests + 86 e2e + the walkthrough's 3; audit round 1 NOT DONE (a hidden session; no summer-time test), round 2 DONE (see docs/work-log.md) |
| 2026-10-11 | 12 | 3.9 | Planner API and API keys (12J.1): ADR-022 and golden rule 3's planner exception first; migration 0045 (`api_keys`: only a key's sha256 and last 4 characters, the app may only read, add and mark used or revoked; owner-run `app_api_key_lookup()` returning ids only; `api` as a session, event and cancellation source) and 0046 (a revocation is final: a trigger); `handleApiRequest()` (the platform address only, JSON up to 64 KB, a key's shape checked before any look-up, 30 refused keys a minute an address, 300 calls a minute a key, Gate B, one log line, never a key or the header); `PUT`/`GET /api/v1/sessions/{ref}` and `GET /api/v1/cancellations` as §5.3.2 says, the planner a second caller of the office's whole-session move and cancel (no office user, its sessions only, the key live in the same transaction, every failed check blocking, `cancel_via` api, never a strike); the office's "planner" refusal; Needs attention's "Your planner's change was refused"; `/office/settings/integrations` (admins: keys shown once, revoke, the codes); `INTEGRATIONS_SECRET`; `docs/integrations.md`; guardrails FIX FIRST twice (a kept booking let the planner's move through; a cancel could be stopped by its site) and every SHOULD fixed, each with a test that fails without it; a Sunday-only browser test fixed (two sessions in one week); 4,670 tests + 88 e2e + the walkthrough's 3; audit round 1 NOT DONE (an untested path; the review not on record), round 2 DONE; 18:26–18:29 on 10 Oct and 15:46–19:35 on 11 Oct, the gap an idle container (see docs/work-log.md) |
| 2026-10-12 | 12 | 2.4 | Webhooks to the planner (12J.2): migration 0047 (`app_set_firm_setting()` takes `webhook.url` and `webhook.rotate`, and raises `webhook.signing_version` itself); the action log as the outbox (`recordEvent()` queues one `webhook-deliver` job, ids only, in the same transaction for bookings, cancellations and withdrawn strikes; `recordEvents()` refuses them); bodies built when sent from 12J.1's records under one strict zod contract per type, printed in `docs/integrations.md` and tested equal; Standard Webhooks signing with derived secrets; the safe sender (an explicit block list per address family, DNS through its own resolver with a time limit, the checked address only, no redirects, 5 s/10 s, codes only); the queue's own retries, the last try logging `webhook.failed`, raising Needs attention and completing; the Integrations page's Webhook section, the record's "Your planner" line; two real bugs caught by the new tests (one block list refused every IPv4 address; batches let one firm's hanging endpoint hold up another's); guardrails SAFE, 4 SHOULDs fixed; container fixes (Caddy from Docker Hub's mirror, the dev server killed for memory: verify in CI mode); 4,775 tests + 89 e2e + the walkthrough's 3; audit round 1 DONE (see docs/work-log.md) |
| 2026-10-12 | 12 | 1.2 | Casual app tab bar and Home (12H.1): a bottom tab bar on every logged-in casual page (Home, Shifts, Pay, Profile; the current one marked; a dot on Profile when a qualification or the staff photo needs her, named "Profile, something needs updating"); Home (`/`) rebuilt as §4.2 says (Needs updating with the photo row, up to 3 urgent shifts with role · event, site, pay and travel line, her next shift in full with post, pay and estimate, report to, bring and wear, getting there, then the top 3 to apply for); Booked moved to `/shifts` with an Open/Booked switch (`/?view=past` redirects); the offline copy keeps Home and Booked, each on its own; Log out, My requests and Help at the end of Profile; Help rewritten for the tabs; 11 browser specs moved to the new places (none weakened) and a new Home browser test with its own scene; root causes fixed on the way: a test helper broke a database rule, Playwright's offline switch didn't reach the service worker on a cross-page open, and screen readers would have read "Profile , something…"; 4,797 tests + 90 e2e + the walkthrough's 3; audit round 1 DONE (see docs/work-log.md) |
| 2026-10-12 | 12 | 0.7 | Shifts list and shift page (12H.2): one shared reader for what a session needs (its role's rule, then its extras; Events & sessions, Cancellations and the casual app all use it) with the office's short chip names; each Open and urgent row as §4.3 says (role · event linking to the shift's page, site, "date and time · £/hour · post", the chips, places left, the travel line; filters and the 50-row message as built), and the chips on Home's cards; the shift page in full for a shift she can take, is held for, is blocked from or is booked on (chips and title, the facts with pay and its estimate, Meet, Post, Uniform, Places "1 of 4 left", "Getting there" from her home area with "Open in maps", "What it needs" with her status for each, Take shift and the strike note with the firm's own hours); an automatic event no longer named on casual pages; guardrails FIX FIRST (an "upload it" link to a page that refused the type) and 4 SHOULDs fixed; 4,820 tests + 91 e2e + the walkthrough's 3; audit round 1 DONE (see docs/work-log.md) |
| 2026-10-12 | 12 | 0.4 | Profile and help (12H.3): most of Profile was built by earlier tasks (photo card, qualifications, right to work, travel area, strikes, the end links); "Your details" now in §4.6's words; `/help` gains "Cancelling and strikes", "Your travel area" and "Qualifications and photos", stating each firm's own notice hours, strike length and photo renewal (`helpFacts()`, read in the firm's own transaction), and the postcode data's attribution word for word (the plain-language test lets off that exact passage alone, and checks it's there); new browser check of Profile's photo card; 4,823 tests + 91 e2e + the walkthrough's 3; audit round 1 DONE (see docs/work-log.md) |
| 2026-10-12 | 12 | 1.6 | Demo seed (12I.1): the mock-up's made-up story for Acme (`seed-story.ts`, `seed-story-load.ts`): the confirmed strikes team, six events (Hillside switched off) with every session's pay, post, meeting point and uniform, eight casuals with their qualifications, photos, strikes and travel areas, fixed travel times, the cancellations (two strikes, one flagged, one withdrawn, the office's), two sorted pay groups, uploads waiting, and three shifts-line messages answered by the real reply job (no AI, nothing sent; Dylan allowed the seed in the AI boundary test); every open place needs what only the story's casuals hold, so the walkthrough's lists are unchanged; older seed tests scoped to their own rows; guardrails FIX FIRST ×5 and every SHOULD fixed; audits: round 1 and 2 NOT DONE (the replies), Dylan decided, round 3 DONE; 4,837 tests + 91 e2e + the walkthrough's 3 (see docs/work-log.md) |
| 2026-10-12 | 12 | 0.4 | Guides and docs (12I.3): the office guide's "Getting around" (the drawer, Log out under your name, the bell for admins and resourcers) and "Connect your planner" in three steps, with tests; CLAUDE.md planner-first and `integrations/`; compliance (the Article 9 condition for "I'm unwell", strike cautions), the privacy notice (photos, strikes, the planner, the travel services), ADR-023 (TravelTime) and ADR-024 (images in Postgres), testing.md's fakes, the guide row in screens.md; doc-fact-checker's 6 findings fixed; shared verify with 12I.4; audit DONE first round (see docs/work-log.md) |
| 2026-10-12 | 12 | 0.4 | Verify and the walkthrough (12I.4): 8 new walkthrough steps and their browser test steps (Zoe Adeyemi's travel lines and area, Kieran's strikes and upload page, Enquiries' messages, Cancellations, Strikes, uploads to check, the Pay dashboard, Settings with `/confirm-email`, connecting a planner with a key and a `curl`), steps renumbered; `RUN_E2E=1 ./scripts/verify.sh` VERIFIED (4,839 tests, 91 browser tests, the walkthrough's 3); audit DONE first round (see docs/work-log.md) |
| 2026-10-15 | 12 | 2.4 | Phase 12 loose ends (12L.1): travel estimates' three untested paths tested (the 02:20 nightly run, a dropout's queued run, the wave's worker deps); the three older downloads refuse another site (403); shifts-line replies name events as the app does; day words read only as days (apostrophes kept, "I sat", "the sun", "getting wed", possessives); Home's urgent chips pinned; today's cancellations CSV holds today's only, named and logged with its date; Enquiries follows the firm's message retention; the unknown-number alert links Need a person; the planner API's own 405 and OPTIONS (logged, host-checked); the guide's planner note; tests for the phone's theme and the AI's fallback reasons; guardrails FIX FIRST ×2 ("constructor" crashed the reply; an emoji at the 500th character lost the message) over three rounds; 4,856 tests + 91 e2e + the walkthrough's 3; audits NOT DONE ×2, round 3 DONE; not pushed (the ruleset) (see docs/work-log.md) |
| 2026-10-16 | 13 | 1.8 | Safety net (13.1): verify.sh fingerprints the files at the start and refuses the stamp if they change, runs the production build, never skips invariants.sh; a tick needs a stamp with the browser tests; the tick guard reads each task's own box (a moved tick, `[X]`) and watches shell commands that write PLAN.md; the Stop hook catches more ways of saying done, up to 3 blocks; invariants.sh refuses Playwright's fixme, fail and run-time skips (code and JSON reports), checks scripts/ for the firm setting, and refuses a Twilio import in tests; the reviewers and the auditor are read-only by hook (commands read as the shell reads them); 34 safety-net tests run every hook, invariants.sh and verify.sh on sample input; 4,890 tests + 91 e2e + the walkthrough's 3; audits NOT DONE ×2, round 3 DONE (see docs/work-log.md) |
| 2026-10-16 | 13 | 1.1 | The shifts line's last try (13.2): a message whose answer fails on every try (3 retries, 2 seconds apart) is passed to a person on the last try (Need a person on Enquiries, "The automatic answer failed on every try ({code})"), logged once, nothing sent, and the job still fails so the ops alert reports it; a STOP or START still counts (claimOptOut, shared with the reply job); former casuals keep their name; the code clamped; 11 integration tests (a real pg-boss worker on its own queue, a row-lock race, a STOP, a stranger, an older message) and 13 break checks; guardrails FIX FIRST ×1 (the lost ops alert) and every SHOULD over two rounds; 4,901 tests + 91 e2e + the walkthrough's 3; audit DONE first round (see docs/work-log.md) |
| 2026-10-16 | 13 | 1.8 | Web push sender (13.3): `web-push` behind `PUSH_TRANSPORT=webpush` (refused in tests, and in production until the push leaves the record's transaction: "Connect the real web push" step 0); each push encrypted for its phone, signed with the VAPID keys, kept 12 hours at most or until the shift starts, urgent ones at high urgency, cut off at 5 seconds (connection closed), a worker's phones pushed at once; 404 and 410 forget the phone, other failures keep it and log the host and a code; push addresses only in the exact form a browser gives, to the browser makers' push services (guardrails found a `%2E` host that web-push would have sent elsewhere: fixed); 10 saves every 15 minutes per casual (429); compliance and privacy notice; a fake HTTPS push service that checks the signature and decrypts; guardrails FIX FIRST ×2 over three rounds; 4,912 tests + 91 e2e + the walkthrough's 3; audit DONE first round (see docs/work-log.md) |
| 2026-10-16 | 13 | 1.4 | Privacy switches (13.4): travel areas per firm (`travel.enabled`, off unless the owner switches them on; on for the demo firm): off, no "Where you work" (its page not found, saving refused, even mid-look-up), no prompt, travel lines, "further" line or help on it, nothing filtered or ordered by distance (lists, urgent board, shifts line, waves), no travel-time search (and a running job stops), the office's column and card hidden, an enquiry's check says so; `pay_query_update` now says payroll has answered with the pay page's link, the note only on the pay page; both states tested (unit, integration, a browser test), 24 break checks; guardrails FIX FIRST ×2 (docs) over two rounds; CI's one failure, a webhook test reading a job's state before pg-boss finished it (offWork without `wait`), reproduced and fixed; saved areas when switched off parked for Dylan; 4,927 tests + 92 e2e + the walkthrough's 3; audit DONE first round (see docs/work-log.md) |
| 2026-10-16 | 13 | 1.5 | Tidy-ups (13.5): "Cancel with the link" in the 24-hour reminder; login links 60 per address every 15 minutes (was 10; per number unchanged); one shared cut between whole characters (`src/lib/text/cut.ts`) at both webhooks, the voicemail, the AI's input and four more places; "Take shift" 20 taps per casual every 15 minutes; licence expiry messages by the casual's own channel (`sendToWorker`); the image with production dependencies only (2.22 GB to 1.73 GB locally; `tsx` a dependency, a build-time check); Open shifts batching and the flaky sheets test found already done (Phase 10; 2026-10-06), both now pinned by tests; 18 break checks; guardrails no FIX FIRST, 2 SHOULDs fixed, over two rounds; a container restart mid-task (its 2.6 hours not counted); 4,942 tests + 92 e2e + the walkthrough's 3; audit DONE first round, with Phase 13's Done-when line (see docs/work-log.md) |
| 2026-10-19 | — | 0.2 | Not a PLAN task: "ShiftDesk Walkthrough", a page for Dylan's boss telling one urgent gap's story in 12 real screenshots of a production build (the office offers it, a casual without a valid licence is stopped, one with it takes it from the WhatsApp link, the office sees it filled and logged, a cancellation with its notice, the shifts line, payroll's groups), taken by a script on the walkthrough's own seeded demo; published as a private artifact (see docs/work-log.md) |
| 2026-10-19 | 14 | 1.1 | Pushes after the record's transaction (14.1): all 7 senders push once the message has gone, the phones read in a short transaction of their own and pushed with none open, the outcome (gone phones forgotten, only if their keys are unchanged, in a savepoint; the count) recorded in the sender's own transaction; a push that throws, even at once, or a lookup that fails never loses the record; an error's name never logged; a call with a transaction open refused; production now takes `PUSH_TRANSPORT=webpush`; every sender's test checks no transaction is open at each push; guardrails no FIX FIRST, 5 SHOULDs fixed; the first full check caught 4 no-resend tests whose fault now hit the push's lookup (harness now fails every transaction after a send); 9 break checks; 4,947 tests + 92 e2e + the walkthrough's 3; audit DONE first round (see docs/work-log.md) |
| 2026-10-19 | 14 | 0.6 | Login safety and the log's filters (14.2): an ops alert when a firm sends more than 100 login links by WhatsApp and text in an hour, and another over 300 in 24 hours (the review's slow drip), each its own key; an alert, not a ceiling; the words only the firm's short name and a count, through the masker; the office log files each limit reached by its name (Take shift under Bookings, phones under Workers, the planner's key and the strikes team's links under Firm settings, the rest under Logins), the filter and the list agreeing, every limit the app has covered by a test; a stale doc line on login-link failures corrected; guardrails no FIX FIRST, 2 SHOULDs fixed (the strikes links, the day count); 11 break checks; 4,952 tests + 92 e2e + the walkthrough's 3; audit DONE first round (see docs/work-log.md) |
| 2026-10-19 | 14 | 0.5 | Small fixes (14.3): the shifts line's last-resort reply always signed (golden rule 8), its text cut to leave the sign-off room; automatic event names cut the site's name between whole characters (never half a flag); a licence warning caught up after a crash logs no channel rather than guessing; the new event-name cases folded into the existing test file; guardrails no FIX FIRST or SHOULD, its notes acted on (two comments and a doc line, an unmasked error name parked); 5 break checks; 4,954 tests + 92 e2e + the walkthrough's 3; audit DONE first round, with Phase 14's Done-when line; Phase 14 in all 2.2 h (see docs/work-log.md) |
| 2026-10-19 | — | 1.3 | Not a PLAN task: the full walkthrough (`walkthrough-site/`, also a private artifact): 82 real screenshots of a production build from one scripted run of the demo with every casual on texts (the casual's app, the office, payroll, the admin, a second firm), a 10-step story, every feature with what it does and how, the real texts the run sent, the rules, the records, and what's left; a static page any host can serve (Vercel: Root Directory `walkthrough-site`); Dylan's no-WhatsApp/Twilio decision recorded and Phase 15 proposed; the 14.3 work-log entry's broken last line fixed (see docs/work-log.md) |
| 2026-10-20 | 16 | 1.7 | Demo mode in the app (16.1): with `DEMO_MODE=on` production prints texts, emails and planner webhooks into the outbox and nothing else leaves the server; the worker refuses to start, and stops, unless every firm is a made-up demo firm and everyone in them made up, refuses other firms' jobs, and stops after 3 missed checks; each outbox line stamped with the sending firm, each demo firm's Demo phone (`/demo`) showing only its own; the app's look-ups find no other firm in demo mode; the whole site behind one password (the app's own check; the planner API checks its own key); two guardrails rounds (F1 shared-number isolation, then the layout-only refusal, both fixed); the walkthrough's browser run now production demo mode behind the password; a weekday bug in the demo seed's story test fixed (Tuesdays and Wednesdays); 5,037 tests + 93 e2e + the walkthrough run's 6; audit DONE first round (see docs/work-log.md) |
| 2026-10-20 | 16 | 1.1 | The demo server (16.2): `deploy/docker-compose.demo.yml` with the real compose file, chosen by `COMPOSE_FILE` (Postgres in Compose over a socket only, demo mode and every sender set in the file, the outbox a shared volume, a one-off reset); `deploy/demo-reset.sh` and a 04:00 nightly timer loading the demo afresh (refused unless demo mode, a database on the server, the superuser's login and a database it made itself holding only the demo firms); the demo database refusing real numbers and emails itself (a hardened trigger); `deploy.sh` following `COMPOSE_FILE`; the site password now the web app's own rule (503 and unhealthy without it: a Docker rehearsal caught the worker crashing on the old settings rule); runbook "A demo server" step by step; a local Docker rehearsal of the whole stack; guardrails no FIX FIRST, 6 SHOULDs fixed or parked (Gate B, "Connect hosting"); 5,071 tests + 93 e2e + the walkthrough run's 6; audit DONE first round, with Phase 16's Done-when line; Phase 16 in all 2.8 h (see docs/work-log.md) |
| 2026-10-20 | 17 | 2.6 | Easier to scan: a flat look in each firm's own colour, Home, Open shifts, Pay and Booked laid out to scan, the office dashboard leading with what needs someone, Events folding full sessions, Casuals tags only for problems; the safety review's pay fix and an enquiry confirmation fix. 17.2 audited DONE and ticked; 17.1 NOT DONE after 3 audit rounds (three test gaps) (see docs/work-log.md) |
| 2026-10-20 | 17 | 0.5 | 17.1's fourth audit round (Dylan allowed it): tests that Pay has no "Back to my shifts" and every Open shifts card is a hairline with no red edge, one shared `switchTrack` for both Shifts-tab switches; audited DONE and ticked (see docs/work-log.md) |
| 2026-10-21 | 18 | 3.5 | The redesign (18.1 to 18.5): Public Sans and Barlow Condensed self-hosted, colours on the UK safety-sign roles with every pair passing the contrast test and each firm's colour worked out per theme, the date tile, sign plate and seats; the casual Home's pass that opens in place, the "Can't make it?" sheet (held open while a cancel is sent, the safety review's fix) and For you; Open shifts' 8-day strip, cards and the shift page's bottom bar; the office menu in four groups, the dashboard as "what needs you" with its week in places, Needs attention on its own page; Events as a two-week rota board whose rows open into a sessions table; audit round 1 refused at the gate (committed after verify), round 2 DONE for 18.1 only, round 3 DONE; 2,942 unit + 2,215 integration tests + 94 e2e + the walkthrough's 6 (see docs/work-log.md) |
| 2026-10-21 | 19 | 1.2 | The strike's answer stays on screen (19.1): the record always renders the strike's buttons for whoever may change strikes (nothing when there's no button and no answer), so "Withdrawn. …", "Kept, …" and "already withdrawn" outlive the refresh that takes their button away, and the withdraw form closes once the strike can't be withdrawn; which buttons show is one tested rule (`strikeButtons`); the flaky `office.strikes.spec.ts` now fails every time without the fix; two new browser tests (a deleted casual's strike kept; a strike withdrawn elsewhere while the form was open); each test seen to fail with its bug put back; 5,159 tests + 96 e2e + the walkthrough's 6; audit NOT DONE in round 1 (three behaviours untested), DONE in round 2 (see docs/work-log.md) |
| 2026-10-21 | 20 | 5.0 | The pass redesign (20.1 to 20.5), from Dylan's mock-up of his five reference screenshots (1.3 h for the analysis and two mock-ups, 3.7 h to build): Instrument Sans and Instrument Serif self-hosted, true dark greys in place of navy (D7 changed), the status colours as tiles, five depth tokens and no other shadow; the casual Home's pass in the firm's colour with Directions, Details and "Can't make it?", For you as tiles with Pay day, the sheet's four reason buttons and its pull-down handle; Open shifts, a shift's page and Booked; the office with no top bar from 1024px, "Needs attention" in the menu in place of the bell (one count), the Dashboard listing every urgent place, Needs attention's page; the events board's switch moved into the opened row. A code review's 6 findings fixed (red on the Today pill, a lost confirmation, the urgent places' order, the "…" buttons' names, a start line, focus on a second press) and the safety review's hardening (the roles pinned, an honest "+", cross-firm checks); the firm's colour now reads on its own tint for every colour, and the gate's plate is white for every colour. 5,175 tests + 96 e2e + the walkthrough's 6; audits: 20.1 and 20.3 DONE in round 1, 20.2, 20.4 and 20.5 DONE in round 2 (see docs/work-log.md) |
| 2026-10-22 | 21 | 4.5 | The office's look (21.1 to 21.4), from Dylan's brief and five references: the office's own tokens (warm off-white page, white cards, near-black main buttons, status colours only for status), Geist, Instrument Serif headlines, Geist Mono numbers; the dashboard as tinted cards, one rounded list of urgent places, Steep-style week bars and tinted panels; the menu's grey pill, 44px rows and one grey count; every office page on the system at 390px and 1440px in both themes; skeletons from the menu (a route-wide loading.tsx turned 404s into 200s); the dev button moved off the menu; three audit rounds, all four DONE; 5,215 tests + 100 e2e (see docs/work-log.md) |
| 2026-10-22 | 22 | 4.5 | The office's look, round 2 (22.1 to 22.4), from Dylan's "no depth" feedback and new references: a mock-up, approved once its gradients were out, then built: the window and its sheet, raised white surfaces with a lit edge, grooves, the four colours in full with a grain and glow, DM Sans, DM Mono and Newsreader, everything you press dipping and springing back, the menu with no scrollbar (34px rows with a mouse, the pill sliding to a pick), menus growing from their buttons, the landing ring and Offer's spinner; Needs attention's column fixed at 1280px; a shift page's vanishing cancel confirmation fixed; the guide's directions updated; three audit rounds: 22.1, 22.2 and 22.3 DONE and ticked, 22.4 NOT DONE (two small gaps, left for Dylan); 5,226 tests + 108 e2e + the walkthrough's 6 (see docs/work-log.md) |
| 2026-10-24 | 23 | 11.3 | The office's look, round 3, and the dashboard's charts (23.1 to 23.4), from Dylan's last references: two mock-ups (the flat round 3 look, then its six charts with panels of the real rows), then built: Plus Jakarta Sans, cool greys and hairlines with no shadow at rest, the full-width top bar and the menu card, every office page on round 3's parts, the four count cards, the urgent places' cards and six charts with their panels and Numbers tables, and this week's made-up offers; two review rounds (16 then 9 defects fixed) and the guardrails review; audit round 1, all DONE; 5,315 tests + 116 e2e + the walkthrough's 6 (see docs/work-log.md) |
