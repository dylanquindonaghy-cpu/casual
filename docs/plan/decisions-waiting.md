# Decisions waiting for Dylan

Moved from `PLAN.md` word for word on 2026-10-29 (P1.2), where its heading now points here. Line
numbers that older docs give for it are `PLAN.md`'s as it was then.

## Decisions waiting for Dylan

Every decision still waiting for you, listed once, grouped (Phase 10 task 18, from this file, the
decision tables in `docs/overnight-log.md`, `docs/compliance.md`, `docs/privacy-notice.md` and
`docs/decisions.md`). **Default now** is what the app does today. A row that starts with a bold
**When …** or **Before …** has to be settled by then; any other can stay as it is until you want it
changed. Rows added for Phase 12 on 2026-10-06 (`docs/office-v2.md`, its D and S numbers in
brackets) were settled the same day: you took the recommended defaults (D1–D4, D7 and D8, built
lean: see Phase 12), replaced D5 with a planner API and webhooks, deferred D6, and approved S2 to
S10 (S1 was already approved). A settled row says **Decided**, **Approved**, **Replaced** or
**Deferred**, and what Phase 12 builds. S11 ("How the build is run" 19) was approved on
2026-10-06. **Where** says where the details are (Parking lot items are in this file; "log" is
`docs/overnight-log.md`). To decide one, tell Claude: it changes the code if needed, then strikes
the line here. (The old way of finding these, `grep "Dylan to" PLAN.md`, misses many: use this
list.) After the decisions, a short table of checks and to-dos that aren't choices.

**Decided on 2026-10-16** (Dylan, in chat): How the build is run 1 to 4 approved (13.1); Legal
6 no; Messages 11 and 17 and Office 10 as their rows say. From the Parking lot: travel areas
switched on per firm (13.4); resourcers keep seeing pay messages' words in Enquiries; a personal
reply's log entry keeps the travel minutes; the hand-written TravelTime answers stand until the live
check. Every other row that confirms what's built stays as it is for now ("keep, and revisit with a
pilot firm"): rows tagged **Before a pilot** still need that look then.

**Decided on 2026-10-19** (Dylan, in chat): "we wont need whatsapp or twillio notifications will
come through our own text system and app". No WhatsApp and no Twilio: casuals are reached by text,
through the firm's own text system, and by the app's notifications (web push). Phase 15 (proposed,
waiting for the go-ahead) has the work. Rows tagged **Before submitting the WhatsApp templates**
and **When you create the accounts** that name Twilio or WhatsApp need a fresh look against the
text system once its details are known; Messages 2 is decided (notification first: P2.4).

**Decided on 2026-10-26** (Dylan, in chat): "go with your recommendations on the 8 decisions".
"Connecting the firm's systems" 1 to 8 take Claude's recommendations: a pay calendar per firm
(replacing D8, Pay 10), ADR-026's pull connector (accepted), the email inbox brought forward from
Stage 2 (proposal P7), casuals' login by email as a stop-gap, a cap on each offer wave, who asked
for each cancellation with a strikes switch per firm, the CRM's Casual sessions only, and a CRM
booking the rules refuse flagged, never booked. Later the same day, 9: ShiftDesk sends the texts
about its own bookings; and 10 to 14, with the go-ahead for P4's back end: waves of 5 per free
place (at most 50), no automatic replies by text (the in-app chat, P8, instead), 5 unknown-number
emails an hour, texts only for offers, confirmations and reminders (push first: Messages 2), and
the database's limits inside `withFirm`. Each is built as its proposal (P1 to P8), once that
proposal gets the go-ahead.

**When each one matters** (every row with that tag):
1. **Before any real data** (the pilot firm's staff, even a check of a file): Legal 1, 2, 4 and 6;
   Checks 1, 20 and 21.
2. **When you create the accounts:** Messages 20, 23, 24 and 25; Deploy 2 and 8; Checks 2 and 3.
3. **Before submitting the WhatsApp templates** (Meta's approval is the slow step; changing approved
   words means submitting again): Messages 11 to 17 and 29.
4. **Before the first real import:** Sheets 11; Checks 9.
5. **Before a pilot:** Data 1, 3, 6, 7, 8, 13 and 21; Rules 3 and 8 (a security firm); Messages 1
   and 3; Pay 4; Office 10; Product 2 and 7; Checks 6, 7, 8, 14 and 15.
6. **Before any Sheets firm** (if the pilot keeps its rota in a Google Sheet): Sheets 1 to 3.
7. **When you deploy:** Deploy 1 and 9; Checks 4.
8. **Before any firm uses its own address:** Checks 5.
9. **Before the pilot's data is a year old:** Data 2.
10. **Before the Phase 12 task the row names** (`docs/office-v2.md`): Checks 18.
11. **Before any Northern Ireland firm:** Checks 16.

### Legal and compliance

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before any real data:** a solicitor reads the terms, the DPA and `docs/privacy-notice.md` (or use templates; about £500–£1,500). Ask them too about health details workers may type ("I'm unwell": Data 11). Give the business's legal name for the notice | Nothing reviewed; no real data is saved on a live server until a firm's signing is recorded (`firm:agreement`) | compliance.md; privacy-notice.md; Parking lot "Send the pilot firm its privacy notice wording" |
| 2 | **Before any real data:** the sub-processors' DPAs and UK transfer terms: Twilio, Meta, the hosting provider, the email provider, Anthropic (once AI is switched on: check where it processes requests, since its region option doesn't cover every model; ADR-021), TravelTime and postcodes.io (Checks 14), Google (Sheets firms only); the browser push services once push is live; ElevenLabs only if ever used | Listed in the docs only; nothing signed | compliance.md "Sub-processors"; privacy-notice.md |
| 3 | A limited company, insurance (professional indemnity, cyber) and an accountant, once a pilot says yes | Not done | compliance.md; business.md |
| 4 | **Before any real data:** the pilot agreement: you own the software and they license it; price and term; the DPA; exclusivity; naming them as a reference. Check your own employment contract (who owns what you make, outside work) first | Not agreed | go-to-market.md |
| 5 | Short notice in the notice report until the 2027 rules are final (and any compensation rules) | 48 hours unless the owner sets the firm's `short_notice_threshold_hours` | compliance.md; Parking lot "Notice report" items |
| 6 | **Before any real data:** may a real staff file be checked (a dry run, nothing saved) on the live server before the agreement is recorded? It's still reading personal data, from the pilot firm's files (golden rule 7). Demo firms on the live server would need a made-up signing date | **Decided** (Dylan, 2026-10-16): no. A real staff file isn't read on the live server, even as a dry run, until the firm's agreement is recorded | Parking lot "Dylan to confirm (Gate B…)"; log, Phase 10 task 11 |
| 7 | Notice for a cancellation phoned in counts from when the office types it, not when the worker rang; and the office can't record a cancellation as the worker's own (always the firm's, with notice) | Typed-in time; always the firm's | Parking lot "Firm-initiated changes follow-ups"; log, Phase 5 |
| 8 | A message that may not have arrived (sent, then its record failed) still counts in the notice evidence, marked "not confirmed" | Counted and marked | log, Phase 10 task 3 |
| 9 | Workers can't cancel once a shift starts; the office can until it ends (negative notice recorded, the place not reopened) | As stated | log, Phase 3 |
| 10 | Sending someone home part-way is a curtailment with notice, not a cancellation | As stated | Parking lot "Dylan to confirm: sending someone home…" |
| 11 | A move is refused when a booked worker fails a check the office can't override (or ask each worker to confirm instead) | Refused and logged | Parking lot "Firm-initiated changes follow-ups" |
| 12 | The fixed list of reasons for the office's changes; "Another reason" has no detail | 6 reasons | `src/lib/roster/firm-reasons.ts`; log, Phase 5 |
| 13 | A change notice goes at night (urgent) when the shift starts within the urgent window or is under way; otherwise it waits for the morning | As stated | Parking lot "Firm-initiated changes follow-ups" |
| 14 | The notice report's CSV: at most 20,000 rows; downloads aren't logged | As stated | log, Phase 5 notice report |
| 15 | What an AI may see: the pay summary gets a group's facts only; the message sorter gets the worker's own words and may only return a label | No AI connected (Phase 12's Anthropic client is off unless `AI_TRANSPORT=anthropic`) | log, Phases 6 and 7; "Connect the Anthropic API" |
| 16 | The strike rules (D4): the notice that avoids a strike, the exemptions, how long a strike counts and is kept, when the office is told, and health reasons | **Decided** (Dylan, 2026-10-06: recommended default, built lean). Phase 12 builds: 48 hours' notice (`strikes.notice_hours`, separate from Legal 5's threshold), measured at the cancellation; no strike when the office, the planner or the rota sheet cancelled, on a booking the office made ("Assign", including over a rest or hours check), or after the office or the planner changed the session; "I'm unwell" or "Family or caring" still gets a strike, flagged for a person to review; in emails, PDFs, CSVs and webhooks every casual's reason reads "Casual's own reason (see ShiftDesk)"; a strike counts 90 days and its row is deleted at 12 months (not during a hold), its log entries kept as long as the action log (Data 2); nothing happens automatically; casuals see their strikes and can tell us what happened; a DPIA before a real firm uses strikes. Cut: the 15-minute grace and the review flag for a session taken inside 48 hours (the office withdraws a mis-tap's strike), notice counted from a first message, the alert at 3 strikes and the strike messages (Parking lot "Phase 12 cuts") | `docs/office-v2.md` §3.5, §6.2; Checks 15 |

### Data and retention (GDPR)

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before a pilot:** the keep-times (they go into the firm's privacy notice): messages 90 days; a closed request's words and the office's override reason 365 days; a firm may choose 30 days to 6 years; one hold covers the whole firm | As stated | Parking lot "Dylan to confirm (retention…)"; compliance.md |
| 2 | **Before the pilot's data is a year old:** purge year-old action log, requests and offers (it means changing the log's "never deleted" protection on purpose), or keep them longer once the 2027 rules say how long | Never purged | Parking lot "GDPR follow-ups"; ADR-020 |
| 3 | **Before a pilot:** how long records are kept after someone leaves (the notice's "[period]"); it mustn't promise less than is kept | Kept with no end date | privacy-notice.md |
| 4 | Typed text with no schedule: pay query details, payroll's notes, "Something else: …" cancellation notes, the office's answers. Purge them after a time? | Kept until that worker is deleted | Parking lot "GDPR follow-ups" |
| 5 | Deleting a worker leaves what other people wrote that names them (a colleague's swap request) | Unchanged | Parking lot "GDPR follow-ups"; compliance.md |
| 6 | **Before a pilot:** deleting a worker keeps their pay lines (anonymous) and their pay queries with the text cleared | As stated | Parking lot "GDPR follow-ups" |
| 7 | **Before a pilot:** deleting a worker deletes their licence and card records; security firms may have to keep screening records (BS 7858, SIA) | Deleted | Parking lot "GDPR follow-ups"; privacy-notice.md |
| 8 | **Before a pilot:** only admins delete, and not while the worker is booked on a shift that hasn't ended | As stated | Parking lot "GDPR follow-ups" |
| 9 | A hold (for a dispute) also blocks an admin deleting a worker? | It doesn't; the runbook says check first | Parking lot "GDPR follow-ups" |
| 10 | The office's reason for placing someone despite a rule: free text, or fixed reason codes? | Free text, up to 500 characters, phone numbers and emails refused; on the booking, never in the log | Parking lot "Dylan to confirm: the office's override reason…" |
| 11 | A worker's cancellation reason and note ("I'm unwell" is health data): keep free text, or fixed codes only? | Quick reasons, or "Something else" with a note of up to 200 characters (no check on what's typed); on the booking, never in the log | `src/lib/portal/cancel-reasons.ts`; log, Phase 3 |
| 12 | A swap request's "Who could take it?" is free text that can name a colleague | As stated | Parking lot "Dylan to confirm: a swap request's…" |
| 13 | **Before a pilot:** Twilio keeps its own copies of messages, recordings and transcriptions: a job to delete them (with the Twilio sender), and until then don't promise "90 days" | Nothing deletes anything at Twilio (not connected) | "Connect Twilio" step 10; privacy-notice.md notes |
| 14 | A firm's logo is loaded from its own website (which sees workers' internet addresses), or uploaded to us | Loaded from the firm's site, no referrer | compliance.md; privacy-notice.md |
| 15 | The phone keeps an offline copy of My shifts (with shift instructions) for up to 14 days | As stated | log, Phase 3 and Phase 10 task 12 |
| 16 | Resourcers see the "Data requests and deletion" group in the action log | Visible | Parking lot "GDPR follow-ups" |
| 17 | A deleted worker's sheet staff ID stays on shifts still ahead (the sheet merge needs it) | As stated | log, Phase 10 task 13 |
| 18 | The firm export is one JSON file of every firm table; every export is logged | As stated (Phase 12 leaves upload image bytes out of it: each image is its own download, 12F.2) | log, Phase 8 GDPR |
| 19 | A shift's site and address show to every worker in the firm; its instructions only to those booked | As stated | log, Phase 3; Phase 12's S2 (approved 2026-10-06) shows meeting point and uniform to every casual who can see the session |
| 20 | Where staff photos and certificate images are kept, and how often a photo is renewed (D3) | **Decided** (Dylan, 2026-10-06: recommended default). Phase 12 builds: in Postgres (S7), re-encoded, 1 MB at most, never face-matched or read by AI; only items the office has checked count; a photo renewed every 3 years (`photo.renewal_months` 36; the mock-up said 2), "Due soon" 30 days before; a replaced photo deleted 30 days after the new one is approved, rejected uploads after 30 days | `docs/office-v2.md` §5.5 |
| 21 | **Before a pilot:** the travel area's personal data | **Decided** (Dylan, 2026-10-06: recommended default); still to write before it's switched on for a real firm: the legitimate-interests balancing test and the DPIA (`docs/dpia-travel.md`, Phase 12 task 12G.1). Phase 12 builds: legitimate interests (not consent); the postcode and its central point only (no house number, GPS or movement history); the office sees the district only, and replies say "your home area"; never in the action log; TravelTime gets coordinates and meaningless ids, postcodes.io a postcode only; estimates purged 7 days after the session; the start point deleted when the office makes the casual inactive as "They've left" or they are erased | `docs/office-v2.md` §5.4, §6.3; Checks 14 |

### Rules, eligibility and credentials

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | The SIA "applied" allowance (deploying staff whose licence is in progress, reported as up to 15%): confirm the rule; whether close protection counts; a night shift counts by its start day | 0%, and no command sets it | rules-and-credentials.md; compliance.md |
| 2 | The office may book despite "shift already started", rest, weekly hours or a day off (never a worker; names typed in a rota sheet too, except "started": Sheets 5) | As stated | Parking lot "Dylan to confirm: the office may override…" |
| 3 | **Before a pilot (a security firm):** "any of" licences: a door supervisor licence also covers guarding, so door supervisors can't take security-officer shifts today | "All of" only | Parking lot; `src/lib/rules/packs.ts` |
| 4 | The sector packs' role → licence rules; each firm gets its own editable copy | As in `packs.ts` | log, Phase 1 |
| 5 | The expiry to record for cards with no fixed validity (DBS, rail drugs and alcohol, steward refreshers) | The card's own date; none means never | rules-and-credentials.md |
| 6 | A licence counts if valid and in date for every day the shift touches; a suspended card fails | As stated | log, Phase 1 |
| 7 | My shifts' licence banner also shows cards already expired (the spec asked for "expires within 30 days") | Shows both | Parking lot "Dylan to confirm: the My shifts banner…" |
| 8 | **Before a pilot (a security firm):** a licence that lapses after someone is booked: hold the reminder and alert the office? (Deploying an unlicensed guard is an offence) | The reminder still goes, and nothing flags the booking | Parking lot (credential expiry and reminders items) |
| 9 | Expiry warnings at 30, 14 and 7 days, sent at 08:00; a Monday list to admins and resourcers | As stated | log, Phase 2 credential expiry |
| 10 | Imported licences are never marked "checked" | As stated | log, Phase 2 imports |
| 11 | Days off: from today to 180 days ahead, at most 60; marking one doesn't cancel bookings | As stated | log, Phase 3 profile |
| 12 | Fair rotation's priority window (ADR-015): a place held 15 minutes for the 4 with fewest hours | Only when a firm chooses fair rotation (default first come, first served) | Parking lot "Dylan to confirm: fair rotation…"; decisions.md |
| 13 | No-shows push a worker back in fair rotation? | No (a no-show lowers their hours, so moves them up) | Parking lot "Marking who worked follow-ups" |
| 14 | How a casual's travel area limits what they see and are offered (D2). A preference, not a rules-engine check | **Decided** (Dylan, 2026-10-06: recommended default, built lean). Phase 12 builds: a hard filter on open shifts, the urgent board, Home, offer waves and shifts-line replies; in the area if any way they travel gets there within their limit (30, 45, 60 or 90 minutes; the firm's default 45); no "a bit further" for urgent shifts; a shift opened from a direct link stays bookable; an unknown distance is shown, labelled, and still offered; no home area: everything shown, with a prompt; the office may still offer outside a casual's area by hand. Cut: travel time as an offer-wave tie-breaker and the office's outside-area warning (Parking lot "Phase 12 cuts") | `docs/office-v2.md` §4.3, §5.4; Data 21 |
| 15 | Right to work: enforce it in the rules (every role needs a right-to-work check: a rules-data change through the pack apply, with checks that have no expiry), or keep it as a status only | **Decided** (Dylan, 2026-10-06: "go with your recommendations"): a status only. Not enforced: no role needs `RTW` (`src/lib/rules/packs.ts:36`, `69-72`), so a casual with no check can be booked. Phase 12 shows "Not checked yet: ask the office" (not "you can't be booked", which would be untrue). To enforce it, tell Claude | `docs/office-v2.md` §4.6 |

### Offers, reminders and messages

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before a pilot:** urgent messages go during quiet hours (22:00–07:00) unless a firm turns it off; the spec reads as "if the firm allows it" | Urgent messages go at night | `src/lib/rules/quiet-hours.ts`; log, Phase 4 (never flagged before) |
| 2 | Notifications by WhatsApp or text **and** push, or push first to save the WhatsApp fee (ADR-003 said push first). 2026-10-26: the pilot firm's texts cost about 20p each, so Claude recommends push first, a text only when a phone has no notifications on. **Decided** (Dylan, 2026-10-26): push first, a text only when a phone has no notifications on ("Connecting the firm's systems" 13) | Both, until built (Phase 15) | Parking lot "Dylan to confirm: notifications go by WhatsApp…" |
| 3 | **Before a pilot:** first come, first served sends the urgent offer to every eligible worker at once, not "the best 3–5" | Everyone at once. **Decided** (Dylan, 2026-10-26): a cap on each wave ("Connecting the firm's systems" 5; built in P4) | Parking lot "Offer waves follow-ups" |
| 4 | The 3-offers-a-day cap: fixed, or per firm; urgent offers count towards it | Fixed; urgent ones count | Parking lot (offer cap items) |
| 5 | Re-offer to workers whose earlier offers became "filled elsewhere" when the office reopens a shift? | No | Parking lot |
| 6 | A wave held by quiet hours past the shift's start | Stops as "started"; only the escalation tells the office | "Connect Twilio", last paragraph |
| 7 | Any cancellation that reopens a place inside the urgent window starts waves (the office's too); someone who cancelled is never offered it again. The office's "The client needs fewer staff" removes the place instead (one fewer needed, nobody offered it; a shift's last place stays) | As stated (fewer staff: since Phase 10 task 19) | log, Phase 4 and Phase 10 task 19 |
| 8 | The escalation email: 3 hours before the start, to admins and resourcers, once per shift (not per gap) | As stated | Parking lot "Offer waves follow-ups" |
| 9 | A message that fails isn't retried (at most once: lost, never doubled) | As stated | log, Phases 4 and 10 |
| 10 | Reminders at 24 hours and 2 hours, held by quiet hours (a 2-hour one before 07:00 is skipped); no opt-out | As stated | Parking lot "Shift reminders follow-ups" |
| 11 | **Before submitting the WhatsApp templates:** "Cancel in the app" in the 24-hour reminder (there's no app) | **Decided** (Dylan, 2026-10-16): "Cancel with the link". Built in 13.5 | Parking lot "Shift reminders follow-ups" |
| 12 | **Before submitting the WhatsApp templates:** texts: the sign-off adds a second text; "{day}" not "today"; short text versions of other messages; nothing limits a text's length; the office's 500-character note is about 9 texts | As stated | "Submit the WhatsApp templates" |
| 13 | **Before submitting the WhatsApp templates:** the copy written overnight, read once: `credential_expired`, the Monday list email, the "no site" versions, `shift_cancelled_by_firm`, request updates ("approved" can read as "booked"; "answered" for a question) | In `src/lib/messaging/templates.ts` and the docs | docs/messaging-templates.md; log, Phases 2–5 |
| 14 | **Before submitting the WhatsApp templates:** a worker who cancels gets only the on-screen confirmation; send the `cancellation_ack` message too (it needs its template)? | Not sent | Parking lot; log, Phase 3 |
| 15 | **Before submitting the WhatsApp templates:** Meta will probably put `login_code` in its "authentication" category: fixed wording and no sign-off, against golden rule 8 | Written with the sign-off | "Submit the WhatsApp templates"; docs/messaging-templates.md |
| 16 | **Before submitting the WhatsApp templates:** a change notice to a worker who's no longer active still carries the portal link (they can't log in): a version without it? Also check Meta accepts the office's free-text note as a variable | As stated | Parking lot; "Submit the WhatsApp templates" |
| 17 | **Before submitting the WhatsApp templates:** payroll's note goes in the WhatsApp or text itself (or "See it on your pay page": a different template) | **Decided** (Dylan, 2026-10-16): the note stays behind the pay code; the message says payroll has answered and to see the pay page. Built in 13.4 | Parking lot "Pay query status follow-ups" |
| 18 | "Offer to someone" uses the same checks as waves (no override); a failed one isn't resent | As stated | log, Phase 5 |
| 19 | The shifts line's keywords ("work" and "available" give open shifts; "shift" alone doesn't) | As stated | Parking lot "Unknown number follow-ups" |
| 20 | **When you create the accounts (Twilio):** "CANCEL" by text turns texts off (Twilio's list): drop it so "cancel" means a shift? And Twilio's own opt-out settings (Advanced Opt-Out on, its keyword list the same as ours) | Turns texts off | "Connect Twilio" step 5 |
| 21 | STOP by text turns texts off, not all contact: a worker who chose texts then gets WhatsApp instead | As stated | log, Phase 7 |
| 22 | Unknown numbers: a former worker gets no reply, a stranger gets "reply with your full name"; one reply and one email per number per 24 hours. An unknown caller gets no text back (their voicemail reaches the office) | As stated | Parking lot "Unknown number follow-ups"; log, Phase 7 |
| 23 | **When you create the accounts (Twilio):** a firm with no shifts line yet: a shared ShiftDesk number, or nothing until its line is live | No sending number set | "Connect Twilio" step 8 |
| 24 | **When you create the accounts (Twilio):** voicemail transcription: Twilio's basic one, or a better service later (not AWS: ADR-021) | Twilio's | "Connect Twilio" step 10 |
| 25 | **When you create the accounts (Meta):** service messages over 1,000 a month per number are charged (from 1 October 2026: a payment method on file or they stop); each firm needs Meta business verification (days) | Not connected | compliance.md |
| 26 | A firm may shorten its sign-off ("Acme Shift Team"), never a person's name | Allowed (checked again as each message is built: one stored that breaks the rule isn't used) | log, Phase 8 branding and Phase 10 task 19 |
| 27 | A worker the office places on a shift ("Assign") gets a `shift_confirmed` message (a billed WhatsApp, held by quiet hours unless the shift is soon); one who takes a shift themselves only sees it on screen | As stated | log, Phase 10 task 19 |
| 28 | Booking by reply number: "Reply 1 or 2 to take one", as in the approved mock-up (D6). Today every booking needs a logged-in session ("Take shift") or the office; booking because a phone number sent "1" is a new way of proving who the casual is (an auth change) | **Deferred** (Dylan, 2026-10-06: debloat; it also needs live WhatsApp). Replies say "Take one here: {link}" | `docs/office-v2.md` §5.7; Parking lot "Phase 12 cuts" |
| 29 | **Before submitting the WhatsApp templates:** Phase 12's words: changed `credential_expiring` and `credential_expired` (they point to the upload link), and "Automatic reply. Send OFFICE to reach a person." before the sign-off of every instant reply (free text, not a template). The strike messages, `photo_due`, `upload_rejected` and the travel and pay words in offers were cut on 2026-10-06 | Not built; written out in `docs/office-v2.md` §5.7 | `docs/office-v2.md` §5.7; "Submit the WhatsApp templates" |

### Rota sheets and imports

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **Before any Sheets firm:** a row deleted from the sheet, or a person who vanishes from it: a firm cancellation with notice, or a flag for the office? | Ignored | Parking lot "Before any Sheets firm goes live" |
| 2 | **Before any Sheets firm:** a booked sheet shift set to Draft | Bookings kept; no notice | Parking lot |
| 3 | **Before any Sheets firm:** tell workers when an edit in the sheet books, moves or cancels them? | Not told | Parking lot |
| 4 | Role changes on booked shifts: the sheet allows one if everyone booked can do it; the editor and imports refuse | As stated | Parking lot "Dylan to confirm: a role changed in the rota sheet…" |
| 5 | A name typed into the sheet overrides rest, weekly hours and days off (as the office can: Rules 2) | As stated | Parking lot "Dylan to confirm: (1) re-check the live source…" |
| 6 | "Re-check the live source" means our copy synced in the last 20 minutes | As stated | same |
| 7 | A name with no place left is taken out of the firm's sheet (logged) | As stated | log, Phase 10 task 9 |
| 8 | Switching a sheet off (`firm:sheet --disable`): its shifts ahead are frozen (no booking; booked stay) | Frozen | Parking lot |
| 9 | Only UK-locale sheets | Others refused | log, Phase 10 task 10 |
| 10 | A worker matched by mobile alone must have the same name | Refused otherwise | log, Phase 10 task 11 |
| 11 | **Before the first real import:** a worker who changed number, imported without a Staff ID, arrives as a new worker, and their old record keeps the old number, so whoever has that number next could log in as them. Require a Staff ID column, or flag a new worker with an existing name? | As stated | Parking lot (import items) |
| 12 | An imported shift with no Shift ID is matched by site, role and times (a new time makes a new shift); US-format dates | As stated | Parking lot (import items) |
| 13 | Imports can't change booked or started shifts | Skipped | log, Phase 2 |
| 14 | Web imports up to about 1 MB (the terminal 5 MB) | As stated | Parking lot "Dylan to confirm: new shifts are open at once…" |
| 15 | A shift of 24 hours or more is refused (sheet, imports, editor) | Refused | log, Phase 10 task 11 |
| 16 | Telling planners about cancellations (D5) | **Replaced** (Dylan, 2026-10-06: "plug in and play with all planners using webhooks and apis not another sheet"): a planner API with per-firm keys, and signed webhooks whose `booking.cancelled` carries the full record, so the planner marks its own session CANCELLATION. No sheet "Cancellations" column and no daily planner email. S11 approved (How the build is run 19): the API and keys built in 12J.1, the webhooks are 12J.2 | `docs/office-v2.md` §5.3; Phase 12 tasks 12J.1 and 12J.2 |

### Pay and payroll

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Correcting or removing a wrongly imported pay line | No way to; a corrected rate becomes a second line | Parking lot "Pay records (Dylan to decide …)" |
| 2 | How pay queries are grouped (rate, site or week by issue); a worker paid at two rates | As stated | Parking lot "Pay query grouping follow-ups" |
| 3 | A query's group freezes once it's been in a digest? | It can still move | same |
| 4 | **Before a pilot:** the digest: 09:00 Monday to Friday, to payroll only, names only in the attachment (check the firm is happy with that going to payroll's mailbox) | As stated | Parking lot "Payroll digest follow-ups" |
| 5 | A digest send that timed out (may have arrived) puts its queries back | Put back | same |
| 6 | The pay query form: behind the pay code; 8 weeks of shifts or 90 days back; details only for "Something else" | As stated | Parking lot |
| 7 | Payroll sorts a whole group with one note; no "declined" status | As stated | log, Phase 6 |
| 8 | The pay area is for payroll and admins only | As stated | log, Phase 6 |
| 9 | The AI's one line under each group in payroll's digest is used only if it restates the facts: apart from the facts' own phrases, only a short list of plain words ("staff", "queries", "the week", "rate"…), so no verdict ("paid correctly", "underpaid", "no hours missing") or promise gets through; otherwise the code's line only. Keep the AI line like this, or drop it and show only the code's line? | Allow-list; no AI connected | log, Phase 10 task 19 (audit L47) |
| 10 | The pay week number and pay day in the office's top bar (D8) | **Decided** (Dylan, 2026-10-06: recommended default, built lean): ISO weeks, Monday to Sunday, paid the Friday after the week ends ("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct"), one rule for every firm (the per-firm pay calendar setting was cut). **Replaced** (Dylan, 2026-10-26): a pay calendar per firm, with this rule as its default ("Connecting the firm's systems" 1; built in P3) | `docs/office-v2.md` §3.1, §3.8 |

### Office and access

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | An office settings screen (notice threshold, urgent window, quiet hours, waves, sign-off, digest time, retention, domain, and the rules settings: rest 11 hours, weekly cap 48, travel buffer 0)? It needs a new permission on `firms` | Owner-only commands (`firm:settings` and others); the rules settings can't be changed at all, so every firm runs on those defaults | Parking lot; compliance.md; rules-and-credentials.md; Phase 12's Settings page (task 12B.7; S10 approved) changes only the strikes-team email, and with S11 the Integrations page the planner webhook address; retention and the rest stay owner-only |
| 2 | What payroll and resourcers see (payroll: no Today, notice report or log; resourcers: that a pay record changed, never the amount) | As stated. Phase 12 also shows resourcers each session's pay rate (£/hour), never a pay record's figures | Parking lot; `src/lib/auth/roles.ts`; `docs/office-v2.md` §3.8 |
| 3 | "Mark as filled" records who and when, not how | As stated | Parking lot |
| 4 | New shifts are open at once (no draft step) | As stated | Parking lot |
| 5 | Answering requests: a note to decline, optional to approve; approving changes nothing else | As stated | Parking lot |
| 6 | Marking "didn't attend" doesn't message the worker; unmarked bookings aren't completed automatically | As stated | Parking lot "Marking who worked follow-ups" |
| 7 | The office's "make inactive" beats the sheet and files; "Bookings to check" on Today, with nothing escalating one left unanswered as the shift gets close (mark it urgent, or email the office?) | As stated | log, Phase 10 task 7; Parking lot |
| 8 | The pilot metrics' definitions and default period (the last 7 complete days) | As stated | Parking lot; log, Phase 9 |
| 9 | The action log: last 7 days by default, 92 days per search, no export; Today: no email about a new worker request | As stated | log, Phase 5 |
| 10 | **Before a pilot:** login limits at a briefing on venue Wi-Fi (one internet address for everyone): raise, or per firm? And the daily cap's trade-off: anyone who knows a worker's number can use up its 10 links for the day, and that worker then can't get a new link until midnight (UTC; a phone already logged in keeps working, and the office has no "send them a link" button yet: parked). Keep it, raise it, or drop it? | **Decided** (Dylan, 2026-10-16): raise the per-address limit, so a team on one venue's Wi-Fi isn't locked out (the per-number limits stay). Built in 13.5 | Parking lot; log, Phase 10 task 19 |
| 11 | Workers can't change their own contact details (the office does) | As stated | log, Phase 3 profile |

### Deploy, servers and security

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | **When you deploy:** merge `build/overnight` into `main` (yours; it builds the first image). Check CI on GitHub's Actions tab first (or install `gh` so Claude can) | Not merged; CI unchecked | "Connect the deploy"; Parking lot "Dylan to decide: audit findings the overnight loop may not fix" |
| 2 | **When you create the accounts:** a stable server-action key (a GitHub secret; Claude wires it into the image build); pin `actions/checkout` and the Node image | Not pinned | "Connect the deploy" (4) |
| 3 | The call fallback: one TwiML Bin per firm, one manager's mobile | Command built; no bins | "Connect Twilio" step 10 |
| 4 | One server until about 5 paying firms | As stated | ADR-002, ADR-021 |
| 5 | Links in messages stay on `<slug>.<our domain>` even when a firm's own address is verified (only login links go back to it) | As stated | Parking lot "Phase 8 custom domains"; ADR-019 |
| 6 | The web app's database login can call `app_firm_ids()` (revisit if a second service needs the database) | As stated | Parking lot |
| 7 | A test-only failing page ships in the app (switched on only in the browser tests, on localhost) | As stated | log, Phase 10 task 14 |
| 8 | **When you create the accounts:** the email provider (D9). No AWS (ADR-021): any provider with SMTP credentials and a verified sending domain works; which one is your choice (a UK or EU region if it offers one; a transactional email service rather than a staff mailbox). No AWS means no AWS account, SDK or AWS-branded service. Whether a provider that itself runs on AWS (see its sub-processor list) is acceptable is your call when the accounts are chosen (the same question for the host, Deploy 9, and for Anthropic) | Not chosen. Phase 12 builds a plain SMTP sender (12X.2); the console stand-in until then | Parking lot "Connect an email provider (SMTP)"; `docs/office-v2.md` §5.8 |
| 9 | **When you deploy:** the host. Any UK or EU host that runs Docker, with managed Postgres 16 (or Postgres in Compose if it has none); AWS is ruled out (ADR-021). No AWS means no AWS account, SDK or AWS-branded service. Whether a host that itself runs on AWS (see its sub-processor list) is acceptable is your call when you choose it | Not chosen | Parking lot "Connect hosting"; `docs/office-v2.md` §5.8 |

### How the build is run

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Add `npm run build` to `scripts/verify.sh` (task 17's image break would have been caught) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | Parking lot "Dylan to confirm: add npm run build…" |
| 2 | Require the browser tests for a tick; a production-mode browser run | **Approved** (Dylan, 2026-10-16). Built in 13.1 | Parking lot "Dylan to decide: audit findings the overnight loop may not fix" |
| 3 | Widen `scripts/invariants.sh` (Playwright skips, `scripts/` in the withFirm check, `twilio` in tests) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | same |
| 4 | The safety net's gaps (the tick guard, Stop hook, stamp timing; reviewers read-only by tool) | **Approved** (Dylan, 2026-10-16). Built in 13.1 | same |
| 5 | CLAUDE.md: add `resolveFirmByLine()` and the domain look-up to the allowed look-ups; where the "set a firm's line" code sits; and the loop's own edit to CLAUDE.md (the browser tests' port 3443 and `openssl`): keep it? | As is | Parking lot "Shifts line follow-ups"; log, Phase 10 task 15 |
| 6 | Golden rule 3's wording: message ids are unique per firm, not across all firms | Per firm | log, Phase 7 |
| 7 | Schema, auth and tenancy changes made overnight without waiting (your standing instruction), to look over once: migrations 0019 to 0034 (`drizzle/`), notably a worker's mobile may be empty once deleted, with owner-run delete and purge functions (0026); `otp_codes.request_id` (0027); the firm's agreement date (0032); the override reason on the booking (0033); per-firm retention read by the database (0034) | Done on `build/overnight` | log (each task's Decisions) |
| 8 | A database rule for "one waiting request per worker, shift and kind" (a schema change) | Held by a lock in code | Parking lot |
| 9 | S1's two extras on the new `shift_events` table: `pinned` (the office-wide star) and `public_notes` (event-wide details casuals see, such as parking) | **Not needed:** cut on 2026-10-06 (debloat; the star and event notes are in the Parking lot). S1's core (the table, `shifts.event_id`, the event's switch) is approved | `docs/office-v2.md` §5.1 S1 |
| 10 | S2, on `shifts`: `pay_rate_pence`, `post`, `meeting_point`, `uniform`, `required_credentials` (extra qualification codes, all required on top of the role's: the rules engine's input changes) and a per-session showing switch. Meeting point and uniform become visible to every casual who can see the session (changes Data 19 for those two fields only) | **Approved** (Dylan, 2026-10-06). Built in 12B.1 | `docs/office-v2.md` §5.1 S2 |
| 11 | S3, on `assignments`: `cancel_via` (app, office, sheet or import), `strike_warning_version`, `strike_warning_shown_at` | **Approved** (Dylan, 2026-10-06). Built in 12C.1 | `docs/office-v2.md` §5.1 S3 |
| 12 | S4, a new `strikes` table (one strike per booking; withdrawals, reviews, the evidence email's status; the app can't delete rows), plus an owner-run `app_purge_old_strikes()` like migration 0034's messages purge (deletes strikes at 12 months, never during a hold) | **Approved** (Dylan, 2026-10-06), built narrower: no columns for the casual's own account, a review outcome or a strike message, whose features were cut. Built in 12C.1 | `docs/office-v2.md` §5.1 S4 |
| 13 | S5: `requests.message_id` as a real link to `messages` (cleared when the message is deleted at 90 days), and an index on `messages (firm_id, reply_to)` | **Approved** (Dylan, 2026-10-06). Built in 12D.1 | `docs/office-v2.md` §5.1 S5 |
| 14 | S6, on `credentials`: `check_state`, `rejected_reason`, `evidence_upload_id` (and start filling `verified_at` and `verified_by`) | **Approved** (Dylan, 2026-10-06), built narrower: the proposal's `due_on`, `issuer`, `warn_days`, `needs_evidence` and `register_check` were cut. Built in 12F.2 | `docs/office-v2.md` §5.1 S6 |
| 15 | S7, a new `uploads` table (photo and certificate images stored in Postgres; in deletion and export) | **Approved** (Dylan, 2026-10-06). Built in 12F.2 | `docs/office-v2.md` §5.1 S7; Data 20 |
| 16 | S8, a new `worker_travel` table (start postcode and its central point, ways of travelling, time limit; a separate table so the erased-worker check is unchanged; in deletion and export) | **Approved** (Dylan, 2026-10-06). Built in 12G.1 | `docs/office-v2.md` §5.1 S8; Data 21 |
| 17 | S9, a new `travel_estimates` table (keyed by postcode and site, not by person; purged 7 days after the session) | **Approved** (Dylan, 2026-10-06), built narrower: no trip home, route or leave-by columns. Built in 12G.2 | `docs/office-v2.md` §5.1 S9 |
| 18 | S10, for the Settings page (Office 1): an owner-run database function, `app_set_firm_setting(key, value)`, the only way the app may change `firms.settings`; it refuses `retention.*` and every key it doesn't list, so the promise that the app can't shorten retention or lift a hold (migration 0034, `docs/compliance.md`) still holds | **Approved** (Dylan, 2026-10-06), built narrower: it lists only the strikes-team email and its confirmed time (S11 adds the webhook address and its signing version). Built in 12B.7 | `docs/office-v2.md` §5.1 S10, §3.10; Office 1 |
| 19 | **Approved** (Dylan, 2026-10-06: "Yes, add S11"). S11, the planner integration layer, in plain words: (1) a new `api_keys` table (only each key's hash and last 4 characters are kept; the app can add keys and mark them used or revoked, never rewrite or delete one) and an owner-run `app_api_key_lookup(hash)` that turns a key into its firm, which is **a new machine login path** (an auth change: a request is trusted because it carries a key); (2) a guard before that look-up: a key of the wrong shape is refused without touching the database, and an address that sends 30 wrong keys in a minute is turned away; (3) the office's whole-session cancel and move (golden rule 12 code that today only an admin or resourcer can run) gain a second caller, the API: it acts with no office user, only on sessions the planner sent, only while its key is still live, and every failed rules check blocks the change (nobody is there to override one); the office in turn can't edit, move or cancel the planner's sessions as a whole; (4) the webhook address added to S10's keys, with a signing version the database raises itself (never set by the app, so an old signing secret can't come back); (5) `api` added to the session, event and cancel source values; (6) the API answers in the request rather than in a job: an exception to golden rule 3 (CLAUDE.md and ADR-022, written in 12J.1 before the code). Reply "yes, approve S11" to start 12J.1 and 12J.2 | The API and keys built in 12J.1 (2026-10-11); the webhooks in 12J.2 (2026-10-12). Golden rule 3's new wording and the API's small choices (a) to (j) wait for Dylan to confirm (Parking lot "Planner API (12J.1 review)") | `docs/office-v2.md` §5.1 S11, §5.3 |

### Product and scope

| # | Decision | Default now | Where |
|---|---|---|---|
| 1 | Pricing (£299 pilot, about £3 per active worker a month, £199 minimum) | A hypothesis | business.md; ADR-007 |
| 2 | **Before a pilot:** on a real iPhone, does the home-screen app stay logged in? (iPhone push only works from the home screen.) If not, a typed-code login, or remove the hint | Hint shown | Parking lot "Offline and home-screen follow-ups" |
| 3 | What an "offered" booking means | Unused; offers live in `offers` | Parking lot |
| 4 | Open shifts: 28 days ahead, at most 50 checked; My shifts: a shift on now stays under Upcoming | As stated | log, Phase 3 |
| 5 | The urgent flag stays on after a shift fills (the office clears it) | As stated | Parking lot |
| 6 | "Similar shifts" on a filled shift's page (not built) | Not built | Parking lot "Blocked-shift follow-ups" |
| 7 | **Before a pilot:** settings to agree with each pilot firm: urgent window, wave size, escalation time, quiet hours, allocation mode, sign-off | 24 h; 4; 3 h; 22:00–07:00; first come, first served; "[Firm] Shift Team" | go-to-market.md |
| 8 | Later: the next sector, an AI phone line, a firm's own copy of the system, location check-in | Not now | decisions.md |
| 9 | The travel-time service and postcode look-up (D1). (Or Google Routes: about $1,450 a month per 300-casual firm, and its results can't be stored) | **Decided** (Dylan, 2026-10-06: recommended default): TravelTime for car and public transport (its free key for development and the demo only, a fake provider in tests; a production quote before a pilot: Checks 14), postcodes.io for postcode to coordinates, and straight-line miles labelled "(straight line)" when the service is down | `docs/office-v2.md` §5.4; Checks 14 |
| 10 | The office's dark theme: navy (your first brief) or graphite (the mock-up) (D7) | **Decided, then changed** (Dylan, 2026-10-06: recommended default, navy: page #0f1626, panel #16203a, card #1b2642). **Changed 2026-10-21** (Dylan, "yes build this", on the Phase 20 mock-up that proposed it): true dark greys for the whole app: page #0b0c0e, card and panel #18191c, raised #232529, muted text #a9adb4, switch off #7d8189; the firm's colour stands out better on grey (Phase 20) | `docs/office-v2.md` §3.1 |

### Connecting the firm's systems (added 2026-10-26)

For the proposals P1 to P8 ("Proposed 2026-10-26", above Stage 2). All of them **decided** on
2026-10-26 (Dylan, in chat: "go with your recommendations on the 8 decisions"; then 9, his pick
when asked who texts about ShiftDesk's bookings). Each is built as
its proposal, once that proposal gets the go-ahead; until then the app works as "Until built" says.

| # | Decision | Until built | Where |
|---|---|---|---|
| 1 | **Decided** (Dylan, 2026-10-26: recommended): a pay calendar per firm (7 or 14 days, its own start, "Week" or "Cycle"), replacing D8 (Pay 10), with the quick fix first (the casual's Home shows the imported pay date when there is one) | One weekly rule for every firm; Home works the pay day out from it, so a fortnightly firm's casuals would see the wrong day | P3 item 1 |
| 2 | **Decided** (Dylan, 2026-10-26: recommended): ADR-026, a pull connector for AXLR8 (ShiftDesk fetches from AXLR8 on a timer, rather than waiting for AXLR8 to send), amending "no adapter per planner" (ADR-022: no special code for each planner's own system): AXLR8's API looks pull-only, the firm has nobody to write pushes, and AXLR8's customers are the firms we sell to. 2026-10-26: AXLR8 can't be asked for now, so the first connector reads the ops portal's API (it copies AXLR8 every hour), and AXLR8 directly comes later; and since the portal sends changes as they happen, the connector takes its webhooks first and pulls only to catch up | Planners push by the API; no adapters | P5; `docs/decisions.md` ADR-026 (accepted) |
| 3 | **Decided** (Dylan, 2026-10-26: recommended): the staffing email inbox brought forward from Stage 2, after P2 and P4 | Stage 2, after 3 paying firms | P7 |
| 4 | **Decided** (Dylan, 2026-10-26: recommended): casuals' login link by email, a stop-gap until texts exist | WhatsApp only, which no live server can send | P2 |
| 5 | **Decided** (Dylan, 2026-10-26: recommended): a cap on each offer wave (for example a few people per free place, by the existing ranking; the number is set when P4 is built): one place can mean about 1,500 texts today (an estimate: 1,500 of 2,000 casuals eligible), about £300 at the firm's 20p a text | First come, first served: everyone eligible at once | P4 |
| 6 | **Decided** (Dylan, 2026-10-26: recommended): record who asked for each cancellation (casual, firm, client, unknown) apart from who carried it out, and a strikes switch per firm | Not recorded; strikes always on | P3 item 4 |
| 7 | **Decided** (Dylan, 2026-10-26: recommended): import the CRM's Casual sessions only, never Contracted or Holiday ones | Nothing imported | P3 item 2 |
| 8 | **Decided** (Dylan, 2026-10-26: recommended): a booking added in the CRM that the rules refuse (an expired licence) is flagged as urgent, never booked (golden rule 6) | As the rota sheet: not booked, reported | P5 |
| 9 | **Decided** (Dylan, 2026-10-26: recommended): for bookings made in ShiftDesk, ShiftDesk sends the offer, the confirmation and the reminders, through the firm's Webex account, each logged (golden rule 5); AXLR8 keeps texting about the office's own bookings, so no casual gets the same text twice | Nothing is sent for real (no text sender yet) | P2 ("who sends what"); Phase 15 |
| 10 | **Decided** (Dylan, 2026-10-26: recommended): first come, first served texts the best 5 casuals per free place by the existing ranking, at most 50 a wave, then the next wave every `wave_minutes` (15) while it's unfilled; the board still shows the shift to everyone eligible and the first yes still wins. About £1 a wave for one place at 20p a text, instead of about £300 | Everyone eligible at once | P4.3 |
| 11 | **Decided** (Dylan, 2026-10-26): automatic replies never go by text ("it would be an internal chat on the app not texts being sent out"): a text that comes in goes to the office; the in-app chat is P8, with at most 5 automatic replies an hour per casual there. Automatic replies are the shifts line's answers to a WhatsApp, text or voicemail that comes in; a phone call still gets the caller's login link, the login page's own answer (Dylan, 2026-10-27: "Keep sending the link") | Every message gets an automatic reply on its own channel (WhatsApp today) | P4.7; P8 |
| 12 | **Decided** (Dylan, 2026-10-26: recommended): at most 5 unknown-number alert emails per firm an hour; the messages still show in "Need a person" (a cap on polite replies is moot: none go by text) | One email per number to every admin and resourcer | P4.7 |
| 13 | **Decided** (Dylan, 2026-10-26: recommended): texts go out only for offers, confirmations and reminders of ShiftDesk's own bookings, through the firm's Webex account, and preferably only when the casual's phone has app notifications off (Messages 2) | Nothing sent for real (no text sender yet) | Phase 15; P2 |
| 14 | **Decided** (Dylan, 2026-10-26: recommended): the database's time limits are set inside `withFirm`, per transaction, rather than per database role (a tenancy change) | No limits | P4.2; ADR-027 |
| 15 | **Decided** (Dylan, 2026-10-28: recommended): with no text sender yet, every message a text would carry goes to a casual whose phone has no notifications on by email, when we have their address: push first, then a text once a sender exists, then email | Nothing reaches a casual in production | P2.1; P2.4 |
| 16 | **Decided** (Dylan, 2026-10-28: recommended): login links and pay codes by email, built now and switched off per firm; the login and Pay pages' words change after the UI chat's Phase 24, `docs/screens.md` first | WhatsApp only | P2.6; P2.7 |
| 17 | **Decided** (Dylan, 2026-10-28: recommended): build "who sends what" now: every booking records where it came from, and a firm setting stops ShiftDesk's confirmation and reminders for bookings the firm's own system made | ShiftDesk sends for every booking | P2.2; P2.3 |

### Checks and to-dos (not choices)

| # | What | Who | Where |
|---|---|---|---|
| 1 | **Before any real data:** pay the ICO data protection fee (Tier 1) | You | compliance.md |
| 2 | **When you create the accounts:** check the host's monthly prices before you buy | You | "Connect hosting" |
| 3 | **When you create the accounts:** MFA on every account, least-privilege access, a one-page breach plan (72 hours to report) | You | compliance.md |
| 4 | **When you deploy:** the first deploy's database step connects with checked encryption (a certificate error: tell Claude) | You | runbooks "Deploy" |
| 5 | **Before any firm uses its own address:** a regular re-check that it still points to us | Claude | docs/testing.md pre-pilot checklist; ADR-019 |
| 6 | ~~**Before a pilot:** a per-worker limit on "Take shift"~~ **Done in 13.5**: 20 taps every 15 minutes | Claude | Parking lot |
| 7 | ~~**Before a pilot:** licence expiry messages go by WhatsApp whatever the worker chose (a worker who chose texts gets none): move them onto the normal sender~~ **Done in 13.5** | Claude | Parking lot (credential expiry items) |
| 8 | **Before a pilot:** the dry-run event day on the firm's real setup | You, with the firm | pilot-playbook.md; Phase 9 |
| 9 | **Before the first real import:** how a real file gets into the server's owner container (a mounted folder, or `docker compose cp`) | Claude, then you | Parking lot "Import the pilot firm's real data" |
| 10 | On the first restore: check a snapshot keeps the database's logins | You | "Try the runbooks for real" |
| 11 | Monitoring and alerts as the runbook says (the host's own alerts, an outside uptime check, the app's alerts to you) | You | runbooks "Monitoring and alerts" |
| 12 | ~~Fix the flaky test (`sheets.jobs.test.ts`): its fix is written out~~ **Already done** on 2026-10-06 (40a7590: the tick's key holds its minute; checked again in 13.5) | Claude | Parking lot |
| 13 | Capture real Twilio requests for the tests | You, then Claude | "Connect Twilio" step 11 |
| 14 | **Before a pilot:** a TravelTime production quote (the price isn't published; 12 months minimum; the free key is "not for commercial use") and its data processing agreement; TravelTime and postcodes.io added to the sub-processors (Legal 2) | You (the quote and agreement), Claude (the docs) | `docs/office-v2.md` §5.4; Product 9 |
| 15 | **Before a pilot:** add the strike and CSAS questions in `docs/office-v2.md` §6.4 to the solicitor's list (Legal 1) | You | `docs/office-v2.md` §6.4; Legal 16 |
| 16 | **Before any Northern Ireland firm:** Northern Ireland (BT) postcode data needs a separate licence | You | `docs/office-v2.md` §5.4 |
| 17 | **Before Phase 12 starts:** keep a copy of the approved mock-up in the repo (`docs/mockups/office-v2.html`; made-up data only), because today it is a private claude.ai artifact and a temporary file builders can't open (`docs/office-v2.md` §1.1 describes it in words meanwhile) | Claude (task 12A.0; OK'd by "go with your recommendations", 2026-10-06) | `docs/office-v2.md` §1.1; Phase 12 task 12A.0 |
| 18 | **Before Phase 12 starts:** close Phase 11's tasks with `/close-task` (built and verified in b3f3627, not yet audited or ticked); Phase 12 replaces the shell and Today they pin | Claude | Phase 11 |
| 19 | Send the questions in `docs/discovery-axlr8.md` (AXLR8, the ops portal's builder, the firm's IT) and bring back the answers | You | proposals P1 to P7 |
| 20 | **Before any real data:** ask AXLR8 whether a third-party connection needs its consent; keep its API Builder PDF out of the repo (it's AXLR8's document); no one explores the API with an employee login before the agreement | You | `docs/discovery-axlr8.md` |
| 21 | **Before any real data:** the agreement and DPA cover the staffing mailbox too (client, venue and applicant mail, not only casuals') | You, with the solicitor (Legal 1) | P7 |
