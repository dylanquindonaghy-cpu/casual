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
  were 19% slower with AI tools while believing they were 20% faster. Log real hours in the Hours
  log (`docs/plan/hours-log.md`) with `/log-hours`.

## Timeline

| Weeks | Build | Sell |
|---|---|---|
| 1 | Phase 0: repo, tooling, guardrails | 20 minutes with a contractor contact on how a big contractor manages agency labour. Build a list of 30 target firms. |
| 2–3 | Phase 1: tenancy, data model, login | 10 discovery calls. **Gate A** at end of week 3. |
| 4–6 | Phase 2: roster core, rules, Sheets plug | Follow-ups. Rail/civils warm-lead conversation. |
| 6–8 | Phase 3: staff portal → **clickable demo** | Demo to warm leads. **Gate B.** |
| 8–10 | Phase 4: urgent board, notifications, offer waves | Sign pilot agreement + DPA. Collect baseline numbers. |
| 10–11 | Phase 5: resourcer dashboard, action log, notice report | |
| 12 | Phase 6: payroll queries + digest | |
| 13–14 | Phase 7: WhatsApp shifts line + call-to-text | Meta business verification (can take days). |
| 15–17 | Phase 8: branding, custom domains, deploy (a UK/EU Docker host), GDPR export/delete | Pilot onboarding prep. |
| 18 | Phase 9: pilot hardening, baseline week, go live | Pilot starts. **Gate C** 4 weeks later. |

## Gates

- [ ] **Gate A (end of week 3): demand.** 10 discovery calls done. At least 2 firms say they'd pay
  £299 for a pilot. If zero: stop adding features, revisit the problem with what you heard.
- [ ] **Gate B (after the Phase 3 demo): commitment.** One firm agrees a paid pilot with a written
  agreement (you own the software; they license it; DPA signed). No real data before this.
- [ ] **Gate C (pilot week 4): value.** Unanswered rate near 0%, measurable resourcer time saved,
  50%+ of active workers used it. Then convert to the paid plan and ask for a referral.

---

## Still open from earlier phases

The finished phases (every box ticked) are in `docs/archive/plan-done.md`, moved there word for word
on 2026-10-29 (P1.1) and frozen. These earlier phases still have open items; those with a "Done
when" line (Phases 15 and 22) keep it here. What's blocked, and on whom: `docs/plan/blocked.md`.

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
- [ ] Server: a UK or EU Docker host + managed Postgres 16, static IP, ports 80/443 only (AWS
      ruled out on 2026-10-06: ADR-021)
- [ ] Docker Compose (web, worker, caddy); GitHub Actions deploy
- [ ] Backups on, restore tested; £50 billing alert; uptime check; error alerts to you
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

## Phase 15 — Texts through our own system (go-ahead for the sender only: Dylan, 2026-10-29, "build it now, switched off")

**Go-ahead, 2026-10-29** (Dylan: "build it now, switched off"): the second task, the Webex Interact
sender, is built now and stays off (no firm's key is set, and it is refused in tests); it reads the
firm's key from P5's secret store, so it comes after P5's framework. The first task changes screens
(after the UI chat's Phase 24, mock-ups first) and the third waits for the firm to turn replies on.

Proposed 2026-10-19 after Dylan's decision ("we wont need whatsapp or twillio notifications will
come through our own text system and app"; see "Decided on 2026-10-19" in
`docs/plan/decisions-waiting.md`). Not started then (the sender, 15.2, has been built since): it
waited for Dylan's go-ahead and the text system's details (how a text is sent, whether
incoming texts can be passed on, delivery reports, the sending number or name). It replaces
Phases 4 and 7's unticked WhatsApp, Twilio and call items, "Connect Twilio" and "Submit the
WhatsApp templates".
Docs: `docs/messaging-templates.md`, `docs/architecture.md`, `docs/screens.md`.

- [ ] Texts only: every casual reached by text (the `notify_channel` default and the rows already
      there), no WhatsApp choice on Profile; the login link, the pay code and the reply to an
      unknown number by text (`src/lib/auth/send-portal-link.ts`, `src/lib/auth/send-login-code.ts`,
      `src/lib/inbound/reply.ts`: WhatsApp only today); a casual who replied STOP gets the app's
      notifications only (today they'd switch to WhatsApp); every "WhatsApp or text" on screen
      says "text" (login, pay code, Profile, Help, the office's offer list, Enquiries, the
      dashboard's shifts line, the guide); a firm with no text sender of its own (no Webex key)
      gets its login link and pay code by email, which needs the choice made per firm (today
      `texts` is the whole server's, `src/lib/auth/login-channel.ts`, so with Webex on, such a
      firm's link and code go nowhere, logged `no_text_sender`, which the send-failure alert leaves
      out: 15.2's reviews). Tests: each message by text, STOP, the words
- [x] Our text system's sender (M): a `MessagingTransport` (`src/lib/messaging/transport.ts`) for the
      firm's text provider (`MESSAGING_TRANSPORT` took only `console` and `none`, so nothing was
      sent for real), refused in tests like every real sender; its delivery reports if it has them.
      **The build (2026-10-29), switched off:** `src/lib/messaging/webex.ts`, from Webex
      Interact's public reference (POST `/v1/sms`, `X-AUTH-KEY`, `{message_body, from, to:
      [{phone}]}`); `MESSAGING_TRANSPORT=webex`, refused under `NODE_ENV=test` (pinned in
      `scripts/invariants.sh`, and refused at send time in a test that doesn't stand in for the
      network) and needing `SECRETS_KEY`: each firm's token and sender from P5's secret store, the
      firm the job's own (`src/lib/tenancy/job-firm.ts`), a firm without both having no text sender
      on any channel, a WhatsApp too (its casuals' messages go by email); texts only (a WhatsApp
      is refused, so the shared sender gives the casual the text); a timeout on every request,
      each failure a code, the id kept only in a form the log accepts. **Refused in production until 15.1:** the login link and the
      pay code still go by WhatsApp whenever a text sender exists, which Webex won't carry. Not
      tried against the real service (the firm's account), and its delivery reports wait for the
      webhooks (with the third task). Tests: the request as the reference says, no firm or no key
      sends nothing, each failure a code with nothing personal, the settings (15.2)
- [ ] Replies by text, only if the text system can pass incoming texts on: its webhook (signature
      checked, one row per message id, a fast 200), into the shifts line (`receiveSms`,
      `src/lib/inbound/receive.ts`) with STOP and START; and the sender's delivery reports (Webex
      Interact's "Outbound SMS - Delivered" and "Failed" webhooks, matched by the transaction id:
      15.2). Call-to-text goes (it needed Twilio voice)

**The text system's details, found 2026-10-26** (from public docs; to confirm with the pilot firm,
`docs/discovery-axlr8.md`): AXLR8, the firm's CRM, sends its texts through **Webex Interact**. Webex
Interact has a send API (`https://api.webexinteract.com/v1/sms`, an access token in the
`X-AUTH-KEY` header) and webhooks for "Inbound SMS Received" (a unique event `id`, the sender's
number, the number it came in on, the text and its time), "Outbound SMS - Delivered" and "Failed",
and "SMS Opt Out Received", with an optional signature. Replies need a "dedicated inbound number":
texts sent under a name can't be replied to. So the three tasks above have a provider. Two changes
follow from the 2026-10-19 decision ("our own text system"): the sender is chosen **per firm**, with
the firm's key in the secret store from proposal P5 (today one sender serves the whole server,
`src/lib/messaging/index.ts`); and replies come to ShiftDesk only if AXLR8 doesn't already read
replies on that number. A "who sends what" setting (proposal P2) keeps ShiftDesk from repeating a
confirmation or reminder AXLR8 already sends. **Confirmed by Dylan, 2026-10-26:** Webex Interact,
the firm's own account, about 20p a text, replies turned off. So the first two tasks apply (texts
out, delivery reports); the third (replies) waits until the firm turns replies on with a dedicated
inbound number, and casuals answer in the app meanwhile. Who sends what (Dylan, 2026-10-26,
"Connecting the firm's systems" 9): ShiftDesk sends the offer, the confirmation and the reminders
for bookings made in ShiftDesk; AXLR8, which can send any texts the firm chooses, keeps texting
about the office's own bookings.

Messages 2, decided (Dylan, 2026-10-26): the app's notification first and a text only when the
phone has no notifications on (fewer texts to pay for); built in P2.4.

Done when: every task above is ticked with a stamp that includes the browser tests; `scripts/verify.sh`
with `RUN_E2E=1` prints VERIFIED; no test or browser test sends a real text; the `claims-auditor`
checks the phase against this line.

## Phase 22 — The office's look, round 2

Added 2026-10-22. Dylan saw Phase 21 live: "the use of colours it just looks very bland theres
still no depth to any of the individual sections and a tacky scroll wheel on the left side you've
missed out on shaders layers and depth this whole time i also asked for animations still none not
ai slop just subtle reactive on click responses". He sent more references (dark admin dashboards:
Dashdark X, HITE EQ, notion>ision, PMD Digital, ovniscale) and picked the hilos direction (DM Sans,
DM Mono, a semibold serif). The mock-up (`docs/mockups/phase-22/`) was approved the same day with
one change: "remove the gradients theres no need for that". The office only; every route, label,
link and action stays. Where the real office differs from the mock-up: "Offer" opens the offer
page (it never sent anything by itself), so it shows a spinner while that page opens rather than
the mock-up's tick. Docs: `docs/ui-design.md`, `docs/screens.md`.

- [x] The system, round 2: DM Sans for words, DM Mono for the big numbers and Newsreader semibold
      for each page's headline, self-hosted; the window (a grey ground) with the page as a sheet on
      it, white surfaces with a lit top edge and a shadow of their own, and grooves set into them;
      the dashboard's four colours as full flat colour (coral, amber, blue, green) with a coloured
      shadow and a fine grain, and their panels as flat washes; no gradients; everything you press
      dips and springs back (about 90ms down, 300ms back), nothing moves on its own, and reduced
      motion turns movement off; AA contrast in both themes. Tests: the tokens and their contrast
      in both themes, the fonts, no gradient in the office's styles, every shadow pinned, the press
      feedback (22.1)
- [x] The shell and the menu: from 1024px the menu on the ground and the page as a sheet set into
      the window; below it, the top bar over a sheet with rounded top corners; menu rows 34px with
      a mouse and 44px on touch (always 44px in the drawer); the highlight slides to the page you
      pick; no scrollbar in the menu: an admin's whole menu fits a 1280 × 640 window, and a shorter
      one scrolls with no bar and a fade at the edge that has more; the how-to guide in the account
      menu; each count in its card's colour. Tests: the menu's rows and states, the fit at
      1280 × 640, the guide in the account menu on every page, the browser tests (22.2)
- [x] The dashboard: the four cards in full colour, lifting under the pointer and dipping when
      pressed, each jumping to its section, which shows where you landed; the urgent places' date
      tiles as small calendar pages with a red band and their fill bars set in grooves; "Offer"
      dipping and showing a spinner while its page opens; the "…" menu growing out of its button;
      this week's bars set in grooves (striped on a day with no sessions) with the day's numbers
      under the pointer or on focus; Needs attention, Waiting on others and Sorted today as washes
      of raised white rows. Tests: the dashboard's parts, its counts and links unchanged, the
      browser tests (22.3)
- [ ] Every other office page on round 2's parts (cards, list cards, tables, buttons, chips, fields,
      menus and confirmations), the skeletons pulsing rather than still, at 390px and 1280px in both
      themes. Tests: the browser tests of every office page (22.4)

Done when: all four tasks are ticked with a stamp that includes the browser tests;
`scripts/verify.sh` with `RUN_E2E=1` prints VERIFIED; no route, label, link or action is lost;
screenshots at 390px and 1280px, light and dark, sit beside the approved mock-up in
`docs/mockups/phase-22/`; `docs/ui-design.md` has round 2's system; the `claims-auditor` checks the
phase against this line.

22.4 stays open: Phase 23 replaces round 2's look before it was finished (22.4's fourth audit round
was stopped on 2026-10-23 when Dylan asked for a flat look instead).

## Proposed 2026-10-26: the firm's CRM and ops portal, the staffing email, a bigger firm (not started)

Dylan's ask (2026-10-26): connect ShiftDesk to how the pilot firm really works, take over "our queries
and staffing email … so we can focus on staffing events instead of working a lot on queries,
cancellations and background work", and make the codebase "handle a lot of prompts": lots of
casuals at once, lots of office users at once, and lots of Claude Code sessions. Who owns what, in
his words: **AXLR8** (the firm's CRM) is "for everything basically" (events, sessions, roles, staff,
qualifications, bookings); the firm's **ops portal**, built on AXLR8, has "our payroll check in and
out and real time on site data"; casuals use **ShiftDesk** for shifts (see, grab, cancel, change,
ask), and on-site stays in the ops portal.

**No agreement is signed** (Gate B), so golden rule 7 holds throughout: everything is built and
tested on made-up data shaped like the firm's (Acme, `ZZ` postcodes, made-up people), and nothing
names the firm, its address, its venues, clients or people. The vendor names AXLR8 and Webex
Interact may appear (products many firms use, like Deputy in ADR-008). AXLR8's API Builder PDF is
AXLR8's own confidential document: never commit it or copy its field lists; the made-up AXLR8 in
tests uses our own names. Nobody explores AXLR8's API with an employee's login before the agreement.

These are **proposals**: their tasks get boxes, a number and a "Done when" line when Dylan gives
each one the go-ahead (golden rule 10). They're labelled P1 to P8 so they can't clash with phases a
parallel chat adds. Tasks marked **attended** are built with Dylan's session open, not by `/overnight`:
those that touch `.claude/` or `scripts/invariants.sh` (which `/overnight` may not edit), and those
that add a secret or the connector (worth watching as they're built). The questions to send first are in
`docs/discovery-axlr8.md`; the decisions they needed, all taken on 2026-10-26, are under
"Connecting the firm's systems" in "Decisions waiting for Dylan". Flags: **S** schema, **A** auth, **T** tenancy, **M** messaging,
**R** rules (each needs Dylan's OK and the `guardrails-reviewer`); **UI** changes a screen (a
mock-up first).

**First answers (Dylan, 2026-10-26;** `docs/discovery-axlr8.md` "Answers"**).** AXLR8 can't be
asked for now. The ops portal has an API that can share attendance and pay lines per person, and it
copies from AXLR8 every hour. Texts go through the firm's own Webex Interact account, at about 20p
a text, with replies turned off. The staffing mailbox is on Microsoft 365. Pay is fortnightly,
always on the Friday. Bookings: the office books normally (in AXLR8); places filled overnight, out
of office hours, for the next day, and urgent places, are booked through ShiftDesk, and the office
can book through ShiftDesk too. (Those overnight places are filled by ShiftDesk's offer waves: code
and the rules decide who gets a place, never AI, golden rule 1.) So:

- **The ops portal's API is the first source** (P5 and P6), AXLR8 directly later (ADR-026). Its
  copy of AXLR8 can be up to an hour old, so ShiftDesk offers casuals only the places the office
  opens to it (urgent ones and next-day ones still open after hours), through the existing "showing
  to casuals" switch, and a session's other places stay the office's.
- **Texts cost money, and casuals can't text back.** At about 20p, a wave that texts 1,500 people
  costs about £300 for one place: the wave cap ("Connecting the firm's systems" 5) matters, and so
  does Messages 2 (Claude now recommends the app's notification first, a text only when a phone has
  no notifications on). Phase 15's replies task waits until the firm turns replies on; casuals answer
  in the app meanwhile.
- **Email:** Microsoft 365 blocks automatic forwarding to outside addresses by default, so the
  firm's IT allows it for ShiftDesk's one address (P7), or a later version reads the mailbox through
  Microsoft's own API with the firm's consent.

**Second answers (Dylan, 2026-10-26;** `docs/discovery-axlr8.md` rows 4.P1 to 4.F3**).** The ops
portal's API gives sessions, staff, qualifications and who's booked; it takes bookings and passes
them on to AXLR8; and it sends changes as they happen (to confirm from its documentation). AXLR8
can send any texts the firm chooses, and ShiftDesk sends the texts about its own bookings
("Connecting the firm's systems" 9). Pay cycle 1 ran Mon 29 Dec 2025 – Sun 11 Jan 2026, paid Fri
16 Jan: every cycle is two ISO weeks, paid the Friday after. So:

- **The ops portal is the whole source, both ways,** and AXLR8 isn't needed directly for now.
- **P5 is push first, with a pull to catch up:** the portal's webhooks in, under golden rule 3, and
  a reconcile pull as the backstop (P5).
- **Bookings made in ShiftDesk go to the portal's API,** which passes them on to AXLR8; the office's
  "Enter in AXLR8" list is only the fallback for when the portal is down or slow.
- **What stays:** a change made in AXLR8 reaches the portal on its hourly copy, so ShiftDesk still
  offers casuals only the places the office opens to it.

**Phase 24 merged on 2026-10-29** (the UI chat's last phase so far): the items below waiting for
it ("after the UI chat's Phase 24") can start now, each that changes a screen with a mock-up first
(CLAUDE.md, "How to work each task").

**Order.** Now: Dylan gets access to the ops portal's documentation and a test copy with made-up
data, and sends the follow-ups (`docs/discovery-axlr8.md` §4 and §5). After the parallel UI chat's
work is merged (it edits the same files): P1 (built last instead: Dylan, 2026-10-29), then P2, P3
(each item as it's decided), P5's framework and secret store, P7's core and P8, all on made-up data.
P4's back end now, alongside the UI chat (go-ahead 2026-10-26: it changes no screen), and its office
pages after the merge. Once the API's shape is known: P5's first connector (the ops portal), P6, and
Phase 15's texts. After signing: the real API key, a shadow cycle (P5's sessions come in hidden from
casuals; the office compares ShiftDesk's required and booked counts with the ops portal each day for
one pay cycle), a few events live, then everything, then the email inbox. AXLR8 directly when it can
be asked.

### P1 — The repo, easier for Claude (attended; docs and config only; go-ahead: Dylan, 2026-10-29, built last)

Why (before P1): `PLAN.md` was about 530 KB (well over 100k tokens) and `/next-task` read all of
it; `docs/work-log.md` was 858 KB and `docs/overnight-log.md` 1.1 MB, and both only grew. Built
last, after P5 and the Phase 15 sender were ticked and P7's back end was built, so nothing else was
editing `PLAN.md`.
Nothing under `src/` changes but the new local `CLAUDE.md` files, and no word a casual or the
office sees.

- [x] The archive (attended): the numbered phases with every box ticked (Phases 0 to 3, 5, 10
      to 14, 16 to 21, 23 and 24) move word for word to `docs/archive/plan-done.md`, frozen: its
      sha256 is pinned in `scripts/archive-check.sh`, which `scripts/invariants.sh` runs (check 9),
      so any change to it fails verify and blocks every tick until undone (not a `*PLAN.md` name,
      which the tick guard would refuse as new ticked lines). The phases still open (the Gates,
      Phases 4, 6, 7, 8, 9, 15 and 22) stay under "Still open from earlier phases", each with its
      "Done when" line where it has one (Phases 15 and 22), where `/close-task` and the
      `claims-auditor` read it; the proposals P1 to P8 stay whole (P2 to P4's back ends are ticked,
      but their screens wait for the UI chat). `scripts/plan-moved-check.mjs` shows every line taken
      out of `PLAN.md` is in a new file, word for word. Tests: the pin fails on a planted change
      (`scripts/selftest.sh`), nothing lost (P1.1)
- [x] The Parking lot, the Hours log and the Decisions list (attended) move to
      `docs/plan/parking-lot.md`, `docs/plan/hours-log.md` and `docs/plan/decisions-waiting.md`,
      each leaving its heading in `PLAN.md` with a short pointer, so the 300 or so lines in some 60
      other files that say "the Parking lot", "the Hours log" or "Decisions waiting for Dylan"
      still lead to it (none needs
      changing, and none under `src/app/` may change while the UI chat works); old `PLAN.md` line
      numbers in `docs/audit-2026-09-30.md` and the logs get a dated note that they point at
      `PLAN.md` as it was then. Tests: nothing lost (`scripts/plan-moved-check.mjs`), `PLAN.md`
      under 100 KB (P1.2)
- [x] The logs by month: `docs/logs/work-YYYY-MM.md` and `docs/logs/overnight-YYYY-MM.md`, cut at
      each dated section with nothing changed (the month files, joined, are the old body byte for
      byte), the old files kept as short indexes of the months; `docs/plan/blocked.md` lists what's
      blocked and on whom, so `/overnight` finds it without reading a 1.1 MB log. Tests: the
      join (P1.3)
- [x] The commands and agents point at the new places (attended: `.claude/`): `CLAUDE.md` (rule 10
      and step 6), `.claude/commands/next-task.md`, `overnight.md` (its hours row, work-log note
      and decision log by month), `log-hours.md`, `fact-check.md` and
      `.claude/agents/doc-fact-checker.md`; `close-task.md` and the `claims-auditor` need no change
      while the "Done when" lines stay put. Tests: `scripts/selftest.sh` (P1.4)
- [ ] Short local `CLAUDE.md` files under `src/lib/integrations/`, `src/lib/rules/`,
      `src/lib/roster/` and `src/worker/`, which Claude Code reads only when working there: what
      lives there, its rules and the docs to read. None under `src/app/`, which unit tests walk;
      two tests read every file under `src/` (`tests/unit/repo.made-up-data.test.ts`,
      `tests/unit/no-aws.test.ts`), and the new files pass them: no address, postcode or AWS word
      (P1.5)

Done when: P1.1 to P1.5 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; `scripts/selftest.sh` passes, with the archive's
pin failing on a planted change; `scripts/plan-moved-check.mjs` finds nothing lost; the
`doc-fact-checker` finds no dead pointer to a moved section; `PLAN.md` is under 100 KB; nothing
under `src/` changed but the new `CLAUDE.md` files; the `claims-auditor` checks the phase against
this line.

### P2 — Reach casuals in production (go-ahead for the back end: Dylan, 2026-10-28; its words on the login and Pay pages after the UI chat's Phase 24; S, A, M)

Why: casuals get their login link and their pay code by WhatsApp only
(`src/lib/auth/send-portal-link.ts`, `src/lib/auth/send-login-code.ts`), no real
text sender exists (`MESSAGING_TRANSPORT` takes only `console`, `src/lib/env.ts`), and the job worker
refuses to start in production without one (`src/lib/env.ts`, `deploy/docker-compose.yml`). Every
sync, webhook, reminder and offer wave runs in that worker. Every message to a casual goes by
WhatsApp, then a text (`sendToWorker`, `src/lib/notify/send.ts`), a push only after a text that
went; and no booking records where it came from, so the reminders go to every confirmed booking.

**This round is the back end only** (Dylan, 2026-10-28: "P2 back end"): the UI chat is still on
Phase 24.5 and 24.6, so no task here changes a screen, an office page, `src/app/`, `src/lib/office/`,
`docs/screens.md` or `docs/ui-design.md`. New words (each email's subject, the casual's login-link and
code emails) go in `docs/messaging-templates.md` first, for Dylan to approve (P2.1). Decisions:
"Connecting the firm's systems" 15 to 17.

- [x] The words (docs only; Dylan approves them before P2.4 and P2.6 are built): in
      `docs/messaging-templates.md`, a subject line for each message to a casual that can go by
      email (offer, urgent offer, booking confirmation, the 24-hour and 2-hour reminders, the firm's
      change and cancellation, a request's answer, a pay query's answer, the office's reply, the
      licence warning and notice), its body the message's own approved words (as in the WhatsApp
      templates); the casual's login-link and code emails; a policy paragraph on the order (push,
      then a text once a sender exists, then email) (P2.1)
- [x] Where a booking came from (S): `assignments.booked_via` (app: a casual's own take or an
      accepted offer; office; sheet; api, for P5), checked like `cancel_via`, written by
      `bookShift()` (`src/lib/roster/book.ts`) and the sheet sync (`src/lib/roster/sheets/sync.ts`);
      the migration fills the bookings there are from each one's `shift.assigned` event, and one
      with none counts as the office's (as `src/lib/strikes/issue.ts` already does). Tests: each
      writer, the backfill, the check, another firm's rows (P2.2)
- [x] Who sends what: an owner setting `firm_system_sends` (off unless the firm says so: ShiftDesk
      sends as today); on, no booking confirmation and no 24-hour or 2-hour reminder from ShiftDesk
      for a booking whose `booked_via` is sheet or api (the firm's own system tells those casuals);
      offers and the office's change and cancellation notices still go (decision 9). Tests:
      `shift.reminders.test.ts`, the confirmation, `onboarding.test.ts` (P2.3)
- [x] Push first, then a text, then email (M; after P2.1): one `deliverToWorker()` in
      `src/lib/notify/send.ts`: a push to the casual's phones (delivered once one phone takes it),
      else a WhatsApp or text as now (STOP respected), else an email with P2.1's subject when they
      have an address, else not sent (`no_channel`, logged); a transport with no text sender says so
      (`NoTextSenderError`), never a failed text. Every sender moves to it, keeping claim → send →
      record: offers, reminders, the booked, change, request and pay-query notices, the licence
      messages (those with no push today skip it: no new push words). The shifts line's own replies
      and STOP or START stay text only (decision 11), and so do the office's replies on Enquiries:
      each answers a message to the shifts line, so a text sender exists, and its `messages` row and
      the office's page take WhatsApp or text only (Parking lot, P2.4; Dylan, 2026-10-29: this
      sentence replaced "the office's replies" in the list above). The office's change and
      cancellation notices, the proof of the notice given, go by the WhatsApp, text or email as
      well as the push, never instead of it (Dylan, 2026-10-29). Migration:
      `shift_reminders_channel_check` takes push and email. Tests changed on purpose (Messages 2:
      a push now instead of the text, not beside it) named in the commit; new: each step, a push gone
      or failed falls to a text, no text sender falls to email, no address is `no_channel`, nothing
      twice on a retry (P2.4)
- [x] The worker runs in production with no text sender (M): `MESSAGING_TRANSPORT=none` (an empty
      value unset), allowed in production; the Compose file's worker runs without its profile,
      with `none` by default and SMTP email as production already insists; the send-failure alert
      ignores `no_text_sender`, as it does `sms_opted_out`. Tests changed on purpose: the production
      refusals (`env.test.ts`, `env.demo.test.ts`, `push*.test.ts`) and `deploy.compose.test.ts`;
      new: the worker starts in production with `none` and SMTP, and still refuses `console`.
      Docs: `docs/runbooks.md`, `docs/architecture.md` (P2.5)
- [x] Login links and pay codes by email, switched off (A, M; after P2.1): an owner setting
      `login_by_email` (off); `send-portal-link.ts` and `send-login-code.ts` choose the channel at
      the claim: a text if a sender exists, else (with the setting on and an address) P2.1's
      email, else not sent (`no_channel`); the events log the channel used, never a hard-coded
      WhatsApp. A casual's email lowercased and checked in `upsertWorker`
      (`src/lib/roster/workers.ts`), and a changed address ends their sessions, as a changed mobile
      does (audit L81). The login-link alert counts emailed links too. Tests: the login flow, its
      events, the code, no resend; off sends nothing by email; an email change logs the casual
      out. Docs: `docs/data-model.md`, `docs/compliance.md`, `docs/privacy-notice.md` (its "How we
      contact you" paragraph approved by Dylan, 2026-10-29) (P2.6)

**After the UI chat's Phase 24 merges** (not this round): the login page, the Pay code step, help
and the profile's notification note stop naming WhatsApp, `docs/screens.md` first (P2.7); then a
firm can switch `login_by_email` on.

Done when: P2.1 to P2.6 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` or `src/lib/office/`
changed, except the dashboard's one channel word "email" in `src/lib/office/board-copy.ts`
`CHANNEL_WORDS` (P2.4; Dylan, 2026-10-29), and no words but those Dylan approved in P2.1 (and the
privacy notice's "How we contact you", P2.6; Dylan, 2026-10-29); the worker starts in production with no
text sender; a casual is reached by push, else a text, else email, else the miss is logged; every
booking says where it came from, and with `firm_system_sends` on, sheet and API bookings get no
confirmation or reminders from ShiftDesk; with `login_by_email` on, a casual's login link and pay
code go by email; the `claims-auditor` checks the phase against this line.

### P3 — Fit the firm's model (go-ahead for the back end: Dylan, 2026-10-29, Rules 3 too; screens after the UI chat's Phase 24; S, T, R)

**This round is the back end** (Dylan, 2026-10-29: "just finish it all"; Rules 3 "build the rule
now"): the UI chat is still on Phase 24.6, so no task here changes a screen, `src/app/` or an office
page, and no casual-facing words beyond those Dylan approves. The proposal's items follow the tasks.

- [x] Pay calendar (S): `payPeriod(day, calendar)` beside `payWeek()` (`src/lib/pay/pay-week.ts`,
      pure; with no calendar set, exactly today's ISO week paid the Friday after); an owner setting
      `pay_calendar` (7 or 14 days, an anchor Monday, the pay day as days after the period ends,
      the label Week or Cycle) through `src/lib/onboarding/settings.ts` (the proposal below says
      "a migration like 0037": not needed, as like every owner setting the app can't write it,
      `app_set_firm_setting()` taking only its own keys); pay-query grouping
      (`src/lib/pay/grouping.ts`) by the firm's pay period. Tests: made-up anchors, the 53-week year
      (2026), the clock change, a firm without a calendar unchanged (P3.1)
- [x] Name map per firm (S, T): a table of outside names (role, qualification, staff type,
      cancellation reason) each mapped to a ShiftDesk code (a role with its pay rate) or to skip,
      with `firm_id`, RLS, a `TABLE_ACCESS` entry and isolation fixtures; an owner script to set it
      (like `scripts/firm-sheet-owner.ts`), each change logged; the sheet sync and the file import
      use it: role names (a skipped one is left off a worker's roles, and its shift row isn't
      brought in), and the credentials import's qualification names, with `normaliseRole`
      (`src/lib/roster/sheets/parse.ts`) and the import's own spelling as the fallbacks; an
      unmapped name neither can read is a bad role or type, logged with the sync's or the import's
      problems and never offered. Staff types and cancellation reasons (neither the sheet nor a
      file carries one) and a role's pay rate are held for the connector (P5): the sheet and the
      import never write a session's pay (S2). Tests: mapped, skipped, unmapped, another firm's
      map unused (P3.2)
- [x] "Any of" licences (S, R; Rules 3, Dylan 2026-10-29): a rule may need one of several
      credential types (a door supervisor licence covers guarding: the security pack's
      security officer takes either), in `src/lib/rules/packs.ts`,
      `src/lib/credentials/requirements.ts`, `src/lib/rules/eligibility.ts` and
      `docs/rules-and-credentials.md` together (the parity tests hold them in step); every place
      that reads a rule's types reads the groups (with no new words: a group shows as its first
      type, and fails in its first held type's words, until the "A or B" words are approved). Tests: either licence passes, neither fails, an
      expired one doesn't count, "all of" rules unchanged (P3.3)
- [x] Who asked for a cancellation (S, R): recorded apart from who carried it out (casual, firm,
      client, unknown), backfilled from each cancellation's own record; the casual's own cancel says
      casual, the planner API and the sheet what their data says (neither says yet: not known), the
      office firm (its form asks, after the UI chat); the notice report
      (`src/lib/office/notice-report.ts`) counts by who asked; a per-firm strikes switch
      (`src/lib/strikes/settings.ts`; off, its strike column's words are Dylan's to approve). Tests: each writer, the backfill,
      the report's counts, strikes off issues none (P3.4)

**After the UI chat's Phase 24 merges:** Home's pay day from the firm's calendar or its imported
`pay_records.pay_date` (`src/app/page.tsx`), the top bar, the dashboard and the pay dashboard;
payroll's pay-query headings and the digest email's headline for a fortnight ("the week of" today,
`src/lib/ai/pay-summary.ts`: new words, Dylan's to approve); the
Needs attention items for an unmapped name and for a skipped name on a session still to come
(the sync's `skipped_live`), the import page's "left out" count and the action log's words for a
name map change ("The firm's settings changed" today); the casual's "you need A or B" words (a
mock-up first);
the office's "who asked" choice when it cancels, and who asked on the notice report's page and file;
the casual's strike sentences (the shift page's note, Help and Profile) reading the firm's strikes
switch, and the Cancellations page's "None: strikes are off" (Dylan's to approve) before any firm
switches strikes off; and the open shifts' chips for a one-of group ("SIA SG or SIA DS", a mock-up
first: a group's chip shows its first type until then, and a casual's own shift page shows the one
she holds).

Done when: P3.1 to P3.4 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` changed and no screen or
casual-facing words; a firm without a pay calendar or a name map works exactly as before; a door
supervisor licence lets a casual take a security officer's shift where the firm's rule says either;
the notice report says who asked for each cancellation; the `claims-auditor` checks the phase
against this line.

The proposal (2026-10-26):


1. **Pay day** (S, UI). Quick fix first: the casual's Home takes the pay day from the imported
   `pay_records.pay_date` when there is one, as the office's pay page already does (today
   `src/app/page.tsx` works it out from the weekly rule, so a fortnightly firm's casuals would read
   the wrong day: golden rule 9). Then a per-firm pay calendar, reversing D8 (Pay 10) (the pilot
   firm: two ISO weeks a cycle, cycle 1 Mon 29 Dec 2025 – Sun 11 Jan 2026, paid the Friday after;
   the year-end rule still to ask, `docs/discovery-axlr8.md` §5): 7 or 14 days,
   an anchor Monday, the pay day as days after the period ends, and the label "Week" or "Cycle". The
   pure `payWeek()` (`src/lib/pay/pay-week.ts`) becomes `payPeriod(day, calendar)` with today's rule
   as the default; the setting goes through `src/lib/onboarding/settings.ts` and a migration like
   `drizzle/0037_firm_setting_checks.sql`; its readers are the top bar (`src/app/office/layout.tsx`,
   `office-shell.tsx`, `office-frame.tsx`), the dashboard (`dashboard-view.tsx`,
   `dashboard-charts-load.ts`, gone since Phase 24.3: its reader to find again), the pay
   dashboard (`src/lib/office/pay-dashboard.ts`), and Home
   (`src/app/page.tsx`, `src/app/home-view.tsx`, `src/lib/portal/home-copy.ts`); pay-query grouping
   (`src/lib/pay/grouping.ts`) groups by the Monday (`mondayOf`) and moves to the pay period. The weekly hours cap stays Monday to
   Sunday. Tests use made-up anchors, the 53-week year (2026) and the clock change.
2. **A name map per firm** (S, T, R): each outside name for a role, qualification, staff type or
   cancellation reason, mapped to a ShiftDesk code (and a role's pay rate), or to "skip"
   (Contracted, Holiday, "Not Set", the CRM's not-available and cancellation pseudo-events). Today a
   role code must match `^[a-z][a-z0-9_]*$` (`src/lib/db/schema/roster.ts`), so "12D" and brackets
   fail, and pay tiers (NLW, LLW) sit inside role names. `normaliseRole`
   (`src/lib/roster/sheets/parse.ts`) is the fallback; an owner-only script sets the map (like
   `scripts/firm-sheet-owner.ts`); unmapped names show in Needs attention and are never offered. A
   new table: `firm_id`, RLS, a `TABLE_ACCESS` entry and isolation fixtures.
3. **Traffic-management qualifications and roles, and "any of" rules** (R, UI): Chapter 8, NHSS
   12D, traffic marshal, supervisor and event manager, in `src/lib/rules/packs.ts`,
   `src/lib/credentials/requirements.ts`, `src/lib/rules/eligibility.ts` and
   `docs/rules-and-credentials.md` together (the parity tests check they match); a role that takes a
   door supervisor or a security guard licence (Rules 3). The casual's "you need A or B" wording: a
   mock-up first.
4. **Who asked for a cancellation** (S, R, UI): recorded apart from who carried it out (casual,
   firm, client, unknown), and used by the notice report (`src/lib/office/notice-report.ts`). Today a
   casual who phones in and is cancelled by the office in the CRM shows as a short-notice firm
   cancellation, which matters for Employment Rights Act compensation. Plus a per-firm strikes switch
   (`src/lib/strikes/settings.ts`). Planner and sheet cancellations are already never strikes
   (`src/lib/strikes/decide.ts`).
5. **Availability out** to the CRM: waits until discovery says whether AXLR8 keeps it.

### P4 — Ready for a big firm (go-ahead for the back end: Dylan, 2026-10-26; office pages after the UI chat merges; S, T, M, R)

Target: about 2,000 casuals, 110 events a fortnight, 10 office users at once, 1,000 messages in 10
minutes; the firm's texts cost about 20p each. Today the design assumes small numbers
(`docs/architecture.md`: "Scale is small (tens to a couple of hundred messages per firm per day
…)"). A first-come wave goes to everyone eligible, one at a time: an estimate, if 1,500 of 2,000
casuals are eligible at about 0.35 s each (one rules check of about 9 queries, the locks and the
send), is about 1,500 texts and about 9 minutes for one place, with other firms' waves waiting. The
pool is 10 connections per process with no timeouts, and an office page opens up to 5 transactions
one after another before its own (an admin's; fewer for a resourcer or payroll).

**This round is the back end only** (Dylan, 2026-10-26: "Mark PR ready; start P4 back end"): a
parallel chat is changing the office's screens, so no task here changes a screen, an office page,
a message's or an email's words, or anything under `src/app/`, `src/lib/office/`, `docs/screens.md`
or `docs/ui-design.md`. Build each with `/next-task P4.n` (the default would pick an older blocked
task) and close each with `/close-task`. The numbers are Dylan's ("Connecting the firm's systems"
10 to 14). Three of P4's first ideas are replaced: chunked claims (4 sends at a time instead,
P4.4), "one retry on 429" (it rarely fits in the 5 seconds, and `tests/unit/ai.anthropic.test.ts`
pins "nothing is retried", P4.6), and limits "per database role" (per transaction instead,
ADR-027, P4.2).

- [x] Indexes for a big firm's lists: `shifts (firm_id, event_id)`, `shifts (firm_id, ends_at)`,
      `assignments (firm_id, cancelled_at)`, `offers (firm_id, sent_at)` and `events (firm_id,
      action, created_at)`, declared in `src/lib/db/schema/` with one migration
      (`npm run db:generate`, plain `CREATE INDEX` like `drizzle/0028_pilot_size_indexes.sql`).
      Tests: each index and its columns in `pg_indexes` (`tests/integration/db.indexes.test.ts`)
      (P4.1)
- [x] The database's limits per process: a wait for a connection of at most 5 s (web) and 30 s
      (the worker), pools of 10 and 15 (`src/lib/db/pool.ts`); `statement_timeout` 15 s / 60 s and
      `idle_in_transaction_session_timeout` 30 s / 60 s, set in `withFirm`'s own `set_config`
      statement so they end with the transaction (ADR-027: per transaction, not per database
      role); longer only for the credential scan's lock holder, the firm's data export, the
      retention purge and the metrics roll-up. Tenancy: approved by Dylan ("Connecting the firm's
      systems" 14), then the `guardrails-reviewer`. Tests: the limits set and gone on the same
      pooled connection, a slow statement and an idle transaction ended and the pool carrying on,
      a full pool failing a wait instead of hanging (`tests/integration/scoped-client.test.ts`);
      the scan's lock holder; the two profiles (`tests/unit/db.limits.test.ts`) (P4.2)
- [x] A cap on each offer wave ("Connecting the firm's systems" 10): first come, first served sends
      to the best 5 casuals per free place by the existing ranking, at most 50, then the next wave
      after `wave_minutes` while anyone is left; a place taken shrinks the wave; the Open shifts
      board, first yes wins and fair rotation unchanged; owner setting `wave_per_place` (1 to 20,
      default 5). Then the `guardrails-reviewer`. Tests: the sizes and order
      (`tests/unit/offers.waves.test.ts`, its "everyone at once" case replaced on purpose); waves of
      5, 5 and 2, and 4 places' 20 (`offers.waves.test.ts`, `waves.timing.test.ts`); 2,000
      casuals offered 5 for one place (`tests/helpers/bulk-seed.ts`, `offers.scale.test.ts`); the
      lock test at the 50 cap with every check kept; `firm:settings` (`onboarding.test.ts`) (P4.3)
- [x] Waves send 4 at a time, each casual still claimed alone under the shift's lock; one wave per
      fetch (`OFFER_WAVE_WORK_OPTIONS`, `src/worker/jobs/index.ts`); the eligibility loader groups
      its rows by casual once (same verdicts). Then the `guardrails-reviewer`. Tests: at most 4 in
      flight, nobody messaged twice after a crash, Take shift within 2 s
      (`offers.waves.lock.test.ts`); 50 casuals with 300 ms sends within about 6 s; batch verdicts
      equal single ones at 2,000 (`eligibility.batch.test.ts`) (P4.4)
- [x] Reminders 4 at a time, at most 200 a run, the rest by a follow-up job behind other firms'
      (`src/lib/reminders/send.ts`). Then the `guardrails-reviewer`. Tests: 2,000 due in one slot
      sent once each, another firm's in between, nothing twice after a crash
      (`shift.reminders.test.ts`) (P4.5)
- [x] The AI under load, all in `src/lib/ai/anthropic.ts`: one client per worker process, at most
      4 calls at once (a call that waits past its 5 seconds goes to the office), a breaker after 5
      failures in a row (30 s, then one trial call), no retry, no timers. The model stays: moving
      to `claude-haiku-5-5` needs the live API (it thinks by default, so a 5-token label would come
      back empty). Tests: `tests/unit/ai.anthropic.test.ts` (P4.6)
- [x] No automatic replies by text ("Connecting the firm's systems" 11 and 12): a text or
      WhatsApp that comes in is stored, sorted and logged as today, but nothing is sent back
      (no automatic reply, no unknown-number reply, no STOP or START confirmation; a STOP itself is
      still recorded); an office message still makes a question in "Need a person"; a per-firm
      owner setting switches automatic text replies back on (off by default). At most 5
      unknown-number alert emails per firm an hour (`hitLimit()`, inside the claim transaction).
      `message.received` gains `replyHeld` or `alertHeld`. No new words. Then the
      `guardrails-reviewer` (STOP especially). Tests: `inbound.whatsapp.test.ts`,
      `inbound.sms.test.ts`, `enquiries.test.ts` (fixtures switch replies on where they test them,
      on purpose; new cases with them off) (P4.7)
- [x] Seeing a backlog (`src/lib/ops/tick.ts`, `alerts.ts`): the oldest waiting job (inbound over
      60 s, waves over 2 min, others over 15 min), a job past 80% of its expiry, the worker waiting
      for connections, a firm's AI fallbacks over 20% of at least 20, over 1,500 inbound messages
      or 500 offers per firm an hour. Tests: `tests/unit/ops.alerts.test.ts`,
      `tests/integration/ops.alerts.test.ts` (P4.8)
- [x] The target in one test: 1,000 messages from 1,000 casuals in a burst, all handled within a
      bound (`tests/integration/inbound.load.test.ts`); `docs/architecture.md`'s scale line at the
      target; "one worker process" and the connection budget in `docs/runbooks.md`; the pre-pilot
      checklist (`docs/testing.md`) (P4.9)

**After the UI chat's work is merged** (office pages, not this round): the layout's 5 reads in one
transaction (`src/app/office/layout.tsx`); Needs attention worked out once a request; caps on the
lists in `src/lib/office/dashboard.ts` ("and N more"); the webhook status from a small row
(`src/lib/office/webhook-settings.ts`; S); the jsonb OR chain in `src/lib/office/action-log.ts`;
and, each with its words in `docs/screens.md` first: why a reply was held (Enquiries), a stop after
25 offers per free place, one combined email past the 5.

Done when: P4.1 to P4.9 are ticked, each with a stamp that includes the browser tests;
`RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; nothing under `src/app/` or `src/lib/office/`
and no message or email words changed; a first-come wave for one free place offers 5 casuals by
the ranking, not everyone; no automatic reply to a text, WhatsApp or voicemail goes out by text
unless the firm switches it on (a call's login link is the login page's answer: Dylan,
2026-10-27); the tests hold at 2,000 casuals, 1,000 messages and 2,000 reminders;
`docs/architecture.md`'s scale line names the target; the `claims-auditor` checks the phase
against this line.

### P5 — The connector: the ops portal's API first, AXLR8 directly later (attended; S, A, T, M, R, UI; go-ahead for the framework: Dylan, 2026-10-29)

**Go-ahead, 2026-10-29** (Dylan, "just finish it all"): the framework and the secret store against a
made-up portal, as boxed tasks here when the build starts. The real connector waits for the
portal's API docs and a test copy (`docs/discovery-axlr8.md` §5), and the signed agreement and DPA
before any real data flows (golden rule 7); the casual's new words go to Dylan first, and the sync
card and Needs attention items after the UI chat's Phase 24.

The framework's tasks (a made-up portal, `src/lib/connector/`, stands in for the real one: our own
field names, never AXLR8's or the portal's; its transport refused under `NODE_ENV=test`). A
connector's sessions are the firm's planner's (source `api`, `cancel_via` and `booked_via` `api`),
so the office already reads them as "From your planner" and no new words are needed:

- [x] The secret store (S, A, T): a `firm_secrets` table the app role has no rights on, written only
      by an owner command (`npm run firm:secret`, the value read from standard input, never an
      argument), read only through an owner-run function the jobs role alone may call, each value
      AES-256-GCM under `SECRETS_KEY` (the worker's and the owner command's settings, never the web
      app's) with its firm and name bound in; the worker reads it on a jobs-role connection of its
      own. Tests: the app and web roles can't read it, another firm's secret never decrypts, a
      wrong key fails closed, the web's settings refuse the key (P5.1)
- [x] A connector source and its caller (S, T): `roster_sources` takes a `connector` kind (its
      base address and which connector, no secret), one enabled source per firm as today; a
      `connector` caller in `src/lib/roster/firm-caller.ts`, allowed while its source is enabled,
      logged like the planner's; the planner API's session functions
      (`src/lib/integrations/sessions.ts`) take either caller, so a connector's sessions go through
      exactly the planner's rules. Tests: a connector's session made, changed, moved and cancelled
      as the planner's; a source switched off can change nothing (P5.2)
- [x] The source's webhooks in (A, M): `POST /api/webhooks/connector/{source id}` checks the
      signature (HMAC-SHA256 with a secret we issue the source, derived from `INTEGRATIONS_SECRET`
      and its id like the planner's webhook secret and never stored: the web app can't read the
      secret store, P5.1's review; a portal that insists on its own secret is the real connector's
      ADR), stores one row per event id (unique per source), queues a job in the same transaction
      and answers 200 fast; the job fetches the changed record from the source's API rather than
      trusting the webhook's body, and applies it (P5.2's sessions; staff through
      `upsertWorker()`); an owner command (`npm run firm:connector`: connect a source, switch it
      off, show it and the webhook secret to give the firm's system, each logged as a settings
      change) like the sheet's. Tests: a bad or missing signature 403 and nothing stored, the same
      event twice stored once, a fetch that fails retried, nothing from the body trusted (P5.3)
- [x] The reconcile pull (jobs): a tick like the Sheets sync's (lease per source, back-off on
      failure; never holding the source's row while it applies a record, since each change takes
      that row for share: P5.2's review), sessions in the next 48 hours every 15 minutes and
      everything else nightly, each record applied as a webhook's is, only changes logged; sessions
      come in hidden from casuals (the shadow cycle); the founder's alert and `firm:check` name a
      failing connector as one, not a rota sheet. Tests: a lost webhook caught by the pull, two
      pulls at once one run, a failing source backs off (P5.4)
- [x] Bookings from the source (R): who's booked in the source mirrored through the three-way
      merge (`src/lib/roster/sheets/merge.ts`), a booking made there run through the rules like an
      office placement (refused: logged for the office, once, not booked), never cancelling a
      confirmed booking on its own; a cancellation made in the source cancelled here with notice
      hours from its own time only when it belongs to that booking and falls since the source was
      last read, else the reading that favours the casual, the evidence recorded; while a firm's
      planner is a connector, people can't book or cancel its sessions in ShiftDesk (`needs_approval`:
      the firm's system holds who's booked). Tests: each case, raced reads, a booking the system
      stops listing, people refused (P5.5). **Narrowed, 2026-10-29** (the build; for Dylan to
      confirm): a booking made in ShiftDesk "held as confirming, sent to the source, then confirmed
      or released" waits for a system that takes writes (the real portal's API is unknown) and for
      the casual's words ("We're confirming your place", "That place has just gone"), which come
      with the UI after the UI chat. In its place, no read-only plug (`canWrite` false): while the
      firm's planner is a connector, `bookShift()` and `cancelBooking()` answer `needs_approval`
      for the sessions it reads (the office may still cancel a booking the system no longer
      lists), so its sessions come in hidden and are booked in the firm's system. The Tests line's
      "raced bookings" and "the source down" became raced reads (two at once, and an older read
      after a newer one) and a refused change beside a cancellation; a source that's down is the
      events' and the pull's tests (nothing is read, so nothing changes). A cancellation time with
      no zone reads as none (from the read), not as Europe/London time. A casual who tries to book
      or cancel one of these sessions sees a plain error until their words are agreed (Parking
      lot).

A firm's planner is its API key or a connector, never both (P5.2's review: both would write the
same sessions by the same refs): while a key is live, the connector changes nothing, and
`firm:connector` won't connect one beside a key (Dylan to confirm; the key, already in use, wins).
After the UI chat: the office's Integrations card and dashboard name a connector as the planner
(`plannerLink`, `src/lib/office/integrations.ts`, counts a live key or a sheet today), with the
sync card.

Done when (the framework): P5.1 to P5.5 are ticked, each with a stamp that includes the browser
tests; `RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; no test reaches a real source; nothing
under `src/app/` changes but the new webhook route; no casual-facing words are new; the
`claims-auditor` checks the framework against this line. The real connector, its words ("That
place has just gone", "We're confirming your place") and its office card come after.

The framework and the secret store now, against a made-up system; the first real connector, the
ops portal's API, once its shape is known (`docs/discovery-axlr8.md` §4); AXLR8 directly when it
can be asked. Under ADR-026 (`docs/decisions.md`, accepted 2026-10-26). Where the bullets below say
AXLR8, read "the source": the ops portal takes bookings and passes them on to AXLR8 (answer 4.P2),
and the office's "Enter in AXLR8" list is the fallback for when the portal is down or slow.

- A secret store, shared later with the text system's keys: a table the app role has no rights on,
  written only by an owner script, read through an owner-run function only the jobs role may call,
  encrypted (AES-GCM) with a key only the worker's settings hold. `DATABASE_JOBS_URL` is the
  worker's (and the one-off migrate and owner containers'), never the web app's; today the worker
  uses it for pg-boss only and does firm work on `DATABASE_URL`, so the connector opens a second,
  jobs-role connection for that one read.
- A new source table and source value (`roster_sources` takes only Sheets): added to the `shifts`,
  `shift_events` and `cancel_via` checks, and a "connector" caller in `src/lib/roster/firm-caller.ts`.
- Reuse: the Sheets tick, lease and cadence (`src/lib/roster/sheets/jobs.ts`, `cadence.ts`,
  `sync.ts`), the pure three-way merge `mergeHolders()` (`src/lib/roster/sheets/merge.ts`),
  `upsertWorker()`, `recheckHolders()`, `markUrgentAfterDropout()`, `retryAborted()`, the Gate B check
  (`src/lib/imports/gate-b.ts`), and the planner API's own functions for booked sessions
  (`src/lib/integrations/sessions.ts`), never a second copy.
- The source's webhooks in (the portal sends changes as they happen: answer 4.P3), as a provider
  webhook under golden rule 3: a new route, named for "a connector" and never for the firm, checks
  the signature, stores one row per event id (unique), queues a job and answers 200 fast; the job
  fetches the changed record from the source's API rather than trusting the webhook's body alone,
  and applies it through the same mirror and merge. Modelled on the shifts line's webhook
  (`src/lib/inbound/webhook.ts`, `twilio-signature.ts`, `receive.ts`). How the portal signs its
  webhooks and ids its events: `docs/discovery-axlr8.md` §5.
- A reconcile pull as the backstop, in case a webhook is lost, as jobs in the worker, never in a
  request (like the Sheets sync): sessions in the next 48 hours every 15 minutes, everything else
  nightly; one transaction per event; only syncs that changed something are logged (else up to about
  100 log rows a day per firm for the 15-minute pull alone). Sessions come in hidden from casuals,
  which gives the shadow cycle.
- Never booked twice: a casual is never told "Booked" unless AXLR8 accepted it or the office handed
  that place to ShiftDesk. The portal takes writes (answer 4.P2), so: hold the place as
  "confirming" (`bookShift()` in `src/lib/roster/book.ts`, taken by the same conditional `UPDATE`
  as any booking, golden rule 4), book through the portal's API outside any transaction (a limit of
  a few seconds, set once its API is known), then confirm or release ("That place has just gone"),
  or "We're confirming your place" while a job finishes it; re-read, and release ours if the source
  went over the count. When the portal is down or slow, or for a source that's read-only: a new read-only plug
  (`canWrite` false, so `assign` answers `needs_approval`: `src/lib/roster/plug.ts`), with
  `plugFor()` in `src/lib/roster/book.ts` taught the new source (today every source but Sheets
  gets the native plug): "Take shift" becomes a request and the office gets an "Enter in AXLR8"
  list; for urgent shifts the office hands a few places to ShiftDesk to take at once. Either way, a
  booking added in AXLR8 runs the rules like an office placement and, if refused (an expired licence),
  raises an urgent Needs attention item instead of booking; going over the count is a conflict to
  sort out; a confirmed booking is never cancelled automatically.
- Notice hours for cancellations made in AXLR8: its own cancelled time only if it belongs to that
  booking and falls between the last poll and now; the evidence used is recorded; where uncertain,
  the reading that favours the casual (less notice for a firm's cancellation, more for a casual's);
  times without a zone read in Europe/London, the doubled hour after the clocks change flagged.
- Tests against a made-up AXLR8 server; the real transport refused under `NODE_ENV=test` and pinned
  in `scripts/invariants.sh`. A sync status card on Integrations and Needs attention items for
  conflicts (mock-ups first).

### P6 — Attendance and pay lines from the ops portal's API (it has one: answer O1; S, M, UI)

- Attendance in: worked and no-show onto bookings (`src/lib/roster/attendance.ts`), so the office
  stops marking them by hand. A no-show is still never a strike.
- Pay lines in: one per casual per fortnightly cycle into `pay_records` (a new source value, S), so
  the casual's pay facts and pay day come from the firm's own figures (golden rule 9).
- Not "not checked in, so start an offer wave": a started shift can't be offered
  (`src/lib/rules/eligibility.ts`, `src/lib/offers/waves.ts`). Instead a "Still coming?" button on
  the existing 2-hour reminder, so a dropout shows while the place can still be filled (M, UI).

### P7 — The staffing email inbox (Stage 2 brought forward, decided 2026-10-26; S, A, T, M, UI; go-ahead for the back end: Dylan, 2026-10-29)

**Go-ahead, 2026-10-29** (Dylan, "just finish it all"): the back end against a made-up provider, as
boxed tasks here when the build starts. Live use waits for an email provider account (its short ADR
is Dylan's choice) and the firm's IT allowing the Microsoft 365 forward; the office's summary
email's words go to Dylan first, and the AI-drafted reply on Enquiries after the UI chat's Phase 24.

- The firm's staffing mailbox (Microsoft 365) auto-forwards to its own address at a UK or EU email
  provider with signed inbound webhooks (Microsoft 365 blocks forwarding to outside addresses by
  default: the firm's IT allows it for that one address) (no AWS: ADR-021; the provider in a short ADR), to the planned
  `POST /api/webhooks/email` (`docs/api-and-jobs.md`). The firm is found by the address, like
  `resolveFirmByLine()`; one row per Message-ID and the job queued in the same transaction (golden
  rule 3). The messages table gains an email channel (today only WhatsApp, SMS and voice, and a
  number is required: `src/lib/db/schema/messages.ts`).
- Quoted history stripped before sorting; no attachments at first (sick notes are health data);
  mail that isn't from a known casual (clients, venues, applicants) is passed to the office without
  its words stored.
- The AI only sorts (`sortMessage()`, `src/lib/ai/classify-message.ts`). Every action goes through a
  link sent to the casual's known number or email, never on the sender's word alone (a sender can be
  faked); pay disputes go to the payroll digest (golden rule 9); the rest goes to Enquiries with an
  AI-drafted reply the office approves before it's sent, and a summary every 3 hours. Replies are
  signed "[Firm name] Shift Team" (golden rule 8).

The back end (the build, 2026-10-29), against a made-up provider. One change to the outline above:
inbound emails get a table of their own (`inbound_emails`) rather than an email channel on
`messages`, for now: the office's Enquiries reads every `messages` row and names its channel
(`src/lib/office/enquiries.ts`, `CHANNEL_WORDS`), so an email there would show broken until the
office's screens learn email, which is the UI chat's (after Phase 24). Enquiries reads them in
with that change. Nothing here sends anything: every reply, link and summary waits for its words.
And the sorting (P7.4) waits too: each email handled is logged (golden rule 5), and every action
logged needs the office's words for it in the log (`src/lib/office/event-words.ts`, its groups in
`log-types.ts`, which a test holds to), the UI chat's for now; until then the emails are stored,
ready, and nothing works on them (no job is queued for a handler that doesn't exist yet: P7.4
queues the ones waiting).

- [x] The firm's inbox and its emails (S, T): a firm's inbound address (`firms.inbox_address`,
      unique, lower case; set, changed and cleared only by an owner command, `npm run
      firm:inbox`, logged as a settings change, as `firm:line`), found before a firm is known by an
      owner-run function (`resolveFirmByInbox()`, as `resolveFirmByLine()`); `inbound_emails`, one
      row per Message-ID in the firm, the casual it's from (by their email here), the addresses,
      and the subject and text only for a known casual's; with `firm_id`, RLS, `TABLE_ACCESS`,
      isolation fixtures, the worker's export and erasure, and the retention purge. Tests: another
      firm's emails unreadable, a second address taken refused, a casual's export and erasure
      include theirs (P7.1)
- [x] The provider's webhook in (A, M): `POST /api/webhooks/email` for the made-up provider (its
      signing secret in the web's settings, `EMAIL_INBOUND_SECRET`, a Standard Webhooks `whsec_`
      key; unset, the webhook answers 503; a real provider comes with its ADR), checked as the
      connector's (Standard Webhooks signature, a bounded body, JSON and UTF-8 only); the firm
      found by the address it was sent to; one row per Message-ID (golden rule 3; its job comes
      with P7.4); 200 fast. Tests: a bad or missing signature 403 and nothing stored, the same
      Message-ID twice stored once, an address no firm has stores nothing, no secret 503 (P7.2)
- [x] Before anything is stored (M): quoted history and signatures taken off
      (`src/lib/email/prepare.ts`, pure: "On … wrote:", "-----Original Message-----", Outlook's
      "From: … Sent:" block, `>` lines, "-- "), the text capped; attachments never kept (only how
      many); mail that isn't from a known casual stored without its subject or words. Tests: each
      quoting style, a reply above and below the quote, nothing left of a forwarded thread, an
      unknown sender's words never in the database (P7.3)
- [ ] Sorting, held for the office (M; waits for the office's log words for `email.received`, with
      the UI chat): the `inbound-email` job (queued with each stored email, and once for those
      stored before it: one older than a few hours goes to the office as arrived before the
      inbox was answered, never sorted as if it were new, since a stale "cancel me" isn't one; and
      any still unhandled at the firm's message retention age is purged as the rest are) sorts a
      known casual's text as the
      shifts line does (a keyword, else the AI's label outside any transaction:
      `sortMessage()`; the AI only sorts, code decides), then claims it once (`handled_at`, how it
      was handled, what they asked) and logs `email.received` (labels and ids only); nothing is
      sent, as the shifts line with automatic replies off (P4.7); a pay question is marked pay
      and never answered (golden rule 9); an unknown sender's handled as unknown. Tests: each
      label, the AI down, the same job twice handled once, nothing sent (P7.4)
- [ ] Waits for Dylan (words) and the UI chat (screens): the casual's answer by a link sent to
      their known address (never on the sender's word alone), a pay question's link to raise it
      in the app (so it reaches the payroll digest), the office's 3-hourly summary email, and
      Enquiries showing emails with the AI-drafted reply the office approves; their words go in
      `docs/messaging-templates.md` first (P7.5)

Done when (the back end): P7.1 to P7.3 are ticked, each with a stamp that includes the browser
tests; `RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; no test reaches a real provider; nothing
under `src/app/` changes but the new webhook route; nothing is sent to anyone.

### P8 — The in-app chat (proposed 2026-10-26; a mock-up first, after the UI chat merges; S, M, UI)

Dylan, 2026-10-26: "it would be an internal chat on the app not texts being sent out". Casuals
message the office inside the app, and the shifts line's sorting (keywords, then the AI's label,
then the office: `src/lib/inbound/reply.ts`, `sortMessage()` in `src/lib/ai/classify-message.ts`)
answers there at once with the same fixed replies and links, never by text; the office answers in
Enquiries. Free (no 20p a text), logged like every message (golden rule 5), pay disputes still to
payroll (golden rule 9), replies signed "[Firm name] Shift Team" (golden rule 8).

- An `app` channel for `messages` (today only WhatsApp, SMS and voice, and a number is required:
  `src/lib/db/schema/messages.ts`; S).
- The casual's chat screen and the office's thread in Enquiries: mock-ups first (UI).
- App notifications for a reply (`src/lib/notify`).
- The guards that P4.7 doesn't need yet: at most 5 automatic replies an hour per casual ("Connecting
  the firm's systems" 11), and no automatic reply to a message carrying our own "Automatic reply."
  line, so an echo can't loop.

## Phase 25 — The screens for P2 to P8 (go-ahead: Dylan, 2026-10-30, "All of it, in order"; this session takes over the UI from the UI chat, which has finished; UI)

The screen halves the phases above left for after the UI chat's Phase 24, in this order. Each task
starts with a mock-up (before and after at 390px and at 1280px with 150% scaling, made with the UI
skills in `.claude/skills/`) and is built only once Dylan approves it; its new words go in
`docs/screens.md` or `docs/messaging-templates.md` first; the `guardrails-reviewer` runs where it
touches schema, auth, tenancy, messaging or rules; `/close-task` ticks it.

- [x] P2.7: the login page, the Pay code step, Help and the profile's "How we reach you" say how
      links and codes really go: by WhatsApp or text while there's a text sender (today's words),
      by email with `login_by_email` on, and with neither, that they can't be sent (no form, no code
      button) instead of promising one. The web app reads only whether there's a text sender
      (`MESSAGING_TRANSPORT`, as it reads `AI_TRANSPORT`); the job still decides each send
      (`loginChannel()`, `src/lib/auth/login-channel.ts`). Then the setting's help text stops saying
      to leave it off. Mock-up: https://claude.ai/artifact/Ai4kBdJ8rBvEy2YjBjZ1mX, approved by Dylan
      on 2026-10-30 (build as shown; with nothing to send, no login form; Profile shows the address;
      a browser-test run with no text sender). Tests: each way's words, no email held (Pay and
      Profile), a browser test that logs in and opens Pay by email (M, A) (25.1)
- [ ] P3's screens: the list under P3's "After the UI chat's Phase 24 merges" (the pay day from the
      firm's calendar, the name map's Needs attention items, "you need A or B", who asked, the
      strike sentences reading the strikes switch, the one-of chips); a mock-up for the casual's
      screens first, then one for the office's (Dylan, 2026-10-30). The casual's mock-up
      (https://claude.ai/artifact/Wf4qCNqTTDq5Ytq3TryAJw), approved by Dylan on 2026-10-30: build as
      shown; a fortnight's pay row gives its dates; with strikes off, Help leaves its strikes
      section out. The sheet sync's unreadable and
      skipped names are stored per firm (a small table: `firm_id`, RLS, a `TABLE_ACCESS` entry,
      isolation fixtures; S, T), so Needs attention can list each one (Dylan, 2026-10-30) (25.2)
- [ ] P4's office half: the list under P4's "After the UI chat's work is merged" (the layout's reads
      in one transaction, the dashboard's capped lists, why a reply was held, the stop after 25
      offers, one combined email past the 5) (25.3)
- [ ] P5's card: the Integrations card and the dashboard name a connector as the planner, with its
      sync card (`plannerLink`, `src/lib/office/integrations.ts`) (25.4)
- [ ] P7.4 and P7.5: the inbox's sorting once Dylan approves the office log's words, then Enquiries
      showing emails with the AI-drafted reply the office approves, the casual's answer by a link to
      their known address, the pay question's link and the 3-hourly summary, their words first (25.5)
- [ ] P8: the in-app chat: the casual's chat screen and the office's thread in Enquiries (mock-ups
      first), the `app` channel, notifications for a reply, and its guards (25.6)

Done when: 25.1 to 25.6 are ticked, each naming its mock-up and the date Dylan approved it, each
with a stamp that includes the browser tests; `RUN_E2E=1 ./scripts/verify.sh` prints VERIFIED; no
casual-facing words but those in `docs/screens.md` and `docs/messaging-templates.md`; with no text
sender, no casual screen names WhatsApp or texts; the `claims-auditor` checks the phase against
this line.

## Stage 2 (after 3 paying firms) — not now

- AI email inbox: firm forwards shifts inbox → the email provider's inbound webhook → classify
  (Haiku) → draft reply → approve mode → summaries every 3 hours. **Brought forward** (Dylan,
  2026-10-26): now proposal P7 ("Connecting the firm's systems" 3)
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

## Decisions waiting for Dylan

Moved to `docs/plan/decisions-waiting.md` on 2026-10-29 (P1.2), word for word: every decision still
waiting, and the ones taken, by topic ("Connecting the firm's systems" and the rest). New ones go
there.

## Parking lot

Moved to `docs/plan/parking-lot.md` on 2026-10-29 (P1.2), word for word. New ideas and anything
deferred go there (golden rule 10).

## Hours log

Moved to `docs/plan/hours-log.md` on 2026-10-29 (P1.2), word for word; `/log-hours` and `/overnight`
add their rows there.
