# Phase 23: the office's look, round 3, and the dashboard's charts

`mockup.html` is the mock-up Dylan approved on 23 Oct 2026: the round 3 look ("looks good now"),
then with its six charts and their panels ("go build it"). `img/` holds the before shots it
compares against (round 2, as Dylan saw it live). The `.jpg` sheets beside it are the office as
built (PLAN.md Phase 23; `docs/ui-design.md` "Phase 23"; `docs/screens.md` "The office's look,
round 3, and the dashboard's charts"). They were taken on a production build with the demo seed's
made-up data, logged in as the demo admin, at Dylan's sizes: a laptop window of 1280 × 640 (at
1.5x, his 150% scaling) and a phone of 390px (at 2x), each in light and dark.

Each page is one sheet: 1280px light and dark above, 390px light and dark below (the first 760px
of the phone page).

| File | What it shows |
|---|---|
| `dashboard.jpg` | The first screen: the top bar (the firm, the pay week with "This week", the shifts line's number, the square light or dark button, your initials and name); the menu in its own card with the pale blue pill on Dashboard and its amber and blue counts; the four white count cards; the start of the urgent places |
| `dashboard-full.jpg` | The whole dashboard at 1280px: the urgent places' cards with their wide sky "Offer", then the six charts (places to fill, which events need people, offers this week, how long things have waited, cancellations with a letter for each weekday, licences running out) |
| `dashboard-phone-full.jpg` | The whole dashboard at 390px: the charts one under another, the day charts scrolling sideways |
| `panel-day.jpg` | A day on the places chart, opened: from the side at 1280px, a sheet from the bottom at 390px |
| `panel-needs.jpg` | The "Needs attention" count card, opened: its rows with their actions |
| `moments.jpg` | A mark's figures under the pointer; Numbers (the places chart as a table); the account menu |
| `needs-attention.jpg` | Needs attention: amber and red tints with their edges, white rows with a hairline |
| `events.jpg` | Events & sessions: the filters as tabs, today's date in a sky circle, weekends pale grey |
| `casuals.jpg`, `enquiries.jpg`, `cancellations.jpg` | The lists, their "Show" filters as tabs |
| `pay.jpg`, `pay-queries.jpg` | The pay dashboard and pay queries |
| `log.jpg`, `settings.jpg`, `integrations.jpg`, `team.jpg` | Pages under Admin and records (the group open), Integrations among them |
| `guide.jpg` | The how-to guide (opened from the account menu) |
| `login.jpg` | The office login page, logged out |

## Checked on these shots

- Every page answered 200 at both sizes in both themes, with nothing scrolling sideways and no
  errors in the browser.
- At 1280 × 640 the admin's whole menu fits its card (512px of rows in 512px, no scrollbar).
- The demo's offers chart shows 0 under "Said no or closed": the seed makes only offers the app
  itself can reach (waiting, and said yes for this week's bookings).
- A mark's figures sit 8px over a column or a dot (the shot shows a column's), and beside a row of
  bars, so they never cover the next row; they stay while the pointer moves onto them and go with
  Escape (the browser tests check both).
