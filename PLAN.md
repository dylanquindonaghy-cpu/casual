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
| 1 | Phase 0: repo, tooling, guardrails | Talk to CSP about piloting (see go-to-market). 20 minutes with Mum on how Careys manages agency labour. Build a list of 30 target firms. |
| 2–3 | Phase 1: tenancy, data model, login | 10 discovery calls. **Gate A** at end of week 3. |
| 4–6 | Phase 2: roster core, rules, Sheets plug | Follow-ups. Teamforce conversation (rail/civils). |
| 6–8 | Phase 3: staff portal → **clickable demo** | Demo to warm leads. **Gate B.** |
| 8–10 | Phase 4: urgent board, notifications, offer waves | Sign pilot agreement + DPA. Collect baseline numbers. |
| 10–11 | Phase 5: resourcer dashboard, action log, notice report | |
| 12 | Phase 6: payroll queries + digest | |
| 13–14 | Phase 7: WhatsApp shifts line + call-to-text | Meta business verification (can take days). |
| 15–17 | Phase 8: branding, custom domains, deploy to AWS, GDPR export/delete | Pilot onboarding prep. |
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
- [ ] AWS: Lightsail 4 GB instance + managed Postgres (London), static IP, ports 80/443 only
- [ ] Docker Compose (web, worker, caddy); GitHub Actions deploy
- [ ] Backups on, restore tested; AWS Budget alert at £50; uptime check; error alerts to you
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
- [ ] Every decision waiting for Dylan is in one place: a "Decisions waiting for Dylan" section in
      `PLAN.md` lists each open decision once (from `PLAN.md`, the decision tables in
      `docs/overnight-log.md`, `docs/compliance.md` and `docs/privacy-notice.md`), grouped, with the
      safe default now in force. The Parking lot steps say who does each step (Dylan, or Claude
      after Dylan), and stale references are fixed. (M26, L13, L36, L37, L59, L60, L89)
- [ ] Walkthrough polish: the low findings a walkthrough would hit (L7, L8, L10, L15, L18, L20,
      L22, L28, L31, L32, L40, L44, L47, L49, L79, L82, L83). This includes: an office-placed worker
      is told they're booked; login links aren't followed by a full stop; an office cancellation
      for "the client needs fewer staff" doesn't re-offer the place; `npm run build` logs no brand
      errors; the action log shows per-firm numbers
- [ ] Local walkthrough pack: `docs/walkthrough.md` gives Dylan numbered steps on Windows + WSL
      (Docker Desktop, the folder, `db:up`, `db:reset`, `dev`, which browser, the production-mode
      run with `npm run build`) to try every screen as a worker and as admin, resourcer and payroll.
      A dev-only fake phone (`npm run sim:*`) sends signed WhatsApp, SMS and call webhooks to the
      local server, and outbound messages show in the terminal. The demo seed covers every screen
      and state the walkthrough visits. It includes a "found a bug" template. A browser test,
      `walkthrough.spec.ts`, runs every step, with the office at desktop size. (L16, L25, L58, L66,
      L88)

---

## Stage 2 (after 3 paying firms) — not now

- AI email inbox: firm forwards shifts inbox → SES inbound → classify (Haiku) → draft reply →
  approve mode → summaries every 3 hours
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

## Parking lot

(Ideas that came up mid-build. Not in scope until a phase includes them.)

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
  never published; Postgres TLS with `sslmode=verify-full` and the RDS CA bundle; a compose
  `migrate` service that alone holds `DATABASE_ADMIN_URL`.
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
- Before Twilio (Phase 4), send-login-code too: make a retried job a no-op (a unique request id
  on otp_codes, like magic_links.request_id; a schema change). Today a retry after a real send
  sends a second code that replaces the first.
- Before Twilio (Phase 4): send-portal-link sends inside its database transaction. Commit the
  unsent link first, then send, then mark it sent (today a commit failing after a real send leaves
  a delivered link that doesn't work, and the retry sends a second message). Also skip login
  requests more than a few minutes old (after the worker was down).
- When an office settings screen lets a firm edit `sign_off`: validate it (ends "Shift Team",
  never a person's name).
- When an office-users admin screen exists: use one email rule for storing and logging in (the
  database accepts `a@b`, which login's stricter check would never match).
- Per-IP login limits are per firm (auth_throttle is firm-scoped); a cross-firm IP limit needs a
  non-tenant table. Revisit if abuse shows up.
- Before the pilot: review the per-IP login limit (10 per 15 minutes) against how the pilot firm
  onboards staff. A briefing on venue Wi-Fi shares one IP (see runbooks). Options: a higher
  limit, or a per-firm setting.
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
- **Before the pilot:** the Open shifts list checks each shift with the rules on its own (about
  ten small queries each, up to 50 shifts), holding one of the pool's connections for the whole
  page view. Batch the rules loader (one read of the worker's credentials, bookings and the firm's
  rules for the whole list) so an urgent message to many workers can't starve "Take shift".
- "Take shift" has no rate limit, and every refused tap writes a `shift.booking_refused` event.
  Add a per-worker limit (like the login ones) before the pilot.
- Phase 5: let the office look a booking up by the 8-character reference on the worker's
  confirmation.
- Open shifts cards: the pay rate "if the firm shows it" comes with pay data (Phase 6).
- Pay records (**Dylan to decide**; the Phase 6 import screen is built, correcting isn't): no app
  path deletes a wrongly imported line (NO_DELETE); decide how payroll corrects or removes one, and with Phase 8 how GDPR deletion and
  retention treat pay records. A corrected rate re-imports as a second line (the rate is part of
  the key), so the worker sees both; and an update overwrites the old hours and gross (the log
  keeps field names only), so what a worker was shown before is lost. Consider superseded rows or
  a versions table in Phase 6. A Windows-1252 CSV with £ is refused as "not text" (ask for UTF-8
  or .xlsx). Demo pay records come with the demo-seed task.
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
  9. **On the server** (after "Connect AWS", "Connect the deploy" and **"Connect Twilio"**: the
     worker, which runs the sync, only starts once Twilio is connected and `COMPOSE_PROFILES=worker`
     is set; until then no sheet is read on the server):
     1. Get the key file onto the server: in the Lightsail console, open the instance's browser
        terminal; its menu should have "Upload file" (choose the file: it lands in the home
        folder). If it doesn't, stop and ask Claude for another way: never paste the key into a
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
- Demo seed, still to add (see docs/testing.md): Northline's mocked sheet (Phase 2), the
  short-notice firm cancellation (Phase 5), 12 pay queries, 9 about one rate change (Phase 6).
  Acme's Saturday, the two requests and 8 weeks of pay are in (Phase 3). Also worth adding: past
  shifts matching the pay lines, so "Past 30 days" on My shifts isn't empty in a demo. (The
  seeded dropout's urgent mark is now logged, as the app logs it.)
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
  - **Dylan to confirm:** the approved `shift_reminder_24h` says "Cancel in the app", but there is
    no app to download (it's a link). Consider "Cancel with the link" before submitting templates.
  - Reminders go to every confirmed booking, including a worker the office has since made
    inactive or blocked. Decide with the Phase 5 worker screen whether blocking cancels their
    bookings.
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
  4. `npm run -s firm:check -- --firm <slug>` shows "[x] Baseline numbers recorded". Tick the task.
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
  AWS", "Connect the deploy", "Connect Twilio" and "Connect Amazon SES" (its checks log in to a
  test firm's office, by an emailed link the worker sends), and **before any real worker's data is
  imported** (Gate B):
  1. Open `docs/runbooks.md` → "Try the runbooks for real (once, before the pilot's data)".
  2. Do its steps in order (a test firm, deploy, rollback, restore, restore drill), about two hours
     on a weekday outside 05:30–09:00 UK.
  3. Fill in its table: the date, whether it worked, and anything wrong or unclear.
  4. Tell Claude what went wrong so the runbook is fixed, then tick the task.
  - To check on the first restore: that a Lightsail snapshot restore keeps the database's user
    names and passwords ("Restore the database" step 2 and the drill's step 2 rely on it; standard
    Lightsail behaviour, but not checked from here).
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
  6. Then tick the task. The worker must be running (it's off until "Connect Twilio" anyway).
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
    - **A flaky test (found in Phase 10 task 9's verify; failed again in task 11's: fix it soon):** `sheets.jobs.test.ts` "queues one
      sync for each firm that is due" asserts a second tick in the same minute queues nothing.
      The sync job is de-duplicated by pg-boss's `singletonSeconds: 50` slots, which follow the
      real clock, not the test's fixed one, so two ticks straddling a slot boundary (a fraction
      of a second apart, about 1 run in a few hundred) queue two. Fix: de-duplicate on the app's
      own minute (the job's idempotencyKey, e.g. a firm-scoped `singletonKey` holding the minute)
      and pin the test to it.
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
- **Connect monitoring** (the Phase 8 "Backups on, restore tested; AWS Budget alert at £50; uptime
  check; error alerts to you" task is blocked on it: AWS and an uptime service). Written:
  `deploy/alarms.sh` and `deploy/restore-drill.sh` (checked by `tests/unit/deploy.monitoring.test.ts`,
  never run). After "Connect AWS": the budget (already "Set up AWS (once)" step 1), then
  docs/runbooks.md "Monitoring and alerts (once)" (Lightsail alarms by email, a free uptime check on
  `/api/health` with its phone app) and a first "Restore drill (monthly)". Backups are on already
  (`deploy/lightsail.sh` checks them). Then tick the task. The app's own error alerts (failing jobs
  and syncs) are the alerts task. The IAM policy in "Set up AWS" step 2 allows `lightsail:*`, which
  covers the alarms and the drill.
- **Connect the deploy** (the Phase 8 "Docker Compose (web, worker, caddy); GitHub Actions deploy"
  task is blocked on it: the server from "Connect AWS", and the deploy workflow only runs on
  `main`). Everything is written: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`,
  `deploy/deploy.sh` with its systemd timer, `deploy/env.example`, `.github/workflows/deploy.yml`,
  and a CI job that builds the image on every push (check the "docker" job is green in GitHub's
  Actions tab before merging: `next build` has never run inside Docker yet). Follow
  docs/runbooks.md "Deploy" ("The first time", 6 steps), then tick the task. **Before that:**
  (1) the worker won't start in production until the Twilio sender exists (by design:
  `MESSAGING_TRANSPORT=console` is refused in production), so it's behind `COMPOSE_PROFILES=worker`
  and stays off; "Connect Twilio" comes before a real pilot; until then only the web app and Caddy
  run (turning it on later: set `COMPOSE_PROFILES=worker` and the Twilio values in `.env`, then
  `./deploy.sh --now`, which now applies `.env` changes: Phase 10 task 17); (2) merging
  `build/overnight` into `main` is yours to do (the overnight rules never touch `main`), and it's
  what first builds the image; (3) **the database's TLS is on** (Phase 10 task 17): the three
  database addresses in `deploy/env.example` end with
  `?sslmode=verify-full&sslrootcert=/app/rds-ca.pem`, the image fetches Amazon's RDS certificate
  bundle to that path when it's built, and the app refuses a production database address without
  them. **Dylan to check** on the first `./deploy.sh --now`: the migration step connects (that
  Lightsail's database certificate is in Amazon's RDS bundle, as expected; a certificate error:
  tell Claude, and don't remove the ending); (4) **a stable server-action key** (Phase 10 task
  12, audit L92): an action's id is salted with a key Next makes afresh for each build, so a My
  shifts copy kept on a phone before a deploy can't "Cancel this shift" until it's reloaded with
  signal (Log out is a plain route now and always works). Make a key once (`openssl rand -base64
  32`), add it as a GitHub Actions secret, and pass it to `next build` in the Docker build as
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (a build secret, never a build argument, so it isn't in the
  image's history). Later: pin `actions/checkout` to a commit SHA and the Node base image to a
  digest.
- **Connect AWS** (the Phase 8 "AWS: Lightsail 4 GB instance + managed Postgres" task is blocked on
  it: an AWS account and money). Everything is written: `deploy/lightsail.sh` and
  `deploy/cloud-init.sh`, checked by `tests/unit/deploy.lightsail.test.ts` but never run. Follow
  docs/runbooks.md "Set up AWS (once)" (9 numbered steps: account and MFA, a CLI login with
  Lightsail access only, the AWS CLI, `aws configure`, `bash deploy/lightsail.sh`, the two DNS A
  records, the database password into your password manager, the browser console, then putting
  the CLI key away). You should see
  the static IP and the database's address at the end. Then tick the AWS task. **Dylan to
  check:** the two monthly prices the script shows before it asks for `yes` (the doc says about
  $24 + $15); it picks the cheapest 2-CPU 4 GB server and the cheapest standard database plan.
  **For the deploy task:** SSH is closed to the internet (only Lightsail's browser console), so
  "GitHub Actions SSHes in" (docs/architecture.md, runbooks "Deploy") can't work as written: pick a
  way that fits (the server pulls new images itself, say). And re-running `deploy/lightsail.sh`
  resets the firewall to its own rules, so a deploy must not depend on an extra rule. The server
  reboots itself at 02:30 UTC when an update needs it: every compose service needs
  `restart: unless-stopped`.
- **Connect Twilio** (the Phase 4 "WhatsApp utility templates via Twilio…" task is blocked on it:
  an account, a UK number, approved templates and money):
  1. Create the Twilio account and a UK number; set up the WhatsApp sender (Meta business
     verification).
  2. Submit the templates: see "Submit the WhatsApp templates" below (the pack is ready).
  3. Write the Twilio transport next to the console one (`src/lib/messaging/`): WhatsApp by content
     id and variables, SMS by body; `MESSAGING_TRANSPORT=twilio` (production refuses `console`).
     Throw `ChannelRefusedError` only for Twilio's "not a WhatsApp number" style errors (so offer
     waves fall back to SMS only then); every other error is a failed send (logged, not retried on
     another channel). An urgent offer by text now uses the doc's short SMS copy (standard text
     characters only: usually 2 texts, not 3). Reminders still go by text in full (their dashes
     make a dearer kind of text, about 3). Credential messages always go by WhatsApp, whatever the
     worker chose (see the credential-scan item): workers who chose text get no expiry warnings
     until they move onto the shared sender.
  4. The status webhook (`POST /api/webhooks/twilio/status`): signature check, the `messages`
     table with `provider_message_id` (golden rule 3), then the 60-second "not delivered → SMS"
     fallback job.
  5. STOP replies to SMS mark the channel opted out. (Built in Phase 7 short of Twilio, and the
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
  6. Test with 3 real phones (Android, iPhone, an older phone by SMS): the pre-pilot checklist.
  7. **One number per firm (the Phase 7 "shifts line" task is blocked on this):** buy a UK number
     for each firm in Twilio (Phone Numbers → Buy a number, with SMS, voice and WhatsApp), register
     it as a WhatsApp sender for the firm (Messaging → Senders → WhatsApp senders), and point its
     webhooks at `/api/webhooks/twilio/...` (next tasks). Then set it in the app:
     `npm run firm:line -- --firm acme --number "+44 7700 900123"` (it should say "The shifts line
     for acme is now +447700900123."). Every WhatsApp and text for that firm then carries it as
     `from`: the Twilio sender sends from `message.from`. Then tick the shifts line task.
  8. **Dylan to decide:** a firm with no line yet: send from a shared ShiftDesk number, or no
     WhatsApp/text until its line is live (today the app builds the message with no `from`).
  9. **Incoming WhatsApps:** in each WhatsApp sender's settings, set "When a message comes in" to
     `https://<APP_BASE_DOMAIN>/api/webhooks/twilio/whatsapp` (HTTP POST), and put the account's
     auth token (Account → API keys & tokens) in the web app's environment as `TWILIO_AUTH_TOKEN`
     (never in the repo). Send the line a WhatsApp saying "shifts": you should get the open shifts
     link back within seconds. Then from a phone that isn't on file: you should get "Thanks for your
     message. We don't recognise this number…", and the office's admins and resourcers an email;
     the message shows on Today. Then tick the "Unknown number" task too.
  10. **Incoming calls (the Phase 7 "Call-to-text" task is blocked on this):** on each firm's
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
     **Before going live:** Twilio keeps each voicemail's recording and transcription in the
     account until deleted, but compliance.md says call audio isn't stored by default. Build a
     job that deletes the Recording (by its RecordingSid) once the transcription is stored, with
     the Twilio transport; or turn on Twilio's own automatic deletion if the account has it.
     **Dylan to decide:** Twilio's transcription is basic (names and places often come out wrong).
     A better one (Amazon Transcribe in London) is a later option; the request always keeps the
     text Twilio gave, and the office can ring back.
  11. **Real sample requests:** once any of steps 5, 9 or 10 is live, capture one real request to
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
  - **Dylan to confirm:** new shifts are open at once (no draft step); editing a booked shift's
    date, times, role or site is refused until the move/cancel screen (the next task) handles
    notice; the web import takes files up to 1 MB (the terminal import 5 MB).
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
  - The demo seed's short-notice firm cancellation (docs/testing.md, Northline) isn't there yet:
    add it with the seed's past event (see "Marking who worked follow-ups").
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
- **Submit the WhatsApp templates** (the Phase 4 "All copy … templates submitted to Meta" task is
  blocked on it: needs the Twilio account and WhatsApp sender from "Connect Twilio", step 1). The
  pack is `src/lib/messaging/whatsapp-templates.ts`: 19 templates (6 "no site" variants and a "no note" one), each
  with its category, language (English UK), body with `{{1}}`-style variables and sample values. A
  test proves the code sends exactly these words.
  1. In the Twilio Console, open Messaging → Content Template Builder → Create new.
  2. For each template in the pack: type its `name` as the template name, pick the WhatsApp card,
     paste its `body`, set the language to English (UK), and give each `{{n}}` the sample value
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
- **Connect the real web push** (the Phase 4 web push task is blocked on it: an outside service
  and a secret key):
  1. `npm install web-push`, then `npx web-push generate-vapid-keys` on the server (never commit the
     private key).
  2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (mailto:) in production.
  3. Write the web-push adapter next to the console one (`src/lib/push/transport.ts`), treating
     404/410 as "gone"; add `PUSH_TRANSPORT=webpush` (production currently must use `none`).
  4. (Built: the service worker re-saves a renewed subscription, `pushsubscriptionchange`.)
  5. Rate-limit `POST /api/push/subscribe` (each save writes an event) with the auth throttle.
  6. Test on a real Android phone and an iPhone (added to the home screen).
  7. docs/compliance.md and docs/privacy-notice.md: add the browser push services as
     sub-processors, how long `push_subscriptions` rows are kept, and what notifications show on a
     locked phone.
  Also: push the office's escalation alert, and the push-first-then-WhatsApp order (the `notify`
  task).
- **Connect Bedrock** (the Phase 6 "Group queries by likely cause … Haiku summarises" task is
  blocked on it: an outside service with an AWS account and money). The grouping is built; only
  the AI's one-line summary per group waits (the app writes its own line meanwhile).
  1. In the AWS console (London account, eu-west-2), open Amazon Bedrock → Model access, and ask
     for access to Claude Haiku (an EU cross-region inference profile, so data stays in the EU).
  2. Create an IAM role for the worker's server allowing only `bedrock:InvokeModel` on that
     profile. No keys in the repo: keys in the server's environment (Lightsail instances can't have
     an IAM role).
  3. Write the Bedrock client behind `AiClient` (`src/lib/ai/client.ts`): a timeout (5 seconds),
     no retries in a request path, and log the call (purpose, model, tokens; never the prompt).
  4. Add `AI_TRANSPORT=bedrock|none` to the worker's environment (default `none`); the payroll
     digest (next task) passes the client to `loadPayQueryGroups({ ai })`.
  5. docs/compliance.md: Bedrock as a sub-processor (AI disclosure); the model sees only a
     group's facts (count, issue, week, site, rate), no names or workers' words.
  Then tick the grouping task after a real summary passes the checks. The same client serves the
  shifts line's classifier (`classify_message`, `src/lib/ai/classify-message.ts`): pass it in
  `inboundMessageFirmTask` (`src/lib/inbound/reply.ts`) instead of `noAi`, check a few real
  unclear messages get the right label, and (with "Connect Twilio" step 9 done too, so real
  WhatsApps arrive and replies go) tick the Phase 7 "Inbound WhatsApp" task.
  Also, with the real client (from the pay.grouping tests review):
  - give `AiRequest` an `AbortSignal` and abort it when our 5-second timeout wins, so a request we
    stopped waiting for isn't still running (and billed);
  - after the first timeout or "unavailable" in a digest, stop asking for the remaining groups
    (today a Bedrock that hangs costs up to 10 × 5 seconds while the queries wait);
  - count fallbacks (timeout / error / failed check) in the log or in `pay_digest.sent`'s data,
    never the model's text, so an AI that always fails gets noticed.
- Pay query grouping follow-ups (Phase 6):
  - **Dylan to confirm the grouping rules:** wrong rate = the week + the rate the worker's pay
    line for the day was paid at; hours missing = the week + the site; paid late = the week;
    something else = the week. Payroll may prefer others (a pay date for late pay, say). A worker
    with a day and a night pay line that week keys on both rates ("1250+1500"), so lands apart
    from colleagues on one rate: use the lowest, or the shift's own rate, if that splits groups.
  - For the digest: decide whether a query's key freezes once it's in a digest (today
    `regroupPayQueries()` re-keys in-digest queries too, so one could move out of a group payroll
    was emailed about).
  - Before connecting Bedrock: the AI line's number check accepts any number in the facts (so a
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
- **Connect Amazon SES** (every office email goes through the console transport until then: login
  links by email, escalations, the credential list and now the payroll digest with its attached
  list; an outside service with an AWS account):
  1. In the AWS console (London, eu-west-2), open Amazon SES → Identities → Create identity, and
     verify the sending domain: add the DKIM records it shows to the domain's DNS. Wait for
     "Verified".
  2. Ask to leave the SES sandbox (Account dashboard → Request production access): until then SES
     only sends to addresses you've verified.
  3. Give the worker's server permission to send only (an IAM policy allowing `ses:SendRawEmail`
     from the verified identity; raw email is what carries attachments). No keys in the repo.
  4. Write the SES sender beside the console one (`src/lib/messaging/`): email only (texts and
     WhatsApp stay with Twilio), each attachment as a MIME part (`text/csv; charset=utf-8`), a
     timeout, and the provider's message id back as `providerMessageId`. Route email to it and
     phone messages to Twilio when `MESSAGING_TRANSPORT` is the real one.
  5. Bounces and complaints (SES → SNS → a webhook): mark the office user's address as not
     working, so the digest and the credential list skip it (they already skip an address that
     isn't valid, and count it).
  6. Test: send yourself a payroll digest from `/office/pay-queries` and open the list in Excel.
- Payroll digest follow-ups (Phase 6 digest task):
  - **Dylan to confirm:** the default time (09:00, Monday to Friday, firm-local); only payroll gets
    it (admins only when the firm has no payroll user); each digest has the new queries, with a
    count of earlier ones still waiting; names and what workers wrote go only in the attached list
    (the list goes to payroll's mailbox: check the pilot firm is happy with that).
  - The settings screen: the digest's time and days (`firms.settings.pay_digest`, read by
    `src/lib/pay/digest-schedule.ts`). Until then it's set in the database.
  - A digest that stops after claiming its queries (before sending, or between sending and
    recording the outcome) leaves them `in_digest`, logged, and payroll's page says after 30
    minutes that it "may not have gone". There's no button to send those again yet: with SES
    delivery notifications, a check could.
  - With SES: record the provider's message ids in `pay_digest.sent` (ids only), and decide
    whether a send that timed out (it might have been delivered) should still put the queries
    back for the next digest (today it does: a query listed twice beats one never seen).
  - Each weekday a firm with nothing new gets a "No pay digest: no new pay queries." line in the
    action log (it's what stops a second digest that day). Hide it from the log's list if it's
    noisy.
  - The key-freeze question above still stands: a query in a digest can still move group when
    regrouped; the digest's list shows the group it was sent in.
- Shifts line replies follow-ups (Phase 7 "Inbound WhatsApp" task, blocked on Bedrock):
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
  - **Dylan to confirm:** payroll's note goes in the WhatsApp/text message itself, as the doc's
    `pay_query_update` template says (the pay page is behind a code, but the message isn't). The
    push says nothing about pay. If the note should stay behind the code, the message becomes
    "Payroll has answered your pay query. See it on your pay page." (a template change for Meta).
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
    The credential expiry reminders (`src/lib/credentials/scan.ts`) send WhatsApp today whatever
    the setting: move them onto the same sender (see the credential-scan item above).
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
    log, requests and offers (docs/compliance.md). Events are append-only: nothing, not even the
    owner, can delete them, and `tests/integration/rls.every-table.test.ts` pins "no UPDATE or
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
  - L4, L16, L61, L62, L65, L88: make `verify.sh` also run `npm run build`, require the browser
    tests for a tick, and widen `invariants.sh` (Playwright skips, `scripts/` in the withFirm check).
  - L9, L57: CI on GitHub hasn't been checked since Phase 0. Open the repo's Actions tab and check
    the latest `build/overnight` run has a green tick, or install `gh` so Claude can check.
  - L14: try the iPhone home-screen login on a real iPhone.
  - With "Connect Amazon SES": alert Dylan when office emails fail (an escalation email that
    fails is logged `shift.escalation_failed`, but no alert counts it yet).
  - With the accounts: L26 (payroll digest email) with "Connect Amazon SES", L27 (real Twilio
    sample payloads) and L34 (call-to-text by SMS) with "Connect Twilio", L35 with "Connect the real
    web push".

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
