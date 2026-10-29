// The only place button, field, card, chip and layout class strings live (docs/ui-design.md).
// Plain strings, safe anywhere (server, client, the AI and client boundary tests): no imports.
// Every class is written out in full so Tailwind finds it. Add spacing (mt-4, self-start, w-full)
// where you use one: `${btn.primary} mt-4`.

// Phase 18 (the redesign): one main button per screen; phone buttons 52px, office ones 44px.
// Phase 20: buttons are pills. Phase 22 (Dylan: "subtle reactive on click responses"): everything
// you press reacts. Phase 24 (round 7 of the Design canvas: Liquid Glass; docs/ui-design.md
// "Phase 24"), in the office and the casual app alike: sections are frosted glass (`glass`:
// cards, lists, tables, 22px round in the office), the parts inside them clear glass
// (`glass-tile`, `glass-button`: fields, counts, buttons), the one main button tinted glass in the
// firm's own colour (`glass-tint`), a row of tabs a glass track with a lens on the chosen one;
// buttons swell a little under a press and spring back (`press-glass`), cards and rows dip
// (`press`). No hairlines round the glass: its lit rim is its edge.
const office =
  "press-glass inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-center text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60";
// In the office (the logged-out office's "Log in" link page), on its spacing: `office:`.
const staff =
  "press-glass flex w-full min-h-13 items-center justify-center gap-2 rounded-full px-5 py-3 text-center text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60 office:px-4";

// Office buttons (and links that look like buttons): at least 44px tall, each with its hover and
// pressed fills (the focus ring is globals.css's, everywhere).
export const btn = {
  // The one main action of a screen: tinted glass in the firm's colour, white (or ink) words.
  primary: `${office} glass-tint hover:brightness-105`,
  // Any other action: a clear glass pill, brighter under the pointer and pressed.
  secondary: `${office} glass-button text-ink hover:bg-button-hover active:bg-button-press`,
  // Opens a destructive step ("Cancel this shift", "Turn off access"): red words on clear glass.
  danger: `${office} glass-button text-urgent hover:bg-button-hover active:bg-button-press`,
  // The final click of a destructive change: a step's "Yes, …", or a destructive action that
  // happens at once ("Block from this site").
  dangerSolid: `${office} bg-urgent-fill text-on-urgent hover:bg-urgent-fill-hover active:bg-urgent-fill-hover`,
  // A text link with a 44px target ("Back to …", "Earlier", "Clear"); the casual app's too (in the
  // office, darker while pressed, and it dips like everything you press: `office:press`, Phase 22;
  // a link inside a sentence is text, so it doesn't).
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-ink underline underline-offset-4 hover:text-ink-muted office:press office:active:text-ink-press",
  // A quiet action in words only ("Not urgent", "Add a session").
  text: "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-base font-semibold text-ink hover:bg-button-hover active:bg-button-press",
};

// The office's tabs: the "Show" navs over a list (Casuals, Cancellations, Enquiries, Strikes) and
// the filters over the events. A glass track (`tabs`), each tab a pill 44px tall; the current one
// (`tabCurrent`, with aria-current) under a lens of bright glass, never the main button. On a phone
// the row scrolls sideways inside its track, never the page.
export const tabs = "glass flex w-fit max-w-full gap-1 overflow-x-auto rounded-full p-1";
export const tab =
  "press-glass inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-base font-medium text-ink-muted hover:text-ink active:bg-button-press";
export const tabCurrent =
  "press-glass lens inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-base font-semibold text-ink";
// A tab's count (Phase 24, round 7): a small glass disc; on the current tab, the accent's.
export const tabCount = (current: boolean) =>
  `inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums ${current ? "bg-accent text-on-accent" : "glass-button text-ink"}`;

// A quiet grey link beside a heading, to the whole list ("All on Events & sessions", "Open Needs
// attention": hilos's "View all"; Phase 21). Standalone, so no underline; 44px tall.
export const quietLink =
  "press inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink active:text-ink-press";

// A link inside text or a row (a shift's title, a worker's name): underlined in grey, darker on
// hover. Keeps the text's own size and weight. `textLinkInGroup` darkens when a `group` parent
// (the whole row or card) is hovered.
export const textLink = "underline decoration-line-strong underline-offset-4 hover:decoration-ink";
export const textLinkInGroup =
  "underline decoration-line-strong underline-offset-4 group-hover:decoration-ink";

// Staff buttons: full width, at least 52px tall, for thumbs. The main one tinted glass in the
// firm's colour, the others clear glass.
export const staffBtn = {
  primary: `${staff} glass-tint hover:brightness-105`,
  secondary: `${staff} glass-button text-ink hover:bg-button-hover`,
  // Opens a destructive step: quiet red words, so it doesn't compete with the main action.
  danger: `${staff} bg-transparent text-urgent hover:bg-urgent-soft`,
  dangerSolid: `${staff} bg-urgent-fill text-on-urgent hover:bg-urgent-fill-hover`,
  // A way out in words, in the firm's colour ("Keep my shift").
  text: `${staff} bg-transparent text-brand-ink hover:bg-button-hover`,
};

// A compact clear glass button in a line of the casual app ("Remove" a day, "Site and role").
export const staffBtnInline =
  "press-glass glass-button inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-center text-base font-semibold text-ink hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-60";

// A smaller staff button, two to a row ("Ask for a change" beside "Can't make it?" on a later
// booking).
export const staffBtnSmall =
  "press-glass glass-button flex min-h-13 items-center justify-center rounded-full px-3 py-2 text-center text-base font-semibold text-ink hover:bg-button-hover";

// A two-way switch's track (Open | Booked, Upcoming | Past 30 days on the Shifts tab): two halves
// on a glass track, the current one under a lens (src/app/my-shifts-view.tsx Toggle).
export const switchTrack = "glass-track grid grid-cols-2 gap-1 rounded-full p-1";

// Inputs, selects and textareas: clear glass with its lit rim, a strong edge (3:1) on focus and
// under the pointer. Add w-full or a width where you use it.
export const field =
  "glass-tile min-h-11 rounded-row border border-transparent px-3 py-2 text-base font-normal text-ink transition-colors hover:border-line-strong pointer-coarse:text-lg";
// The second step before something destructive ("Yes, revoke it", "Yes, cancel …'s booking"): a
// red wash with its edge (the office's every such step uses it, tests/unit/ui.office-system.test.ts).
export const confirmStep = "rounded-row border border-urgent-line bg-urgent-soft p-4";
// The second step before a change that takes nothing away ("Yes, make them an admin", "Yes, mark
// them as worked", "Yes, mark as filled"): the same, in grey.
export const checkStep = "rounded-row border border-quiet-line bg-quiet-soft p-4";
// A notice in a page (Phase 23): what the AI or the voicemail line did, what a key or a webhook
// will show only once. An amber wash with its edge.
export const notice =
  "rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink";
// A key, secret or code shown once (Integrations): clear glass, in the system's mono so O and 0,
// l and 1 differ (the one face that isn't Geist), easy to select whole.
export const codeBox =
  "glass-tile block rounded-row px-3 py-2 font-mono text-base break-all text-ink select-all";
// Staff inputs: full width and bigger, clear glass with a strong edge under the pointer.
export const staffField =
  "glass-tile min-h-14 w-full rounded-2xl border border-transparent px-4 py-3 text-lg font-normal text-ink hover:border-line-strong";
// A label above its field (htmlFor), or wrapping it: `labelStack` puts the field under the words.
export const label = "block font-semibold text-ink";
export const labelStack = "flex flex-col gap-1 font-semibold text-ink";
// A hint under a field or a form ("Leave it empty to …").
export const hint = "text-sm text-ink-muted";

// A glass card, for an item with buttons: the office's (22px round) and the casual app's
// (`staffCard`, 20px).
export const card = "glass rounded-inner p-4 sm:p-6";
export const staffCard = "glass rounded-[1.25rem] p-4";
// The casual app's tappable row in a card of rows ("Do this", the open shifts' cards): a tile on
// the left, the words, a chevron. Its focus ring sits inside the card.
export const tapRow =
  "flex items-center gap-3.5 p-3.5 text-left hover:bg-button-hover focus-visible:-outline-offset-2";
// One glass card holding compact rows (read-only or repeated items): <ul className={rows}><li
// className={row}>, a faint line between rows. The casual app's: `staffRows`, `staffRow`.
export const rows = "glass divide-y divide-line rounded-inner";
export const row = "px-4 py-3";
export const staffRows = "glass divide-y divide-line rounded-[1.25rem]";
export const staffRow = "px-4 py-3";

// Section heading (h2), and the space between sections and under a heading.
// In the office (Phase 23) a section heading is bold, as the approved mock-up's.
export const h2 = "text-lg font-semibold tracking-heading text-ink office:font-bold";
export const sectionGap = { office: "mt-8 lg:mt-12", staff: "mt-8" };
// The casual app's section heading between cards (Phase 24, round 7: "Do this", "Urgent, needed
// now", "Earlier weeks", "Later"): 20px medium. A card's own title stays `h2`.
export const staffH2 = "text-2xl font-medium tracking-heading text-ink";
export const headingGap = "mt-3";
// A number beside a heading ("Requests 2"): the number only, never a word. The office's count
// (Phase 21; Dylan's brief: "one badge style (grey, red only for urgent)"): a small grey pill, the
// same beside a heading (`count`) and in the menu (`countPill`) (the urgent places' red count,
// `countUrgent`, went with them in Phase 24). Phase 22 (round 2, the approved mock-up): in the menu a count takes its
// dashboard card's colour, amber when it needs you (`countNeeds`, Needs attention's) and blue when
// it's waiting with someone else (`countWaiting`, pay queries with payroll). Phase 23: every count
// a flat tinted pill, with no edge. The casual app's own: `staffCount` (Phase 20's).
const countShape =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums";
export const countPill = `${countShape} glass-button text-ink-muted`;
export const countNeeds = `${countShape} glass-rim bg-hivis text-on-hivis`;
export const countWaiting = `${countShape} glass-rim bg-wait-tile text-wait-ink`;
export const count = `ml-2 align-middle ${countPill}`;
export const staffCount =
  "glass-button ml-2 inline-flex min-w-7 items-center justify-center rounded-full px-2 align-middle text-sm font-semibold tabular-nums text-ink-muted";

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
  // The office's login pages, on its spacing (Phase 21).
  officeLogin: "mx-auto w-full max-w-md px-6 py-8 sm:px-0 sm:py-12",
};

// The login card, inside `page.login`: glass from 640px up; on a phone there's no frame (the page
// is the card), with the same 24px edge as the brand bar. Its one <h1> is `loginTitle`.
export const loginCard = "sm:glass sm:rounded-card sm:p-6";
// The office's: the same.
export const officeLoginCard = "sm:glass sm:rounded-card sm:p-6";
export const loginTitle = "text-title text-balance text-ink";

// Report tables: the wrapper scrolls sideways on small screens. Give it role="region",
// tabIndex={0} and an aria-label. Numbers right aligned (`num`). A glass section, 22px round; its
// grey headers on frosted glass of their own (so a sticky heading, the notice report's, blurs the
// rows going under it).
export const table = {
  wrap: "glass overflow-x-auto rounded-inner",
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-line bg-panel px-4 py-3 font-medium text-ink-muted backdrop-blur-md",
  td: "border-b border-line px-4 py-3 align-top",
  num: "text-right tabular-nums",
};

// Status chips (used by <StatusChip>, src/app/ui/status-chip.tsx). Colour always has its word.
// Pale tints with dark words of the same hue, so a list of urgent rows doesn't shout; square-ish
// like a sign (Phase 18). The solid plates are <Plate> (src/app/ui/plate.tsx). Its edge is the
// status's own line token: the status colour in the casual app. In the office (Phase 23) a chip
// is a borderless tinted pill at least 28px tall (`office:` values), and it stays on one line
// while it fits and wraps rather than run off a phone ("Level 2 spectator safety qualification:
// Expiring soon" on a 390px screen; the browser tests' office.look.spec.ts caught it). `wait`
// (Phase 23): blue, waiting on someone else (a casual's answer, payroll), never on you.
export const chip = {
  base: "glass-rim inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 align-middle text-sm font-semibold leading-5 office:min-h-7 office:border-0 office:px-3 office:py-1 office:leading-4 office:max-w-full office:shrink-0 office:whitespace-normal",
  urgent: "border-urgent-line bg-urgent-soft text-urgent-ink",
  attention: "border-attention-line bg-attention-soft text-attention-ink",
  wait: "border-wait-line bg-wait-soft text-wait-ink",
  done: "border-done-line bg-done-soft text-done-ink",
  quiet: "border-quiet-line bg-quiet-soft text-quiet-ink",
};
