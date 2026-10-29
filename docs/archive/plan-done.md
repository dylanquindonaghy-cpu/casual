# Finished phases (archive)

Moved from `PLAN.md` word for word on 2026-10-29 (P1.1): every numbered phase with all its boxes
ticked. Frozen: its sha256 is pinned in `scripts/invariants.sh`, so any change to it fails verify.
Phases finished later go to a new archive file with a pin of its own. Line numbers that older docs
give for these phases are `PLAN.md`'s as it was then.

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
