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

- ~~**Phase 1 blocker:** the dev/CI Postgres user is a superuser, which bypasses RLS.~~ Resolved
  in Phase 1 (ADR-011): app, jobs and owner roles; tests run as `shiftdesk_app`.
- CI security layer from `docs/testing.md`: `npm audit` and a secrets scan. Note: drizzle-kit
  0.31 currently pulls 4 moderate advisories (old esbuild in `@esbuild-kit`, dev-only tooling).
- From the Phase 0 guardrails review: ~~hide the raw `createDb`~~, ~~a zod job envelope~~ and
  ~~redact pg-boss error logging~~ (all done in Phase 1).
- Invariant: fail if `twilio` is imported anywhere under `tests/` (when the SDK arrives, Phase 4).
- CI e2e job needs a Postgres service once e2e covers DB-backed flows (moved into Phase 1 with
  the worker-login e2e test).
- Phase 8: custom domains in the host lookup (`app_resolve_firm` resolves subdomain slugs only)
  and the Caddy `ask` endpoint. The proxy 404s every host but `<base>` and `<slug>.<base>`, so
  decide then which hosts health checks (`localhost:3000/api/health`), Caddy (`web:3000`) and
  webhooks may use.
- A short negative cache for unknown firm slugs if random subdomains ever cost noticeable load
  (each one is one `app_resolve_firm()` call).
- Phase 8: branding. The database only accepts `#rrggbb` colours and `https://` logos; still never
  render brand fields raw into CSS or HTML.
- Phase 8: Caddy sets `X-Real-IP` (the app's only source of the client IP) and the web port is
  never published; Postgres TLS with `sslmode=verify-full` and the RDS CA bundle; a compose
  `migrate` service that alone holds `DATABASE_ADMIN_URL`.
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
  that keeps the notice report's evidence for its retention period.
- Phase 8 retention purge: the app role has no DELETE on shifts, assignments, requests or offers,
  so the purge job needs its own narrow path (a purge function or role) and writes an event per run.
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
  (steps parked), then add `google` to `SHEETS_TRANSPORT` (it accepts only `none` now) and wire
  `googleSheetsClient` into `src/worker/index.ts`. Show the office `roster.sheet_booking_refused`
  and `roster.sheet_conflict` (Phase 5): the refused name drops out of its sheet at the next write.
- A shift row the office deletes from its sheet stays in our copy and stays bookable (the sync
  ignores vanished rows). Decide what a vanished row means (a firm cancellation with notice, or a
  flag for the office) before any Sheets firm goes live.
- Booking: availability (Phase 3 `/profile`) and blocked sites (Phase 5) have no store yet, so
  `loadEligibilityInput()` passes empty lists; fill them when the stores exist.
- Booking: the office's override reason is free text in `events.data`. `bookShift()` refuses one
  holding a phone number or email address, but a name could still get in. Use reason codes (plus
  a note kept on the assignment row) when the Phase 5 manual-assign screen is built.
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
- Pay records: no app path deletes a wrongly imported line (NO_DELETE); decide with Phase 6
  (payroll screen) how the office corrects or removes one, and with Phase 8 how GDPR deletion and
  retention treat pay records. A corrected rate re-imports as a second line (the rate is part of
  the key), so the worker sees both; and an update overwrites the old hours and gross (the log
  keeps field names only), so what a worker was shown before is lost. Consider superseded rows or
  a versions table in Phase 6. A Windows-1252 CSV with £ is refused as "not text" (ask for UTF-8
  or .xlsx). Demo pay records come with the demo-seed task.
- Phase 6's "Pay records CSV import" line is effectively built in Phase 3 (the `pay` kind of the
  importer); Phase 6 adds the office screen for it.
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
- Connect the real Google Sheets (needs Dylan): create a Google Cloud project and a service
  account, download its key into `secrets/` (git-ignored), share a test sheet with the service
  account's email, set `SHEETS_TRANSPORT=google` and `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`, run one sync
  by hand. The client (`src/lib/roster/sheets/google.ts`) is tested only against a fake network.
- Sheets: rows or staff that disappear from the sheet are left as they are here (not cancelled or
  deactivated). Decide with the pilot firm; flag them to the office first.
- Sheets: tell the office about sync errors (`last_error_code`), clashes (`roster.sheet_conflict`)
  and bad rows (Phase 5 Today view). Today they are only in the database and events.
- Demo seed: Northline's mocked sheet. Local dev has no sheet transport (`SHEETS_TRANSPORT=none`);
  a file-backed dev transport would let the demo sync a sheet on a laptop.
- Phase 5 office import screen (`/office/workers` "import CSV", shifts CSV import): an upload plus
  `readTable()` + `runImport()` with a dry-run preview first, and `FILE_ERROR_TEXT` / `PROBLEM_TEXT`
  for the copy. Pay records import (Phase 3/6) adds a kind to the same importer.
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
- Demo seed, still to add (see docs/testing.md): requests and Northline's mocked sheet (Phase 2),
  Acme's Saturday event day with the 6am dropout and pay records (Phase 3), the short-notice firm
  cancellation (Phase 5), 12 pay queries, 9 about one rate change (Phase 6).
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
