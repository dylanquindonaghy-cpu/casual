// The only place button, field, card, chip and layout class strings live (docs/ui-design.md).
// Plain strings, safe anywhere (server, client, the AI and client boundary tests): no imports.
// Every class is written out in full so Tailwind finds it. Add spacing (mt-4, self-start, w-full)
// where you use one: `${btn.primary} mt-4`.

// Phase 17's look ("easier to scan"): one hairline on cards, a 1px border on office controls.
// Phase 18's (the redesign): one filled button per screen, in the firm's own colour (`brand`) on
// the casual app and in the office; phone buttons 52px, office ones 44px. Phase 20's: buttons are
// pills, and depth comes from the five depth tokens only (globals.css). Phase 21's (the office's
// look; docs/ui-design.md "The office's system"): in the office the main button is near-black,
// the others grey pills, a destructive one red words on grey; cards 20px round with the one
// depth token (`soft`); spacing only 4, 8, 12, 16, 24, 32 and 48px
// (tests/unit/ui.office-system.test.ts). The casual app's own strings (`staff…`) keep its Phase 20
// look.
const office =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-center text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const staff =
  "flex w-full min-h-13 items-center justify-center gap-2 rounded-full border-[1.5px] px-5 py-3 text-center text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60";

// Office buttons (and links that look like buttons): at least 44px tall, each with its hover and
// pressed fills (the focus ring is globals.css's, everywhere).
export const btn = {
  // The one main action of a card or form: near-black (Phase 21; white in dark).
  primary: `${office} border-ink bg-ink text-on-ink hover:border-ink-hover hover:bg-ink-hover active:border-ink-press active:bg-ink-press`,
  // Any other action: a grey pill.
  secondary: `${office} border-button-line bg-button text-ink hover:border-button-hover hover:bg-button-hover active:border-button-press active:bg-button-press`,
  // Opens a destructive step ("Cancel this shift", "Turn off access"): red words on grey.
  danger: `${office} border-button-line bg-button text-urgent hover:border-button-hover hover:bg-button-hover active:border-button-press active:bg-button-press`,
  // The final click of a destructive change: a step's "Yes, …", or a destructive action that
  // happens at once ("Block from this site").
  dangerSolid: `${office} border-urgent-fill bg-urgent-fill text-on-urgent hover:border-urgent-fill-hover hover:bg-urgent-fill-hover active:border-urgent-fill-hover active:bg-urgent-fill-hover`,
  // A text link with a 44px target ("Back to …", "Earlier", "Clear"); the casual app's too.
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-ink underline underline-offset-4 hover:text-ink-muted",
  // A quiet action in words only ("Not urgent", "Add a session").
  text: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-base font-semibold text-ink transition-colors hover:bg-quiet-soft active:bg-raised",
};

// A quiet grey link beside a heading, to the whole list ("All on Events & sessions", "Open Needs
// attention": hilos's "View all"; Phase 21). Standalone, so no underline; 44px tall.
export const quietLink =
  "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink";

// A link inside text or a row (a shift's title, a worker's name): underlined in grey, darker on
// hover. Keeps the text's own size and weight. `textLinkInGroup` darkens when a `group` parent
// (the whole row or card) is hovered.
export const textLink = "underline decoration-line-strong underline-offset-4 hover:decoration-ink";
export const textLinkInGroup =
  "underline decoration-line-strong underline-offset-4 group-hover:decoration-ink";

// Staff buttons: full width, at least 52px tall, for thumbs. The main one in the firm's colour.
export const staffBtn = {
  primary: `${staff} border-brand bg-brand text-on-brand hover:brightness-110`,
  secondary: `${staff} border-line-strong bg-card text-ink hover:bg-quiet-soft`,
  // Opens a destructive step: quiet red words, so it doesn't compete with the main action.
  danger: `${staff} border-transparent bg-transparent text-urgent-ink hover:bg-urgent-soft`,
  dangerSolid: `${staff} border-urgent-fill bg-urgent-fill text-on-urgent hover:border-urgent-fill-hover hover:bg-urgent-fill-hover`,
  // A way out in words, in the firm's colour ("Keep my shift").
  text: `${staff} border-transparent bg-transparent text-brand-ink hover:bg-quiet-soft`,
};

// A compact outlined button in a line of the casual app ("Remove" a day, "Show shifts"): the office
// button of Phase 20, which the casual app keeps.
export const staffBtnInline =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-card px-4 py-2 text-center text-base font-semibold text-ink hover:bg-quiet-soft disabled:cursor-not-allowed disabled:opacity-60";

// A smaller staff button, two to a row ("Ask for a change" beside "Can't make it?" on the pass).
export const staffBtnSmall =
  "flex min-h-13 items-center justify-center rounded-full border-[1.5px] border-line-strong bg-card px-3 py-2 text-center text-base font-semibold text-ink hover:bg-quiet-soft";

// A two-way switch's sunk track (Open | Booked, Upcoming | Past 30 days on the Shifts tab): two
// halves, the current one a lifted pill (src/app/my-shifts-view.tsx Toggle).
export const switchTrack = "grid grid-cols-2 gap-1 rounded-full bg-raised p-1 inset-shadow-sunk";

// Inputs, selects and textareas (office): white with a 1px border, even on a tinted panel. Add w-full
// or a width where you use it.
export const field =
  "min-h-11 rounded-row border border-line-strong bg-card px-3 py-2 text-base font-normal text-ink transition-colors hover:border-ink-muted pointer-coarse:text-lg";
// Staff inputs: full width and bigger.
export const staffField =
  "min-h-14 w-full rounded-xl border-2 border-line-strong bg-card px-4 py-3 text-lg font-normal text-ink";
// A label above its field (htmlFor), or wrapping it: `labelStack` puts the field under the words.
export const label = "block font-semibold text-ink";
export const labelStack = "flex flex-col gap-1 font-semibold text-ink";
// A hint under a field or a form ("Leave it empty to …").
export const hint = "text-sm text-ink-muted";

// A white card on the page, for an item with buttons: the office's (Phase 21), and the casual
// app's (`staffCard`).
export const card = "rounded-card bg-card p-4 shadow-soft sm:p-6";
export const staffCard = "rounded-2xl border border-line bg-card p-4";
// The casual app's tappable row in a card of rows ("For you", the open shifts' cards): a tile on
// the left, the words, a chevron. Its focus ring sits inside the card.
export const tapRow =
  "flex items-center gap-3.5 p-3.5 text-left hover:bg-quiet-soft focus-visible:-outline-offset-2";
// One card holding compact rows (read-only or repeated items): <ul className={rows}><li className={row}>.
// The office's: one rounded white list with hairlines between its rows (Apple Wallet's; Phase
// 21). The casual app's: `staffRows`, `staffRow`.
export const rows = "divide-y divide-line rounded-card bg-card shadow-soft";
export const row = "px-4 py-3";
export const staffRows = "divide-y divide-line rounded-2xl border border-line bg-card";
export const staffRow = "px-4 py-3";

// Section heading (h2), and the space between sections and under a heading.
export const h2 = "text-lg font-semibold tracking-heading text-ink";
export const sectionGap = { office: "mt-8 lg:mt-12", staff: "mt-8" };
export const headingGap = "mt-3";
// A number beside a heading ("Requests 2"): the number only, never a word. A small grey pill.
export const count =
  "ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-raised px-2 align-middle text-xs font-semibold tabular-nums text-ink-muted";

// Secondary text: meta lines (times, references), and longer muted sentences.
export const meta = "text-sm text-ink-muted";
export const muted = "text-base text-ink-muted";
// Numbers that line up (times, counts, money, notice hours).
export const nums = "tabular-nums";

// Page widths. Office pages sit in the shell's container (up to 1152px, padded): their <main>
// adds no padding of its own; forms stay within 672px. Staff pages are 448px wide, with a 16px
// edge on a phone (24px from 640px). The login
// pages (staff and office, outside the shell) are the brand bar's 448px column, centred.
export const page = {
  office: "min-w-0",
  officeForm: "min-w-0 max-w-2xl",
  staff: "mx-auto max-w-md px-4 py-6 sm:px-6",
  login: "mx-auto w-full max-w-md px-6 py-8 sm:px-0 sm:py-16",
};

// The login card, inside `page.login`: framed from 640px up; on a phone there's no frame (the
// page is the card), with the same 24px edge as the brand bar. Its one <h1> is `loginTitle`.
export const loginCard = "sm:rounded-3xl sm:border sm:border-line sm:bg-card sm:p-6";
export const loginTitle = "text-title text-balance text-ink";

// Report tables: the wrapper scrolls sideways on small screens. Give it role="region",
// tabIndex={0} and an aria-label. Numbers right aligned (`num`). Grey headers with no band.
export const table = {
  wrap: "overflow-x-auto rounded-card bg-card shadow-soft",
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-line px-4 py-3 font-medium text-ink-muted",
  td: "border-b border-line px-4 py-3 align-top",
  num: "text-right tabular-nums",
};

// Status chips (used by <StatusChip>, src/app/ui/status-chip.tsx). Colour always has its word.
// Pale tints with dark words of the same hue, so a list of urgent rows doesn't shout; square-ish
// like a sign (Phase 18). The solid plates are <Plate> (src/app/ui/plate.tsx). Its edge is the
// status's own line token: the status colour in the casual app, a shade darker than the tint in
// the office (Phase 21).
export const chip = {
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 align-middle text-sm font-semibold leading-5",
  urgent: "border-urgent-line bg-urgent-soft text-urgent-ink",
  attention: "border-attention-line bg-attention-soft text-attention-ink",
  done: "border-done-line bg-done-soft text-done-ink",
  quiet: "border-quiet-line bg-quiet-soft text-quiet-ink",
};
