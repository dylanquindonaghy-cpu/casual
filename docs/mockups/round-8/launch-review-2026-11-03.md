# Launch review, 3 Nov 2026: the live site, the video, the map and every page's words

Dylan, 2026-11-03, after the Phase 26 merge: the map "doesn't seem to be working", the glass and side
bar "could be turned up by like 15-20%", "what does this section mean" (the dashboard's "Who
worked?"), the "Tell me about" words, then the Haulix video again with an idea for the map, the map
upload steps, and "review the website to make sure that all the data and features are easily
understood via the text and UI so we dont have any other issues on launch".

The page for Dylan (before and after pictures, the map steps with copy buttons, every finding):
https://claude.ai/artifact/9GPXjLG2NXmz4FvbMXBdiu. Nothing here is built yet: it waits for his
go-ahead (`PLAN.md`, P11). Every quote below was checked against the live demo
(https://acme.staffingresourcingtest.uk, on 9b3a235's code) or the code at the place given.

## 1. The live site

- **The map isn't broken.** The server has no street map file (`MAP_TILES_URL` empty), so the
  dashboard draws the plain map (`data-venue-map="plain"`): pins by postcode on a blank panel. The
  faint streets behind are only the page's background picture. No console errors; no map file
  asked for. Steps to switch it on: section 4 below.
- **The demo's people were last night's.** The 04:00 reload ran the code before the merge
  (3d91aa7), whose seed has none of Phase 26's history (no `hist-` bookings), so Casuals showed
  0 Regulars and 0 Reliable and everyone "New: 0 shifts so far". Tonight's reload fixes it, or
  `/opt/shiftdesk/demo-reset.sh` now.
- **Notifications on phones and computers are off** ("Notifications aren't set up on this server
  yet."): the web push keys aren't set on the server.
- **Everything else answered:** 24 office pages and 10 casual app pages, at 1280px and 390px, all
  200, no console errors, no sideways scrolling; the site runs the merged code (the session's
  tabs link with `?show=`).

## 2. The glass (+15% or +20%)

Measured on the live dashboard and Updates with the values put in by the browser only. Today the
dark panels are `rgb(22 22 24 / 0.28)` over `#0f0f10` with 8.5% street lines blurred 6px, so
almost nothing shows through and they read as flat black.

| Part | Today | +15% | +20% |
|---|---|---|---|
| Street lines (`--map-road`) | 8.5% white | 9.8% | 10.2% |
| Blur (`--glass-filter`) | 6px | 4px | 3px |
| Panel and side bar (`--color-card`, `--color-sheet`) | dark, 28% | white, 3.5% | white, 4% |
| Edge (`--glass-rim`) | 10% white | 11.5% | 12% |
| Menus, the phone's top bar (`--color-panel`) | 88% | 75% | 70% |
| Faintest text (`ink-faint`) on the lightest spot | 6.1:1 | 5.0:1 | 4.9:1 |

The office's dark theme only (`src/app/globals.css`, the `[data-office]` block; the numbers also
live in `src/lib/tenancy/glass-grounds.ts` and its tests). The light theme and "reduce
transparency" don't change. The top bar's chips use `glass-button` and aren't in this change.

Note (found in the build, 2026-11-03): the browser-only values were put on the office's own box
(`:root [data-office] { … }`), but the street map is drawn on the page's background
(`body:has([data-office])::before`), which reads `--map-road` from the page's root, not from that
box. So the street lines in these pictures were the 8.5% of today; only the panels, blur, edges
and menus changed. The build keeps the lines at 8.5%, as the
pictures show (at 10.2% six colour pairs fall under their minimum contrast); Dylan to confirm
(`docs/plan/decisions-waiting.md` 13).

## 3. The video (Haulix) and the map idea

What the video does that we don't: the street map lives only inside the map panel (the page behind
is plain charcoal); the map is real and movable, with zoom, reset, full screen, a compass and a
hint ("Space + Drag to pan · Scroll to zoom"); clicking a truck swaps the card on the map; its
panels are plain, slightly lighter grey sheets with a thin edge (closer to +15/+20% than today).

Dylan's idea: take the sessions with their status off the dashboard's column and put them on the
map, make the map interactive both ways (a pin brings up the session; choosing a session or tab
moves the map to it). Already built: the card on the map, pins that pick a venue's first session
(`boardHref(view, v.firstShiftId)`, `src/app/office/dashboard/venue-map.tsx`), MapLibre with
two-finger / Ctrl-scroll moving once the file is set (`cooperativeGestures`), `?session=` links.
Proposed:

1. The map becomes the top of the dashboard, the chosen session's card floating on it.
2. A pin: the map moves to the venue and the card shows its session; a venue with several shows
   "1 of 3" with arrows.
3. The reverse: the tabs and Filter change the pins and the map fits to them; choosing a session
   in the list moves the map to its venue and lights its pin.
4. "To offer" becomes a list opened from a list button on the map (the video has one), so the
   column goes and nothing is lost (venues with no position, keyboard and screen readers).
5. Map buttons: zoom in, zoom out, back to all venues, full screen; the hint "Drag to move · Ctrl +
   scroll to zoom" (two fingers on a phone).
6. A phone: the map, then the card under it.
7. The page behind plain charcoal (no `body::before` streets): the map only in its panel; the
   chosen glass level still applies.

Order: the map file on the server first (none of it works on a blank panel), then a mock-up on the
real streets, then the build.

## 4. The street map on the server (the steps Dylan has)

From his phone (Termius) or any computer, after logging in as root (how the server's SSH and
firewall were really set up isn't recorded; the page's Part B finds out whether it's a key or a
password, and the first connection shows whether a firewall is in the way). One command does it all:
the newest build's name, the UK cut out at zoom 13 (about 740 MB, measured from the build's own
index), `MAP_TILES_URL=/maps/uk.pmtiles` set in `/opt/shiftdesk/.env` (added if missing), and the
settings applied (`deploy.sh --now`, which also works in the 05:30–09:00 window):

```
B=$(curl -s https://build-metadata.protomaps.dev/builds.json | grep -o '[0-9]\{8\}\.pmtiles' | tail -1) && echo "Map build: $B" && mkdir -p /opt/shiftdesk/maps && docker run --rm -v /opt/shiftdesk/maps:/maps protomaps/go-pmtiles extract "https://build.protomaps.com/$B" /maps/uk.pmtiles --bbox=-8.65,49.86,1.77,60.86 --maxzoom=13 && ls -lh /opt/shiftdesk/maps && { grep -q '^MAP_TILES_URL=' /opt/shiftdesk/.env && sed -i 's|^MAP_TILES_URL=.*|MAP_TILES_URL=/maps/uk.pmtiles|' /opt/shiftdesk/.env || echo 'MAP_TILES_URL=/maps/uk.pmtiles' >> /opt/shiftdesk/.env; } && /opt/shiftdesk/deploy.sh --now && echo "ALL DONE: the street map is on."
```

Checked from here: the command parses (`bash -n`); the newest build's name (`20261103.pmtiles`,
the world file 139 GB); `https://build.protomaps.com/20261103.pmtiles` answers byte ranges (206,
"PMTiles"); the `.env` line is set whether or not it was there. Not run from here (the session may
not run outside tools): the `protomaps/go-pmtiles` Docker image. Then
`curl -sI -H "Range: bytes=0-15" https://acme.staffingresourcingtest.uk/maps/uk.pmtiles | head -1`
says `HTTP/2 206` (Caddy serves `/maps/*` itself, `deploy/Caddyfile`, so the demo's password doesn't
apply), and the dashboard with Ctrl+Shift+R shows the streets. Once he's run it,
`docs/runbooks.md` "The street map" gets this route.

## 5. Every page's words, for launch

Two read-only reviews (office: 24 pages; casual app: 10 pages and the code behind the pages the
capture didn't reach), each quote checked against the code. Many of these strings are also in
`docs/screens.md`, which changes with them; some are pinned by copy tests. Items marked **(UI)**
change layout or behaviour, so a mock-up first.

### Fix before launch (wrong decisions or phone calls)

| # | Where | Now | New | Code |
|---|---|---|---|---|
| O1 | Dashboard card | "Can take it" · "0 offered" · "2" · "Under the rules, right now" | big "2", "have the licence, rest and hours for it", chip "None offered yet" / "{n} offered" | `src/lib/office/dashboard-map-copy.ts:74-76`, `src/app/office/dashboard/board.tsx:381-387` |
| O2 | Enquiries | "3 enquiries today · none need a person" while "Requests from the app" has 2 waiting, no count on its tab | "… · 2 requests to answer" and a count on the tab | `src/lib/office/enquiries-copy.ts:13,29,109-119`, `src/app/office/enquiries/page.tsx:118-123` |
| O3 | Dashboard / Pay | "Pay Fri 13 Nov" against "Next pay day Fri 6 Nov" | "Week 45 (paid Fri 13 Nov)" on both | `src/lib/office/board-copy.ts:42-46`, `src/lib/pay/pay-week.ts:40,68,84` |
| O4 | Dashboard map | "6 venues · 29 places to fill" (the top bar says 33) | "… this week and next" | `src/app/office/dashboard/venue-map.tsx:410-413` |
| O5 | A casual's page (UI) | "Needs updating" "Nothing." while their photo is "Missing" and Casuals lists them | list the missing photo there too | `src/app/office/casuals/[id]/page.tsx:128-134` |
| O6 | Need updating | tab 62, "Remind all 5", 56 rows with no action | "Remind all 5 with a licence to renew", and that photos are asked for in the app | `src/lib/office/follow-up-copy.ts:4,7-8` |
| O7 | How-to guide | "Who worked?, in Needs attention"; "Edit this shift"; "Places" | the dashboard; "Edit this session"; "Booked places"; Updates and Enquiries described; the stale "Requests" key gone | `src/app/office/guide/guide-view.tsx:173,179,597,608,671,677` |
| O8 | Tell me about | the phone/computer switches are on, with "Notifications aren't set up on this server yet." | "Phone and computer notifications aren't turned on for your firm yet, so these two switches do nothing for now." | `src/lib/office/tell-me-copy.ts:54-63,83` |
| O9 | A casual's page | "Right to work: Not checked yet: ask the office" (the casual's words) | "Right to work: not checked yet" | `src/lib/portal/qualification-copy.ts:136-141`, used at `src/app/office/casuals/[id]/page.tsx:237` |
| C1 | Cancel sheet, shift page, Profile, Help | "… gives you a strike. {firm}'s strikes team gets a record of it."; Help "Acme Events's" | "Cancelling now gives you a strike (less than {48} hours' notice). A strike is a record, not a fine. It never comes off your pay. …" | `src/lib/strikes/words.ts:43-46`, `src/lib/portal/my-strikes-copy.ts:23`, `src/lib/portal/shift-page-copy.ts:47`, `src/app/help/help-view.tsx:224` |
| C2 | Shift page, pass, Pay | "About £124.00 for the 8 hours"; "Gross pay" | "About £124.00 before tax for the 8 hours"; "Pay before tax" | `src/app/shifts/shift-parts.tsx:101`, `src/app/pay/pay-view.tsx:45,65` |
| C3 | Open shifts, shift page, pass | no pay shown when a session has no rate | "Pay: ask the office" | `src/app/shifts/open/open-shift-card.tsx:48`, `src/app/shifts/[id]/shift-view.tsx:238`, `src/app/next-pass.tsx:148` |
| C4 | Messages | "Questions about your shifts, cancelling or pay are answered at once." | "Ask about your shifts, cancelling or pay days and get an answer straight away. Anything else goes to the office, and their reply comes here." (golden rule 9) | `src/lib/portal/messages-copy.ts:6-9` |
| C5 | Reminder text, Profile (UI) | "… send the new details to the office …"; a shift's extra certificate isn't on Profile | list it under "Other qualifications on file"; "Once you've renewed it, tell the office under Messages: {link}" | `src/lib/messaging/templates.ts:169,183`, `src/lib/portal/qualification-copy.ts:104`, `src/app/help/help-view.tsx:357` |
| C6 | Profile | "Not checked yet: ask the office" | "Not recorded yet. The office will ask you for your documents if they need them." | `src/lib/portal/qualification-copy.ts:139-140` |
| C7 | Open shifts | the day strip's key "1 Urgent", "1 Open" (read as counts) | "Red number: urgent shifts that day · Grey number: open shifts that day · ✓ You're booked" | `src/app/shifts/open/open-shifts-view.tsx:93-120`, `src/lib/portal/shifts-strip.ts:37-43` |

### One thing, one name, and clearer words

Office:
- "To check" (top bar) / "Needs attention" (menu) → "Needs attention" (`src/app/office/office-menu.ts:235-236`).
- "shift" / "session" for one thing ("Open the shift", "Casuals for this session") → one word (`board.tsx:414`, `shifts/[id]/page.tsx:434`, `events/page.tsx:84-94`).
- "3/4 filled" / "3 / 4 booked"; "places free" / "places to fill" (`events-copy.ts:28,85,151`); "Could take it" / "Can take it" (`session-page-copy.ts:34`); "Sites" / "venues" (`settings/page.tsx:68`, `customise-copy.ts:63`); "Live strikes" / "counting now" (`strikes-copy.ts:11,17,27`, `casuals/page.tsx:296`); "Cancel often" / "Cancels often" (`casuals-copy.ts:15,178`).
- "Show full venues" → "Show filled venues too" (`dashboard-map-copy.ts:70`); "Hidden from casuals" → "Hidden: casuals can't see it" (`dashboard-map-copy.ts:44-49`, `events-copy.ts:76,146`, `event-page-copy.ts:71`).
- "Not worked lately" for the never-worked → "New: not worked yet"; "Nothing in 60 days" → "Nothing worked in 60 days"; "Reliable 0 · 95% or more, of 0 who worked" → "Turned up 95% or more. Needs 5 shifts in 90 days to count."; "Cancel often · 3 or more under 48 hours" → "… late cancellations (under 48 hours) in 90 days" (`casuals-copy.ts:36-42,179`).
- Staff photo "Due soon · 23 Nov 2023" (the date taken) → "Due soon · renew by 23 Nov 2026" (`casuals-copy.ts:156-160`).
- Enquiries "Done in the app" → "They sorted it in the app" (`enquiries-copy.ts:14`); "Pay (always a person)" → "Pay: sent to payroll" (built as "Pay: link to their pay page": the casual gets their Pay page link and nothing goes to payroll by itself, so the guardrails review had the chip say what happens); "Pay: never answered by AI (rule)" → without "(rule)"; the answer page's "Checks made by code" / "Reply built" → "What we checked" / "Reply sent" (`enquiries/enquiry-detail.tsx:192,217`).
- "No strike · from before strikes" → "No strike: cancelled before strikes were turned on" (`cancellations-copy.ts:247`); "Needs review" → "They gave a reason: check it" (`strikes-copy.ts:12`, `cancellations/page.tsx:273`, `strikes/page.tsx:106`).
- Session page "Casuals ask, you choose · Set for this event. Off: the first to tap takes it." → "On: casuals ask, you choose who gets it. Off: the first casual to tap gets it. Applies to every session in this event." (`session-page-copy.ts:170-171`).
- Notice report "Started by" / "Asked by", filter "The firm" against rows "The office" → one name; the column "At whose request" (`notice-report.ts:323-329,387-390`, `reports/notice/page.tsx:136-147,203`).
- Action log: one offer as two rows ("asked to offer" and "offered"); "Sending … their 08:00 summary." → one row; "Sent … the 08:00 summary" (built as "Sending … the 08:00 summary.": the row is written before the email goes, and a failed send adds its own row after it, so the guardrails review kept "Sending"); repeated shift names in its filter get their time or post (`event-words.ts:432-441,983`, `action-log.ts:383-386`).
- A casual's reliability "Worked ÷ (worked + no-shows + cancellations under 48 hours)" → "Shifts worked out of shifts booked (no-shows and cancellations under 48 hours count against them)" (`casuals/[id]/page.tsx:118-124`, `rules/reliability.ts:73`).
- Customise: "Everything stays in Events & sessions." → "Events & sessions always shows every contract."; "Least reliable who are booked" → "Booked casuals with the lowest reliability"; "Booked of needed, per contract" → "Places booked out of places needed, per contract" (`customise-copy.ts:11-12`, `dashboard-cards.ts:32-34`).
- Integrations "Give it an https address your planner gives you." → "Paste the https address your planner gave you for webhooks."; "… to ShiftDesk" → "… here" (`integrations-copy.ts:167`, `settings/integrations/page.tsx:37`).
- Quick wins: "This week · 5 in all" → "5 in the last 8 weeks" (`cancellations-copy.ts:183`); "All Acme Events's data" → "All your firm's data" (`data/page.tsx:45`); phone numbers formatted as on Settings (`casuals/[id]/page.tsx:84`); "All dates" → "Pick a day" (`customise-copy.ts:47`); the session's "Open" chip → "1 place to fill" (`shifts-copy.ts:26`); the pilot report's "Before the app" / "Portal actions" → "None before the app" / "app" (`pilot-copy.ts:71-72,78,98`).
- Already found by Dylan and in the page's section 2: "Who worked?" (the line under the heading, "· 3 sessions", "Everyone else worked" → "All of these worked"; the ✕ explained, not a worded button: the names were cut), "Tell me about" ("Only you get these. You don't look after any contracts, so they cover every venue."), Updates' "Today 2" over the last 7 days.

Casual app:
- Licence / card / certificate for one thing ("Upload a certificate" under a licence) → "Upload a new one" (`profile/profile-view.tsx:208`, `messaging/templates.ts:167,181`, `help/help-view.tsx:361`); the "SIA DS" chip → the full name, no "Urgent" chip under the urgent banner (`credentials/requirements.ts:25-32`, `shifts/[id]/shift-view.tsx:120`).
- "Valid · Valid until 27 Mar 2028" → chip "Valid", then "until 27 Mar 2028" (`qualification-copy.ts:16,82`, `profile-view.tsx:200-201`).
- The travel setting's four names ("from home", "home area", "Where you work", "travel area") → "travel area"; "2 more shifts are further than you travel" → "… outside your travel area" (`open-shifts-view.tsx:29`, `shift-view.tsx:147`, `next-pass.tsx:129`, `travel-copy.ts:8,103-105,112,114`).
- "For this week's shifts" → "For shifts Mon 2 to Sun 8 Nov"; "Pay date" / "Pay day" → "Pay day" (`home-copy.ts:97`, `pay-view.tsx:140`).
- "Sorted" → "Answered by payroll on {day}" (pay queries), "Done" (requests) (`pay-query-kinds.ts:21`, `pay-view.tsx:180`, `request-kinds.ts:64`).
- Reliability "It shows as a figure once you have 5." → "You're new, so there's no score yet. You'll get one after 5 shifts."; "0 worked" → "0 shifts worked"; the 48 from the firm's own notice hours (`rules/reliability.ts:65,71`, `profile-view.tsx:390-401`).
- Requests "No requests yet." → "No requests yet. To change a shift's times or swap it, tap Ask for a change. The office's answer shows here."; "New request" → "Ask for a change to a shift" (`requests/requests-list.tsx:28,33`).
- Help: the tabs list leaves out Messages; "Open in maps" / "Directions" → "Directions"; "Tap Details, then Ask for a change."; "Tap Check again then." → "At that time, tap Check again."; "every 36 months" → "every 3 years" (`help-view.tsx:121-122,126-130,169-170,246,365`, `next-pass.tsx:93,160`, `shift-view.tsx:153`).
- "If a notification can't reach you, send it by" → "If we can't reach this phone, send my messages by"; "Phone notifications aren't switched on for Acme Events yet." → "Acme Events doesn't use phone notifications yet. We'll send your messages by text." (`notification-form.tsx:70`, `push-setting-view.tsx:37-38`).
- "Up to 60 days, in the next 6 months." → "You can mark up to 60 days, up to 6 months ahead." (`profile-view.tsx:247-248`).
- The urgent text "… needed Northgate Demo Town Centre on …" → "… needed at … Take it: {link}"; the card shows the site's name too (`messaging/templates.ts:281`, `open-shift-card.tsx:33`).
- Login: a hint "The number Acme Events has for you, like 07700 900123"; "No text after 2 minutes? Check the number and try again, or contact the office." (`login/login-form.tsx:41-53,97-104`).
- Home "2 urgent near you" → "2 urgent shifts near you" (`home-copy.ts:54`).
- Pay: "To see your pay, we'll send you a 6-digit code." → "To keep your pay private, we'll text you a 6-digit code."; "No pay data yet for this period." → "No pay to show yet. It appears here once payroll sends it." (`pay/code-gate.tsx:101`, `pay-view.tsx:28`).

### Layout changes (UI: a mock-up first)

- Office: icon-only controls: the rail shows icons only at 1280px (open with names on a first visit, `rail-cookie.ts:10`); the paper-plane offer buttons need "Offer" (`board-copy.ts:223`); "…" menus need "More"; the bell's number needs "1 new" (`updates-bell.tsx:33`).
- Office: the dashboard map on a phone: bare numbers, no names, no key (`venue-map.tsx:88,380`): the key and the table by default, or the map of section 3.
- Office: the card's red bar reads as a countdown but is the booked share; the "Urgent"/"Open" chip repeats the title (`board.tsx:349-357,366-369`).
- Casual: the Profile tab's "1" and the "ZA" tile beside "Renew your staff photo" (`tab-bar.tsx:71-81`, `home-view.tsx:193,199`): a camera icon and "To do".

### Already reads well (leave it)

"A cancellation is final the moment it's made: nothing here needs approving." · "Approving doesn't
change the shift. Make the change on the shift's page." · "Not offered to anyone yet." · "Can't make
it? Cancel with the link as early as you can." · "1 of 4 places left" · "It doesn't change which
shifts you're offered." · "We check the file first and nothing is saved until you import it." ·
"Never put bank details in a pay query."
