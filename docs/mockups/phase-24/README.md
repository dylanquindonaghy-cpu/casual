# Phase 24: Liquid Glass (round 7 of the canvas)

Dylan approved round 7 of the Design canvas "ShiftDesk polish, before and after"
(https://claude.ai/artifact/3uQHabiVYTazwyCkAAH9EJ, version 60) on 26 Oct 2026: "keep round 7 and
build it into the app", choosing "Round 7 exactly, layout too". The canvas can't be opened by a
builder, so this folder holds its pages as pictures and describes them in words. The numbers in the
pictures are the canvas's sample data (26 places to fill, 2 urgent, 7 to check, 10 pay queries); the
app shows the firm's real ones.

| File | What it shows |
|---|---|
| `dashboard-light.jpg`, `dashboard-dark.jpg` | The office shell and the dashboard at 1280px (1.5x), the whole page |
| `events-*.jpg`, `enquiries-*.jpg`, `casuals-*.jpg` | Events & sessions, Enquiries, Casuals at 1280px |
| `home-*.jpg`, `open-*.jpg`, `shift-*.jpg`, `pay-*.jpg` | The casual app at 390 × 844 (2x): Home, Open shifts, a shift, Pay |
| `glass/` | The mock-up's own CSS for the glass, for its exact values: `office-glass.css` (round 6, the floating layer), `office-more-glass.css` and `phone-more-glass.css` (round 7, everything else), `phone-glass.css` (round 6 on the phone: the tab bar's lens and how it shrinks, the top bar's frosted edge) |

## The look

- **Ground:** a pastel wash fixed behind the page: soft blue at the top left, lavender at the top
  right, peach low in the middle, mint at the bottom left, over `#eef1f8`. Dark: blue, purple,
  orange and teal light on `#07080c`.
- **Sections are glass:** panels and cards are translucent white (about 46%) with the page behind
  them blurred (26px office, 22px phone) and saturated (1.8), a lit rim (a 1px white line along the
  top and a faint white edge all round) and a soft drop shadow. Dark: dark glass (about 46% of
  `#1a1b22`) with a faint white rim.
- **Things inside a section** (cards in a panel, tiles, chips, avatars, counts) are translucent
  white gradients with the lit rim, so the section's frost shows through them; they don't blur
  again.
- **Buttons:** ordinary buttons are clear glass capsules (a white gradient from about 78% to 40%, a
  bright rim, a soft drop). The main button (Offer to someone, Take shift, Directions, Send reply,
  Add shifts) is tinted glass: the colour with a gloss over its top half and a lit top edge, white
  words.
- **What floats** (the rail, the top bar's three capsules, the tab bar, the offer panel, menus, the
  confirmation) is the strongest glass, and in Chrome the page behind it bends a little as well as
  blurring (an SVG displacement in the backdrop filter).
- **Type:** Geist 400, 500 and 600 everywhere. Grey words are `#55585f` in light and `#c4c5ca` in
  dark so they keep 4.5:1 on glass.
- **Fallbacks:** "Reduce transparency" or "Increase contrast" turns every surface solid; forced
  colours use the system's; reduced motion stops movement.
- **Presses:** glass controls swell a little (about 4 to 5%) and brighten while pressed, then spring
  back.

## The office (1280px)

- **Rail:** at the left, a floating glass column 72px wide: the firm's mark, a button that opens the
  rail to names (236px), then icons for Dashboard, Needs attention, Events & sessions, Enquiries,
  Cancellations, Pay, People and, under a line, Admin and records. A red dot on an icon means its
  page needs you. Opened, Pay and People fold open to their pages (Pay dashboard, Pay queries 10,
  Import pay records; Casuals 2, Strikes, Notice report), with counts. The page you're on sits under
  a white glass lens with its icon in blue.
- **Top bar:** three glass capsules that stay at the top, with a soft frosted edge once the page
  scrolls under them:
  1. the counts, each a pressable pill: To fill 26, Urgent 2 (red), Offers out 11, To check 7, Pay
     queries 10;
  2. Search, with ⌘K;
  3. the light or dark button, then you: initials in a blue disc, "Admin (demo)", "Office admin",
     and a chevron.
- **Dashboard:**
  - "Dashboard", then "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated 11:20 from your
    planner". On the right a glass track: All 11, Urgent 2, This week 9, Next week 2 (the chosen
    one under a white lens with its count in a blue disc).
  - **Places to fill** (a glass panel): "Next 2 weeks, by day", a key (Not offered yet in black,
    Offered, no reply yet in blue), and a bar per day stacked black then blue, today's date in a
    black disc, "This week" and "Next week" under the days, a round ↗ button.
  - **Detail card** beside it, for the chosen session: a date tile (red when urgent), "Door
    supervisor" with an Urgent tag, "Northern Lights Live · Gate A, Acme Demo Arena", a row "Tue 27
    Oct, 08:00–16:00 · 1 place to fill", two figures "Starts in 21 h" (red) and "Offers sent 1 · No
    reply yet", an amber line "Mo Rahman hasn't replied since 07:19.", then "Offer to someone →"
    (tinted) and "Open the shift" (clear).
  - **Board**, four glass columns, each with a coloured leaf, a title, a count and a line:
    - To offer 6 · "13 places, not offered yet"
    - Offered 5 · "13 places · 11 offers, no reply yet"
    - While you were out 3 · "Filled by the shifts line, 18:00 to 08:00"
    - Who worked? 5 · "5 sessions from Sun 25 Oct"
  - Each card: a date tile, the role, the event, a time chip, "N to fill" (red when urgent), offers
    sent, and a round paper-plane button; overnight cards show who said yes, the session, and the
    time and channel in green; Who worked? cards show the sessions and "Since yesterday" with a
    round tick. The chosen card has a dark outline. "Show 3 more" under a column.
  - **The offer panel** slides in from the right over a dimmed page: the session, who can take it
    (initials, name, hours booked that week, how they're reached) with "Send offer" (then
    "Sending…", then "Offered"), and "Already offered" with each answer. A confirmation at the
    foot: "Offer on its way to Kieran Doyle."
- **Events & sessions:**
  - "Events & sessions", a line, and buttons All shifts by day, Import shifts, Add shifts (tinted).
  - Tabs All 8 · Showing 7 · Hidden 1 · Urgent, not filled 2, and "8 events with sessions to come ·
    26 places free".
  - Events as glass cards in two columns: the name, site and dates, a switch (showing to casuals),
    the chips "Showing to casuals" and "Urgent, not filled", "4 sessions · 5 places free".
  - Each session: role and day and time, Urgent, the requirement chips (SIA DS), the post, a fill
    meter "3/4 filled", "£15.50/h" and "…" (Offer a place, Assign someone, Mark urgent, Change or
    cancel).
  - "1 filled session" folded, and "View sessions →".
- **Enquiries:**
  - "Enquiries", "7 enquiries today · 2 need a person, the oldest 1 h 49 min ago", tabs All · Need a
    person 2 · Requests from the app · Pay.
  - At the left, the list: a channel icon, the name, the time, a status chip ("Passed to a person,
    waiting", "Answered by keyword", "Sorted by AI, answered from your data", "Pay (always a
    person)") and the message.
  - At the right, the chosen message: "Message from Kieran Doyle", its chip and reference, "Kieran
    Doyle's page", the conversation as bubbles, "How it was answered" as numbered steps, a reply box
    with "Sent from your shifts line, by WhatsApp", "Close, no reply needed" and "Send reply"
    (tinted).
- **Casuals:**
  - "Casuals", a line, tabs All 8 · Need updating 4 · Uploads to check 2, and a search box "Name or
    mobile number".
  - One glass table: Casual (initials, name, roles), Qualifications ("SIA DS: valid until 12 May
    2027", chips for being checked or expiring), Staff photo (Up to date with its date, Waiting for
    check, Overdue), Travel area, Live strikes (red when not 0), Needs updating.

## The casual app (390px)

- **Top bar:** the firm's mark and name ("Updated 11:20" on Home), frosting once the page scrolls
  under it.
- **Tab bar:** a floating glass capsule 14px above the foot: Home, Shifts, Pay, Profile (a yellow
  badge). The current tab sits under a white glass lens, its icon and word in the firm's colour.
  Scrolling down shrinks it to its icons (54px tall); scrolling up or tapping opens it again.
- **Home:**
  - "Hi Zoe" (28px, 500).
  - The pass: a glass card whose top is a warm translucent band with an "In 3 days" chip, "Thursday
    29 October", "14:00–22:00" (44px) and "Steward · Riverside Food Festival". Under the band:
    "Riverside Demo Park", "Exampleton, ZZ7 2AB" and a "Gate 2" plate, then Directions (tinted) and
    Details (clear) side by side, and "Can't make it?" in red under them.
  - "Do this", "Shifts you can take" and "Pay" as glass cards of rows: an avatar or date tile, two
    lines and a chevron.
- **Open shifts:**
  - "Open shifts", "Shifts you can take, up to 45 minutes from home.", a glass Open | Booked switch
    with a lens.
  - A strip of 8 glass day tiles (urgent counts in red, booked days grey with a tick, the chosen day
    in ink).
  - "3 shifts" and a "Site and role" button.
  - "Urgent, needed now", then "More shifts you can apply for": glass cards with a date tile, time,
    pay an hour, role, event and post, the travel line, "1 place left" and a round arrow.
- **A shift:** "← Open shifts" (frosting when scrolled), a glass card topped by a red "Urgent,
  needed now" band, the date tile, "08:00–16:00", "Tuesday 27 October · 8 hours", "Door supervisor",
  chips, the place with its gate plate; cards for Getting there (three tiles and Open in maps),
  Places (seats, "1 of 4 places left"), You need, then Report to, Bring and wear, Pay. "Take shift"
  floats at the foot as a tinted capsule over a frosted strip, the strike warning under it. Taking
  it shows "You're booked." over the whole screen.
- **Pay:** "Pay", "The last 8 weeks, from Acme Events' payroll.", the newest week as a glass card
  (the dates, "Gross pay", "£324.00", a glass row per rate, "Pay date: Fri 30 Oct"), "Earlier
  weeks" one row a week, "If something looks wrong, raise a pay query.", "Raise a pay query",
  "Your pay queries".

## Where the build differs from the mock-up

- **While you were out:** the shifts line never books anyone (it answers with links); casuals take
  places themselves from the offers sent to them. The column shows the places casuals took
  themselves between 18:00 and 08:00 (last night's; from 18:00 today once it's past 18:00), still
  booked, with how the offer reached them and when they said yes, and its line says so ("Taken by
  casuals from offers, 18:00 to 08:00") rather than "Filled by the shifts line". The demo's seed
  has no such takes, so the column shows "Nothing taken last night." until a casual says yes
  overnight.
- **"Updated … from your planner"** shows only when the planner (or a rota sheet) has sent
  changes; the demo has neither.
- **Closing an enquiry** still asks why: the log keeps a reason for every closed enquiry.
- **The main button** is tinted glass in the firm's own colour (Acme's is the mock-up's blue), as
  the casual app's main button already is; a firm's colour is darkened until white words read at
  4.5:1.
- **Pay's week total** shows only when payroll gave a gross for every line of that week (Dylan's
  choice); otherwise each line keeps payroll's own gross.
- **Casuals' "Needs updating"** keeps today's rule (qualifications); the staff photo has its own
  column.
- **The places chart** covers this week and next (Monday to Sunday, twice), so "This week" and
  "Next week" match the filters; its axis steps in tens (10, 20, …), so its half is a whole
  number.
- **"To offer"** is the chart's key and the column's line ("{13} places, no offers out"), not "Not
  offered yet": a session whose every offer was answered (said no, or closed when the session
  changed) needs offering again, and it was offered. The detail card says which: "Not offered to
  anyone yet." or "No offers out. Offer it to someone else."
- **"All"** is every session to come with a place free (Events & sessions' "Need people"), not
  only the two weeks the chart shows, so nothing to fill is missing from the dashboard.
- **The track** filters To offer and Offered (the sessions with places to fill it counts) and the
  detail card's first choice; While you were out and Who worked? always show everything (the
  mock-up filtered them by week too).
- **The detail card's "…"** (at its top right) keeps the urgent places' "Mark as filled" and "Not
  urgent", which the mock-up didn't show; its line names up to two who haven't replied ("{Ben
  Fraser} and {Priya Shah} haven't replied since 08:02."), then "and {2} others", and says when a
  session is hidden from casuals.
- **Who worked?** groups alike sessions as Needs attention does (the role over the site, "{3}
  sessions"); its count is sessions, as the mock-up's, and each card says how many people are
  left to mark to a screen reader.
- **The offer panel** shows what the offer page shows, from its loader: the session as a link, the
  daily cap's rule, and how each offer was answered ("closed when the shift changed" for an offer
  the session's change closed; the offer page and a shift's page said "didn't answer in time",
  which wasn't true). The confirmation sits at the panel's foot.
- **What Phase 23's dashboard linked to** stays a click away: the top bar's counts, the rail, the
  board and the detail card hold most of it. Three needed a way in of their own, since only the
  old count cards linked there: Events & sessions shows its "Showing" filter again (the round 7
  Events page has one too, 24.4), and Cancellations and Enquiries each have "Show only today's"
  under their views (the mock-up doesn't show one; "Cancellations today" and "Enquiries today"
  were the way to today's lists, and today's CSV of cancellations).
- **Events & sessions' "Need people"** (the top bar's To fill opens it) shows as a filter after All
  only while it's the one chosen; the mock-up's four are always there.
- **An event's sessions** each show the post (else the meeting point; the mock-up showed one or
  the other); the uniform and the rest are on the event's page. A card holds its first 30
  sessions to come and counts the others ("+ 2 more sessions"). The old board's Earlier and Later
  went with it (the shifts list, "All shifts by day", has the days), and each session's Urgent
  switch is in its "…" ("Mark urgent" / "Not urgent"), as the mock-up's menu has it.
- **The show-to-casuals switch** is the office's green for "fine" (`done`: dark green in light,
  light green in dark), so it keeps 3:1 on the glass in both; the mock-up's one green was too dark
  on dark glass.
- **Enquiries' pane** keeps "Considered but not offered" under "How it was answered" (the message's
  page has it; the mock-up's sample had nothing left out), and a pay message's row keeps "Pay:
  never answered by AI (rule)" under its words. With no message asked for, the pane shows the
  list's first. A phone has no pane: a row opens the message's own page.
- **Casuals' search** shows its matches in a floating panel under the box (the mock-up showed only
  the box), as the find form's matches were, with Close. Uploads to check is one glass panel of
  rows, each with "Check it".
- **Below 1024px** the office keeps today's top bar with Menu and the drawer (the mock-up only
  shows 1280px).
- **The rail's dots** mark only a page that needs you: an admin's pay queries wait with payroll, so
  Pay has no dot for an admin (the mock-up drew one). "To check" is Needs attention's one count.
- **The rail's icons** are the office's own (a house for the Dashboard, a tray for Enquiries),
  since the mock-up's tiles are the Pay dashboard's icon. Admin and records is a fold of its pages,
  like Pay and People, rather than one link.
- **Offers out** opens the dashboard's Offered column (`/office#offered`; the offers chart until
  24.3); To fill and Urgent open Events & sessions' "Need people" and "Urgent" views.
- **The search** shows from 1024px, for admins and resourcers (the roles that can open what it
  finds); a site opens Events & sessions at that site. In a narrower column (a 1024px window, or the
  rail open) the counts lose their icons and your name and role go, before anything scrolls.
- **The shifts line's number** moved to Settings, which didn't have it (PLAN.md's "Settings keeps
  it" was wrong: until 24.2 only the top bar and the dashboards showed it).
