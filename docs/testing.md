# Testing

Reliability matters more than scale. Tests exist so a solo builder can change things at 9pm
without breaking a 6am cancellation.

## Layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Unit | Vitest | Rules engine (table-driven), ranking, notice-hours maths, grouping keys, template rendering, zod schemas for AI outputs | every commit |
| Integration | Vitest + real Postgres (Docker) | RLS isolation per table, scoped client, atomic assign race, idempotent webhook insert, job handlers with a fake clock, Sheets adapter against a mocked Sheets API | every commit |
| E2E | Playwright (mobile viewport; own web app, worker and seeded `*_e2e` database; login links read from the console transport's outbox file) | login → my shifts → take shift → cancel → request → pay OTP (built: `tests/e2e/flow.worker.spec.ts`, timed); office: create shift → make urgent → wave → assign; firm cancel → notice report. Then a second run (`playwright.walkthrough.config.ts`, Phase 10 task 20): `walkthrough.spec.ts` does every step of `docs/walkthrough.md` in order, on its own freshly seeded database and a **production build** (`next build`, `next start`, port 3200), the office at desktop size and the worker at phone size, so a verified run proves the production build too (audit L16, L88, L66). That run is in demo mode (16.1; ADR-025), as a demo server is: the web app and the worker both in production, behind the demo's password (the browser gives it). After the walkthrough, `demo.spec.ts` checks the password is asked everywhere but the health check, logs a casual and the office in from each firm's Demo phone and checks neither firm's Demo phone shows the other's messages (a number in both firms: `tests/integration/demo.phone.test.ts`); the main run's `demo.off.spec.ts` checks there's no Demo phone or demo bar without it | on PR and before deploy |
| Contract | Vitest | Twilio signature verification with real sample payloads; TwiML output; template variable coverage | every commit |
| Security | scripts | `npm audit`, secrets scan, RLS "enabled on every table" check, log masking test | every commit |
| Manual | checklist | Real phone, real Twilio number, iPhone home-screen push, poor-signal open of My shifts | before pilot |

## Fakes in place of outside services

No test reaches Twilio, an SMTP server, Anthropic, TravelTime, postcodes.io or a planner (CLAUDE.md
conventions). Each one has a stand-in, the settings (`src/lib/env.ts`) refuse the real one under
`NODE_ENV=test`, and `scripts/invariants.sh` checks the pins in `tests/setup/env.ts` and
`playwright.config.ts`, so a real setting in `.env` can't reach a test.

| Outside service | Stand-in in tests and the demo | Where |
|---|---|---|
| Twilio (WhatsApp, SMS, calls) | `MESSAGING_TRANSPORT=console`, the only sender built so far ("Connect Twilio", Parking lot): prints each message; the browser tests read login links from its outbox file (`CONSOLE_OUTBOX_FILE`). `none` (P2.5, production before a text system exists) refuses every WhatsApp and text: `tests/unit/messaging.none.test.ts` | `src/lib/messaging/` |
| Email (any SMTP provider) | `EMAIL_TRANSPORT=console`; `smtp` is refused in tests. The SMTP sender's own tests use no network (12X.2) | `src/lib/messaging/smtp.ts` |
| Anthropic (AI) | `AI_TRANSPORT=none` (the code's fallback answers); tests that need an answer pass `createFakeAi()`; the Anthropic client's own tests use a fake `fetch` (12X.3) | `src/lib/ai/client.ts`, `src/lib/ai/anthropic.ts` |
| postcodes.io and TravelTime | `TRAVEL_PROVIDER=fake`: fixed points for the made-up `ZZ` postcodes only (`ZZ0` is never found, for "unknown postcode"), and travel times worked out from the straight line | `src/lib/travel/geocoder.ts` (`fakePoint`), `src/lib/travel/provider.ts` (`fakeTravelProvider`) |
| A firm's planner (webhooks out) | `WEBHOOK_TRANSPORT=console`: prints each delivery; `https` is refused in tests and required in production | `src/lib/integrations/webhook-transport.ts` |
| The planner API's secret | A made-up `INTEGRATIONS_SECRET` pinned in each test setup | `tests/setup/env.ts`, `playwright.config.ts` |

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
  first served (one place's 5 in one wave, and the firm's own number per place every 10 minutes,
  fewest hours first: P4.3); quiet hours hold a wave until 07:00; stop on fill (a worker or the
  office takes it between waves: the next wave stops, the other offers become "filled
  elsewhere", no escalation); the start ends the chain.
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
  300-worker first-come wave (20 per place: P4.3) through a slow transport, where a worker's Take
  shift and the office's Assign each finish within 2 seconds mid-wave and the wave then stops
  without messaging the rest; a recipient's STOP or erasure lock isn't held up (a wave at its
  most, 50); a crash just after a claim never messages that worker twice; two copies of a wave
  share it and queue one next wave (in both modes since P4.3); escalation emails with the shift
  unlocked, one failed address not stopping the rest; the worker runs the real tasks. Since P4.4,
  4 messages at once at most with the claims never overlapping; a crash mid-wave thrown only once
  the sends already going have finished and been logged, and nobody messaged twice; 50 casuals
  with 300 ms sends done within 6 seconds. `eligibility.batch.test.ts` holds the batched rules to
  the single ones for 2,000 workers of every kind on one shift, `worker.firm-work.test.ts` the
  waves one per fetch, and `worker.hello.test.ts` (real pg-boss) their half-second poll: each short
  job starts within a second of the one before.
- `offers.scale.test.ts` (built, P4.3) — a big firm's gap: 2,000 made-up casuals
  (`tests/helpers/bulk-seed.ts`, from both of Ofcom's drama number ranges) could take one urgent
  place; each first-come wave texts 5, the fewest hours this week first, never anyone twice (10
  offers after two waves, not 2,000). `offers.waves.test.ts` has the sizes on the real database:
  waves of 5, 5 and 2 for one place, 20 for four, and a place booked mid-wave shrinking it to 5,
  with the next wave reaching anyone it didn't.
- `notify.policy.test.ts` (built; P2.4) — the policy for every sender (offer waves, the office's
  offer, shift reminders, the booking confirmation, the office's change notice, a request's and a
  pay query's answer, the licence messages, each through its real job): a push first, and when a
  phone takes it nothing else (a phone that's gone is forgotten and the WhatsApp goes); then the
  worker's channel (WhatsApp, or text by their choice), a text only after a refused WhatsApp,
  never both, nothing more after a failure; then, with no text sender, an email with its subject,
  else nothing and `no_channel` logged (the licence messages have no push: they start at the
  WhatsApp; the office's change and cancellation notices go by both, the proof of notice); the 60-second fallback waits for Twilio; STOP; quiet hours; the daily cap;
  idempotency (retries and doubled jobs, by push and by email too); and no notifications to ineligible workers: over a whole chain, exactly the
  workers the rules allow and who want offers get anything (no licence, expired, suspended, wrong
  role, inactive, blocked, alerts off, day off, clash, cancelled off it, another firm: nothing).
- `shift.reminders.test.ts` (built) — the 24 h and 2 h reminders each once per booking and start
  time, never to cancelled bookings or cancelled/draft shifts, a moved shift reminded again, two
  jobs at once send once, quiet hours hold or skip, channel and fallback, the tick; the timing
  rules in `rules.reminders.test.ts`. Since P4.5, at a big firm's size: 2,000 due in one slot go
  200 a run, 4 at a time at most, each once, with another firm's job run between the first run
  and its follow-ups; a run killed part-way leaves at most 4 `sending` and the next runs send the
  rest, nobody twice.
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
  Sunday together, across the clocks going back); on a firm's pay calendar (P3.1), one key for a
  fortnight, a new query keyed on it at once and the open ones at the next regroup, and another
  firm's keys still weekly; regrouping and re-importing the same pay file
  change nothing; keys move only when their facts do (open and in-digest queries, never sorted
  ones); two firms' same facts give the same key text but separate groups. In the digest job, an AI
  that throws, hangs (the 5-second timeout, `AI_SUMMARY_TIMEOUT_MS`), answers late, answers
  something that isn't text, or answers lines that fail the check gives the email the app sends
  with no AI, word for word; a failure for some groups leaves just those without a line. The key
  rules and the summary's check are also unit-tested (`tests/unit/pay.group-keys.test.ts`,
  `tests/unit/ai.pay-summary.test.ts`).
- `pay.calendar.test.ts` (P3.1, unit) — the firm's pay calendar (`src/lib/pay/calendar.ts`): with
  none set, exactly today's ISO weeks for every day of 2026 (53 weeks) and 2027; made-up fortnights
  from an anchor, numbered from it across New Year, with no number before it; weeks from an anchor;
  the pay day any number of days after; the firm's date across both clock changes; every setting
  it can't read falling back whole. Setting it with `firm:settings` is in
  `tests/integration/onboarding.test.ts` (a start then fortnights; fortnights without a start
  refused; a hand-edited one started afresh).
- `cancel.asked-by.test.ts` (P3.4) — who asked for a cancellation, on the real database as the app
  role: the casual's own cancel says the casual, the office's (one booking or the whole session)
  the firm, a rota sheet's, a file's or a planner's not known, and a caller that knows says so (a
  client's); the database refuses a value it doesn't know or one on a booking that isn't
  cancelled; each cancellation's log entry says who asked too; migration 0053's own backfill gives earlier cancellations theirs from their status,
  `cancel_via` or the session's source; the notice report counts the cancellations it finds by who
  asked and says so on each; and the firm's strikes switch: off, a casual's late cancellation is
  no strike ("strikes_off") and the warning is the notice one, on (the default) it is. The
  decision and the default are unit-tested (`tests/unit/strikes.test.ts`,
  `tests/unit/roster.plug.test.ts`).
- `secrets.store.test.ts` (P5.1) — the secret store, on the real database: the owner's command adds,
  replaces and removes a firm's secret, logged by name only, the listing showing no value and the row
  holding none; the app role has no rights on the table and can't call the read; the jobs role
  reads only through the function; one firm's sealed value copied onto another's row never opens,
  nor does any value under another key. The sealing itself is unit-tested
  (`tests/unit/secrets.crypto.test.ts`: every seal different, bound to its firm and name, a changed
  byte or another key refused, the worker's settings taking only a real key, the web app refusing
  to start with it on a real address), and `tests/unit/deploy.compose.test.ts` keeps `SECRETS_KEY`
  to the worker and the owner service. The firm's data export leaves the table out
  (`gdpr.firm-export.test.ts`), and the jobs role may run exactly two functions, the read among
  them (`rls.every-table.test.ts`).
- `connector.caller.test.ts` (P5.2) — a connector's source and caller, on the real database as the
  app role: its session made, changed, moved with a casual booked (a reason needed, then their
  notice hours) and cancelled (`cancel_via` api, never a strike, who asked unknown), through the
  planner API's own rules (`putPlannerSession`), each change logged as the planner's with its source
  in the key's place; it reaches only the planner's sessions (the office's own is unknown to it) and
  the office can't cancel its sessions as a whole; a source switched off, a sheet's source, a
  made-up id or another firm's connector changes nothing (401 `invalid_key`), including a source
  switched off while a change waits on its row (the wait seen in `pg_blocking_pids`), and a
  switch-off waits for a change already under way; while the firm has a live planner key the
  connector changes nothing; a caller that isn't one is refused before any postcode is looked up;
  Gate B holds for a connector; the table's checks (a connector has which one and an https base
  address on a public name and no spreadsheet, never an IP address, an internal name, another port
  or a dot segment; a sheet the reverse; one source on per firm); and the sheet command leaves a
  connector alone and won't switch a sheet on beside it.
- `messaging.webex.test.ts` (unit, 15.2) — texts through a firm's Webex Interact account with a
  stand-in for the network (never the real service): the request as its public reference says
  (POST `/v1/sms`, `X-AUTH-KEY`, `{message_body, from, to: [{phone}]}`, a timeout, no redirects),
  the firm the job's own (outside a firm's job, or a firm with no key, nothing sent), a WhatsApp
  refused so the casual gets the text, each failure a code with nothing personal in it, and the
  setting refused under `NODE_ENV=test` and without `SECRETS_KEY`.
- `email.prepare.test.ts` (unit, P7.3) — an email made ready to keep: quoted history off whichever
  way it's quoted (Gmail's header on one line or wrapped, Outlook's block with or without its
  underscores, an Original Message, `>` lines), a reply below the quote kept, nothing left of a
  forwarded thread with nothing written above it, the signature and a phone's sign-off off, blank
  lines and control characters tidied, capped without cutting a character; a known casual's subject
  and words, anyone else's neither, only how many attachments.
- `email.webhook.test.ts` (unit, P7.2) — the staffing inbox's webhook with stand-ins: the signature
  first (missing, wrong, stale, a bad id or a changed body: 403, nothing looked up), 503 with no
  secret, 415 / 413 / 400 for the wrong body, the firm by the first address that's an inbox, 200
  and nothing stored for no firm or an unreadable sender, nothing of the email logged.
- `email.receive.test.ts` (P7.2, P7.3) — the same webhook into the real database as the app role: a
  known casual's own words kept with the quoted history and signature off, anyone else's (a venue,
  an inactive casual, an address two casuals share) never; the same Message-ID twice stored once;
  an address no firm has stores nothing; no job queued yet.
- `firm-inbox.cli.test.ts` (unit, P7.1) — `npm run firm:inbox` given the wrong options: the usage
  line, exit 2, no database touched.
- `email.inbox.test.ts` (P7.1) — a firm's staffing inbox on the real database: its address lower
  case and one firm's only, found for an incoming email by exactly that address (as the app role),
  set, replaced and cleared only by `firm:inbox`, each logged without the address; its emails keep
  words only from a known casual and one row per Message-ID in a firm; a casual's export and
  erasure take theirs (set to them, and from their address before it was known), and the
  retention purge takes old ones with the messages.
- `connector.events.test.ts` (P5.3) — a connector's webhooks in and its job, on the real database as
  the app role against the made-up portal in memory (never a real system): the webhook stores one
  row per event and queues one job in the same transaction (the same event again, nothing more),
  and stores nothing for a wrong signature, a switched-off source or a sheet's id; the job reads
  the record from the portal (never the webhook's body) and applies it as the planner's: a session
  made then changed, logged with its source, and a job run twice reads once; a staff record added
  through `upsertWorker()`, its roles through the name map; what isn't applied says why (gone, a
  skipped or unreadable name, a record under another ref, the planner's own refusal); a source that
  doesn't answer is tried again and the last try saves it as failed; no key, or no `SECRETS_KEY`,
  fails at once with nothing read; a source switched off before its job reads nothing, and with a
  live planner key nothing changes; the key read from the secret store on the jobs role's own
  connection; and the owner's command connects, keeps, replaces and switches a connector off, each
  logged, refusing a bad address, a sheet or a live key beside it, and (live) no agreement; and the
  review's fixes: a staff record whose mobile is another worker's is refused (`mobile_taken`), an
  unexpected error is tried again and saved as failed on the last try (never left queued), a key
  the system refuses fails at once, Gate B comes before anything is read, erasing a worker forgets
  the connector's events about them, and `app_connector_source_firm()` runs as the owner with a
  pinned search_path, callable by the app role alone, giving only an enabled connector's firm. The
  webhook's checks before anything is read (a missing, wrong, old or replayed signature 403; not a
  source 404; no secret 503; not JSON 415; too big 413; a body that isn't a change 400, its values
  never logged; a chunked body read only up to 16 kB; bytes that aren't UTF-8 400), the made-up
  portal's mapping and the queues' options (retries, each try knowing if it's the last) are
  unit-tested (`tests/unit/connector.webhook.test.ts`, `tests/unit/connector.demo-portal.test.ts`,
  `tests/unit/connector.queues.test.ts`).
- `connector.pull.test.ts` (P5.4) — the reconcile pull, on the real database against the made-up
  portal: it catches what the webhooks missed (a near pull reads only the next 48 hours, a full one
  every session ahead and the staff; a connector's new session comes in hidden from casuals; a
  pull with nothing changed changes and logs nothing; a change no webhook sent is caught by the
  next pull); two pulls of one source at once, one runs and the other finds it busy; a source that
  doesn't answer has its error saved and its times kept, the tick backs off for 30 minutes and
  then queues one pull a minute, and the next good pull clears the error; a switched-off source,
  or a firm without one, pulls and queues nothing, and a planner key made live stops a pull. The
  cadence is unit-tested (`tests/unit/connector.cadence.test.ts`: first pull, every 15 minutes,
  nightly in the firm's zone and its summer time, 26 hours overdue, back-off), and the founder's
  alert names a connector's pull (`tests/unit/ops.alerts.test.ts`).
- `connector.bookings.test.ts` (P5.5) — who's booked on a connector's session, mirrored from the
  made-up portal on the real database: a booking made there is booked here through the rules as
  the office's placement (`booked_via` api, logged as the firm's with its source, no message to the
  casual), a refused one logged with its real reason and again only once something about that
  casual on the session happened since, one past the places refused as no place; two reads at once
  book a casual once; one the system stops listing is never cancelled (the office may cancel it
  here; a casual can't), and a record with no bookings touches none; one cancelled there is
  cancelled here (cancelled_firm, `cancel_via` api, who asked unknown, never a strike, a reason that
  isn't ours read as "other"), its notice from the system's own time when that's after the booking
  here and since the session's last read, else from the read (the latest of its cancellations; a
  time without its zone reads as none), with the evidence logged; a cancellation lands even when
  the session change beside it is refused (places lowered past the cancelled place); a read older
  than the session's last changes nothing, either way round; a session cancelled there is the
  whole-session cancel (its casuals told, its reason on each; with no reason, refused and nothing
  touched); a booking the system lists again is its again (the office can't cancel it) even while
  the session's change is refused; Gate B inside each step; a booking cancelled here while the
  system still lists it isn't booked again; while the planner is a connector, people can't book or
  cancel its sessions (`needs_approval`; a casual sees a hidden one as gone first), until it's
  switched off, and a session a planner key made isn't the connector's.
- `rules.any-of.test.ts` (P3.3, Rules 3) — "any of" licences, on the real database as the app role:
  the security pack's security officer needs one of an SIA security guard or door supervisor
  licence (other rules unchanged), and the database refuses a group of one, a type in both lists
  or a code that isn't one; booking one at a time and in the offer waves' batch takes either and
  refuses neither or an expired one; a session shows the group as its first type, a casual's own
  shift page the one she holds (never "missing" for a door supervisor licence holder), and a casual
  may send either; a casual's qualifications list the group's licence that stands best for her (not the
  one she doesn't need); and the office's check of bookings flags one only when no licence of the
  group will be in date. The engine's cases are in the doc's table (`tests/unit/rules.table.test.ts`:
  either, neither, the held one out of date, one suspended, applied within the allowance, a group
  beside an all-of list); the pack parity test reads "one of" in the doc's rules table; uploads and
  the expiry scan (`uploads.test.ts`, `credential.scan.test.ts`) take a group's types.
- `roster.names.test.ts` (P3.2) — a firm's name map. Unit (`tests/unit/roster.names.test.ts`): a
  name's key; a mapped role is its code, a skipped one skipped, the rest exactly as
  `normaliseRole()` reads them; a worker's list with skipped names left out; the rota sheet's rows
  through it (a skipped shift row isn't a problem, whatever else it says), and with no map every
  name as before. Integration (`tests/integration/roster.names.test.ts`, the real database): the
  owner's command maps, skips and removes names, each logged with what changed, and refuses what
  it can't use (an unknown qualification, a staff type other than casual, a rate on a skipped
  role); the app can read its firm's map but never write it or see another's; the sheet's sync and
  the file import bring mapped names in as codes, leave skipped ones out (the import counts them
  as ignored, a dry run too, and says so), and report the rest as bad roles; a credentials file's
  types go through it too; a name skipped after its session came in leaves the session as it is,
  reported `skipped_live`; another firm's map is never used, by the sync or the import.
- `ai.anthropic.test.ts` (built, 12X.3; P4.6 under load) — the Anthropic client on a fake `fetch`.
  Since P4.6: at most 4 calls at once, the rest in order; one still waiting after its 5 seconds
  turned away (`busy`) without calling the API; the breaker opening after 5 failed calls in a row,
  failing calls at once for 30 seconds, then one trial (a failure opens it again, an answer
  closes it), while a refusal or an empty answer never opens it; one client a process from
  `getAi`; no timers in the client. Each fails with its piece taken out.
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
- `logs-scan.test.ts`, `e2e.server-output.test.ts` and the e2e teardown (`tests/e2e/teardown.ts`,
  `tests/e2e/server-output.ts`) — the servers' output for the whole e2e run (Phase 10, audit L52,
  L53, L64, and two reviews, added the tokens, the errors and the wider numbers):
  - No phone number or email: numbers with spaces, tabs, dots or dashes (up to 3 between digits),
    +44 / 0044 / 0, in brackets, after a slash, in URLs (%2B, a form's +), before a full stop,
    glued to letters, `_` or `-`; emails (%40 too; glued emails each). Ids, ISO times, versions,
    decimals, IP addresses, Unix times, Twilio ids and already-masked values are left alone (a
    number glued to a word, like `row_3456789012`, counts: a false alarm is checked by hand). A
    firm's own shifts line is allowed, nothing else.
  - No planner API key (`shiftdesk_` plus 43 characters) and no `Bearer` credential anywhere
    (12J.1).
  - No login token (`/l#…`, %-encoded too) or session cookie outside the console transport's own
    prints (only a whole print is left out: its exact first line, then its end line), and none of
    the tokens the run sent anywhere outside them.
  - No server error except the error-screen tests' failures on purpose: pages, actions and routes
    (`onRequestError`), promises and errors nobody caught in the web app (now logged as JSON), and
    every worker job, ticks and alerts included (now logged as JSON). A connection closed
    mid-page is a warning, not an error.
  - A 200,000-character line is scanned in one pass.
  The report never shows a value.
- `log.masking-speed.test.ts`, `log.masking.test.ts`, `proxy.test.ts`, `log.console.test.ts` — the
  masker can't be used to stall the web app (audit M13).
  - Every string is cut to 2,000 characters, and request paths to 512, before masking. The cut
    walks back over the partial word and the whole run of digits and separators before it. A
    sweep with the cut at every position inside phone numbers (lists of them, %-encoded,
    bracketed, dotted), emails, login links and encoded text finds nothing left unmasked. A quoted
    value cut before its closing quote is still withheld.
  - Every masking pattern is linear: each of 31 attacks, 200,000 characters, is masked uncut in
    well under a second. The email and URL patterns before took 30 to 60 seconds, so they're now a
    single pass from each "@" and over each run.
  - A 16,000-character path costs the proxy under 50 ms on any host.
  - Login links glued to an address or word are still withheld.
- `next-config.logging.test.ts` — Next's own logging of server actions' arguments (a login token)
  and full request addresses stays off (audit L11). `gdpr.spec.ts` and `office.workers.spec.ts`:
  after a search, the page's address holds nothing that was typed (audit L54). `worker.firm-work.test.ts`: firm jobs
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
- `deploy.demo.test.ts` and `demo.reset.test.ts` — the demo server (16.2; ADR-025). The demo
  compose file read by Docker Compose itself, laid out as the server is (both files chosen by
  `COMPOSE_FILE` in the example `.env`, its database addresses filled in from its passwords):
  Postgres over its socket only, with no port and a password on the socket; only Caddy reachable;
  demo mode and every sender set for the web app and the worker, the password for the web app
  alone; each secret only where it's needed; the outbox written
  by the worker and only read by the web app; the one-off reset; the app's own settings accepting
  what each service gets, in production; no Postgres or demo without the demo file; `deploy.sh`'s
  own image line picking the app's image either way. `deploy/demo-reset.sh` run with a stand-in
  `docker` (refuses on a server that isn't a demo one before stopping anything; starts everything
  again after a failed reset). The reset for real, as production, on a database of its own: its
  refusals (before anything is dropped, a firm that isn't a demo firm included), the demo loaded
  afresh, tagged as the reset's own, and the outbox emptied; refusals for a database the reset
  didn't make and for a login that isn't the superuser; and the demo database refusing real numbers
  and emails (as the superuser and as the app writes them), by the same rule as the worker's check
  (case by case), the app unable to switch that off, and the rule surviving a deploy's migrations.
- `repo.made-up-data.test.ts` — golden rule 7: every email address in `src/`, `drizzle/`,
  `tests/`, `docs/` and the seed uses a reserved example domain (`.example`, `example.com`,
  `example.org`, `.test`, `.invalid`, `.localhost`), apart from a short reviewed allow-list of
  strings that only look like one (an entry no longer found fails); every postcode in the approved
  mock-up (`docs/mockups/office-v2.html`) is in the made-up `ZZ` area, and its role switch says
  "mock-up only". A person checks the mock-up for an employer's name, once.
- Phase 21 (the office's look; docs/ui-design.md "The office's system"):
  `ui.office-system.test.ts`: every office file, and every shared file and class string an
  office page renders (found by following the office's imports), uses only the system's spacing,
  corners, sizes, shadow and transitions, a shared part's casual value only beside its `office:`
  one; the office's tokens hold the brief's values and match the docs' table both ways; every
  button has its hover and pressed fills; the office's file button is a grey pill; Next's
  development button sits bottom-right; the skeletons (no `loading.tsx` in the office, the menu's
  pending state, a part for every dashboard section). `ui.contrast.test.ts` runs every pair in the
  office's light and dark. `office.dashboard.test.ts`: the dashboard's parts as drawn (the cards'
  jumps, "3 of 4 filled", "Not offered yet" in red, the week's dashed line and grey pill, the tinted
  panels, the one count pill and the urgent places' red one, Waiting on others couldn't load).
  `office.shell.test.ts`: the menu's 44px rows, their hover and pressed fills, grey labels and one
  count pill. Browser: `office.look.spec.ts` (every page in an admin's menu and two records, a
  casual's and a cancellation's, at 390px and 1440px, light and dark: the office's ground, the
  serif headline and Geist loaded, a card in the card's fill, every main button near-black,
  nothing sideways, with a casual whose 55-character qualification once ran a phone sideways);
  `office.shell.spec.ts` (the top bar's buttons and the drawer's rows 44px at 390px; every menu
  page shows its skeleton while held back; on a phone in dark, the drawer shuts as a page is
  picked and its skeleton shows);
  `office.dashboard.spec.ts` (a card jumps to its section; "Open the rota board").
- Phase 22 (the office's look, round 2; docs/ui-design.md "Phase 22"): `ui.office-system.test.ts`
  adds DM Sans, DM Mono and Newsreader self-hosted (Geist gone), the layers' depth tokens, no
  gradient in the office's styles (only the menu's fade, a mask), the `press` utility as written
  (97%, 90ms down, 300ms back on the spring, still under reduced motion, inside the utility so
  `office:press` carries it) on every office button and 44px link, the page's skeleton pulsing,
  and round 2's parts on the other pages (Needs attention's raised rows on grained washes, fields
  as grooves, every second step on `confirmStep` or `checkStep`, no Phase 21 flat panel left,
  the raised `resultBox`). `ui.flat.test.ts` pins every shadow, file by file, and the lit top
  edge on `soft`, `raise` and `float` in all three token blocks. `ui.contrast.test.ts` adds the sheet, the pill and the four
  colour cards' words in both themes. `office.dashboard.test.ts`: the cards' colours and jumps,
  the calendar tiles, the grooves and stripes, the tooltip's words and states, the "…" menu's
  growth. Browser: `office.look.spec.ts` now at 390px and 1280 × 640 (Dylan's laptop window),
  light and dark, on every page in an admin's menu and the pages opened from inside one (a
  casual, a cancellation, an enquiry, the offer page, a shift's and an event's page, the ways to
  add shifts), every hidden step shown: also every button raised, everything you press dipping
  (a button, an opener, a switch, a link that isn't words, words with a 44px target), every wash
  with an edge given depth, and no gradient drawn; `office.shell.spec.ts` (at 1280 × 640 with a mouse: an admin's menu rows
  34px with no scrollbar, the pill sliding to a pick before its page arrives, a card, a back link
  and a `btn.link` dipping and springing back, nothing moving with reduced motion, the guide in
  the account menu on every page for an admin, a resourcer and payroll, no round button on two
  lines, a 480px-tall window's menu scrolling with a fade at the edge that has more; the sheet's
  corners; the skeleton pulsing, at 1280px in light and at 390px in dark); `office.dashboard.spec.ts` (the "…" menu growing from its
  button's edge, "Offer"'s spinner while the offer page is held back, the landing ring, a week
  day's numbers under the pointer and on focus); `office.changes.spec.ts` (a cancel's
  confirmation outlives the refresh that moves the booking to Cancelled).
- Phase 23 (the office's look, round 3, and the dashboard's charts; docs/ui-design.md "Phase
  23"): `ui.office-system.test.ts` now pins Plus Jakarta Sans self-hosted (DM Sans, DM Mono and
  Newsreader gone), the cool greys, the corners (28px page and menu cards, 22px cards inside, 14px
  rows, round pills, 4px chart marks in `charts.tsx` only), the one overlay and nothing else with
  depth, no grain, stripes, glows or tinted cards, the system's mono only on Integrations' keys,
  round 3's parts in use (tabs, notices, code boxes) and every white box with its hairline.
  `ui.flat.test.ts` the overlay (`shadow-float: var(--overlay)`, darker in dark), the page a white
  card (22px, 28px from 1024px) and each file's floats. `ui.contrast.test.ts` the cool greys and
  every new pair in both themes (the sky and its near-black words, `line-strong`, the marks).
  `ui.parts-motion.test.ts` no lift under the pointer; `ui.theme.test.ts` the 40px numbers.
  `office.shell.test.ts`: the top bar's parts (Menu, the firm, the pay week, the shifts line, the
  square switch and its label that stays under the pointer, you), 44px rows on touch and 34px
  with a mouse, the pale blue pill, the drawer empty until opened. `pay.week.test.ts` the pay
  week's three parts and the week of the clock change. `office.events.test.ts` the board's today
  circle and grey weekends. `guides.test.ts` the guide's "Getting around" and dashboard topics.
  The charts: `office.dashboard-charts.test.ts` (unit) every builder (the places, events, offers,
  waited, cancellations and licences charts, their takes, legends, Numbers tables, panels,
  empty and unread states, "50+" and "Showing the first 50." when a list stopped, an age with
  none of its rows loaded, hidden places past the 50 rows, "Nothing is left to fill", a letter
  for each weekday on the cancellations chart, "Open the session" on every offer row, days
  across 25 Oct, pay only for roles that can open it); `office.dashboard-charts.test.ts`
  (integration) each loader against Postgres with another firm's rows (the clock change, the
  offers' states, the hidden places counted past the 50 rows, the events with hidden gaps counted
  past the 8 bars, "booked after it runs out" past Needs attention's 50 and a night session's last
  day, the enquiries named without their words or number); `office.dashboard.test.ts` the page as drawn (the count cards, the
  urgent places' cards, the six charts' marks and labels, each panel's rows and links, a part
  that couldn't load showing its notice in its own card and panel while the rest still shows,
  every old link still on the page); `office.dashboard-ui.test.ts` the tooltip's place (over or
  under a column or dot, beside a row of bars, flipping at the window's edges) and class (its
  bridge on the side facing its mark), the click passed on, the panel's in-page links, the
  licence names' side, and the office's scroll padding;
  `strikes.evidence.test.ts` the Needs attention card's panel. The seed: `seed.test.ts` this
  week's offers (waiting and said yes only, none over the daily cap or in the firm's quiet
  hours, each one the rules allow, nothing sent, a re-run after a demo change adding nothing);
  `offers.boundary.test.ts` the offer-count lock before the insert in every offer writer, the
  seed's included. Browser: `office.look.spec.ts` (every office page and the login
  pages at 390px and 1280 × 640, light and dark: Plus Jakarta loaded, the flat cards, the sky main
  button, nothing sideways); `office.shell.spec.ts` (the top bar, the menu card, the menu's fit at
  1280 × 640, the square switch's label hoverable and gone with Escape, a control the keyboard
  moves to under the top bar scrolled clear of it); `office.dashboard.spec.ts` (the count cards'
  panels, a side panel on a laptop and a sheet on a phone, Escape and focus back, a panel's link to
  a chart putting the focus on its heading, the tooltip on hover and focus, staying when the
  pointer moves onto it and gone with Escape, a row's figures beside it so the pointer and a click
  reach the row above, Numbers, the page never sideways, the licence names
  at 640px and 1024px, the cancellations chart opening at today, staying where it was swiped when
  only the window's height changes); `office.attendance.spec.ts`
  (Mark who worked from the Needs attention card's panel); `walkthrough.spec.ts` (steps 23 and 24
  through the charts and panels).
- Phase 24 (Liquid Glass, round 7; docs/ui-design.md "Phase 24"), task 24.1 the system:
  `ui.glass.test.ts` (in place of `ui.flat.test.ts`) pins the glass: `globals.css` draws
  `src/lib/tenancy/glass-grounds.ts`'s numbers (the wash's base and four lights, a section's, a
  float's, a tile's, a button's, the track's and the lens's fills, in light and both darks; the
  blur and the saturation), each glass utility as written, the refraction only under `.rf` (one
  `url(#lg-refract)`, its filter's fixed region, Chromium only, off with less transparency), the
  fallbacks (every see-through ground solid with less transparency or more contrast, in light and
  both darks, the wash gone; the same with no blur), the depth tokens as variables set in
  light and both darks, `box-shadow` only in the glass's parts and the file button, each file's
  depth tokens and floating glass, sections as glass, the main buttons tinted, the lens on the
  chosen tab, no white box left, no page card, no `press` beside `press-glass`, no office sky.
  `ui.contrast.test.ts` works every pair out over the glass itself (`tests/helpers/theme-css.ts`:
  each ground composited over every point of the wash, the backdrop saturated as Chromium does
  it, a clear button also hovered and pressed with its words brightened, the main button
  brightened) in six looks: light and dark, solid, and with no blur. `tenancy.brand.test.ts` checks
  every firm colour of the cube against the same grounds, read from the stylesheet, the main
  button's shade and brightening too; the demo firms' new values. `ui.theme.test.ts` Geist (its
  two subsets matching the package's ranges; the old faces gone), the two type scales, colour
  values only in tokens and the glass's variables. `ui.design-system.test.ts` the doc's table with
  glass values, the glass file button; `ui.office-system.test.ts` the office with no colours of its
  own, `press-glass` as written, the counts, gradients only in the glass, the wash and the masks,
  no white boxes. The markup tests (`office.shell`, `office.dashboard`, `office.events`,
  `portal.*`) pin each part's glass. Browser: `office.look.spec.ts` (every office page and the
  login pages at 390px and 1280 × 640, light and dark: the wash, no page card, Geist loaded, each
  section frosted in its fill, what floats frosted more, the main button tinted in the firm's
  colour, every clear button rimmed, depth only on the glass, no white box, no image but the
  glass's gradients, nothing sideways); `office.shell.spec.ts` (the floating bar and drawer, the
  menu card's glass, no page card, a glass button swelling to 104%); `brand.spec.ts`,
  `theme.spec.ts`, `casual.app.spec.ts` and `strikes.worker.spec.ts` the new values.
- Phase 24, task 24.2 the office shell (docs/ui-design.md "Office shell"): `office.shell.test.ts`
  pins the rail (its rows from each role's menu, Pay, People and Admin and records as folds,
  payroll's pages as icons; shut and open; the dots where a page needs you and the words beside
  each icon; the lens on the page you're on, on a shut fold holding it; the sd-rail cookie), the
  three capsules (the counts per role with their pages, Offers out on the dashboard's offers chart;
  the search's label, waiting for the page, no panel until it's open, no status role; you), the
  bar below 1024px, no pay week or shifts line, the drawer; `office.search.test.ts` what's typed
  and each thing found as words and a link. `tests/integration/office.shell.test.ts` on the real
  database: the counts (places to fill, urgent places, offers out with no reply) against a firm
  with every kind of session and offer, adding up with Events & sessions and each offer's own
  state; the search (casuals by name or mobile, never a deleted one; shifts by role, event, site
  or post; sites by name or town; 5 of each) with another firm's same-named rows never found; who
  may use each (not payroll, not a disabled user, not another firm's); Events & sessions at one
  site. `guides.test.ts` the guide's "Getting around" per role; `ui.office-system.test.ts` the
  24px corners now the rail's; `office.dashboard-ui.test.ts` the bar's 68px under the 80px scroll
  padding. Browser: `office.shell.spec.ts` (the bar on a phone; at 1280 the rail, the three
  capsules' glass and places, the account menu under you, the frosted edge once the page
  scrolls; the rail shut fitting the window, opened and kept after a reload, a fold opening it,
  its dots matching its amber counts; a shut icon's name on hover and focus and Escape; the lens
  at once on a pick; the counts opening their pages and agreeing with them; the search finding a
  casual, a shift and a site from ⌘K or Ctrl K, the keyboard through it, another firm's casual
  never found, a click outside shutting it; in a short window the rail scrolling with no bar;
  every page's skeleton from the rail), `office.look.spec.ts` (the rail and the capsules on every
  page from 1024px), the pay week on both dashboards and the shifts line on Settings.

- Phase 24, task 24.3 the dashboard (docs/screens.md "The dashboard, round 7"):
  `tests/integration/office.board.test.ts` on the real database: the two columns (every session to
  come with a place free, soonest first, Offered while an offer waits for a reply, To offer
  otherwise: never offered, or every offer answered, a failed one never an offer), each session's
  facts and offers (who hasn't replied, oldest first, and since when), hidden by its own switch or
  its event's, a column's first 50 with totals over all; the track's filters and counts, each
  count its columns' sessions, adding up with the top bar's To fill, Urgent and Offers out; the
  offer state's SQL rule and its TypeScript twin agreeing for every answer and session state, and
  the board counting the one waiting; the places chart's 14 days from this pay week's Monday,
  split by an offer waiting, its places the two weeks' columns'; the clock change (a session at
  23:30 on Sun 25 Oct 2026 this week's, one at 00:30 next week's; the 15-hour night; takes inside
  and outside it by the firm's clock); While you were out (takes from offers between 18:00 and
  08:00, still booked, latest first, with the channel; which night before 08:00 and after
  18:00, and in summer time); Who worked? Needs attention's own items; when the planner or sheet
  last sent changes (a live key's latest API change, else the sheet's sync, a revoked key not
  counting); the detail card's session (asked for, another filter's, the default, none); who may
  see it; another firm's rows in no part. `office.board.test.ts` (unit) the words (the head's
  line, the track's links, the chart's top, tips and sentence, when, where, how soon across the
  clock change, replies, the banner's cases, the cards' names, the columns' lines and empty
  words, a take's words and channels, since when, the to-mark link's name) and the page from
  made-up data (one heading, the track's links and the current one, the chart's bars, axis, today
  and table, the detail card with "…" and a planner's session's, the four columns with their
  counts and first three, a card's links and chips, last night's and Who worked?'s links, empty
  columns, a column cut at 50, a part that couldn't load, no link repeating a menu link's name),
  and the offer panel listing the same people, lines and answers as the offer page from one
  OfferPage. `office.dashboard-ui.test.ts` the chart's tips (hoverable, a bridge, Escape);
  `office.needs-attention.test.ts` Needs attention's words and page (kept from the old dashboard
  tests); `ui.office-system.test.ts` the skeleton's parts, the `mark` corners in the places chart
  only, the offer panel's 24px corners; `guides.test.ts` the guide's dashboard part. Phase 23's
  chart, count card and urgent card tests went with them. Browser: `office.dashboard.spec.ts`
  (the head, the track adding up, the chart's 14 days and table, the detail card, four columns,
  nothing to approve, nothing sideways; Urgent filtering and a card picked into the detail card,
  kept on reload; the offer panel from the foot on a phone listing the offer page's people,
  Send offer then Offered, Escape and focus back, the session then waiting on Offered; the "…"'s
  Not urgent and Mark as filled with Open it again; Show N more and focus; a take last night and
  Who worked?'s links; at 1280 the chart beside the card, the columns in a row, a bar's tip
  hovered and put away with Escape, the panel from the right closed by the scrim; every page
  Phase 23's dashboard linked to still a click away: the offer page and a session's page from the
  detail card, the shifts list and its weeks, the top bar's four counts, Events & sessions'
  Showing filter and an event's page, Cancellations' and Enquiries' "Show only today's" and a
  record and a message, Casuals' uploads and a casual, the Notice report's offers; payroll sent
  away), `office.cancellations.spec.ts` (today's list and its CSV reached by "Show only today's"),
  `office.events.spec.ts` (the Showing filter clicked), `login.office.spec.ts` (the head's day and
  pay week; the shifts line on Settings, no longer on the dashboard), `office.offer.test.ts` (the
  offer page never another firm's shift or office user, as the panel reads it),
  `office.shell.spec.ts` (Urgent's places and Offers out's offers agreeing with the
  board; the cards' press), `office.attendance.spec.ts` (Who worked?'s card), the walkthrough
  (steps 23 and 24 on the board and the panel).
- Phase 24, task 24.4 Events & sessions, Enquiries and Casuals (docs/screens.md "Events &
  sessions, Enquiries and Casuals, round 7"): `office.events.test.ts` (unit) an event card from
  made-up data (its heading and line, the switch on the card described by its answer, the tags
  and the summary; a session to fill as a tile with its role link, time, Urgent, chips, post, a
  75% meter, pay and its uniquely named "…"; the full ones folded under "2 filled sessions", marked
  filled counting; View sessions named for the event and "+ 3 more sessions"; an automatic event's
  place over its day, the day in each time over more than one; a bare draft), with the session row
  and switch label tests kept; `ui.redesign-copy.test.ts` the cards' words (the filters, "Need
  people" only while chosen; the line; the heading and line; the time on London's clock across the
  clock change; the meter's places; post else meeting point; the folds' words);
  `office.events.test.ts` (integration) a card's first 30 sessions and its count of the rest, the
  event's page holding all 32, and the cards' £/hour with no pay record's figures;
  `office.enquiry-forms.test.ts` the reply box (labelled, described by how it goes, "Close, no
  reply needed" then "Send reply", the reason asked only once chosen, an h3 beside the list);
  `office.enquiry-row.test.ts` a row (its link to the message's page covering the row, the chosen
  outline only from 1024px and never "current" as the server sends it, the pay line, a voicemail
  with no words, the link given only its addresses and the name it shows);
  `enquiries.test.ts` (integration) the message chosen beside the list by its id, still shown once
  it leaves Need a person, never for a made-up id, another firm's office or payroll;
  `office.casuals-copy.test.ts` and `office.casual-cells.test.ts` each
  qualification's short name and date, "(booked shift)", Needs updating, the staff photo's state
  and date; `ui.contrast.test.ts` the green switch's knob and track at 3:1 in both themes;
  `ui.glass.test.ts` the board's pins gone, the search's floating panel pinned, no solid card fill
  anywhere; `ui.office-system.test.ts` no white fill at all. Browser: `office.events.spec.ts` (no dates to page through, All shifts by day; the
  four filters with counts; at 1280 the filters and their line on one row and the cards side by
  side; the card's switch hiding the event from a casual's Open shifts and back on from its page),
  `office.enquiries.spec.ts` (closing asks why, Keep it open going back with focus; at 1280 the
  list beside the pane, a row picked in place into the address, kept on reload; a message closed
  in the pane staying there with its confirmation while a newer one tops the list; an address
  naming no message showing the list's first),
  `casual.app.spec.ts` (Casuals' words, the counts in discs, the search on the filters' row),
  `office.workers.spec.ts` and the walkthrough (the search's matches), `office.dashboard.spec.ts`
  (an event's page from its card, a message beside the list), `office.look.spec.ts`,
  `office.shell.spec.ts` (the top bar's To fill in the events line) and `uploads.spec.ts` (the
  staff photo's state, then its date).
- Phase 24, task 24.5 Every other office page (docs/screens.md "Every other office page, round
  7"): `office.shell.test.ts` the page header's layout (the headline's box and the actions beside
  it, level with its foot, only on `office:` values, so the casual app's is as it was) and its
  way back, nothing above the heading but the header's layout boxes (`guides.test.ts` the same
  for the workers' help page); `ui.office-system.test.ts` Needs attention's parts and Also needs
  you as glass sections with an amber or a red leaf before the heading and no tint or edge (in
  place of 24.1's pin on Also needs you's red wash); `office.events.test.ts` an event's session a
  clear glass tile with no edge though urgent, its requirements on clear glass chips;
  `guides.test.ts` the how-to guide's Enquiries and Pay queries steps in their new words (the
  message beside the list or on its own page, the line under the box, "Close, no reply needed"
  before "Why close it?", the note beside the group). Browser: `office.look.spec.ts` on every page
  in the rail, the records opened from them and the how-to guide (in the account menu), at 390px
  and 1280px, light and dark: no section tinted with a status (a leaf, chip, notice or step
  instead); a header's actions on the headline's row, beside it and level with its foot from
  1024px, under it on a phone (seen on more than four pages at each width); no heading under the
  tabs repeating the chosen tab (seen on more than three pages at each width); the other office
  specs for each page's words and actions.
- Phase 24, task 24.6 the casual app (docs/screens.md "The casual app, round 7"):
  `ui.casual-app.test.ts` the scroll rule (`chromeAfterScroll`: open at the top and within 24px of
  it, shrunk scrolling down, open scrolling up, a 6px wobble changing nothing), only ChromeWatch
  marking `<html>` (`data-js`, `data-scrolled`, `data-tabs-mini`) and never under the office's
  shell, the firm's bar sticky only under `data-js` with its frost only under `data-scrolled`, the
  tab bar a server component of plain links whose every shrinking rule hangs off
  `html[data-tabs-mini]` (so it's whole without JavaScript), no tab bar on a shift's page; the
  pay total rule (`payWeeks`: grouped by period, lowest rate first, the total the sum of payroll's
  grosses only when every line has one, a zero gross counted, pay days once each) and Pay's
  newest week and earlier weeks with a total and without; "You're booked." covering the screen as
  `glass-float`, put in `<body>`; a shift's page in its other states under its own bar; Home's
  kept copy (what's hidden offline, what's shown). `portal.home.test.ts`, `portal.my-shifts.test.ts`,
  `portal.open-shifts.test.ts`, `portal.shift-detail.test.ts`, `portal.urgent.test.ts`,
  `portal.pay.test.ts`, `travel.area.test.ts` and `ui.redesign-copy.test.ts`: each screen's
  states in round 7's markup and words (Home's three sections of rows, the glass pass, the strip,
  "Site and role", the cards, a shift's cards, the tab bar's lens and mini values), in place of
  Phase 20's pins on the tiles, the solid pass and the tab bar's pill. `ui.contrast.test.ts` the
  pass's warm band, a booked day, red words on a glass chip and the firm's colour on the lens in
  every look; `ui.glass.test.ts` and `ui.office-system.test.ts` the band and the foot's frost
  among the glass's own gradients and blurs, `shadow-pass` gone. Seed: `seed.story.test.ts` Zoe's
  and Ben's pay lines (complete weeks, paid the Friday after; Ben's newest with one line payroll
  gave no gross for), `seed.test.ts`'s Saturday pay check leaving those two out. Browser:
  `casual.glass.spec.ts` with JavaScript (the bar sticky and frosting once scrolled, the tab bar
  68px, 54px scrolling down with its words for screen readers only, open again scrolling up and on
  a tap), without (the bar in the page, the tab bar whole, plain links, the pass's Details and
  "Site and role" opening and filtering), and Pay (Zoe's £324.00 over her two rates and four
  earlier weeks; Ben's week with no total); `flow.worker.spec.ts` "You're booked." filling the
  screen; `casual.app.spec.ts`, `offline.worker.spec.ts`, `urgent.worker.spec.ts`,
  `travel.filter.spec.ts` and the walkthrough the new sections, rows and words;
  `offline.worker.spec.ts` the tab bar in the kept copy (its four plain links, Home current). The
  browser tests' global setup (`tests/e2e/warmup.ts`) asks the dev server for the pages the tests
  open first, office and casual, before any test starts: `next dev` builds a page on its first
  request, and the office's dashboard could take longer than the first office test's 5-second
  wait after logging in.
## Fixtures and the demo seed

`npm run db:seed` creates two fake firms:

**Acme Events (security/events, native mode):** a fake shifts line (+44 7700 900000, Ofcom's drama
range; Northline has none), 60 workers (5 with expired SIA, 3 "applied"),
3 sites (stadium, racecourse, shopping centre) and the story's 4, a Saturday event with 40 shifts, one 6am
cancellation that becomes urgent, two open requests, pay records for 8 weeks, yesterday's event
(5 bookings not marked yet), 10 pay queries (7 about one rate change), and the mock-up's story
(below: 8 more casuals, six events, cancellations and strikes, enquiries, sorted pay groups).

**Northline Rail Labour (rail):** 30 workers with PTS/Sentinel/D&A dates, tomorrow night's
possession with one short-notice firm cancellation. (Its mocked rota sheet is still to come: no
Google account.)

**What exists when.** `npm run db:seed` (also run by `npm run db:reset`) grows with each phase.
Phase 1 loads both firms, their sites, office users (admin, resourcer, payroll), workers and
credentials (Phase 2 adds each firm's credential pack: security for Acme, rail for Northline): Acme's 60 workers (5 expired SIA, 3 applied) and Northline's 30 with PTS, Sentinel
and drugs and alcohol dates. Phase 3 adds Acme's Saturday event day
(`src/lib/db/admin/seed-saturday.ts`), described below. Phase 10 task 20 adds the walkthrough's
other states (`src/lib/db/admin/seed-extras.ts`), described below. Still to come: Northline's
mocked sheet (Phase 2). Numbers are in Ofcom's drama range (+447700900000-999), emails are
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
- This week's offers (Phase 23, for the dashboard's offers chart; `weekOffers` in
  `src/lib/db/admin/seed-data.ts`), each sent by Acme's resourcer by text between Monday midnight
  (London) and when the seed runs, and logged as sent: 10 waiting for a reply on Saturday's open
  places (never the urgent dropout), and "said yes" for up to 12 of Saturday's bookings made this
  week (each sent 20 minutes before it was booked, or earlier when that falls in Acme's quiet
  hours, and left out when that would be before Monday; a seed run before about 07:20 on Thursday
  has none yet, and one on Monday before 07:00 has no offers at all). None is sent in Acme's quiet
  hours, as the app holds offers then. Only the run that adds the Saturday writes its offers, so a
  re-run never adds one, even after a demo cancels a booking. Like the seed's bookings, their `offer.sent` entries in the action log are
  dated when the seed ran (the log can't be backdated), not when each offer says it was sent. None
  said no: the app can't record a "no" yet. Never to the five workers kept free for demo logins
  or to anyone the walkthrough logs in as; each to a casual the booking rules allow, none over
  the daily offer cap (3 a day), and nothing is sent. The seed takes the offer-count lock as every
  offer writer does (`offers.boundary.test.ts`); `seed.test.ts` checks the cap and the rules on
  what it wrote.
- Every Acme worker has 1 to 8 weekly pay lines from the last 8 complete weeks (stewards £13.00
  an hour, door supervisors £14.50, security officers £13.50).
- The action log has each shift's creation, each booking, the cancellation (with notice hours) and
  the requests. Those entries are dated when the seed ran (the log can't be backdated); the
  shifts are dated a week earlier, before every booking.
- Re-running `npm run db:seed` the same week adds nothing and never undoes a demo's changes. Run
  in a later week, it adds that week's Saturday too; run on a Saturday, it adds next Saturday
  while today's is still there. Use `npm run db:reset` for exactly one Saturday.

**The walkthrough's other states (Phase 10 task 20, `seed-extras.ts`).** Each on workers no browser
test uses, and the pay queries of kinds no browser test raises (a test's own "paid late" group is
never split or joined), so they can't change what those tests check:
- Acme's last event: yesterday (always among the dashboard's "Who worked?", which looks back 7 days), 3
  stewards at the racecourse (07700 900110, 900117, 900118) and 2 security officers at the
  shopping centre (900150, 900151), all booked and none marked yet ("Past 30 days" on their My
  shifts too).
- Acme's 10 open pay queries: 7 stewards (900110, 900117 to 900121, 900124) about the last
  complete week's rate (paid £13.00), 2 hours missing at the shopping centre on the last event
  (900150, 900151), 1 "something else" (900152). Each with the app's own grouping key, and logged.
- A re-run on a later day adds that day's (a new last event, pay queries, Northline night); a
  seeded booking that would overlap one the worker holds is left out, and so is its query.
- Northline's night: 3 track operatives (07700 900300 to 900302) booked tomorrow 23:00 to 07:00 at
  the junction; the office cancelled 900302's booking when the seed ran ("Weather or safety"), so
  under Northline's 48-hour threshold: the notice report's short-notice firm cancellation (audit
  L25).

**The mock-up's story (Phase 12 task 12I.1, `seed-story.ts`, loaded by `seed-story-load.ts`).**
Acme as `docs/office-v2.md` §9 tells it, with dates from the day the seed runs:
- Acme's strikes team `strikes@acme-events.example`, already confirmed.
- Six events, each session with its pay, post, meeting point and uniform: Northern Lights Live at
  the Arena tomorrow (door supervisor urgent 3/4, steward, response team lead needing first aid),
  Night patrols at Northgate Demo Town Centre the day after (CSAS officer, urgent 3/4), Riverside
  Food Festival, Raceday, Northgate Charity 10K, and Hillside Christmas Market, switched off.
- Eight casuals (07700 900400 to 900407): Zoe Adeyemi (SIA, CSAS, manual handling expiring in 22
  days, photo due soon), Kieran Doyle (SIA expired, 2 strikes), Ben Fraser (new photo waiting),
  Priya Shah (1 strike, flagged for review), Leah Ward (SIA expiring in 12 days, her new one
  waiting, no photo), Jamal Morgan, Mo Rahman (a strike the office withdrew) and Tom Hale (the
  office cancelled one of his bookings). Four hold CSAS. Each has a travel area, with fixed travel
  times to every story session (Zoe to the Arena: 3.1 miles, 12 min by car, 24 min by public
  transport).
- Every open place needs something only these eight hold (their own roles, or a manual handling
  certificate as an extra), so the generated workers' lists, and the walkthrough, are unchanged.
  (Three generated workers whose names matched the story's were renamed: 07700 900105, 900137
  and 900152.)
- The shifts line: Zoe's "Hi, any shifts for me?", Ben's pay question and Kieran's cancel, stored
  as the webhook stores them, a few minutes before the seed ran, and answered by the seed with the
  shifts line's own reply job (no AI, nothing sent; allowed by Dylan in the AI boundary test).
- Pay: two groups payroll has sorted, each with its note (the 10 open queries as before).
- Added once, by fixed ids: a re-run changes nothing; `npm run db:reset` moves the story to today.

**Demo logins (Acme, `http://acme.localhost:3000/login`):**

| Mobile | Who | Good for |
|---|---|---|
| 07700 900100 to 900104 | Stewards, never booked by the seed | Log in, see the 4 open steward shifts, take one, cancel it |
| 07700 900105 | Steward, booked at the arena, asked for a time change | My shifts with a booking, My requests |
| 07700 900125 to 900129 | Door supervisors (and stewards) whose SIA licence has expired | Profile's red licence. Open the urgent dropout's link (the seed prints it): the page says why they can't take it, with "Ask the office to review" |
| 07700 900130 to 900136 | Door supervisors, booked at the arena | A booked shift with instructions |
| 07700 900137 | The door supervisor who dropped out | Nothing booked; the dropout's page shows it's open again |
| 07700 900138 to 900144 | Door supervisors with a valid licence, never booked | Home's "Urgent: needed now, and you can take them" lists the dropout; the urgent board (`/urgent`) shows the dropout with "Take shift" |
| 07700 900400 | Zoe Adeyemi (the story) | Home as the mock-up: Needs updating (photo due soon), the Arena and Northgate urgent cards with their travel lines, her next shift (Riverside Food Festival), three to apply for and "2 more shifts are further than you travel" |
| 07700 900401 | Kieran Doyle | Profile: SIA expired, 2 strikes |
| 07700 900404 | Leah Ward | Needs updating: SIA expiring, new one being checked; no photo |

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
`acme.resourcer@example.com` (the link appears in the terminal). The dashboard (12E.1; Today
until then) shows the urgent dropout under "Urgent shifts not filled" (with how many casuals it
was offered to once the worker process has sent offers), Saturday's event under "Showing to
casuals", and the dropout among the latest cancellations with its notice; the two requests are on
Enquiries, "Requests from the app". "Offer to someone" on the urgent shift (or "Offer a place" in a
session's "…" menu on Events & sessions) lists who could take it. "Urgent wave fills it" runs by itself with `npm run dev` (offer
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
      At the target (P4.9, the same file): 1,000 casuals' messages in one burst, each answered
      once within 90 seconds of the last with a 300 ms send (about 41 to 51 seconds here), or each
      made the office's question within 30 with automatic replies off (about 2). With them, an
      offer wave for one place among 2,000 casuals offers 5 (`offers.scale.test.ts`, P4.3) and
      2,000 reminders due at once each go once (`shift.reminders.test.ts`, P4.5).
      On this laptop: run it once against the server too (PLAN.md "Pre-pilot checks on the
      server").
- [ ] After loading a big firm's casuals (its first import): `ANALYZE` as the owner, or wait a
      minute (docs/runbooks.md "Importing workers, credentials or shifts from a spreadsheet"),
      before the first offer wave.
- [x] Log masking verified (no phone numbers in logs). Every e2e run keeps the worker's and web
      app's whole output (`.dev/e2e-worker.log`, `.dev/e2e-web.log`) and `tests/e2e/teardown.ts`
      fails the run on any phone number, email or login token it finds there, or any server error
      the tests didn't expect (`scripts/logs-scan.ts`: its own patterns, not the masker's, after
      undoing URL and form escapes; a firm's own shifts line allowed). It found a mobile typed into the office's worker search printed in the web server's
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
