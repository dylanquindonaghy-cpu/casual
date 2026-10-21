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
  stays D7's navy exactly. A status colour always travels with its word or icon.
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
- **The parts** (`src/app/ui/sign.tsx`, `plate.tsx`; the sheet in `src/app/shifts/sheet.tsx`): the **date tile** (a calendar
  page: the weekday on an ink band, red when urgent; the day in sign figures; the month), the
  **sign plate** (light on dark, like a venue's sign: "Gate 2"), the **seats** (a square per place:
  filled when taken, dashed when free, red when urgent; none past 16 places), the solid **plate**
  for a status that must catch the eye (red urgent, sign-yellow needs doing, green done, grey
  waiting; elsewhere statuses stay the pale `StatusChip`, now square-ish), and the **sheet** that
  rises from the bottom of the phone (a modal `<dialog>`).
- **The pass is the only thing with a shadow at rest** (`shadow-pass`; in dark a 1px line).
- **Motion** (globals.css `--animate-*`, `--ease-sd`): one easing, `cubic-bezier(.2,.8,.2,1)`;
  150ms for fades, the sheet's dim and switches, 200ms for items arriving or leaving, 250ms for
  cards opening and the sheet. A card opening rises 8px and fades in, its body 60ms after; a taken
  shift moves into Your shifts from 48px above, marked "New"; the next urgent place slides in from
  the side; the sheet rises from the bottom; a confirmation drops in and stays 3 seconds. Only
  transform and opacity move; nothing loops. With reduced motion every movement is a 150ms fade and
  transitions stop.

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

Two themes: light, and a navy dark (D7 in `docs/office-v2.md`). The light values are the `@theme`
block; the dark values redefine the same tokens. Every pair a page uses meets its contrast in both
(`tests/unit/ui.contrast.test.ts`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#13233a` | `#e8edf7` | Main text (navy, the uniform's colour: Phase 18), the date tile's band, sign plates, the focus ring |
| `ink-muted` | `#3e4c60` | `#a3b0c8` | Secondary text, labels, meta lines, table headers (8.7:1 on white; 6.8:1 on the dark card) |
| `ink-hover` / `on-ink` | `#26364f` / `#ffffff` | `#c3cddf` / `#0f1626` | An ink fill under the pointer; text on an `ink` fill |
| `line` | `#dbe1e8` | `#2c3a5c` | Dividers and card borders (decorative only) |
| `line-strong` | `#6b7789` | `#7c8aa8` | Input and secondary button borders (at least 3:1) |
| `canvas` | `#f2f4f7` | `#0f1626` | The page behind cards: the casual app, and the office's menu (D7's "page") |
| `card` | `#ffffff` | `#1b2642` | Cards, fields, the office's page |
| `panel` | `#ffffff` | `#16203a` | The office's top bar |
| `raised` | `#e8ecf1` | `#22304f` | A sunk track: the empty pass's band, a waiting tile, a full pill, the week's bar |
| `switch-off` | `#7a8396` | `#7c8aa8` | A switch's track when off (at least 3.5:1) |
| `scrim` | `#0d1520` | `#000000` | Behind the open menu drawer and a sheet, at half strength (decorative only) |
| `brand` / `on-brand` | `#13233a` / `#ffffff` | `#e8edf7` / `#0f1626` | The firm's own colour (Phase 17; per theme in Phase 18): the main buttons, in the casual app and the office. A firm with a colour of its own gets a set for each theme on `<body>` (`src/app/layout.tsx`, `firmPalette`: each pair at least 4.5:1); these are the values without one. Its pale tint, `brand-soft` (12% of it over `card`), marks the casual app's current tab and its "shifts to apply for" tile, with `ink` (or `brand-ink`) on it |
| `urgent` / `urgent-soft` / `urgent-ink` | `#b91c1c` / `#fef2f2` / `#7f1d1d` | `#ff8b80` / `#3d1d26` / `#ffc7c0` | Act now |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#b91c1c` / `#7f1d1d` / `#ffffff` | `#d92d20` / `#b42318` / `#ffffff` | Count badges and the final destructive button (white on `#d92d20`: 4.83:1). Urgent chips are the pale pair (`urgent-soft` with `urgent-ink`), so a list of urgent rows doesn't shout |
| `attention` / `attention-soft` / `attention-ink` | `#b45309` / `#fffbeb` / `#78350f` | `#f2a541` / `#36291a` / `#ffd699` | Someone needs to act |
| `done` / `done-soft` / `done-ink` | `#15803d` / `#f0fdf4` / `#14532d` | `#4ccb83` / `#132f22` / `#b0efca` | Fine, finished |
| `quiet-soft` / `quiet-ink` | `#eef1f5` / `#3e4c60` | `#26324f` / `#d0d8e6` | Information, closed |
| `hivis` / `on-hivis` | `#f5b301` / `#13233a` | `#f5b301` / `#13233a` | Sign yellow (Phase 18): what needs doing, as a plate or a tile, with navy words (8.5:1) |
| `done-fill` / `on-done` | `#15803d` / `#ffffff` | `#15803d` / `#ffffff` | The booked tick, a "sorted" tile (white on it 5.0:1) |
| `brand-ink`, `brand-bar` / `on-brand-bar` | `#13233a`, `#13233a` / `#ffffff` | `#e8edf7`, `#2b3d63` / `#ffffff` | The firm's colour as words; its band (the pass's top, its initial) with the words on it (Phase 18; a firm's own set below) |
| `demo` / `on-demo` | `#3d2e0a` / `#fde7b0` | `#3d2e0a` / `#fde7b0` | The demo bar |

No other colour is written anywhere in `src/` (no `bg-white`, no Tailwind palette shade, no colour
value in a class or a style): the firm's colour, which the root layout works out from the firm's
settings and sets on `<body>`, is the one exception (`tests/unit/ui.theme.test.ts`).

**A firm's own colour on buttons.** Its words are black or white, whichever reads better (at
least 4.58:1), so a button in any firm colour can be read. Against the page, a pale firm colour
(yellow on the white card) or a dark one in the dark theme can show little edge: the button is
still named by its words, which is what identifies it, so no edge is added for now (Phase 17's
guardrails review, S5; revisit if a pilot firm's colour reads poorly).

**Easier to scan (Phase 17).** Flat surfaces: no shadows on anything at rest but Phase 18's pass
(only what floats, a menu or a dialog, has one; `tests/unit/ui.flat.test.ts` holds it), one hairline (`line`) on cards,
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
  same names under `staffBtn` (full width, at least 56px tall). Links inside text or a row (a
  shift's title, a worker's name) use `textLink` (grey underline, darker on hover), or
  `textLinkInGroup` when the whole row or card is the `group` that darkens it. The login pages
  (staff and office, outside the shell) use `page.login` (the brand bar's 448px column),
  `loginCard` (framed from 640px up, frameless on a phone) and `loginTitle` for their one `<h1>`.
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

- **Top bar** (`office-frame.tsx`), pinned to the top: "Menu" (below 1024px), ShiftDesk's mark
  with "ShiftDesk" and the firm's name (no reference portal's logo or colours; on logged-in office
  pages the firm's brand bar is hidden, since this bar names the firm), the moon/sun button
  (`theme-button.tsx`: sets the `sd-theme` cookie and `data-theme` at once; its name says what it
  switches to, and the same words show beside it on hover and keyboard focus), and the account
  button (initials, then the name and role from 640px). The account menu is a native popover
  (`popover`, opened by the button's `popovertarget`): no role of its own, Escape and a tap
  elsewhere close it, and it works before the page's scripts load. It holds the name and role,
  "How-to guide" and the office's one "Log out".
- **Desktop (1024px and wider):** the menu in a 272px sidebar that stays in view under the top
  bar, then the page on the canvas background, content up to 1152px wide. Forms stay within
  672px; lists, tables and reports use the full width.
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
  | Operations | Dashboard, Events & sessions, Cancellations, Enquiries |
  | Pay | Pay dashboard, Pay queries, Import pay records |
  | Records | Strikes, Casuals, Action log, Notice report, Pilot metrics |
  | Configuration | Office team, Settings, Data requests |
  | Help | How-to guide |

- The current page's link has `aria-current="page"`, bold text on a pale tint of the firm's colour
  (`brand-soft`; Phase 17, no bar at the menu's edge) and its icon filled in. On a page inside a section, the section's link
  looks the same but has `aria-current="true"` (it isn't the page you're on): a shift or a new
  shift marks Events & sessions, the offer page marks Dashboard, a casual marks Casuals, a
  cancellation's record marks Cancellations, a worker's data page marks Data requests.
- **Badges:** a link can carry a count. The number sits inside the link but hidden from screen
  readers, and its words ("3 waiting") follow the link as visually hidden text, so the link's name
  stays exactly its label.
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
