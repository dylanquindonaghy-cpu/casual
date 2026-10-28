# UI design system

How every screen looks and is laid out. Added 2026-10-05 (Phase 11) at Dylan's request: "make it a
lot easier to see and understand where everything is". The newest look is first ("Phase 24");
the sections after it are the earlier phases, kept for their reasons where they still stand.
Words on screens still come from `docs/screens.md`; this file covers layout, hierarchy, colour
and components only.

Principles, in order:

1. **You always know where you are.** Every office page sits in one shell with the same menu, the
   current page marked. Every page opens with a header that names it.
2. **What needs doing comes first.** Things that need action are at the top, counted, and marked
   with a status word in a colour. Read-only lists are compact.
3. **One main action per card or form.** Buttons look like what they do: main, other, or
   destructive.
4. **Colour is never the only signal.** Every coloured status carries its word. Contrast meets
   WCAG AA (text 4.5:1, borders and controls 3:1).
5. **Glass, and nothing else for decoration** (Phase 24, Dylan's round 7). Sections, buttons and
   what floats are translucent glass over one soft pastel wash, in the office and the casual app
   alike (see "Phase 24"); no grain, glows, coloured shadows or images. Motion only to show what
   changed, as Phase 18's spec (below), and press feedback. The firm's colour tints the one main
   button and marks where you are, never a status. One face, Geist, for every word, headline and
   number (keys and secrets on Integrations keep the system's mono). Phase 23's flat white cards
   and the office's own colours and face are gone.
6. **Works without JavaScript** where pages already do (server-action forms, `<details>`
   confirmations, GET filter forms, anchor links).

## Phase 24: Liquid Glass

Dylan, on round 6 of the Design canvas (2026-10-26): "this is almost perfect but not apple glass
enough compare to these references https://liquidglassdesign.com/ it should be kinda translucent
buttoms sections icon backgrounds etc". Round 7 ("more glass") followed, and then: "keep round 7
and build it into the app", with "Round 7 exactly, layout too". `docs/mockups/phase-24/` keeps
round 7's boards in light and dark, its stylesheets, and in words what each page holds and where
the build differs. This section is the system (task 24.1); the pages take its parts in 24.2 to
24.6. Phase 21's spacing steps, states and shared parts stand where this doesn't change them.

- **One look for the office and the casual app.** The office has no colours of its own any more
  (its block in `globals.css` sets only its sizes): both take the same tokens, the same glass and
  the same face. Phase 23's flat white cards, the office's sky button and Plus Jakarta Sans are
  gone.
- **The wash.** Four soft lights fixed behind every page, under everything (`body::before`): in
  light, pale blue top left, lavender top right, peach low in the middle, mint bottom left, on a
  cool off-white (`canvas`); in dark, blue, purple, orange and teal glows on near-black. No shell
  paints over it: the office's frame and the casual app's bar are see-through, and the office's
  page has no card of its own (its sections are glass on the wash).
- **The glass** (`globals.css`, `@utility`):
  - `glass`: a section (a card, a list, a table, a row of tabs). Frosted: what's behind it blurred
    24px and saturated 1.8 times, a lit rim and a soft drop. `card`, `rows`, `table.wrap`,
    `staffCard`, `staffRows`, `tabs` and the login cards (from 640px) are glass.
  - `glass-float`: what floats over the page, the strongest glass: the office's top bar, its
    account menu and drawer, the "…" menus, a chart's panel, the confirmation at the foot; the
    casual app's tab bar, Take shift's bar and the sheet. In Chrome the page behind it bends a
    little too: an SVG
    displacement (`#lg-refract`, `src/app/glass-refraction.tsx`) in front of the blur, switched on
    (`.rf` on `<html>`) only where the browser says it's Chromium, because Safari and Firefox
    would drop the whole backdrop filter, frost included. Its region is fixed and large
    (`userSpaceOnUse`): measured from the element, it missed most of a bar and dropped the blur.
  - A section's frost makes it a layer of its own, so a "…" menu opened inside one would sit
    under the sections after it (and they'd take its clicks): a section with a menu open comes
    forward (`glass`'s `:has(details[open])`, a z-index for a grid's or a row's item). Anything
    placed `fixed` stays outside glass, or it would be placed against the section, not the
    window (the toast and a chart's tooltip are).
  - `glass-tile` and `glass-button`: the parts inside a section, clear glass that doesn't blur
    again (a white gradient with a lit rim): a date tile, a field, an inner card, a choice; a
    clear button, a count.
  - `glass-tint`: the one main button, tinted glass in the firm's own colour (`tint` at the top,
    `tint-shade` at the foot), with its words. `btn.primary` and `staffBtn.primary`.
  - The statuses' tints are tinted glass: `urgent-soft`, `attention-soft`, `wait-soft`,
    `done-soft` and `quiet-soft` (a chip, a notice, a second step, an answer slip) at 72%, and the
    tiles `urgent-tile`, `hivis`, `wait-tile` and `done-tile` (an urgent date tile, a coloured
    count, the For you tiles) at 80%, each solid in the fallbacks; a chip and a coloured count
    carry the lit rim (`glass-rim`), as round 7's tags. Their words are checked over every ground
    like the rest.
  - `glass-track` and `lens`: a switch's or a row of tabs' track, and the chosen option on it,
    a lens of bright glass (`tabCurrent`, the Shifts tab's switch).
  - `scroll-edge`: a soft frosted edge that fades in behind a bar that stays at the top once the
    page scrolls under it (24.2 and 24.6 put it on the bars).
  - Under a press, glass swells a little and brightens, then springs back (`press-glass`: 1.04,
    brightness 1.06); cards, rows and words-only actions still dip (`press`).
- **The fallbacks.** With less transparency or more contrast asked for (`prefers-reduced-
  transparency`, `prefers-contrast: more`), every see-through ground is solid, nothing blurs and
  the wash goes, in light and both darks (Apple's own fallback for Liquid Glass). A browser that
  can't blur gets the same solid surfaces, with the wash still round them. Forced colours give
  each glass part a system-coloured edge; with reduced motion nothing swells, dips or slides.
- **Contrast over glass.** A word on glass sits on whatever shows through, so a pair is checked
  over every ground the glass can show (`src/lib/tenancy/glass-grounds.ts`,
  `tests/helpers/theme-css.ts`): a section over each of 15 points of the wash (its base, its four
  lights, and halfway between each two), the wash saturated as the browser does it (measured in
  Chromium: the Filter Effects matrix on the screen's own values, to the unit), and a section over
  what floats; what floats over the wash; a tile's and a clear button's gradients, both ends, the
  button also under the pointer and pressed (a CSS filter brightens the control's own words and
  white fill, not the page behind it); the lens on its track; the main button, both ends,
  brightened too. In six looks: light and dark, each also solid and with no blur
  (`tests/unit/ui.contrast.test.ts`). Every word at least 4.5:1, every edge, mark and control
  3:1. Two values changed for it: in dark, a clear button under the pointer and pressed is only
  5% and 8% lighter (14% and 18% left grey and red words at 3.2:1 and 2.9:1 pressed); a switch's
  knob is near-black in dark, where the on track is near-white ink.
- **The firm's colour on glass.** `firmPalette` works it out against every one of those grounds
  (and the main button's words on it brightened), so some firms' colours come out a little
  darker as words and on the button than as they are: Acme's blue `#1d4ed8` becomes `#1a45bf`,
  Northline's teal `#0f766e` becomes `#0c5c56` (its own pale tint over the wash's mint corner
  read under 4.5:1). Their bands (the pass, the firm's initial) keep the colour as it is. Worked
  out from numbers once per ground (0.55ms a palette; 14ms through #rrggbb text), as the root
  layout does on every page.
- **Depth.** A glass's rim and drop, never a hard shadow. The depth tokens are variables
  (`--shadow-lift: var(--glass-drop-sm)` and so on) because Tailwind writes a token's value into
  its class when it builds; the variables change with the theme. `box-shadow` is written only in
  the glass's own parts and the file button; the classes' depth tokens only where
  `tests/unit/ui.glass.test.ts` pins them (the pass, the For you tiles, the strip's days, a
  switch's knob, and a chart's tooltip, which is solid ink).
- **Corners.** A page-wide card and the menu card 24px (`rounded-card`), sections 22px
  (`rounded-inner`), rows, fields and small boxes 14px (`rounded-row`), pills round.
- **Type.** Geist for every word, headline and number, in the office and the casual app
  (`@fontsource-variable/geist` 5.3.0, SIL Open Font License 1.1, through `next/font/local` in
  `src/app/fonts.ts`: latin, and latin-ext fetched only for a name such as Łukasz). A page's
  headline medium in the casual app and semibold in the office (`text-title`); the sign figures
  and big numbers semibold with fixed-width digits (`font-sign`, `font-stat`); the greetings
  medium (`font-greet`; Instrument Serif until now). Instrument Sans and Serif and Plus Jakarta
  Sans are removed. Round 7's sizes: the casual app's 12, 14, 16, 18, 20, 28 and 44px; the
  office's 12, 13, 15, 17, 20, 30 and 40px (a page's headline 30px, a section's 17px, a card's
  title 15px). Keys and secrets on Integrations keep the system's mono.
- **Where the build differs from round 7.** The mock-up's labels were tuned by eye on its own
  wash; the app's colours are tuned against every point of it (above), so a few greys and the
  firm's colours are a shade darker than on the boards. The mock-up's tab bar's lens that
  shrinks as the page scrolls comes with the casual app's pages (24.6).

The glass's own values (`:root` and the dark blocks; `glass-grounds.ts` holds the same numbers and
`tests/unit/ui.glass.test.ts` checks they agree):

| Variable | Light | Dark | What |
|---|---|---|---|
| `--glass-filter` / `--float-filter` / `--edge-filter` | `blur(24px) saturate(1.8)` / `blur(18px) saturate(1.8)` / `blur(10px) saturate(1.6)` | the same | A section's frost, what floats', the top bar's edge |
| `--tile-top` → `--tile-bottom` | `rgb(255 255 255 / 0.72)` → `rgb(255 255 255 / 0.44)` | `rgb(255 255 255 / 0.09)` → `rgb(255 255 255 / 0.04)` | A tile's gradient (`glass-tile`) |
| `--button-top` → `--button-bottom` | `rgb(255 255 255 / 0.8)` → `rgb(255 255 255 / 0.4)` | `rgb(255 255 255 / 0.12)` → `rgb(255 255 255 / 0.04)` | A clear button's gradient (`glass-button`) |
| `--wash-a` / `--wash-b` / `--wash-c` / `--wash-d` | `rgb(201 216 255 / 1)` / `rgb(230 214 255 / 1)` / `rgb(255 226 201 / 1)` / `rgb(205 243 232 / 1)` | `rgb(37 99 235 / 0.42)` / `rgb(124 58 237 / 0.34)` / `rgb(234 88 12 / 0.2)` / `rgb(13 148 136 / 0.26)` | The wash's four lights |
| `--glass-rim`, `--button-rim`, `--tint-rim`, `--glass-drop`, `--glass-drop-sm`, `--glass-sunk`, `--float-shadow`, `--lens-shadow` | lit white edges, soft cool drops | fainter edges, deeper black drops | The rims and drops (the values in `globals.css`) |

### The dashboard, round 7 (24.3)

`src/app/office/dashboard-view.tsx` and `./dashboard/` (`docs/screens.md` "The dashboard, round 7").
The page is a container (`@container`), so its layout follows the room the rail leaves, not the
window:

- **Head:** "Dashboard" in the office's title (`text-title`, 30px semibold), its line 13px grey
  under it; the track (the shared `tabs`, 44px pills, the current one under the lens, its count
  in the firm's blue `bg-accent`) beside it from 48rem of page, under it before.
- **Chart and detail card:** one column; from 56rem of page the chart beside a 340px card
  (21.25rem), 372px (23.25rem) from 72rem, as the mock-up's 340/372. Both glass sections (22px),
  24px inside from 36rem of page, 16px on a phone (the mock-up's 16px under 760px).
- **The chart:** a 1.5rem axis, 14 columns at least 176px tall (`min-h-44`, filling the section
  beside the card), bars 55% of a column up to 22px, 4px round at their top (`rounded-t-mark`, the
  office's only `mark` corners, with the key's swatches); ink (`mark-open`) under blue
  (`mark-wait`); gridlines `mark-grid` at the top and half, the base `mark-base`. Day numbers 12px,
  today's in an ink disc. A bar's tip is solid ink, 13px, 14px round, 8px above the plot with an
  8px bridge; no shadow.
- **The detail card:** its date tile 48px (red tile when urgent, clear glass otherwise), the role
  20px semibold with the shared Urgent chip, its rows glass tiles 14px round, the two figures in
  `font-stat` 30px (red under 2 days), the line amber (`attention-soft`) or red (`urgent-soft`)
  with the glass rim; "Offer to someone" the main button (tinted glass) and "Open the shift"
  clear glass, side by side, growing to the card's width and wrapping before they'd squash; "…"
  a 44px clear glass circle at its top right, its menu floating down over the card.
- **The board:** four columns from 64rem of page, two from 36rem, one on a phone; each a glass
  section 16px inside, a leaf 18px in its colour (`mark-open`, `mark-wait`, `mark-done`,
  `attention`), its title 17px semibold and a clear glass count. Cards are glass tiles 14px round,
  12px across and 16px down inside, 8px apart; the picked one clear glass with a 2px ink outline;
  a date tile 40 × 44px (clear glass; red when urgent), a 36px round clear glass paper plane at the
  top right (12px in), chips 28px pills 8px inside with 14px icons (red, green or clear glass),
  three to a line in a column a quarter of a 1280px window. Cards dip when pressed (`press`).
- **The offer panel:** a `<dialog>` in the floating glass, 24px round (`rounded-card`, as the
  rail: it floats beside the page), from the right on a laptop (448px, 12px from the window's
  edges) and from the foot on a phone (its top corners round, up to 86% of the window), over the
  scrim; it slides in (200ms). People are glass tiles with a 40px initials disc; "Send offer" a
  clear glass pill.

### Events & sessions, Enquiries and Casuals, round 7 (24.4)

`docs/screens.md` "Events & sessions, Enquiries and Casuals, round 7". The filters on all three are
the shared `tabs`; each count a disc (`tabCount`: clear glass, the current tab's in the accent).

- **Events & sessions:** the page a container; the filters and their line on one row, wrapping on
  a phone. Event cards are glass sections (22px), 16px inside, 24px from a 36rem card; two columns
  from 56rem of page, their tops level in each row (`items-start`). The heading 20px semibold, its
  line 14px grey; the switch 48 × 28px at the top right, green on (`done`) and grey off, its knob
  solid with the soft lift. Sessions are glass tiles 14px round, 16px across and 12px down inside,
  8px apart; from a 30rem card their meter, pay and "…" sit at the right of the role and when,
  under them before. Requirement chips 24px clear glass pills; the meter 112px wide, 6px tall, ink
  on the quiet tint, under "3/4 filled"; "…" a 44px clear glass circle, its menu floating under
  it (its right edge with the button's, at most 80% of the window). "1 filled session" folds the
  full ones (a 44px row with a chevron that turns). "View sessions" with an arrow.
- **Enquiries:** from 1024px (the window's, as the pick follows it) a grid of a 26rem list and the
  pane, 24px apart, tops level. The list one glass section with rows 14px round, 16px inside, 4px
  apart: the icon in a 24px column, the name and the time, the chip, their words; the chosen row
  clear glass with a 2px ink outline (from 1024px only). The pane a glass section 24px inside: the
  title 24px semibold, the casual's page a clear glass pill at its top right; the conversation a
  clear-glass panel 16px inside, bubbles 16px across and 12px down, at most 85% wide, theirs clear
  glass, ours ink with its own words (light in dark); the reply box a glass tile with the field,
  then the line and the two buttons (together at the right, wrapping as one).
- **Casuals:** the search a 48px clear-glass pill, 320px from 640px (the row's width on a phone),
  its field without a ring of its own (the pill takes the ring); its matches a floating glass
  panel under it. The table one glass section, no lines between rows, heads 14px grey, cells 12px
  down; initials a 40px disc in the waiting tint with the rim; valid qualifications plain 14px
  ink, the rest the shared chips; strikes red and semibold when not 0. A phone's cards are glass
  sections.

## Phase 23: the office's look, round 3

Replaced by Phase 24 (above), kept for its reasons where they still stand (its spacing, chips,
counts and charts' rules). Since then the office takes the app's tokens, so its tables below are
history; `tests/unit/ui.flat.test.ts` became `ui.glass.test.ts`, and the office's font file
(`src/app/office/office-fonts.ts`) is gone.

Dylan, on round 2 live (2026-10-23): "i told you to remove the gradients and the colours are still
wrong what your making is like 2008 apple notes app look it needs to be modern these are your last
references" (two flat admin dashboards, dark and light). The round 3 mock-up
(`docs/mockups/phase-23/mockup.html`) was approved the same day ("looks good"), then with its six
charts and their panels ("go build it"). Phase 21's system (below) stands where this doesn't change
it: its spacing steps, states and shared parts. The table at the end of this section has the
office's values now (`tests/unit/ui.office-system.test.ts` checks it against `globals.css` both
ways; `tests/unit/ui.contrast.test.ts` every pair in both themes).

- **Surfaces, flat.** A light grey ground (`canvas`), and on it the top bar, the menu card and the
  page card, all white (`card`; `sheet` is the same white) with a 1px hairline (`line`); in dark a
  near-black ground with dark grey cards. Inside the white page card every card, list, table,
  answer slip, notice and code box has the same hairline, or white on white would vanish. Nothing
  has depth at rest: no shadow on a card, a row, a button or the page. What floats over the page
  takes the one soft overlay shadow (`shadow-float`): the account menu, the drawer, the "…" menus
  (a shift's and a session's), the toast, a chart's tooltip and its panel, and nothing else
  (`tests/unit/ui.flat.test.ts` holds each file's use). Tailwind writes a shadow token's value
  into its class when it builds, so a value redefined for dark would never reach it: the token is
  `--shadow-float: var(--overlay)`, and `--overlay` has its own value in light and in both dark
  blocks (darker in dark, with a faint light ring).
- **Corners.** The page card and the menu card 28px (`rounded-card`); the cards, lists, tables and
  the board inside a page 22px (`rounded-inner`, and the page card on a phone); rows, fields,
  tiles and small boxes 14px (`rounded-row`); buttons, chips, pills and tabs round
  (`rounded-full`); a chart's bar 4px at its data end (`rounded-mark`, the dashboard's charts
  only). Spacing stays on the office's steps (4, 8, 12, 16, 24, 32 and 48px): the
  mock-up's in-between values are snapped to them.
- **Colour.** Cool slate greys (blue a touch above green above red, close to grey in dark), not
  round 2's warm ones. One sky blue for the one main button of a screen (`accent`, with
  near-black words, `on-accent`; lighter under the pointer, darker pressed); the other buttons
  are white pills with a grey edge (`button`, `button-line`) that stays under the pointer. The
  firm's own colour stays on its mark in the top bar (`brand-bar`), never on a button. In the
  office `brand` is the sky's pressed shade in light (`#0284c7`), because the sky itself is
  2.77:1 on white and a control's edge needs 3:1; in dark it is the sky. Nothing in the office
  paints with it now (the events board's today and the login link page's button take the sky,
  `accent`, through their `office:` classes); the value is kept so anything shared that does
  still reads at 3:1. Red, amber, blue and green only in tinted chips, counts
  and the charts' marks: red to do now, amber needs you, blue waiting on someone else, green
  done, grey fine.
- **Chips and counts.** A chip is a borderless tinted pill at least 28px tall in the office
  (`chip.base`'s `office:` values; the casual app's chips keep their edge), its word in the
  tint's dark words, with its icon. A new blue tone, `wait`, is waiting on someone else, never
  on you (an hourglass; `StatusChip tone="wait"`). Every count is a flat tinted pill with no edge
  (`count`, `countNeeds` amber, `countWaiting` blue, `countUrgent` red).
- **The charts' marks** (`mark-urgent`, `mark-open`, `mark-wait`, `mark-done`, `mark-calm`, with
  `mark-grid` and `mark-base` for the grid and the baseline). Red, blue and green reach 3:1 on the
  card in both themes; amber and grey are under 3:1 on white by design (the set is told apart
  with colour blindness), so they never stand alone: each bar carries its number, each chart its
  legend, and its Numbers table each mark's row in words. In dark every mark reaches 3:1.
- **Type.** Plus Jakarta Sans for every word, headline and number, self-hosted from its npm
  package (`@fontsource-variable/plus-jakarta-sans` 5.3.0, SIL Open Font License) in
  `src/app/office/office-fonts.ts`: one variable face, 200 to 800, latin and latin-ext (fetched
  only for a name such as Łukasz), so only office pages fetch it. A page's headline extrabold
  (`text-title`: 800, -0.025em, 28px); section headings bold (`h2`'s `office:font-bold`); the
  big numbers extrabold with fixed-width digits, a little tighter (`font-stat`: 800,
  tabular-nums, -0.03em). The dashboard's greeting is in the same face (no display serif:
  `font-display` is gone). Keys and secrets on Integrations keep the system's mono (`font-mono`,
  `codeBox`), the one exception, so O and 0, l and 1 differ. DM Sans, DM Mono and Newsreader are
  removed. The same seven sizes.
- **Shared parts** (`src/app/ui/classes.ts`). The office's button base has no depth; `btn.primary`
  sky; `btn.secondary` and `btn.danger` white with their grey edge; `tabs`, `tab` and
  `tabCurrent` for the "Show" tabs and the events board's filters (a grey track with a hairline,
  the current tab a white pill with its hairline, 44px; never the sky button); `field` white with
  a 3:1 edge (`line-strong`), darker under the pointer, set in no more; `confirmStep` and
  `checkStep` a tint with its edge; `card`, `rows` and `table.wrap` white with the hairline, 22px
  round (a table's headings on white, for a sticky one); `officeLoginCard` with its hairline;
  `notice` (an amber wash with its edge: what the AI or the voicemail line did, what a key will
  show only once); `codeBox` (a key or secret shown once); `resultBox`
  (`src/app/office/shifts/shift-tones.ts`: an answer, a pale grey slip with its hairline).
- **Motion.** Everything you press still dips to 97% and springs back (`press`, Phase 22); nothing
  lifts under the pointer; the menu's pill may still slide (`slide`).
- **The shell** (from the mock-up; "Office shell" below has the details that stand): a full-width
  white top bar at every width with a bottom hairline, the menu in its own white card from 1024px
  with its groups' names in small capitals (`ink-faint`, by CSS only), the current row a pale
  blue pill (`pill`), and the page in another white card (`#main > div`).
- **Where the office differs from the mock-up.** `brand` in light (above); a field's edge is
  `line-strong` (3:1 on the ground and a card), not the mock-up's pale grey (1.5:1); the
  mock-up's in-between spacing is snapped to the office's steps; the type scale keeps its seven
  steps.

| Token (office) | Light | Dark | Use in the office |
|---|---|---|---|
| `ink` / `ink-muted` / `ink-faint` | `#0f1728` / `#475467` / `#667085` | `#f2f4f7` / `#a3acb9` / `#8a94a6` | Words; grey words; the faintest grey (small capitals over the menu's groups, a chart's ticks: on white only) |
| `ink-hover` / `on-ink` / `ink-press` | `#1d2939` / `#ffffff` / `#000000` | `#ffffff` / `#0f1728` / `#ffffff` | An ink fill (the toast, a chart's "now" day) under the pointer, its words, pressed |
| `line` / `line-strong` | `#e4e7ec` / `#7d8797` | `#262b33` / `#6b7585` | The hairline round every white surface and between rows; a field's edge (3:1 on the ground and a card) |
| `canvas` / `panel` | `#f2f4f7` / `#f2f4f7` | `#0c0e12` / `#0c0e12` | The ground under the top bar, the menu card and the page card |
| `card` / `sheet` | `#ffffff` / `#ffffff` | `#15181d` / `#15181d` | The top bar, the menu card, the page card, and every card, list, table and box in it |
| `raised` / `quiet-soft` / `active` | `#f6f7f9` / `#f6f7f9` / `#f6f7f9` | `#1c2027` / `#1c2027` / `#1c2027` | A tab track, a skeleton's bars, hover on white rows; a closed chip, an answer slip; a menu row under the pointer |
| `pill` / `count` | `#e6f1fb` / `#eef0f3` | `#232830` / `#232830` | The menu's current row (a pale blue pill); the grey count pill |
| `button` / `button-line` / `button-hover` / `button-press` | `#ffffff` / `#d0d5dd` / `#f6f7f9` / `#eaecf0` | `#15181d` / `#3a404b` / `#1c2027` / `#232830` | Any other button: a white pill with its grey edge, under the pointer, pressed |
| `accent` / `accent-hover` / `accent-press` / `on-accent` | `#0ea5e9` / `#38bdf8` / `#0284c7` / `#06131f` | `#7dd3fc` / `#a5e1fd` / `#38bdf8` / `#06131f` | The one main button of a screen (the sky), under the pointer, pressed; its near-black words |
| `brand` / `on-brand` / `brand-ink` | `#0284c7` / `#06131f` / `#0f1728` | `#7dd3fc` / `#06131f` / `#f2f4f7` | The sky as a control (its pressed shade in light, for 3:1 on white), for any shared part that still uses `brand` in the office (none paints with it now); words in ink. The firm's colour is on its mark only |
| `switch-off` / `scrim` | `#667085` / `#101828` | `#8a94a6` / `#000000` | A switch that's off (3.5:1); behind the drawer and a chart's panel |
| `urgent` / `urgent-ink` / `urgent-soft` / `urgent-tile` | `#b42318` / `#912018` / `#fdeceb` / `#fbdcd9` | `#f97066` / `#fca5a5` / `#2e1415` / `#3a1a1b` | Red words; the urgent chip's words; its tint; an urgent tile |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#d92d20` / `#b42318` / `#ffffff` | `#f97066` / `#fb8a80` / `#06131f` | The final destructive button, under the pointer, its words |
| `attention` / `attention-ink` / `attention-soft` | `#b54708` / `#93370d` / `#fdf1e0` | `#fdb022` / `#fcd34d` / `#2c1f0c` | Amber, needs you: an icon; a chip's and a notice's words; their tint |
| `hivis` / `on-hivis` | `#fdf1e0` / `#93370d` | `#2c1f0c` / `#fcd34d` | The amber count (Needs attention's) and its words |
| `wait-soft` / `wait-tile` / `wait-ink` | `#e5f3fc` / `#e5f3fc` / `#075985` | `#0f2635` / `#0f2635` / `#7dd3fc` | Blue, waiting on someone else: the `wait` chip's tint, the blue count, their words |
| `done` / `done-ink` / `done-soft` / `done-tile` | `#067647` / `#11733a` / `#e7f6ec` / `#d1f0dc` | `#47cd89` / `#6ee7a0` / `#10261a` / `#143322` | Green, done: a tick; a chip's words; its tint; a done tile |
| `done-fill` / `on-done` | `#067647` / `#ffffff` | `#47cd89` / `#06131f` | A done fill and its words |
| `quiet-ink` / `quiet-line` | `#475467` / `#d0d5dd` | `#a3acb9` / `#3a404b` | A closed chip's words; the grey step's edge |
| `urgent-line` / `attention-line` / `wait-line` / `done-line` | `#f9c9c4` / `#f6d7a8` / `#b9dff6` / `#b5e3c4` | `#5a2423` / `#5a4314` / `#1e4a66` / `#1f4d33` | A tint's 1px edge (a notice, a step), a shade darker (decorative: the words say it) |
| `mark-urgent` / `mark-open` / `mark-wait` / `mark-done` / `mark-calm` | `#d92d20` / `#f79009` / `#0284c7` / `#079455` / `#98a2b3` | `#f97066` / `#fdb022` / `#38bdf8` / `#47cd89` / `#667085` | The charts' marks: red to do now, amber needs you, blue waiting on someone else, green done, grey fine (amber and grey under 3:1 on white: each bar has its number, each chart its legend and Numbers table) |
| `mark-grid` / `mark-base` | `#eef0f3` / `#d0d5dd` | `#22262d` / `#3a404b` | A chart's grid lines and its baseline (hairlines) |

## Phase 22: the office's look, round 2

Dylan, on Phase 21 live (2026-10-22): "the use of colours it just looks very bland theres still no
depth to any of the individual sections and a tacky scroll wheel on the left side you've missed out
on shaders layers and depth this whole time i also asked for animations still none not ai slop just
subtle reactive on click responses". From his new references (dark admin dashboards: Dashdark X,
HITE EQ, notion>ision, PMD Digital, ovniscale) and the hilos direction he picked, a mock-up
(`docs/mockups/phase-22/mockup.html`), approved with one change: "remove the gradients theres no
need for that". Phase 21's system (below) stands where this doesn't change it: its spacing,
corners, states and shared parts. The table at the end of this section had round 2's values;
Phase 23 (above) replaced them, and its table has the office's values now.

- **Layers.** Four you can see: the window (`canvas`, a warm grey, the menu on it); the page as a
  sheet set into it (`sheet`, warm off-white, rounded and raised, `shadow-sheet`; below 1024px a
  sheet with rounded top corners under the top bar); white cards, lists and tables raised off the
  sheet (`shadow-soft`: a hairline ring, a lit top edge and its own fall; the edge white as in the
  mock-up, so it shows on the near-black buttons, at 18% on `raise`, and in dark, while on white
  it's white); and the rows, tiles and buttons raised off those (`shadow-raise`). What floats
  over the page (a menu, the account menu, a confirmation) takes `shadow-float`. Grooves are set in
  (`inset-shadow-sunk`): the week's bars, the urgent places' fill bars, the board's filter track
  and every field (`field`). On the other pages: Needs attention's parts are amber washes of
  raised white rows, as the dashboard's panels; the step before something destructive ("Yes,
  revoke it", "Yes, cancel …'s booking") is one red wash with its edge and `shadow-soft`
  (`confirmStep`), and before a change that takes nothing away ("Yes, make them an admin", "Yes,
  mark them as worked") the same in grey (`checkStep`); any other wash with an edge (a notice, a
  status, the rules' answer on a shift) has the same depth; an answer under a button is a white slip raised off its
  form (`resultBox`, and the login page's "You're logged out.").
- **Colour.** The dashboard's four cards in full flat colour (`urgent-card`, `attention-card`,
  `wait-card`, `done-card`; their words in `…-card-ink`, their numbers in `ink`), each with a 1px
  edge in its words' colour, a lit top edge and a shadow in its own colour (`shadow-tint`, with
  the card's `tint-…` utility in `globals.css`). Their panels' washes (`…-soft`), the tiles and
  the chips' edges are stronger than Phase 21's. In the menu a count takes its card's colour:
  amber when it needs you (`countNeeds`: Needs attention, enquiries, uploads), blue when it's
  waiting with someone else (`countWaiting`: pay queries with payroll). Other buttons are white
  pills raised off their card (`button`); the main one is still near-black. No gradients: the
  one the office keeps is the menu's edge fade, a mask rather than a colour.
- **Texture.** A fine grain (`grain`: a 200px noise tile the browser draws, black speckles in
  light and white in dark) over the four colour cards, and a fainter one (`grain-soft`) over the
  window, the page and the panels; fine diagonal lines (`stripes`) in the groove of a week day
  with no sessions. Dylan's HITE EQ reference.
- **Type.** DM Sans for every word (with its optical sizes), DM Mono for the big numbers
  (`font-stat`), Newsreader semibold for each page's headline (`text-title`, 28px; the
  dashboard's greeting `font-display`, 40px): hilos's own words and numbers faces and the closest
  free match to its serif, self-hosted from their npm packages (SIL Open Font License) in
  `src/app/office/office-fonts.ts`, so only office pages fetch them. The same seven sizes.
- **Motion that answers you.** Everything you can press dips to 97% at once and springs back when
  you let go (`press`: 90ms down, 300ms back on `ease-spring`, in place of `transition-colors`):
  every button, opener (`summary`) and switch; every link that isn't words (a row, a card, a pill,
  a tab, a contents row); and words with their own 44px target (`btn.link`, a page's way back:
  both `office:press`, as the casual app shares them and keeps Phase 20's look). A link inside a
  sentence or a line of text is words, and doesn't move (`office.look.spec.ts` checks every page
  by this rule);
  the dashboard's cards and panel rows lift 2px under the pointer; the menu's white pill slides to
  the link you pick as you pick it (`slide`); "Offer" shows a spinner in place of its word while
  the offer page opens; the "…" menu, the account menu and a session's menu grow out of their
  buttons (`animate-pop`); a card's jump lands with a ring that fades out round its section
  (`animate-landed`: the cards are plain links to `#…`, since Next's `<Link>` never sets
  `:target`); a week day shows its details over it under the pointer or on focus. Nothing moves
  on its own but a skeleton while its page is on its way (`animate-wait`, a slow fade in and
  out), and with reduced motion nothing dips, lifts or slides.
- **The menu.** No scrollbar: rows are 34px with a mouse from 1024px (44px for a thumb and always
  in the drawer), the firm (its initial and name) and you (the account button) sit above it, the
  how-to guide and the light/dark switch are rows of the account menu, and the pay week (D8) is a
  small line at its end. Every row of an admin's menu fits a 1280 × 640 window (the last row ends
  about 600px down); the pay week under them shows in a window about 690px tall or more, and is a
  scroll away below that (it's also in the dashboard's date line). In a shorter window, or with
  Admin and records open, the menu scrolls with no bar and fades at the edge that has more
  (`menu-scroll.tsx`, `scrollbar-none`, `fade-edges`), opening with the page you're on in view.
- **Where the office differs from the mock-up.** "Offer" opens the offer page (it never sent
  anything by itself), so it shows a spinner while that page opens rather than the mock-up's tick;
  the menu's rows keep the system's 4px gaps; corners stay 20px and 14px; the mock-up's light that
  followed the pointer was a gradient, so it went with the others.

| Token (office) | Light | Dark | Use in the office |
|---|---|---|---|
| `ink` / `ink-muted` / `ink-hover` / `on-ink` | `#1c1b18` / `#57544d` / `#34322d` / `#ffffff` | `#f2f1ee` / `#aaa79f` / `#dcdad5` / `#121211` | Words, grey words, an ink button under the pointer, words on ink |
| `line` / `line-strong` | `#e7e5e0` / `#837f77` | `#2b2c30` / `#77746d` | Hairlines; field and control borders (3:1 on the window, the page and a card) |
| `canvas` / `sheet` / `card` / `panel` | `#e7e5df` / `#f9f8f5` / `#ffffff` / `#e7e5df` | `#08090b` / `#111215` / `#1a1b1f` / `#08090b` | The window and the menu; the page, a sheet set into the window; cards, lists, tables and rows; the top bar and drawer |
| `raised` / `pill` | `#ebe9e4` / `#ffffff` | `#0f1012` / `#24252a` | Grooves, tracks and skeleton bars; the menu's current page (a white pill raised off the window) |
| `switch-off` / `scrim` | `#7b776f` / `#1c1b18` | `#807d76` / `#000000` | A switch that's off; behind the drawer |
| `brand` / `on-brand` / `brand-ink` | `#1c1b18` / `#ffffff` / `#1c1b18` | `#f2f1ee` / `#121211` / `#f2f1ee` | Ink: the firm's colour fills no office button |
| `urgent` / `urgent-soft` / `urgent-ink` / `urgent-tile` | `#b42318` / `#fdebe4` / `#7a2116` / `#fbdcd3` | `#ff8a7a` / `#1f1716` / `#ffc8bf` / `#3a1e1b` | Red words; the urgent wash; its dark words; the urgent tile and section chip |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#c4242a` / `#a51d22` / `#ffffff` | `#cf3a33` / `#b02e28` / `#ffffff` | Urgent bars, the date tile's band and pills; the final destructive button |
| `attention` / `attention-soft` / `attention-ink` | `#a15c07` / `#fdf3d3` / `#5e4106` | `#f0a742` / `#1e1b12` / `#f8dfa0` | Amber: an icon; Needs attention's panel; its dark words |
| `hivis` / `on-hivis` | `#f8e6ae` / `#5e4106` | `#362c12` / `#f8dfa0` | Needs attention's chip and menu count; "to mark" |
| `wait-tile` / `wait-ink` / `wait-soft` | `#d9e6fb` / `#1d3c6b` / `#e8f0fd` | `#1a2638` / `#c9dbf7` / `#141a26` | Blue: Waiting on others' chip and menu count, its words, its panel |
| `done` / `done-soft` / `done-ink` / `done-tile` | `#1f7a47` / `#e4f5e8` / `#17502f` / `#d3eedb` | `#5fd08b` / `#131c16` / `#bfeccd` / `#16291d` | Green: a tick; the Sorted panel; its words; its chip |
| `done-fill` / `on-done` | `#1f7a47` / `#ffffff` | `#1f7a47` / `#ffffff` | A done fill: the Sorted rows' ticks |
| `quiet-soft` / `quiet-ink` | `#f3f2ef` / `#4a4741` | `#222328` / `#d6d4cf` | Hover on white rows; a closed chip |
| `urgent-line` / `attention-line` / `wait-line` / `done-line` / `quiet-line` | `#f3c9bc` / `#ecd590` / `#bfd3f2` / `#b8e0c2` / `#dedbd5` | `#55302b` / `#54461f` / `#2c3d57` / `#27452f` / `#3a3b40` | Each wash's 1px edge and a chip's, a shade darker |
| `active` | `#ebeae6` | `#26272c` | Hover and pressed rows in the menu and the account menu |
| `count` | `#e3e1dc` | `#313238` | The grey count pill beside a section's heading (and a menu count that needs no one) |
| `button` / `button-line` / `button-hover` / `button-press` | `#ffffff` / `#ffffff` / `#f4f3ef` / `#ebe9e4` | `#26272c` / `#26272c` / `#2e2f35` / `#35363c` | Any other button: a white pill raised off its card (`shadow-raise`), at rest, under the pointer, pressed |
| `ink-press` | `#000000` | `#ffffff` | An ink button pressed |
| `urgent-card` / `urgent-card-ink` | `#f8a387` / `#45160a` | `#3d1f19` / `#ffd9cf` | The Urgent places card in full colour; its words |
| `attention-card` / `attention-card-ink` | `#f6d363` / `#3f2d02` | `#382d11` / `#fbecc4` | The Needs attention card; its words |
| `wait-card` / `wait-card-ink` | `#a6c8f4` / `#0d2a52` | `#1a2b4c` / `#d7e6ff` | The Waiting on others card; its words |
| `done-card` / `done-card-ink` | `#a7dbb1` / `#0e3519` | `#173823` / `#d4f5de` | The Sorted today card; its words |

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

Round 2 (Phase 22, above) changed its colours, faces, depth and motion: the office's values are in
Phase 22's table.

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
tokens. Since Phase 24 the grounds are glass, written `rgb(r g b / a)`: see "Phase 24" for the
glass and how every pair is checked over it (`tests/unit/ui.contrast.test.ts`). The office takes
the same tokens.

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` / `ink-muted` / `ink-faint` | `#17181a` / `#55585f` / `#5a5d64` | `#f3f4f6` / `#c4c5ca` / `#b9babf` | Words; grey words (labels, meta lines, a table's headings); the faintest (a group's name over the menu, a chart's ticks). Each reads at 4.5:1 on every point of the glass, in every look |
| `ink-hover` / `on-ink` / `ink-press` | `#2b2e33` / `#ffffff` / `#000000` | `#d4d6da` / `#0b0c0e` / `#ffffff` | An ink fill (a chart's tooltip and its "now" day, the firm bar's count) under the pointer, the words on it, pressed |
| `line` / `line-strong` | `rgb(16 24 40 / 0.08)` / `#6e737b` | `rgb(255 255 255 / 0.08)` / `#8a8e96` | A faint divider between rows (decorative); a field's or a switch's edge where one is drawn (3:1 on the glass) |
| `canvas` | `#eef1f8` | `#07080c` | The wash's base, under every page (its four lights over it: `--wash-a` to `--wash-d`, "Phase 24" above); words straight on the wash, such as a page's headline, read on every point of it |
| `card` / `sheet` | `rgb(255 255 255 / 0.46)` / `rgb(255 255 255 / 0.46)` | `rgb(26 27 34 / 0.46)` / `rgb(26 27 34 / 0.46)` | Glass: a section (a card, a list, a table, a row of tabs), frosted (`glass`) |
| `panel` | `rgb(255 255 255 / 0.78)` | `rgb(30 30 34 / 0.8)` | Glass: what floats over the page (the office's top bar, its menus, the drawer, a chart's panel; the casual app's tab bar, Take shift's bar, the sheet), the strongest (`glass-float`) |
| `raised` | `rgb(255 255 255 / 0.6)` | `rgb(255 255 255 / 0.07)` | Clear glass inside a section: a weekend's column, a bar's track, a skeleton's bars, a row under the pointer, the waiting plate |
| `track` / `pill` / `active` | `rgb(118 118 128 / 0.12)` / `rgb(255 255 255 / 0.92)` / `rgb(255 255 255 / 0.92)` | `rgb(118 118 128 / 0.18)` / `rgb(255 255 255 / 0.1)` / `rgb(255 255 255 / 0.1)` | A switch's track (`glass-track`); the lens on the chosen tab or option (`lens`); a checked choice's ground |
| `count` / `button` / `button-line` / `button-hover` / `button-press` | `rgb(255 255 255 / 0.6)` / `rgb(255 255 255 / 0.6)` / `rgb(255 255 255 / 0.7)` / `rgb(255 255 255 / 0.78)` / `rgb(255 255 255 / 0.9)` | `rgb(255 255 255 / 0.08)` / `rgb(255 255 255 / 0.08)` / `rgb(255 255 255 / 0.12)` / `rgb(255 255 255 / 0.05)` / `rgb(255 255 255 / 0.08)` | A count's clear glass; the file input's button (the others draw `glass-button`'s gradient instead), a clear button's rim, under the pointer, pressed (in dark only a little lighter, so grey and red words still read on it pressed) |
| `switch-off` / `knob` / `scrim` | `#6e737b` / `#ffffff` / `#15171a` | `#8a8e96` / `#0b0c0e` / `#000000` | A switch that's off (3.5:1); its knob, solid (white in light, near-black in dark, where the on track is near-white ink: 3:1 on its track either way); behind an open drawer or sheet (decorative) |
| `brand` / `on-brand` / `brand-ink` | `#15171a` / `#ffffff` / `#15171a` | `#f3f4f6` / `#0b0c0e` / `#f3f4f6` | The firm's own colour (`src/lib/tenancy/brand-values.ts` `firmPalette`, a set per theme on `<body>`: every pair at least 4.5:1 on every point of the glass), here the defaults: the current tab and the firm's fills, their words, the colour as words. Its pale tint, `brand-soft`, is 12% of it over whatever lies under it |
| `tint` / `on-tint` / `tint-shade` | `#15171a` / `#ffffff` / `#000000` | `#f3f4f6` / `#0b0c0e` / `#ffffff` | The main button (`glass-tint`): tinted glass in the firm's colour, from `tint` at the top to `tint-shade` at the foot, with its words; the light set in both themes (its words read on itself) |
| `brand-bar` / `on-brand-bar` / `on-brand-bar-soft` | `#1f2227` / `#ffffff` / `#d2d4d8` | `#34373d` / `#ffffff` / `#d2d4d8` | The pass and the firm's initial; their words; the pass's second line |
| `pass-plate` / `on-pass-plate` | `#ffffff` / `#1f2227` | `#ffffff` / `#34373d` | The gate's white plate on the pass; its words |
| `urgent` / `urgent-soft` / `urgent-ink` / `urgent-tile` | `#b0201f` / `rgb(255 239 234 / 0.72)` / `#7d1a10` / `rgb(255 216 207 / 0.8)` | `#ffa59c` / `rgb(42 22 20 / 0.72)` / `#ffcabf` / `rgb(61 29 25 / 0.8)` | Act now: words and borders (on every point of the glass); a chip's or a notice's tinted glass; its words; an urgent tile's tinted glass (the tints and tiles translucent, solid in the fallbacks) |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#c4242a` / `#9b1c21` / `#ffffff` | `#cf3a33` / `#b02e28` / `#ffffff` | The final destructive button and urgent counts, under the pointer, their words |
| `attention` / `attention-soft` / `attention-ink` | `#92400e` / `rgb(255 246 224 / 0.72)` / `#5c3f00` | `#f5b35a` / `rgb(38 31 16 / 0.72)` / `#fbe3a0` | Needs you: words, an icon, an edge; a chip's or a notice's tinted glass; its words |
| `hivis` / `on-hivis` | `rgb(251 229 160 / 0.8)` / `#5c3f00` | `rgb(58 47 16 / 0.8)` / `#fbe3a0` | To do: a tile's or a count's tinted glass, what the firm gives you ("We provide it") |
| `wait-tile` / `wait-ink` / `wait-soft` | `rgb(214 228 250 / 0.8)` / `#163b6e` / `rgb(238 244 253 / 0.72)` | `rgb(23 42 69 / 0.8)` / `#c8dafa` / `rgb(17 26 40 / 0.72)` | Waiting on someone else: a tile's or a count's tinted glass; their words; a chip's tinted glass |
| `done` / `done-soft` / `done-ink` / `done-tile` | `#166534` / `rgb(233 246 238 / 0.72)` / `#155230` / `rgb(210 239 219 / 0.8)` | `#6bd896` / `rgb(16 32 26 / 0.72)` / `#bfeccd` / `rgb(21 48 31 / 0.8)` | Fine, finished: words and borders; a chip's tinted glass; its words; a tile's tinted glass |
| `done-fill` / `on-done` | `#1f7a47` / `#ffffff` | `#1f7a47` / `#ffffff` | The booked tick, its words |
| `quiet-soft` / `quiet-ink` | `rgb(241 242 244 / 0.72)` / `#464b52` | `rgb(34 36 40 / 0.72)` / `#d4d6da` | Information, closed: a chip's or an answer slip's tinted glass; its words |
| `urgent-line` / `attention-line` / `wait-line` / `done-line` / `quiet-line` | `#f5c2bb` / `#f0d39a` / `#b8cff2` / `#b4dfc3` / `#d6d8dc` | `#5a2423` / `#5a4314` / `#2c4166` / `#1f4d33` / `#3a404b` | A status tint's edge (decorative: the words say the status) |
| `demo` / `on-demo` | `#3d2e0a` / `#fde7b0` | `#3d2e0a` / `#fde7b0` | The demo bar |
| `accent` / `accent-hover` / `accent-press` / `on-accent` | `#1d4ed8` / `#2563eb` / `#1e40af` / `#ffffff` | `#9cb8ff` / `#b5caff` / `#7fa2ff` / `#0b1530` | The app's blue (round 7): the current page's icon, the chosen tab's word, "offered, no reply"; never a button (the main button is the firm's). A fill only under a count on the lens |
| `mark-urgent` / `mark-open` / `mark-wait` / `mark-done` / `mark-calm` | `#c4242a` / `#17181a` / `#1d4ed8` / `#1f7a47` / `#98a2b3` | `#ff8b80` / `#f3f4f6` / `#6d93ff` / `#5fd08b` / `#667085` | The dashboard's marks: red to do now, not offered yet (ink), offered and waiting (blue), green done, grey calm (under 3:1 on light glass by design: never alone, each bar with its number, each chart with its legend and Numbers table) |
| `mark-grid` / `mark-base` | `rgb(16 24 40 / 0.06)` / `rgb(16 24 40 / 0.15)` | `rgb(255 255 255 / 0.06)` / `rgb(255 255 255 / 0.15)` | A chart's grid lines and baseline (hairlines, decorative) |

**Depth (Phase 24).** The glass's rims and drops (see "Phase 24"), through six depth tokens
that take variables (`shadow-lift`, `shadow-panel`, `shadow-pass`, `shadow-bar`, `shadow-float`,
`inset-shadow-sunk`), and no other shadow anywhere in `src/` (`tests/unit/ui.glass.test.ts`
holds where each is used).

No other colour is written anywhere in `src/` (no `bg-white`, no Tailwind palette shade, no colour
value in a class or a style): the firm's colour, which the root layout works out from the firm's
settings and sets on `<body>`, is the one exception (`tests/unit/ui.theme.test.ts`).

**A firm's own colour on buttons.** The main button is tinted glass in the firm's colour with
white words (or ink on a pale colour in dark), at least 4.5:1 at both ends of its gradient and
brightened under the pointer. Against the page, a pale firm colour can show little edge: the button
is still named by its words, which is what identifies it, so no edge is added (Phase 17's
guardrails review, S5; revisit if a pilot firm's colour reads poorly).

**Easier to scan (Phase 17).** No label above a page's heading and no divider under the header
(the firm's bar or the office's top bar names the firm). Lists are rows in one glass card rather
than a stack of cards, and an empty list keeps its place as a dashed frame with one sentence.
Colour goes on what needs someone: a valid licence or an up-to-date photo is quiet grey words, not
a green tag.

**Light or dark.** The `sd-theme` cookie (`light` or `dark`; none, or anything else, means follow
the device) is read by the root layout (`src/app/layout.tsx`, `src/app/theme.ts`), which writes
`data-theme` onto `<html>`, so the page arrives in its colours and nothing flashes. With no cookie,
a `prefers-color-scheme: dark` block gives the dark values, guarded so an explicit
`data-theme="light"` wins. Each theme sets `color-scheme`, and the page carries `<meta
name="color-scheme" content="light dark">`, so the browser's own controls and scrollbars match.
The office's moon/sun button sets the cookie (12A.2); casual pages follow the device. The firm's
colour has a set for each theme (Phase 18, above).

Focus: every focusable element shows a 2px `ink` outline with a 2px offset on `:focus-visible`.
Buttons get `cursor: pointer`. File inputs get a visible "choose" button, a clear glass pill
(`::file-selector-button`). Every digit on a page is fixed-width (`tabular-nums` on `body`), so
times, counts, money and notice hours line up.

**Type.** One scale, and Tailwind offers no other size (round 7's, Phase 24): in the casual app
12px (`text-xs`), 14px (`text-sm`), 16px (`text-base`, its body), 18px (`text-lg`), 20px
(`text-2xl`), 28px (`text-3xl`, a page's headline) and 44px (`text-4xl`, a shift's time and its
date tile, the greeting); in the office 13, 15 (its body), 17 (a section's heading), 30 (a page's
headline) and 40px in place of 14, 16, 18, 28 and 44. Office fields are 18px on a touch screen
(`pointer-coarse:text-lg`), because iPhones zoom in on a field under 16px.

**Font.** Geist (`@fontsource-variable/geist`), self-hosted with `next/font/local` from its npm
package (SIL Open Font License 1.1), latin and latin-ext (for names such as Łukasz; downloaded only
when a page has such a letter), then the system's font. Nothing is fetched from Google, while
building or while running (`src/app/fonts.ts`).

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
  white card with the soft edge; since Phase 23 its hairline), with `field` and `btn.primary`.
  The office's since Phase 23 (see "Phase 23"): `tabs`, `tab` and `tabCurrent` (the "Show" tabs
  and the events board's filters), `notice` (an amber wash with its edge), `codeBox` (a key or
  secret shown once, in the system's mono).
- `status-chip.tsx`: `<StatusChip tone="urgent|attention|wait|done|quiet">word</StatusChip>`, with
  a small inline SVG icon that is `aria-hidden`. The word is the existing word from the copy
  module. `wait` (Phase 23, the office's blue, an hourglass): waiting on someone else.
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
| wait (Phase 23, the office) | Waiting: on someone else, never on you (an offer waiting for a casual's answer, "With payroll"). These words move here from attention as each page takes round 3's parts |

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

- **From 1024px (Phase 24, round 7 of the canvas; PLAN.md 24.2):** the rail at the left and, over
  the page, a top bar of three floating glass capsules.
  - **The rail** (`office-rail.tsx`): floating glass (`glass-float`, 24px round), 72px wide, 12px
    from the window's corner, staying put as the page scrolls. At its top the firm's mark (its
    initial on its own colour, `brand-bar`), and under it the rail's own button ("Show the menu
    with names" / "Show the menu as icons"), which opens the rail to 236px with names and counts
    and shuts it again; the choice is kept in the `sd-rail` cookie (`rail-cookie.ts`), read by the
    layout, so the next page arrives as it was left. Then the menu (`rail-items.ts`): Dashboard,
    Needs attention, Events & sessions, Enquiries and Cancellations as round 48px icons; Pay and
    People as folds; under a line, Admin and records, a fold too (a role whose menu is only a fold,
    payroll's Pay, gets its pages as icons). Pressing a fold while the rail is shut opens the rail
    with that fold open (not kept in the cookie). A red dot marks an icon whose page needs you (a
    count that `needs` this person: Needs attention, enquiries that need a person, uploads to
    check, pay queries for payroll), and a fold's icon when one of its pages does. Shut, an icon's
    name (and its count's words: "Enquiries, 2 need a person") shows beside it under the pointer
    and on keyboard focus, stays while the pointer moves onto it, and goes with Escape (WCAG
    1.4.13). The page you're on sits under a white glass lens (`lens`) with its icon in the
    accent, at once as it's picked; a fold holding it wears the lens while it's shut. Open, a
    row is 44px with its name and count, a fold's pages 38px with their names lined up with the
    fold's. Shut it's 585px tall: in a window under 640px it scrolls, with no bar; open, it scrolls
    with no bar and fades at the edge that has more (`menu-scroll.tsx`).
  - **The top bar** (`office-frame.tsx`): no glass of its own, pinned to the top, 68px (its 48px
    capsules with 12px above them and 8px below); once the page scrolls under it a soft frosted
    edge fades in behind it (`scroll-edge`, `[data-scrolled]`). Its capsules:
    1. the counts (`office-menu.ts` `barCounts`), each a link that opens where it's worked and
       only for the roles that can open that page: To fill (places to fill in sessions to come:
       Events & sessions' "Need people"), Urgent (places in urgent sessions, its number red while
       there are any: Events & sessions' "Urgent"), Offers out (offers with no reply on sessions
       still to come: the dashboard's offers chart), To check (Needs attention's one count) and
       Pay queries (those waiting). The first three come from `src/lib/office/shell-counts.ts`, in
       one statement through the firm's data layer, on the same SQL as the pages they open; a
       count that couldn't be read shows its words alone;
    2. the search (`office-search.tsx`), for the roles that can open what it finds: "Search", its
       label "Find a casual, shift or site", with ⌘K (Ctrl K off a Mac) to reach it from
       anywhere. What's typed goes to the server as an action (`search-actions.ts`: never the
       address or a log), a moment after typing stops, from 2 characters; up to 5 casuals (by
       name or mobile), shifts to come (by role, event, site or post) and sites (by name or town)
       show in a floating glass panel, each a link to its page (a site: Events & sessions at that
       site, `?site=`); the down arrow moves into them, Enter opens the first, Escape closes the
       panel, and a polite live line says how many were found;
    3. the moon/sun button (`theme-button.tsx`: sets the `sd-theme` cookie and `data-theme` at once;
       its name says what it switches to, and the same words show under it on hover and keyboard
       focus, stay while the pointer moves onto them, and go with Escape), then you: your initials
       on a pale blue disc, your name (up to 112px) and your role, and a chevron, opening the
       account menu.
    The bar is a container: the counts' icons show only when there's room for all three capsules
    with them (a 1172px column: a 1280px window with the rail shut), your name and role from
    1008px, the search 250px wide from 1172px (200px below); in a column narrower still the counts
    scroll sideways, with no bar.
  - **The page** sits beside the rail under the capsules, with no card of its own, its sections
    glass on the wash, the column's width (up to 1600px).
- **Below 1024px:** the bar is Phase 23's, as floating glass the window's full width, pinned to the
  top (56px): "Menu", the firm's mark and name, the square moon/sun button (clear glass) and you
  (your initials; your name from 640px). The pay week moved to the dashboards' lines (the dashboard
  "Monday 26 October · Week 44 · Pay Fri 6 Nov", the pay dashboard "Week 44 · 26 Oct – 1 Nov · Pay
  Fri 6 Nov") and the shifts line's number to Settings (it's under the pay dashboard's headline
  too; under the dashboard's until 24.3).
- **The account menu** is a native popover (`popover`, opened by the button's `popovertarget`)
  under you, its right edge with yours: no role of its own, Escape and a tap elsewhere close it,
  and it works before the page's scripts load. It holds the name and role, the light or dark
  switch, "How-to guide" and the office's one "Log out". Because the bar stays over the page, the
  office's page scrolls with 80px kept clear at its top (`scroll-padding-top` on `html` while the
  office shell is on the page, `globals.css`): a link to a heading lands below the bar, and a
  control focused from the keyboard is never hidden under it.
- **Phone and tablet:** "Menu" opens the menu as a drawer from the left: a native `<dialog>`
  opened with `showModal()`, so the page behind it is shut off and dimmed (`scrim` at half
  strength). Escape, a tap on the dimmed page, "Close menu" or choosing a link closes it, and the
  browser puts the focus back on "Menu". The one `<nav>` moves into the drawer while it's open and
  back to the (hidden) rail when it shuts, so a page never has two, and a shut drawer holds
  nothing that can be tabbed to. (A `<dialog>` can't be the rail too: shown by CSS, it's still
  announced as a dialog.) "Menu", the rail's buttons, the search and the theme button stay
  disabled until the page is ready (`useHydrated`), so a tap is never lost; the drawer also shuts
  on moving to another page and on widening the window to 1024px. In the drawer the menu keeps its
  groups' names (`office-nav.tsx`) and only Admin and records folds.
- (Until Phase 24, from 1024px the menu was a glass card under a full-width bar that showed the
  pay week and the shifts line's number; in Phase 23 both were white cards.)
- **Menu groups** (`office-menu.ts`; labels are words, not headings; links only appear for roles
  that can open them, from `canAccess`):

  | Group | Links |
  |---|---|
  | (first, no label: Phase 20) | Dashboard, Needs attention (in place of the bell) |
  | Today | Events & sessions, Enquiries, Cancellations (Phase 24: the rail's order) |
  | Pay | Pay dashboard, Pay queries, Import pay records |
  | People | Casuals, Strikes, Notice report |
  | Admin and records (folded) | Action log, Pilot metrics, Office team, Settings, Integrations, Data requests |
  | Help | How-to guide |

- The current page's link has `aria-current="page"`: in the drawer on a pale pill (`pill`, which
  slides to a link as it's picked) with its icon in ink, in the rail under the lens. Every row in
  the drawer (and its folded group's button) is 44px tall (34px with a mouse until Phase 24, when
  the menu card left). Group labels are small capitals in the faintest grey
  (`ink-faint`; by CSS only, the words stay as written). On a page inside a section, the section's link
  looks the same but has `aria-current="true"` (it isn't the page you're on): a shift or a new
  shift marks Events & sessions, the offer page marks Dashboard, a casual marks Casuals, a
  cancellation's record marks Cancellations, a worker's data page marks Data requests.
- **Badges:** a link can carry a count, a flat tinted pill with no edge (Phase 23): amber when it
  needs you (`countNeeds`: Needs attention's, Enquiries' that need a person, Casuals' uploads to
  check, and Pay queries' for payroll), blue when it waits on someone else (`countWaiting`: Pay
  queries' for everyone else). No count in the menu is an urgent one, so none is red (the
  dashboard's urgent places' count is: `countUrgent`). Phase 21's one grey style is gone.
  The number sits inside the link but hidden from screen readers, and its words ("3 waiting")
  follow the link as visually hidden text, so the link's name stays exactly its label. Needs attention's (Phase 20) is the Dashboard's Needs attention count:
  "{12} to deal with", and "50+" when a list stopped at 50.
- **Session keeper:** in the frame, so a session is kept alive on every office page.
- **Test rules the shell must keep:** the menu is built from plain links (no list items, headings,
  regions, `status`, `note` or `menu` roles, fieldsets or `<details>`: a fold is a button that
  shows or hides its links, and `menuLink()` opens the one a link is in); so is the search's panel
  (its live line is `aria-live`, not a `status`); it sits outside
  `<main>`; link names stay word for word; nothing else on a page may repeat a menu link's name (the account
  menu's "How-to guide" is hidden until opened); its `aria-label` ("Office menu") contains no
  field label used on a page. The rail's own button is "Show the menu with names" / "Show the menu
  as icons", so a page's own "Show" button is found by its exact name. The browser tests reach menu
  links through `menuLink(page, name)`
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
