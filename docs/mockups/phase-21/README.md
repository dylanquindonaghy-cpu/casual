# Phase 21: the office's look, as built

Screenshots of the office on the demo seed's made-up data (PLAN.md Phase 21; docs/ui-design.md
"The office's system"), taken on a production build in the browser tests' own setup, at the
brief's phone (390px, at 2x) and a wide screen (1440px, shrunk to 1080px wide here), light and
dark. They were compared with Dylan's five references and reviewed with the taste skill
(`.claude/skills/design-taste-frontend`: its app-screen rubric and inspector, `inspect.mjs --app`);
what each round found is below.

Each page is one sheet: 1440px light and dark above, 390px light and dark below, all taken on
the final code.

| File | What it shows |
|---|---|
| `before-dashboard-1440-light.jpg`, `before-dashboard-390-light.jpg` | The dashboard before Phase 21 (Phase 20's look) |
| `dashboard.jpg` | The date line over the serif greeting; the four tinted cards; the urgent places as one rounded list; the menu's grey pill and grey counts |
| `needs-attention.jpg` | Needs attention's amber panels of near-white rows, "Also needs you" in pale red |
| `events.jpg` | Events & sessions: the board in its white card, the filters in their grey track |
| `casuals.jpg` | Casuals: the table card (cards on a phone) and the chips |
| `enquiries.jpg` | Enquiries: the filters as grey pills, the list card with its chips |
| `cancellations.jpg` | Cancellations: the record list and its filters |
| `pay.jpg` | The pay dashboard: its figures in Geist Mono on white cards, grey pill buttons, a list card of rows |
| `log.jpg` | The action log's table card |
| `settings.jpg` | Settings: white cards of fields, a near-black main button, grey pill buttons |
| `team.jpg` | The office team |
| `casual-record.jpg`, `cancellation-record.jpg` | Two records opened from inside a page: a casual's page; a cancellation's facts as label and value rows in one white card |
| `login.jpg` | The office's login: the serif headline, the field, the near-black button, the white card from 640px |
| `skeleton-page.jpg`, `skeleton-dashboard.jpg` | The skeletons while a page picked in the menu is held back (on a phone the drawer has shut) |
| `numbers-geist-vs-geist-mono.jpg` | The big numbers tried both ways (A: heavy Geist 800, B: Geist Mono 600, picked) |

## Against the references

- **hilos:** the small tracked date line over a big headline; the four cards (icon top left,
  uppercase label top right, the number, one grey line) in soft tints with a 1px edge a shade
  darker; count pills beside section names; "All on Events & sessions" and "Open Needs attention"
  as quiet grey links; Needs attention, Waiting on others and Sorted today as tinted panels of
  near-white rows.
- **Apple Wallet:** the urgent places as one rounded list, hairlines starting at the words, a
  neutral date tile, the role as the title with grey lines under it, "Not offered yet" as red
  words, the quiet "…".
- **Steep:** this week as one colour of bars, red only on a day with urgent gaps, the dashed "All
  filled" line, today's name in a filled pill, the big number bottom left.
- **Shopify:** white cards with the one soft shadow; grey count badges in the menu.
- **Neo Financial:** the large serif headline; label and value rows (a cancellation's record);
  grey-fill buttons; a destructive action as red words on grey.

## What the review found, round by round

1. The shadow too heavy (now 7% at 12px); the page and greys too cream (now `#f6f5f3` and less
   yellow greys); the "…" menu running off the screen at 390px (anchored to its button's side).
2. The events board's filters wrapping onto two lines at 390px (now one row that scrolls
   sideways in its track).
3. After the claims-auditor's first round: the drawer's rows 40px (now 44px); the menu's counts
   white (now the one grey pill, as beside a section's name); shared parts with the casual app's
   corners and spacing (now their office values, `office:`); the office's login on the casual
   app's field and button (now the office's).
4. With every page checked in the browser: a 55-character qualification chip ran Casuals 9px
   sideways at 390px (a chip now wraps rather than run off); a cancellation's record had its
   facts bare on the ground (now one white card); on a phone the skeleton sat behind the open
   drawer (the drawer now shuts as a page is picked).

Kept on purpose, where the brief wins over the skill: the uppercase tracked labels and date line,
the 40px serif greeting, the mono figures. The inspector also flags "Acme" as a placeholder name:
it is the demo seed's firm.
