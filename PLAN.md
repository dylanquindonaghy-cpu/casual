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
- **Dylan to confirm:** the office's override reason is free text in `events.data`. `bookShift()`
  refuses one holding a phone number or email address, but a name could still get in, and it
  shows in the shift's History. The Phase 5 manual-assign screen (built) keeps free text for now.
  The fix is reason codes plus a note kept on the assignment row, which means changing the
  booking path's API and the database: confirm before it's built.
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
- Office import screens: shifts is built (`/office/shifts/import`, dry run first). Workers and
  credentials ("import CSV" on a workers screen) and pay records (Phase 6) reuse
  `importShiftsFile()`'s pattern with their kind.
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
  Still open: decide whether a firm may change the 3 (fixed policy today). Scale: under first
  come, first served a wave takes one lock per eligible worker and holds them while it sends; fine
  at pilot size, but for firms with hundreds of casuals chunk the waves or use one firm-wide lock.
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
    (not inside it) when the real web push sender is connected.
  - Office view of reminders (Phase 5 Today / no-show screens): show an old `sending` row as "may
    have gone" next to the booking.
  - Offer waves still send inside one transaction (a failure after a message rolls back its offer
    row). Move them to the reminders' claim → send → record pattern in a later task.

  - A reminder still goes when a credential the shift needs has expired or been suspended since
    booking. Decide whether that should hold the reminder and alert the office (Phase 5 Today
    view).
  - **Before connecting Twilio (found in the reminders review, affects every sender):** events log
    `providerMessageId`, and `recordEvent` refuses values the log masker would change. A real
    Twilio id (`SM` + 32 hex characters) contains a 10-digit run about 8% of the time, looks like a
    phone number, and would make the event write throw after the message went. Exempt that key
    or store only a safe form, with a test using a Twilio-shaped id.
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
  5. STOP replies to SMS mark the channel opted out.
  6. Test with 3 real phones (Android, iPhone, an older phone by SMS): the pre-pilot checklist.
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
  - **Dylan to confirm:** notice hours for a move count from the old start, so a move to an earlier
    time overstates the notice the worker had (the new start and the change time are both logged,
    so it can be worked out later).
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
  - **Dylan to confirm:** the office's override reason when placing someone ("Rang in") is typed
    text stored in the append-only log (checked for phone numbers and emails only), and the log
    shows it to admins and resourcers. Keep it, or switch to a fixed list like the change reasons?
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
  - Edge cases: the Google Sheets sync can still move a started shift's times (marks stay on a
    shift the sheet moved into the future); a sheet shift cancelled after it started keeps its
    bookings, shows under "Who worked?" and can be marked, but hours on a cancelled shift don't
    count; the profile's booked days count only `confirmed` bookings, so a day marked as worked
    loses its "booked" flag on the unavailable-days list.
- **Submit the WhatsApp templates** (the Phase 4 "All copy … templates submitted to Meta" task is
  blocked on it: needs the Twilio account and WhatsApp sender from "Connect Twilio", step 1). The
  pack is `src/lib/messaging/whatsapp-templates.ts`: 18 templates (6 "no site" variants and a "no note" one), each
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
  7. docs/compliance.md: add the browser push services as sub-processors, how long
     `push_subscriptions` rows are kept, and what notifications show on a locked phone (the
     Phase 8 privacy notice).
  Also: push the office's escalation alert, and the push-first-then-WhatsApp order (the `notify`
  task).
- **Connect Bedrock** (the Phase 6 "Group queries by likely cause … Haiku summarises" task is
  blocked on it: an outside service with an AWS account and money). The grouping is built; only
  the AI's one-line summary per group waits (the app writes its own line meanwhile).
  1. In the AWS console (London account, eu-west-2), open Amazon Bedrock → Model access, and ask
     for access to Claude Haiku (an EU cross-region inference profile, so data stays in the EU).
  2. Create an IAM role for the worker's server allowing only `bedrock:InvokeModel` on that
     profile. No keys in the repo: the Lightsail instance's role, or keys in its environment.
  3. Write the Bedrock client behind `AiClient` (`src/lib/ai/client.ts`): a timeout (5 seconds),
     no retries in a request path, and log the call (purpose, model, tokens; never the prompt).
  4. Add `AI_TRANSPORT=bedrock|none` to the worker's environment (default `none`); the payroll
     digest (next task) passes the client to `loadPayQueryGroups({ ai })`.
  5. docs/compliance.md: Bedrock as a sub-processor (AI disclosure); the model sees only a
     group's facts (count, issue, week, site, rate), no names or workers' words.
  Then tick the grouping task after a real summary passes the checks.
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
  - docs/testing.md names `pay.grouping.test.ts` for the Phase 6 tests task; the keys and the
    summary are tested in `tests/unit/pay.group-keys.test.ts` and `tests/unit/ai.pay-summary.test.ts`
    so far.
  - Regrouping runs when asked (`regroupPayQueries()`); the digest now runs it first, so a pay
    line imported after a query moves it to the right group (done in the digest task).
  - Payroll's page is read only (apart from "Send the digest now"): resolving a group and telling
    its workers is the "Worker sees status updates" task.
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
  - Privacy notice (Phase 8): say the offline copy of My shifts is stored on the phone (strictly
    necessary storage) and what deletes it.
  - The hint's wording "Open your browser's Share menu" is meant to fit Safari's and Chrome's
    layouts; check it on the real iPhone too.
- Plain-language follow-ups (from the Phase 3 empty and error states task):
  - Phase 4 must make "We'll message you when something matches" (Open shifts, nothing open)
    true: offers to workers with open-shift messages on.
  - Office screens (Phase 5): their own empty and error states, and add them to
    `tests/unit/copy.plain-language.test.ts` (with office words allowed, e.g. "credential").
  - After a session runs out, the login page could say "Your login has run out. Log in again."
    (today it shows the normal login page).

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
