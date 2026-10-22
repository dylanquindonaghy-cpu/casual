// The only place button, field, card, chip and layout class strings live (docs/ui-design.md).
// Plain strings, safe anywhere (server, client, the AI and client boundary tests): no imports.
// Every class is written out in full so Tailwind finds it. Add spacing (mt-4, self-start, w-full)
// where you use one: `${btn.primary} mt-4`.

// Phase 17's look ("easier to scan"): one hairline on cards, a 1px border on office controls.
// Phase 18's (the redesign): one filled button per screen, in the firm's own colour (`brand`) on
// the casual app and in the office; phone buttons 52px, office ones 44px. Phase 20's: buttons are
// pills, and depth comes from the five depth tokens only (globals.css).
const office =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-center text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60";
const staff =
  "flex w-full min-h-13 items-center justify-center gap-2 rounded-full border-[1.5px] px-5 py-3 text-center text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60";

// Office buttons (and links that look like buttons): at least 44px tall.
export const btn = {
  // The one main action of a card or form, in the firm's colour.
  primary: `${office} border-brand bg-brand text-on-brand hover:brightness-110`,
  // Any other action.
  secondary: `${office} border-line-strong bg-card text-ink hover:bg-quiet-soft`,
  // Opens a destructive step ("Cancel this shift", "Turn off access").
  danger: `${office} border-urgent bg-card text-urgent-ink hover:bg-urgent-soft`,
  // The final click of a destructive change: a step's "Yes, …", or a destructive action that
  // happens at once ("Block from this site").
  dangerSolid: `${office} border-urgent-fill bg-urgent-fill text-on-urgent hover:border-urgent-fill-hover hover:bg-urgent-fill-hover`,
  // A text link with a 44px target ("Back to …", "Earlier", "Clear").
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-ink underline underline-offset-4 hover:text-ink-muted",
  // A quiet action in words only ("Not urgent", "Add a session"), in the firm's colour.
  text: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-base font-semibold text-brand-ink hover:bg-quiet-soft",
};

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

// A smaller staff button, two to a row ("Ask for a change" beside "Can't make it?" on the pass).
export const staffBtnSmall =
  "flex min-h-13 items-center justify-center rounded-full border-[1.5px] border-line-strong bg-card px-3 py-2 text-center text-base font-semibold text-ink hover:bg-quiet-soft";

// A two-way switch's sunk track (Open | Booked, Upcoming | Past 30 days on the Shifts tab): two
// halves, the current one a lifted pill (src/app/my-shifts-view.tsx Toggle).
export const switchTrack = "grid grid-cols-2 gap-1 rounded-full bg-raised p-1 inset-shadow-sunk";

// Inputs, selects and textareas (office). Add w-full or a width where you use it.
export const field =
  "min-h-11 rounded-lg border border-line-strong bg-card px-3 py-2 text-base font-normal text-ink pointer-coarse:text-lg";
// Staff inputs: full width and bigger.
export const staffField =
  "min-h-14 w-full rounded-xl border-2 border-line-strong bg-card px-4 py-3 text-lg font-normal text-ink";
// A label above its field (htmlFor), or wrapping it: `labelStack` puts the field under the words.
export const label = "block font-semibold text-ink";
export const labelStack = "flex flex-col gap-1 font-semibold text-ink";
// A hint under a field or a form ("Leave it empty to …").
export const hint = "text-sm text-ink-muted";

// A white card on the canvas, for an item with buttons.
export const card = "rounded-2xl border border-line bg-card p-4";
// The casual app's tappable row in a card of rows ("For you", the open shifts' cards): a tile on
// the left, the words, a chevron. Its focus ring sits inside the card.
export const tapRow =
  "flex items-center gap-3.5 p-3.5 text-left hover:bg-quiet-soft focus-visible:-outline-offset-2";
// One card holding compact rows (read-only or repeated items): <ul className={rows}><li className={row}>.
export const rows = "divide-y divide-line rounded-2xl border border-line bg-card";
export const row = "px-4 py-3";

// Section heading (h2), and the space between sections and under a heading.
export const h2 = "text-lg font-semibold tracking-tight text-ink";
export const sectionGap = { office: "mt-10", staff: "mt-8" };
export const headingGap = "mt-3";
// A number beside a heading ("Requests 2"): the number only, never a word.
export const count =
  "ml-2 inline-flex min-w-7 items-center justify-center rounded-full bg-quiet-soft px-2 align-middle text-sm font-semibold tabular-nums text-quiet-ink";

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
export const loginTitle = "text-2xl font-semibold tracking-tight text-balance text-ink";

// Report tables: the wrapper scrolls sideways on small screens. Give it role="region",
// tabIndex={0} and an aria-label. Numbers right aligned (`num`). Grey headers with no band.
export const table = {
  wrap: "overflow-x-auto rounded-2xl border border-line bg-card",
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-line px-3 py-2 font-semibold text-ink-muted",
  td: "border-b border-line px-3 py-2 align-top",
  num: "text-right tabular-nums",
};

// Status chips (used by <StatusChip>, src/app/ui/status-chip.tsx). Colour always has its word.
// Pale tints with dark words of the same hue, so a list of urgent rows doesn't shout; square-ish
// like a sign (Phase 18). The solid plates are <Plate> (src/app/ui/plate.tsx).
export const chip = {
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 align-middle text-sm font-semibold leading-5",
  urgent: "border-urgent bg-urgent-soft text-urgent-ink",
  attention: "border-attention bg-attention-soft text-attention-ink",
  done: "border-done bg-done-soft text-done-ink",
  quiet: "border-line-strong bg-quiet-soft text-quiet-ink",
};
