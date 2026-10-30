# Parking lot

Moved from `PLAN.md` word for word on 2026-10-29 (P1.2), where its heading now points here. Line
numbers that older docs give for it are `PLAN.md`'s as it was then, and where the text below says
"this file" or "below", it meant `PLAN.md` (the Parking lot is now `docs/plan/parking-lot.md`).

## Parking lot

(Ideas that came up mid-build. Not in scope until a phase includes them.)

- The connector (P5's phase audit, 2026-10-29), before a real one: `CONNECTOR_TRANSPORT` takes
  only `none` and `fake` today, so no test can reach a real source; the real transport adds its
  refusal under `NODE_ENV=test` and a pin in `tests/setup/env.ts`, `playwright.config.ts` and
  `scripts/invariants.sh`, as every real sender has.
- The connector (P5.3's review), before a real one: a session or staff record gone from the
  firm's system is only `ignored gone` on its event (nothing on Needs attention, the session stays
  with its bookings: with the sync card, after the UI chat); `connector_events` are kept for ever
  (purge them with the retention job, at the firm's `retention.message_days` or their own). (A
  retry after a crash logging a refusal twice: fixed in P5.4's review, a connector's refusal that
  says what its last one said isn't logged again.)
- The connector's bookings (P5.5's review), before a real connector:
  - **For Dylan, the casual's words:** a casual's Cancel (after the strike warning) or Take on a
    connector's session the office has shown ends in a plain "error" (`needs_approval`,
    `src/lib/portal/cancel-shift.ts`, `take-shift.ts`); offers still go out on a shown one and
    reminders for its bookings unless `firm_system_sends` is on. Words like "Your firm books this
    shift in its own system: ask the office" (docs/screens.md first), or keep these sessions
    hidden until the confirming path lands.
  - A booking the system stops listing is kept and nothing is logged (the sheet's
    `roster.sheet_conflict` has office words; a connector's needs its own, with the sync card), and
    a staff ref nobody here has is skipped unlogged: both for Needs attention after the UI chat.
  - The office can cancel a booking the system no longer lists (P5.5's review: else it stays for
    ever); confirm that's the right way out.
  - A cancellation from the system tells the casual nothing and starts no offers (as a name taken
    off the rota sheet): the firm's system made it, and fills the gap there.
- The staffing inbox (P7's review), before it's live: the purge's and the erasure's log entries
  count messages only (`retention.purged`, `worker.erased`), not the emails they take too (the
  owner-run functions return one count, and the office's words for the log would need an emails
  count: with P7.4's words); the privacy notice's line for the inbox (that the firm's staffing
  emails are kept 90 days, a casual's words only) is Dylan's, before any firm's inbox goes live;
  and a casual's words are taken as theirs on the provider's DMARC word, so the provider chosen
  (its ADR) must give one. And an email stored first without that word stays so when the same
  Message-ID comes again with it (one row per Message-ID; P7's second review): with the provider,
  decide whether a later copy it vouches for may fill in the words.
- The connector's pull (P5.4's second review), before a real one: a pull that runs out of time
  (8 minutes) keeps no progress, so a source too big to read in 8 minutes never finishes a full
  pull, and once 26 hours pass every pull is full and the next 48 hours stop being caught up too
  (the founder's alert fires). Read the next 48 hours first, or keep a cursor. And a webhook event
  made and applied between the pull's look for it and its own apply of that record is overwritten
  by the pull's older read for staff records (sessions keep their read time: P5.5's review); it
  mends at the next pull.
- The connector (P5.4's review), for Dylan: a connector's new sessions come in hidden from casuals
  (the trial cycle, ADR-026) and nothing ends the trial yet: the office shows them with the Events
  page's switches (`src/lib/office/showing.ts`), an event or a session at a time. Decide when a
  connector's sessions show by themselves (after a week with no conflicts? on the office's word for
  the whole source?).
  And a pull that fails is on the source only (`last_error_code`, the founder's alert after 30
  minutes): the office sees nothing until the sync card. Logging it as an event needs office words
  for the log (`src/lib/office/event-words.ts`), so it waits for that card too.
- From Phase 24 (the close, 2026-10-29): the office's Casuals page is heavy to send. With the dev
  seed's 68 casuals, All is 536 KB on a production build (about 8 KB a row; Uploads to check is
  53 KB), so about 1.6 MB at its 200-row cap. It's quick to make (0.15 to 0.18 seconds here), so
  this only shows on a slow connection. Trim each row's markup or page the list, if a pilot's
  office finds it slow.

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
- Strikes (12C.1): no per-firm switch to turn strikes off; every firm on ShiftDesk records them. The switch came back (P3.4, `strikes.enabled`, "Connecting the firm's systems" 6); the casual's strike sentences read it after the UI chat's Phase 24.
- An owner command to change a firm's credential rule, logged (P3.3's review): a firm set up before P3.3 keeps `security_officer: SIA_SG` with no one-of group, and only a hand edit in the database could change it today.
- Login (auth: Dylan's to approve): two of one worker's login links used within milliseconds can,
  rarely, refuse the second as "used" (`tests/integration/auth.magic-link.test.ts`, "two of one
  worker's links used at the same moment both work", failed once in a full verify run on
  2026-10-29, nothing it covers having changed). The mechanism: when the test's lock-holder
  commits, the first login wakes, spends its link, and retires the worker's other unused links
  with `FOR UPDATE SKIP LOCKED` (`retireOtherLinks()`, `src/lib/auth/magic-links.ts`); the second
  login's row then looks unlocked (the holder's lock is committed, and the second hasn't locked
  it again yet), so it's retired, and the second login finds it used. A fix: retire only the
  links issued before the one being spent (two at once then never retire each other's), which
  changes what "logging in retires the worker's other links" means for a newer link.

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
- **A one-of group's extra row when a session asks for one of it outright** (Phase 25.2, found by
  the guardrails review, 2026-10-30): a security officer session that also requires SIA_DS shows
  the group's stand-in row ("SIA security guard licence: Missing") beside SIA_DS, and gives both
  reasons, though holding SIA_DS alone would pass. Pass and fail are right; only a redundant row
  and reason. Drop the stand-in (`src/lib/portal/shift-facts.ts`) and the group's own failure
  (`src/lib/rules/eligibility.ts`) when a type of the group is required outright: a rules change,
  so with tests and the doc's table.
- **Who asked, on a cancellation's own record and the Cancellations file** (Phase 25.2, 2026-10-30):
  the notice report's page and CSV say who asked for each cancellation (approved); a cancellation's
  record (`/office/cancellations/[id]`) and the Cancellations page's CSV don't yet. Words to match
  the report's ("Asked by: The client"), a mock-up first.
- **A skipped name's session, from Needs attention** (Phase 25.2, 2026-10-30): the item links to the
  session, where the office cancels or changes it. A "Cancel this session" right on the item would
  save a click; it needs the cancel form's "Why?" and "Who asked for it?" there too.
