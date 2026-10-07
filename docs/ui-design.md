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
5. **No decoration.** No gradients, glows, textures or animations beyond a colour change on hover
   and a focus ring. The firm's brand colour stays in the brand bar and is never used for status.
6. **Works without JavaScript** where pages already do (server-action forms, `<details>`
   confirmations, GET filter forms, anchor links).

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

Two themes: light, and a navy dark (D7 in `docs/office-v2.md`). The light values are the `@theme`
block; the dark values redefine the same tokens. Every pair a page uses meets its contrast in both
(`tests/unit/ui.contrast.test.ts`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#0f172a` | `#e8edf7` | Main text, primary buttons, the current menu item, the focus ring |
| `ink-muted` | `#475569` | `#a3b0c8` | Secondary text, meta lines, eyebrows (7.6:1 on white; 6.8:1 on the dark card) |
| `ink-hover` / `on-ink` | `#334155` / `#ffffff` | `#c3cddf` / `#0f1626` | A primary button under the pointer; text on an `ink` fill |
| `line` | `#e2e8f0` | `#2c3a5c` | Dividers and card borders (decorative only) |
| `line-strong` | `#64748b` | `#7c8aa8` | Input and secondary button borders (at least 3:1) |
| `canvas` | `#f8fafc` | `#0f1626` | Office page background behind cards (D7's "page") |
| `card` | `#ffffff` | `#1b2642` | Cards, fields, and the page behind staff pages |
| `panel` | `#ffffff` | `#16203a` | The office menu and its footer |
| `raised` | `#f4f6fa` | `#22304f` | Something lifted off a card |
| `switch-off` | `#7a8396` | `#7c8aa8` | A switch's track when off (at least 3.5:1) |
| `urgent` / `urgent-soft` / `urgent-ink` | `#b91c1c` / `#fef2f2` / `#7f1d1d` | `#ff8b80` / `#3d1d26` / `#ffc7c0` | Act now |
| `urgent-fill` / `urgent-fill-hover` / `on-urgent` | `#b91c1c` / `#7f1d1d` / `#ffffff` | `#d92d20` / `#b42318` / `#ffffff` | Count badges, urgent chips, the final destructive button (white on `#d92d20`: 4.83:1) |
| `attention` / `attention-soft` / `attention-ink` | `#b45309` / `#fffbeb` / `#78350f` | `#f2a541` / `#36291a` / `#ffd699` | Someone needs to act |
| `done` / `done-soft` / `done-ink` | `#15803d` / `#f0fdf4` / `#14532d` | `#4ccb83` / `#132f22` / `#b0efca` | Fine, finished |
| `quiet-soft` / `quiet-ink` | `#f1f5f9` / `#334155` | `#26324f` / `#d0d8e6` | Information, closed |

No other colour is written anywhere in `src/` (no `bg-white`, no Tailwind palette shade, no colour
value in a class or a style): the firm's brand colour, which the brand bar reads from the firm's
settings, is the one exception (`tests/unit/ui.theme.test.ts`).

**Light or dark.** The `sd-theme` cookie (`light` or `dark`; none, or anything else, means follow
the device) is read by the root layout (`src/app/layout.tsx`, `src/app/theme.ts`), which writes
`data-theme` onto `<html>`, so the page arrives in its colours and nothing flashes. With no cookie,
a `prefers-color-scheme: dark` block gives the dark values, guarded so an explicit
`data-theme="light"` wins. Each theme sets `color-scheme`, and the page carries `<meta
name="color-scheme" content="light dark">`, so the browser's own controls and scrollbars match.
The office's moon/sun button sets the cookie (12A.2); casual pages follow the device. The firm's
brand bar stays exactly as it is in both.

Focus: every focusable element shows a 2px `ink` outline with a 2px offset on `:focus-visible`.
Buttons get `cursor: pointer`. File inputs get a visible "choose" button
(`::file-selector-button`). Every digit on a page is fixed-width (`tabular-nums` on `body`), so
times, counts, money and notice hours line up.

**Type.** One scale, and Tailwind offers no other size: 12px (`text-xs`), 13px (`text-sm`), 15px
(`text-base`), 18px (`text-lg`), 24px (`text-2xl`), 30px (`text-3xl`). Office pages use 15px body
(the shell sets `text-base`), 13px meta, 18px section headings, 30px page titles. Staff pages keep
18px body and their big buttons, with 24px for a page's result ("You're booked."). Office fields
are 18px on a touch screen (`pointer-coarse:text-lg`), because iPhones zoom in on a field under
16px.

**Font.** Plus Jakarta Sans, self-hosted with `next/font/local` from its npm package
(`@fontsource-variable/plus-jakarta-sans`, SIL Open Font License), latin and latin-ext (for names
such as Łukasz; downloaded only when a page has such a letter), then the system's font. Nothing is
fetched from Google, while building or while running (`src/app/fonts.ts`).

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
- `page-header.tsx`: `<PageHeader eyebrow title meta actions>`. Restyles the page's one `<h1>`;
  never adds a second heading.
- `icons.tsx`: the few inline SVG icons the office menu, the office guide and the staff home's
  "Log out" use, and the menu row's edge arrow (`chevron`), which is also the arrow on each link
  of the office guide's contents below 1280px (no icon library; inline SVG also works offline in
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

Rendered only when an office session exists (`getOfficeSession()`), so `/office/login` and
`/office/l` stay plain. Display only: every page and action still checks access itself. Next keeps
the layout (doesn't redraw it) as you move between office pages, so if the session ends on the
server (access turned off, "Log out on every device", or it ran out), the next click lands on
`/office/login` with the old shell still around it. The menu (`office-nav.tsx`) then asks the
server to redraw the page once (`router.refresh()`), which drops the shell; it only does this on
arriving at `/office/login` or `/office/l` from another page, so it can't repeat, and with a live
session the login page sends you on to `/office` as before.

- **Desktop (1024px and wider):** a 256px left sidebar with the menu, then the page on the canvas
  background, content up to 1152px wide. Forms stay within 672px; lists, tables and reports use
  the full width.
- **Phone and tablet:** the same menu, as one row of links under the brand bar that scrolls
  sideways (the current page is scrolled into view). Every link is visible without opening
  anything. While links are hidden past an edge, that edge shows an arrow (a chevron on a band of
  the menu's colour with a thin line on its inner side, over the end of the row; no gradient, no
  animation), measured when the page opens, on every scroll and on every resize, and gone once you
  reach that end. The arrows are `aria-hidden` and let taps and swipes through to the row; a link
  reached with the keyboard is scrolled 48px clear of them. There is no "Menu" button: the browser tests
  click menu links at phone width, and a `<details>` menu would add a `group` role that breaks the
  event-shifts page tests.
- **Menu groups** (labels are words, not headings; links only appear for roles that can open
  them, from `canAccess`):

  | Group | Links |
  |---|---|
  | (none) | Today (payroll: Home) |
  | Shifts and people | Shifts, Requests, Workers |
  | Records | Action log, Notice report, Pilot metrics |
  | Pay | Pay queries, Import pay records |
  | Admin | Office team, Data requests (download or delete) |
  | Help | How-to guide |

- The current page's link has `aria-current="page"`, bold text and a dark left bar (desktop) or
  dark fill (phone). On a page inside a section, the section's link looks the same but has
  `aria-current="true"` (it isn't the page you're on): a shift or a new shift marks Shifts, the
  offer page marks Today, a worker marks Workers, a worker's data page marks Data requests.
- **Footer:** the user's name and role, and the one "Log out" button for the office (it moved here
  from the bottom of Today, so it's on every page). The session keeper moved here too, so a
  session is kept alive on every office page, not only Today.
- **Test rules the shell must keep:** the menu is built from plain links (no list items, headings,
  regions, `status` or `note` roles, fieldsets or `<details>`); it sits outside `<main>`; link
  names stay word for word; nothing else on a page may repeat a menu link's name; its
  `aria-label` ("Office menu") contains no field label used on a page.

## Page patterns

- **Page header:** eyebrow ("{firm} office"), the `<h1>`, a meta line (status chips, times,
  counts), the intro sentence, then actions (the main one first). A divider, then the content.
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
- **Today:** a summary of counts at the top (each a link to its section), then the sections in
  the order things need doing: urgent shifts, bookings to check, from your rota sheet, requests,
  gaps, who worked, cancellations, messages from unknown numbers, licences expiring.

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
  office guide's contents are a rail beside it, with no arrows. Pills are used only by the office
  menu, so the contents never look like it.
