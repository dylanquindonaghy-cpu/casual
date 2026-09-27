# Testing

Reliability matters more than scale. Tests exist so a solo builder can change things at 9pm
without breaking a 6am cancellation.

## Layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Unit | Vitest | Rules engine (table-driven), ranking, notice-hours maths, grouping keys, template rendering, zod schemas for AI outputs | every commit |
| Integration | Vitest + real Postgres (Docker) | RLS isolation per table, scoped client, atomic assign race, idempotent webhook insert, job handlers with a fake clock, Sheets adapter against a mocked Sheets API | every commit |
| E2E | Playwright (mobile viewport) | login → my shifts → take shift → cancel → request → pay OTP; office: create shift → make urgent → wave → assign; firm cancel → notice report | on PR and before deploy |
| Contract | Vitest | Twilio signature verification with real sample payloads; TwiML output; template variable coverage | every commit |
| Security | scripts | `npm audit`, secrets scan, RLS "enabled on every table" check, log masking test | every commit |
| Manual | checklist | Real phone, real Twilio number, iPhone home-screen push, poor-signal open of My shifts | before pilot |

## Must-have tests (name them so `/verify` can find them)

- `rls.every-table.test.ts` — asserts every firm-scoped table has RLS enabled and a policy.
- `tenancy.isolation.test.ts` — Firm A session cannot read/write Firm B rows, table by table.
- `assign.race.test.ts` — 10 concurrent `takeShift` calls for 1 slot → exactly 1 success.
- `webhook.idempotent.test.ts` — same Twilio MessageSid twice → one `messages` row, one job.
- `rules.table.test.ts` — all cases in `docs/rules-and-credentials.md`.
- `waves.timing.test.ts` — fake clock: wave 1 → 15 min → wave 2; stops on fill; escalation fires.
- `notify.policy.test.ts` — push → WhatsApp → SMS ordering; quiet hours; daily cap; idempotency.
- `notice.report.test.ts` — worker cancel, firm cancel/move/curtail all produce correct notice hours and flags.
- `pay.grouping.test.ts` — group keys stable; AI summary failure falls back cleanly.
- `sheets.sync.test.ts` — column mapping, batch writes, never more than N reads per minute.

## Fixtures and the demo seed

`npm run db:seed` creates two fake firms:

**Acme Events (security/events, native mode):** 60 workers (5 with expired SIA, 3 "applied"),
3 sites (stadium, racecourse, shopping centre), a Saturday event with 40 shifts, one 6am
cancellation that becomes urgent, two open requests, pay records for 8 weeks, 12 pay queries
(9 about one rate change).

**Northline Rail Labour (rail, Sheets mode with a mocked sheet):** 30 workers with PTS/Sentinel/
D&A dates, night possessions, one short-notice firm cancellation.

The demo script for calls walks Acme's Saturday: worker logs in → takes an open shift → cancels →
resourcer sees it → urgent wave fills it → notice report shows both.

## Pre-pilot checklist

- [ ] All must-have tests green in CI
- [ ] Restore from backup tested on a fresh database
- [ ] Twilio fallback forwards a real call to a real mobile
- [ ] WhatsApp templates approved; test send to 3 real phones (Android, iPhone, older phone via SMS)
- [ ] Load smoke: 200 webhooks in a minute don't back up the queue
- [ ] Log masking verified (no phone numbers in logs)
- [ ] Budget alert and uptime check firing to your phone
