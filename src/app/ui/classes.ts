// The only place button, field, card, chip and layout class strings live (docs/ui-design.md).
// Plain strings, safe anywhere (server, client, the AI and client boundary tests): no imports.
// Every class is written out in full so Tailwind finds it. Add spacing (mt-4, self-start, w-full)
// where you use one: `${btn.primary} mt-4`.

const office =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2 text-center text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60";
const staff =
  "flex w-full min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-center text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60";

// Office buttons (and links that look like buttons): at least 44px tall.
export const btn = {
  // The one main action of a card or form.
  primary: `${office} border-ink bg-ink text-white hover:border-slate-700 hover:bg-slate-700`,
  // Any other action.
  secondary: `${office} border-line-strong bg-white text-ink hover:bg-quiet-soft`,
  // Opens a destructive step ("Cancel this shift", "Turn off access").
  danger: `${office} border-urgent bg-white text-urgent-ink hover:bg-urgent-soft`,
  // The final click of a destructive change: a step's "Yes, …", or a destructive action that
  // happens at once ("Block from this site").
  dangerSolid: `${office} border-urgent bg-urgent text-white hover:border-urgent-ink hover:bg-urgent-ink`,
  // A text link with a 44px target ("Back to …", "Earlier", "Clear").
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-ink underline underline-offset-4 hover:text-ink-muted",
};

// A link inside text or a row (a shift's title, a worker's name): underlined in grey, darker on
// hover. Keeps the text's own size and weight. `textLinkInGroup` darkens when a `group` parent
// (the whole row or card) is hovered.
export const textLink = "underline decoration-line-strong underline-offset-4 hover:decoration-ink";
export const textLinkInGroup =
  "underline decoration-line-strong underline-offset-4 group-hover:decoration-ink";

// Staff buttons: full width, at least 56px tall, for thumbs.
export const staffBtn = {
  primary: `${staff} border-ink bg-ink text-white hover:border-slate-700 hover:bg-slate-700`,
  secondary: `${staff} border-ink bg-white text-ink hover:bg-quiet-soft`,
  danger: `${staff} border-urgent bg-white text-urgent-ink hover:bg-urgent-soft`,
  dangerSolid: `${staff} border-urgent bg-urgent text-white hover:border-urgent-ink hover:bg-urgent-ink`,
};

// Inputs, selects and textareas (office). Add w-full or a width where you use it.
export const field =
  "min-h-11 rounded-lg border-2 border-line-strong bg-white px-3 py-2 text-base font-normal text-ink";
// Staff inputs: full width and bigger.
export const staffField =
  "min-h-14 w-full rounded-xl border-2 border-line-strong bg-white px-4 py-3 text-lg font-normal text-ink";
// A label above its field (htmlFor), or wrapping it: `labelStack` puts the field under the words.
export const label = "block font-semibold text-ink";
export const labelStack = "flex flex-col gap-1 font-semibold text-ink";
// A hint under a field or a form ("Leave it empty to …").
export const hint = "text-sm text-ink-muted";

// A white card on the canvas, for an item with buttons.
export const card = "rounded-xl border border-line bg-white p-4 shadow-sm";
// One card holding compact rows (read-only or repeated items): <ul className={rows}><li className={row}>.
export const rows = "divide-y divide-line rounded-xl border border-line bg-white shadow-sm";
export const row = "px-4 py-3";

// Section heading (h2), and the space between sections and under a heading.
export const h2 = "text-xl font-bold tracking-tight text-ink";
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
// adds no padding of its own; forms stay within 672px. Staff pages are 448px wide. The login
// pages (staff and office, outside the shell) are the brand bar's 448px column, centred.
export const page = {
  office: "min-w-0",
  officeForm: "min-w-0 max-w-2xl",
  staff: "mx-auto max-w-md p-6",
  login: "mx-auto w-full max-w-md px-6 py-8 sm:px-0 sm:py-16",
};

// The login card, inside `page.login`: framed from 640px up; on a phone there's no frame (the
// page is the card), with the same 24px edge as the brand bar. Its one <h1> is `loginTitle`.
export const loginCard = "sm:rounded-xl sm:border sm:border-line sm:bg-white sm:p-6 sm:shadow-sm";
export const loginTitle = "text-3xl font-bold tracking-tight text-balance text-ink";

// Report tables: the wrapper scrolls sideways on small screens. Give it role="region",
// tabIndex={0} and an aria-label. Numbers right aligned (`num`).
export const table = {
  wrap: "overflow-x-auto rounded-xl border border-line bg-white shadow-sm",
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-line bg-quiet-soft px-3 py-2 font-semibold text-ink",
  td: "border-b border-line px-3 py-2 align-top",
  num: "text-right tabular-nums",
};

// Status chips (used by <StatusChip>, src/app/ui/status-chip.tsx). Colour always has its word.
export const chip = {
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 align-middle text-sm font-semibold leading-5",
  urgent: "border-urgent bg-urgent text-white",
  attention: "border-attention bg-attention-soft text-attention-ink",
  done: "border-done bg-done-soft text-done-ink",
  quiet: "border-line-strong bg-quiet-soft text-quiet-ink",
};
