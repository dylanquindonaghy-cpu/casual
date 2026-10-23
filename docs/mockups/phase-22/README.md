# Phase 22: the office's look, round 2

`mockup.html` is the mock-up Dylan approved on 22 Oct 2026 ("bettter but remove the gradients
theres no need for that buildit after that"), as published once the gradients were out; `img/`
holds the before shots it compares against. The `.jpg` sheets beside it are the office as built
(PLAN.md Phase 22; `docs/ui-design.md` "Phase 22"; `docs/screens.md` "The office's look, round
2"), taken on a production build with the demo seed's made-up data, logged in as the demo admin,
at Dylan's sizes: a laptop window of 1280 × 640 (at 1.5x, his 150% scaling) and a phone of 390px
(at 2x), each in light and dark.

Each page is one sheet: 1280px light and dark above, 390px light and dark below (the first 760px
of the phone page).

| File | What it shows |
|---|---|
| `dashboard.jpg` | The window and its sheet; the firm and your initials over the menu; the white pill on Dashboard; the amber and blue counts; the four cards in full colour; the urgent places with their calendar tiles, grooved fill bars and "Offer" |
| `dashboard-full.jpg` | The whole dashboard at 1280px: this week's grooved bars (striped on a day with no sessions) and the three panels of raised white rows |
| `needs-attention.jpg` | Grained amber washes of raised white rows, as the dashboard's panels; "Also needs you" a red wash in 4 of 12 columns, its button on one line |
| `events.jpg` | Events & sessions: the filters in their groove, the arrow buttons raised, the board in its white card |
| `casuals.jpg`, `casual-record.jpg` | Casuals, and one casual's page |
| `enquiries.jpg`, `enquiry-record.jpg` | Enquiries, and one enquiry |
| `cancellations.jpg`, `cancellation-record.jpg` | Cancellations, and one cancellation's record |
| `pay.jpg`, `pay-queries.jpg` | The pay dashboard and pay queries |
| `log.jpg`, `settings.jpg`, `team.jpg` | Pages under Admin and records: the group open, so the menu scrolls, opening with the page you're on in view and fading at both edges; on Settings, fields set in as grooves |
| `guide.jpg` | The how-to guide (opened from the account menu) |
| `offer.jpg`, `shift.jpg` | The offer page for an urgent place, and the same session's page |
| `moments-light.jpg`, `moments-dark.jpg` | What moves, caught in the act: a card pressed (it dips to 97%); "Offer" with its spinner while the offer page is held back; the "…" menu; a week day's numbers under the pointer; the account menu (the light/dark switch, the guide, Log out); the menu on Settings with its group open; the ring where a card's jump landed |

## Checked on these shots

- Every page answered 200 at both sizes in both themes, with no sideways scroll and no errors in
  the browser.
- On every page in an admin's menu, no round button breaks onto two lines at 1280px. The shots
  found one that did (Needs attention's "Go to the Dashboard", in a column 3 of 12 wide); its
  column is now 4 of 12, and `tests/e2e/office.shell.spec.ts` checks every page for it (it fails
  with the old column put back).
- At 1280 × 640 every row of the admin's menu fits (the last row ends about 600px down); the pay
  week line under them is a scroll away at that height and shows from about 690px tall.
- With the pointer: a card lifts 2px and dips to 0.97 when pressed; the pill moves to a picked
  link before its page arrives; a card's jump plays the landing ring; the "…" menu and the
  account menu grow out of their buttons. With reduced motion nothing dips or lifts (the browser
  tests check both).
