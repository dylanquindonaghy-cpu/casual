# Office v2 and casual app v2 (Phase 12)

Added 2026-10-06 at Dylan's request. The office becomes a compact add-on that sits next to each
firm's own planner and CRM instead of copying them, and the casual app gains qualification
statuses, the staff photo, and shifts limited to the casual's own travel area, each showing the
distance and the time by car and by public transport. This file is the spec. The build order is
`PLAN.md` Phase 12, whose tasks name the sections here. Every open choice and database change is a
row in `PLAN.md` "Decisions waiting for Dylan" (section 8 gives the row numbers).

**How to use this file.** Read the section your task names before building. The file:line
references are as of commit `b3f3627` (branch `ui/clarity-and-guides`); re-read the cited lines
first, because they move. Example dates follow 2026's calendar (6 Oct 2026 is a Tuesday); the
mock-up's weekdays follow 2025's, so its "Mon 6 Oct" is a Tuesday here. Every name, venue, address,
postcode and email in this file is made up (golden rule 7): Acme Events, the Acme Demo venues,
Northgate, Exampleton, `ZZ` postcodes and `.example` addresses.

**"S" numbers** are the database changes in section 5.1. Each needs Dylan's own OK, one by one
(CLAUDE.md "How to work each task", step 2). **"D" numbers** are the decisions in section 8: each
has a default the build uses unless Dylan says otherwise.

---

## 1. In short

**The office shell.** A dark or light shell in the style of the staff portal Dylan named as the
reference (an in-house tool, not named here), with ShiftDesk's own name, logo, colours and made-up
data, never a copy.
It has a top bar with the pay week, a "needs attention" bell and the enquiries count, and a menu
that is a sidebar on a computer and a drawer behind a "Menu" button on a phone.

**The resourcer dashboard** shows four counts and four sections:
- **Urgent shifts not filled.**
- **Showing to casuals.** Every event and every session has an on/off switch.
- **Cancellations.** A cancellation is final the moment the casual confirms it. Each one is a full
  record with a PDF and a CSV, and is marked CANCELLATION in the firm's rota sheet. A casual who
  cancels with under 48 hours' notice gets a strike automatically, and the evidence is emailed to
  the firm's strikes team address (a setting).
- **Enquiries.** What the casual asked, the exact reply, and step by step how it was answered.

**Events and payroll.** Events are split into sessions, each with its own pay rate, post, meeting
point, uniform and requirements. Payroll gets its own dashboard.

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

**What Dylan signs off:** ten database changes (S1's core is recorded as approved; S1's two extras
and S2 to S10 need his OK one by one, section 5.1) and eight decisions, each with a default
(section 8). D6, booking by reply number, is also a new way of proving who the casual is, so it
waits for his explicit OK like a database change. Every task that touches schema, auth or tenancy
waits for his OK on its plan (section 9).

### 1.1 The approved mock-up, in words

The visual source of truth is the mock-up Dylan approved on 2026-10-06, "ShiftDesk Office
Mock-up". It is a private claude.ai artifact that builders can't open (and a temporary file on
Dylan's machine), so this section describes it. Task 12A.0 keeps a copy in the repo,
`docs/mockups/office-v2.html`, once Dylan OKs it (`PLAN.md` Checks 17); until then this section
is all builders have. The mock-up is one page of made-up data: switches and buttons work on the page
only, and a "tap to switch" control on the account button lets a viewer see the Resourcer, Payroll
and Admin menus (not a real feature). Where v2 deliberately differs from it, the list at the end of
this section says so.

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
- The "Casual's app" office page and top-bar button are not built: each casual's page has "What
  {first name} can see now" instead, and the guide has screenshots (section 3.11).
- Strikes has no menu badge (strikes need no action).
- "Cancellation & strike rules" becomes "Rules & settings" (section 3.10).
- Photo renewal is every 3 years by default, not 2 (D3).
- The dark theme defaults to navy, not graphite (D7). Colours change where contrast failed (3.1).
- Travel says "by public transport", with the route ("Train from … then a 6 min walk") on the
  shift's page, rather than "by bus" or "by train".
- "Mark as dealt with" becomes "Close without a reply", which asks for a reason code (3.6).
- The pay-week pill comes from the pay calendar setting (D8); the font is self-hosted.
- The Casuals menu badge counts uploads to check (the mock-up's said "9 need updating").
- The office sees a casual's travel district only ("ZZ1 · 45 min"; the mock-up showed "ZZ1 4"),
  and replies and the casual's Home say "from your home area" rather than the postcode, because
  the office sees replies word for word (3.6).
- The planner cell never holds the reason (the mock-up's "Your planner" box said it did).
- No "Today" pill on the dashboard: the freshness line replaces it.
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
- A dropout close to the start marks the shift urgent and starts offer waves
  (`src/lib/roster/urgent.ts:27-71`, waves at line 55).
- Open shifts: next 28 days, at most 50 checked (`src/lib/portal/open-shifts.ts:23-24`), the query at
  134-154 already joins the site's postcode.
- `messages.reply_to` and `messages.intent` (`src/lib/db/schema/messages.ts:50-52`); the shifts
  line's "office" keyword ("help", "office", "talk": `src/lib/inbound/keywords.ts:20`); the reply
  job still wired to `noAi` (`src/lib/inbound/reply.ts:563-568`).
- `credentials.verified_at` and `verified_by` columns, not yet filled
  (`src/lib/db/schema/people.ts:129-130`); credential statuses valid, expired, applied, suspended
  (line 126).
- `sites.lat` and `lng`, unused ("Kept for Stage 3", `src/lib/db/schema/tenancy.ts:90-92`); the app
  may edit `sites` (`src/lib/db/admin/access.ts:21`) but only read `firms` (line 20).
- `assignments.override_reason` (migration 0033).
- The payroll digest's schedule (`digestDueOn()`, `src/lib/pay/digest-schedule.ts:48`),
  `loadDigestStatus()` (`src/lib/pay/digest.ts:468`), `loadPayQueryGroups()`
  (`src/lib/office/pay-query-groups.ts:59`), "Send the digest now" (`queuePayDigestNow()`,
  `src/lib/pay/digest.ts:425`).
- Office areas and `canAccess()` (`src/lib/auth/roles.ts`); the Phase 11 shell
  (`src/app/office/{layout,office-shell,office-nav}.tsx`) and design tokens (`src/app/globals.css`).

**Missing (built in Phase 12):** any dark theme (`src/app/globals.css` has light tokens only, and no
`prefers-color-scheme` rule anywhere in `src/`); events and per-session fields; strikes; travel
areas and travel times; uploads and the staff photo; PDFs; an SES email transport (the email
attachment schema allows CSV text only, at most 6,000,000 bytes,
`src/lib/messaging/transport.ts:8-20`); a `/office/pay` page (only `/office/pay/import` exists);
`pdf-lib`, `@pdf-lib/fontkit` and an embedded font file (pdf-lib's built-in fonts only cover a
basic Western character set, so names such as Łukasz, Ştefan or Gülşen and "✓" would fail),
`sharp` and `@aws-sdk/client-sesv2` (not in `package.json`); `next/font` (not used yet).
Payroll's `/office` is a placeholder ("Your dashboard will appear here.", pinned by
`tests/e2e/office.today.spec.ts:67`).

**Needs a database change:** S1 to S10 (section 5.1).

---

## 2. Requirements checklist

| # | Dylan's requirement | Where this plan covers it |
|---|---|---|
| A | Compact: resourcers keep their own CRM and planner | 3.1 (menu), 3.11 (shift-editing pages leave the menu, Today is merged), 5.3 |
| B | Show casual enquiries and how they were answered by AI | 3.6 |
| C | Cancellations are cancellations, not requests, and can't be denied | 3.4 (no approve or decline anywhere), 4.5 |
| D | Show casuals what we urgently need | 4.2, 4.3, 3.2 (first count), 5.7 (`shift_urgent`) |
| E | Resourcers control what is shown to casuals | 3.3 (event and session switches), S1, S2 |
| F | Cancellations happen automatically; show who cancelled what | 3.2, 3.4 |
| G | Payroll gets its own version | 3.8 |
| H | Polished UI: main dashboard, hamburger menu to more detailed pages | 3.1, 3.2 |
| I | Research similar services | 7 |
| 1 | Looks like the reference portal but isn't a copy (own name, logo, colours, made-up data); dark and light | 3.1, 9 (seed data), D7 |
| 2 | Dashboard counts and sections, with the exact names approved | 3.2 |
| 3 | Events split into sessions (role, times, pay rate, post, requirements, specifics), shown to casuals, the office and on cancellation records | 3.3, 3.4, 4.4, S1, S2 |
| 4 | Cancellation records with PDF, CSV and a possible feed; written back to the planner; strike under 48h; evidence emailed to a per-firm address; strikes page; withdraw with a reason; no strike when the office cancels | 3.4, 3.5, 5.3, 5.6, S3, S4, D4, D5 |
| 5 | Enquiries show the question, the exact reply and how it was answered, including checks. Personal, detailed shift lists built by code, including CSAS. Pay questions never get an AI answer | 3.6, 5.7, 6.1, D6 |
| 6 | Payroll dashboard | 3.8 |
| 7 | Casual app: home, shift detail, cancel with strike warning, profile | 4 |
| 8 | Qualification statuses and a "needs updating" list; staff photo with last upload and renewal; shifts limited by the casual's location; distance plus car and public transport times on every shift, urgent or not | 3.7, 4.2–4.6, 5.4, 5.5, S6–S9, D1–D3 |
| 9 | Commit freely; list each database change separately for approval | 5.1, 9 (approval gates) |

---

## 3. Office

### 3.1 Shell and theme

**Top bar, left to right:**
1. **Menu button.** A hamburger with the word "Menu", shown on phones only (860px and narrower).
2. **Brand.** ShiftDesk mark, with the firm's name underneath.
3. **Pay-week pill.** "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct · Current", worked out from the pay
   calendar setting (D8). On phones it moves into the drawer header as "Wk 41 · Pay 16 Oct".
4. **Search box.** "Search events, casuals, references". It is a POST form, so casual names never
   appear in the web address. Results are on `/office/search` and only ever cover this firm.
5. **Bell.** "Needs attention, N" (section 3.9).
6. **Speech bubble.** "Enquiries needing a person, N".
7. **Moon/sun button.** Switches between light and dark, with a visible tooltip.
8. **Account button** (avatar, name, role). It opens: Theme (System / Light / Dark), How-to guide,
   Log out.

**Menu.** One `<nav>` element, rendered by the server as real `<a href>` links, so it works without
JavaScript. It changes with screen width:

| Screen width | How the menu shows |
|---|---|
| 1200px and wider | Full sidebar, 272px |
| 861–1199px | A narrow icon strip (labels hidden but still read by screen readers, tooltip on hover and keyboard focus) |
| 860px and narrower | A drawer opened by the Menu button |

- The person's own collapse choice is kept in a cookie (no database change).
- Collapsing snaps instantly, with no animation.

**Drawer behaviour:**
- It behaves as a modal dialog: `role="dialog"`, `aria-modal`, and the rest of the page is made
  untouchable (`inert`) while it is open.
- Focus moves to the current page's link. Escape, a tap on the dimmed background, the close button
  or choosing a link closes it.
- When dismissed, focus returns to the Menu button. After choosing a link, focus goes to the new
  page's `<h1>`.
- When closed, it is set to `visibility:hidden`, so its links can't be reached with the Tab key.
- No ARIA `menu` roles; it is ordinary navigation.

**Current page.**
- Marked with `aria-current="page"`, a 3px accent bar on the left edge, the soft accent background
  and the filled icon.
- On a child page (for example one cancellation record), the parent link gets
  `aria-current="true"`.
- Page titles read "{page} · {firm} shifts", the existing pattern.

**Menu per role** (each link appears when the task that builds its page lands; until then the menu
holds today's pages under these groups):

| Group | Link | Admin | Resourcer | Payroll | Badge |
|---|---|---|---|---|---|
| Pinned (only when an event is starred) | Starred events | yes | yes | – | – |
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
| Configuration | Rules & settings | yes | – | – | – |
| | Planner connection | yes | – | – | – |
| | Office team | yes | – | – | – |
| | Data requests | yes | – | – | – |
| Help | How-to guide | yes | yes | yes | – |

- **Menu names and counts.** Group names stay plain text. Badge counts sit outside the link's
  accessible name: "Enquiries" stays exactly "Enquiries", and the count is read as separate hidden
  text. This keeps `exact: true` link lookups in the tests working.
- **Office areas in `src/lib/auth/roles.ts`** (each added with its page):
  - `events`, `cancellations`, `strikes`, `enquiries`, `casuals` (renamed from `workers`) and
    `attention`: admin and resourcer.
  - `settings`: admin only.
  - `pay` stays admin and payroll.

**Floating orange pill.**
- It only appears when something is waiting, and says how old the oldest item is: "2 enquiries
  need a person · oldest 3 h 35 min". For payroll: "10 pay queries waiting · oldest 3 days".
- It is anchored to the content column, not the window edge, and the page gets
  `scroll-padding-bottom: 80px`, so it never covers the menu or the item that has focus.

**Fixes carried over from the review of the approved mock-up:**
1. The pill covered the lower menu links on a 1366×768 screen: anchored as above.
2. The closed drawer's links could be tabbed to: `visibility:hidden` plus `inert`.
3. The menu was built by script only: now server-rendered links.
4. The saved theme flashed on load: now a cookie read by the server.
5. Several items failed contrast: new colour values in the table below.
6. List rows were `<button>`s containing `<p>` and `<div>`: rows become
   `<a class="row" href="/office/cancellations/B71E0C42">` with `<span>` content.
7. On narrow screens the detail panel landed below the whole list: under 1100px each row opens its
   own page.
8. Changing view didn't move focus, change the title or the URL: every view now has a real URL,
   focus moves to the `<h1>`, and filters are `?view=` links.

Also: channel icons get visually hidden text instead of `title` tooltips, and the mock-up's
`aria-live` on whole detail panels is removed.

**Colours and polish.** All colours live as tokens in `src/app/globals.css`, redefined for dark
mode. There are no hard-coded colours; today there are 29 `bg-white` uses in 16 files under `src/`.

| Item | Fix (contrast measured in the review) |
|---|---|
| Pill text | Dark text #1b1d23 on #ff8a00: 7.13:1 (white on orange was 2.36:1) |
| Count badges and the solid danger button in dark mode | New `--urgent-fill` #d92d20 with white text: 4.83:1 (was 2.79:1) |
| Switch track when off | #7a8396 light / #7c8598 dark (graphite): at least 3.5:1. With navy (D7): #7c8aa8 |
| "Live" chip / amber chip, light theme | #116b33 (6.02:1) / #9a4f00 (5.38:1) |
| Chips, switches, current-page bar | A transparent 1px border, so they keep an edge in Windows high-contrast mode |

- **Type sizes:** one scale of 12 · 13 · 15 · 18 · 24 · 30px. Fixed-width digits on every time,
  rate and count.
- **Font:** Plus Jakarta Sans, self-hosted with `next/font`, so nothing is requested from Google
  while the app runs.
- **Session rows:** divided rows inside the event card, not boxes nested inside a box.
- **Tap targets:** at least 44px for the star and the switches.
- **Press feedback:** buttons shrink slightly (`scale(.96)`); colour changes take 150ms or less.
- **Dark theme colours:** navy by default, or graphite (D7).

**Theme without a flash.**
- A cookie, `sd-theme` = `system`, `light` or `dark`, is read in `src/app/layout.tsx`, which writes
  `data-theme` onto `<html>`.
- `<meta name="color-scheme" content="light dark">` is added, and a new `prefers-color-scheme:
  dark` block in `globals.css` (guarded so an explicit `data-theme` wins) handles "System". There is
  no dark mode today.
- Colour transitions are switched off for one frame during a change, so the switch doesn't smear.
- Casuals use the same cookie and can override it in Profile.
- The firm's brand bar on staff pages and logged-out office pages stays exactly as it is
  (`tests/e2e/brand.spec.ts`).
- No database change.

### 3.2 Resourcer dashboard (`/office`)

**Header:**
- "Dashboard" and the search box.
- "Sync with planner": Google Sheet firms only. It queues the sheet sync job and is logged.
- A freshness line: "Planner synced 09:40", or on error: "Couldn't reach your planner at 09:40.
  Showing data from 09:10."

**Counts** (each is a link to a filtered list; the first is tinted and larger, the other three
muted):

| Count | What it counts | Small line under it | Links to |
|---|---|---|---|
| Urgent shifts not filled | Sessions marked urgent, with a place free, not yet started | "3 places · first starts Wed 10:30" | `/office/events?view=urgent` |
| Events showing to casuals | Events switched on that still have a session to come | "26 open places across 8 sessions" | `/office/events?view=showing` |
| Cancellations today | Bookings cancelled since midnight (London time), by casuals or the office | "1 under 48 hours · 1 strike issued" | `/office/cancellations?day=today` |
| Enquiries today | Messages to the shifts line since midnight, plus requests made in the app | "16 answered automatically · 2 need a person" | `/office/enquiries?day=today` |

"Today" means the calendar day. Today's page uses the last 24 hours instead
(`src/lib/office/today.ts:25`).

**Sections, in this order:**
1. **Urgent shifts not filled** ("Casuals see these first, and get an alert"). Event cards
   (section 3.3) showing only their urgent sessions with a gap.
   - Each card has a code-written line, such as "Re-offered: 12 qualified casuals have it within
     their travel area", or the existing "Offers stopped: nobody else can take it."
   - If a hidden event has an urgent gap, the card warns: "Hidden from casuals: nobody can see this
     gap."
   - When empty: "Every urgent shift is filled."
2. **Showing to casuals** ("Switch an event off to hide all its sessions from casuals"). Events
   that are switched on, starred ones first, then by date.
   - Compact cards: 2 sessions, then "+ N more".
   - Switching an event off shows a status message: "Hidden from casuals. Booked casuals keep their
     shifts. Undo."
3. **Cancellations** ("Recorded automatically, never approved or declined"). The latest three.
   Each shows:
   - who cancelled, or "The office cancelled {name}";
   - the session, event, date and time;
   - chips for the notice given (red under the strike threshold), "Strike issued", and "Planner:
     CANCELLATION" (sheet firms only);
   - a link "All records".
4. **Enquiries** ("What casuals asked, and the reply they got"). The latest four. Each shows:
   - the name and channel icon;
   - their words in quotes;
   - an outcome chip;
   - the first line of the reply;
   - a link "All enquiries".

**Who sees it.** Admins see the same dashboard. Payroll is sent to the Pay dashboard.

**Code.** New loader `src/lib/office/dashboard.ts`. It reuses the urgent and cancellation queries
from `src/lib/office/today.ts` and the enquiry loader from 3.6.

### 3.3 Events and sessions (`/office/events`, `/office/events/[id]`)

**Where events come from:**
- **Google Sheet:** from an optional "Event" column. Rows without one are grouped by date and site
  into an automatic event, named like "Acme Demo Arena · Sat 10 Oct", so every session belongs to
  an event and the switch always works.
- **File import:** the same.
- **ShiftDesk's own form** ("Shifts for an event", `/office/shifts/event`): creates the event row.

**What a session is.** Today's `shifts` row, plus the S2 fields: role, start and end time,
filled/needed, pay rate, post, meeting point, uniform, and extra requirements shown as chips (SIA
DS, CSAS, First aid).

**Event card.** It shows:
- the title, place and date;
- a star, which pins the event for the whole office (S1 extra);
- the event switch, labelled "Show {event} to casuals";
- one status tag (Showing or Hidden), plus "Urgent" only when it applies;
- plain text such as "2 sessions · 3 places free".

Each session row has its own switch with a unique label, for example "Show Door supervisor
08:00–16:00 to casuals". A full session reads "Full: not showing".

**Card buttons:**
- **View sessions:** opens the event page, with booked casuals and "Mark who worked".
- **View booked casuals.**
- **"…" menu:**
  - Offer a place (`/office/offer/[shiftId]`).
  - Assign.
  - Mark urgent / not urgent (`src/lib/roster/urgent.ts`).
  - Change or cancel (the existing `/office/shifts/[id]` forms the office uses to change or cancel.
    Sheet shifts are still refused, `src/lib/roster/cancel.ts:96,204`).

**Tabs** (links, so back, refresh and sharing work): All · Showing · Hidden · Urgent, not filled.

**Firms without a planner sync** also get "Add shifts" and "Import shifts" buttons in the page
header.

**What a switch does.** It is ShiftDesk's own setting: never read from or written to the planner,
so a sync never overwrites it. Hiding an event or session:
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

It is a display choice, not an eligibility rule, so it stays out of the rules engine. The event's
switch is S1's core, already approved, so it is built on its own (12B.4a) with the Events pages
(12B.5); the session's switch needs S2 (12B.4b).

### 3.4 Cancellations (`/office/cancellations`, `/office/cancellations/[ref]`, `/[ref]/pdf`, `/export`)

**There is nothing to approve.** A casual's cancellation already becomes final in `cancelBooking()`
(`src/lib/roster/cancel.ts:57-69`). v2 adds the following steps to the same database transaction:
1. The strike decision (3.5).
2. The cancel-screen warning the casual saw (S3).
3. The existing steps: reopen the place, mark it urgent after a dropout, start the offer waves
   (`src/lib/roster/urgent.ts:27-71`), and write the log entry.

Then background jobs (carrying ids only) handle:
- the evidence email to the strikes team;
- the strike message to the casual;
- the write-back to the planner at the next sheet sync.

**Counts, this week:**
- Cancellations: "9 by casuals · 2 by the office".
- Under 48 hours' notice: "3 strikes issued".
- Places filled again: "median 52 minutes to refill", worked out from the bookings' own times (the
  cancelled booking's `cancelled_at` and the replacement's `confirmed_at`), not the log's: log
  entries are stamped when written and can't be backdated, so the demo seed couldn't show it.
- Marked CANCELLATION in your planner: "last sync 09:40". For firms without a sheet: "Included in
  your planner changes email".

**Views:** All · Under 48 hours · Strikes issued · By casuals · By the office.

**On screen.** On wide screens the list sits on the left and the record on the right. Under 1100px
each row opens the record page.

**What one record shows** (reference = the first 8 characters of the booking id, as today):

| Field | Source |
|---|---|
| Casual, staff id | `workers` |
| Event; session (role, date, start–end); post; pay rate; requirements; meeting point | `shift_events`, `shifts` (S1, S2) |
| Booked at | `assignments.confirmed_at` |
| Cancelled at, and how ("In the app", "In the app, after a WhatsApp reply", "By the office (Sam Rota)", "Removed on the rota sheet") | `cancelled_at`, plus `cancel_via` (S3) and the log |
| Notice in hours, and whether it was under the threshold | `notice_hours` |
| Reason: on screen (admins and resourcers only), the casual's quick reason or the office reason from the fixed list. In the PDF, the CSV and every email, all four quick reasons read "Casual's own reason (see ShiftDesk)", because "I'm unwell" is health data and those files leave ShiftDesk (6.3); office reasons keep their fixed words | `cancel_reason` |
| Strike box: issued, exempt (with the reason) or none; the casual's strike count | `strikes` (S4) |
| Evidence email: sent at what time to the strikes team / not set up / failed and retrying | `strikes` (S4) |
| Planner: "Marked CANCELLATION in your rota sheet (row 42) at 19:06", or "In the changes email of 7 Oct" | log entry `planner.cancellation_written` |
| What happened next: "Place reopened and marked urgent · offered to 5 people · filled again by Ben Fraser at 22:02" | existing log entries for what happened; the times from the bookings' own times (as the refill count above) |
| Warning shown on the cancel screen, and its version | S3 |

**PDF per record.**
- What it contains: the same fields, a short timeline (booked, reminders sent, cancelled, reopened,
  filled), "Produced by ShiftDesk from {firm}'s data", and the date and time it was generated.
- How it is built: on the server with `pdf-lib` (pure JavaScript, MIT licence) and
  `@pdf-lib/fontkit`, with an embedded font (Noto Sans, or the self-hosted Plus Jakarta Sans) that
  covers names such as Łukasz, Ştefan or Gülşen and the "✓" mark. pdf-lib's built-in fonts can't
  print them and would throw, so the record and the evidence email would fail for those casuals.
- The reason follows the table above: "Casual's own reason (see ShiftDesk)" for every quick reason.
- Each download is logged as `export.downloaded`.

**CSV of all cancellations.** It follows the chosen view, is capped at 20,000 rows like the notice
report, and each download is logged. Columns:
- reference, casual, staff id, event, site, role, date, start, end, post, pay rate;
- booked at, cancelled at, who cancelled (casual/office), how;
- notice hours, under threshold (yes/no), reason (a casual's: always "Casual's own reason (see
  ShiftDesk)"; the office's: its fixed words);
- strike (yes / exempt: reason / no), evidence sent at, planner marked at, what happened next.

The casual's actual reason and their own free-text note appear only on the record page, for admins
and resourcers, never in exports.

**A live feed or API** comes later (D5; Parking lot).

**Office cancellations** never give a strike.
- The record keeps the reason, the notice hours and the session's expected pay (rate × hours,
  stored in the log entry's data as whole pence), ready for the Employment Rights Act. Admins and
  resourcers both see it (3.8).
- They appear in the notice report.
- The casual is told as today (`shift_cancelled_by_firm`).

### 3.5 Strikes (`/office/strikes`)

**The rule** is a pure function, `strikeDecision()` in a new `src/lib/strikes/decide.ts`, with heavy
unit tests. In order:

1. Cancelled by the office or the sheet: no strike.
2. Notice of at least `strikes.notice_hours` (default 48), measured from `toldAt`: no strike.
   - `toldAt` is the cancellation time, or earlier when the casual first sent a shifts-line message
     that got the cancel reply naming this booking (5.7 item 3) and then cancelled that booking.
     Example: "cant make tmrw" at 50 hours, then Cancel tapped at 46 hours: 50 hours' notice, no
     strike.
   - The cancel reply's `enquiry.checks` entry names the bookings it listed (ids only, 12D.2).
     Until 12D.2 lands, `toldAt` is the cancellation time.
   - An AI label alone never moves `toldAt`: the casual's own cancellation of that booking confirms
     what they meant.
3. Cancelled within `strikes.grace_minutes` (default 15) of booking: exempt, "cancelled soon after
   booking".
4. The office booked them ("Assign": `shift.assigned` with `by: "firm"`,
   `src/lib/roster/book.ts:286-301`): exempt. The casual never accepted the shift in ShiftDesk, so
   a strike for turning it down would be the kind of detriment 6.2 warns about.
   - The reason reads "rules override" when the office booked them by overriding a rest or
     weekly-hours check (`assignments.override_reason`, migration 0033), otherwise "booked by the
     office".
   - An office "Offer to someone" that the casual took themselves is their own booking, not this.
5. The office moved, shortened or changed the role, site or pay after the booking (log entries
   `shift.moved`, `shift.curtailed`, `shift.changed` after `confirmed_at`): exempt, "the office
   changed it".
6. Otherwise: strike issued.
   - It is flagged "needs a person to review" when the reason was "I'm unwell" or "Family or
     caring" (an emergency with a dependant raises the same Equality Act questions as illness), or
     when the session was taken less than 48 hours before it started.
   - The strike still stands, as Dylan asked.

Table tests cover every case and boundary, including an office-assigned booking, notice told by
message at 50 hours and cancelled at 46, and "Family or caring" flagged.

**After a strike.**
- **How long it counts:** `strikes.live_days`, default 90, matching the mock-up's "strikes in the
  last 90 days". After that it shows as expired.
- **When the record goes:** at `strikes.keep_months` (12), deleted by an owner-run
  `app_purge_old_strikes()` called from the nightly retention job. The app's login can't delete
  strike rows (S4), so this follows `app_purge_old_messages()` (migration 0034), and like it
  deletes nothing while `retention.hold_until` holds (a dispute or tribunal).
  - The `strike.issued` and `strike.withdrawn` log entries (ids, codes and hours only) stay in the
    action log, which isn't purged yet (`src/lib/gdpr/retention.ts:41-43`; `PLAN.md` Data 2). The
    help page, 6.2, 6.3 and the privacy notice say so rather than promising everything goes at
    12 months.
- **Telling the casual:** `strike_issued` (5.7 item 6) goes from a background job that claims the
  message first and then sends it, as the other notices do (`src/lib/notices/request-update.ts`):
  held by quiet hours, by text when WhatsApp refuses it (`src/lib/messaging/transport.ts:53-55`),
  `casual_notified_at` set, logged. A send that fails unclearly is never repeated, because it may
  already have arrived.
- **When the office is told:** at `strikes.alert_at` live strikes (default 3), a "Needs attention"
  item appears: "Kieran Doyle has 3 live strikes. Nothing happens automatically: decide whether to
  talk to them."
- **What happens next is a person's decision.** Any pause in offering work goes through the
  existing "make inactive" control, which needs a reason and is logged.

**Table:**
- Columns: casual, live strikes, latest strike (session, notice), evidence status, review flag, the
  casual's own account ("Tell us what happened"), actions.
- On phones it shows as stacked cards.
- Filters: Live · Needs review · Withdrawn · Expired.
- A CSV download.
- No menu badge.

**Withdrawing a strike.**
- "Withdraw strike…" asks for a reason (1–500 characters).
- The strike row keeps who withdrew it, when and why; the log keeps the event without the reason
  text.
- The casual is told with `strike_withdrawn`.

**Reviewing.** "Mark reviewed" records an outcome note, used for health-flagged strikes and strikes
where the casual has told us what happened.

**Erasing a casual** clears a strike's free text (their account, the withdrawal reason, the review
outcome), as it already does for cancellation notes (`src/lib/gdpr/worker-erase.ts:34-38`).

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

**Summary strip:**
- enquiries today;
- % answered straight away;
- typical reply time, automatic vs by a person;
- need a person, with the age of the oldest;
- topics this week, as a bar list.

Topics stay ShiftDesk's fixed list: shifts, cancel, pay, office.

**Views** (links): All · Answered automatically · Sorted by AI · Need a person · Pay · Requests from
the app.

**Filters:** Today / Yesterday / 7 days, channel, topic, "a check failed", and text search (POST).

**Each row** shows the name (or "Unknown number" / "Withheld"), a channel icon with hidden text,
their words, an outcome chip, a reply timer if waiting, and the time.

**Detail page:**
1. **The conversation.** Their message, then the exact reply as the casual saw it, styled like
   WhatsApp, then any later messages.
2. **"How it was answered".** A numbered timeline built from logged facts:
   1. Received: channel and time, matched to the casual's record (or unknown).
   2. Sorted: "The word 'shifts' matched", or "AI sorted it as 'pay' (model, prompt version)", or
      "AI not available: passed to a person (timed out / not connected / invalid label / photo
      only)".
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
      - The office never sees more of a casual's home than the district (6.3): the replies say
        "from your home area" (5.7), and the checks name the district.
   4. Reply built: template and version, and the sessions listed (as links).
   5. Sent: delivered, sent by text after WhatsApp failed, or failed with its error code.
   6. Then: for example "Zoe took option 1 at 21:20", or "Answered by Sam at 10:02".
3. **"Considered but not offered"** (office only). For example: "Response team lead: needs first aid
   at work (none on file)" or "Sun 11 Oct sessions: already booked 10:00–18:00". This answers "why
   can't Zoe see that shift?"

**Outcome labels come from code only**, never from AI: Answered by keyword · Sorted by AI, answered
from your data · Passed to a person, waiting · Passed to a person, answered · Not understood · Pay
(always a person) · Done in the app.

**Need a person:**
- **Reply timer:** grey until 75% of `enquiries.reply_target_minutes` (default 60), amber up to the
  target, red after it.
- **WhatsApp window countdown:** "Free reply closes in 3 h 12 min; after that only approved
  templates."
- **The reply box:**
  - Inside the 24-hour window, the reply is sent as free text and stored as an outgoing `messages`
    row with `reply_to`. Today these replies aren't stored (`src/lib/inbound`).
  - Outside the window, it goes as the `request_update` template.
  - A reply to an unknown number is stored the same way (`messages.worker_id` may be empty).
- **"Close without a reply"** asks for a reason code from a fixed list: dealt with by phone / not
  for us / duplicate / spam / other. It is logged as `enquiry.closed` with the code, never typed
  text: typed text never goes in the append-only log (`src/lib/roster/cancel.ts:25-27`,
  `src/lib/office/worker-reasons.ts:1-3`), and a message from an unknown number has no request row
  to hold it (`requests.worker_id` is required, `src/lib/db/schema/roster.ts:303`).
- **Wording:** "approved/declined" becomes "answered" for questions (the `PLAN.md` Parking lot item
  "Shifts line replies follow-ups"; Messages 13).

**Pay enquiries.**
- They carry a lock chip: "Pay: never answered by AI (rule)".
- The casual gets the fixed pay reply and nothing else.
- Payroll sees them on the Pay dashboard.

**Review loop.**
- Each automatic answer has "Right answer" / "Wrong answer: tell us" (choose the correct topic
  from the fixed list; no typed note, for the same reason as "Close without a reply"). This writes
  a log entry, `enquiry.reviewed`, holding the topic only.
- A "To review" filter collects every AI-sorted or passed-to-a-person enquiry, plus a random 5% of
  the rest each week.
- Corrections are kept as test cases for the sorter. The AI is never retrained silently.

**Honest banner.** Until "Connect Bedrock" (`PLAN.md` Parking lot) is done, the page shows: "AI
sorting isn't connected yet: messages without a keyword go to a person." The live reply job is
still wired to `noAi` (`src/lib/inbound/reply.ts:563-568`).

**Data.** There is no new enquiries table:
- the enquiry is the `messages` row;
- its history is `events` rows, the log that can't be edited;
- its office question is the `requests` row (S5 adds a proper link).
- **Need a person** is worked out, not stored: an inbound message handled as office or unknown with
  no later `enquiry.answered` or `enquiry.closed` log entry for it (and, if it has a request, the
  request still open).
- **Request statuses keep their values** (`src/lib/db/schema/roster.ts:55-61`, 337-339): an
  answered question is stored `approved` and shown as "Answered", so no migration is needed.

`enquiry.checks` records, in 6.1's shape: the rules version (a new `src/lib/rules/version.ts`),
every check, the offered session ids in the order listed, at most 50 not-offered sessions with
reason codes plus a count of the rest, the bookings a cancel reply named, the template and
version, whether the reply was sent, and the travel figures as minutes only (never a postcode).
Booking by number (5.7 item 2) and `toldAt` (3.5) read their lists from this entry.

**Personal replies.** Built by a new `src/lib/inbound/personal-reply.ts`, from `openShiftsFor()` with
exactly the casual app's filters: eligibility, the showing switches and the travel area. The words
are in 5.7. AI never writes them. The reply has a character budget, so it never goes over the
1,600 characters a WhatsApp or text body may hold (`src/lib/messaging/transport.ts:31,37`,
`src/lib/db/schema/messages.ts:94`; over it, the send or the save fails and the casual gets no
reply): names are cut to set lengths, fewer shifts are listed until it fits, and it ends "+ N more:
{link}".

### 3.7 Casuals (`/office/casuals`, `/office/casuals/[id]`, `/office/casuals/uploads`)

**Counts:**
- Ready to work ("Everything in date").
- Expiring in 30 days ("Reminded automatically").
- Expired ("Can't take shifts that need it").
- Uploads to check ("New photos and certificates").

**Views:** All · Need updating · Expiring in 30 days · Photo due · Uploads to check.

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
  link), the check history, and approve / reject.
  - Approving sets the expiry date and number, as read from the card by a person.
  - Rejecting needs a reason: blurry / wrong document / expired / doesn't match / other.
  - **CSAS is recorded by the office only**; a casual can't upload it. Under the Police Reform Act
    2002 s.41 a chief constable accredits people employed by an organisation with a CSAS
    agreement, so an accreditation held through another employer doesn't cover this firm's CSAS
    shifts. Recording it confirms it is under this firm's own scheme (`issuer`, S6). Noted in
    `docs/rules-and-credentials.md` and on the solicitor's list (6.4).
- **"I checked the SIA register".** Records a result (active / expired / suspended / not found) and
  an expiry date, with a link to https://www.gov.uk/check-a-private-security-licence, and writes
  the log entry `credential.register_checked`.
  - There is no official SIA API (GOV.UK, 24 Aug 2026).
  - The casual sees "checked on the SIA register 1 Oct".
- **Staff photo**, with approve / reject.
- **Travel area:** district, time limit, transport.
- **Strikes.**
- **Bookings ahead.**
- **"What {first name} can see now":** the shifts they can take, plus "considered but not offered"
  with reasons, using the same code as 3.6 (the home area shown as the district only).
- **Access:** the existing controls moved from `/office/workers/[id]` (make inactive or active,
  unblock, site blocks).

**Check queue** (`/office/casuals/uploads`): every waiting upload, oldest first. Every decision is
logged.

**"Send reminders"** sends `credential_expiring`, `credential_expired` or `photo_due` to the casuals
in the current view, after a confirm screen, and respects the existing once-a-day rule.

The staff-facing word is "qualifications" or "licences and cards", never "credential"
(`tests/unit/copy.plain-language.test.ts:57-58`).

### 3.8 Payroll dashboard (`/office/pay`)

**No database change.**

**Header:** "Pay dashboard", "Import pay records", "Send the digest now" (existing,
`queuePayDigestNow()`, `src/lib/pay/digest.ts:425`).

**Counts:**

| Count | Source |
|---|---|
| Pay queries waiting (oldest) | open + in_digest `pay_queries` |
| Next digest (last sent and how many; any problem) | new `nextDigestAt()` next to `digestDueOn()` in `src/lib/pay/digest-schedule.ts`; `loadDigestStatus()` |
| Sorted this week | `pay_queries.resolved_at` |
| Next pay date | the earliest `pay_records.pay_date` from today on, otherwise the pay calendar |

**Sections:**
1. **Waiting, grouped by likely cause** ("Pay questions never get an AI answer: they come here"): the
   top groups from `loadPayQueryGroups()`, each opening `/office/pay-queries`.
2. **Recently sorted:** the last 7 days, with who, when and their note (a new loader).
3. **Pay questions on the shifts line:** the count and the latest 5 (`messages.intent='pay'`).
4. **Imports:** recent pay imports and their counts (`import.completed` with kind = pay).

**Settings.** `pay_digest` is added to `SETTING_KEYS` (`src/lib/onboarding/settings.ts:19-32`), plus
the pay calendar keys (5.2).

**Rules kept:** payroll never sees strikes; resourcers never see pay record figures (what someone
was paid; `PLAN.md` Office 2). Session pay rates (£/hour) and an office cancellation's expected pay
are shown to admins and resourcers on event cards, records, the log and the notice report
(requirement 3), because resourcers can already open the log and reports
(`src/lib/auth/roles.ts:15-16`) and the rate is shown to casuals anyway. Tested: a resourcer sees a
session's £/hour but never a pay record's amount (12B.5).

**Later, not now:** pay status per shift, a cut-off countdown, a "not ready for payroll" exceptions
list, and the short-notice payments ledger. These are parked with their database changes in 5.1
(Parking lot).

### 3.9 Needs attention (the bell, `/office/attention`)

This page holds the to-do parts of today's Today page that are not on the compact dashboard. Its
items:
- bookings to check (Today's "to-check");
- from your rota sheet (sheet problems);
- who worked? (to mark);
- uploads to check;
- evidence email failed, or strikes email not set up / not confirmed;
- casuals at the strike alert level;
- qualifications expired on a booked session;
- planner sync failing.

Payroll's version: a digest problem, and queries past their target.

Each item links to where it is dealt with. The bell's count is the number of items. This keeps the
existing logic and the regions the tests pin, on a page of its own.

### 3.10 Configuration (admin only)

**Rules & settings** (`/office/settings`). Needs S10: an owner-run database function,
`app_set_firm_setting(key, value)`, the only way the app may change `firms.settings`.
- **Why a function, not a grant.** `firms.settings` also holds `retention.message_days`,
  `retention.request_note_days` and `retention.hold_until`, plus quiet hours, offer waves and the
  urgent window (`src/lib/onboarding/settings.ts:19-32`). A database permission can't be limited to
  some keys inside one column, and migration 0034, `src/lib/gdpr/retention-settings.ts:1-3` and
  `docs/compliance.md` promise that the app can't shorten retention or lift a hold. The function
  accepts only the Phase 12 keys below and refuses `retention.*` and every other key.
- **What it also enforces:** changing an address (`strikes.email`, `planner.changes_email`) clears
  its confirmed time.
- **Tests:** the app's login can't change `retention.message_days`, `retention.hold_until` or any
  key outside the list, directly or through the function.
- **Cancellations & strikes:**
  - strike notice hours (48), grace minutes (15), strike counts for (90 days), tell the office at
    (3 strikes);
  - strikes team email, with a confirmation status;
  - short-notice threshold for the notice report (existing, 48): shown read-only, set by the owner
    as today, like the other owner-set settings.
- **Qualifications & photos:** "expiring soon" days (30, where a qualification type has no window
  of its own), photo renewal (D3).
- **Travel:** default time limit (45 min), check-in buffer (30 min), provider status.
- **Pay calendar:** week start, pay day, week numbering (D8).
- **Enquiries:** reply target (60 min).

Every change is logged as `firm.settings_changed`, the entry the owner command already writes
(`scripts/firm-settings-owner.ts:14`), with the keys and their old and new values. For the two
addresses and their confirmed times it holds the key only: the log masker refuses an email address
(6.1).

**Strikes email confirmation.**
- Saving the address sends a confirmation link, signed with HMAC (a tamper-proof signature) and
  valid for 7 days. The link signs the firm id, the address and the expiry, so a link sent for an
  old address can't confirm a new one.
- Evidence is only sent once the address is confirmed. This guards against sending to the wrong
  person, a common breach according to the ICO.
- **Until S10 lands (12B.7)**, the app can't write `firms.settings`
  (`src/lib/db/admin/access.ts:20`), so the owner sets and confirms the address:
  `firm:settings strikes.email <address> --confirm` writes the address and
  `strikes.email_verified_at` (logged `firm.settings_changed`, key only). The same goes for
  `planner.changes_email`. Without it, evidence stays `not_set_up`; 12C.4 and 12C.6 list this.
- `strikes.email` has no default. Demo data only ever uses `.example` addresses, and a unit test
  (12C.4) fails on any email address in the repo outside the reserved example domains.

**Planner connection** (`/office/settings/planner`):
- source type and last sync;
- the column mapping (read-only; the owner command `firm:sheet` changes it);
- the "Cancellations" column switch and write-back status;
- a Sites list where the postcode can be edited (the app may edit `sites`,
  `src/lib/db/admin/access.ts:21`), with a status for whether each site's location is known;
- the "planner changes" email address (5.3).

**Office team** (`/office/team`) and **Data requests** (`/office/data`) stay as they are. Worker
data export and deletion now include travel data, uploads and strikes.

### 3.11 What stays, moves or goes from today's office

Each move happens in the task that builds the replacement page; until then the old page stays in
the menu.

| Today's page | In v2 | Why |
|---|---|---|
| `/office` (Today for admin/resourcer; "Home" placeholder for payroll) | The role's home: Dashboard, or a redirect to `/office/pay` for payroll | The approved dashboard |
| `/office/today` | Merged into the Dashboard and Needs attention. The route redirects to `/office` | Compact. Every Today section has a home: urgent → dashboard; gaps → Events; requests and unknown numbers → Enquiries; cancellations → Cancellations; bookings to check, rota sheet, who worked → Needs attention; expiring → Casuals and the bell |
| `/office/shifts` (+ `new`, `event`, `import`, `[id]`) and `/office/offer/[shiftId]` | Off the menu. Events & sessions replaces the list. The routes stay and are reached from the event and session "…" menus, plus "Add/Import shifts" for firms without a planner | The planner owns shifts. The office's change and cancel forms are golden rule 12 evidence |
| `/office/requests` | Merged into Enquiries as "Requests from the app". The route redirects | One inbox |
| `/office/workers`, `/office/workers/[id]` | Renamed Casuals (`/office/casuals`), with compliance. Access controls move to the casual's page. Old routes redirect | Requirement 8 |
| `/office/log` | Kept, under Records | Evidence |
| `/office/reports/notice` | Kept, under Records. Gains office cancellations' expected pay | Employment Rights Act readiness |
| `/office/reports/pilot` | Kept, under Records | Pilot |
| `/office/pay-queries` | Kept, under Pay. Linked from the Pay dashboard | – |
| `/office/pay/import` | Kept, under Pay | – |
| `/office/team` | Kept, under Configuration | – |
| `/office/data` | Kept, under Configuration, renamed "Data requests" | Shorter |
| `/office/guide` | Kept, under Help, rewritten | New layout |
| `/office/login`, `/office/l` | Kept, restyled | – |
| Mock-up "Casual's app" page | Not a real page. Replaced by "What {first name} can see now" on each casual's page, plus screenshots in the guide | Avoids letting staff log in as a casual |

---

## 4. Casual app

### 4.1 Navigation and theme

- A bottom tab bar with four labelled items: Home · Shifts · Pay · Profile. Profile shows a dot when
  something needs updating.
- The firm's brand bar stays at the top.
- The theme follows the phone's setting, with an override in Profile.
- It is still a link, with no app to download.
- **Where today's parts of `/` go** (`src/app/page.tsx` today holds My shifts with Upcoming / Past
  30 days, the offline copy and Log out):
  - Booked lives at `/shifts` (Upcoming / Past 30 days, `?view=past` as today), next to Open under
    the Shifts tab; `/?view=past` redirects there.
  - The offline copy covers Home's next shift and Booked.
  - "My requests" (`/requests`: their own asks and the office's answers) is linked from Profile
    and from "Ask for a change".
  - Log out is the last item on Profile.
- **What shows before the database changes land.** Home, Shifts and Profile are built from today's
  data first (12H.1, 12H.3); each part that needs a database change (session pay and post, strikes,
  uploads, the photo, travel) appears with the task that brings that change.

### 4.2 Home (`/`)

1. **"Hello Zoe"**, with "Updated 21:12".
2. **Needs updating** card, shown only when something does. One action per row ("Upload your new
   card", "Take a new photo"). Order:
   1. expired and blocking a booked shift;
   2. expires before a booked shift;
   3. expired;
   4. photo overdue;
   5. expiring soon;
   6. photo due soon;
   7. missing, with "Needed for {role} shifts" or "Needed for N shifts near you" (which
      qualifications count as missing: 4.6).
3. **Urgent: needed now, and you can take them.** Urgent sessions inside her travel area. Each
   shows:
   - role · event;
   - date and time · £/hour · post;
   - the travel line;
   - places left;
   - chips such as CSAS;
   - a button "See urgent shifts".
4. **Your next shift**, in full:
   - date and time, role · event;
   - post, pay ("£12.60 an hour, about £100.80"), report to, bring/uniform;
   - getting there;
   - buttons: Open in maps · Ask for a change · Cancel this shift.
5. **Shifts you can apply for.** The top 3, with an explanation such as: "Only shifts your licences
   and hours allow, up to 45 minutes from your home area. You hold CSAS, so CSAS shifts show too."
   (The mock-up said "from ZZ1 4"; the office's "What {first name} can see now" shows the same
   words, so they never carry more than the district: 6.3.)
   - Underneath: "2 more shifts are further than you travel. Change how far". "Change how far" goes
     to the travel settings.
   - A button: "See all open shifts".

### 4.3 Shifts tab (`/shifts/open`, plus Booked)

- **Two lists.** Open (filters: day, role, urgent) and Booked (Upcoming / Past 30 days, as today).
- **Order:** urgent first, then the nearest (the quickest of her chosen ways to travel), then by
  date.
- **Each Open row:** role · event, date and time · £/hour · post, requirement chips (CSAS), places
  left, then the travel line.
- **Every row**, Open or Booked, urgent or not, has the travel line: "7.2 miles · 18 min by car · 41
  min by public transport".
  - Both times always show, whichever ways she chose; her choice only drives the filter.
  - With no public transport in time: "18 min by car · no public transport by 09:30".
- **Where the area filter is applied.** Inside the database query, before the 50-row cap
  (`src/lib/portal/open-shifts.ts:23-24,134-154`), so shifts nearby are never cut off.
- **No home area set:** a banner says "Add your home area to see how far each shift is and only see
  shifts you can get to", and the list is unfiltered (D2).
- **Site with no postcode:** the row says "Distance not known yet". It is never hidden silently.
- `/urgent` stays as the urgent-only view of this list.

### 4.4 Shift detail (`/shifts/[id]`)

- **Top:** chips (Urgent, CSAS position) and a title: role, then place and a short description.
- **Facts:** date and time, pay (with the estimate), meet (meeting point and time), post, uniform,
  places left.
- **Getting there**, "From your home area" (her postcode shows only on Profile's "Where you work",
  her own setting):
  - "8.4 miles away";
  - "About 21 min by car" (plus any parking note from the event's details, S1 extra);
  - "About 38 min by public transport", with a summary and a leave-by time: "Train from Exampleton
    to Northgate, then a 6 min walk. Leave by 15:50";
  - the journey home after a late finish, e.g. "No public transport home after 23:00: car only";
  - "Open in maps".
- **What it needs.** Each requirement with her status: "You have it, valid until 3 Mar 2027" /
  "Expires before this shift" / "Missing: upload it" / "Being checked".
- **Action.** "Take shift", or the plain reasons she can't (existing blocked states).
- **Strike note:** "Cancelling less than 48 hours before the start gives you a strike."

### 4.5 Cancel flow (the cancel step of `/shifts/[id]`)

1. **Summary:** role · event · date, time · pay · post.
2. **Warning box:** "This shift starts in 26 hours. Cancelling with less than 48 hours' notice gives
   you a strike. Acme Events' strikes team gets a record of it. You have 0 strikes in the last 90
   days." Other versions in 5.7.
3. **"Why can't you make it?"** I'm unwell / Travel problem / Family or caring / Something else
   (with a note of up to 200 characters).
4. **Buttons:** "Confirm cancellation" (solid, using the new `--urgent-fill` colour) and "Keep this
   shift".
5. **Footer:** "Your cancellation is recorded the moment you confirm. Nobody needs to approve it."
6. **After confirming:** a reference, whether a strike was recorded and until when, and a "Tell us
   what happened" button.

The version and time of the warning she saw are stored (S3).

### 4.6 Profile (`/profile`)

- **Staff photo.**
  - Shows the photo (72px) with alt text "Staff photo of Zoe Adeyemi".
  - "Last uploaded 3 Aug 2024 · renew by 3 Aug {year}", with a status: Up to date / Due soon /
    Overdue / Missing / Waiting for the office to check.
  - "Upload a new photo" opens the camera (`<input type="file" accept="image/*" capture="user">`),
    with guidance following the SIA photo checklist.
- **Qualifications.** Each has a status (Valid · Expiring soon · Expired · Missing · Being checked ·
  Not accepted: {reason} · Applied for, due {date} · Suspended), a date line, and what it means:
  "Until it's renewed you won't see door supervisor shifts."
  - Plus "Upload a certificate" (not for CSAS, which the office records: 3.7).
  - Only checked, in-date items count (D3 and 6.1).
  - **Which qualifications are listed:** every type required by one of her roles
    (`credential_rules`), plus every extra type a session asks for (`required_credentials`, S2)
    among sessions she could otherwise take in the open-shifts window inside her travel area, plus
    right to work. A listed type with no record is Missing, with "Needed for {role} shifts" or
    "Needed for N shifts near you". A type nothing needs isn't listed. 12F.1 builds this from
    today's data (her roles and right to work); session types join with 12B.3 and the travel area
    with 12G.4.
- **Right to work:** status only. "Checked by the office on 12 Jan 2026" / "Follow-up due {date}" /
  "Not checked yet: ask the office". No upload; the documents stay with the office.
  - Not "you can't be booked": no role's rule requires right to work (`src/lib/rules/packs.ts:36`
    makes it a type any sector may use, checked at onboarding; lines 69-72 list the security
    roles' rules without it), so the rules engine can book a casual without one, and the copy is
    a product promise (golden rule 11). Enforcing it is `PLAN.md` Rules 15.
- **Where you work** (`/profile/travel`):
  - start-from postcode (it can differ from home);
  - how she travels: Car / Public transport / Both;
  - time limit: 30 / 45 / 60 / 90 minutes;
  - a line explaining that the office only sees the district (e.g. ZZ1).
- **Strikes:** the count in the live period and each strike (date, session, notice, counts until,
  status). "Tell us what happened" (up to 1,000 characters) is visible to the office.
- **Days you can't work:** existing.
- **Appearance:** System / Light / Dark.
- **Help.**

### 4.7 Help (`/help`)

New plain-English sections:
- **Cancelling and strikes:** the 48-hour rule, what a strike means (a record, not a fine), how long
  it counts, how to tell us what happened, and how a strike is withdrawn.
- **Your travel area:** what it does, and who sees what.
- **Qualifications and photos:** uploading, and when the office checks them.

Checked by `tests/unit/copy.plain-language.test.ts`.

---

## 5. Data and integrations

### 5.1 Database changes (each needs Dylan's explicit OK, CLAUDE.md "How to work each task" step 2)

Every new table gets:
- `firm_id`, `created_at` and row-level security (the database rule that keeps each firm's rows
  separate);
- an entry in `src/lib/db/admin/access.ts` (the table-permissions list);
- isolation fixtures in `tests/helpers/tenant-rows.ts`;
- composite `(firm_id, x_id)` links to other tables;
- a review by the `guardrails-reviewer` agent.

Migrations are written with `npm run db:generate` and applied only with `npm run db:migrate`. The
next migration number is 0035.

| # | Change | Why | Status (`PLAN.md` row) |
|---|---|---|---|
| S1 | New table `shift_events` (not `events`, which is the action log): id, firm_id, name (up to 200 characters), site_id, source (native/sheets/csv), planner_ref, `showing_to_casuals` (default on), created_at. Plus `shifts.event_id` (link). Rows are never deleted, only hidden. Two extras shown in the approved mock-up: `pinned` (the office-wide star) and `public_notes` (up to 2,000 characters, event-wide details such as parking, which casuals see) | Events, sessions and the showing switch | **Core: recorded as approved** in the 6 Oct proposal. The two extras need OK ("How the build is run" 9) |
| S2 | On `shifts`: `pay_rate_pence` (whole pence), `post` (≤200), `meeting_point` (≤300), `uniform` (≤300), `required_credentials` (a list of extra qualification codes, all required, on top of the role's), `showing_to_casuals` (per-session switch, default on). Meeting point and uniform are public to casuals who can see the session; `instructions` stays visible only to booked casuals (this changes decision Data 19 for those two fields only). `required_credentials` changes the rules engine's input | Requirement 3 | Needs OK ("How the build is run" 10) |
| S3 | On `assignments`: `cancel_via` (app/office/sheet/import; empty for older rows), `strike_warning_version`, `strike_warning_shown_at` | Cancellation evidence; proof of what the casual was told | Needs OK (11) |
| S4 | New table `strikes`: worker_id, assignment_id (one strike per booking), shift_id, notice_hours, threshold_hours, issued_at, expires_at, status (live/withdrawn; "expired" is worked out from the date), review_needed + review_reasons, withdrawn_by/at/reason, representation + representation_at, reviewed_by/at/outcome, evidence_email_status (pending/sent/failed/not_set_up), evidence_email_to, evidence_email_sent_at, casual_notified_at. The app can't delete rows. Plus an owner-run `app_purge_old_strikes()` (`SECURITY DEFINER`, like `app_purge_old_messages()` in migration 0034) that deletes strikes past `strikes.keep_months` and nothing during `retention.hold_until`, called by the nightly retention job | Strikes, withdrawals, evidence | Needs OK (12) |
| S5 | `requests.message_id` as a real link to `messages`, replacing the message id kept in the request's `payload`. It is cleared (`ON DELETE SET NULL (message_id)`) when the message is deleted at 90 days. Plus an index on `messages (firm_id, reply_to)` | Enquiries join messages, replies and questions reliably | Needs OK (13) |
| S6 | On `credentials`: `check_state` (verified/waiting/rejected; existing rows from imports set to verified), `rejected_reason`, `evidence_upload_id`, `due_on` (for applied-for / working-towards, e.g. steward Level 2), `issuer` (e.g. the police force for CSAS, whose scheme is this firm's own: 3.7). Start filling the existing `verified_at`/`verified_by`. On `credential_types`: `warn_days` (expiring-soon window, e.g. SIA 120), `needs_evidence`, `register_check` | Qualification statuses; uploads count only after the office checks them | Needs OK (14) |
| S7 | New table `uploads`: worker_id, kind (photo/certificate), credential_type, content_type, size, sha256, data (the image bytes, stored in Postgres), uploaded_by, status (waiting/approved/rejected), checked_by/at, reject_reason. The current photo and its renewal date are worked out from the latest approved photo, so `workers` gets no new columns. Included in deletion and export, but the JSON exports carry each upload's details only, never `data` (5.5) | Staff photo and certificate uploads (D3) | Needs OK (15) |
| S8 | New table `worker_travel`: worker_id (unique), start_postcode, lat, lng, modes (car/public_transport/both), max_minutes, updated_at, privacy_notice_version. A separate table, so the erased-worker check (`src/lib/db/schema/people.ts:101-107`) is unchanged. Included in deletion and export | The travel area (D2) | Needs OK (16) |
| S9 | New table `travel_estimates`: origin_postcode, site_id, mode, leg (there/home), arrive_by (or depart_at for the trip home), minutes, metres, leave_by, route_summary, provider, computed_at, expires_at. Keyed by postcode, not by person | Distance and travel times without calling the provider on every page view | Needs OK (17) |
| S10 | An owner-run database function, `app_set_firm_setting(key, value)` (`SECURITY DEFINER`, like migration 0034's), the only thing the app may call to change `firms.settings`. It accepts only the Phase 12 keys (`strikes.*`, `credentials.expiring_days`, `photo.renewal_months`, `travel.*`, `pay_calendar.*`, `enquiries.*`, `planner.changes_email*`), refuses `retention.*` and every other key, and clears an address's confirmed time when the address changes. Not a column-level grant: that would let the app change the whole field, retention and the hold included, breaking the promise in migration 0034 and `docs/compliance.md` (3.10). The page checks admin on the server and logs every change | The Rules & settings page (decision Office 1) | Needs OK (18) |

**No migration needed:**
- `sites.lat`/`lng` already exist (`src/lib/db/schema/tenancy.ts:90-92`); they just start being
  filled.
- New settings keys (5.2).
- CSAS and manual handling are added as qualification types and roles in `src/lib/rules/packs.ts`.
  That is a data change, kept in step with the docs by `tests/unit/credential.packs.test.ts`.
- The strikes-team and planner-changes addresses before S10: set and confirmed by the owner command
  (3.10).

**Parked, not in v2** (`PLAN.md` Parking lot, "Office v2 later items"):
- outgoing webhooks with a signing secret, and API keys for a cancellations feed (D5);
- `pay_cycles` and a pay status per shift;
- a short-notice payments ledger;
- a timestamp for casuals confirming they'll attend;
- an "offer to selected casuals" table;
- personal pins for each office user;
- a separate right-to-work checks table (right to work stays a qualification type).

### 5.2 New settings (stored in `firms.settings`, no migration)

Each key needs:
- a `SETTING_KEYS` entry;
- a reader function in `src/lib/onboarding/settings.ts`;
- `firm:settings` support;
- a line in `docs/data-model.md`.

Only the keys S10 lists can ever be changed by the app, through `app_set_firm_setting()` once S10
is approved (3.10). `pay_digest`, `retention.*`, quiet hours, offer waves, the urgent window and
the short-notice threshold stay owner-only.

| Group | Keys and defaults |
|---|---|
| Strikes | `strikes.notice_hours` 48 (kept separate from the existing legal `short_notice_threshold_hours`, so firm policy doesn't move when the law changes), `strikes.grace_minutes` 15, `strikes.live_days` 90, `strikes.alert_at` 3, `strikes.email` (none), `strikes.email_verified_at`, `strikes.keep_months` 12 |
| Qualifications and photos | `credentials.expiring_days` 30, `photo.renewal_months` 36 (D3) |
| Travel | `travel.default_max_minutes` 45, `travel.check_in_buffer_minutes` 30. Which provider to use is a server environment setting (`TRAVEL_PROVIDER`: `fake` or `traveltime`), not a per-firm setting |
| Pay | `pay_digest` (existing value, now a proper key), `pay_calendar.week_start` mon, `pay_calendar.pay_day_offset_days` 5 (Friday after a Mon–Sun week), `pay_calendar.numbering` iso (D8) |
| Planner | `planner.changes_email`, `planner.changes_email_verified_at` |
| Enquiries | `enquiries.reply_target_minutes` 60 |

### 5.3 Writing cancellations back to the firm's planner

| Planner type | How sessions arrive today | Write-back in v2 | Later |
|---|---|---|---|
| Google Sheet rota | Sync every minute on event days, otherwise every 15 minutes | A new optional **"Cancellations"** column in the mapping (`src/lib/roster/sheets/mapping.ts:15-44`). The parser finds it (`parse.ts`). `sync.ts` writes it with the same re-read safety check as the Assigned cell (`sync.ts:189-216`). Text written: `CANCELLATION · Kieran Doyle · Wed 7 Oct 10:30 · 15 h notice · ref B71E0C42`, newest first. The reason is never written into a sheet, because ShiftDesk doesn't control who can open it. The Assigned cell drops the name as today. "Cancelled" can't go in Status (that cancels the whole shift) or in Assigned (that column is read as staff ids). Turned on by the owner with `firm:sheet`. Logged as `planner.cancellation_written` | – |
| Excel/CSV import | File upload | No way to write back. Instead: the cancellations CSV, the PDF per record, and an optional **daily "changes for your planner" email** (CSV attached, using the pay digest's attachment pattern, `src/lib/pay/digest.ts:281-290`), sent to a confirmed `planner.changes_email` | A webhook (D5) |
| ShiftDesk's own planner | Office forms | Nothing to write back | – |
| Planners with an API (Deputy, Planday, Connecteam, Rotaready) | Not supported | – | An adapter per firm when one asks. Precedents: Deputy webhooks (https://developer.deputy.com/docs/webhook-action-list), Planday Open API (https://openapi.planday.com/), Connecteam shifts API (https://developer.connecteam.com/docs/scheduler-shifts) |

### 5.4 Travel times: provider, cost, privacy

**Recommendation: TravelTime** (D1). It covers UK driving and public transport fully
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
  - arrive at the site's coordinates by start time minus `travel.check_in_buffer_minutes`;
  - departure points are the distinct postcodes of casuals with that role (up to 2,000 per search);
  - a travel-time ceiling of 90 minutes;
  - ask for distance (by car) and the route (by public transport).
- **The trip home:** one extra public-transport search leaving the site at the session's end.
- **Cost:** about 3 "hits" per session. TravelTime counts one origin against 100 destinations as
  one hit (https://docs.traveltime.com/api/overview/usage-limits). That is roughly 1,000–1,400 hits
  a month for a firm with 345 sessions, which is tiny.
- **Pricing and terms:**
  - fixed yearly subscription, 12 months minimum; **the production price isn't published, so we
    need a quote** (https://traveltime.com/pricing; `PLAN.md` Checks 14);
  - the production plan includes the right to store and reuse results;
  - the free Basic key is "not for commercial use", so it is for development and the demo only.
- **Case study:** Brigad saw late withdrawals fall from 6% to 2%
  (https://traveltime.com/case-study/brigad-case-study).

**When estimates are refreshed:**
- a session is created, imported or synced, or marked urgent;
- a session's time or site changes;
- a casual's postcode or ways of travelling change;
- a site's postcode changes;
- nightly, for every session in the open-shifts window (`OPEN_WINDOW_DAYS`, 28 days,
  `src/lib/portal/open-shifts.ts:23`).

Each event queues the travel job straight away, so an urgent session added this morning for
tonight has its travel lines before its first wave, and no shift in the 28 days casuals can see is
left without one. Pages never call the provider.

**An unknown estimate** (the job hasn't run yet, or the site has no postcode) is shown as "Distance
not known yet", never hidden (D2). Offer waves still offer such a session, labelled "distance not
known", so the travel limit never silently stops a casual being offered work.

**If the provider is down:** straight-line miles worked out from coordinates, labelled "about 7
miles (straight line)", with "Travel time not known yet". Shifts are never hidden silently.

**Postcode to coordinates:** postcodes.io, free and keyless (https://postcodes.io/docs/overview/).
Only the postcode is sent, never who it belongs to. Self-hosting it is possible later, at volume.
- Licence attribution lines (OS, Royal Mail, National Statistics, ONS OGL v3) go on the travel
  settings page (https://ideal-postcodes.co.uk/guides/onspd-licensing).
- Northern Ireland (BT) postcode data needs a separate licence: flag this before any NI firm signs
  up (`PLAN.md` Checks 16).

**Tests and demo:** a fake geocoder and a fake travel provider (like the console messaging
transport), with fixed coordinates and times for the made-up ZZ postcodes.

**Privacy** (`PLAN.md` Data 21):
- **Lawful basis:** legitimate interests with a written balancing test, not consent, because of the
  power imbalance between employer and worker
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/when-is-consent-appropriate/).
- **Impact assessment (DPIA):** required before a pilot, and before the travel area is switched on
  for any real firm, because the ICO lists employee location data as likely high risk
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk/).
  A DPIA has to come before the processing starts. Neither it nor the balancing test exists yet:
  both are deliverables of 12G.2 (`docs/dpia-travel.md`), and firms get the template.
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
  Image bytes there would become arrays of numbers several times their size, hundreds of megabytes
  for a firm of hundreds of casuals, enough to crash the one web server. So the firm's and the
  casual's JSON exports carry each upload's details only (kind, date, status, the sha256
  fingerprint), never `data`, and the images come as a separate streamed zip or one download per
  file (12F.2).
- **Photo renewal:** every `photo.renewal_months` (36 by default, D3), worked out from the latest
  approved photo; "Due soon" from `credentials.expiring_days` (30) before the renewal date (part of
  D3's default: the proposal didn't fix this window).

### 5.6 Evidence email to the strikes team

- **Transport.** Build `SesEmailTransport` (`@aws-sdk/client-sesv2`), switched on by
  `EMAIL_TRANSPORT=ses`. Console stays the default in development and tests.
  - Real sending waits for "Connect Amazon SES" (`PLAN.md` Parking lot), which needs Dylan's AWS
    steps.
  - PDF is added to the allowed attachments in `src/lib/messaging/transport.ts:8-20`. Today an
    attachment is CSV text only (`contentType: "text/csv"`, `content` a string of at most
    6,000,000 bytes), so the content becomes bytes or base64, with a limit per file type; still at
    most 3 attachments.
- **Job.** `strikes.evidence_email` carries ids only (`firmJobEnvelope`). It claims the send first,
  then sends, as the other notices do (`src/lib/notices/request-update.ts:27-31`): it is retried
  only on an error that proves nothing was sent; any other failure sets `failed`, raises a Needs
  attention item and offers "Resend", because the email may already have arrived.
  - It is sent only to a **confirmed** `strikes.email`; otherwise the status is `not_set_up`.
  - Until S10 (12B.7), the owner sets and confirms the address with `firm:settings strikes.email
    <address> --confirm` (3.10).
  - Logged as `strike.evidence_sent` / `strike.evidence_failed`.
- **Subject:** "Strike: Kieran Doyle cancelled Steward at Acme Demo Racecourse with 15 hours' notice
  (ref B71E0C42)".
- **Body:** "Kieran Doyle (staff id {id}) cancelled Steward · Raceday · Wed 7 Oct 10:30–18:30 at
  19:05 on Tue 6 Oct, 15 hours before the start. That is under your 48-hour rule, so a strike was
  recorded automatically. It is their strike 2 in the last 90 days. The record is attached (PDF) and
  is also here: {link}. — Acme Events Shift Team"
- **Attachment:** the record PDF, with a list of ShiftDesk messages sent about the booking (times
  and kinds, e.g. "24-hour reminder 10:30 Tue").
- **Health details are never included.** Even a label like "Health reason" is health data, so
  every quick reason a casual gave ("I'm unwell", "Travel problem", "Family or caring", "Something
  else") shows as "Casual's own reason (see ShiftDesk)" in the subject, the body and the PDF.
  Office reasons keep their fixed words.

### 5.7 Messages: changed and new (exact words)

**How every message is handled:**
- Every message ends with "— {firm} Shift Team". On text messages it is " - {firm} Shift Team", as
  now.
- The words are built by code from the firm's data.
- A WhatsApp message the business starts must use an approved template. New and changed templates
  go into `src/lib/messaging/templates.ts`, `src/lib/messaging/whatsapp-templates.ts` and
  `docs/messaging-templates.md`. These three are kept in step by
  `tests/unit/copy.templates-doc.test.ts` and submitted with "Connect Twilio" (`PLAN.md` Messages
  29).
- Instant replies are free text, allowed within 24 hours of the casual's message.

**1. Personal shift list.** The instant reply when the topic is "shifts". It replaces "Open shifts
you're eligible for: {link}".

```
Hi Zoe, you're booked on Sun 11 Oct (Steward · Riverside Food Festival · 10:00–18:00). For Saturday you can take:
1. Door supervisor · Northern Lights Live, Acme Demo Arena · Sat 10 Oct 08:00–16:00 · £15.50/h · Gate A · urgent
   3.1 miles · 12 min by car · 24 min by public transport
2. CSAS officer · Night patrols, Northgate Town Centre · Sat 10 Oct 17:00–23:00 · £15.00/h · town centre patrol · you hold CSAS
   8.4 miles · 21 min by car · 38 min by public transport
Reply 1 or 2 to take one, or see them all: {link}
Automatic reply. Send OFFICE to reach a person.
— Acme Events Shift Team
```

Rules for building it:
- **"Reply 1 or 2"** appears only on WhatsApp, and only once Dylan has OK'd booking by number (D6,
  item 2). Until then, and in every text, that line reads "Take one here: {link}".
- **Booked line:** the "you're booked on" part only appears when they have a booking on a day they
  asked about, or within the next 7 days.
- **Day words:** the "For Saturday" part only appears when code recognises a day ("sat",
  "saturday", "this weekend", "tomorrow").
- **Length:** at most 5 shifts, then "+ 3 more: {link}", inside a character budget: never over
  1,600 characters (3.6). Event, site and post names are cut to set lengths, and fewer shifts are
  listed until it fits. Tested with every field at its longest (event and post up to 200
  characters each), on WhatsApp and by text.
- **Order:** urgent first, then the nearest.
- **Home area:** replies say "from your home area", never the postcode, because the office sees
  them word for word (3.6, 6.3).
- **Travel line variants:**
  - "12 min by car · no public transport gets you there by 07:30";
  - "Distance not known yet";
  - no home area: the travel lines are left out and "Add your home area to see how far each one is:
    {profile link}" goes before the "Reply" line.
- **Nothing they can take:** "Hi Zoe, there's nothing you can take on Saturday within 45 minutes of
  your home area right now. We'll message you if something comes up. All open shifts: {link}"
- **Text message version** (2 shifts; links only, because a text's sender number can be faked, so
  a text never books by number: item 2): "Acme Events: shifts for you: 1) Sat 10 Oct 08:00-16:00
  Door supervisor, Acme Demo Arena, £15.50/h, 12 min by car. 2) Sat 10 Oct 17:00-23:00 CSAS
  officer, Northgate, £15.00/h, 21 min by car. Take one: {link} - Acme Events Shift Team"
- **No pay rate** on a session (rota sheets and imports may leave it blank): the line leaves pay
  out rather than showing an empty "£/h".

**2. Taking a shift by number** (D6; built only with Dylan's explicit OK, because it is a new way of
proving who the casual is). It goes through `bookShift`; only the last list sent to that number
counts, and only for 2 hours.
- **Why it needs his OK.** Today every booking needs a logged-in session: a casual's "Take shift"
  (`src/lib/portal/take-shift.ts:9,42`) or the office's assign (`src/lib/office/quick-actions.ts`).
  This books because a phone number sent "1" (CLAUDE.md step 2: auth).
- **WhatsApp only.** WhatsApp's sender is verified; a text's sender number can be faked. A "1" or
  "2" by text never books; text lists carry links only (item 1).
- **Where the list comes from.** The latest `enquiry.checks` log entry for that worker: its offered
  session ids in order, and whether its reply was sent (3.6). No new column. Option n books the
  n-th id only if that entry is under 2 hours old and its reply was sent; a newer list replaces
  the older one.
- **Logged** like an app booking, with `shift.assigned` recording that it came by reply number
  (6.1).
- **Booked:** "You're booked: Door supervisor · Northern Lights Live · Sat 10 Oct 08:00–16:00 ·
  £15.50/h · Gate A. Ref 7F3A21C9. Details: {link}. Cancelling less than 48 hours before the start
  gives you a strike. — {firm} Shift Team"
- **Can't book:** "Sorry, you can't take Door supervisor on Sat 10 Oct any more: it's been filled.
  Shifts you can take now: {link} — {firm} Shift Team". The reason comes from the existing
  plain-English refusal reasons.
- **List too old:** "That list is more than 2 hours old. Send SHIFTS for an up-to-date one, or see
  them all: {link} — {firm} Shift Team"

**3. Cancel enquiry** (replaces "To cancel a shift, tap here…"):
"Hi Kieran, you're booked on Steward · Raceday, Acme Demo Racecourse · Wed 7 Oct 10:30–18:30 ·
parade ring. To cancel, open it and tap Cancel this shift: {link}. It starts in less than 48 hours,
so cancelling now gives you a strike. Automatic reply. Send OFFICE to reach a person. — {firm}
Shift Team"
- The strike sentence only appears when a strike would apply.
- With more than one booking ahead, it ends "Your other shifts: {Booked link}".
- Its `enquiry.checks` entry names the bookings it listed (ids), which is how notice can count from
  this message if the casual then cancels (3.5, `toldAt`).
- Tested: it names the booking; the strike sentence only under the threshold; "Your other shifts"
  only with two or more bookings ahead.

**4. Every other instant reply** keeps its words. "Automatic reply. Send OFFICE to reach a person."
is added before the sign-off, which meets WhatsApp's escalation rule
(https://whatsappbusiness.com/policy/). "office" is already a shifts-line keyword
(`src/lib/inbound/keywords.ts:20`). The pay reply is unchanged: it gives the link only and never an
AI answer.

**5. Cancel screen (on-screen text only):**
- **Under the threshold:** "This shift starts in {26} hours. Cancelling with less than {48} hours'
  notice gives you a strike. {Acme Events}' strikes team gets a record of it. You have {0} strikes
  in the last {90} days."
- **Grace period:** "You took this shift {6} minutes ago, so cancelling now doesn't give you a
  strike."
- **Booked by the office:** "The office booked you on this shift, so cancelling doesn't give you a
  strike." (3.5 rule 4.)
- **Office changed it:** "The office changed this shift after you took it, so cancelling doesn't give
  you a strike."
- **Over the threshold:** "This shift starts in {5} days. Cancelling now doesn't give you a strike."
- **Footer:** "Your cancellation is recorded the moment you confirm. Nobody needs to approve it."
- **Done:** "Cancelled. Reference {ref}. A strike has been recorded. It counts until {date}. If
  something stopped you, you can tell us what happened."

**6. `strike_issued`** (new WhatsApp template, Utility): "A strike has been recorded because you
cancelled {role} on {date} {start} at {site} with {notice} notice (ref {ref}). It counts until
{expiry}. If something stopped you, tell us what happened: {link} — {firm} Shift Team"

**7. `strike_withdrawn`** (new, Utility): "The strike for your cancellation on {date} (ref {ref}) has
been withdrawn. The office says: {reason} — {firm} Shift Team"

**8. `credential_expiring`** (changed): "Your {qualification} expires on {date}. Upload your renewed
card so you can keep taking shifts that need it: {link} — {firm} Shift Team"

**9. `credential_expired`** (changed; the My shifts banner changes too): "Your {qualification}
expired on {date}. You can't take shifts that need it until you upload your renewed card and the
office checks it: {link} — {firm} Shift Team"

**10. `photo_due`** (new): "Your staff photo is due for renewal on {date}. Take a new one here:
{link} — {firm} Shift Team"

**11. `upload_rejected`** (new): "We couldn't accept your {item}: {reason}. Please upload a new one:
{link} — {firm} Shift Team"

**12. `shift_urgent`** (changed: adds pay and travel; the travel part is never empty, as Meta
requires): "URGENT: we need {a door supervisor} at {site} {day} {start}–{end}, £{15.50} an hour.
{About 12 min by car, 24 min by public transport from your area.} Tap to take it: {link}. — {firm}
Shift Team"
- Travel variants: "Car only: about 12 min." / "See how far it is in the app."
- **No pay rate:** WhatsApp refuses an empty template value, and the pay rate is optional (S2), so
  there is a `shift_urgent_no_pay` version (and `shift_urgent_no_site_no_pay`, following the
  existing `_no_site` pattern, `src/lib/messaging/whatsapp-templates.ts:92,109`). Each version
  needs Meta's approval (`PLAN.md` Messages 29).

**12b. `shift_offer`** (changed: the office's offer of a shift that isn't urgent, sent by
`src/lib/offers/office-offer.ts`; adds pay and travel): "Shift available: {date} {start}–{end} at
{site} ({role}), £{15.50} an hour. {About 12 min by car, 24 min by public transport from your
area.} Tap to take it: {link}. First to accept gets it. — {firm} Shift Team"
- The same travel variants and `_no_pay` versions as item 12.
- **Texts and pushes:** `shiftOfferSms` and `shiftUrgentSms` add "{12} min by car"; the `urgentPush`
  and `offerPush` bodies add "{12} min by car · {24} min by public transport"
  (`src/lib/messaging/templates.ts:102-158`, 464, 497). They aren't templates, so without an
  estimate they leave travel out rather than say something wrong.
- **Outside her area.** Offer waves never offer outside a casual's travel area (D2). The office may
  still offer one by hand (a person's choice); the offer page warns "Outside {first name}'s travel
  area (about 52 min by car)".

**13. Office emails** (new, SES):
- `strike_evidence` (5.6);
- `strikes_email_confirm`: "Confirm this address for {firm}'s strike records: {link}. It works for 7
  days.";
- `planner_changes`: subject "{firm}: changes for your planner, {date}", body "{n} cancellations
  since {time}. The attached CSV has each one with its reference. Full records: {link}".

---

## 6. Rules and law

### 6.1 Golden rules check

| Feature | What AI does | What code decides | Golden rule |
|---|---|---|---|
| Sorting a message | Picks one label (shifts/cancel/pay/office), with a 5-second timeout | Everything else | 1 |
| Personal shift lists, booking by number | Nothing | Eligibility, showing switches, travel area, order, booking (`bookShift`, first yes wins) | 1, 4, 6 |
| Pay questions | At most labels it "pay" | Fixed reply; goes to payroll | 9 |
| Strikes | Nothing | Threshold, exemptions, review flag | 1, 5 |
| Travel filter and order | Nothing | Provider times plus the casual's limit | 1 |
| Qualification statuses | Nothing | Dates; office checks; only checked, in-date items count | 6 |
| Upload checks | Nothing (no face matching, no text reading) | A named office person | 6 |
| Office cancellations | Nothing | Reason, notice hours, expected pay; never a strike | 12 |
| Every change logged | – | New log entries: `event.shown/hidden`, `session.shown/hidden`, `strike.issued/withdrawn/reviewed/evidence_sent/evidence_failed`, `upload.received/approved/rejected`, `credential.register_checked`, `travel.profile_changed`, `export.downloaded`, `enquiry.checks/answered/closed/reviewed`, `planner.cancellation_written`; settings changes reuse the existing `firm.settings_changed`. Each is added to `src/lib/office/log-types.ts` and `event-words.ts`, in the shape below | 5 |
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
  `licences` in `src/lib/gdpr/worker-erase.ts:49`); e.g. `credential.register_checked {
  qualificationType, result, expiresOn }`, and the S2 editor's `shift.changed { fields:
  ["requirements", "post"] }`;
- `firm.settings_changed` gives the keys with their old and new values, but the key only for
  `strikes.email`, `planner.changes_email` and their confirmed times;
- never a postcode or coordinates: `travel.profile_changed { changed: ["postcode", "modes"],
  maxMinutes }`, and `enquiry.checks` travel as minutes only;
- `enquiry.checks` lists at most 50 not-offered sessions, with a count of the rest;
- `shift.assigned` from booking by number adds `via: "reply_number"`;
- no typed text from anyone (reasons are codes: 3.5, 3.6).

A unit test passes every new entry's sample data through the same check `recordEvent()` uses.

### 6.2 Strikes and UK employment law

This is a summary of public sources, not legal advice.

- **The law isn't in force yet.** The Employment Rights Act 2025's zero-hours parts (notice of
  shifts, short-notice payments) are expected in 2027
  (https://assets.publishing.service.gov.uk/media/6981e6e4e833d031a3158f87/implementing-the-employment-rights-bill-roadmap.pdf).
  For now ShiftDesk records:
  - notice hours and expected pay on office cancellations;
  - when each session was offered and accepted;
  - every office change.
  The thresholds stay settings.
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
- **No strike when the office changed the shift after booking.** This follows the future protection
  against detriment ("detriment" = any unfavourable treatment) in ss.47H and 47I.
- **No strike on a booking the office made.** A casual the office placed with "Assign" never
  accepted the shift in ShiftDesk, so a strike for cancelling it would penalise turning down work
  they never agreed to (3.5 rule 4).
- **Notice counts from when the casual told us.** A casual who messages "cant make tmrw" at 50
  hours and taps Cancel at 46 has given 50 hours' notice (3.5, `toldAt`).
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
- **Health reasons:**
  - "I'm unwell" counts as health data, a special category, and so does a label saying someone
    cancelled for a "health reason";
  - it is visible on screen to admins and resourcers only;
  - every email, PDF and CSV (the evidence email, the record PDF, the cancellations CSV, the
    strikes CSV, the planner-changes CSV) shows one neutral value for all four quick reasons,
    "Casual's own reason (see ShiftDesk)", because these files leave ShiftDesk onto laptops and
    into mailboxes; tests check "unwell" and "health" never appear in them (12C.3 to 12C.6)
    (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/information-about-workers-health/data-protection-and-workers-health-information/);
  - the Article 9 condition firms rely on: employment, DPA 2018 Schedule 1 paragraph 1, which
    needs the firm to have an appropriate policy document. Both go into `docs/compliance.md` and
    the firm's pack (12I.3).
- **DPIAs before the processing starts:** one for the travel area (12G.2, `docs/dpia-travel.md`)
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
  outlive the 12-month row), the strikes-team email, the travel area, photos, TravelTime and
  postcodes.io, and retention. DPIA templates are supplied for firms.
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

## 7. Ideas from similar services

| # | Idea | Who does it (source) | Value | Effort | Fits golden rules? | Database change | When |
|---|---|---|---|---|---|---|---|
| 1 | Travel time on every shift; lists limited by travel; urgent offers go first to the nearest | Brigad (https://traveltime.com/case-study/brigad-case-study); Coople radius (https://help.coople.com/en/articles/5596978-how-to-search-for-jobs-with-the-coople-jobs-app) | Late withdrawals fell 6%→2% at Brigad. Nobody shows car and public transport side by side, so this would set ShiftDesk apart | L | Yes, decided by code | S8, S9 | Now |
| 2 | Qualification status buckets and an upload check queue | Workstaff (https://help.workstaff.app/docs/managers/addons/documents/); Connecteam approvals (https://help.connecteam.com/en/articles/9490810-approve-or-decline-pending-documents) | The office sees exactly what to chase | M | Yes | S6, S7 | Now |
| 3 | SIA register check log, with time and who checked | Guard Checker (https://www.guardchecker.co.uk/) | Evidence for inspections | S | Yes | None (log entries) | Now |
| 4 | Automatic re-offer after a cancellation, shown on the record | Subshift (https://subshift.app/); Rosterfy (https://www.rosterfy.com/uk-en/platform/advanced-scheduling/) | Shows the gap was handled | S | Yes | None | Now |
| 5 | Strike rule shown before confirming; worker can respond | Instawork (https://help.instawork.com/en/articles/13054123-how-do-i-cancel-a-shift-on-instawork); Coople (https://help.coople.com/en/articles/5227781-what-is-coople-s-strike-policy) | Fairness, fewer late cancellations | S | Yes | S3, S4 | Now |
| 6 | "Considered but not offered", with reasons | Zendesk logs (https://support.zendesk.com/hc/en-us/articles/8357749580186-Reviewing-conversation-logs-for-AI-agents); Ada reasoning log | Answers "why can't I see it?"; the UK explainability duty | M | Yes | None | Now |
| 7 | Reply timer and WhatsApp 24-hour countdown | Intercom SLAs (https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets); Meta (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) | Nothing waits unseen | S | Yes | None | Now |
| 8 | "Right answer / wrong answer" review and a weekly sample | Ada "Agree?" (https://docs.ada.cx/docs/generative/measure-success/understand-and-improve-your-ai-agent-s-automated-resolution-rate/); Fin Monitors | Keeps AI sorting honest | S | Yes | None | Now |
| 9 | Ask casuals to confirm they'll attend; flag the ones who don't | Indeed Flex UK (https://indeedflex.co.uk/legal/flexer-terms-and-conditions); Jobandtalent (https://www.jobandtalent.co.uk/companies/planning) | Spots likely no-shows early | M | Yes, if code flags and a person acts | Confirmation timestamp | Later |
| 10 | Offer a shift to selected casuals only | When I Work (https://help.wheniwork.com/articles/offer-an-openshift-to-specific-employees) | Targeted fills | M | Yes | New table | Later |
| 11 | Pay status per shift for casuals (Worked → Approved → Paid) | Patchwork (https://faq.patchwork.health/when-will-i-get-paid) | Fewer "when am I paid?" questions | M | Yes | Pay status | Later |
| 12 | Short-notice payments ledger | ERA 2025 consultation (https://assets.publishing.service.gov.uk/media/6a22e4b056e988a798b3870d/ending-one-sided-flexibility-reforms-zero-hours-similar-contracts-consultation-document.pdf) | Ready for 2027 | M | Yes | Ledger | Later (switched off until the regulations exist) |

The "Later" ideas are in the `PLAN.md` Parking lot ("Office v2 later items").

---

## 8. Decisions for Dylan

Each has a default the build uses unless Dylan says otherwise. Each is a row in `PLAN.md`
"Decisions waiting for Dylan"; to change one, tell Claude.

| # | Decision | Recommended default | `PLAN.md` row |
|---|---|---|---|
| D1 | Travel-time service and postcode lookup | **TravelTime** for car and public transport. Get a production quote before the pilot; use the free key for development and the demo only; a fake provider in tests. **postcodes.io** for postcode to coordinates. Straight-line fallback, labelled "straight line", when the service is down. (Alternative: Google Routes, about $1,450 a month per 300-casual firm, can't store results.) | Product 9 |
| D2 | How the travel area limits shifts | **A hard filter** on open shifts, the urgent board, Home, offer waves and enquiry replies. A shift counts as in the area if any chosen way of travelling gets there within the limit. Urgent shifts get no "a bit further" stretch in v2. A shift opened from a direct link stays bookable. Unknown distance: shown, labelled. No home area: everything shown, with a prompt. The full postcode is stored; the office sees only the district. Offer waves skip casuals outside their area, still offer when the estimate isn't known yet (labelled "distance not known"), and use travel time as a tie-breaker. The office may still offer outside a casual's area by hand, with a warning | Rules 14 (privacy: Data 21) |
| D3 | Where photos and certificates are kept; photo renewal | **In Postgres**, re-encoded, 1 MB at most; only checked items count. Photo renewal **every 3 years** (matches the SIA licence cycle; the mock-up said 2), "Due soon" 30 days before. A firm setting either way | Data 20 |
| D4 | Strike details | 48 hours (its own setting), counted from when the casual first told us by message if they then cancelled that booking; **15-minute grace** after booking; **no strike** on a booking the office made ("Assign"), when the office changed the shift after booking, or when it booked with a rules override; "I'm unwell", "Family or caring" and "booked inside 48 hours" still get a strike but are **flagged for a person to review**, and every emailed or exported reason reads "Casual's own reason (see ShiftDesk)"; counts for **90 days**, strike row kept 12 months (not during a hold), its log entries as long as the action log; office alerted at **3**; nothing else happens automatically; casuals see their strikes and can respond; a DPIA before a real firm uses strikes | Legal 16 |
| D5 | Write-back for planners other than Google Sheets | **v2:** PDF per record, CSV export, and an optional daily "changes for your planner" email. **Webhook or API feed later**, when a firm asks | Sheets 16 |
| D6 | "Reply 1 or 2 to take one" (in the approved mock-up) | A new way of proving who the casual is (today every booking needs a logged-in session or the office), so it is **built only with Dylan's explicit OK**, as an auth change. If he OKs it: **WhatsApp only** (its sender is verified; a text's can be faked, so texts get links only), through `bookShift` with the full rules check. Only the last list sent to that number counts, for 2 hours. Every booking is confirmed and logged as booked by reply number. (Alternative: links only) | Messages 28 |
| D7 | Dark theme: navy (the original brief) or graphite (the mock-up) | **Navy**: page #0f1626, panel #16203a, card #1b2642, raised #22304f, muted text #a3b0c8, switch off #7c8aa8 (all checked for contrast). It is a colour-token swap, so it's easy to change back | Product 10 |
| D8 | Pay week number and pay day in the top bar | **ISO weeks, Monday to Sunday; pay the Friday after the week ends** ("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct"). Per-firm setting (UK tax-week numbering is available) | Pay 10 |

Also needed from Dylan, outside these decisions:
- OK for S2–S10 and the S1 extras, one by one ("How the build is run" 9 to 18);
- OK for D6 as an auth change, before 12D.3;
- whether right to work should be enforced by the rules (`PLAN.md` Rules 15; the default shows it
  as a status only);
- the TravelTime quote (Checks 14);
- the existing parked steps "Connect Amazon SES", "Connect Bedrock" and "Connect Twilio", without
  which strike emails, AI sorting and real WhatsApp stay on their stand-ins.

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
- Each task adds the demo-seed rows its own screens and tests need (made-up data only); 12I.1
  completes the mock-up's story.
- Commits are made freely.
- **Approval gate:** a task marked with an S number waits for Dylan's OK on that change. Every task
  that touches schema, auth or tenancy also waits for his OK on its plan, even where its S number
  is approved (12B.1) or it has no S number (12D.3, booking by number, is auth). `PLAN.md`'s Phase
  12 header says the same, and marks each such task "(needs Dylan: …)". Only a task touching none
  of these goes ahead on a decision's default.

| Task | What (section) | Needs Dylan | Main files |
|---|---|---|---|
| 12A.0 | The mock-up in the repo (1.1) | Checks 17 (OK to commit the copy) | new `docs/mockups/office-v2.html`, a unit test for its data |
| 12A.1 | Colours and theme (3.1) | – (D7 default) | `src/app/globals.css`, `src/app/layout.tsx`, `src/app/ui/*`, the 16 files using `bg-white` |
| 12A.2 | Office shell and menu (3.1) | – | `src/app/office/{layout,office-shell,office-nav}.tsx`, new `top-bar.tsx`, `menu-drawer.tsx`; `tests/e2e/fixtures.ts` (`menuLink()`) |
| 12A.3 | Pay dashboard, pay calendar, pay-week pill (3.8, 3.1) | – (D8 default) | new `src/app/office/pay/page.tsx`, `src/lib/office/pay-dashboard.ts`, `src/lib/pay/calendar.ts`; `digest-schedule.ts`; `src/lib/onboarding/settings.ts` |
| 12B.1 | Events (3.3) | S1 core (recorded as approved); OK on the migration plan | `src/lib/db/schema/roster.ts`, `drizzle/`, `src/lib/roster/sheets/{mapping,parse,sync}.ts`, `src/lib/imports/columns.ts`, `src/lib/roster/plug.ts`, `access.ts`, `tests/helpers/tenant-rows.ts` |
| 12B.2 | Session fields (3.3) | S2 | as 12B.1, plus `src/lib/office/shift-editor.ts` |
| 12B.3 | Session requirements and CSAS (3.3) | S2 | `src/lib/roster/eligibility-input.ts`, `src/lib/rules/eligibility.ts`, `src/lib/rules/packs.ts` |
| 12B.4a | The event switch respected everywhere (3.3) | – (S1 core, approved) | `src/lib/portal/{open-shifts,shift-detail}.ts`, `src/lib/roster/book.ts`, `src/lib/offers/{candidates,waves}.ts`, `src/lib/roster/urgent.ts` |
| 12B.4b | The session switch respected everywhere (3.3) | S2 | as 12B.4a |
| 12B.5 | Events & sessions pages (3.3) | – (S1 core; S2's fields and switches appear as 12B.2 and 12B.4b land) | new `src/app/office/events/*`, `src/lib/office/events.ts` |
| 12B.6 | The star and event notes (3.3) | S1 extras | `shift_events`; the event pages; the shift page |
| 12B.7 | Rules & settings and Planner connection (3.10, 5.2) | S10 | the migration (`app_set_firm_setting()`), `src/lib/onboarding/settings.ts`, `scripts/firm-settings*.ts`, new `src/app/office/settings/*` |
| 12C.1 | Strike decision (3.5) | S3, S4 | new `src/lib/strikes/{decide,issue}.ts`, `src/lib/roster/cancel.ts`, new `src/lib/db/schema/strikes.ts`, the migration (`app_purge_old_strikes()`), `src/lib/gdpr/retention.ts`, new `docs/dpia-strikes.md` |
| 12C.2 | The casual's cancel step (4.5) | S3, S4 | `src/app/shifts/[id]/*`, `src/lib/portal/cancel-reasons.ts` |
| 12C.3 | Cancellation records, PDF and CSV (3.4) | S2, S3, S4 | new `src/lib/office/cancellations.ts`, `src/app/office/cancellations/*`, `src/lib/pdf/record.ts`, the embedded font |
| 12C.4 | Evidence email (5.6) | S4 (the address set by the owner command until 12B.7) | `src/lib/messaging/{index,transport}.ts`, new `src/lib/messaging/ses.ts`, a job in `src/worker/`, `scripts/firm-settings*.ts` (`--confirm`) |
| 12C.5 | Strikes page and the casual's strikes (3.5) | S4 | new `src/app/office/strikes/*`, `src/app/profile/*`, `templates.ts`, `whatsapp-templates.ts`, the `strike_issued` job, `src/lib/gdpr/worker-erase.ts` |
| 12C.6 | Cancellations back to the planner (5.3) | S2–S4 (through 12C.3; the address set by the owner command until 12B.7) | `src/lib/roster/sheets/{mapping,parse,sync}.ts`, a planner-changes email job |
| 12D.1 | Enquiries pages (3.6) | S5 | new `src/lib/office/enquiries.ts`, `src/app/office/enquiries/*` |
| 12D.2 | Personal replies (3.6, 5.7) | S2 (through 12B.4b) | new `src/lib/inbound/personal-reply.ts`, `src/lib/inbound/reply.ts`, `src/lib/rules/eligibility.ts` (`checks`), `src/lib/rules/version.ts`, `templates.ts` |
| 12D.3 | Booking by number (5.7) | D6 as an auth change; S2 (through 12B.4b) | `src/lib/inbound/reply.ts`, `src/lib/roster/book.ts` |
| 12D.4 | Enquiries that need a person (3.6) | S5 | `src/lib/office/request-queue.ts`, `src/app/office/requests/answer-form.tsx`, `src/lib/notices/request-update.ts` |
| 12D.5 | The review loop (3.6) | S5 (through 12D.1) | `src/lib/office/enquiries.ts` |
| 12E.1 | Dashboard (3.2) | S2–S5 (its sections) | `src/app/office/page.tsx`, new `src/lib/office/dashboard.ts` |
| 12E.2 | Needs attention, the bell and search (3.9) | S4 (strike items) | new `src/app/office/attention/*`, `src/lib/office/attention.ts` (reuses `today.ts`, `worker-access.ts`) |
| 12F.1 | Qualification statuses, shown now on today's screens (4.6, 3.7) | – | new `src/lib/credentials/status.ts`, `src/lib/credentials/expiry.ts`, `src/lib/portal/{profile,my-shifts}.ts`, `src/app/profile/*`, `src/app/office/workers/[id]/*` |
| 12F.2 | Uploads and the check queue (3.7, 5.5) | S6, S7 | new `src/lib/uploads/*`, `src/app/files/[id]/route.ts`, `src/app/office/casuals/uploads/*`, `src/lib/gdpr/{worker-erase,worker-export,firm-export}.ts` |
| 12F.3 | Staff photo (4.6) | S7 | `src/lib/uploads/*`, `src/app/profile/*` |
| 12F.4 | SIA register check and reminders (3.7, 5.7) | S6, S7 | `src/lib/credentials/scan.ts`, `templates.ts`, `whatsapp-templates.ts` |
| 12F.5 | Casuals pages (3.7) | S6, S7 | new `src/app/office/casuals/*`; access controls moved from `src/app/office/workers/[id]` |
| 12G.1 | Travel providers and site locations (5.4) | – (D1 default) | new `src/lib/travel/*`, `src/lib/db/schema/tenancy.ts` (comment only) |
| 12G.2 | The casual's travel area (4.6, 5.4) | S8 | `worker_travel`, `src/app/profile/travel/*`, `src/lib/gdpr/worker-{erase,export}.ts`, `src/lib/office/worker-access.ts` (deleted on "They've left"), new `docs/dpia-travel.md` |
| 12G.3 | The travel job (5.4) | S9 | a new job in `src/worker/`, `src/lib/travel/compute.ts`; the session create, import and sync paths queue it |
| 12G.4 | Filtering, order and the travel line (4.3, 5.4, 5.7) | S8, S9 | `src/lib/portal/open-shifts.ts`, `src/lib/offers/{candidates,office-offer}.ts`, `src/lib/inbound/personal-reply.ts`, `templates.ts`, `whatsapp-templates.ts` |
| 12H.1 | Casual app tab bar and Home (4.1–4.2) | – (builds on today's data; each later part lands with its own task) | `src/app/page.tsx`, new `src/app/shifts/page.tsx` (Booked), a new staff layout component |
| 12H.2 | Shifts list and shift page (4.3–4.4) | S2, S8, S9 (what it shows) | `src/app/shifts/open/*`, `src/app/shifts/[id]/*`, `src/app/urgent/*` |
| 12H.3 | Profile and help (4.6–4.7) | – (as 12H.1; Rules 15 for the right-to-work words) | `src/app/profile/*`, `src/app/help/*` |
| 12I.1 | Demo seed | after every task above | `src/lib/db/admin/seed-*.ts` |
| 12I.2 | Guides | after every task above | `src/app/office/guide/guide-view.tsx`, `src/app/help/*` |
| 12I.3 | Docs (section 10) | – | the docs in section 10, `CLAUDE.md` |
| 12I.4 | Verify and the walkthrough | – | `docs/walkthrough.md`, `tests/e2e/walkthrough*` |

**Demo seed (12I.1)**, all made up, dates relative to "now" so weekdays are always right:
- **Firm:** Acme Events. Strikes team `strikes@acme-events.example`, already confirmed. No real
  employer names, venues, staff or addresses.
- **Events and sessions, as in the mock-up:** Northern Lights Live, Acme Demo Arena (door
  supervisor urgent 3/4, steward, response team lead needing first aid); Night patrols, Northgate
  Town Centre (CSAS officer, urgent); Riverside Food Festival; Raceday, Acme Demo Racecourse;
  Northgate Charity 10K; Hillside Christmas Market, switched off ("not confirmed by the client
  yet"). Each session has pay rate, post, meeting point and uniform.
- **Casuals:** Zoe Adeyemi (SIA DS valid, CSAS valid, manual handling expiring in 22 days, first aid
  missing, photo due soon: approved a little under 3 years ago, so it's inside the 30-day window
  under D3's default); Kieran Doyle (SIA expired, 2 strikes); Ben Fraser (SIA SG, CSAS applied for,
  new photo waiting); Priya Shah (1 strike); Leah Ward (SIA expiring in 12 days, no photo); Jamal
  Morgan, Mo Rahman, Tom Hale. At least 4 CSAS holders.
- **Cancellations:** the five records from the mock-up, including one office cancellation.
- **Strikes:** three live, one withdrawn with a reason, one flagged for review.
- **Enquiries:** the 12 in the enquiries research, plus the mock-up's personal list to Zoe, Ben's
  pay question and Kieran's cancel. Each has its outgoing reply built with the real template
  functions, `message.received`, `message.replied` and `enquiry.checks` log entries, and office
  questions as `general` requests. Rows marked AI-sorted are labelled as staged in the demo notes,
  because Bedrock isn't connected. All messages fall inside the 90-day window.
- **Times shown come from rows, not the log.** Log entries are stamped when the seed runs and can't
  be backdated (`src/lib/db/admin/seed-saturday.ts:20-21`, `docs/testing.md:250`), so a timeline,
  refill or reply time worked out from the log would read 0 minutes or come out in the wrong
  order. The loaders take times from row timestamps the seed can set (a booking's confirmed and
  cancelled times, the replacement booking's confirmed time, messages' times); the log only says
  what happened. A seed test checks the figures the pages show (the median refill, reply times).
- **Travel:** fake coordinates for the ZZ postcodes and sites, and a fixed table of times for the
  fake provider (e.g. ZZ1 4 → Acme Demo Arena: 3.1 miles, 12 min by car, 24 min by public
  transport). Travel profiles for every casual.
- **Pay:** the existing 10 pay queries, plus two sorted groups.
- **Uploads waiting:** Ben's photo and one certificate.
- Fixed ids via `seedId()` (`src/lib/db/admin/seed-data.ts:10`), avoiding the free demo-login
  workers 0–4.

**Changes from the proposal's build order** (so each task can be built and tested on its own):
- The redirects for `/office/today`, `/office/requests` and `/office/workers`, and each new menu
  link, land with the task that builds the replacement page (12E.2, 12D.4, 12F.5 and so on), not in
  the shell task, so no link or redirect points at a page that doesn't exist yet.
- The bell and search land with Needs attention (12E.2), the enquiries pill and speech bubble with
  12D.4, and the pay-week pill and payroll's pill with the pay dashboard (12A.3).
- Events and session fields are separate tasks (12B.1 for S1's core, 12B.2 for S2), and S1's two
  extras have their own task (12B.6), so the approved part isn't held up. For the same reason the
  event switch (12B.4a) and the Events pages (12B.5) don't wait for S2; only the session switch
  does (12B.4b).
- Travel is four tasks: providers (no database change), the travel area (S8, including
  `/profile/travel`, which the filter needs), the travel job (S9), and filtering. Personal replies
  (12D.2) gain their travel lines in 12G.4, because travel comes later in the order.
- 12F.1 builds only the statuses today's data supports; "Being checked", "Not accepted" and
  "Applied for, due {date}" come with S6 and S7 (12F.2). It also shows them straight away on
  today's screens (`/profile`, My shifts' Needs updating card, `/office/workers/[id]`), so the
  statuses Dylan asked for don't wait for any database change. Home and Profile (12H.1, 12H.3)
  likewise build what today's data supports, and each part that needs S2, S4 or S6 to S9 lands
  with the task that brings it.
- The strikes-team and planner-changes addresses are set and confirmed by the owner command until
  S10 lands (12C.4, 12C.6), so evidence emails don't depend on S10.

---

## 10. Test and doc impact

Line numbers are as of `b3f3627`. These tests change because the product changes; none is weakened
to get green. Phase 11 said its tests would stay unchanged; Phase 12 changes the menu, Today,
Requests and Workers, so the tests that pin them change with them, each in the task named.

**Unit tests rewritten:**
- `tests/unit/office.shell.test.ts` (12A.2): menu labels per role (33-60), current link (68-111),
  markup rules (117-128). The phone row's edge-arrow tests (153-168) are deleted along with the
  sideways row. The footer tests (188-215) move to the account menu.
- `tests/unit/office.roles.test.ts:18-23` (each task adding an area).
- `tests/unit/office.today-summary.test.ts` and `tests/unit/office.today-view.test.ts` (12E.1,
  12E.2): replaced by dashboard and Needs attention tests. Colour checks by class name (`bg-white`,
  174-178) become token checks (12A.1).
- `tests/unit/guides.test.ts` (76-123) (12I.2).
- `tests/unit/portal.profile.test.ts` (109-121, status words) (12F.1, 12H.3).
- `tests/unit/portal.my-shifts.test.ts` (12F.1, 12H.1).
- `tests/unit/copy.templates-doc.test.ts`: new and changed templates (12C.5, 12D.2, 12F.4, 12G.4).
- `tests/unit/credential.packs.test.ts`: CSAS, manual handling (12B.3).
- `tests/unit/copy.plain-language.test.ts`: gains a check that "urgently looking for" appears
  nowhere in `src/` (12E.1).

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
- **Renames:** Workers → Casuals (12F.5); "Data requests (download or delete)" → "Data requests"
  (12A.2); Requests → Enquiries' "Requests from the app" (12D.4).
- **Log out** moves into the account menu (12A.2: `login.office:48`, walkthrough 113-118).
- **Old shifts-line replies** (12D.2): `whatsapp.inbound.spec.ts:37` and walkthrough 592 expect
  "Open shifts you're eligible for: …"; they move to the personal list's words.
- **Requests** (12D.4): `office.requests.spec.ts:36` (the "See requests" link to `/office/requests`)
  follows the redirect to Enquiries' "Requests from the app".
- **Today-based specs:**
  - `office.today.spec.ts`, walkthrough 279 and 281-299: rewritten for the dashboard (12E.1),
    including the Today headings and the requests count at lines 28-40; its payroll placeholder
    check (line 67) for the pay dashboard (12A.3);
  - walkthrough 607 (unknown numbers): rewritten for Enquiries (12D.1);
  - `office.attendance:38-43` and `office.workers:85-95`: rewritten for Needs attention (12E.2).
- **Text checks** ("You're logged in as …", "Hello Domain Admin" in `custom-domain:152`) are checked
  and moved with their content.
- **`login.worker:43-46`** counts, and Booked's move to `/shifts` (12H.1): the tests that use
  `/?view=past` (`tests/e2e/login.worker.spec.ts`, `tests/e2e/walkthrough.spec.ts`,
  `tests/unit/portal.my-shifts.test.ts`, `offline.sw.test.ts`, `proxy.test.ts`,
  `error-pages.test.ts`) follow the new route or check the redirect.
- **`brand.spec.ts` stays unchanged.**

**New tests:**
- the mock-up copy holds only made-up data (12A.0);
- contrast in both themes (12A.1);
- drawer accessibility, the theme button and the account button (12A.2);
- `strikeDecision()` (12C.1), including an office-assigned booking, notice told by message, and
  "Family or caring" flagged; the strikes purge and the hold (12C.1);
- isolation for `shift_events`, `strikes`, `uploads`, `worker_travel` and `travel_estimates`;
- every place the switches must be respected (12B.4a, 12B.4b);
- every new log entry's sample data passes the check `recordEvent()` uses (6.1; 12B.2, 12B.7,
  12C.1, 12D.2, 12F.2, 12F.4, 12G.2);
- the travel filter before the cap, D2's rules, and the travel words in every offer (12G.4);
- travel estimates for new, synced and urgent sessions and the whole 28-day window (12G.3);
- personal replies never include AI-written words, stay within 1,600 characters with every field
  at its longest, and leave out each kind of ineligible session with its reason (12D.2);
- every rules check recorded with its data, `ok` unchanged (12D.2);
- booking by number, WhatsApp only (12D.3);
- upload security, and exports without image bytes (12F.2);
- the PDF and CSV exports, including a casual named "Łukasz Ştefan" (12C.3);
- "unwell" and "health" never in the evidence email, the record PDF, the cancellations CSV, the
  strikes CSV or the planner-changes CSV (12C.3 to 12C.6);
- no email address in the repo outside the reserved example domains (12C.4);
- the evidence email and strike message never sent twice after an unclear failure (12C.4, 12C.5);
- sheet write-back (12C.6);
- confirming the strikes email address, an old link never confirming a new address, and the app
  unable to change retention settings (12B.7);
- qualification statuses on today's screens, and which qualifications count as Missing (12F.1);
- no office page or loader output holding more than a casual's district (12D.1);
- the seed's shown figures (12I.1);
- end-to-end specs `office.shell`, `office.events`, `office.cancellations`, `office.enquiries`,
  `office.casuals`, `office.dashboard`, `office.pay-dashboard` and `casual.app`.

**Docs to update** (each task updates the docs it changes; 12I.3 checks the whole set):
- `PLAN.md`: Phase 12 tasks; the Phase 12 rows under "Decisions waiting for Dylan"; Parking lot items
  (webhooks and API feed, attendance confirmation, offer to selected casuals, pay status,
  short-notice ledger, recording a phone cancellation as the casual's own with strike handling,
  strike wear-off after good shifts, a third-party SIA checker, self-hosted journey planning,
  booking by number by text, typed notes on closing and reviewing enquiries, strike log entries
  outliving the strike row, the daily-series grouping). (Written 2026-10-06; review items added
  the same day.)
- `CLAUDE.md` lines 13-25: the office is now planner-first, and the dashboard and Enquiries replace
  Today and Requests.
- `docs/screens.md`: office shell (70-108), `/office`, the new office routes, and the staff screens
  `/`, `/shifts/open`, `/urgent`, `/shifts/[id]`, `/profile`, `/help`, with every new piece of
  wording.
- `docs/ui-design.md`: tokens with dark mode and navy, shell, dashboard, event card patterns.
- `docs/data-model.md`: S1–S10, settings, `sites` lat/lng now used.
- `docs/architecture.md` and `docs/api-and-jobs.md`: travel jobs, providers, upload and file routes,
  evidence email, planner write-back.
- `docs/rules-and-credentials.md`: statuses, only checked items count, session requirements, CSAS
  (recorded by the office under its own scheme), right to work (a status, not a rule: `PLAN.md`
  Rules 15), the travel filter (a preference, not a rule), `checkEligibility()`'s `checks`.
- `docs/messaging-templates.md`: section 5.7.
- `docs/compliance.md`: sub-processors TravelTime and postcodes.io, photos (no biometrics), the
  travel and strikes DPIAs, strike cautions, the Article 9 condition for "I'm unwell" and the
  appropriate policy document, retention schedule (strike log entries included), and that
  retention stays owner-only after S10.
- `docs/privacy-notice.md`: strikes, strikes-team email, travel area, photos.
- New: `docs/dpia-travel.md` (12G.2) and `docs/dpia-strikes.md` (12C.1).
- `docs/testing.md`: fake travel provider and geocoder, new seed.
- `docs/walkthrough.md`: menu and Log out location, new demo steps.
- `docs/decisions.md`: decision records (ADRs) for D1, D3, D5, D7 and the theme cookie.
- `docs/runbooks.md`: travel provider outage, SES bounce, strikes email change.
