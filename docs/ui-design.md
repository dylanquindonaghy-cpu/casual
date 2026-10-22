# UI design system

How every screen looks and is laid out. Added 2026-10-05 (Phase 11) at Dylan's request: "make it a
lot easier to see and understand where everything is". Words on screens still come from
`docs/screens.md`; this file covers layout, hierarchy, colour and components only.

Principles, in order:

1. **You always know where you are.** Every office page sits in one shell with the same menu, the
   current page marked. Every page opens with a header that names it.
2. **What needs doing comes first.** Things that need action are at the top, counted, and marked
   with a status word in a colour. Read-only lists are compact.
3. **One main action per card or form.** Buttons look like what they do: main, other, or
   destructive.
4. **Colour is never the only signal.** Every coloured status carries its word. Contrast meets
   WCAG AA (text 4.5:1, borders and controls 3:1).
5. **No decoration.** No gradients, glows or textures. Motion only to show what changed, as Phase
   18's spec (below). The firm's colour marks its main actions and where you are, never a status.
6. **Works without JavaScript** where pages already do (server-action forms, `<details>`
   confirmations, GET filter forms, anchor links).

## Phase 21: the office's system

Built from Dylan's brief of 2026-10-22 ("Redesign the visual layer of the office dashboard and
every page that shares its components ... a visual and layout pass only"), with the taste and
ui-ux-pro-max skills and his five references. The office only: every page under `/office` (the
office's login pages too) carries `[data-office]` (`src/app/office/layout.tsx`), and
`src/app/globals.css` gives `body:has([data-office])` its own values of the same tokens, so a
class means the same thing in both places and the casual app keeps its Phase 20 look. Every
office file uses only what's below (`tests/unit/ui.office-system.test.ts`).

- **Colour.** A warm off-white page (`canvas` `#f6f5f3`) with the menu on the same ground, white
  cards on it, near-black main buttons (`ink`; white in dark), and red, amber, blue and green only
  for statuses and the dashboard's tinted cards, each tint with its 1px edge a shade darker
  (`urgent-line`, `attention-line`, `wait-line`, `done-line`). The firm's colour stays on its
  initial at the top of the menu and on no button (`brand` is `ink` in the office). Other buttons
  are grey pills (`button`, `button-hover`, `button-press`), a destructive step's opener red words
  on grey, its final click red (`urgent-fill`). The page you're on in the menu is a grey pill
  (`active`). The values for both themes are in the table below; every pair is checked in both
  (`tests/unit/ui.contrast.test.ts`).
- **Type.** Geist for every word (its own fixed-width digits, checked in a browser: tabular
  figures change its digit widths), self-hosted from its npm package (SIL Open Font License) in
  `src/app/office/office-fonts.ts`, so only office pages fetch it. Each page's headline in
  Instrument Serif (`text-title`, 28px; the dashboard's greeting `font-display`, 40px). The
  dashboard's big counts in Geist Mono semibold (`font-stat`): tried beside heavy Geist (800) at
  40px (`docs/mockups/phase-21/numbers-geist-vs-geist-mono.jpg`), picked because its flat-footed 1 and marked 0 read as counts rather than a headline and
  every digit is one width, so the three faces each have one job. The scale's seven steps are 12,
  13, 15, 17, 20, 28 and 40px in the office (`text-lg`, `text-2xl` and `text-3xl` change);
  headings semibold, `tracking-heading` (-0.015em).
- **Spacing** 4, 8, 12, 16, 24, 32 and 48px (Tailwind's 1, 2, 3, 4, 6, 8 and 12); one measure
  apart, the room under the menu for its fixed foot. **Corners:** cards 20px (`rounded-card`),
  rows and fields 14px (`rounded-row`), pills and buttons round. **Depth:** one token, `soft`
  (a hairline ring and a soft fall under 8%; in dark the ring is what shows), on the office's
  white cards and what floats over its page. **Motion:** 150ms colour changes on everything you
  can press, 200ms turns; every button has hover, focus (the ink ring) and pressed states.
- **Where each reference went.** hilos: the dashboard's small tracked date line over the
  headline, its four tinted cards (an icon top-left, a tracked label top-right, the number, one
  grey line), the count pills beside section titles, the quiet grey links to whole lists, and
  Needs attention, Waiting on others and Sorted today as tinted panels of near-white rows (Needs
  attention's page too). Apple Wallet: the urgent places as one rounded list with hairlines
  starting at the words, a neutral date tile, the role with grey lines under it, status as
  coloured words ("Not offered yet" in red), the grey pill buttons and the quiet "…". Steep: this
  week's bars (one colour, red on a day with urgent gaps, grey once gone; a dashed line where
  every place is filled; today's name filled; the big number bottom left). Shopify: the soft
  white cards, the grey count badges in the menu. Neo Financial: the large serif headline, label
  and value rows, grey-fill buttons, destructive words in red on grey.
- **States.** A page picked in the menu shows a skeleton in the page's place while it's on its
  way, once it has taken longer than 150ms (`office-skeleton.tsx`, flat grey bars, nothing moving:
  the dashboard's own, a part for every section; every other page shares one, a headline, a line
  and a card of rows). `menu-pending.tsx` and `office-frame.tsx` show it: the link says it's
  picked (`onNavigate`), the drawer shuts at once on a phone so the skeleton is seen, and it goes
  when the page arrives, when the link that saw it on its way says it no longer is, or on Back. Not a route-wide `loading.tsx`: that starts every page's answer before
  its access check, so a page a role can't open would answer 200, not 404 (the browser tests
  caught it; ADR-016 in docs/decisions.md warns the same of the login check). So a page opened
  from a link inside another page (a shift, a casual, a record) loads as it did, without one. Every dashboard section says when it's empty and when it couldn't load, in the
  section (Waiting on others too: a pay-queries count that couldn't be read).
- **Phone (390px).** The top bar with Menu (the drawer), 44px targets everywhere, the four cards
  two by two, the urgent places' buttons under their words, this week's bars lying down a row a
  day, the board's filters scrolling sideways in their track.
- **The dark round button over the menu's foot** was Next's own development button (drawn only by
  `next dev`), bottom-left by default, which is where the menu's foot has sat since Phase 20:
  `next.config.ts` now draws it bottom-right (`devIndicators`, pinned by
  `tests/unit/ui.office-system.test.ts`). The browser tests run a production build, which never
  draws it, so they can't see it either way.
- **Shared parts in the office.** A part the casual app shares (the chips, the seats on the
  events board, the "Too many tries" alert, the firm's bar above the office's login pages, the
  guide's numbered steps, the login link page's button) keeps its casual values and carries the
  office's beside them with the `office:` variant (globals.css: any element under
  `body:has([data-office])`), e.g. `rounded-lg office:rounded-row`; the office's file button is a
  grey pill. `tests/unit/ui.office-system.test.ts` follows the office's imports to every shared
  file and class string it renders and wants an `office:` value beside each value outside the
  system. The casual app's own counts are `staffCount` (Phase 20's pill). In the office a chip
  stays on one line while it fits and wraps rather than run off a phone (a 55-character
  qualification ran a 390px page 9px sideways until it could: `office.look.spec.ts` found it).

| Token (office) | Light | Dark | Use in the office |
|---|---|---|---|
| `ink` / `ink-muted` / `ink-hover` / `on-ink` | `#1c1b18` / `#63605a` / `#34322d` / `#ffffff` | `#f2f1ee` / `#a8a59e` / `#dcdad5` / `#121211` | Words, grey words, an ink button under the pointer, words on ink |
| `line` / `line-strong` | `#e7e5e0` / `#8c887f` | `#2c2c29` / `#77746d` | Hairlines; field and control borders (3:1) |
| `canvas` / `card` / `panel` / `raised` | `#f6f5f3` / `#ffffff` / `#f6f5f3` / `#efeeeb` | `#121211` / `#1c1c1a` / `#121211` / `#262624` | The page and menu; cards; the top bar and drawer; tracks, tiles, skeleton bars |
| `switch-off` / `scrim` | `#7b776f` / `#1c1b18` | `#807d76` / `#000000` | A switch that's off; behind the drawer |
| `brand` / `on-brand` / `brand-ink` | `#1c1b18` / `#ffffff` / `#1c1b18` | `#f2f1ee` / `#121211` / `#f2f1ee` | Ink: the firm's colour fills no office button |
| `urgent` / `urgent-soft` / `urgent-ink` / `urgent-tile` | `#b42318` / `#fdf3f1` / `#7a2116` / `#fbe6e2` | `#ff8a7a` / `#211514` / `#ffc8bf` / `#3a1e1b` | Red words; an urgent wash; its dark words; the urgent card |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#c4242a` / `#a51d22` / `#ffffff` | `#cf3a33` / `#b02e28` / `#ffffff` | Urgent bars and pills; the final destructive button |
| `attention` / `attention-soft` / `attention-ink` | `#a15c07` / `#fdf8ec` / `#5e4106` | `#f0a742` / `#1f1a10` / `#f8dfa0` | Amber: an icon; Needs attention's panel; its dark words |
| `hivis` / `on-hivis` | `#faefd2` / `#5e4106` | `#362c12` / `#f8dfa0` | The Needs attention card; "to mark" |
| `wait-tile` / `wait-ink` / `wait-soft` | `#e6edf8` / `#1d3c6b` / `#f3f6fb` | `#1a2638` / `#c9dbf7` / `#141a22` | Blue: the Waiting card, its words, its panel |
| `done` / `done-soft` / `done-ink` / `done-tile` | `#1f7a47` / `#f1f8f3` / `#17502f` / `#e2f1e7` | `#5fd08b` / `#111a14` / `#bfeccd` / `#16291d` | Green: a tick; the Sorted panel; its words; the Sorted card |
| `done-fill` / `on-done` | `#1f7a47` / `#ffffff` | `#1f7a47` / `#ffffff` | A done fill |
| `quiet-soft` / `quiet-ink` | `#f3f2ef` / `#4a4741` | `#232321` / `#d6d4cf` | Hover on white rows; a closed chip |
| `urgent-line` / `attention-line` / `wait-line` / `done-line` / `quiet-line` | `#f0cdc6` / `#ecd8a0` / `#c9d7ee` / `#c0dfca` / `#dedbd5` | `#55302b` / `#54461f` / `#2c3d57` / `#27452f` / `#3a3a37` | Each tint's 1px edge, a shade darker |
| `active` | `#ebeae6` | `#262624` | The grey pill of the page you're on |
| `count` | `#e3e1dc` | `#33332f` | The one count pill: beside a section's heading and in the menu (on the grey pill of the page you're on too) |
| `button` / `button-line` / `button-hover` / `button-press` | `#efeeeb` / `#efeeeb` / `#e6e5e0` / `#dcdad5` | `#262624` / `#262624` / `#2f2f2c` / `#383834` | A grey pill button, at rest, under the pointer, pressed |
| `ink-press` | `#000000` | `#ffffff` | An ink button pressed |

## Phase 20: the pass redesign's type, colour and depth

Built from the mock-up Dylan approved on 2026-10-21 ("yes build this"), made from his five
reference screenshots with the UI skills: what changed from Phase 18 below, which otherwise still
holds.

- **Type.** Instrument Sans for everything you read (`font-sans`), its semibold with its own
  fixed-width digits for the sign figures (`font-sign`: a shift's time, a date, a count); and
  Instrument Serif, one weight, for the greetings only (`font-greet`: "Hi Zoe", "Evening, Acme
  Events."). Both self-hosted from their npm packages (SIL Open Font License), latin and
  latin-ext. The same seven sizes; 40px also for the greetings.
- **Colour.** Neutral ink and greys (the firm's colour is the one colour a page has of its own),
  the statuses as pale tiles with dark words of the same hue (urgent, to do, waiting, done), and
  a dark theme of true greys in place of navy (D7 changed). The firm's set per theme as Phase 18,
  plus the pass's quieter second line (`on-brand-bar-soft`).
- **Depth.** The page, cards lifted off it, then the pass and what floats over the page (the five
  depth tokens, below). Phase 17's "flat" gives way to this; one hairline on cards stays.
- **Shapes.** Buttons and chips are pills; cards round (16px; the pass, tiles and panels 20–24px).
- **The parts.** The **pass** (Home and Booked: `src/app/next-pass.tsx`): a card in the firm's
  colour with the firm, how soon, the date in words, the time large, the role and event, the gate
  on a white plate (in the band's colour, or ink on a pale band), and the place; under it Directions, Details and
  "Can't make it?". The **date tile**: a small raised card (pale red when urgent). The **plate**:
  a gate in the firm's pale tint. The **seats**: filled in ink when taken, outlined when free (red
  when urgent). The **sheet**'s handle is a real one: pull it down to close the sheet.

## Phase 18: the redesign's type, colour, parts and motion

The Claude Design "ShiftDesk redesign" gave the layouts and parts (`docs/screens.md` "The
redesign"); its fonts and colours were reworked with the UI skills (frontend-design,
design-taste-frontend's app-screen rules, ui-ux-pro-max), compared side by side on the pass at its
real sizes before building:

- **Type: two faces, one job each.** Public Sans for words (built for public services: open,
  sturdy shapes that read at a glance and in sunlight), and Barlow Condensed bold for the **sign
  figures** (`font-sign`: a shift's time and date, a gate or post, a count, a pill), drawn from
  road signs so they read like the venue's own. Both have real fixed-width digits (checked in a
  browser). Half the download of the design's Archivo with its width axis (about 49KB against
  90KB, for the latin set), which matters on a venue's weak signal. One scale of seven sizes, the
  six before plus 40px (`text-4xl`) for the time and the date tile only; the design's ten sizes on
  one phone screen came down to six. Three weights: 400, 600, 700 (the sign figures).
- **Colour: the safety signs' roles.** Red to act now (`urgent`), sign yellow for what needs doing
  (`hivis`, with navy words), exit-sign green for done (`done`, `done-fill`), navy ink (the
  uniform's colour), and the firm's colour for its main action and where you are. The dark theme
  stays D7's navy exactly (until Phase 20: true dark greys, above). A status colour always
  travels with its word or icon.
- **The firm's colour per theme** (`firmPalette` in `src/lib/tenancy/brand-values.ts`, set on
  `<body>` as `--firm-*` with `data-firm-colour`; globals.css picks the theme's set): its band
  (`brand-bar`) is its colour darkened until white or navy reads on it at 4.5:1; in light its
  button and words (`brand`, `brand-ink`) are its colour darkened until it reads on the canvas and
  the card, with white on it; in dark, lightened until it reads on the card and the raised track,
  with navy on it (or white), lightened further if neither reads yet. Every pair is at least
  4.5:1 for any `#rrggbb` (`tests/unit/tenancy.brand.test.ts`). Acme's blue and Northline's teal
  pass as they are in light.
- **One filled button per screen**, in the firm's colour, in the casual app and the office
  (`btn.primary`, `staffBtn.primary`); words-only actions in the firm's colour (`btn.text`,
  `staffBtn.text`: "Not urgent", "Keep my shift"). Phone buttons 52px, office ones 44px.
- **The parts** (`src/app/ui/sign.tsx`, `seats.tsx` (since Phase 21), `plate.tsx`; the sheet in `src/app/shifts/sheet.tsx`): the **date tile** (a calendar
  page: the weekday on an ink band, red when urgent; the day in sign figures; the month), the
  **sign plate** (light on dark, like a venue's sign: "Gate 2"), the **seats** (a square per place:
  filled when taken, dashed when free, red when urgent; none past 16 places), the solid **plate**
  for a status that must catch the eye (red urgent, sign-yellow needs doing, green done, grey
  waiting; elsewhere statuses stay the pale `StatusChip`, now square-ish), and the **sheet** that
  rises from the bottom of the phone (a modal `<dialog>`).
- **The pass is the only thing with a shadow at rest** (`shadow-pass`; in dark a 1px line).
  Phase 20 replaced this with five depth tokens (above).
- **Motion** (globals.css `--animate-*`, `--ease-sd`): one easing, `cubic-bezier(.2,.8,.2,1)`;
  150ms for fades, the sheet's dim and switches, 200ms for items arriving or leaving, 250ms for
  cards opening and the sheet. A card opening rises 8px and fades in, its body 60ms after; a taken
  shift moves into Your shifts from 48px above, marked "New"; the sheet rises from the bottom; a confirmation drops in and stays 3 seconds. Only
  transform and opacity move; nothing loops. With reduced motion every movement is a 150ms fade and
  transitions stop.

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

Two themes: light, and a dark of true greys (D7 in `docs/office-v2.md`, changed by Dylan in Phase
20: it was navy). The light values are the `@theme` block; the dark values redefine the same
tokens. Every pair a page uses meets its contrast in both (`tests/unit/ui.contrast.test.ts`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#15171a` | `#f3f4f6` | Main text (a neutral near-black: Phase 20), the focus ring, an ink fill (a dark button, today on the week's bars) |
| `ink-muted` | `#575c64` | `#a9adb4` | Secondary text, labels, meta lines, table headers (6.7:1 on white; 7.8:1 on the dark card) |
| `ink-hover` / `on-ink` | `#2b2e33` / `#ffffff` | `#d4d6da` / `#0b0c0e` | An ink fill under the pointer; text on an `ink` fill |
| `line` | `#e3e5e9` | `#2c2e33` | Dividers and card borders (decorative only) |
| `line-strong` | `#7c8189` | `#6f737b` | Input, chip and secondary button borders (at least 3:1) |
| `canvas` | `#eef0f3` | `#0b0c0e` | The page behind cards: the casual app, and the office's frame and menu |
| `card` | `#ffffff` | `#18191c` | Cards, fields, the office's page (a sheet raised on the frame from 1024px) |
| `panel` | `#ffffff` | `#18191c` | The office's top bar (below 1024px) and drawer |
| `raised` | `#eceef1` | `#232529` | A sunk track (switches, the Open \| Booked switch, the board's filters), a full pill, a bar's track, the date tile |
| `switch-off` | `#767b83` | `#7d8189` | A switch's track when off (at least 3.5:1) |
| `scrim` | `#15171a` | `#000000` | Behind the open menu drawer and a sheet, at half strength (decorative only) |
| `brand` / `on-brand` | `#15171a` / `#ffffff` | `#f3f4f6` / `#0b0c0e` | The firm's own colour: the main buttons and the current tab. A firm with a colour of its own gets a set for each theme on `<body>` (`src/app/layout.tsx`, `firmPalette`: each pair at least 4.5:1); these are the values without one. Its pale tint, `brand-soft` (12% of it over `card`), marks an open Details button and a gate's sign plate, with `ink` (or `brand-ink`, which `firmPalette` makes read on the tint too, at least 4.5:1) on it |
| `brand-ink`, `brand-bar` / `on-brand-bar` | `#15171a`, `#1f2227` / `#ffffff` | `#f3f4f6`, `#34373d` / `#ffffff` | The firm's colour as words; the pass and the firm's initial, with the words on it |
| `on-brand-bar-soft` | `#d2d4d8` | `#d2d4d8` | The pass's second line (its date, how soon, its place: Phase 20), at least 4.5:1 on the band for any firm colour |
| `pass-plate` / `on-pass-plate` | `#ffffff` / `#1f2227` | `#ffffff` / `#34373d` | The gate's plate on the pass: white on any band, its words the band's colour (or ink on a pale band: `firmPalette`'s `onPlate`), at least 4.5:1 |
| `urgent` / `urgent-soft` / `urgent-ink` | `#c4242a` / `#ffefea` / `#7d1a10` | `#ff8b80` / `#231513` / `#ffcabf` | Act now: words and borders; an urgent panel's wash; its dark words |
| `urgent-tile` | `#ffd8cf` | `#3d1d19` | An urgent tile, day or date tile, the urgent band, with `urgent-ink` |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#c4242a` / `#9b1c21` / `#ffffff` | `#cf3a33` / `#b02e28` / `#ffffff` | Urgent pills and the final destructive button (white on `#cf3a33`: 4.87:1) |
| `attention` / `attention-soft` / `attention-ink` | `#b45309` / `#fff9e6` / `#5c3f00` | `#f2a541` / `#221d0e` / `#fbe3a0` | Someone needs to act: a border or an icon; a to-do panel's wash; its dark words |
| `hivis` / `on-hivis` | `#fbe5a0` / `#5c3f00` | `#3a2f10` / `#fbe3a0` | To do (Phase 20: pale yellow, per theme): a tile, a count, what the firm gives you ("We provide it") |
| `wait-tile` / `wait-ink` | `#d6e4fa` / `#163b6e` | `#172a45` / `#c8dafa` | Waiting, or more to look at: a tile, the account's initials |
| `done` / `done-soft` / `done-ink` | `#1f7a47` / `#ecf7f0` / `#155230` | `#5fd08b` / `#0f1d14` / `#bfeccd` | Fine, finished: words and borders; a done panel's wash; its dark words |
| `done-tile` | `#d2efdb` | `#15301f` | A done tile, a tick's circle, the "no strike" box |
| `done-fill` / `on-done` | `#1f7a47` / `#ffffff` | `#1f7a47` / `#ffffff` | The booked tick (white on it 5.3:1) |
| `quiet-soft` / `quiet-ink` | `#f1f2f4` / `#464b52` | `#222428` / `#d4d6da` | Information, closed |
| `demo` / `on-demo` | `#3d2e0a` / `#fde7b0` | `#3d2e0a` / `#fde7b0` | The demo bar |
| `urgent-line` / `attention-line` / `wait-line` / `done-line` / `quiet-line` | `#c4242a` / `#b45309` / `#a9c1e8` / `#1f7a47` / `#7c8189` | `#ff8b80` / `#f2a541` / `#2c4166` / `#5fd08b` / `#6f737b` | A status's edge (Phase 21): a chip's border (here the status colour itself); in the office, a tint's 1px edge a shade darker (decorative: the words say the status) |
| `wait-soft` | `#f2f6fd` | `#111a28` | A waiting panel's wash (the office's Waiting on others: Phase 21) |
| `active` | `#e3e5e9` | `#232529` | The grey pill of the page you're on (the office menu: Phase 21) |
| `count` | `#eceef1` | `#232529` | The office's count pill (Phase 21); the casual app's counts are `staffCount`'s |
| `button` / `button-line` / `button-hover` / `button-press` | `#ffffff` / `#7c8189` / `#f1f2f4` / `#f1f2f4` | `#18191c` / `#6f737b` / `#222428` / `#222428` | Any other office button, its edge, under the pointer and pressed (Phase 21): here the outlined button it was; in the office a grey pill |
| `ink-press` | `#000000` | `#ffffff` | An ink button pressed (Phase 21) |

**Depth (Phase 20).** Five shadow tokens and no other shadow anywhere in `src/`
(`tests/unit/ui.flat.test.ts` holds where each is used): `shadow-lift` (a card, row, tile or the
current menu item lifted off its ground), `shadow-panel` (a panel or a menu over the page),
`shadow-pass` (the pass, and the booked day on the strip), `shadow-bar` (the tab bar and the action
bar floating over the page's foot) and `inset-shadow-sunk` (a sunk track, an opened part set into
its card: the board's opened row, the travel figures). In dark they're darker, with a faint light
edge on what floats.

No other colour is written anywhere in `src/` (no `bg-white`, no Tailwind palette shade, no colour
value in a class or a style): the firm's colour, which the root layout works out from the firm's
settings and sets on `<body>`, is the one exception (`tests/unit/ui.theme.test.ts`).

**A firm's own colour on buttons.** Its words are black or white, whichever reads better (at
least 4.58:1), so a button in any firm colour can be read. Against the page, a pale firm colour
(yellow on the white card) or a dark one in the dark theme can show little edge: the button is
still named by its words, which is what identifies it, so no edge is added for now (Phase 17's
guardrails review, S5; revisit if a pilot firm's colour reads poorly).

**Easier to scan (Phase 17).** Flat surfaces then; since Phase 20, depth comes from the five depth
tokens only (above; `tests/unit/ui.flat.test.ts` holds it), with one hairline (`line`) on cards,
a 1px border on office controls and fields. No label above a page's heading and no divider under the header (the firm's bar or the
office's top bar names the firm). Lists are rows in one card rather than a stack of cards, and an
empty list keeps its place as a dashed frame with one sentence. Colour goes on what needs someone:
a valid licence or an up-to-date photo is quiet grey words, not a green tag.

**Light or dark.** The `sd-theme` cookie (`light` or `dark`; none, or anything else, means follow
the device) is read by the root layout (`src/app/layout.tsx`, `src/app/theme.ts`), which writes
`data-theme` onto `<html>`, so the page arrives in its colours and nothing flashes. With no cookie,
a `prefers-color-scheme: dark` block gives the dark values, guarded so an explicit
`data-theme="light"` wins. Each theme sets `color-scheme`, and the page carries `<meta
name="color-scheme" content="light dark">`, so the browser's own controls and scrollbars match.
The office's moon/sun button sets the cookie (12A.2); casual pages follow the device. The firm's
colour has a set for each theme (Phase 18, above).

Focus: every focusable element shows a 2px `ink` outline with a 2px offset on `:focus-visible`.
Buttons get `cursor: pointer`. File inputs get a visible "choose" button
(`::file-selector-button`). Every digit on a page is fixed-width (`tabular-nums` on `body`), so
times, counts, money and notice hours line up.

**Type.** One scale, and Tailwind offers no other size: 12px (`text-xs`), 13px (`text-sm`), 15px
(`text-base`), 18px (`text-lg`), 24px (`text-2xl`), 30px (`text-3xl`), and 40px (`text-4xl`,
Phase 18) for a shift's time and its date tile only. Office pages use 15px body
(the shell sets `text-base`), 13px meta, 18px section headings, 24px page titles (Phase 17: an app
screen's title, not a landing page's), and 30px for the dashboard's counts. Staff pages keep
18px body and their big buttons, with 24px for a page's result ("You're booked."). Office fields
are 18px on a touch screen (`pointer-coarse:text-lg`), because iPhones zoom in on a field under
16px.

**Font.** Public Sans (`@fontsource-variable/public-sans`) and Barlow Condensed bold
(`@fontsource/barlow-condensed`, for `font-sign`), self-hosted with `next/font/local` from their
npm packages (SIL Open Font License), each latin and latin-ext (for names such as Łukasz;
downloaded only when a page has such a letter), then the system's font. Nothing is fetched from
Google, while building or while running (`src/app/fonts.ts`).

## Shared components (`src/app/ui/`)

Plain, dependency-free, hook-free modules, safe for server and client components and for the
AI-boundary and client-boundary tests (they import nothing from `src/lib/`).

- `classes.ts`: the only place button, input, card and chip class strings live. Office buttons:
  `btn.primary`, `btn.secondary`, `btn.danger` (opens a destructive step), `btn.dangerSolid` (the
  final click of a destructive change: a step's "Yes, …", or a destructive action that happens at
  once, "Block from this site"), `btn.link` (text link with a 44px target). Staff buttons have the
  same names under `staffBtn` (full width, at least 52px tall since Phase 18). Links inside text or a row (a
  shift's title, a worker's name) use `textLink` (grey underline, darker on hover), or
  `textLinkInGroup` when the whole row or card is the `group` that darkens it. The login pages
  (staff and office, outside the shell) use `page.login` (the brand bar's 448px column),
  `loginCard` (framed from 640px up, frameless on a phone) and `loginTitle` for their one `<h1>`;
  the office's since Phase 21 `page.officeLogin` and `officeLoginCard` (the office's spacing, a
  white card with the soft edge), with `field` and `btn.primary`.
- `status-chip.tsx`: `<StatusChip tone="urgent|attention|done|quiet">word</StatusChip>`, with a
  small inline SVG icon that is `aria-hidden`. The word is the existing word from the copy module.
- `page-header.tsx`: `<PageHeader back title meta actions>`. Restyles the page's one `<h1>`;
  never adds a second heading. `back` (`{ href, label }`) is the way back to the list a record's
  page belongs to ("‹ Cancellations"), above the heading; nothing else goes there.
- `icons.tsx`: the few inline SVG icons the office's top bar and menu, the office guide and the
  staff home's "Log out" use, and the arrow (`chevron`) on each link of the office guide's
  contents below 1280px and on the account button (no icon library; inline SVG also works offline in
  the service worker's kept copy). The status chips draw their own four icons in
  `status-chip.tsx`.

`tests/unit/ui.design-system.test.ts` holds these: the tokens match the table above, the focus
ring and the file-input button exist, every colour class in `src/app/ui/` is a token or one of
Tailwind's own colours, each status tone has its own colours and icon, the tap-target heights,
and no hooks, client directive or package code in `src/app/ui/`.

Status tones for existing words:

| Tone | Words |
|---|---|
| urgent | Urgent, Expired, Suspended, Blocked, Didn't attend, couldn't be sent, short notice "Yes" |
| attention | Open, places free, not marked yet, Waiting for an answer, Waiting for the office, With payroll, Applied for, Escalated, waiting |
| done | Filled, Booked, Worked, Approved, Sorted, Valid, Active, took it |
| quiet | Draft, Cancelled, Not active, Declined, Deleted, From your Google Sheet, said no |

## Office shell (`src/app/office/layout.tsx`)

Rebuilt in Phase 12 task 12A.2 (`docs/office-v2.md` 3.1). Rendered only when an office session
exists (`getOfficeSession()`), so `/office/login` and `/office/l` stay plain. Display only: every
page and action still checks access itself. Next keeps the layout (doesn't redraw it) as you move
between office pages, so if the session ends on the server (access turned off, "Log out on every
device", or it ran out), the next click lands on `/office/login` with the old frame still around
it. The frame (`office-frame.tsx`) then asks the server to redraw the page once
(`router.refresh()`), which drops it; it only does this on arriving at `/office/login` or
`/office/l` from another page, so it can't repeat, and with a live session the login page sends
you on to `/office` as before.

- **Top bar** (`office-frame.tsx`), below 1024px, pinned to the top: "Menu", the firm's name (no
  reference portal's logo or colours; on logged-in office pages the firm's brand bar is hidden,
  since this bar names the firm), the moon/sun button
  (`theme-button.tsx`: sets the `sd-theme` cookie and `data-theme` at once; its name says what it
  switches to, and the same words show beside it on hover and keyboard focus), and the account
  button (initials, then the name and role from 640px). The account menu is a native popover
  (`popover`, opened by the button's `popovertarget`): no role of its own, Escape and a tap
  elsewhere close it, and it works before the page's scripts load. It holds the name and role,
  "How-to guide" and the office's one "Log out".
- **Desktop (1024px and wider; Phase 20):** no top bar. The same `<header>` sits at the menu's
  foot, fixed at the bottom left: the pay week (Phase 21: the week and its dates, then the pay
  day, two lines that each stay whole), the account button (initials, name and role; its menu
  opens above it) and the moon/sun button, those two on a white row. The menu is a 248px sidebar
  that stays in view, with the firm at its top (its initial on its own colour, then its name).
  Phase 21: the menu and the page share the warm off-white ground (no sheet), the page's white
  cards on it, content up to 1152px wide. Forms stay within 672px; lists, tables and reports use
  the full width.
- **Phone and tablet:** "Menu" opens the same menu as a drawer from the left: a native `<dialog>`
  opened with `showModal()`, so the page behind it is shut off and dimmed (`scrim` at half
  strength). Escape, a tap on the dimmed page, "Close menu" or choosing a link closes it, and the
  browser puts the focus back on "Menu". The one `<nav>` moves into the drawer while it's open and
  back to the (hidden) sidebar when it shuts, so a page never has two, and a shut drawer holds
  nothing that can be tabbed to. (A `<dialog>` can't be the desktop sidebar too: shown by CSS,
  it's still announced as a dialog.) "Menu" and the theme button stay disabled until the page is
  ready (`useHydrated`), so a tap is never lost; the drawer also shuts on moving to another page
  and on widening the window to 1024px.
- **Menu groups** (`office-menu.ts`; labels are words, not headings; links only appear for roles
  that can open them, from `canAccess`):

  | Group | Links |
  |---|---|
  | (first, no label: Phase 20) | Dashboard, Needs attention (in place of the bell) |
  | Today | Events & sessions, Cancellations, Enquiries |
  | Pay | Pay dashboard, Pay queries, Import pay records |
  | People | Casuals, Strikes, Notice report |
  | Admin and records (folded) | Action log, Pilot metrics, Office team, Settings, Integrations, Data requests |
  | Help | How-to guide |

- The current page's link has `aria-current="page"`, on a grey pill (Phase 21; a white pill
  lifted off the menu in Phase 20, a pale tint of the firm's colour before it) with its icon in
  ink. Every row (and the folded group's button) is 44px tall, in the drawer too. Group labels
  are small grey words. On a page inside a section, the section's link
  looks the same but has `aria-current="true"` (it isn't the page you're on): a shift or a new
  shift marks Events & sessions, the offer page marks Dashboard, a casual marks Casuals, a
  cancellation's record marks Cancellations, a worker's data page marks Data requests.
- **Badges:** a link can carry a count, one style (Phase 21; Dylan's brief: "one badge style
  (grey, red only for urgent)"): the office's grey count pill (`countPill`, the `count` token),
  the same as beside a section's heading, on the page you're on's grey pill too. Whether it needs
  you is in its words; no count in the menu is an urgent one, so none is red (the dashboard's
  urgent places' count is: `countUrgent`, the same pill in red).
  The number sits inside the link but hidden from screen readers, and its words ("3 waiting")
  follow the link as visually hidden text, so the link's name stays exactly its label. Needs attention's (Phase 20) is the Dashboard's Needs attention count:
  "{12} to deal with", and "50+" when a list stopped at 50.
- **Session keeper:** in the frame, so a session is kept alive on every office page.
- **Test rules the shell must keep:** the menu is built from plain links (no list items, headings,
  regions, `status`, `note` or `menu` roles, fieldsets or `<details>`: Phase 18's folded "Admin and
  records" is a button that shows or hides its links, and `menuLink()` opens it); it sits outside
  `<main>`; link names stay word for word; nothing else on a page may repeat a menu link's name (the account
  menu's "How-to guide" is hidden until opened); its `aria-label` ("Office menu") contains no
  field label used on a page. The browser tests reach menu links through `menuLink(page, name)`
  and "Log out" through `accountMenu(page)` (`tests/e2e/fixtures.ts`).

## Page patterns

- **Page header:** the way back on a record's own page, the `<h1>`, a meta line (status chips,
  times, counts), the intro sentence, then actions (the main one first). Space, then the content
  (no label above the heading and no divider: Phase 17).
- **Section:** `<section aria-labelledby>` with an `<h2>` and, where useful, a count. The count
  sits beside the `<h2>` (both in one row), never inside it, on staff and office pages alike, so
  the section's name is only its heading's words ("Coming up", not "Coming up 3"). 40px between
  sections on office pages, 32px on staff pages.
- **Lists:** a `<ul>` or `<ol>` whose bullets are styled away (Tailwind's default) gets
  `role="list"`, because Safari stops announcing it as a list otherwise. Lists that keep their
  bullets (`list-disc`) don't need it. `tests/unit/ui.office-pages.test.ts` and
  `tests/unit/ui.staff-pages.test.ts` hold every office and staff file to this, and every page to
  opening with `PageHeader` (the login pages and error pages with their one `<h1>`). An alert that
  is a list puts `role="alert"` on a box around it, so the list keeps its own role.
- **Action card:** for items with buttons (urgent shifts, requests, bookings to check, pay query
  groups). A card, status chip on the first line, the title link, meta lines, then the
  actions with the main one first.
- **Compact row:** for read-only or repeated items (gaps, who worked, shifts list, cancellations,
  log, history, offers). Divided rows inside one card, one line on desktop, two on phone.
- **Report table:** scrolls sideways inside a labelled region on small screens, numbers right
  aligned. A table whose column headings stay in view (sticky) pads the top of its scroll area
  (`scroll-pt-12`, the notice report), so a link scrolled to the top edge, for example by moving
  to it with the keyboard, never sits under the headings.
- **One shift:** "Offer to someone" is the header's main (dark) button only while the shift can
  still be offered (open, a place free and not started: the offer page's own rule); otherwise it's
  an "other" button.
- **Imports** (shifts and pay records): one card with the same layout and the same answer box as
  the shift forms. The next step is always the dark button: "Check the file", then "Import these
  …", then the link on ("See the shifts", "Go to pay queries").
- **Dashboard** (12E.1; "Today" until then; laid out again in Phase 17): four counts at the top in
  one strip split by hairlines, each a link to its filtered list (label, number, line), the first
  ("Urgent shifts not filled") with its number in red when there are some; then the sections,
  each a heading with a muted hint under it, what needs someone first: from 1280px a main column
  (urgent shifts not filled, a card per event; then Needs attention, its parts as h3s with a count
  chip) beside a 384px column (the latest cancellations, the latest enquiries), one column below
  that; then showing to casuals across the page, a table with a row per event and its switch.
  A section that can't load shows its own error and the rest of the page still shows. The bell in
  the top bar counts Needs attention's items and links to it.

## Forms wait for the page

Every field a client component controls (its value is in React state) is disabled until the page
is ready (`useHydrated`, `src/app/use-hydrated.ts`), like that form's buttons, so nothing typed
before then is lost when React takes over the page. The same goes for a field that only sends its
changes to React state (`onChange`), like the import pages' file pickers: a file chosen before
then would be lost. A field already locked for another reason keeps that look until the page is
ready (the shift page's "Edit this shift" fields, which lock while people are booked, look locked
for that moment too). The login forms' fields aren't controlled and their forms work before the
page is ready, so they stay on.

`tests/unit/forms.hydration.test.ts` holds this. It reads every `"use client"` file under
`src/app` and fails, with the file, line and tag, on a controlled field with no `disabled`, a
`disabled` that doesn't depend on `useHydrated()`, a file that never calls `useHydrated()`, or
props spread onto a field (hidden, submit, button, reset and image inputs are skipped). It also
renders seven forms on the server and checks that every field there is disabled.

## Staff pages

Mobile first, 448px wide. Keep the big buttons. My shifts: the Upcoming / Past 30 days switch looks
like a switch (not like a main button); "See open shifts" is always on the page; "Help" leads to
`/help`. Destructive steps ("Cancel this shift", "Confirm cancellation") look destructive. Section
headings and spacing are the same on every staff page.

## Guides

- `/office/guide` ("How-to guide" in the menu): how to use the office, in the order of a working
  day, showing only the parts the user's role can open.
- `/help` (worker side): how it works, in plain words, checked by
  `tests/unit/copy.plain-language.test.ts`. It opens with `PageHeader` like every staff page.
- Contents ("On this page"): below 1280px, one card of divided rows before the guide, each link
  with an arrow (the shared `chevron` on `/office/guide`), the same on both pages. From 1280px the
  office guide's contents are a rail beside it, with no arrows.
