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
- `webhook.idempotent.test.ts` — same Twilio MessageSid twice → one `messages` row, one job.
- `rules.table.test.ts` — all cases in `docs/rules-and-credentials.md` (held to the doc by
  `rules.doc-parity.test.ts`), then the edges: overrides, the pass, clock changes, purity.
- `waves.timing.test.ts` — fake clock: wave 1 → 15 min → wave 2; stops on fill; escalation fires.
- `notify.policy.test.ts` — push → WhatsApp → SMS ordering; quiet hours; daily cap; idempotency.
- `shift.reminders.test.ts` (built) — the 24 h and 2 h reminders each once per booking and start
  time, never to cancelled bookings or cancelled/draft shifts, a moved shift reminded again, two
  jobs at once send once, quiet hours hold or skip, channel and fallback, the tick; the timing
  rules in `rules.reminders.test.ts`.
- `notice.report.test.ts` — worker cancel, firm cancel/move/curtail all produce correct notice hours and flags.
- `pay.grouping.test.ts` — group keys stable; AI summary failure falls back cleanly.
- `sheets.sync.test.ts` — a seeded (fake) Google Sheet syncs both ways: staff, sites, shifts and
  who holds each come in (one read per sync, columns by header); bookings made here go back in one
  batch write; the three-way merge (office and portal changes at once), sheet names through the
  rules, conflicts, bad rows, failures, leases and deadlock retries; the shared roster contract.

## Fixtures and the demo seed

`npm run db:seed` creates two fake firms:

**Acme Events (security/events, native mode):** 60 workers (5 with expired SIA, 3 "applied"),
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

**Office part (Phase 4 and 5):** "resourcer sees it" (the office Today view), "urgent wave fills
it" (offer waves) and "notice report shows both" (the notice report) aren't built yet. The
action log already records every step above.

## Pre-pilot checklist

- [ ] All must-have tests green in CI
- [ ] Restore from backup tested on a fresh database
- [ ] Twilio fallback forwards a real call to a real mobile
- [ ] WhatsApp templates approved; test send to 3 real phones (Android, iPhone, older phone via SMS)
- [ ] Load smoke: 200 webhooks in a minute don't back up the queue
- [ ] Log masking verified (no phone numbers in logs)
- [ ] Budget alert and uptime check firing to your phone
