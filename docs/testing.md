# Testing

Reliability matters more than scale. Tests exist so a solo builder can change things at 9pm
without breaking a 6am cancellation.

## Layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Unit | Vitest | Rules engine (table-driven), ranking, notice-hours maths, grouping keys, template rendering, zod schemas for AI outputs | every commit |
| Integration | Vitest + real Postgres (Docker) | RLS isolation per table, scoped client, atomic assign race, idempotent webhook insert, job handlers with a fake clock, Sheets adapter against a mocked Sheets API | every commit |
| E2E | Playwright (mobile viewport; own web app, worker and seeded `*_e2e` database; login links read from the console transport's outbox file) | login → my shifts → take shift → cancel → request → pay OTP (built: `tests/e2e/flow.worker.spec.ts`, timed); office: create shift → make urgent → wave → assign; firm cancel → notice report | on PR and before deploy |
| Contract | Vitest | Twilio signature verification with real sample payloads; TwiML output; template variable coverage | every commit |
| Security | scripts | `npm audit`, secrets scan, RLS "enabled on every table" check, log masking test | every commit |
| Manual | checklist | Real phone, real Twilio number, iPhone home-screen push, poor-signal open of My shifts | before pilot |

## Must-have tests (name them so `/verify` can find them)

- `rls.every-table.test.ts` — asserts every firm-scoped table has RLS enabled and forced, exactly
  the tenant policy, exactly its `TABLE_ACCESS` grants, composite foreign keys; and that tests
  connect as the restricted `shiftdesk_app` role.
- `tenancy.isolation.test.ts` — Firm A session cannot read/write Firm B rows, table by table,
  each with a positive control (Firm B can); includes every cross-table foreign key.
- `rls.mutation.test.ts` — the same probes see Firm B's rows when the policy is broken, RLS is
  off or the connection is a superuser (proves the isolation tests can fail).
- `scoped-client.test.ts`, `directory.test.ts`, `jobs.envelope.test.ts`, `lint.db-boundary.test.ts`
  — the firm is set per transaction; host lookup exposes directory fields only; jobs run and are
  queued inside their own firm; app code can't import the raw pool.
- `assign.race.test.ts` — 10 concurrent `bookShift` calls for 1 slot → exactly 1 success (and for
  3 slots, exactly 3); one worker in two tabs can't book two overlapping shifts, or pass a weekly
  cap twice (the worker lock).
- `webhook.idempotent.test.ts` (built, Phase 7) — same Twilio MessageSid twice → one `messages` row,
  one job; for every webhook that stores (WhatsApp, text, call, withheld call, voicemail text) the
  same Twilio id twice in a row and then ten copies at the same moment (the pool's connections
  opened first, so they really overlap) → one row and one job (a call: one `call.received`, one
  login link), every copy answered 200; the "done" webhook answers every copy the same; the reply
  job run ten times at once → one reply sent and stored (it fails without the claim's row lock).
- `twilio.contract.test.ts` (built, Phase 7) — signature contract tests: a signer written in the
  test from Twilio's published algorithm reproduces Twilio's documented example, then signs
  requests shaped as Twilio documents them for each webhook (every field Twilio sends; raw form
  bodies with "+" as %2B, spaces as "+" or %20, emoji, "£", "&", new lines; the charset header):
  each is accepted and stored exactly; signed over the encoded values, for http, for another
  webhook, or with a field dropped after signing: refused. Captured real requests are to be added
  when Twilio is connected. `twilio.webhooks.test.ts` (built) holds every Twilio route to the
  checks and to storing once.
- `rules.table.test.ts` — all cases in `docs/rules-and-credentials.md` (held to the doc by
  `rules.doc-parity.test.ts`), then the edges: overrides, the pass, clock changes, purity.
- `waves.timing.test.ts` (built) — a real cancellation starts the chain and a fake worker
  (`tests/helpers/fake-worker.ts`) runs the firm's queued pg-boss jobs in order on a fake clock:
  wave 1 at the dropout, the next after the firm's minutes (15 by default) until nobody's left,
  the office emailed once at the start minus 3 hours; the firm's own size and minutes; first come,
  first served; quiet hours hold a wave until 07:00; stop on fill (a worker or the office takes it
  between waves: the next wave stops, the other offers become "filled elsewhere", no escalation);
  the start ends the chain.
- `jobs.no-resend.test.ts` (built, Phase 10) — senders failed during or just after their message and
  run again: the retry sends nothing (the office's offer, the credential warning and expiry notice,
  and login links and codes, which still work, log the send once, as unconfirmed; firm-change notices
  and request answers are already logged by their claim event); escalation and the Monday list,
  claimed before they send, run twice; two
  login-code copies at once; and every sender's failed send logged and never retried. Escalation
  and waves crashing between recipients: `offers.waves.lock.test.ts`.
- `offers.close.test.ts` (built, Phase 10) — a shift that fills closes its waiting offers at once:
  first come, first served; after the last fair-rotation wave; the office placing an offered worker
  or someone else; two places (the first booking closes nothing); "Mark as filled"; a headcount cut.
- `offers.waves.lock.test.ts` (built, Phase 10) — a wave never holds what others wait for: a
  300-worker first-come wave through a slow transport, where a worker's Take shift and the office's
  Assign each finish within 2 seconds mid-wave and the wave then stops without messaging the rest;
  a recipient's STOP or erasure lock isn't held up; a crash just after a claim never messages that
  worker twice; two copies of a wave share it and queue one next wave; escalation emails with the
  shift unlocked, one failed address not stopping the rest; the worker runs the real tasks.
- `notify.policy.test.ts` (built) — the policy for every sender (offer waves and shift reminders,
  each through its real job): the worker's channel first (WhatsApp, or text by their choice), a
  text only after a refused WhatsApp, never both, the push after the message has gone and never
  for a failed one (so "push → WhatsApp → SMS" as built: the push goes alongside, not instead;
  the 60-second fallback waits for Twilio); quiet hours; the daily cap; idempotency (retries and
  doubled jobs); and no notifications to ineligible workers: over a whole chain, exactly the
  workers the rules allow and who want offers get anything (no licence, expired, suspended, wrong
  role, inactive, blocked, alerts off, day off, clash, cancelled off it, another firm: nothing).
- `shift.reminders.test.ts` (built) — the 24 h and 2 h reminders each once per booking and start
  time, never to cancelled bookings or cancelled/draft shifts, a moved shift reminded again, two
  jobs at once send once, quiet hours hold or skip, channel and fallback, the tick; the timing
  rules in `rules.reminders.test.ts`.
- `notice.report.test.ts` — worker cancel, firm cancel/move/curtail all produce correct notice hours and flags.
  Built (`tests/integration/notice.report.test.ts`): through the real paths (the portal's take and
  cancel, the office's cancel-one, cancel-shift, move and shorten, and the Google Sheets sync's
  book, shorten, move and remove), read back through the report and its CSV: who started each
  change, notice hours from the path's own clock, the flag exactly at 48 hours (48.00 not short,
  47.99 short) and at a firm's own threshold, negative notice after the start, and the firm's
  reason (a worker's typed reason never appears). A move or shortening counts from the earlier of
  the old and new start (Phase 10): a shift moved earlier (Saturday's moved on Monday to Tuesday)
  records 23 hours, flagged short and found by "short notice only", and the sheet's move an hour
  earlier records the hour less. `office.firm-change.test.ts` pins the move's locks: a booking of
  the same worker at that moment, or one on that day's "applied" allowance, is waited for and
  seen.
- `pay.grouping.test.ts` — group keys stable; AI summary failure falls back cleanly. Built in Phase 6
  (`tests/integration/pay.grouping.test.ts`, on the real database): the same facts give the same key
  whoever raises it, whatever they write, whenever and in any order; the firm's week (Monday and
  Sunday together, across the clocks going back); regrouping and re-importing the same pay file
  change nothing; keys move only when their facts do (open and in-digest queries, never sorted
  ones); two firms' same facts give the same key text but separate groups. In the digest job, an AI
  that throws, hangs (the 5-second timeout, `AI_SUMMARY_TIMEOUT_MS`), answers late, answers
  something that isn't text, or answers lines that fail the check gives the email the app sends
  with no AI, word for word; a failure for some groups leaves just those without a line. The key
  rules and the summary's check are also unit-tested (`tests/unit/pay.group-keys.test.ts`,
  `tests/unit/ai.pay-summary.test.ts`).
- `gdpr.worker.test.ts`, `gdpr.firm-export.test.ts`, `gdpr.retention.test.ts` — GDPR (Phase 8,
  on the real database). A worker's export holds a row from every table that can be about them
  (messages from their number before it was known, and every action-log row the log's Worker filter
  finds, those not naming them included) and nothing of a colleague's, another firm's
  or any login secret, as JSON and as CSV (formulas inert); admins only; logged. Erasure is refused
  while they're booked on a shift that hasn't ended; otherwise their details, credentials, logins,
  phones, days off and messages go, the typed text on requests (a note, a colleague's name), pay
  queries and cancellations is cleared (the app's fixed reason words stay), and bookings, offers,
  reminders, pay lines and events stay on the anonymous row; a second go says
  already; a notice queued before it never goes; the database refuses a half-erased row; the
  owner-run half (`app_erase_worker`, which takes only a worker) refuses no firm, another firm's
  worker and a second go. The firm export holds every row of every firm table but the listed login
  tables (a new table must be exported or listed), no other firm's ids and no secrets. The purge
  deletes each kind only past its age (a day either side), only in its own firm, logs every run and
  deletes nothing more the second time; the tick queues one a day per firm; the message function's
  90 days are pinned. The office page and downloads in a browser: `tests/e2e/gdpr.spec.ts`.
- `load.smoke.spec.ts` (e2e) — the pre-pilot load smoke: 200 signed WhatsApps to the shifts line
  in well under a minute through the real web app and worker; every webhook answered 200 quickly
  (p95 under 2 s, after one warm-up), every message's reply stored within a minute of the last. It
  failed (31 of 200 in a minute) before the worker fetched firm jobs in bursts.
- `custom-domain.spec.ts` (e2e) and `auth.own-domain.test.ts` — a firm's own domain (Phases 8 and
  10). Served only once verified, with the firm's bar; Caddy's certificate check. A worker and an
  office user who log in on it get their link back on it and stay logged in there (the session
  cookie on that address only; audit M7, L84). In the browser tests the made-up domain gets https
  from `tests/e2e/tls-front.ts`, standing in for Caddy: a browser keeps no `Secure` cookie over
  plain http on a name that isn't localhost. The integration test: the job takes the domain from
  the firm's own record and only while it's verified; a request on the portal gets the portal; a
  job queued without `address` gets the portal; the payload takes only the two words.
- `error-page.spec.ts` (e2e) and `error-pages.test.ts` — the error screens recover (audit M4). The
  failures are on purpose and only in the e2e run (`src/lib/e2e/fails-once.ts`: `E2E_TEST_PAGES=on`,
  which only `playwright.config.ts` sets and the app refuses unless its address is localhost; off,
  the test page is "not found" and the root layout's hook reads nothing). A page that fails the
  first time (`/e2e/fails-once?id=`) shows "Something went wrong" with "Go to my shifts"; "Try
  again" fetches it again and it shows. "Go to my shifts" is a full page load. With no signal it
  says "No signal" and "Try again" is off until the signal is back. The page's frame failing once
  (a cookie) shows the whole-page error, and "Try again" loads the page. With the old buttons
  (Next's `reset()`, a Next link), "Try again" left on with no signal, or a whole-page "Try again"
  that does nothing, the matching test fails. The unit test checks each button's wiring, the
  whole-page form (it works without the page's scripts), and that no deploy or CI file sets the
  switch.
- `logs-scan.test.ts` and the e2e teardown (`tests/e2e/teardown.ts`) — no phone number or email in
  the servers' output for the whole e2e run: numbers with spaces or dashes, +44 / 0044 / 0, in
  brackets, after a slash, in URLs (%2B, a form's +), emails (%40 too); ids, ISO times, versions,
  decimals, IP addresses, Unix times and already-masked values left alone; a firm's own shifts line
  allowed, nothing else; the report never shows a value. `worker.firm-work.test.ts`: firm jobs
  come 5 per fetch but run one after another in order, and one failing leaves the rest alone.
- `onboarding.test.ts` — onboarding a pilot firm (Phase 9, on the real database): `firm:create`
  makes the firm, applies its sector's pack, adds its admin and logs all three; refuses bad values
  and a taken slug (any case); the firm's row is logged with it even when the rest stops; a setup
  that stopped after the firm's row is finished by running it again (a different name or sector is
  refused), and two runs finishing it at once give one admin. `firm:office-user` adds a resourcer or payroll
  user (logged), leaves an existing email alone (saying its role), refuses bad values.
  `firm:settings` shows what the app reads (defaults marked), saves values the app would use and
  logs the keys with the old and new values, and refuses
  every value the app would ignore or fall back from (nothing saved, even with good ones beside
  it). `firm:check` from a new firm and from real-looking data: branding, office users, workers
  and credentials, a role in use with no rule (not a cancelled or past shift's), the line, a
  baseline; never another firm's data; never a person's name, number or email.
  `deploy.compose.test.ts`: the one-off `owner` service for these commands on the server.
- `ops.alerts.test.ts` (unit and integration) — alerts to the founder (Phase 8). The thresholds
  (failed jobs, a failing sheet sync, more than 5% of at least 20 WhatsApps and texts failing, the
  health check, 20 bad signatures), the words (and that an alert holding a phone number or email is
  refused; every queue failing still fits, the 5 biggest named; a slug that looks like a phone
  number is replaced by the firm id's start), the web's bad-signature counter (the 20th in an hour alerts, then not again for an
  hour; counts over an hour old are forgotten; a failing sender is logged, not thrown), the health
  check (three tries, the reason, a 200 that isn't `{ok: true}`), on the real database: a firm's
  send counts over the last hour, WhatsApp and text only, only senders that log failures, not a
  worker's texts-off, never another firm's; a sheet not synced for 30 minutes, still being tried,
  enabled, never another firm's; failed jobs by queue, not the alerts' own; a repeat within a
  rolling hour not queued, even across the clock hour; one part failing (listing firms included)
  doesn't stop the others; the schedule. `env.test.ts`: alerts can't be turned off in production.
- `sheets.sync.test.ts` — a seeded (fake) Google Sheet syncs both ways: staff, sites, shifts and
  who holds each come in (one read per sync, columns by header); bookings made here go back in one
  batch write; the three-way merge (office and portal changes at once), sheet names through the
  rules, conflicts, bad rows, failures, leases and deadlock retries; the shared roster contract.

## Fixtures and the demo seed

`npm run db:seed` creates two fake firms:

**Acme Events (security/events, native mode):** a fake shifts line (+44 7700 900000, Ofcom's drama
range; Northline has none), 60 workers (5 with expired SIA, 3 "applied"),
3 sites (stadium, racecourse, shopping centre), a Saturday event with 40 shifts, one 6am
cancellation that becomes urgent, two open requests, pay records for 8 weeks, 12 pay queries
(9 about one rate change).

**Northline Rail Labour (rail, Sheets mode with a mocked sheet):** 30 workers with PTS/Sentinel/
D&A dates, night possessions, one short-notice firm cancellation.

**What exists when.** `npm run db:seed` (also run by `npm run db:reset`) grows with each phase.
Phase 1 loads both firms, their sites, office users (admin, resourcer, payroll), workers and
credentials (Phase 2 adds each firm's credential pack: security for Acme, rail for Northline): Acme's 60 workers (5 expired SIA, 3 applied) and Northline's 30 with PTS, Sentinel
and drugs and alcohol dates. Phase 3 adds Acme's Saturday event day
(`src/lib/db/admin/seed-saturday.ts`), described below. Still to come: Northline's mocked sheet
(Phase 2), the short-notice firm cancellation (Phase 5) and pay queries (Phase 6). Numbers are in Ofcom's drama range (+447700900000-999), emails are
@example.com, credential numbers start `TEST-`; the seed refuses production and non-local
databases, and running it twice changes nothing (fixed ids, upserts).

**Acme's Saturday (Phase 3).** The next Saturday after the seed runs (re-run `npm run db:reset`
before a call so it's the coming one):
- 40 shifts across the three sites, each with instructions:
  - arena match day: 14 stewards 12:00 to 18:30, 8 door supervisors 11:30 to 19:00, and one
    early door supervisor 08:00 to 16:00;
  - racecourse: 6 stewards 10:30 to 18:30, 4 security officers 09:00 to 19:00;
  - shopping centre: 4 security officers 07:00 to 15:00, 3 more 15:00 to 23:00.
- 32 shifts are booked, each by a worker the rules allow, and 8 are open.
- The early door supervisor is the urgent dropout. Worker 37 (07700 900137) booked it three days
  before the seed ran and cancelled at 06:00 on the seed day, or at the moment the seed ran if
  that was before 06:00 ("I'm unwell", notice recorded). It's open again and marked urgent. The
  seed prints a link to its page.
- Two open requests: a time change and a swap.
- Every Acme worker has 1 to 8 weekly pay lines from the last 8 complete weeks (stewards £13.00
  an hour, door supervisors £14.50, security officers £13.50).
- The action log has each shift's creation, each booking, the cancellation (with notice hours) and
  the requests. Those entries are dated when the seed ran (the log can't be backdated); the
  shifts are dated a week earlier, before every booking.
- Re-running `npm run db:seed` the same week adds nothing and never undoes a demo's changes. Run
  in a later week, it adds that week's Saturday too; run on a Saturday, it adds next Saturday
  while today's is still there. Use `npm run db:reset` for exactly one Saturday.

**Demo logins (Acme, `http://acme.localhost:3000/login`):**

| Mobile | Who | Good for |
|---|---|---|
| 07700 900100 to 900104 | Stewards, never booked by the seed | Log in, see the 4 open steward shifts, take one, cancel it |
| 07700 900105 | Steward, booked at the arena, asked for a time change | My shifts with a booking, My requests |
| 07700 900125 to 900129 | Door supervisors (and stewards) whose SIA licence has expired | Profile's red licence. Open the urgent dropout's link (the seed prints it): the page says why they can't take it, with "Ask the office to review" |
| 07700 900130 to 900136 | Door supervisors, booked at the arena | A booked shift with instructions |
| 07700 900137 | The door supervisor who dropped out | Nothing booked; the dropout's page shows it's open again |
| 07700 900138 to 900144 | Door supervisors with a valid licence, never booked | My shifts says "1 urgent shift needs someone"; the urgent board (`/urgent`) shows the dropout with "Take shift" |

The login link appears in the `npm run dev` terminal (console messaging).

The demo script for calls walks Acme's Saturday: worker logs in → takes an open shift → cancels →
resourcer sees it → urgent wave fills it → notice report shows both.

**Staff part (works now; `tests/e2e/flow.worker.spec.ts` runs it on a phone-sized screen and
checks log in, take and cancel each finish in under 30 seconds):**
1. `npm run db:reset`, then `npm run dev`. Open `http://acme.localhost:3000/login` on a phone or
   a narrow browser window.
2. Log in as `07700 900157` (a security officer with nothing booked). The link appears in the
   `npm run dev` terminal. You should see "Hello {name}" and "No shifts booked yet."
3. "See open shifts" → "Take shift" on the racecourse shift → "You're booked." with a
   reference, signed "Acme Events Shift Team".
4. "See my shifts" → "Cancel this shift" → "I'm unwell" → "Confirm cancellation" → "We've
   recorded your cancellation.", the notice given and a reference.
5. Take the late shopping-centre shift, then "Ask for a change" → "Change the times" → "Send
   request" → "Request sent."; My requests shows it "Waiting for the office".
6. "See your pay" → "Send me a code" (the code appears in the terminal) → the last 8 weeks of
   pay.
7. Also worth showing: the urgent dropout's page (the seed prints its link) as `07700 900125`,
   whose SIA licence has expired: why they can't take it, and "Ask the office to review".

**Office part (Phase 4 and 5):** "resourcer sees it": log in at `/office/login` as
`acme.resourcer@example.com` (the link appears in the terminal). Today shows the urgent dropout
(with its wave status once the worker process has sent offers), the Saturday gaps, the dropout
under "Cancelled in the last 24 hours" with its notice, and the two requests. "Offer to someone"
on a gap lists who could take it. "Urgent wave fills it" runs by itself with `npm run dev` (offer
waves; messages print in the terminal). "Notice report shows both": "Notice report" in the office menu lists
the worker's booking and cancellation (and the wave's offers) with the notice each had; the action
log has every step.

## Pre-pilot checklist

- [ ] All must-have tests green in CI (locally: see the latest `VERIFIED` line from
      `scripts/verify.sh`; on GitHub: the Actions tab's last "CI" run on `main`: `gh` isn't
      installed here)
- [ ] Restore from backup tested on a fresh database ("Try the runbooks for real", restore step)
- [ ] Twilio fallback forwards a real call to a real mobile ("Connect Twilio" step 10)
- [ ] WhatsApp templates approved; test send to 3 real phones (Android, iPhone, older phone via SMS)
      ("Connect Twilio")
- [x] Load smoke: 200 webhooks in a minute don't back up the queue. `tests/e2e/load.smoke.spec.ts`,
      every e2e run: 200 signed WhatsApps in about 5 seconds, each webhook answered in well under a
      second, every reply stored within 15 seconds of the last (the asserted bound; with no network
      delay a run takes about a second). First run, 2026-09-30: only 31 of 200 handled in a minute:
      the worker waited its 2-second poll after every job; now it fetches again at once while
      there's a backlog (`FIRM_WORK_OPTIONS` in `src/worker/jobs/index.ts`).
      With a real send's delay: `tests/integration/inbound.load.test.ts` (Phase 10) answers 200
      workers' messages through a fake provider taking 300 ms a message within 20 seconds of the
      last (`INBOUND_DRAIN_BOUND_MS`; about 11 seconds here), 8 loops at once, one worker's
      messages still in order, never two sends to one number at once. A worker killed mid-batch
      leaves nothing stuck for more than about a minute: the 30-second heartbeat, then the
      supervisor's next look (every 15 seconds; `tests/integration/jobs.crash.test.ts`, with
      production's settings).
      On this laptop: run it once against the server too (PLAN.md "Pre-pilot checks on the
      server").
- [x] Log masking verified (no phone numbers in logs). Every e2e run keeps the worker's and web
      app's whole output (`.dev/e2e-worker.log`, `.dev/e2e-web.log`) and `tests/e2e/teardown.ts`
      fails the run on any phone number or email it finds there (`scripts/logs-scan.ts`: its own
      patterns, not the masker's, after undoing URL and form escapes; a firm's own shifts line
      allowed). It found a mobile typed into the office's worker search printed in the web server's
      request log; the search no longer goes in the address. On the server after the dry run:
      docs/runbooks.md "Checking the logs for personal data".
- [ ] Budget alert and uptime check firing to your phone ("Connect monitoring", "Connect alerts
      to your phone")
- [ ] Only if a pilot firm wants its own domain: a periodic re-check of every verified domain's
      CNAME (marking it unverified once it no longer points to us) is built **before** that
      domain is verified. Since Phase 10 a login link can go to a verified own domain; a domain
      that has stopped pointing to us but is still marked verified would get login links, and
      whoever now holds it could use them. With it, a way to end the sessions made on a domain
      that's lost (a session isn't tied to an address, so they'd stay valid for up to 30 days)
      (PLAN.md Parking lot, "Phase 8 custom domains")
