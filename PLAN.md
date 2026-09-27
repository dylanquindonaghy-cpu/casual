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

- [ ] Schema: firms, office_users, workers, credentials, sites, events, magic_links, sessions, otp_codes
- [ ] RLS on every table using `app.current_firm_id`; scoped DB client sets it per request/job
- [ ] Host → firm resolution (subdomain now; custom domain later) as middleware
- [ ] Worker login: enter mobile → one-time link (15 min, single use, stored hashed) → 30-day session
- [ ] OTP step-up (6 digits, 10 min) for pay pages
- [ ] Office login: email magic link; roles `admin`, `resourcer`, `payroll`
- [ ] Rate limit login requests per number and per IP
- [ ] Seed script: the two demo firms in `docs/testing.md` (Acme Events, Northline Rail Labour)
- [ ] Structured JSON logging with phone-number masking; request IDs
- [ ] Tests: `rls.every-table`, `tenancy.isolation`, expired/used links rejected, events written

**Done when:** a worker from Firm A can never see Firm B data (tested); login works in console mode.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 1, docs/data-model.md and the Tenancy and Login sections of
> docs/architecture.md. Don't code yet. Propose the Drizzle schema, the RLS policies, how the
> scoped client sets the firm, and the tests. Wait for my OK, then implement and run the
> guardrails-reviewer agent, then /close-task for each task.

## Phase 2 — Roster core, rules engine, Sheets plug (30–40 h)

**Goal:** shifts exist, eligibility is decided by tested code, and a firm's Google Sheet can be the source.
Docs: `docs/architecture.md` (Roster plugs, Rules engine), `docs/compliance.md` (Credentials).

- [ ] Schema: shifts, assignments, requests, offers, credential_rules (per sector/role)
- [ ] `RosterPlug` interface: `listStaff`, `getShifts`, `assign`, `markCancelled`, `canWrite`
- [ ] Native adapter (our tables are the rota) — for firms with nothing else
- [ ] Google Sheets adapter: service account, column mapping per firm, sync job every 1–2 min
      on event days, batch writes, never read the sheet per request
- [ ] CSV/Excel import for workers, credentials and shifts
- [ ] Rules engine (pure functions): credential in date for the role; qualification match;
      no overlapping assignment; minimum rest; weekly hours cap; firm "applied" allowance;
      returns `{ ok, reasons[] }`
- [ ] Credential packs seeded from `docs/rules-and-credentials.md` (security live; rail and
      construction types present but unused until a firm needs them)
- [ ] Credential expiry scan job (30/14/7-day warnings; block on expiry)
- [ ] Atomic assign ("first yes wins") + re-check live source before confirming
- [ ] Every assign/cancel writes events with `notice_hours`
- [ ] Tests: `rules.table` (every case in the doc), `assign.race`, `sheets.sync`

**Done when:** rules tests pass; a seeded Sheet syncs both ways; double-assign impossible under a race test.
Docs: `docs/rules-and-credentials.md`, `docs/api-and-jobs.md`.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 2 and the Roster plugs + Rules engine sections of
> docs/architecture.md. Start with the rules engine as pure functions and a table of test
> cases I can review. Then the RosterPlug interface and native adapter. Sheets adapter last.

## Phase 3 — Staff portal (35–45 h) → clickable demo

**Goal:** the thing you demo on calls. Mobile first. Instant answers.
Docs: `docs/product-spec.md` (Staff stories).

- [ ] My shifts (upcoming, past), with site, times, role, instructions
- [ ] Open shifts I'm eligible for, with a "Take shift" button (rules + atomic assign)
- [ ] Cancel a shift: instant confirmation, reason, notice period recorded
- [ ] Request a time change or swap: creates a request for the office
- [ ] Allocation mode per firm: first come first served, or fair rotation (fewest hours this week first)
- [ ] Pay info page (behind OTP): hours logged, rates, pay dates from imported pay data
- [ ] Profile: credentials and expiry (read-only), mark dates unavailable, notification settings
- [ ] Blocked-shift screen shows plain-English reasons + "Ask the office to review"
- [ ] "My shifts" cached by a service worker (opens with poor signal); "Add to home screen" prompt on iPhone
- [ ] Empty and error states written in plain language (see `docs/screens.md`)
- [ ] Demo seed: Acme's Saturday event day with an urgent dropout (`docs/testing.md`)
- [ ] Playwright: login → take shift → cancel → request → pay OTP

**Done when:** on a phone, a fake worker can log in, take and cancel shifts in under 30 seconds each,
and you can run the demo script from `docs/testing.md` on a call.
Docs: `docs/screens.md`.

**Kickoff prompt:**
> Read CLAUDE.md, PLAN.md Phase 3 and the staff user stories in docs/product-spec.md. Propose
> the pages, components and server actions. Mobile-first, plain English copy, sign system
> messages as "[Firm] Shift Team". Build the demo seed last.

## Phase 4 — Urgent board, notifications, offer waves (27–37 h)

- [ ] Urgent flag on shifts (manual or automatic when a dropout lands inside X hours)
- [ ] Urgent board page for workers (only shifts they're eligible for)
- [ ] Offer waves (pg-boss): best 3–5 eligible, wait 15 min, next wave; stop when filled;
      escalate to resourcer at start minus X hours (all firm-configurable)
- [ ] Web push (VAPID); iPhone push only works when the portal is added to the home screen, so
      show an "Add to home screen" prompt
- [ ] WhatsApp utility templates via Twilio for urgent offers; SMS fallback; quiet hours
- [ ] Only eligible workers are ever notified; max 3 offers per worker per day unless urgent
- [ ] Shift reminders 24 h and 2 h before start (cuts no-shows)
- [ ] All copy from `docs/messaging-templates.md`; templates submitted to Meta for approval
- [ ] Tests: `waves.timing`, `notify.policy`, stop-on-fill, no notifications to ineligible workers
Docs: `docs/messaging-templates.md`, `docs/api-and-jobs.md` (offer-wave ranking).

## Phase 5 — Resourcer dashboard, action log, notice report (23–33 h)

- [ ] Today view: gaps, urgent shifts with wave status, fresh cancellations with notice hours,
      pending requests, credential expiries this week, quick actions
- [ ] Shifts: create/edit, bulk create for an event, CSV import, manual assign with logged override
- [ ] **Firm-initiated cancel / move / curtail**: reason required; notice hours logged per assigned
      worker; workers notified (compliance-critical, see `docs/api-and-jobs.md`)
- [ ] Mark no-show / completed
- [ ] Approve/decline requests (time changes, swaps, availability, general) with a note → worker notified
- [ ] Action log with filters (worker, shift, date, type)
- [ ] Notice and cancellation report: every offer/change/cancel with timestamps, initiator and
      notice hours; short-notice flag at a firm-set threshold (final 2027 rules still pending); CSV export
- [ ] Pilot metrics page: baseline entry form + daily rollup job (`docs/pilot-playbook.md`)
- [ ] Tests: `notice.report` (worker cancel, firm cancel, move, curtail)
Docs: `docs/screens.md`, `docs/pilot-playbook.md`.

## Phase 6 — Payroll queries and digest (12–18 h)

- [ ] Pay query form: shift/date, issue type (missing hours, wrong rate, late pay, other), details
- [ ] Group queries by likely cause (same rate change, same site, same week) — Haiku summarises,
      code does the grouping keys
- [ ] Digest to payroll by email at a set time: "42 queries, 37 about the new rate not applied
      to 12 Sep shifts" with the list attached
- [ ] Worker sees status updates; AI never answers a dispute
- [ ] Pay records CSV import (period, hours, rate, gross, pay date)
- [ ] Tests: `pay.grouping` (stable keys; AI failure falls back cleanly)

## Phase 7 — WhatsApp shifts line and call-to-text (15–20 h)

- [ ] One business WhatsApp number per firm ("the shifts line") via Twilio
- [ ] Inbound WhatsApp: known worker → reply instantly with the right link (keywords first:
      shifts, cancel, pay, help; Haiku only for unclear text)
- [ ] Unknown number → polite reply + office alert
- [ ] Call-to-text: short recorded message, then WhatsApp/SMS with the link; optional voicemail
      transcribed into a request
- [ ] STOP handling for SMS; opt-out respected in the notification policy
- [ ] Signature checks on all Twilio webhooks; idempotent storage
- [ ] Tests: `webhook.idempotent`, signature contract tests with real Twilio sample payloads
Docs: `docs/api-and-jobs.md`, `docs/messaging-templates.md`.

## Phase 8 — Branding, custom domains, deploy (18–28 h)

Docs: `docs/architecture.md` (Deployment, Custom domains).
- [ ] Per-firm logo, colours and name; replies signed "[Firm] Shift Team"
- [ ] Custom domains: firm adds a CNAME (e.g. `shifts.firmname.co.uk`); Caddy on-demand TLS with
      an `ask` endpoint that only approves domains in the firms table
- [ ] AWS: Lightsail 4 GB instance + managed Postgres (London), static IP, ports 80/443 only
- [ ] Docker Compose (web, worker, caddy); GitHub Actions deploy
- [ ] Backups on, restore tested; AWS Budget alert at £50; uptime check; error alerts to you
- [ ] Twilio fallback: if the app doesn't answer, calls forward to the manager's phone
- [ ] GDPR: worker data export (JSON + CSV) and delete; firm data export; retention purge job
- [ ] Alerts to your phone: job failures, health down, Twilio error spikes, sync errors
- [ ] Runbooks in `docs/runbooks.md` tried once for real (deploy, rollback, restore)

## Phase 9 — Pilot hardening and go live (10–15 h)

- [ ] Onboarding checklist for the pilot firm (see docs/go-to-market.md)
- [ ] Import real workers/credentials/shifts **only after** Gate B paperwork is signed
- [ ] Privacy notice line supplied to the firm (see docs/compliance.md)
- [ ] Pre-pilot checklist in `docs/testing.md` all ticked
- [ ] Baseline week recorded (`docs/pilot-playbook.md`)
- [ ] Run a dry-run event day with the resourcer
- [ ] Week-by-week pilot metrics review and the week-4 report

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

- **Phase 1 blocker:** the dev/CI Postgres user (`shiftdesk`) is a superuser, and superusers
  bypass RLS. Phase 1 must run the app and the tenancy tests as a non-superuser role (no
  `BYPASSRLS`), or `rls.every-table` / `tenancy.isolation` would pass without testing anything.
- CI security layer from `docs/testing.md`: `npm audit` and a secrets scan. Note: drizzle-kit
  0.31 currently pulls 4 moderate advisories (old esbuild in `@esbuild-kit`, dev-only tooling).
- Before Phase 1 code (from the Phase 0 guardrails review): wrap or hide the raw `createDb`
  so app code can only get the firm-scoped client; a zod job-envelope base (`{ firmId }`) that
  every firm job payload extends; redact pg-boss error logging in `src/worker/boss.ts`.
- Invariant: fail if `twilio` is imported anywhere under `tests/` (when the SDK arrives, Phase 4).
- CI e2e job needs a Postgres service once e2e covers DB-backed flows (Phase 3).

## Hours log

| Date | Phase | Hours | What got done |
|---|---|---|---|
| | | | |
