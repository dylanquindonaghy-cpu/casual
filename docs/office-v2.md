# Office v2 and casual app v2 (Phase 12)

Added 2026-10-06 at Dylan's request, and trimmed the same day on three more decisions of his:
- **Debloat** ("it needs to be debloat not pro bloat"): only what he asked for, plus what the law
  requires. Everything else is in `PLAN.md`'s Parking lot under "Phase 12 cuts (2026-10-06, Dylan:
  debloat)", one line each.
- **No AWS** (ADR-021): email over SMTP with any provider, Claude through the Anthropic API, any UK
  or EU Docker host (section 5.8).
- **Planners plug in by API and webhooks, not another sheet** (section 5.3): no new sheet features.

The office becomes a compact add-on that sits next to each firm's own planner and CRM instead of
copying them, and the casual app gains qualification statuses, the staff photo, and shifts limited
to the casual's own travel area, each showing the distance and the time by car and by public
transport. This file is the spec. The build order is `PLAN.md` Phase 12, whose tasks name the
sections here (section 9 maps them). Every decision is a row in `PLAN.md` "Decisions waiting for
Dylan" (section 8 gives the row numbers).

**How to use this file.** Read the section your task names before building. The file:line
references are as of commit `b3f3627` (branch `ui/clarity-and-guides`); re-read the cited lines
first, because they move. Example dates follow 2026's calendar (6 Oct 2026 is a Tuesday); the
mock-up's weekdays follow 2025's, so its "Mon 6 Oct" is a Tuesday here. Every name, venue, address,
postcode and email in this file is made up (golden rule 7): Acme Events, the Acme Demo venues,
Northgate, Exampleton, `ZZ` postcodes and `.example` addresses.

**"S" numbers** are the database changes in section 5.1. S1 was already approved; S2 to S10 were
approved by Dylan on 2026-10-06. S11, the planner integration layer, was approved by him the same day. A
task that touches schema, auth or tenancy still shows him its short plan first (CLAUDE.md "How to
work each task", step 2). **"D" numbers** are the decisions in section 8, all settled on 2026-10-06.

---

## 1. In short

**The office shell.** A dark or light shell in the style of the staff portal Dylan named as the
reference (an in-house tool, not named here), with ShiftDesk's own name, logo, colours and made-up
data, never a copy. It has a top bar with the pay week, a "needs attention" bell, the theme button
and the account menu, and a menu that is a sidebar on a computer and a drawer behind a "Menu"
button on a phone.

**The resourcer dashboard** shows four counts and five sections:
- **Urgent shifts not filled.**
- **Showing to casuals.** Every event and every session has an on/off switch.
- **Cancellations.** A cancellation is final the moment the casual confirms it. Each one is a full
  record with a PDF and a CSV, and goes to the firm's own planner by signed webhook. A casual who
  cancels with under 48 hours' notice gets a strike automatically, and the evidence is emailed to
  the firm's strikes team address (a setting).
- **Enquiries.** What the casual asked, the exact reply, and step by step how it was answered.
- **Needs attention.** The to-dos that used to sit on Today.

**Events and payroll.** Events are split into sessions, each with its own pay rate, post, meeting
point, uniform and requirements. Payroll gets its own dashboard.

**Planners plug in** (section 5.3). Any planner or CRM sends its sessions to a small API with a key,
and hears about bookings, cancellations and withdrawn strikes by signed webhook. An admin creates
the key and pastes the webhook address on one page.

**The casual app** keeps working from a link, with no app to download. It has four tabs (Home,
Shifts, Pay, Profile); cancelling is a step on a shift's page:
- **Home:** what needs updating, urgent shifts they can take, and their next shift in full.
- **Shifts:** only shifts inside their own travel area. Each shows the distance, the time by car and
  the time by public transport, urgent or not.
- **Cancel:** a screen that warns about the strike before they confirm.
- **Profile:** a status on every qualification, plus when their staff photo was last uploaded and
  when it's due for renewal.

**Who decides what.** AI still only sorts incoming messages into a topic. Code decides who sees
which shift, who gets a strike and every word of every reply.

**What Dylan signed off on 2026-10-06:** S2 to S10 (S1 was already approved), and decisions D1 to
D8 (D5 became the API and webhooks; D6 was deferred), and S11, the planner integration layer
(section 5.1). Still to come from him: whether "no AWS" also rules out providers that themselves
run on AWS (5.8); and the
accounts: an email provider, an Anthropic API key, a TravelTime quote and, later, a host
(section 8).

### 1.1 The approved mock-up, in words

The visual source of truth is the mock-up Dylan approved on 2026-10-06, "ShiftDesk Office
Mock-up". The repo keeps a copy, `docs/mockups/office-v2.html` (task 12A.0; `PLAN.md` Checks 17,
OK'd on 2026-10-06): open it in a browser. This section describes it in words, for builders who
read rather than look. The mock-up is one page of made-up data
(`tests/unit/repo.made-up-data.test.ts`): switches and buttons work on the page only, and a
"mock-up only: tap to switch" control on the account button lets a viewer see the Resourcer,
Payroll and Admin menus (not a real feature). It
shows more than Phase 12 builds: the list at the end of this section says where v2 differs.

**Shell.** A top bar across the page: a Menu button (phones only), the ShiftDesk mark with "Acme
Events" under it, a pay-week pill ("Week 41 · 6 Oct – 12 Oct · Pay 17 Oct" with a "Current" tag),
a bell with a count, a speech bubble with the enquiries needing a person, a moon/sun button, and an
account button ("Sam Rota, Resourcer"). Below it, a menu panel on the left (groups of icon-and-word
links, counts on the right of some, a collapse arrow) and a rounded content panel on the right. An
orange pill floats at the bottom: "2 enquiries need a person". Dark (graphite) is the reference
look; light mirrors it. Font: Plus Jakarta Sans.

**Dashboard.** Header: "Dashboard", a search box ("Search events, people, references"), "Sync with
planner", a "Today" pill. Four counts in a row: "3 Urgent shifts not filled · 3 places · first
starts Tue 10:30" (tinted red), "5 Events showing to casuals · 26 open places across 8 sessions",
"2 Cancellations today · 1 under 48 hours · strike issued", "18 Enquiries today · 16 answered
automatically · 2 need a person". Then "Urgent shifts not filled" (hint: "Casuals see these first,
and get an alert") and "Showing to casuals" (hint: "Switch an event off to hide all its sessions
from casuals"), both as event cards; then, side by side, "Cancellations" ("Recorded automatically,
never approved or declined", the latest 3) and "Enquiries" ("What casuals asked, and the reply they
got", the latest 4, each with the first line of the reply).

**Event card.** The event's name, place and date; a star (pin); the event's switch; chips
("Showing to casuals" with a tick, or "Hidden from casuals" with a crossed eye; "N sessions";
"Urgent, not filled"; "N places free" or "Full"). Session rows: role, a time chip, an "Urgent" chip
on an urgent gap, requirement chips ("SIA door supervisor", "CSAS", "First aid at work"), "3/4
filled", then pay per hour, post and specifics ("Black trousers, boots. Radio provided."). On the
full page each session row also has its own switch, labelled "Showing to casuals" or "Full: not
showing". Under the sessions, a line written by code, for example "Jamal Morgan cancelled the 08:00
door supervisor session at 06:00 (5 days' notice). Re-offered: 12 qualified casuals have it within
their travel area." Buttons: "View sessions", "View booked casuals", and "…". The made-up events:
Northern Lights Live (Acme Demo Arena: door supervisor 3/4 urgent, steward 11/12, response team
lead 1/1 needing first aid), Night patrols (Northgate Town Centre: CSAS officer 3/4 urgent),
Riverside Food Festival (steward, car park marshal), Raceday (Acme Demo Racecourse: steward 5/6
urgent, security officer), Northgate Charity 10K (course marshal 0/14, steward 0/4) and Hillside
Christmas Market (switched off: "Hidden from casuals: not confirmed by the client yet.").

**Events & sessions.** Tabs: All, Showing, Hidden, Urgent, not filled; "Sync with planner"; a note:
"Events and sessions come from your own planner. Here you only choose what casuals see and what's
urgent." Then every event card in full.

**Cancellations.** Tabs: All, Under 48 hours, Strikes issued, By casuals, By the office; "Download
all (CSV)". Four counts: "11 Cancellations this week · 9 by casuals · 2 by the office", "3 Under
48 hours' notice · 3 strikes issued", "8 Places filled again · Median 52 minutes to refill", "All 11
Marked CANCELLATION in your planner · Last sync 09:40". A list on the left (who cancelled, or "The
office cancelled Tom Hale"; session, event, date and time; chips for the notice, "Strike issued"
and "Planner: CANCELLATION"; the time) and the record on the right: "Cancellation record
B71E0C42", then Casual, Event, Session, Post, Pay rate, Booked, Cancelled (when and how: "In the
app (after a WhatsApp reminder)"), Notice ("15 hours (under 48 hours)"), Reason, Then ("Place
reopened and marked urgent · offered to 5 people"). Below: a red strike box ("Strike issued
automatically. Strike 2 in the last 90 days."), or a green box ("Cancelled by the office, so no
strike." / "No strike: 7 days notice is more than 48 hours."); an "Evidence sent to your strikes
team" box (to, subject, what was attached); a "Your planner" box ("The session is marked
CANCELLATION in your rota sheet (row 42)…"); buttons "Download record (PDF)" and "Withdraw strike…".

**Strikes.** "Download (CSV)", a note on the 48-hour rule and the strikes team's address, and a
table: Casual, Strikes (90 days), Latest (session, venue, start, when cancelled, notice), Evidence
("Sent to strikes team 19:05"), and "Withdraw a strike". Rows: Kieran Doyle 2, Priya Shah 1, Mo
Rahman 1.

**Enquiries.** Tabs with counts: All 18, Answered automatically 12, Sorted by AI 4, Need a person
2. Four counts: "89% Answered straight away", "4 s Typical reply time", "Shifts Most asked about",
"2 Need a person · Oldest 3 h 35 min ago". A list (channel icon, name, outcome chip, their words in
quotes, time) and the conversation: their message and the reply as speech bubbles, then "How it
was answered" as numbered steps, then either "Reply" and "Mark as dealt with" (waiting for a
person) or "Right answer" and "Wrong answer: tell us". The six examples: Zoe asks for weekend
shifts and gets her personal list (two Saturday sessions with pay, post and travel times; the steps
show the keyword, her licences, her days off and hours, her travel area, and what was left out and
why); Ben's pay question, sorted by AI as pay, gets the fixed pay reply; Kieran's "cant make tmrw,
car broke down", sorted by AI as cancel, gets his booking and the strike warning; an unknown
number's voicemail waits for a person; Leah's "is parking free at the festival?" waits for a person
(with a tip: add parking to the event's details); Priya took a shift in the app.

**Pay dashboard.** "Import pay records" and "Send the digest now". Four counts: "10 Pay queries
waiting · Oldest 3 days", "Fri 09:00 Next digest · Last: Mon 09:00, 6 queries", "14 Sorted this
week · Each person told by message", "Fri 17 Oct Next pay date · Pay records imported Thu". Then
"Waiting, grouped by likely cause" ("Pay questions never get an AI answer: they come here") with an
"Open" button per group, and "Recently sorted" (who sorted it, when, their note).

**Casuals.** Tabs: All 60, Need updating 9, Expiring in 30 days 4, Photo due 6; "Send reminders".
Four counts: "51 Ready to work · Everything in date", "4 Expiring in 30 days · Reminded
automatically", "2 Expired · Can't take shifts that need it", "3 Uploads to check · New photos and
certificates". A table: Casual (initials, name, roles), Qualifications (a chip each: "SIA DS",
"CSAS", "Manual handling: 22 days", "First aid: missing", "SIA DS: expired 1 Oct", "CSAS: applied
for"), Staff photo ("3 Aug 2024 Due", "2 May 2026 New: check it", "No photo"), Travel area ("ZZ1 4 ·
45 min"), Strikes, Needs updating ("Photo, manual handling"). A note: "Nothing counts until the
office has checked it."

**Casual's app (four phone screens of Zoe, in the firm's colours under its brand bar).**
1. **Home:** "Hello Zoe", "Updated 21:12". A "2 things need updating" card (staff photo "Last
   uploaded 3 Aug 2024", Due; manual handling "Expires 28 Oct 2026, in 22 days", Soon; "Update
   now"). An urgent card "Needed now, and you can take them": Door supervisor · Acme Demo Arena,
   08:00–16:00 · £15.50/h · Gate A, with "3.1 miles · 12 min by car · 24 min by bus" and "1 left";
   CSAS officer · Northgate Town Centre with "8.4 miles · 21 min by car · 38 min by train" and a
   CSAS chip; "See urgent shifts". "Your next shift": the day and times, Steward · Riverside Food
   Festival, Post, Pay ("£12.60 an hour (about £100.80)"), Report to, Bring, Getting there ("5.0
   miles · 15 min by car · 31 min by bus"), then "Open in maps", "Ask for a change", "Cancel this
   shift". "Shifts you can apply for": "Only shifts your licences and hours allow, up to 45
   minutes from ZZ1 4. You hold CSAS, so CSAS shifts show too.", three rows with travel lines, "2
   more shifts are further than you travel. Change how far", "See all open shifts".
2. **A shift she can take:** chips "Urgent" and "CSAS position", "CSAS officer", "Northgate Town
   Centre · night-time economy patrol"; facts (date and time, Pay "£15.00 an hour (about £90)",
   Meet, Post, Uniform, Places "1 of 4 left"); "Getting there" ("From your home area, ZZ1 4": "8.4
   miles away", "About 21 min by car" with a parking note, "About 38 min by public transport"
   with "Train from Exampleton to Northgate, then a 6 min walk. Leave by 15:50.", "Open in maps");
   "What it needs" (CSAS accreditation, SIA door supervisor licence, each "Yours is valid until …"
   and "You have it"); "Take shift"; "Cancelling less than 48 hours before the start gives you a
   strike."
3. **Cancelling:** "Cancel this shift?" with the session's summary; a red box "This shift starts in
   26 hours. Cancelling with less than 48 hours' notice gives you a strike. Acme Events' strikes
   team gets a record of it. You have 0 strikes."; "Why can't you make it?" (I'm unwell, Travel
   problem, Family or caring, Something else); a solid red "Confirm cancellation"; "Keep this
   shift"; "Your cancellation is recorded the moment you confirm. Nobody needs to approve it."
4. **Profile:** "My profile" ("To change your name or number, ask the office."); Staff photo
   ("Last uploaded 3 Aug 2024", due for renewal, "The office checks it before it shows on your
   pass.", "Upload a new photo"); Qualifications (SIA door supervisor "checked on the SIA register 1
   Oct" Valid; CSAS Valid; Manual handling Expiring; First aid at work "None on file. Needed for
   team lead shifts." Missing; Right to work "Checked by the office on 12 Jan 2026" Checked;
   "Upload a certificate"); Where you work (Home area ZZ1 4; "Shifts up to 45 minutes away, by car
   or public transport"; "Change"); Strikes ("You have 0 strikes in the last 90 days."); Days you
   can't work; Help.

**Other menu pages** (action log, notice report, pilot metrics, pay queries, import pay records,
office team, data requests, how-to guide, the rules and planner pages) show a one-line placeholder:
they keep what they do today, in the new look.

**Where v2 deliberately differs from the mock-up:**
- Every view, tab and filter is a real link with its own URL; list rows are links, not buttons.
- **Not built** (`PLAN.md` "Phase 12 cuts"): the search box; the icon strip and menu collapse; the
  speech bubble and the floating orange pill; "Sync with planner" and the "Today" pill; the star on
  event cards; the Cancellations "Places filled again" and "Marked CANCELLATION" counts, the
  "Strikes issued" and "By casuals" tabs and the side-by-side record; the strikes CSV; the
  Enquiries metrics row and its "Answered automatically" and "Sorted by AI" tabs, and "Right
  answer" / "Wrong answer"; "Reply 1 or 2 to take one"; the Casuals counts row, its "Expiring in 30
  days" and "Photo due" tabs and "Send reminders"; "checked on the SIA register"; the route and
  "Leave by" time on a shift; the "Casual's app" office page.
- The "Your planner" box on a record says whether the webhook reached the firm's planner ("Sent to
  your planner at 19:06"); nothing is written into a rota sheet (5.3).
- The urgent card's line says "Offered to 12 casuals" (the mock-up's "… have it within their
  travel area" needs a count the build doesn't keep).
- Strikes has no menu badge (strikes need no action).
- "Cancellation & strike rules" becomes "Settings" (the strikes-team email and site postcodes), and
  "Integrations" is added (3.10).
- Photo renewal is every 3 years by default, not 2 (D3).
- The dark theme is navy, not graphite (D7). Colours change where contrast failed (3.1).
- Travel says "by public transport", not "by bus" or "by train".
- "Mark as dealt with" becomes "Close without a reply", which asks for a reason code (3.6).
- The pay-week pill follows one rule (ISO week, paid the Friday after: D8); the font is
  self-hosted.
- The Casuals menu badge counts uploads to check (the mock-up's said "9 need updating").
- The office sees a casual's travel district only ("ZZ1 · 45 min"; the mock-up showed "ZZ1 4"),
  and replies and the casual's Home say "from your home area" rather than the postcode, because
  the office sees replies word for word (3.6).
- Event cards use one status tag plus plain text ("2 sessions · 3 places free") instead of the
  chips.
- "Showing to casuals" lists every switched-on event, urgent ones included (the mock-up left urgent
  events out of it).
- A daily series shows one row per session; the mock-up's "Every evening to 19 Oct" grouping is not
  built (`PLAN.md` Parking lot).

### 1.2 Starting point (as of `b3f3627`)

**Exists and is reused:**
- A casual's cancellation is final with no approval step: `cancelBooking()`
  (`src/lib/roster/cancel.ts:57-69`), with notice hours and the reason on the booking
  (`src/lib/db/schema/roster.ts:228-236`).
- The office's whole-session cancel and move, with reason codes, notice hours and notices to each
  casual: `cancelShiftByFirm()` (`src/lib/roster/cancel.ts:186`) and `moveShiftByFirm()`
  (`src/lib/roster/firm-change.ts:72`). The planner API uses both, as a second kind of caller
  (both accept only an active office user today: S11, 5.3.2).
- A dropout close to the start marks the shift urgent and starts offer waves
  (`src/lib/roster/urgent.ts:27-71`, waves at line 55).
- Open shifts: next 28 days, at most 50 checked (`src/lib/portal/open-shifts.ts:23-24`), the query at
  134-154 already joins the site's postcode.
- `messages.reply_to` and `messages.intent` (`src/lib/db/schema/messages.ts:50-52`); the shifts
  line's "office" keyword ("help", "office", "talk": `src/lib/inbound/keywords.ts:20`); the reply
  job and the payroll digest still wired to `noAi` (`src/lib/inbound/reply.ts:563-568`,
  `src/lib/pay/digest.ts`).
- `credentials.verified_at` and `verified_by` columns, not yet filled
  (`src/lib/db/schema/people.ts:129-130`); credential statuses valid, expired, applied, suspended
  (line 126).
- `sites.lat` and `lng`, unused ("Kept for Stage 3", `src/lib/db/schema/tenancy.ts:90-92`); the app
  may edit `sites` (`src/lib/db/admin/access.ts:21`) but only read `firms` (line 20).
- `assignments.override_reason` (migration 0033).
- The action log writer, `recordEvent()` (`src/lib/events/record.ts:37`), which the webhooks hang
  off (5.3); the rate limiter `throttle()` (`src/lib/auth/throttle.ts:119`); `newToken()` and
  `hashToken()` (`src/lib/auth/tokens.ts:6,10`); Gate B (`src/lib/imports/gate-b.ts`).
- The payroll digest's schedule (`digestDueOn()`, `src/lib/pay/digest-schedule.ts:48`),
  `loadDigestStatus()` (`src/lib/pay/digest.ts:468`), `loadPayQueryGroups()`
  (`src/lib/office/pay-query-groups.ts:59`), "Send the digest now" (`queuePayDigestNow()`,
  `src/lib/pay/digest.ts:425`).
- Office areas and `canAccess()` (`src/lib/auth/roles.ts`); the Phase 11 shell
  (`src/app/office/{layout,office-shell,office-nav}.tsx`) and design tokens (`src/app/globals.css`).
- The request types include `review` (`REQUEST_TYPES`, `src/lib/db/schema/roster.ts:54`).

**Missing (built in Phase 12):** any dark theme (`src/app/globals.css` has light tokens only, and no
`prefers-color-scheme` rule anywhere in `src/`); events and per-session fields; strikes; travel
areas and travel times; uploads and the staff photo; PDFs; a real email sender (only the console
one; the email attachment schema allows CSV text only, at most 6,000,000 bytes,
`src/lib/messaging/transport.ts:8-20`); a real AI client; a planner API and outgoing webhooks; a
`/office/pay` page (only `/office/pay/import` exists); `pdf-lib`, `@pdf-lib/fontkit` and an
embedded font file (pdf-lib's built-in fonts only cover a basic Western character set, so names
such as Łukasz, Ştefan or Gülşen and "✓" would fail), `sharp`, `nodemailer` and `@anthropic-ai/sdk`
(not in `package.json`); `next/font` (not used yet). Payroll's `/office` is a placeholder ("Your
dashboard will appear here.", pinned by `tests/e2e/office.today.spec.ts:67`).

**Removed in Phase 12 (12X.1):** the image fetches Amazon's RDS certificate bundle
(`Dockerfile:30-34`), and `deploy/lightsail.sh`, `deploy/alarms.sh` and `deploy/restore-drill.sh`
assume AWS (none has ever run).

**Needs a database change:** S1 to S11 (section 5.1).

---

## 2. Requirements checklist

| # | Dylan's requirement | Where this plan covers it |
|---|---|---|
| A | Compact: resourcers keep their own CRM and planner | 3.1 (menu), 3.11 (shift-editing pages leave the menu, Today is merged), 5.3 |
| B | Show casual enquiries and how they were answered by AI | 3.6 |
| C | Cancellations are cancellations, not requests, and can't be denied | 3.4 (no approve or decline anywhere), 4.5 |
| D | Show casuals what we urgently need | 3.2 (first count), 4.2, 4.3 |
| E | Resourcers control what is shown to casuals | 3.3 (event and session switches), S1, S2 |
| F | Cancellations happen automatically; show who cancelled what | 3.2, 3.4 |
| G | Payroll gets its own version | 3.8 |
| H | Polished UI: main dashboard, hamburger menu to more detailed pages | 3.1, 3.2 |
| I | Research similar services | 7 (reference only, not scope) |
| 1 | Looks like the reference portal but isn't a copy (own name, logo, colours, made-up data); dark and light | 3.1, 9 (seed data), D7 |
| 2 | Dashboard counts and sections, with the exact names approved | 3.2 |
| 3 | Events split into sessions (role, times, pay rate, post, requirements, specifics), shown to casuals, the office and on cancellation records | 3.3, 3.4, 4.4, 5.3, S1, S2 |
| 4 | Cancellation records with PDF, CSV and a feed; the planner told; strike under 48h; evidence emailed to a per-firm address; strikes page; withdraw with a reason; no strike when the office cancels | 3.4, 3.5, 5.3, 5.6, S3, S4, D4, D5 |
| 5 | Enquiries show the question, the exact reply and how it was answered, including checks. Personal, detailed shift lists built by code, including CSAS. Pay questions never get an AI answer | 3.6, 5.7, 6.1 |
| 6 | Payroll dashboard | 3.8 |
| 7 | Casual app: home, shift detail, cancel with strike warning, profile | 4 |
| 8 | Qualification statuses and a "needs updating" list; staff photo with last upload and renewal; shifts limited by the casual's location; distance plus car and public transport times on every shift, urgent or not | 3.7, 4.2–4.6, 5.4, 5.5, S6–S9, D1–D3 |
| 9 | Commit freely; list each database change separately for approval | 5.1, 9 (approval gates) |
| 10 | (2026-10-06) "Plug in and play with all planners using webhooks and APIs, not another sheet" | 5.3, S11, D5 |
| 11 | (2026-10-06) No AWS services | 5.8, ADR-021 |
| 12 | (2026-10-06) "Debloat, not pro bloat": nothing he didn't ask for and the law doesn't require | every section; `PLAN.md` Parking lot "Phase 12 cuts" |

---

## 3. Office

### 3.1 Shell and theme

**Top bar, left to right:**
1. **Menu button.** A hamburger with the word "Menu", below 1024px only.
2. **Brand.** ShiftDesk mark, with the firm's name underneath.
3. **Pay-week pill.** "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct": the ISO week (Monday to Sunday)
   and the Friday after it (D8). Hidden on phones. Built with the pay dashboard (12A.3).
4. **Bell.** "Needs attention, N", a link to the dashboard's Needs attention section (3.9). Admins
   and resourcers. Built with the dashboard (12E.1).
5. **Moon/sun button.** Switches between light and dark, with a visible tooltip.
6. **Account button** (initials, name, role). It opens: How-to guide, Log out.

**Menu.** One `<nav>`, rendered by the server as real `<a href>` links.
- **1024px and wider:** a full sidebar, 272px.
- **Narrower:** the Menu button opens the same links in a native `<dialog>` drawer
  (`showModal()`). Escape and the dimmed backdrop close it, focus returns to the Menu button, and a
  closed drawer can't be reached with the Tab key. No ARIA `menu` roles: it is ordinary navigation.

**Current page.** Marked with `aria-current="page"`, a 3px accent bar, the soft accent background
and the filled icon. On a child page (for example one cancellation record), the parent link gets
`aria-current="true"`. Page titles read "{page} · {firm} shifts", the existing pattern.

**Menu per role** (each link appears when the task that builds its page lands; until then the menu
holds today's pages under these groups):

| Group | Link | Admin | Resourcer | Payroll | Badge |
|---|---|---|---|---|---|
| Operations | Dashboard | yes | yes | – | – |
| | Events & sessions | yes | yes | – | – |
| | Cancellations | yes | yes | – | – |
| | Enquiries | yes | yes | – | Need a person |
| Pay | Pay dashboard | yes | – | yes (their home page) | – |
| | Pay queries | yes | – | yes | Waiting |
| | Import pay records | yes | – | yes | – |
| Records | Casuals | yes | yes | – | Uploads to check |
| | Strikes | yes | yes | – | none (strikes need no action) |
| | Action log | yes | yes | – | – |
| | Notice report | yes | yes | – | – |
| | Pilot metrics | yes | yes | – | – |
| Configuration | Settings | yes | – | – | – |
| | Integrations | yes | – | – | – |
| | Office team | yes | – | – | – |
| | Data requests | yes | – | – | – |
| Help | How-to guide | yes | yes | yes | – |

- **Menu names and counts.** Group names stay plain text. Badge counts sit outside the link's
  accessible name: "Enquiries" stays exactly "Enquiries", and the count is read as separate hidden
  text. This keeps `exact: true` link lookups in the tests working.
- **Office areas in `src/lib/auth/roles.ts`** (each added with its page):
  - `events`, `cancellations`, `strikes`, `enquiries` and `casuals` (renamed from `workers`): admin
    and resourcer.
  - `settings` (Settings and Integrations): admin only.
  - `pay` stays admin and payroll.

**Fixes carried over from the review of the approved mock-up:**
1. The menu was built by script only: now server-rendered links.
2. The closed drawer's links could be tabbed to: a closed `<dialog>` can't be.
3. The saved theme flashed on load: now a cookie read by the server.
4. Several items failed contrast: new colour values in the table below.
5. List rows were `<button>`s containing `<p>` and `<div>`: rows become
   `<a class="row" href="/office/cancellations/B71E0C42">` with `<span>` content, each opening its
   own page.
6. Changing view didn't move focus, change the title or the URL: every view is a `?view=` link
   with its own URL, and each page starts at its `<h1>`.

Also: channel icons get visually hidden text instead of `title` tooltips, and no whole panel is
`aria-live`.

**Colours.** All colours live as tokens in `src/app/globals.css`, redefined for dark mode. There are
no hard-coded colours; today there are 29 `bg-white` uses in 16 files under `src/`.

| Item | Fix (contrast measured in the review) |
|---|---|
| Count badges and the solid danger button in dark mode | New `--urgent-fill` #d92d20 with white text: 4.83:1 (was 2.79:1) |
| Switch track when off | #7a8396 light / #7c8aa8 navy dark: at least 3.5:1 |
| "Live" chip / amber chip, light theme | #116b33 (6.02:1) / #9a4f00 (5.38:1) |
| Chips, switches, current-page bar | A transparent 1px border, so they keep an edge in Windows high-contrast mode |

- **Dark theme:** navy (D7): page #0f1626, panel #16203a, card #1b2642, raised #22304f, muted text
  #a3b0c8, switch off #7c8aa8.
- **Type sizes:** one scale of 12 · 13 · 15 · 18 · 24 · 30px. Fixed-width digits on every time,
  rate and count.
- **Font:** Plus Jakarta Sans, self-hosted with `next/font`, so nothing is requested from Google
  while the app runs.
- **Session rows:** divided rows inside the event card, not boxes nested inside a box.
- **Tap targets:** at least 44px for the switches.

**Theme without a flash.**
- A cookie, `sd-theme` = `light` or `dark` (none: follow the device), is read in
  `src/app/layout.tsx`, which writes `data-theme` onto `<html>`. The moon/sun button sets it.
- `<meta name="color-scheme" content="light dark">` is added, and a new `prefers-color-scheme:
  dark` block in `globals.css` (guarded so an explicit `data-theme` wins) handles "follow the
  device". There is no dark mode today.
- Casual pages follow the device's setting; there is no override on Profile.
- The firm's brand bar on staff pages and logged-out office pages stays exactly as it is
  (`tests/e2e/brand.spec.ts`).
- No database change.

### 3.2 Resourcer dashboard (`/office`)

**Header:** "Dashboard", with the firm's shifts-line number under it, as today
(`src/app/office/page.tsx:31`).

**Counts** (each is a link to a filtered list; the first is tinted and larger, the other three
muted):

| Count | What it counts | Small line under it | Links to |
|---|---|---|---|
| Urgent shifts not filled | Sessions marked urgent, with a place free, not yet started | "3 places · first starts Wed 10:30" | `/office/events?view=urgent` |
| Events showing to casuals | Events switched on that still have a session to come | "26 open places across 8 sessions" | `/office/events?view=showing` |
| Cancellations today | Bookings cancelled since midnight (London time), by casuals, the office, the planner or the sheet | "1 under 48 hours · 1 strike issued" | `/office/cancellations?day=today` |
| Enquiries today | Messages to the shifts line since midnight, plus requests made in the app | "16 answered automatically · 2 need a person" | `/office/enquiries?day=today` |

"Today" means the London calendar day. Today's page used the last 24 hours instead
(`src/lib/office/today.ts:25`).

**Sections, in this order:**
1. **Urgent shifts not filled** ("Casuals see these first, and get an alert"). Event cards
   (section 3.3) showing only their urgent sessions with a gap.
   - Each card has a line written by code: "Offered to {n} casuals" (from the session's offers),
     or the existing "Offers stopped: nobody else can take it."
   - If a hidden event has an urgent gap, the card warns: "Hidden from casuals: nobody can see this
     gap."
   - When empty: "Every urgent shift is filled."
2. **Showing to casuals** ("Switch an event off to hide all its sessions from casuals"). Events
   that are switched on, by date.
   - Compact cards: 2 sessions, then "+ N more".
   - Switching an event off shows a status message: "Hidden from casuals. Booked casuals keep their
     shifts."
3. **Cancellations** ("Recorded automatically, never approved or declined"). The latest three.
   Each shows:
   - who cancelled, or "The office cancelled {name}";
   - the session, event, date and time;
   - a chip for the notice given (red under 48 hours) and "Strike issued";
   - a link "All records".
4. **Enquiries** ("What casuals asked, and the reply they got"). The latest four. Each shows:
   - the name and channel icon;
   - their words in quotes;
   - an outcome chip;
   - the first line of the reply;
   - a link "All enquiries".
5. **Needs attention** (section 3.9).

**Who sees it.** Admins and resourcers. Payroll is sent to the Pay dashboard.

**Code.** New loader `src/lib/office/dashboard.ts`. It reuses the urgent and cancellation queries
from `src/lib/office/today.ts` and the enquiry loader from 3.6. `/office/today` redirects to
`/office`.

### 3.3 Events and sessions (`/office/events`, `/office/events/[id]`)

**Where events come from:**
- **Google Sheet and file import:** rows are grouped by date and site into an automatic event,
  named like "Acme Demo Arena · Sat 10 Oct", so every session belongs to an event and the switch
  always works. There are no new sheet or import columns (Dylan, 2026-10-06).
- **ShiftDesk's own form** ("Shifts for an event", `/office/shifts/event`): creates the event row.
- **The firm's planner, through the API** (5.3): the session carries `event.ref` and its name; a
  session without one joins an automatic event.
- **Existing shifts:** the migration groups them into automatic events the same way.

**What a session is.** Today's `shifts` row, plus the S2 fields: role, start and end time,
filled/needed, pay rate, post, meeting point, uniform, and extra requirements shown as chips (SIA
DS, CSAS, First aid). For sheet and file sessions the S2 fields are set in ShiftDesk's session
editor; the sync and the import never touch them. API sessions get them from the planner.

**Event card.** It shows:
- the title, place and date;
- the event switch, labelled "Show {event} to casuals";
- one status tag (Showing or Hidden), plus "Urgent" only when it applies;
- plain text such as "2 sessions · 3 places free".

Each session row shows role, start–end, "Urgent" on an urgent gap, a chip per requirement, "N/M
filled", £/hour, post, meeting point and uniform. On the event page each session row also has its
own switch with a unique label, for example "Show Door supervisor 08:00–16:00 to casuals". A full
session reads "Full: not showing".

**Card buttons:**
- **View sessions:** opens the event page, with booked casuals and "Mark who worked".
- **"…" menu:** Offer a place (`/office/offer/[shiftId]`); Assign; Mark urgent / not urgent
  (`src/lib/roster/urgent.ts`); Change or cancel (the existing `/office/shifts/[id]` forms). A sheet
  or API session can't be changed or cancelled as a whole here ("This session comes from your
  planner. Change it there."; sheet shifts are already refused, `src/lib/roster/cancel.ts:96,204`).

**Tabs** (links, so back, refresh and sharing work): All · Showing · Hidden · Urgent, not filled.

**Firms without a planner** also get "Add shifts" and "Import shifts" buttons in the page header.

**What a switch does.** It is ShiftDesk's own setting: never read from or written to the planner,
so neither the sheet sync nor the API ever changes it. One `visibleToCasuals` check (the event's
switch and the session's) is used everywhere. Hiding an event or session:
- removes it from open shifts, the urgent board and the home page count
  (`src/lib/portal/open-shifts.ts:85-93`);
- makes the shift page say it isn't available (treated as "missing" in
  `src/lib/portal/shift-detail.ts`);
- makes `bookShift` refuse a casual (the office can still assign);
- stops offer waves and the waves after a dropout (`src/lib/offers/candidates.ts`,
  `src/lib/roster/urgent.ts:55`);
- keeps it out of personal enquiry replies;
- leaves booked casuals' bookings untouched (the copy says so);
- is logged as `event.shown` / `event.hidden` / `session.shown` / `session.hidden`, with who did it.

It is a display choice, not an eligibility rule, so it stays out of the rules engine.

### 3.4 Cancellations (`/office/cancellations`, `/office/cancellations/[ref]`, `/[ref]/pdf`, `/export`)

**There is nothing to approve.** A casual's cancellation already becomes final in `cancelBooking()`
(`src/lib/roster/cancel.ts:57-69`). No cancellations page has an Approve, Decline or Deny control
(tested, 12C.3 and 12E.1). v2 adds the following steps to the same database transaction:
1. The strike decision (3.5).
2. The cancel-screen warning the casual saw (S3).
3. The existing steps: reopen the place, mark it urgent after a dropout, start the offer waves
   (`src/lib/roster/urgent.ts:27-71`), and write the log entry.

Then background jobs (carrying ids only) send the evidence email to the strikes team (5.6) and the
webhook to the firm's planner (5.3).

**Counts, this week:**
- Cancellations: "9 by casuals · 2 by the office".
- Under 48 hours' notice: "3 strikes issued".

**Views** (links): All · Under 48 hours · By the office. Each row opens the record's own page.

**What one record shows** (reference = the first 8 characters of the booking id, as today):

| Field | Source |
|---|---|
| Casual, staff id | `workers` |
| Event; session (role, date, start–end); site (name and postcode); post; pay rate; requirements; meeting point; uniform | `shift_events`, `shifts`, `sites` (S1, S2) |
| Booked at | `assignments.confirmed_at` |
| Cancelled at, and how ("In the app", "By the office (Sam Rota)", "By your planner", "Removed on the rota sheet") | `cancelled_at`, plus `cancel_via` (S3) and the log |
| Notice in hours, and whether it was under 48 hours | `notice_hours` |
| Reason: on screen (admins and resourcers only), the casual's quick reason or the office reason from the fixed list. In the PDF, the CSV, every email and every webhook, all four quick reasons read "Casual's own reason (see ShiftDesk)", because "I'm unwell" is health data and those leave ShiftDesk (6.3); office reasons keep their fixed words | `cancel_reason` |
| Strike: issued, exempt (with the reason) or none; the casual's live strike count | `strikes` (S4), and the decision code in the `shift.cancelled` entry |
| Evidence email: sent at what time to the strikes team / not set up / failed, with "Resend evidence" | `strikes` (S4) |
| Your planner: "Sent to your planner at 19:06" / "Sending" / "Couldn't reach your planner (gave up at 19:06 on 7 Oct)" / "No webhook set up" | `webhook.delivered` / `webhook.failed` log entries (5.3, 12J.2) |
| Then: "Place reopened and marked urgent · offered to 5 casuals · filled again by Ben Fraser at 22:02" | existing log entries say what happened; the times come from the bookings' own times (the cancellation, the replacement's `confirmed_at`), because log entries can't be backdated |
| Warning shown on the cancel screen, and its version | S3 |

**PDF per record.**
- What it contains: the same fields, "Produced by ShiftDesk from {firm}'s data", and the date and
  time it was generated.
- How it is built: on the server with `pdf-lib` (pure JavaScript, MIT licence) and
  `@pdf-lib/fontkit`, with an embedded font (Noto Sans, or the self-hosted Plus Jakarta Sans) that
  covers names such as Łukasz, Ştefan or Gülşen and the "✓" mark. pdf-lib's built-in fonts can't
  print them and would throw, so the record and the evidence email would fail for those casuals.
- Each download is logged as `export.downloaded`.

**CSV of the chosen view.** Capped at 20,000 rows like the notice report; each download is logged.
Columns:
- reference, casual, staff id, event, site, role, date, start, end, post, pay rate;
- booked at, cancelled at, who cancelled (casual/office/planner/sheet), how;
- notice hours, under 48 hours (yes/no), reason (a casual's: always "Casual's own reason (see
  ShiftDesk)"; the office's: its fixed words);
- strike (yes / exempt: reason / no), evidence sent at, sent to planner at, then.

The casual's actual reason and their own free-text note appear only on the record page, for admins
and resourcers, never in exports.

**Cancellations by the office, the planner or the rota sheet** never give a strike. The record
keeps the reason and the notice hours; they appear in the notice report; the casual is told as
today (`shift_cancelled_by_firm`).

### 3.5 Strikes (`/office/strikes`)

**The rule** is a pure function, `strikeDecision()` in a new `src/lib/strikes/decide.ts`, with heavy
unit tests. In order:

1. Cancelled by the office, the planner (API) or the rota sheet: no strike.
2. Notice of at least `strikes.notice_hours` (default 48), measured at the cancellation: no strike.
3. The office booked them ("Assign": `shift.assigned` with `by: "firm"`,
   `src/lib/roster/book.ts:286-301`): exempt. The casual never accepted the shift in ShiftDesk, so a
   strike for turning it down would be the kind of detriment 6.2 warns about.
   - The reason reads "rules override" when the office booked them by overriding a rest or
     weekly-hours check (`assignments.override_reason`, migration 0033), otherwise "booked by the
     office".
   - An office "Offer to someone" that the casual took themselves is their own booking, not this.
4. The office or the planner moved, shortened or changed the role, site or pay after the booking
   (log entries `shift.moved`, `shift.curtailed`, `shift.changed` after `confirmed_at`): exempt,
   "the office changed it".
5. Otherwise: strike issued.
   - It is flagged "needs a person to review" when the reason was "I'm unwell" or "Family or
     caring" (an emergency with a dependant raises the same Equality Act questions as illness).
   - The strike still stands, as Dylan asked. A mis-tap is put right by the office withdrawing the
     strike (the flag for a session taken inside 48 hours was cut: `PLAN.md` "Phase 12 cuts").

The decision runs inside `cancelBooking()`'s transaction (`src/lib/roster/cancel.ts`). Its result is
a code in the `shift.cancelled` entry's data; a `strikes` row is written only when a strike is
issued (`strike.issued`: ids, codes and hours only). Table tests cover every case and boundary,
including an office-assigned booking, a rules override, a change after booking (by the office or
through the API), exactly 48 hours and "Family or caring" flagged.

**After a strike.**
- **How long it counts:** `strikes.live_days`, default 90, matching the mock-up's "strikes in the
  last 90 days".
- **When the record goes:** at `strikes.keep_months` (12), deleted by an owner-run
  `app_purge_old_strikes()` called from the nightly retention job. The app's login can't delete
  strike rows (S4), so this follows `app_purge_old_messages()` (migration 0034), and like it
  deletes nothing while `retention.hold_until` holds (a dispute or tribunal).
  - The `strike.issued` and `strike.withdrawn` log entries (ids, codes and hours only) stay in the
    action log, which isn't purged yet (`src/lib/gdpr/retention.ts:41-43`; `PLAN.md` Data 2). The
    help page, 6.2, 6.3 and the privacy notice say so rather than promising everything goes at
    12 months.
- **Telling the casual:** on screen, on the cancel step's done screen and on Profile (4.6). No
  message is sent.
- **What happens next is a person's decision.** Nothing happens automatically. Any pause in offering
  work goes through the existing "make inactive" control, which needs a reason and is logged.

**The page.**
- Views (links): Live · Needs review · All.
- Columns: casual, live strikes (the list sorts by this), latest strike (session, notice), review
  flag, evidence status. Stacked cards on phones.
- No menu badge and no CSV (the cancellations CSV has a strike column).

**Withdrawing a strike.**
- "Withdraw strike…" asks for a reason (1–500 characters).
- The strike row keeps who withdrew it, when and why; the log keeps `strike.withdrawn` without the
  reason text. The firm's planner hears about it by webhook (5.3).
- The casual sees it on Profile as withdrawn.

**"Keep strike"** marks a live strike as reviewed and clears its review flag if it has one (who
and when on the row; `strike.reviewed` logged with ids only). Built (12C.5) for any live strike not
yet reviewed, not only a flagged one, so the log entry doesn't reveal which strikes were flagged
(the flag comes from a health or caring reason).

**"Tell us what happened."** The casual's own account goes in as a `review` request (an existing
request type, no new columns), which the office sees in Enquiries' "Requests from the app".

**Erasing a casual** clears a strike's withdrawal reason, as it already does for cancellation notes
(`src/lib/gdpr/worker-erase.ts:34-38`).

**Payroll never sees strikes, and strikes never change pay.**

**Before a real firm uses strikes:** a DPIA for strikes (`docs/dpia-strikes.md`, 12C.1), because a
system that scores and flags workers is the kind of worker monitoring the ICO lists as likely high
risk. Firms get the template (6.3).

### 3.6 Enquiries (`/office/enquiries`, `/office/enquiries/[id]`)

**What counts as an enquiry:**
- every message to the shifts line (WhatsApp, text, voicemail transcript) from the last 90 days,
  the current message retention period;
- the office questions those messages create;
- requests made in the app (time change, swap, review), as their own view. These were the old
  "Requests" page.

**Counts:** enquiries today, and need a person (with the oldest one's age).

**Views** (links): All · Need a person · Requests from the app · Pay.

**Each row** shows the name (or "Unknown number" / "Withheld"), a channel icon with hidden text,
their words, an outcome chip and the time.

**Detail page:**
1. **The conversation.** Their message, then the exact reply as the casual saw it, styled like
   WhatsApp, then any later messages.
2. **"How it was answered".** A numbered timeline built from logged facts:
   1. Received: channel and time, matched to the casual's record (or unknown).
   2. Sorted: "The word 'shifts' matched", or "AI sorted it as 'pay'", or "AI not available: passed
      to a person (timed out / not connected / invalid label / photo only)".
   3. Checks made by code, each passed or failed with the data used. For example: "SIA door
      supervisor licence valid to 9 Jun 2028 ✓", "rest gap 11 h ✓", "weekly hours 38/48 ✓",
      "inside travel area (45 min from their home area, ZZ1) ✓", "clash: none", "event showing ✓".
      - The rules checks come from the rules engine itself. Today `checkEligibility()` reports only
        the checks that failed, without their data (`EligibilityResult`,
        `src/lib/rules/eligibility.ts:108-114`). 12D.2 makes it also return `checks: { code, passed,
        detail }[]` for every check it ran (credential and expiry, role, overlap, rest gap in
        hours, weekly hours used and cap, days off, blocked site), with `ok`, `reasons` and `codes`
        unchanged. That is a rules-engine change: the `guardrails-reviewer` and the rules-doc test
        apply.
      - The showing-switch and travel checks come from the caller.
      - The office never sees more of a casual's home than the district (6.3).
      - Step 3 and "Considered but not offered" are read from the reply's `enquiry.checks` entry,
        which 12D.2 writes and renders; until then (and for replies sent before it) the page says
        "No checks recorded".
   4. Reply built: the template and the sessions listed (as links).
   5. Sent: delivered, sent by text after WhatsApp failed, or failed with its error code.
   6. Then: for example "Zoe took the Arena shift at 21:20", or "Answered by Sam at 10:02".
3. **"Considered but not offered"** (office only). For example: "Response team lead: needs first aid
   at work (none on file)" or "Sun 11 Oct sessions: already booked 10:00–18:00". This answers "why
   can't Zoe see that shift?"

**Outcome labels come from code only**, never from AI: Answered by keyword · Sorted by AI, answered
from your data · Passed to a person, waiting · Passed to a person, answered · Not understood · Pay
(always a person) · Done in the app.

**Need a person:**
- **The reply box:**
  - Inside WhatsApp's 24-hour window, the reply goes as free text; outside it, as the
    `request_update` template. The page chooses and says which in one line.
  - It is stored as an outgoing `messages` row with `reply_to`. Today these replies aren't stored
    (`src/lib/inbound`). A reply to an unknown number is stored the same way (`messages.worker_id`
    may be empty).
- **"Close without a reply"** asks for a reason code from a fixed list: dealt with by phone / not
  for us / duplicate / spam / other. It is logged as `enquiry.closed` with the code, never typed
  text: typed text never goes in the append-only log (`src/lib/roster/cancel.ts:25-27`,
  `src/lib/office/worker-reasons.ts:1-3`), and a message from an unknown number has no request row
  to hold it (`requests.worker_id` is required, `src/lib/db/schema/roster.ts:303`).
- **Wording:** "approved/declined" becomes "answered" for questions (Messages 13).
- **Badge:** the Enquiries menu link counts them.

**Pay enquiries.** They carry a lock chip: "Pay: never answered by AI (rule)". The casual gets the
fixed pay reply and nothing else.

**Honest banner.** While `AI_TRANSPORT=none` (5.8), the page shows: "AI sorting isn't connected
yet: messages without a keyword go to a person."

**Data.** There is no new enquiries table:
- the enquiry is the `messages` row;
- its history is `events` rows, the log that can't be edited;
- its office question is the `requests` row (S5 adds a proper link).
- **Need a person** is worked out, not stored: an inbound message handled as office or unknown with
  no later `enquiry.answered` or `enquiry.closed` log entry for it (and, if it has a request, the
  request still open).
- **Request statuses keep their values** (`src/lib/db/schema/roster.ts:55-61`, 337-339): an
  answered question is stored `approved` and shown as "Answered", so no migration is needed.
- `/office/requests` redirects to the "Requests from the app" view.

`enquiry.checks` records, in 6.1's shape: every check with its figures, the offered session ids in
the order listed, at most 50 not-offered sessions with reason codes plus a count of the rest, the
bookings a cancel reply named, the template, whether the reply was sent, and the travel figures as
minutes only (never a postcode).

**Personal replies.** Built by a new `src/lib/inbound/personal-reply.ts`, from `openShiftsFor()` with
exactly the casual app's filters: eligibility, `visibleToCasuals` and the travel area. The words
are in 5.7. AI never writes them. The reply has a character budget, so it never goes over the
1,600 characters a WhatsApp or text body may hold (`src/lib/messaging/transport.ts:31,37`,
`src/lib/db/schema/messages.ts:94`; over it, the send or the save fails and the casual gets no
reply): names are cut to set lengths, fewer shifts are listed until it fits, and it ends "+ N more:
{link}".

### 3.7 Casuals (`/office/casuals`, `/office/casuals/[id]`)

**Views** (links, each with its count): All · Need updating · Uploads to check.

**Find a casual:** the existing find-a-worker form (`FindWorkerForm`,
`src/app/office/find-worker-form.tsx`) moves here from `/office/workers`, as built.

**Table columns** (stacked cards on phones):
- Casual (photo thumbnail, name, roles).
- Qualifications (a tag per item; the worst status first).
- Staff photo (upload date plus Up to date / Due soon / Overdue / Missing / Waiting for check).
- Travel area (postcode district only, e.g. "ZZ1 · 45 min, car or public transport").
- Live strikes.
- Needs updating (a short summary).

**One casual's page:**
- **Needs updating.**
- **Qualifications.** Each shows its status, expiry, the evidence image (through an access-checked
  link) and approve / reject.
  - Approving sets the expiry date and number, as read from the card by a person. For an SIA
    licence the form links the GOV.UK register (https://www.gov.uk/check-a-private-security-licence);
    there is no official SIA API.
  - Rejecting needs a reason: blurry / wrong document / expired / doesn't match / other.
  - **CSAS is recorded by the office only**; a casual can't upload it. Under the Police Reform Act
    2002 s.41 a chief constable accredits people employed by an organisation with a CSAS
    agreement, so an accreditation held through another employer doesn't cover this firm's CSAS
    shifts. Recording it confirms it is under this firm's own scheme. Noted in
    `docs/rules-and-credentials.md` and on the solicitor's list (6.4).
- **Staff photo**, with approve / reject.
- **Travel area:** district, time limit, transport.
- **Strikes.**
- **Bookings ahead.**
- **Access:** the existing controls moved from `/office/workers/[id]` (make inactive or active,
  unblock, site blocks).

**Uploads to check** (a view of Casuals): every waiting upload, oldest first. Every decision is
logged.

The staff-facing word is "qualifications" or "licences and cards", never "credential"
(`tests/unit/copy.plain-language.test.ts:57-58`).

### 3.8 Payroll dashboard (`/office/pay`)

**No database change.**

**Header:** "Pay dashboard", with the firm's shifts-line number under it (as on today's `/office`,
`src/app/office/page.tsx:31`), "Import pay records", "Send the digest now" (existing,
`queuePayDigestNow()`, `src/lib/pay/digest.ts:425`).

**Counts:**

| Count | Source |
|---|---|
| Pay queries waiting (oldest) | open + in_digest `pay_queries` |
| Next digest (last sent and how many; any problem) | new `nextDigestAt()` next to `digestDueOn()` in `src/lib/pay/digest-schedule.ts`; `loadDigestStatus()` |
| Sorted this week | `pay_queries.resolved_at` |
| Next pay date | the earliest `pay_records.pay_date` from today on, otherwise the Friday after the current ISO week (D8) |

**Sections:**
1. **Waiting, grouped by likely cause** ("Pay questions never get an AI answer: they come here"): the
   top groups from `loadPayQueryGroups()`, each opening `/office/pay-queries`.
2. **Recently sorted:** the last 7 days, with who, when and their note (a new loader).

**Rules kept:** payroll never sees strikes; resourcers never see pay record figures (what someone
was paid; `PLAN.md` Office 2). Session pay rates (£/hour) are shown to admins and resourcers on
event cards and records (requirement 3), because resourcers can already open the log and reports
(`src/lib/auth/roles.ts:15-16`) and the rate is shown to casuals anyway. Tested: a resourcer sees a
session's £/hour but never a pay record's amount (12B.5).

### 3.9 Needs attention (a section of the dashboard; the bell)

The to-do parts of today's Today page, plus Phase 12's new ones. Its items:
- bookings to check (Today's "to-check");
- from your rota sheet (sheet problems, including a failing sync);
- who worked? (to mark);
- a qualification expired on a booked session;
- uploads to check (12F.2);
- a strike evidence email failed, or the strikes-team address isn't set or confirmed (12C.4);
- your planner's webhook is failing (12J.2);
- your planner's change to a booked session was refused (5.3.2 step 5; 12J.1).

Each item links to where it is dealt with. The bell's count is the number of items. This keeps the
existing logic and the regions the tests pin, in one section of the dashboard. Admins and
resourcers.

### 3.10 Configuration (admin only)

**Settings** (`/office/settings`). Needs S10: an owner-run database function,
`app_set_firm_setting(key, value)`, the only way the app may change `firms.settings`.
- **Why a function, not a grant.** `firms.settings` also holds `retention.message_days`,
  `retention.request_note_days` and `retention.hold_until`, plus quiet hours, offer waves and the
  urgent window (`src/lib/onboarding/settings.ts:19-32`). A database permission can't be limited to
  some keys inside one column, and migration 0034, `src/lib/gdpr/retention-settings.ts:1-3` and
  `docs/compliance.md` promise that the app can't shorten retention or lift a hold.
- **What it accepts:** only `strikes.email` and `strikes.email_verified_at` (S11 adds `webhook.url`
  and `webhook.rotate`, and raises `webhook.signing_version` itself). It refuses `retention.*` and
  every other key, and clears the confirmed time whenever the address changes.
- **Tests:** the app's login can't change `retention.message_days`, `retention.hold_until` or any
  key outside the list, directly or through the function.

The page has two sections:
- **Strikes team email.** Saving the address sends a confirmation link, signed with HMAC (a
  tamper-proof signature) and valid for 7 days. The link signs the firm id, the address and the
  expiry, so a link sent for an old address can't confirm a new one. Evidence is only sent once the
  address is confirmed, which guards against sending to the wrong person (a common breach according
  to the ICO). `strikes.email` has no default; demo data only ever uses `.example` addresses.
- **Sites.** Each site's postcode can be edited (the app may edit `sites`,
  `src/lib/db/admin/access.ts:21`), with a status for whether its location is known (12G.1 looks it
  up on save). A postcode change is refused while the site has live bookings on sessions still to
  come ("{n} booked sessions use this site: move them first"), because changing it would move
  booked casuals' venue with no reason, notice or exemption (golden rule 12; 3.5 rule 4).

Every change is logged: `firm.settings_changed`, the entry the owner command already writes
(`scripts/firm-settings-owner.ts:14`), with the key only for the address and its confirmed time
(the log masker refuses an email address, 6.1); a site's postcode change as `site.changed` with the
site id and the field name only. The other Phase 12 values (strike hours and periods, photo renewal,
the travel default) are set by the owner with `firm:settings`, with the defaults in 5.2.

**Integrations** (`/office/settings/integrations`): API keys and the webhook address (5.3.4).

**Office team** (`/office/team`) and **Data requests** (`/office/data`) stay as they are. Worker
data export and deletion now include travel data, uploads and strikes.

### 3.11 What stays, moves or goes from today's office

Each move happens in the task that builds the replacement page; until then the old page stays in
the menu.

| Today's page | In v2 | Why |
|---|---|---|
| `/office` (Today for admin/resourcer; "Home" placeholder for payroll) | The role's home: Dashboard, or a redirect to `/office/pay` for payroll | The approved dashboard |
| `/office/today` | Merged into the Dashboard and its Needs attention section. The route redirects to `/office` | Compact. Every Today section has a home: urgent → dashboard; gaps → Events; requests and unknown numbers → Enquiries; cancellations → Cancellations; bookings to check, rota sheet, who worked → Needs attention; expiring → Casuals and Needs attention |
| `/office/shifts` (+ `new`, `event`, `import`, `[id]`) and `/office/offer/[shiftId]` | Off the menu. Events & sessions replaces the list. The routes stay and are reached from the event and session "…" menus, plus "Add/Import shifts" for firms without a planner | The planner owns shifts. The office's change and cancel forms are golden rule 12 evidence |
| `/office/requests` | Merged into Enquiries as "Requests from the app". The route redirects | One inbox |
| `/office/workers`, `/office/workers/[id]` | Renamed Casuals (`/office/casuals`), with compliance and the find-a-worker form. Access controls move to the casual's page. Old routes redirect | Requirement 8 |
| `/office/log` | Kept, under Records | Evidence |
| `/office/reports/notice` | Kept, under Records | Employment Rights Act readiness |
| `/office/reports/pilot` | Kept, under Records | Pilot |
| `/office/pay-queries` | Kept, under Pay. Linked from the Pay dashboard | – |
| `/office/pay/import` | Kept, under Pay | – |
| `/office/team` | Kept, under Configuration | – |
| `/office/data` | Kept, under Configuration, renamed "Data requests" | Shorter |
| `/office/guide` | Kept, under Help, rewritten | New layout |
| `/office/login`, `/office/l` | Kept, restyled | – |
| Mock-up "Casual's app" page | Not built | Avoids letting staff log in as a casual |

---

## 4. Casual app

### 4.1 Navigation and theme

- A bottom tab bar with four labelled items: Home · Shifts · Pay · Profile. Profile shows a dot when
  something needs updating.
- The firm's brand bar stays at the top.
- The theme follows the phone's setting.
- It is still a link, with no app to download.
- **Where today's parts of `/` go** (`src/app/page.tsx` today holds My shifts with Upcoming / Past
  30 days, the offline copy and Log out):
  - Booked lives at `/shifts` (Upcoming / Past 30 days, `?view=past` as today), next to Open under
    the Shifts tab; `/?view=past` redirects there.
  - The offline copy covers Home's next shift and Booked.
  - "My requests" (`/requests`: their own asks and the office's answers) is linked from Profile
    and from "Ask for a change".
  - Log out is the last item on Profile.

### 4.2 Home (`/`)

1. **"Hello Zoe"**, with "Updated 21:12".
2. **Needs updating** card, shown only when something does. One action per row ("Upload your new
   card", "Take a new photo"). Order:
   1. blocks a booked shift (expired, or expires before it);
   2. expired, or the photo overdue;
   3. expiring soon, or the photo due soon;
   4. missing, with "Needed for {role} shifts" (which qualifications are listed: 4.6).
3. **Urgent: needed now, and you can take them.** Urgent sessions inside her travel area. Each
   shows:
   - role · event, site (the site's name; the shift page has the full address);
   - date and time · £/hour · post;
   - the travel line;
   - places left;
   - requirement chips such as CSAS;
   - a button "See urgent shifts".
4. **Your next shift**, in full:
   - date and time, role · event, site, and the site's address (as today's next shift card);
   - post, pay ("£12.60 an hour, about £100.80"), report to (the meeting point), bring/uniform;
   - getting there (the travel line);
   - buttons: Open in maps · Ask for a change · Cancel this shift.
5. **Shifts you can apply for.** The top 3, with: "Only shifts your licences and hours allow, up to
   45 minutes from your home area." (The mock-up said "from ZZ1 4"; Home never carries more than
   the district: 6.3.)
   - Underneath: "2 more shifts are further than you travel. Change how far". "Change how far" goes
     to the travel settings.
   - A button: "See all open shifts".

### 4.3 Shifts tab (`/shifts/open`, plus Booked)

- **Two lists.** Open and Booked (Upcoming / Past 30 days, as today).
- **Order:** urgent first, then the nearest (the quickest of her chosen ways to travel), then by
  date.
- **Each Open row:** role · event, site, date and time · £/hour · post, requirement chips (CSAS),
  places left, then the travel line.
- **Filters:** the existing day, site and role filters stay as built
  (`src/app/shifts/open/page.tsx:12-41`); the 50-row cap's message still points to them ("Choose a
  day, site or role to see others"). No new filters.
- **Every row**, Open or Booked, urgent or not, has the travel line: "7.2 miles · 18 min by car · 41
  min by public transport".
  - Both times always show, whichever ways she chose; her choice only drives the filter.
  - With no public transport in time: "18 min by car · no public transport by 09:30".
- **Where the area filter is applied.** Inside the database query, before the 50-row cap
  (`src/lib/portal/open-shifts.ts:23-24,134-154`), so shifts nearby are never cut off.
- **No home area set:** a banner says "Add your home area to see how far each shift is and only see
  shifts you can get to", and the list is unfiltered (D2).
- **Site with no postcode, or no estimate yet:** the row says "Distance not known yet". It is never
  hidden silently.
- `/urgent` stays as the urgent-only view of this list.

### 4.4 Shift detail (`/shifts/[id]`)

- **Top:** chips (Urgent, any requirement such as CSAS) and a title: role, then place.
- **Facts:** date and time, pay (with the estimate), meet (meeting point), post, uniform, places
  left.
- **Getting there**, "From your home area" (her postcode shows only on Profile's "Where you work",
  her own setting):
  - "8.4 miles away";
  - "About 21 min by car";
  - "About 38 min by public transport";
  - "Open in maps".
- **What it needs.** Each requirement with her status: "You have it, valid until 3 Mar 2027" /
  "Expires before this shift" / "Missing: upload it" / "Being checked".
- **Action.** "Take shift", or the plain reasons she can't (existing blocked states).
- **Strike note:** "Cancelling less than 48 hours before the start gives you a strike."

### 4.5 Cancel step (on `/shifts/[id]`)

1. **Summary:** role · event, site · date, time · pay · post.
2. **Warning box:** one of the three sentences in 5.7 item 4, chosen by the same `strikeDecision()`
   that runs on confirm, so the warning always matches the result.
3. **"Why can't you make it?"** I'm unwell / Travel problem / Family or caring / Something else
   (with a note of up to 200 characters), as today (`src/lib/portal/cancel-reasons.ts`).
4. **Buttons:** "Confirm cancellation" (solid, using the new `--urgent-fill` colour) and "Keep this
   shift".
5. **Footer:** "Your cancellation is recorded the moment you confirm. Nobody needs to approve it."
6. **After confirming:** the reference, whether a strike was recorded and until when, and "Tell us
   what happened" (a `review` request about that booking, its reference filled in: 3.5).

The version of the warning she saw, and the time she confirmed with it on screen, are stored (S3; a
strike is only ever issued against a warning that said so, 12C.1).

### 4.6 Profile (`/profile`)

- **Kept as built, restyled:** "Your details" (read-only, with "To change your name or number, ask
  the office."; `src/app/profile/profile-view.tsx:59-65`) and Notifications (WhatsApp or text,
  open-shift alerts, the texts-off notice after STOP, and this phone's notifications:
  `profile-view.tsx:135-160`).
- **Staff photo.**
  - Shows the photo (72px) with alt text "Staff photo of Zoe Adeyemi".
  - "Last uploaded 3 Aug 2024 · renew by 3 Aug {year}", with a status: Up to date / Due soon /
    Overdue / Missing / Waiting for the office to check.
  - "Upload a new photo" opens the front camera (`<input type="file" accept="image/*"
    capture="user">`), with one line of guidance from the SIA photo checklist.
- **Qualifications.** Each has a status (Valid · Expiring soon · Expired · Missing · Being checked ·
  Not accepted: {reason} · Applied for · Suspended), a date line, and what it means: "Until it's
  renewed you won't see door supervisor shifts."
  - Plus "Upload a certificate" (not for CSAS, which the office records: 3.7).
  - Only checked, in-date items count (D3 and 6.1).
  - **Which qualifications are listed:** every type required by one of her roles
    (`credential_rules`), plus right to work. A listed type with no record is Missing, with "Needed
    for {role} shifts". A type nothing needs isn't listed. A session's extra requirements show on
    that shift's page (4.4).
- **Right to work:** status only (`PLAN.md` Rules 15). "Checked by the office on 12 Jan 2026" /
  "Not checked yet: ask the office". No upload; the documents stay with the office.
  - Not "you can't be booked": no role's rule requires right to work (`src/lib/rules/packs.ts:36`
    makes it a type any sector may use, checked at onboarding; lines 69-72 list the security
    roles' rules without it), so the rules engine can book a casual without one, and the copy is
    a product promise (golden rule 11).
- **Where you work** (`/profile/travel`):
  - start-from postcode (it can differ from home);
  - how she travels: Car / Public transport / Both;
  - time limit: 30 / 45 / 60 / 90 minutes;
  - a line explaining that the office only sees the district (e.g. ZZ1).
- **Strikes:** the count in the last 90 days and each strike (date, session, notice, counts until,
  status: live or withdrawn), with "Tell us what happened".
- **Days you can't work:** existing.
- **My requests**, **Help**, **Log out**.

### 4.7 Help (`/help`)

New plain-English sections:
- **Cancelling and strikes:** the 48-hour rule, what a strike means (a record, not a fine), how long
  it counts, how to tell us what happened, and how a strike is withdrawn.
- **Your travel area:** what it does, and who sees what.
- **Qualifications and photos:** uploading, and when the office checks them.
- The postcode data's attribution line (OS, Royal Mail, National Statistics, ONS OGL v3;
  https://ideal-postcodes.co.uk/guides/onspd-licensing), which the licence requires.

Checked by `tests/unit/copy.plain-language.test.ts`.

---

## 5. Data and integrations

### 5.1 Database changes

Every new table gets:
- `firm_id`, `created_at` and row-level security (the database rule that keeps each firm's rows
  separate);
- an entry in `src/lib/db/admin/access.ts` (the table-permissions list);
- isolation fixtures in `tests/helpers/tenant-rows.ts`;
- composite `(firm_id, x_id)` links to other tables;
- a review by the `guardrails-reviewer` agent.

Migrations are written with `npm run db:generate` and applied only with `npm run db:migrate`. The
next migration number is 0035.

| # | Change | Why | Status (`PLAN.md` "How the build is run" row) |
|---|---|---|---|
| S1 | New table `shift_events` (not `events`, which is the action log): id, firm_id, name (up to 200 characters), site_id, source (native/sheets/csv; `api` with S11), planner_ref, `showing_to_casuals` (default on), created_at. Plus `shifts.event_id` (link). Rows are never deleted, only hidden. The migration groups existing shifts into automatic events by date and site | Events, sessions and the showing switch | **Approved** (the core, 6 Oct). The two extras (`pinned`, `public_notes`) were cut (9) |
| S2 | On `shifts`: `pay_rate_pence` (whole pence), `post` (≤200), `meeting_point` (≤300), `uniform` (≤300), `required_credentials` (a list of extra qualification codes, all required, on top of the role's), `showing_to_casuals` (per-session switch, default on). Meeting point and uniform are public to casuals who can see the session; `instructions` stays visible only to booked casuals (this changes decision Data 19 for those two fields only). `required_credentials` changes the rules engine's input | Requirement 3 | **Approved** (10) |
| S3 | On `assignments`: `cancel_via` (app/office/sheet/import; `api` with S11; empty for older rows), `strike_warning_version`, `strike_warning_shown_at` | Cancellation evidence; proof of what the casual was told | **Approved** (11) |
| S4 | New table `strikes`: worker_id, assignment_id (one strike per booking), shift_id, notice_hours, threshold_hours, issued_at, expires_at, status (live/withdrawn; "expired" is worked out from the date), review_needed + review_reasons, reviewed_by/at, withdrawn_by/at/reason, evidence_email_status (pending/sent/failed/not_set_up), evidence_email_to, evidence_email_sent_at. Only an issued strike gets a row. The app can't delete rows. Plus an owner-run `app_purge_old_strikes()` (`SECURITY DEFINER`, like `app_purge_old_messages()` in migration 0034) that deletes strikes past `strikes.keep_months` and nothing during `retention.hold_until`, called by the nightly retention job | Strikes, withdrawals, evidence | **Approved** (12); built narrower than proposed (no representation, review outcome or casual-notified columns: their features were cut) |
| S5 | `requests.message_id` as a real link to `messages`, replacing the message id kept in the request's `payload`. It is cleared (`ON DELETE SET NULL (message_id)`) when the message is deleted at 90 days. Plus an index on `messages (firm_id, reply_to)` | Enquiries join messages, replies and questions reliably | **Approved** (13) |
| S6 | On `credentials`: `check_state` (verified/waiting/rejected; existing rows from imports set to verified), `rejected_reason`, `evidence_upload_id`. Start filling the existing `verified_at`/`verified_by` | Qualification statuses; uploads count only after the office checks them | **Approved** (14); built narrower (the proposal's `due_on`, `issuer`, `warn_days`, `needs_evidence` and `register_check` were cut) |
| S7 | New table `uploads`: worker_id, kind (photo/certificate), credential_type, content_type, size, sha256, data (the image bytes, stored in Postgres), uploaded_by, status (waiting/approved/rejected), checked_by/at, reject_reason. The current photo and its renewal date are worked out from the latest approved photo, so `workers` gets no new columns. Included in deletion and export, but the JSON exports carry each upload's details only, never `data` (5.5) | Staff photo and certificate uploads (D3) | **Approved** (15) |
| S8 | New table `worker_travel`: worker_id (unique), start_postcode, lat, lng, modes (car/public_transport/both), max_minutes, updated_at, privacy_notice_version. A separate table, so the erased-worker check (`src/lib/db/schema/people.ts:101-107`) is unchanged. Included in deletion and export | The travel area (D2) | **Approved** (16) |
| S9 | New table `travel_estimates`: origin_postcode, site_id, mode, arrive_by, minutes, metres, provider, computed_at, expires_at. Keyed by postcode, not by person | Distance and travel times without calling the provider on every page view | **Approved** (17); built narrower (no trip home, route or leave-by columns) |
| S10 | An owner-run database function, `app_set_firm_setting(key, value)` (`SECURITY DEFINER`, like migration 0034's), the only thing the app may call to change `firms.settings`. It accepts only `strikes.email` and `strikes.email_verified_at`, refuses `retention.*` and every other key, and clears the confirmed time when the address changes. Not a column-level grant: that would let the app change the whole field, retention and the hold included (3.10). The page checks admin on the server and logs every change | The Settings page (decision Office 1) | **Approved** (18); built narrower (one setting, not six groups) |
| S11 | The planner integration layer (5.3). (a) New table `api_keys`: id, firm_id, label (1–60 characters, trimmed), token_hash (bytea, unique), hint (the last 4 characters), created_by and revoked_by (composite links to `office_users`), last_used_at, revoked_at, created_at. The app may only read and add rows, and change `last_used_at`, `revoked_at` and `revoked_by` (`TABLE_ACCESS` `["SELECT", "INSERT"]` plus a `COLUMN_UPDATES` entry), so it can never rewrite a key's hash or label; no delete (a key's id is the actor on every change it made); left out of the firm's data export. Plus an owner-run `SECURITY DEFINER` function `app_api_key_lookup(hash)` that returns only the firm id and key id of a key that isn't revoked: **a new machine login path**, so this is an auth change as well as a schema change. Before that look-up, a key of the wrong shape is refused without touching the database, and each web process counts refused keys per client address in memory (30 a minute, then 429 before any look-up). (b) `webhook.url` added to `app_set_firm_setting()`'s accepted keys, plus `webhook.signing_version`, which the app can't set: the function adds 1 to it whenever `webhook.url` is set or cleared, and on one more accepted call, `app_set_firm_setting('webhook.rotate', null)`, that only adds 1 (an old, maybe leaked signing secret can never come back). (c) `api` added to `shifts.source` (`SHIFT_SOURCES`, `src/lib/db/schema/roster.ts:39`), `shift_events.source` (with a unique key `(firm_id, source, planner_ref)`) and S3's `cancel_via`. (d) **A second caller of the office's whole-session cancel and move** (`cancelShiftByFirm()`, `moveShiftByFirm()`, golden-rule-12 code that today accepts only an active admin or resourcer): `by: { type: "api", keyId }`, which skips the office-user check and instead checks, in the same transaction, that the key is still live (`select … from api_keys where id = keyId and revoked_at is null for share`); it is allowed only on API sessions, treats rest, weekly-hours and day-off failures as blocking (no person is there to override them), and logs with the `system` actor and `{ by: "firm", via: "api", keyId }`. Office callers get a new "planner" refusal for API sessions, as they get "sheet" for sheet ones. (e) The API does its work in the request, an exception to golden rule 3 (written into CLAUDE.md and ADR-022, 12J.1) | "Plug in and play with all planners" (D5) | **Needs Dylan's OK** (19) |

**No migration needed:**
- `sites.lat`/`lng` already exist (`src/lib/db/schema/tenancy.ts:90-92`); they just start being
  filled.
- New settings keys (5.2).
- CSAS and manual handling are added as qualification types and roles in `src/lib/rules/packs.ts`.
  That is a data change, kept in step with the docs by `tests/unit/credential.packs.test.ts`.
- API changes are logged with the existing `system` actor and `data: { by: "firm", via: "api",
  keyId }`, as the sheet sync logs its own (`src/lib/roster/sheets/sync.ts`), so the action log's
  actor types don't change. (`keyId`, not `apiKeyId`: the log masker hides any field whose name
  contains "apikey", `src/lib/log/mask.ts:142-143`, and `recordEvent()` then refuses the entry.)

**Parked, not in v2** (`PLAN.md` Parking lot, "Office v2 later items" and "Phase 12 cuts"): pay
status per shift (`pay_cycles`), a short-notice payments ledger, attendance confirmation, an "offer
to selected casuals" table, a separate right-to-work checks table, and the cut columns above.

### 5.2 New settings (stored in `firms.settings`, no migration)

Each key needs a `SETTING_KEYS` entry and a reader function in `src/lib/onboarding/settings.ts`,
`firm:settings` support, and a line in `docs/data-model.md`.

| Group | Keys and defaults | Changed by |
|---|---|---|
| Strikes | `strikes.notice_hours` 48 (kept separate from the existing legal `short_notice_threshold_hours`, so firm policy doesn't move when the law changes), `strikes.live_days` 90, `strikes.keep_months` 12 | the owner (`firm:settings`) |
| Strikes team | `strikes.email` (none), `strikes.email_verified_at` | admins, on Settings (S10) |
| Qualifications and photos | `credentials.expiring_days` 30, `photo.renewal_months` 36 (D3) | the owner |
| Travel | `travel.default_max_minutes` 45. Which provider to use is a server environment setting (`TRAVEL_PROVIDER`: `fake` or `traveltime`), not a per-firm setting | the owner |
| Planner webhook | `webhook.url` (none); `webhook.signing_version` (0; only ever raised by `app_set_firm_setting()` itself) | admins, on Integrations (S11) |

`retention.*`, quiet hours, offer waves, the urgent window, the digest time (`pay_digest`) and the
short-notice threshold stay owner-only, as today.

### 5.3 Planner integrations: API in, webhooks out

Added 2026-10-06 on Dylan's decision: "plug in and play with all planners using webhooks and apis
not another sheet". It replaces the sheet "Cancellations" column and the daily "changes for your
planner" email, which are not built.

**Words used in this section:**
- **API key:** a long random password that a machine uses instead of a login.
- **Webhook:** an HTTPS POST that ShiftDesk sends, the moment something happens, to an address the
  firm chose.
- **Signature:** a tamper-proof stamp (HMAC-SHA256). The planner checks it to know a message really
  came from ShiftDesk.

#### 5.3.1 In short

- **In:** a small REST API. A planner or CRM sends its sessions (with their event and site) by its
  own ids, and reads a session's bookings and the cancellations since a time.
- **Out:** signed webhooks, the moment a booking is made or cancelled (with the full record and the
  strike result) or a strike is withdrawn. The planner marks its own session CANCELLATION from the
  webhook.
- **Plug and play:** an admin opens Integrations, creates a key and pastes a webhook address. No
  adapter per planner. A planner that can't call an API or take webhooks itself can go through
  Zapier, Make or n8n, whose generic HTTP steps do both.
- **Nothing new to trust.** The API never books anyone, never decides eligibility and never calls
  AI. Changes to booked sessions go through `moveShiftByFirm()` and `cancelShiftByFirm()`: the
  rules engine, notice hours and the notices to casuals (golden rules 1, 6, 12). Both accept only
  an active office user today, so S11 adds the API as a second, narrower caller (5.1 S11 (d)).
- **One database change, S11** (5.1), which also adds a new machine login: approved by Dylan on 2026-10-06.
- **Webhooks need the worker**, which runs in production only once Twilio is connected
  (`deploy/docker-compose.yml`: the worker refuses the console messaging transport in
  production). The API itself runs on the web app alone.
- **The Google Sheets plug and the file import stay as built, frozen** (5.3.5).

#### 5.3.2 The API

**Where.** `https://{APP_BASE_DOMAIN}/api/v1/...`, the platform address, like Twilio's webhooks
(`platformUrl()`, `src/lib/tenancy/portal-url.ts:28`). On a firm's subdomain or its own domain,
every `/api/v1` path answers 404. Locally: `http://localhost:3000/api/v1`. Server to server only: no
cookies are read and no CORS headers are sent. The proxy's trailing-punctuation redirect
(`src/lib/http/proxy.ts:47-55`, a 308 that keeps the method, body and key) skips every `/api/`
path, so a call is never sent on to a different address.

**Format.**
- JSON only (`content-type: application/json`, else 415), at most 64 KB (else 413).
- Every body is checked with `z.strictObject` at the boundary: an unknown field is a 400, so a typo
  never fails silently.
- Field names are `snake_case`. Times are ISO 8601 with an offset in requests and UTC `Z` in
  responses. Money is whole pence.
- Responses never hold a mobile number, an email address, a casual's postcode or anything a casual
  typed.

**Keys and tenancy.**
- A key is `shiftdesk_` followed by 43 random characters (`newToken()`). Only its sha256
  (`hashToken()`) and its last 4 characters are stored (S11). It is shown once, on creation: "Copy
  this key now. You won't see it again." It never appears in a URL, a log line or the action log.
- It is sent as `Authorization: Bearer <key>`.
- **The key decides the firm**, never the body, path or host. `app_api_key_lookup(hash)`, an
  owner-run function like `app_firm_by_line()` (`drizzle/0021_firm_by_line.sql`), returns the firm
  id and key id; all work then runs inside `withFirm(firmId)`, so row-level security scopes every
  row. It joins `resolveFirmBySlug()` and `resolveFirmByLine()` as the look-ups allowed before a
  firm is known (CLAUDE.md conventions and `scripts/invariants.sh` change with S11's OK).
- A bad or revoked key: 401 `invalid_key` (the same answer for both). Another firm's ref looks like
  an unknown one: 404.
- **Before the look-up:** a key of the wrong shape (`shiftdesk_` and 43 base64url characters,
  `looksLikeToken()`) is refused without touching the database. Refused keys are counted per
  client address (`X-Real-IP`, set by Caddy) in each web process's memory, as bad Twilio
  signatures are (`src/lib/ops/signature-spike.ts`); after 30 in a minute, that address gets 429
  `rate_limited` before any look-up. (`throttle()` can't do this: it needs a firm.)
- Admins create and revoke keys (at most 10 live per firm). Revoking works at once. A key row is
  never deleted.
- **Rate limit:** 300 calls a minute per key through the existing `throttle()`; over it, 429 with
  `Retry-After`.
- **Gate B (golden rule 7):** on a live database, a key can't be created and writes are refused
  (403 `agreement_not_recorded`) until the firm's agreement is recorded (the same check as imports,
  `src/lib/imports/gate-b.ts`).
- **Logging:** every change the API makes is an action-log entry like the office's, with the
  `system` actor and `data: { by: "firm", via: "api", keyId }` (5.1). `api_key.created` and
  `api_key.revoked` hold the key id only (the label is typed text). Each request writes one server
  log line (route, status, milliseconds, firm id, `keyId`), never a body, a key or the
  `Authorization` header. `last_used_at` is updated at most once a minute.
- **Work happens in the request**, not in a job: the caller needs the answer, such as "the rules
  refused this move for 2 casuals". The API is not a provider webhook: a PUT by the planner's ref
  makes repeats safe, and each write is one short transaction. Golden rule 3 gains this exception
  in CLAUDE.md, recorded in ADR-022 (both 12J.1, with S11's OK). Offer waves, notices, travel
  estimates and webhooks still go to jobs.
- **Unset `INTEGRATIONS_SECRET`** (5.3.6): every call answers 503 `not_configured`.

**Calls:**

| Method and path | What it does |
|---|---|
| `PUT /api/v1/sessions/{ref}` | Create or update a session (with its event and site) by the planner's own id; `"status": "cancelled"` cancels it |
| `GET /api/v1/sessions/{ref}` | The session as ShiftDesk holds it, with every booking (live and cancelled) |
| `GET /api/v1/cancellations?since={time}` or `?cursor={next_cursor}` | Cancellation records, oldest first, ordered by (cancellation time, booking id), at most 100 a page: the same objects as the webhook's `data`. Each page gives `next_cursor` (an opaque base64url of the last record's time and booking id), or `null` once caught up (fewer than 100). One whole-session cancellation stamps every booking with the same time, so only the cursor pages through them without repeats or gaps. A cancellation can be committed a moment after a later one, so each new poll starts again from `since=` a few minutes before your last record; repeats are safe, because each record carries the booking ref |

A ref must match `^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,198}[A-Za-z0-9])?$` (it ends with a letter or a
digit, so no sentence punctuation can be lost from it), else 400 `bad_ref`. A ref is unique per
firm, so the same ref in two firms is two separate sessions.

**`PUT /sessions/{ref}` body** (all made up):

```json
{
  "event": { "ref": "RACEDAY-2026", "name": "Raceday" },
  "site": { "name": "Acme Demo Racecourse", "postcode": "ZZ9 9ZZ" },
  "role": "steward",
  "starts_at": "2026-10-07T10:30:00+01:00",
  "ends_at": "2026-10-07T18:30:00+01:00",
  "places": 6,
  "status": "open",
  "pay_rate_pence": 1260,
  "post": "Gate B",
  "meeting_point": "Staff entrance, Gate B",
  "uniform": "Black trousers, boots. Hi-vis provided.",
  "requirements": ["CSAS"],
  "instructions": "Ask for the steward lead on arrival.",
  "change_reason": "event_changed"
}
```

**Field rules:**
- **Required on create:** `role`, `starts_at`, `ends_at` and `site.name`. A field left out stays as
  it is; `null` clears it.
- **`role`:** read with the sheet parser's `normaliseRole()`, so "Door supervisor" becomes
  `door_supervisor`. It must then be one of the firm's own role codes (the list under "Codes your
  planner can use", 5.3.4), else 422 `unknown_role` and nothing is created: `normaliseRole()` only
  checks the shape (`src/lib/roster/sheets/parse.ts:114-120`), and a typo would make a session
  nobody can ever be offered.
- **`places`:** 1 to 1000. **`status`:** `open` or `cancelled`.
- **Lengths:** `post` up to 200 characters, `meeting_point` and `uniform` up to 300,
  `instructions` up to 2,000 (booked casuals only, as today), `event.name` up to 200.
- **`requirements`:** at most 20 of the firm's own qualification codes. An unknown code is a 422
  `unknown_requirement`.
- **`change_reason`:** one of `SHIFT_CHANGE_REASON_CODES` (`src/lib/roster/firm-reasons.ts`).
- **`event`:** without one, the session joins an automatic event by date and site (3.3).
- **`site`:** found or created by name. A postcode only fills a site that has none (which queues
  travel estimates, 5.4). A different postcode for a site that already has one is 409
  `site_postcode_differs` ("Change it in ShiftDesk Settings, or send a different site name"):
  sites are shared by name across every source, so one PUT would otherwise move every session
  there, booked and sheet ones included, with no reason, notice or strike exemption.
- **New sites and events** are created with `insert … on conflict do nothing`, then read back, so
  two PUTs naming the same new site or event at once both succeed and share one row (the keys
  `sites_firm_id_name_key` and S11's `(firm_id, source, planner_ref)`).
- **The showing switches and "urgent" are never read from the API**: they stay the office's (3.3).

**What a PUT does, in order:**
1. **New ref.** One that starts in the past: 409 `session_started`. `"status": "cancelled"`: 200
   `unchanged`, nothing created. Otherwise a session with `source: "api"` and `external_ref: ref`
   is created, its event and site found or created, and `shift.created` logged: 201.
2. **Nothing different:** 200 `unchanged`, nothing logged.
3. **Already started, or already cancelled:** 409 `session_started` or `session_cancelled`. A
   cancelled session is never reopened; the planner sends a new ref.
4. **No live bookings:** the change is applied and `shift.changed { fields }` logged (6.1's shape).
   The status follows the places, as in the file import (`refreshShiftStatus()`,
   `src/lib/imports/import.ts`).
5. **Live bookings:**
   - **Places, pay, post, meeting point, uniform, instructions, event name:** applied. Bookings
     hold numbered places, and only places up to the session's number count
     (`src/lib/roster/native.ts:199,213,346`), so places can go down only as far as the highest
     place a live booking holds, the office editor's rule (`src/lib/office/shift-editor.ts:275`);
     lower is 409 `places_below_booked` ("A booking holds a place above that number. Ask the
     office to cancel it, or send more places."). After any change the status follows the places
     (`refreshShiftStatus()`). A pay change counts as "the office changed it" for strikes (3.5
     rule 4).
   - **Times or site:** need `change_reason` (else 422 `change_reason_required`), then
     `moveShiftByFirm()` runs with the API caller: the rules for each booked casual. Any failure,
     including the rest, weekly-hours and day-off checks an office person may override, gives 409
     `bookings_block_change` with each casual's id and codes, and nothing changes: through the API
     nobody is there to see a warning, so a machine can't push a casual past the 11-hour rest or
     the 48-hour week. Otherwise notice hours are recorded and the change notices queued (golden
     rule 12).
   - **Role or requirements:** 409 `session_has_bookings`, as the file import does today
     (`src/lib/imports/import.ts:632`). The office cancels those bookings first.
   - **`"status": "cancelled"`:** needs `change_reason`, then `cancelShiftByFirm()` runs with the
     API caller: each booking becomes the firm's cancellation with its notice hours and
     `cancel_via` `api`, each casual is told, and no strike is ever given.
   - **A refused change is shown in ShiftDesk too:** the planner may ignore the 409 (an automation
     step often does), and then shows a time ShiftDesk's casuals never heard about. So
     `shift.move_refused` (with `via: "api"`) and a new `api.change_refused { shiftId, code }` (for
     `session_has_bookings` and `places_below_booked`) raise a Needs attention item (3.9), worked
     out from the log (no schema change): "Your planner's change to {session} was refused: {n}
     booked casuals can't work it. Cancel their bookings, then ask your planner to send it again."
     It clears when a later `shift.changed`, `shift.moved` or cancellation of that session is
     logged.
6. **Two PUTs for one ref at once:** the row lock makes them queue. A create race hits the unique
   key `(firm_id, source, external_ref)` (`src/lib/db/schema/roster.ts:193`) and is retried once as
   an update.

**What the office can do with an API session:** it can't edit, move or cancel it as a whole ("This
session comes from your planner. Change it there."), as with sheet sessions. That refusal depends
on the caller, inside `moveShiftByFirm()` and `cancelShiftByFirm()` (which today refuse only
`source: "sheets"`): an office caller gets a new `planner` status for an API session, and the API
caller is allowed only on API sessions. The office can show or hide it, mark it urgent, offer it,
assign someone, and cancel one booking (which the planner hears about by webhook, with `by:
"office"`).

**Errors.** Every error body is `{"error": {"code", "message", "request_id"}}`. The message is one
plain sentence. Values sent in are never echoed back.

| Status | Codes |
|---|---|
| 400 | `bad_json`, `validation_failed` (with `fields: [{path, code}]`), `bad_ref`, `bad_since`, `bad_cursor` |
| 401 | `invalid_key` |
| 403 | `agreement_not_recorded` |
| 404 | `not_found` |
| 409 | `session_started`, `session_cancelled`, `session_has_bookings`, `places_below_booked`, `bookings_block_change`, `site_postcode_differs` |
| 413 / 415 | `too_big` / `not_json` |
| 422 | `change_reason_required`, `unknown_role`, `unknown_requirement` |
| 429 | `rate_limited` (with `Retry-After`) |
| 503 | `not_configured` |

**Versioning.** `/api/v1` only ever gains things (new optional fields, calls, error codes or webhook
types). A breaking change becomes `/api/v2`.

**Order of PUTs.** Nothing orders two PUTs for one ref, so an old PUT retried after a newer one
succeeded would undo it and tell booked casuals twice. `docs/integrations.md` says: send a ref's
PUTs one at a time, never retry an older one after a newer one succeeded, and switch off automatic
replays of old steps (Zapier's Autoreplay, Make's) for these calls.

#### 5.3.3 Webhooks

**Types** (a receiver ignores the ones it doesn't use):

| Type | When | Queued from (action log) |
|---|---|---|
| `booking.created` | A casual took a session, the office assigned someone, or a rota sheet's name was booked | `shift.assigned` |
| `booking.cancelled` | Any booking cancelled: by the casual, the office, the planner (API) or the rota sheet. It carries the full record and the strike result | `shift.cancelled` (one per booking) |
| `strike.withdrawn` | The office withdrew a strike | `strike.withdrawn` |
| `test.ping` | "Send test event" | – |

**The body** (all made up):

```json
{
  "id": "evt_Q2x7mN4pR8sT1vW3yZ5bAa",
  "type": "booking.cancelled",
  "timestamp": "2026-10-06T18:05:12Z",
  "firm": { "id": "6f1c0e2a-…", "slug": "acme" },
  "data": {
    "session": {
      "id": "0b9e…", "ref": "RACEDAY-STW-0710", "source": "api",
      "event": { "id": "41d2…", "ref": "RACEDAY-2026", "name": "Raceday" },
      "site": { "name": "Acme Demo Racecourse", "postcode": "ZZ9 9ZZ" },
      "role": "steward", "starts_at": "2026-10-07T09:30:00Z", "ends_at": "2026-10-07T17:30:00Z",
      "status": "open", "places": 6, "booked": 5,
      "pay_rate_pence": 1260, "post": "Gate B", "meeting_point": "Staff entrance, Gate B",
      "uniform": "Black trousers, boots. Hi-vis provided.", "requirements": []
    },
    "booking": {
      "id": "b71e0c42-…", "ref": "B71E0C42", "status": "cancelled",
      "casual": { "id": "9a0d…", "staff_ref": "ST-0042", "first_name": "Kieran", "last_name": "Doyle" },
      "booked_at": "2026-10-01T12:00:00Z", "booked_by": "casual",
      "cancellation": {
        "at": "2026-10-06T18:05:12Z", "by": "casual", "via": "app", "notice_hours": 15.42,
        "reason_code": "casual_own_reason",
        "strike": { "status": "issued", "live_strikes": 2 }
      }
    }
  }
}
```

**Field values:**
- **`id`:** `evt_` plus 22 characters of an HMAC (keyed with `INTEGRATIONS_SECRET`) of the firm id
  and the action-log entry's id: the same on every try, and it never shows the shared log number.
- **`booking.status`:** `booked`, `cancelled`, `worked` or `no_show`. **`booked_by`:** `casual`,
  `office` or `sheet`. **`cancellation.by`:** `casual`, `office`, `planner` or `sheet`. **`via`:**
  S3's `cancel_via`.
- **`reason_code`:** every one of a casual's quick reasons reads `casual_own_reason` ("I'm unwell"
  is health data: 6.3). Office reasons keep their fixed code; the sheet's read `sheet_change`.
- **`strike.status`:** `issued`, `exempt` (with `exempt_reason`: `booked_by_office`,
  `rules_override` or `office_changed_it`), `none` or `withdrawn`. Review flags and withdrawal
  reasons never leave ShiftDesk.
- **`casual`:** `null`, with `"erased": true`, after a GDPR erasure.
- **Never sent:** a mobile, an email address, a casual's postcode or travel data, health or
  free-text reasons.
- **A contract, tested:** one zod schema per webhook type, the same one `docs/integrations.md`
  prints, parsed against real bodies (12J.2), so a body that is privacy-safe but missing a field
  fails.

**Built when sent, from the rows.** The job carries ids only, so nothing personal sits in a queue,
an erasure needs no extra work, and a late retry shows the booking as it is now.

**Signing** follows the open Standard Webhooks spec (https://www.standardwebhooks.com/), so a
receiver can check it with an existing library. Headers:
- `webhook-id`: the event id;
- `webhook-timestamp`: Unix seconds of this try;
- `webhook-signature`: `v1,` plus the base64 HMAC-SHA256 of `"{id}.{timestamp}.{body}"`;
- `content-type: application/json`, `user-agent: ShiftDesk-Webhooks/1`.

The signing secret is `whsec_` plus the base64 of HMAC-SHA256(`INTEGRATIONS_SECRET`,
`"webhook|{firmId}|{webhook.signing_version}"`). It is worked out when needed and never stored: the
page shows it once, when the address is added. Adding an address or "New signing secret" makes
`app_set_firm_setting()` add 1 to `webhook.signing_version` (the app can't set it, so an old secret
can never come back), and the old secret stops at once. (Not `secret_version`: the log masker hides
any field whose name contains "secret", and `firm.settings_changed` names each key.) Receivers
refuse timestamps more than 5 minutes off and drop repeats by `webhook-id`.

**The action log is the outbox.** `recordEvent()` (`src/lib/events/record.ts`) calls
`queueWebhooks(tx, eventId, action)` (new `src/lib/integrations/outbox.ts`) for `shift.assigned`,
`shift.cancelled` and `strike.withdrawn` when the firm has a `webhook.url`. It queues one
`webhook-deliver` job (`sendFirmJob()`, ids only) in the same transaction, so a rollback queues
nothing. Every booking and cancellation path already writes these entries through `recordEvent()`
(`bookShift`, `cancelBooking`, `cancelShiftByFirm`, the sheet sync, the API), so none can be missed.
`recordEvents()` (bulk, used for pay entries) returns no ids, so it throws if handed one of these
three actions: a future bulk path can't skip delivery silently.

**The `webhook-deliver` job** (a firm task on its own queue).
1. Builds the body from the rows and signs it.
2. Sends one POST, following no redirects, with a 5-second connect and 10-second total limit (one
   `AbortSignal`). It reads at most 1 KB of the answer and keeps none of it.
3. A 2xx answer: logs `webhook.delivered { eventRef, bookingId }`. Anything else throws, and
   pg-boss tries again: the queue has its own retry settings (`retryLimit` 6, `retryDelay` 60,
   `retryBackoff` true, `retryDelayMax` 1800, about an hour in all; `firmQueue()` sets none today,
   and pg-boss's default is 2 retries with no wait). The queue is registered with
   `includeMetadata`, and `runFirmTask()` passes the try number on, so the last try logs
   `webhook.failed { eventRef, bookingId, code }` (`http_500`, `timeout`, `dns`, `tls`,
   `refused_address`, `redirect`), raises the Needs attention item (3.9) and then **completes**
   the job instead of failing it: a firm's own endpoint problem isn't counted by
   `failedJobCounts()` as an ops alert to Dylan. The planner catches up with `GET
   /api/v1/cancellations`.
- **One firm can't hold up another:** each job is sent with `group: { id: "webhook" }`
  (`firmScoped()` prefixes the firm id), and the queue runs with `localConcurrency` 4 and
  `localGroupConcurrency` 1, as the shifts line does (`INBOUND_WORK_OPTIONS`,
  `src/worker/jobs/index.ts`), so a slow firm uses one loop of four.
- At least once: after a crash between sending and logging, a webhook may arrive twice with the
  same `webhook-id`.
- Order isn't promised: a receiver applies the latest `booking.status`.

**Safe sending** (new `src/lib/integrations/send.ts`). The worker shares a network with the
database, so an address must never reach inside it.
- **When an address is saved:** `https://`, port 443, a DNS name of at most 500 characters; no IP
  address, no `user:password`; not ShiftDesk's own base domain or a firm's host.
- **On each try:** the name is resolved and every address must be public, checked against a
  `node:net` `BlockList` holding an explicit list: 0.0.0.0/8, 10/8, 100.64/10, 127/8,
  169.254/16 (including the cloud metadata address), 172.16/12, 192.0.0.0/24, 192.168/16,
  198.18.0.0/15, 224.0.0.0/4 (multicast), 240.0.0.0/4 and 255.255.255.255/32; ::/128, ::1/128,
  ::/96 (IPv4-compatible), ::ffff:0:0/96 (IPv4-mapped), 64:ff9b::/96 (NAT64), 2002::/16 (6to4),
  fc00::/7, fe80::/10 and ff00::/8; after those, an IPv6 address must also be in 2000::/3. A name
  that resolves to any refused address is refused, even with a public one beside it.
- **The checked address is the one used:** the POST goes through `https.request` with a `lookup`
  option that returns only the address already checked, so DNS can't change in between, while the
  name still drives SNI and the certificate check.
- **The address is a secret.** Zapier, Make and n8n catch-hook addresses carry their key in the
  path, and the log masker strips only query strings. So errors thrown by `send.ts` carry a code
  only (the list above), never the address; server log lines hold the host only; the action log
  holds the key `webhook.url` only (6.1); and the page shows the host and the last 4 characters.
- **Transports**, like messaging, in the worker only: `WEBHOOK_TRANSPORT=console` (the development
  default; prints the signed request with the address cut to its host) or `https` (required in
  production); tests inject a fake.

#### 5.3.4 The Integrations page (`/office/settings/integrations`)

Admin only; one Configuration menu link. On phones each table becomes stacked cards. Every action
is a server action checked inside the firm's transaction. A key or secret is shown only in the
action's answer, once: it is gone on reload.

1. **Your planner.** One line: "Connected by API · last change from your planner 09:41", or
   "Google Sheet · synced 09:40", or "Not connected. Your planner can send sessions with an API key
   and hear about bookings and cancellations by webhook. How to connect your planner" (a link to
   the guide).
2. **API keys** ("Create a key"). Columns: Name, Key ("…k3F9"), Created (who, when), Last used,
   "Revoke". Creating asks for a name, then shows "Copy this key now. You won't see it again."
   Revoking asks: "Revoke {name}? Your planner stops reaching ShiftDesk at once."
3. **Webhook** ("Add a webhook"). The address, shown as its host and last 4 characters
   ("https://hooks.example/…k3F9"), and its status ("Working · last delivered 09:42" or "Failing
   since 03:10", from the log); buttons "Send test event" (queues a `test.ping` delivery job, so
   the web app never sends to the internet itself), "New signing secret", "Remove". Adding ends
   with: "Signing secret: whsec_… Copy it into your planner now. You won't see it again."
4. **Codes your planner can use.** A `<details>` list of the firm's role codes and qualification
   codes, for `role` and `requirements`.

Elsewhere: the cancellation record's "Your planner" line (3.4) and the Needs attention item (3.9).

#### 5.3.5 The Google Sheets plug and the file import

Kept exactly as built and frozen: bug and security fixes only, no new columns or features. The
Sheets plug is the only no-code route for the spreadsheet firms ShiftDesk sells to first, and the
file import also carries casuals, qualifications and pay records.
- Sheet and file sessions get automatic events (3.3), and their S2 fields are set in ShiftDesk's
  session editor.
- The sheet sync still takes a cancelled casual's name out of the Assigned cell, as today.
- API sessions have `source: "api"` and book through the native plug: `plugFor()` already treats
  every source except `sheets` as native (`src/lib/roster/book.ts:341-344`). No new `RosterPlug`.

#### 5.3.6 Settings, golden rules and privacy

**New environment settings** (`deploy/env.example`; the runbook):
- `INTEGRATIONS_SECRET` (web and worker): at least 32 characters, and the example value is refused
  in production. It derives the signing secrets and the event ids. Rotating it changes both, so
  every firm with a webhook must paste its new secret (runbook).
- `WEBHOOK_TRANSPORT` (worker only, like `MESSAGING_TRANSPORT`): `console` or `https`, `https`
  required in production. Not a web setting: the production-mode web app in CI and the walkthrough
  runs with `NODE_ENV=production`, and the web never sends a webhook.
- **Pinned for every test run:** `INTEGRATIONS_SECRET` gets a made-up test value and
  `WEBHOOK_TRANSPORT` `console` in `serverEnv()` (`playwright.config.ts`, also used by the
  walkthrough's run) and in `tests/setup/env.ts`, because both load `.env`; the worker's settings
  refuse `https` when `NODE_ENV=test`.

**Golden rules:**
- **1:** no AI anywhere in this layer.
- **2:** the key decides the firm, every call runs in `withFirm`, and `api_keys` has row-level
  security.
- **3:** a PUT with the same body twice changes nothing; webhooks dedupe on the event id. The API
  answers in the request rather than in a job, the one exception, written into golden rule 3
  (5.3.2 "Work happens in the request").
- **4 and 6:** the API can't book anyone; moves run the rules for each booked casual, and through
  the API every failed check blocks the move.
- **5:** every change is logged, with the key's id (`keyId`).
- **12:** planner moves and cancellations carry a reason code, notice hours and a notice to each
  casual. They count as the firm's in the notice report and never give a strike.

**UK GDPR:**
- The firm is the controller; its admin chooses where data goes.
- Sent: names, staff refs, session and booking facts, and strike status. Never sent: mobile, email,
  a casual's postcode or travel data, health or free-text reasons, review flags.
- `api_keys` is left out of the firm's data export.
- The strikes DPIA (12C.1) lists the firm's planner as a recipient of strike status.
- Erasure: as with the file import, the runbook tells the firm to remove the person from its
  planner too.

Delivery is plain HTTPS from the worker, so it runs on any Docker host (5.8).

### 5.4 Travel times: provider, cost, privacy

**Recommendation and decision: TravelTime** (D1). It covers UK driving and public transport fully
(https://docs.traveltime.com/api/overview/supported-countries).

**Why not Google Routes:**
- **Storage rules:** results mostly can't be stored
  (https://developers.google.com/maps/documentation/routes/policies), so we would pay on every page
  view.
- **Cost:** the research estimate for one 300-casual firm is about $1,450 a month at list price
  (https://developers.google.com/maps/billing-and-pricing/pricing).
- **Map rules:** it adds display rules about Google maps.

**How TravelTime is used:**
- The normal `/time-filter` endpoint, with real arrive-by times. The `/fast` endpoint only knows
  weekday mornings, which is wrong for evening and weekend events.
- **Per session and per way of travelling, one search:**
  - arrive at the site's coordinates 30 minutes before the start (a fixed time to sign in);
  - departure points are the distinct postcodes of casuals with that role (up to 2,000 per search);
  - a travel-time ceiling of 90 minutes;
  - ask for the distance (by car).
- **Pricing and terms:**
  - a fixed yearly subscription, 12 months minimum; **the production price isn't published, so we
    need a quote** (https://traveltime.com/pricing; `PLAN.md` Checks 14), sized for the searches
    above (usage limits: https://docs.traveltime.com/api/overview/usage-limits);
  - the production plan includes the right to store and reuse results;
  - the free Basic key is "not for commercial use", so it is for development and the demo only.
- **Case study:** Brigad saw late withdrawals fall from 6% to 2%
  (https://traveltime.com/case-study/brigad-case-study).

**When estimates are worked out** (the travel job; pages never call the provider):
- a session is created, imported, synced or sent by the planner, or marked urgent;
- a session's time or site changes, or a site's postcode changes;
- a casual's postcode or ways of travelling change;
- nightly, for every session in the open-shifts window (`OPEN_WINDOW_DAYS`, 28 days,
  `src/lib/portal/open-shifts.ts:23`) that is missing an estimate (a safety net).

So an urgent session added this morning for tonight has its travel lines before its first wave.

**An unknown estimate** (the job hasn't run yet, or the site has no postcode) is shown as "Distance
not known yet", never hidden (D2). Offer waves still offer such a session, so the travel limit never
silently stops a casual being offered work.

**If the provider is down:** straight-line miles worked out from coordinates, labelled "about 7
miles (straight line)", with "Travel time not known yet". Shifts are never hidden silently.

**Postcode to coordinates:** postcodes.io, free and keyless (https://postcodes.io/docs/overview/).
Only the postcode is sent, never who it belongs to.
- The licence attribution line goes on `/help` (4.7).
- Northern Ireland (BT) postcode data needs a separate licence: flag this before any NI firm signs
  up (`PLAN.md` Checks 16).

**Tests and demo:** a fake geocoder and a fake travel provider (like the console messaging
transport), with fixed coordinates and times for the made-up ZZ postcodes.

**Privacy** (`PLAN.md` Data 21):
- **Lawful basis:** legitimate interests with a written balancing test, not consent, because of the
  power imbalance between employer and worker
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/when-is-consent-appropriate/).
- **Impact assessment (DPIA):** required before the travel area is switched on for any real firm,
  because the ICO lists employee location data as likely high risk
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk/).
  A DPIA has to come before the processing starts. Neither it nor the balancing test exists yet:
  both are deliverables of 12G.1 (`docs/dpia-travel.md`), and firms get the template.
- **What is stored:** the postcode and its central point only. Never a house number, never GPS,
  never movement history.
- **Who sees what:** the office sees the district only (e.g. "ZZ1"); coordinates are never shown.
  Replies and Home say "from your home area", because the office sees replies word for word.
- **Never in the action log:** the log is append-only and never purged, so a postcode there would
  outlive an erasure. `travel.profile_changed` records which settings changed and the time limit
  only; `enquiry.checks` records minutes only (6.1).
- **What the provider gets:** coordinates plus meaningless ids. TravelTime is listed as a
  sub-processor with a data processing agreement.
- **Deletion:** estimates are purged 7 days after the session ends; the start point is deleted when
  the office makes the casual inactive with the reason "They've left" (`DEACTIVATE_REASONS.left`,
  `src/lib/office/worker-reasons.ts`) or the casual is erased. (There is no "archived" state:
  workers are active, inactive or blocked, `src/lib/db/schema/people.ts:108`.)

### 5.5 Photos and certificate images

- **Where:** stored in Postgres (S7, D3), so row-level security, deletion and export work
  automatically.
- **Size:** photos are resized on the phone (longest side 1,600px, JPEG) to stay under the 1 MB
  server limit (`src/lib/office/import-limits.ts:1-3`).
- **Checks on the server:**
  - check the file's real type from its first bytes;
  - re-encode with `sharp`, which strips location and other hidden data;
  - reject anything over 1 MB;
  - check the Dockerfile for sharp's native library.
- **Serving:** only through an access-checked route, `/files/[id]`. The casual sees their own;
  admins and resourcers see their firm's. Sent with `Cache-Control: private, no-store` and excluded
  from the offline copy.
- **No face matching, no AI and no text reading of documents**, ever. Matching would make photos
  biometric data
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/biometric-recognition/).
  This is written down in `docs/compliance.md`.
- **Retention:**
  - a replaced photo is deleted 30 days after the new one is approved;
  - rejected uploads are deleted after 30 days;
  - certificate images are kept while the qualification is current, then follow the firm's
    retention setting.
- **Exports:** the firm's "Download all your data" picks up every table with a firm id on its own
  (`firmExportTables()`, `src/lib/gdpr/firm-export.ts:33-38`) and builds one JSON file in memory.
  Image bytes there would become arrays of numbers several times their size, enough to crash the
  one web server. So the firm's and the casual's JSON exports carry each upload's details only
  (kind, date, status, the sha256 fingerprint), never `data`, and each image is its own download.
- **Photo renewal:** every `photo.renewal_months` (36 by default, D3), worked out from the latest
  approved photo; "Due soon" from `credentials.expiring_days` (30) before the renewal date.

### 5.6 Evidence email to the strikes team

- **Transport:** the SMTP sender (5.8), with the record PDF as an attachment.
- **Job.** `strikes.evidence_email` carries ids only (`firmJobEnvelope`). It claims the send first,
  then sends, as the other notices do (`src/lib/notices/request-update.ts:27-31`).
  - It is retried only on `EmailNotSentError` (5.8), which proves nothing was sent. Any other
    failure sets `failed`, raises the Needs attention item and offers "Resend evidence" on the
    record (logged), because the email may already have arrived.
  - It is sent only to a **confirmed** `strikes.email` (3.10); otherwise the status is
    `not_set_up`.
  - Logged as `strike.evidence_sent` / `strike.evidence_failed`.
- **Subject:** "Strike: Kieran Doyle cancelled Steward at Acme Demo Racecourse with 15 hours' notice
  (ref B71E0C42)".
- **Body:** "Kieran Doyle (staff id {id}) cancelled Steward · Raceday · Wed 7 Oct 10:30–18:30 at
  19:05 on Tue 6 Oct, 15 hours before the start. That is under your 48-hour rule, so a strike was
  recorded automatically. It is their strike 2 in the last 90 days. The record is attached (PDF) and
  is also here: {link}. — Acme Events Shift Team"
- **Health details are never included.** Even a label like "Health reason" is health data, so
  every quick reason a casual gave ("I'm unwell", "Travel problem", "Family or caring", "Something
  else") shows as "Casual's own reason (see ShiftDesk)" in the subject, the body and the PDF.
  Office reasons keep their fixed words.

### 5.7 Messages: changed and new (exact words)

**How every message is handled:**
- Every message ends with "— {firm} Shift Team". On text messages it is " - {firm} Shift Team", as
  now.
- The words are built by code from the firm's data.
- A WhatsApp message the business starts must use an approved template. Changed templates go into
  `src/lib/messaging/templates.ts`, `src/lib/messaging/whatsapp-templates.ts` and
  `docs/messaging-templates.md`, kept in step by `tests/unit/copy.templates-doc.test.ts` and
  submitted with "Connect Twilio" (`PLAN.md` Messages 29).
- Instant replies are free text, allowed within 24 hours of the casual's message.

**1. Personal shift list.** The instant reply when the topic is "shifts". It replaces "Open shifts
you're eligible for: {link}".

```
Hi Zoe, you're booked on Sun 11 Oct (Steward · Riverside Food Festival · 10:00–18:00). For Saturday you can take:
1. Door supervisor · Northern Lights Live, Acme Demo Arena · Sat 10 Oct 08:00–16:00 · £15.50/h · Gate A · urgent
   3.1 miles · 12 min by car · 24 min by public transport
2. CSAS officer · Night patrols, Northgate Town Centre · Sat 10 Oct 17:00–23:00 · £15.00/h · town centre patrol · you hold CSAS
   8.4 miles · 21 min by car · 38 min by public transport
Take one here: {link}
Automatic reply. Send OFFICE to reach a person.
— Acme Events Shift Team
```

Rules for building it:
- **Booked line:** the "you're booked on" part only appears when they have a booking on a day they
  asked about.
- **Day words:** the "For Saturday" part only appears when code recognises a weekday, "weekend",
  "today" or "tomorrow".
- **Length:** at most 5 shifts, then "+ 3 more: {link}", inside a character budget: never over
  1,600 characters (3.6). Event, site and post names are cut to set lengths, and fewer shifts are
  listed until it fits. Tested with every field at its longest (event and post up to 200
  characters each), on WhatsApp and by text.
- **Order:** urgent first, then the nearest.
- **Home area:** replies say "from your home area", never the postcode, because the office sees
  them word for word (3.6, 6.3).
- **Travel line variants:** "12 min by car · no public transport gets you there by 07:30";
  "Distance not known yet"; no home area: the travel lines are left out and "Add your home area to
  see how far each one is: {profile link}" goes before "Take one here".
- **Nothing they can take:** "Hi Zoe, there's nothing you can take on Saturday within 45 minutes of
  your home area right now. We'll message you if something comes up. All open shifts: {link}"
- **Text message version** (2 shifts): "Acme Events: shifts for you: 1) Sat 10 Oct 08:00-16:00 Door
  supervisor, Acme Demo Arena, £15.50/h, 12 min by car. 2) Sat 10 Oct 17:00-23:00 CSAS officer,
  Northgate, £15.00/h, 21 min by car. Take one: {link} - Acme Events Shift Team"
- **No pay rate** on a session: the line leaves pay out rather than showing an empty "£/h".

**2. Cancel enquiry** (replaces "To cancel a shift, tap here…"):
"Hi Kieran, you're booked on Steward · Raceday, Acme Demo Racecourse · Wed 7 Oct 10:30–18:30 ·
parade ring. To cancel, open it and tap Cancel this shift: {link}. It starts in less than 48 hours,
so cancelling now gives you a strike. Automatic reply. Send OFFICE to reach a person. — {firm}
Shift Team"
- The strike sentence only appears when a strike would apply (`strikeDecision()`).
- With more than one booking ahead, it ends "Your other shifts: {Booked link}".
- Its `enquiry.checks` entry names the bookings it listed (ids).

**3. Every other instant reply** keeps its words. "Automatic reply. Send OFFICE to reach a person."
is added before the sign-off, which meets WhatsApp's escalation rule
(https://whatsappbusiness.com/policy/). "office" is already a shifts-line keyword
(`src/lib/inbound/keywords.ts:20`). The pay reply is unchanged: it gives the link only and never an
AI answer.

**4. Cancel screen (on-screen text only).** One warning, chosen by `strikeDecision()`:
- **A strike:** "This shift starts in {26} hours. Cancelling with less than {48} hours' notice gives
  you a strike. {Acme Events}' strikes team gets a record of it. You have {0} strikes in the last
  {90} days."
- **Exempt:** "The office booked or changed this shift, so cancelling doesn't give you a strike."
- **Enough notice:** "This shift starts in {5} days. Cancelling now doesn't give you a strike."
- **Footer:** "Your cancellation is recorded the moment you confirm. Nobody needs to approve it."
- **Done:** "Cancelled. Reference {ref}. A strike has been recorded. It counts until {date}." or
  "Cancelled. Reference {ref}. No strike." Then: "If something stopped you, tell us what happened."

**5. `credential_expiring` and `credential_expired`** (changed, so the reminder leads to the upload;
the My shifts banner changes too):
- "Your {qualification} expires on {date}. Upload your renewed card so you can keep taking shifts
  that need it: {link} — {firm} Shift Team"
- "Your {qualification} expired on {date}. You can't take shifts that need it until you upload your
  renewed card and the office checks it: {link} — {firm} Shift Team"

**6. Office emails** (new, over SMTP):
- `strike_evidence` (5.6);
- `strikes_email_confirm`: "Confirm this address for {firm}'s strike records: {link}. It works for 7
  days."

### 5.8 No AWS: email, AI and hosting

Dylan, 2026-10-06: no AWS services (ADR-021, which supersedes ADR-002 for these). Nothing AWS had
run: the Lightsail scripts were never run, and Bedrock and SES were never built.

**Email: SMTP, any provider** (12X.2).
- `SmtpEmailTransport` in `src/lib/messaging/smtp.ts` (nodemailer) behind `MessagingTransport`,
  email only; `getTransport()` (`src/lib/messaging/index.ts`) routes email to it when
  `EMAIL_TRANSPORT=smtp`, and WhatsApp and texts stay as they are.
- Settings, worker only (the web app sends no email): `EMAIL_TRANSPORT` (`console`, the default,
  refused in production; or `smtp`), `SMTP_HOST`, `SMTP_PORT` (587 requires STARTTLS, 465 means
  implicit TLS, plain text is never allowed), `SMTP_USER` and `SMTP_PASS` (a secret, never logged),
  `SMTP_FROM`.
- A failure before the message was accepted (connecting, TLS, login, the sender or recipient) is an
  `EmailNotSentError`, safe to retry; anything later is "may have arrived" (the claim-then-send
  rule). Timeouts count the same way: during connecting, EHLO, STARTTLS, AUTH, MAIL FROM or RCPT
  TO, `EmailNotSentError`; during or after DATA, "may have arrived".
- Set on the transport, not left to nodemailer's defaults (2 minutes to connect and 10 minutes of
  silence, long enough for one hung server to hold the login-link and evidence queues):
  `connectionTimeout` 10000, `greetingTimeout` 10000, `socketTimeout` 30000; `logger` and `debug`
  false (nodemailer's debug output includes the login exchange); `tls: { minVersion: "TLSv1.2" }`
  with certificates checked; `secure: true` on port 465 and `requireTLS: true` on any other port
  (587, or 2525 where a provider offers it), so plain text is never possible.
- Attachments: CSV and PDF, as bytes or base64, a limit per type, at most 3, about 7 MB in total
  (providers cap a whole message; three 6 MB CSVs would be too big once encoded).
- It carries every office email: login links, escalations, the credential list, the payroll digest
  and the strike evidence. Any provider with SMTP credentials and a verified sending domain works;
  which one is chosen when the accounts are created (D9, `PLAN.md` Deploy 8).

**AI: Claude through the Anthropic API** (12X.3).
- `AnthropicAiClient` in `src/lib/ai/anthropic.ts` (the official `@anthropic-ai/sdk`) behind
  `AiClient`; `getAi(env)` returns `noAi` unless `AI_TRANSPORT=anthropic`.
- Settings, worker only: `AI_TRANSPORT` (`none`, the default, or `anthropic`), `ANTHROPIC_API_KEY`
  (passed to the client, never read from `process.env` inside it), `AI_MODEL` (default
  `claude-haiku-4-5`, Haiku as CLAUDE.md says; check the id with the `claude-api` skill when
  building).
- A 5-second timeout with an `AbortSignal` and no retries. It logs purpose, model, tokens and stop
  reason, never the prompt or the answer. Any error, refusal or empty answer is
  `AiUnavailableError`, so the code's fallback runs (golden rule 1 unchanged).
- Wired into the shifts-line reply job (`src/lib/inbound/reply.ts`) and the payroll digest
  (`src/lib/pay/digest.ts`). Real calls wait for "Connect the Anthropic API" (`PLAN.md`).

**Hosting: any UK or EU Docker host** (12X.1).
- Docker Compose (web, worker, Caddy), as today. Postgres 16 is the host's managed database
  (checked TLS, its CA file mounted at `/app/db-ca.pem`; backups are the host's snapshots) or, if
  the host has none, Postgres in Compose over a Unix socket (no TLS needed, `src/lib/db/tls.ts`;
  backups become ours: a `pg_dump` run as the `postgres` superuser, because the owner role sees no
  firm rows under forced row-level security, ADR-011).
- The image stops fetching Amazon's RDS certificate bundle (`Dockerfile:30-34`); `src/lib/env.ts`
  and `deploy/env.example` name `/app/db-ca.pem`.
- Deleted with their tests: `deploy/lightsail.sh`, `deploy/alarms.sh`, `deploy/restore-drill.sh`.
  Kept: `deploy/cloud-init.sh`, the compose file, `deploy.sh` and its timer, the Caddyfile and the
  deploy workflow.
- Which host is chosen later (`PLAN.md` Deploy 9, "Connect hosting").

**A test keeps it that way:** `tests/unit/no-aws.test.ts` fails on an AWS SDK in `package.json`, an
`aws` command, or a match for
`/\b(aws-sdk|@aws-sdk|amazonaws\.com|AWS_[A-Z_]+|BEDROCK_[A-Z_]+|rds-ca\.pem|lightsail|bedrock)\b/i`
in `.env.example`, `deploy/env.example`, `docker-compose*.yml`, the `Dockerfile`, `deploy/`, `src/`
or `CLAUDE.md`. Docs that record history (`docs/work-log.md`, `docs/overnight-log.md`, the audit,
the Hours log) keep their AWS mentions.

**What "no AWS" covers** (ADR-021): no AWS account, SDK or AWS-branded service. Whether a provider
that itself runs on AWS (see its sub-processor list: some email providers, Docker hosts, and
Anthropic's own infrastructure) is acceptable is Dylan's call when the accounts are chosen
(`PLAN.md` Deploy 8 and 9).

**Tests never reach a real service.** `.env` is loaded by both `playwright.config.ts` and the Vitest
setup (`tests/setup/test-db.ts`), so each new setting is pinned in `serverEnv()` and
`tests/setup/env.ts` (`EMAIL_TRANSPORT` `console` and `SMTP_PASS` empty, 12X.2; `AI_TRANSPORT`
`none` and `ANTHROPIC_API_KEY` empty, 12X.3; `TRAVEL_PROVIDER` `fake`, 12G.1), and the settings
refuse `smtp`, `anthropic` and `traveltime` when `NODE_ENV=test`.

**Data protection.** The host, the email provider and Anthropic (once AI is on) become
sub-processors (`PLAN.md` Legal 2). Anthropic's API may process requests outside the UK, and its
region option doesn't cover every model, so before AI is switched on: accept its data processing
agreement and check its UK transfer terms, and change the privacy notice, which says the AI "runs
in the EU". What the AI sees doesn't change: the pay summary gets a group's facts only; the sorter
gets the casual's own message (which can mention health) and may only return a label.

---

## 6. Rules and law

### 6.1 Golden rules check

| Feature | What AI does | What code decides | Golden rule |
|---|---|---|---|
| Sorting a message | Picks one label (shifts/cancel/pay/office), with a 5-second timeout | Everything else | 1 |
| Personal shift lists | Nothing | Eligibility, showing switches, travel area, order | 1, 4, 6 |
| Pay questions | At most labels it "pay" | Fixed reply; goes to payroll | 9 |
| Strikes | Nothing | Threshold, exemptions, review flag | 1, 5 |
| Travel filter and order | Nothing | Provider times plus the casual's limit | 1 |
| Qualification statuses | Nothing | Dates; office checks; only checked, in-date items count | 6 |
| Upload checks | Nothing (no face matching, no text reading) | A named office person | 6 |
| Cancellations by the office, the planner or the sheet | Nothing | Reason, notice hours; never a strike | 12 |
| Planner API and webhooks | Nothing | zod at the boundary, the rules for moves, no booking, the key decides the firm | 1, 2, 3, 5, 12 |
| Every change logged | – | New log entries: `event.shown/hidden`, `session.shown/hidden`, `site.changed`, `strike.issued/withdrawn/reviewed/evidence_sent/evidence_failed`, `upload.received/approved/rejected`, `travel.profile_changed`, `export.downloaded`, `enquiry.checks/answered/closed`, `api_key.created/revoked`, `api.change_refused`, `webhook.delivered/failed`; settings changes reuse the existing `firm.settings_changed`. Each is added to `src/lib/office/log-types.ts` and `event-words.ts`, in the shape below | 5 |
| Every new table separated by firm | – | Row-level security, fixtures, `TABLE_ACCESS` | 2 |
| Message sign-off | – | "— {firm} Shift Team" | 8 |
| Demo and test data | – | Made-up names, venues, `ZZ` postcodes and `.example` addresses only | 7 |

**What a new log entry may hold.** `recordEvent()` refuses (throws) any entry the log masker would
change (`src/lib/events/record.ts:20-24`), and the log is append-only and never purged
(`src/lib/gdpr/retention.ts:41-43`). The masker hides:
- any field whose name contains "credential", "email", "postcode", "address", "phone" or
  "mobile", or is exactly "name" (`src/lib/log/mask.ts:142-145`, matched ignoring case, "_" and
  "-");
- email addresses and phone numbers inside values;
- lists longer than 50 items and nesting deeper than 5 levels (lines 152-153), and text longer than
  2,000 characters (`MAX_TEXT`, line 50);
- numbers of 1e9 or more, as possible phone numbers (line 202).

So every Phase 12 entry is written to this shape, before it is built:
- ids, codes, counts, minutes, hours and whole pence only; times as ISO strings, never epoch
  numbers;
- field names say "qualification", "licence" or "requirements", never "credential" (the precedent:
  `licences` in `src/lib/gdpr/worker-erase.ts:49`); e.g. the session editor's `shift.changed {
  fields: ["requirements", "post"] }`;
- field names never contain "secret", "token", "apikey" or "signature" either (the masker's
  secret list, `src/lib/log/mask.ts:142-143`): the key id is `keyId` and the webhook's version
  key is `webhook.signing_version`;
- `firm.settings_changed` gives the keys with their old and new values, but the key only for
  `strikes.email`, its confirmed time and `webhook.url` (the address is a secret: 5.3.3);
- never a postcode or coordinates: `travel.profile_changed { changed: ["postcode", "modes"],
  maxMinutes }`, `site.changed { siteId, fields: ["postcode"] }`, and `enquiry.checks` travel as
  minutes only;
- `enquiry.checks` lists at most 50 not-offered sessions, with a count of the rest;
- API changes carry `{ by: "firm", via: "api", keyId }`; `api.change_refused { shiftId, code }`;
- no typed text from anyone (reasons are codes: 3.5, 3.6).

A unit test passes every new entry's sample data through the same check `recordEvent()` uses,
including these exact samples: `shift.changed { by: "firm", via: "api", keyId }`, `api_key.created
{ keyId }`, and `firm.settings_changed` for adding a webhook and for "New signing secret".

### 6.2 Strikes and UK employment law

This is a summary of public sources, not legal advice.

- **The law isn't in force yet.** The Employment Rights Act 2025's zero-hours parts (notice of
  shifts, short-notice payments) are expected in 2027
  (https://assets.publishing.service.gov.uk/media/6981e6e4e833d031a3158f87/implementing-the-employment-rights-bill-roadmap.pdf).
  For now ShiftDesk records notice hours on every cancellation, when each session was offered and
  accepted, and every office change. The thresholds stay settings.
- **Workers are told the rules up front:**
  - the help page and the cancel screen explain the 48-hour rule, what a strike means, how long it
    counts and how to respond;
  - the warning version is stored (S3).
- **A strike is a record that may lead to a review, never an automatic penalty.** A named person
  decides anything that follows. This fits the new automated-decision safeguards (information, the
  right to respond, human intervention, the right to challenge;
  https://www.legislation.gov.uk/ukpga/2025/18/part/5/chapter/1/crossheading/automated-decisionmaking/enacted).
  It also follows Acas: review points shouldn't trigger disciplinary action automatically
  (https://www.acas.org.uk/absence-trigger-points).
- **No strike when the office or the planner changed the shift after booking.** This follows the
  future protection against detriment ("detriment" = any unfavourable treatment) in ss.47H and 47I.
- **No strike on a booking the office made.** A casual the office placed with "Assign" never
  accepted the shift in ShiftDesk, so a strike for cancelling it would penalise turning down work
  they never agreed to (3.5 rule 3).
- **No strike for an office booking that overrode rest or hours rules.** Workers already can't suffer
  detriment for refusing to break the Working Time Regulations (s.45A ERA 1996,
  https://www.legislation.gov.uk/ukpga/1996/18/section/45A).
- **Health and caring reasons are flagged for a person to review** (Equality Act 2010; Acas): "I'm
  unwell", and "Family or caring", since an emergency with a dependant raises the same concerns.
- **Strikes are never linked to money.** No fines and no deductions: s.13 ERA 1996
  (https://www.legislation.gov.uk/ukpga/1996/18/section/13) and reg 12 of the Conduct Regulations
  (https://www.legislation.gov.uk/uksi/2003/3319/regulation/12). Payroll never sees strikes.
- **How long strike records are kept.** A strike counts for 90 days and the strike row is deleted at
  12 months, unless a hold is on. That is past the 6-month tribunal time limit in force since 1 Oct
  2026
  (https://www.porterdodson.co.uk/news-insights/1st-october-2026-doubling-of-tribunal-time-limits),
  plus a buffer. The action log's `strike.issued` and `strike.withdrawn` entries (no reasons, no
  free text) stay as long as the action log, which isn't purged yet (`PLAN.md` Data 2).
- **Notice is measured at the cancellation.** A casual who warned the office by message first and
  cancelled later still gets a strike under 48 hours; the office can withdraw it. (Counting from
  the first message waits for live WhatsApp: `PLAN.md` "Phase 12 cuts".)

### 6.3 UK GDPR

- **Home location:** see 5.4. Legitimate interests, a DPIA, the postcode only, the district only for
  the office, a processor agreement with the provider, purging, deletion and export.
- **Photos and certificates:** see 5.5. No biometric processing, access-checked serving, retention
  rules, deletion and export.
- **Evidence emails:**
  - only to a confirmed address;
  - a minimal PDF plus a link;
  - no health details;
  - a log of when and to whom
    (https://ico.org.uk/for-organisations/advice-for-small-organisations/getting-started-with-gdpr/common-data-protection-mistakes-and-how-to-fix-them/).
- **The firm's own planner** gets names, staff refs, booking facts and strike status by webhook, to
  an address the firm's admin chose (5.3.6).
- **Health reasons:**
  - "I'm unwell" counts as health data, a special category, and so does a label saying someone
    cancelled for a "health reason";
  - it is visible on screen to admins and resourcers only;
  - everything that leaves ShiftDesk (the evidence email, the record PDF, the cancellations CSV,
    the webhooks and the API) shows one neutral value for all four quick reasons, "Casual's own
    reason (see ShiftDesk)" or `casual_own_reason`; tests check "unwell" and "health" never appear
    in them (12C.3, 12C.4, 12J.2)
    (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/information-about-workers-health/data-protection-and-workers-health-information/);
  - the Article 9 condition firms rely on: employment, DPA 2018 Schedule 1 paragraph 1, which
    needs the firm to have an appropriate policy document. Both go into `docs/compliance.md` and
    the firm's pack (12I.3).
- **AI:** Anthropic as a sub-processor once AI is switched on, with its transfer terms checked
  first (5.8).
- **DPIAs before the processing starts:** one for the travel area (12G.1, `docs/dpia-travel.md`)
  and one for strikes (12C.1, `docs/dpia-strikes.md`), each written before the feature is switched
  on for a real firm, with templates for firms. Neither exists yet.
- **Retention schedule** in `docs/compliance.md`:
  - messages 90 days (existing);
  - strikes 12 months (not during a hold); their log entries as long as the action log (`PLAN.md`
    Data 2);
  - travel estimates 7 days after the session;
  - replaced or rejected uploads 30 days;
  - cancellation records follow the 3–6 year pay-record rules where pay is involved.
- **Privacy notice** (`docs/privacy-notice.md`): add strikes (including that their log entries
  outlive the 12-month row), the strikes-team email, the travel area, photos, the firm's planner as
  a recipient, the new sub-processors (the host, the email provider, Anthropic, TravelTime,
  postcodes.io), and retention. DPIA templates are supplied for firms.
- **Strike data never crosses firms.**

### 6.4 Questions for a solicitor (not blocking the build; `PLAN.md` Checks 15)

1. Does a casual applying for an open shift count as the worker "suggesting" it under s.27BL(2)?
2. Are each firm's casuals employees, workers or agency workers?
3. Is an automatic strike with no automatic consequence a "significant decision" under the new
   Articles 22A–22D?
4. Do 90 days live and 12 months kept fit each firm's contracts?
5. CSAS: may a firm deploy a casual whose accreditation came through another employer's scheme
   (Police Reform Act 2002 s.41)? Phase 12 assumes not: the office records CSAS only under its own
   scheme (3.7).

---

## 7. Ideas from similar services (reference only, not scope)

| # | Idea | Who does it (source) | In Phase 12? |
|---|---|---|---|
| 1 | Travel time on every shift; lists limited by travel | Brigad (https://traveltime.com/case-study/brigad-case-study); Coople radius (https://help.coople.com/en/articles/5596978-how-to-search-for-jobs-with-the-coople-jobs-app) | Yes (S8, S9). Urgent offers going first to the nearest: cut |
| 2 | Qualification status buckets and an upload check queue | Workstaff (https://help.workstaff.app/docs/managers/addons/documents/); Connecteam approvals (https://help.connecteam.com/en/articles/9490810-approve-or-decline-pending-documents) | Yes (S6, S7) |
| 3 | SIA register check log, with time and who checked | Guard Checker (https://www.guardchecker.co.uk/) | Cut (a link to the register on the approve form instead) |
| 4 | Automatic re-offer after a cancellation, shown on the record | Subshift (https://subshift.app/); Rosterfy (https://www.rosterfy.com/uk-en/platform/advanced-scheduling/) | Yes (the record's "Then" line) |
| 5 | Strike rule shown before confirming; worker can respond | Instawork (https://help.instawork.com/en/articles/13054123-how-do-i-cancel-a-shift-on-instawork); Coople (https://help.coople.com/en/articles/5227781-what-is-coople-s-strike-policy) | Yes (S3, S4) |
| 6 | "Considered but not offered", with reasons | Zendesk logs (https://support.zendesk.com/hc/en-us/articles/8357749580186-Reviewing-conversation-logs-for-AI-agents); Ada reasoning log | Yes |
| 7 | Reply timer and WhatsApp 24-hour countdown | Intercom SLAs (https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets); Meta (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) | Cut |
| 8 | "Right answer / wrong answer" review and a weekly sample | Ada "Agree?" (https://docs.ada.cx/docs/generative/measure-success/understand-and-improve-your-ai-agent-s-automated-resolution-rate/); Fin Monitors | Cut |
| 9 | Ask casuals to confirm they'll attend; flag the ones who don't | Indeed Flex UK (https://indeedflex.co.uk/legal/flexer-terms-and-conditions); Jobandtalent (https://www.jobandtalent.co.uk/companies/planning) | Later |
| 10 | Offer a shift to selected casuals only | When I Work (https://help.wheniwork.com/articles/offer-an-openshift-to-specific-employees) | Later |
| 11 | Pay status per shift for casuals (Worked → Approved → Paid) | Patchwork (https://faq.patchwork.health/when-will-i-get-paid) | Later |
| 12 | Short-notice payments ledger | ERA 2025 consultation (https://assets.publishing.service.gov.uk/media/6a22e4b056e988a798b3870d/ending-one-sided-flexibility-reforms-zero-hours-similar-contracts-consultation-document.pdf) | Later (switched off until the regulations exist) |

The "Later" and "Cut" ideas are in the `PLAN.md` Parking lot ("Office v2 later items", "Phase 12
cuts").

---

## 8. Decisions (settled by Dylan on 2026-10-06)

Dylan: "go with your recommendations", except where his other decisions that day override them (no
AWS; API and webhooks instead of sheet write-back; debloat). Each is a row in `PLAN.md` "Decisions
waiting for Dylan"; to change one, tell Claude.

| # | Decision | Settled as | `PLAN.md` row |
|---|---|---|---|
| D1 | Travel-time service and postcode look-up | **TravelTime** for car and public transport (the free key for development and the demo only; a fake provider in tests; a production quote before a pilot). **postcodes.io** for postcode to coordinates. Straight-line fallback, labelled "straight line", when the service is down. (Google Routes rejected: about $1,450 a month per 300-casual firm, and its results can't be stored) | Product 9 |
| D2 | How the travel area limits shifts | **A hard filter** on open shifts, the urgent board, Home, offer waves and shifts-line replies. In the area if any chosen way of travelling gets there within the limit. No "a bit further" for urgent shifts. A shift opened from a direct link stays bookable. Unknown distance: shown, labelled, and still offered. No home area: everything shown, with a prompt. The full postcode is stored; the office sees only the district. The office may still offer outside a casual's area by hand. Cut by debloat: travel time as a wave tie-breaker and the office's outside-area warning | Rules 14 (privacy: Data 21) |
| D3 | Where photos and certificates are kept; photo renewal | **In Postgres**, re-encoded, 1 MB at most; only checked items count. Photo renewal **every 3 years** (matches the SIA licence cycle; the mock-up said 2), "Due soon" 30 days before | Data 20 |
| D4 | Strike details | **48 hours** (its own setting), measured at the cancellation; **no strike** when the office, the planner or the sheet cancelled, on a booking the office made ("Assign", including over a rules check), or after the office or the planner changed the session; "I'm unwell" and "Family or caring" still get a strike but are **flagged for a person to review**; every reason that leaves ShiftDesk reads "Casual's own reason (see ShiftDesk)"; counts **90 days**, row kept 12 months (not during a hold), log entries as long as the action log; nothing happens automatically; casuals see their strikes and can tell us what happened; a DPIA before a real firm uses strikes. Cut by debloat: the 15-minute grace and the review flag for a session taken inside 48 hours (the office withdraws a mis-tap's strike), notice counted from a first message, the alert at 3, the strike messages | Legal 16 |
| D5 | Telling planners about cancellations | **Replaced by Dylan:** the planner API and signed webhooks (5.3). No sheet column and no daily email | Sheets 16 |
| D6 | "Reply 1 or 2 to take one" | **Deferred** to the Parking lot: a new way of proving who the casual is (an auth change) that also needs live WhatsApp. Replies carry links | Messages 28 |
| D7 | Dark theme: navy (the original brief) or graphite (the mock-up) | **Navy**: page #0f1626, panel #16203a, card #1b2642, raised #22304f, muted text #a3b0c8, switch off #7c8aa8 (all checked for contrast). A colour-token swap, so easy to change | Product 10 |
| D8 | Pay week number and pay day in the top bar | **ISO weeks, Monday to Sunday; pay the Friday after the week ends** ("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct"). One rule for every firm (the per-firm setting was cut) | Pay 10 |
| D9 | Email provider (new, from "no AWS") | **Any provider over SMTP**; which one is chosen when the accounts are created | Deploy 8 |

Also settled: right to work stays a status only (`PLAN.md` Rules 15), and the mock-up is committed
(Checks 17).

Still needed from Dylan:
- whether "no AWS" also rules out a provider that itself runs on AWS (its sub-processor list), when
  the accounts are chosen (5.8; Deploy 8 and 9);
- the accounts: an email provider (D9), an Anthropic API key, the TravelTime quote (Checks 14), a
  host (Deploy 9), and "Connect Twilio", without which emails, AI sorting and real WhatsApp stay on
  their stand-ins. Webhooks to a planner need the worker too, which runs in production only once
  Twilio is connected: the API works before that, the webhooks don't.

---

## 9. Build order (`PLAN.md` Phase 12)

**Ground rules for every task:**
- It follows CLAUDE.md "How to work each task": a short plan first, and a wait for Dylan's OK on
  anything touching schema, auth or tenancy, even where the S number is approved.
- Anything touching the database, login and permissions, firm separation, messaging or the rules
  engine runs the `guardrails-reviewer` agent.
- Each task closes with `/close-task`: `scripts/verify.sh`, then the `claims-auditor` agent.
- Each task keeps every test green, including the walkthrough's browser run: a task that moves a
  page or a menu link updates the specs and `docs/walkthrough.md` steps that use it (section 10).
- Each task adds the demo-seed rows its own screens and tests need (made-up data only); 12I.1 joins
  them into the mock-up's story.
- Commits are made freely.
- **Approval gate:** none left: S1 to S11 are approved (2026-10-06). Every task still waits for the
  plan check above.

| Task | What (section) | Needs Dylan | Main files |
|---|---|---|---|
| 12A.0 | The mock-up in the repo, and the made-up-data test (1.1) | – (Checks 17 OK'd) | new `docs/mockups/office-v2.html`, new `tests/unit/repo.made-up-data.test.ts` |
| 12X.1 | Remove AWS from the image and deploy (5.8) | – | `Dockerfile`, `deploy/`, `docker-compose.dev.yml`, `src/lib/env.ts`, `src/lib/db/tls.ts`, the AWS comments in `src/`, `.env.example`, `CLAUDE.md` (repo layout), `tests/unit/deploy.*`, new `tests/unit/no-aws.test.ts` |
| 12X.2 | Email over SMTP (5.8) | – | new `src/lib/messaging/smtp.ts`, `src/lib/messaging/{index,transport}.ts`, `src/lib/env.ts`, `deploy/docker-compose.yml` |
| 12X.3 | Claude through the Anthropic API (5.8) | – | new `src/lib/ai/anthropic.ts`, `src/lib/ai/client.ts`, `src/lib/inbound/reply.ts`, `src/lib/pay/digest.ts`, `src/lib/env.ts` |
| 12A.1 | Colours and theme (3.1) | – | `src/app/globals.css`, `src/app/layout.tsx`, `src/app/ui/*`, the 16 files using `bg-white` |
| 12A.2 | Office shell and menu (3.1) | – | `src/app/office/{layout,office-shell,office-nav}.tsx`, new `top-bar.tsx`, `menu-drawer.tsx`; `tests/e2e/fixtures.ts` (`menuLink()`) |
| 12A.3 | Pay dashboard and the pay-week pill (3.8, 3.1) | – | new `src/app/office/pay/page.tsx`, `src/lib/office/pay-dashboard.ts`, new `src/lib/pay/pay-week.ts`, `src/lib/pay/digest-schedule.ts` |
| 12B.1 | Events and session fields (3.3) | plan (schema) | `src/lib/db/schema/roster.ts`, `drizzle/`, `src/lib/roster/sheets/sync.ts`, `src/lib/imports/import.ts`, `src/lib/office/shift-editor.ts`, `access.ts`, `tests/helpers/tenant-rows.ts` |
| 12B.3 | Session requirements and CSAS (3.3) | – | `src/lib/roster/eligibility-input.ts`, `src/lib/rules/eligibility.ts`, `src/lib/rules/packs.ts` |
| 12B.4 | What casuals see: the switches everywhere (3.3) | – | `src/lib/portal/{open-shifts,shift-detail}.ts`, `src/lib/roster/book.ts`, `src/lib/offers/{candidates,waves}.ts`, `src/lib/roster/urgent.ts` |
| 12B.5 | Events & sessions pages (3.3) | – | new `src/app/office/events/*`, `src/lib/office/events.ts` |
| 12B.7 | Settings (3.10) | plan (schema, auth) | the migration (`app_set_firm_setting()`), `src/lib/onboarding/settings.ts`, new `src/app/office/settings/*` |
| 12C.1 | Strikes on cancel (3.5, 4.5) | plan (schema) | new `src/lib/strikes/{decide,issue}.ts`, `src/lib/roster/cancel.ts`, new `src/lib/db/schema/strikes.ts`, the migration, `src/lib/gdpr/retention.ts`, `src/app/shifts/[id]/*`, new `docs/dpia-strikes.md` |
| 12C.3 | Cancellation records, PDF and CSV (3.4) | – | new `src/lib/office/cancellations.ts`, `src/app/office/cancellations/*`, `src/lib/pdf/record.ts`, the embedded font |
| 12C.4 | Evidence email (5.6) | – | a job in `src/worker/`, `src/lib/strikes/evidence.ts` |
| 12C.5 | Strikes page and the casual's strikes (3.5, 4.6) | – | new `src/app/office/strikes/*`, `src/app/profile/*`, `src/lib/gdpr/worker-erase.ts` |
| 12G.1 | Postcode look-ups and the casual's travel area (4.6, 5.4) | plan (schema) | new `src/lib/travel/geocoder.ts`, `worker_travel`, `src/app/profile/travel/*`, `src/lib/gdpr/worker-{erase,export}.ts`, `src/lib/office/worker-access.ts`, new `docs/dpia-travel.md` |
| 12G.2 | Travel estimates (5.4) | plan (schema) | new `src/lib/travel/{provider,compute}.ts`, `travel_estimates`, a job in `src/worker/`; the session create, import and sync paths queue it |
| 12G.3 | The travel filter and travel lines (4.3, 5.4) | – | `src/lib/portal/open-shifts.ts`, `src/lib/offers/candidates.ts`, `src/lib/portal/{my-shifts,shift-detail}.ts` |
| 12F.1 | Qualification statuses and the Casuals pages (3.7, 4.6) | – | new `src/lib/credentials/status.ts`, `src/lib/credentials/expiry.ts`, `src/lib/portal/{profile,my-shifts}.ts`, new `src/app/office/casuals/*` |
| 12F.2 | Uploads, the check view and the staff photo (3.7, 4.6, 5.5) | plan (schema) | new `src/lib/uploads/*`, `src/app/files/[id]/route.ts`, `src/app/office/casuals/*`, `src/lib/gdpr/{worker-erase,worker-export,firm-export}.ts`, `templates.ts`, `whatsapp-templates.ts` |
| 12D.1 | Enquiries (3.6) | plan (schema) | new `src/lib/office/enquiries.ts`, `src/app/office/enquiries/*`, `src/lib/office/request-queue.ts`, `src/lib/notices/request-update.ts` |
| 12D.2 | Personal replies (3.6, 5.7) | – | new `src/lib/inbound/personal-reply.ts`, `src/lib/inbound/reply.ts`, `src/lib/rules/eligibility.ts` (`checks`), `src/app/office/enquiries/[id]/*` (step 3 and "Considered but not offered") |
| 12E.1 | Dashboard and Needs attention (3.2, 3.9) | – | `src/app/office/page.tsx`, new `src/lib/office/dashboard.ts` (reuses `today.ts`, `worker-access.ts`) |
| 12J.1 | Planner API and API keys (5.3.2, 5.3.4) | – (S11 approved; auth and schema, so plan check) | new `src/lib/integrations/{keys,api,schemas,sessions,records}.ts`, `src/app/api/v1/*`, new `src/lib/db/schema/integrations.ts`, `drizzle/`, `src/lib/db/admin/access.ts`, `src/lib/roster/{firm-change,cancel}.ts`, `src/lib/http/proxy.ts`, `src/lib/env.ts`, `playwright.config.ts`, `tests/setup/env.ts`, new `src/app/office/settings/integrations/*`, `src/lib/office/dashboard.ts` (the refused-change item), `CLAUDE.md` (golden rule 3, allowed look-ups), ADR-022 |
| 12J.2 | Webhooks to the planner (5.3.3, 5.3.4) | – (S11 approved) | new `src/lib/integrations/{outbox,render,deliver,send,secrets}.ts`, `src/lib/events/record.ts`, a job in `src/worker/` (`jobs/{queues,index}.ts`, `src/lib/jobs/firm-job.ts` for the try number), the Integrations page, `src/lib/office/cancellations.ts` |
| 12H.1 | Casual app tab bar and Home (4.1–4.2) | – | `src/app/page.tsx`, new `src/app/shifts/page.tsx` (Booked), a new staff layout component |
| 12H.2 | Shifts list and shift page (4.3–4.4) | – | `src/app/shifts/open/*`, `src/app/shifts/[id]/*`, `src/app/urgent/*` |
| 12H.3 | Profile and help (4.6–4.7) | – | `src/app/profile/*`, `src/app/help/*` |
| 12I.1 | Demo seed | after every task above | `src/lib/db/admin/seed-*.ts` |
| 12I.3 | Guides and docs (10) | – | `src/app/office/guide/guide-view.tsx`, the docs in section 10, `CLAUDE.md` |
| 12I.4 | Verify and the walkthrough | – | `docs/walkthrough.md`, `tests/e2e/walkthrough*` |

**Ids from the first plan.** 12B.2 is now part of 12B.1; 12B.4a and 12B.4b are 12B.4; 12C.2 is part
of 12C.1; 12D.4 is part of 12D.1; 12E.2 is part of 12E.1; the old 12F.1 and 12F.5 are 12F.1, and
12F.3 is part of 12F.2; the old 12G.1–12G.4 are 12G.1–12G.3; 12I.2 is part of 12I.3. Cut: 12B.6
(star and event notes), 12C.6 (sheet write-back and planner email), 12D.3 (booking by number),
12D.5 (review loop), 12F.4 (SIA register check and new reminders). New: 12X.1–12X.3 (no AWS) and
12J.1–12J.2 (planner API and webhooks).

**Why this order:**
- The mock-up copy and the no-AWS tasks touch nothing else, so they go first.
- Data before screens: events, strikes, travel, qualifications and enquiries land before the
  dashboard and the casual app that show them, so no screen is built twice.
- Travel comes before personal replies, so replies carry travel lines from the start.
- Settings (12B.7) comes before the evidence email, so the strikes-team address is confirmed on the
  page, with no owner-command stopgap.
- The planner API and webhooks wait for S11, and nothing else waits for them: the dashboard's
  webhook item and the record's planner line land with 12J.2.
- Each redirect (`/office/today`, `/office/requests`, `/office/workers`) and each menu link lands
  with the page that replaces it.

**Demo seed (12I.1)**, all made up, dates relative to "now" so weekdays are always right:
- **Firm:** Acme Events, strikes team `strikes@acme-events.example`, already confirmed. No real
  employer names, venues, staff or addresses.
- **Events and sessions, as in the mock-up:** Northern Lights Live, Acme Demo Arena (door
  supervisor urgent 3/4, steward, response team lead needing first aid); Night patrols, Northgate
  Town Centre (CSAS officer, urgent); Riverside Food Festival; Raceday, Acme Demo Racecourse;
  Northgate Charity 10K; Hillside Christmas Market, switched off. Each session has pay rate, post,
  meeting point and uniform.
- **Casuals:** Zoe Adeyemi (SIA DS valid, CSAS valid, manual handling expiring in 22 days, first aid
  missing, photo due soon); Kieran Doyle (SIA expired, 2 strikes); Ben Fraser (new photo waiting);
  Priya Shah (1 strike); Leah Ward (SIA expiring in 12 days, no photo); Jamal Morgan, Mo Rahman, Tom
  Hale. At least 4 CSAS holders. Travel areas for every casual.
- **Cancellations and strikes:** the mock-up's records, including one office cancellation; one
  strike withdrawn with a reason, one flagged for review.
- **Enquiries:** Zoe's personal list, Ben's pay question and Kieran's cancel, each with its reply
  built by the real reply functions and its log entries, all inside the 90-day window.
- **Times shown come from rows, not the log.** Log entries are stamped when the seed runs and can't
  be backdated (`src/lib/db/admin/seed-saturday.ts:20-21`, `docs/testing.md:250`), so the loaders
  take times from row timestamps the seed can set; the log only says what happened.
- **Travel:** fake coordinates for the ZZ postcodes and sites, and a fixed table of times for the
  fake provider (e.g. ZZ1 4 → Acme Demo Arena: 3.1 miles, 12 min by car, 24 min by public
  transport).
- **Pay:** the existing 10 pay queries, plus two sorted groups. **Uploads waiting:** Ben's photo and
  one certificate.
- Fixed ids via `seedId()` (`src/lib/db/admin/seed-data.ts:10`), avoiding the free demo-login
  workers 0–4.

---

## 10. Test and doc impact

Line numbers are as of `b3f3627`. These tests change because the product changes; none is weakened
to get green. Phase 11 said its tests would stay unchanged; Phase 12 changes the menu, Today,
Requests, Workers and the deploy files, so the tests that pin them change with them, each in the
task named.

**Unit tests rewritten:**
- `tests/unit/office.shell.test.ts` (12A.2): menu labels per role (33-60), current link (68-111),
  markup rules (117-128). The phone row's edge-arrow tests (153-168) are deleted along with the
  sideways row. The footer tests (188-215) move to the account menu.
- `tests/unit/office.roles.test.ts:18-23` (each task adding an area).
- `tests/unit/office.today-summary.test.ts` and `tests/unit/office.today-view.test.ts` (12E.1):
  replaced by dashboard tests. Colour checks by class name (`bg-white`, 174-178) become token
  checks (12A.1).
- `tests/unit/guides.test.ts` (76-123) (12I.3).
- `tests/unit/portal.profile.test.ts` (109-121, status words) (12F.1, 12H.3).
- `tests/unit/portal.my-shifts.test.ts` (12F.1, 12H.1).
- `tests/unit/copy.templates-doc.test.ts`: the changed reminders (12F.2).
- `tests/unit/credential.packs.test.ts`: CSAS, manual handling (12B.3).
- **Deploy tests (12X.1):** `tests/unit/deploy.lightsail.test.ts` and
  `tests/unit/deploy.monitoring.test.ts` are deleted with the scripts they test (a feature Dylan
  cancelled, not a weakened test); the `cloud-init.sh` tests move to
  `tests/unit/deploy.cloud-init.test.ts`; `tests/unit/deploy.database-tls.test.ts` pins
  `/app/db-ca.pem` and that nothing is fetched from Amazon; `tests/unit/imports.gate-b.test.ts:7-8`
  takes a non-AWS example host.
- `tests/unit/ai.boundary.test.ts` lists `anthropic.ts` (12X.3).

**Integration tests that pin the old replies** (12D.2 replaces the "shifts" and "cancel" replies and
adds "Automatic reply. Send OFFICE to reach a person." to every instant reply):
- `tests/integration/inbound.whatsapp.test.ts:278-283` (the old "Open shifts you're eligible for"
  and "To cancel a shift, tap here" replies) and `:381` (the cancel reply after AI sorting).

**End-to-end tests:**
- **`menuLink()` helper** (12A.2) replaces direct menu clicks in: `pay.query:74`, `login.office:43`,
  `office.log:30`, `gdpr:49`, `office.team:48`, `office.reports:33`, `office.pilot:30`,
  `office.pay-import:27`, `office.shifts:31`, `office.workers:52`, and walkthrough lines 316, 346,
  403, 434, 443, 455, 473, 483, 529, 549, 555, 570, 627.
- **Absence checks** (`login.office:56`, `office.shifts:104`) must open the menu first. Otherwise
  they pass even when the link is there.
- **Renames:** Workers → Casuals (12F.1); "Data requests (download or delete)" → "Data requests"
  (12A.2); Requests → Enquiries' "Requests from the app" (12D.1).
- **Log out** moves into the account menu (12A.2: `login.office:48`, walkthrough 113-118).
- **Old shifts-line replies** (12D.2): `whatsapp.inbound.spec.ts:37` and walkthrough 592 expect
  "Open shifts you're eligible for: …"; they move to the personal list's words.
- **Requests** (12D.1): `office.requests.spec.ts:36` (the "See requests" link to `/office/requests`)
  follows the redirect to Enquiries' "Requests from the app".
- **Today-based specs:**
  - `office.today.spec.ts`, walkthrough 279 and 281-299: rewritten for the dashboard (12E.1),
    including the Today headings and the requests count at lines 28-40; its payroll placeholder
    check (line 67) for the pay dashboard (12A.3);
  - walkthrough 607 (unknown numbers): rewritten for Enquiries (12D.1);
  - `office.attendance:38-43` and `office.workers:85-95`: follow their items to the dashboard's
    Needs attention section (12E.1).
- **Text checks** ("You're logged in as …", "Hello Domain Admin" in `custom-domain:152`) are checked
  and moved with their content.
- **`login.worker:43-46`** counts, and Booked's move to `/shifts` (12H.1): the tests that use
  `/?view=past` (`tests/e2e/login.worker.spec.ts`, `tests/e2e/walkthrough.spec.ts`,
  `tests/unit/portal.my-shifts.test.ts`, `offline.sw.test.ts`, `proxy.test.ts`,
  `error-pages.test.ts`) follow the new route or check the redirect.
- **`brand.spec.ts` stays unchanged.**

**New tests:**
- no email address in `src/`, `drizzle/`, `tests/`, `docs/` or the seed outside the reserved example
  domains, and the mock-up's postcodes all `ZZ` (12A.0);
- no AWS SDK, endpoint, command, setting or name in the code, the image, the deploy files, the env
  examples or `CLAUDE.md` (12X.1);
- the SMTP sender's TLS settings, message mapping, error mapping and routing, with no network
  (12X.2); the Anthropic client's answers, failures, no retries and logging, with a fake `fetch`
  (12X.3);
- contrast in both themes (12A.1);
- the drawer, the theme button and the account button (12A.2);
- `strikeDecision()` (12C.1), every case and boundary; the strikes purge and the hold (12C.1);
- isolation for `shift_events`, `strikes`, `uploads`, `worker_travel`, `travel_estimates` and
  `api_keys`;
- every place the switches must be respected, for a hidden event and a hidden session (12B.4);
- every new log entry's sample data passes the check `recordEvent()` uses (6.1; 12B.1, 12B.7,
  12C.1, 12D.2, 12F.2, 12G.1, 12J.1, 12J.2);
- the travel filter before the cap and D2's rules (12G.3);
- travel estimates for new, synced and urgent sessions and the whole 28-day window (12G.2);
- personal replies never include AI-written words, stay within 1,600 characters with every field
  at its longest, and leave out each kind of ineligible session with its reason (12D.2);
- every rules check recorded with its data, `ok` unchanged (12D.2);
- upload security, and exports without image bytes (12F.2);
- the PDF and CSV exports, including a casual named "Łukasz Ştefan" (12C.3);
- "unwell" and "health" never in the evidence email, the record PDF, the cancellations CSV, the
  webhook body or the API's records (12C.3, 12C.4, 12J.1, 12J.2);
- the evidence email never sent twice after an unclear failure (12C.4);
- confirming the strikes email address, an old link never confirming a new address, and the app
  unable to change retention settings (12B.7);
- the API: keys, tenancy, every PUT path, limits and errors, the reads (`GET /sessions/{ref}`,
  `GET /cancellations` paging), the host and body limits, API cancels and moves exempt from
  strikes, no key in any server log (12J.1); webhooks: one delivery per path and none after a
  rollback, each type's body against its zod contract, signing against the Standard Webhooks
  example, the address guard, retries and giving up without a failed job, one firm's dead
  endpoint not delaying another's (12J.2);
- qualification statuses on today's screens, and which qualifications count as Missing (12F.1);
- no office page or loader output holding more than a casual's district (12D.1);
- end-to-end specs `office.shell`, `office.events`, `office.cancellations`, `office.enquiries`,
  `office.dashboard`, `office.pay-dashboard`, `office.integrations` and `casual.app`.

**Docs to update** (each task updates the docs it changes; 12I.3 checks the whole set):
- `PLAN.md`: Phase 12 tasks; the Phase 12 rows under "Decisions waiting for Dylan"; the Parking lot
  ("Office v2 later items", "Phase 12 cuts"). (Written and trimmed 2026-10-06.)
- `CLAUDE.md`: the repo layout's `ai/` line ("Anthropic client behind AiClient, prompts,
  zod-validated outputs") and `messaging/` line ("console | twilio for phones, SMTP for email")
  (12X.1, so no builder reads "Bedrock client" again); the conventions' "Never hit Twilio from
  tests" becomes "never hit Twilio, an SMTP server, Anthropic, TravelTime, postcodes.io or a
  planner from tests" (12X.2, with `scripts/invariants.sh`); lines 13-25 (the office is now
  planner-first, and the dashboard and Enquiries replace Today and Requests) and
  `src/lib/integrations/` in the repo layout (12I.3); golden rule 3's exception for the planner
  API and the allowed look-ups (`app_api_key_lookup()`), with S11's OK (12J.1). The Stack section
  already names SMTP, the Anthropic API and any UK/EU Docker host.
- `docs/screens.md`: office shell (70-108), `/office`, the new office routes, and the staff screens
  `/`, `/shifts/open`, `/urgent`, `/shifts/[id]`, `/profile`, `/help`, with every new piece of
  wording.
- `docs/ui-design.md`: tokens with dark mode and navy, shell, dashboard, event card patterns.
- `docs/data-model.md`: S1–S11, settings, `sites` lat/lng now used.
- `docs/architecture.md` and `docs/api-and-jobs.md`: the stack without AWS (12X.1: in
  `api-and-jobs.md` the Stage 2 row becomes "`POST /api/webhooks/email`: the chosen provider's
  inbound webhook" and "Connect Bedrock" becomes "Connect the Anthropic API"), travel jobs,
  providers, upload and file routes, evidence email, the planner API and the `webhook-deliver` job
  ("the action log is the outbox").
- The other AWS leftovers (12X.1): `docs/messaging-templates.md` ("SES later" becomes "SMTP";
  Bedrock becomes "the Anthropic API"), `docs/screens.md:138` ("email (SES)"),
  `docker-compose.dev.yml:1` and the `deploy/cloud-init.sh` comments (Lightsail).
- New `docs/integrations.md` (12J.1, 12J.2): for planner developers: connecting in three steps,
  keys, each call with a curl example, the order of PUTs (one at a time per ref, no automatic
  replays), the webhook types and body with their zod schemas, verification code, errors
  (`unknown_role` included), limits, retries, and that webhooks need the worker, which runs once
  Twilio is connected.
- `docs/rules-and-credentials.md`: statuses, only checked items count, session requirements, CSAS
  (recorded by the office under its own scheme), right to work (a status, not a rule), the travel
  filter (a preference, not a rule), `checkEligibility()`'s `checks`.
- `docs/messaging-templates.md`: section 5.7.
- `docs/compliance.md`: sub-processors (the host, the email provider, Anthropic once AI is on,
  TravelTime, postcodes.io) and the firm's planner as a recipient; photos (no biometrics); the
  travel and strikes DPIAs; strike cautions; the Article 9 condition for "I'm unwell" and the
  appropriate policy document; the retention schedule (strike log entries included); retention
  still owner-only after S10.
- `docs/privacy-notice.md`: strikes, strikes-team email, travel area, photos, the planner, the new
  sub-processors, and the AI wording (5.8).
- `docs/runbooks.md`: "Set up the server (once)" for any UK/EU Docker host, restore and monitoring
  for it (12X.1); email not arriving (12X.2); travel provider outage (12G.2); a failing webhook, a
  leaked API key, rotating `INTEGRATIONS_SECRET` (12J.2); strikes email change (12B.7).
- `docs/business.md` and `docs/product-spec.md`: the AWS lines (12X.1).
- New: `docs/dpia-travel.md` (12G.1) and `docs/dpia-strikes.md` (12C.1).
- `docs/testing.md`: fake travel provider and geocoder, the fake email, AI and webhook transports,
  the new seed.
- `docs/walkthrough.md`: menu and Log out location, new demo steps.
- `docs/decisions.md`: ADR-021 (no AWS, written 2026-10-06; ADR-011's Lightsail lines amended the
  same day); ADR-022 for the planner integration layer, written in 12J.1 before its code lands,
  amending ADR-008 (target firms), ADR-011 (a second look-up before a firm is known) and ADR-012
  (the key, not the host, decides the firm), and recording golden rule 3's exception; 12J.2 adds
  the webhook part; ADRs for D1 and D3 (12I.3).
