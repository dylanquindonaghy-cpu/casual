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
// (tests/unit/ui.office-system.test.ts). Phase 22's (round 2, Dylan's approved mock-up): every
// office button is raised off its card (`raise`: a hairline ring and its own small fall), the
// others white pills rather than grey, and dips when pressed and springs back (`press`,
// globals.css). Phase 23's (round 3, Dylan's approved mock-up; docs/ui-design.md "Phase 23"):
// flat. Nothing in the office has depth at rest: white surfaces with a 1px hairline (`line`),
// cards, lists and tables inside a page 22px round (`rounded-inner`), rows, fields and small boxes
// 14px (`rounded-row`); the one main button sky blue with near-black words (`accent`), the others
// white pills with a grey edge; chips and counts flat tinted pills; and still every press dips and
// springs back. The casual app's own strings (`staff…`) keep its Phase 20 look.
const office =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-center text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60";
// In the office (the logged-out office's "Log in" link page), on its spacing: `office:`.
const staff =
  "flex w-full min-h-13 items-center justify-center gap-2 rounded-full border-[1.5px] px-5 py-3 text-center text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60 office:px-4";

// Office buttons (and links that look like buttons): at least 44px tall, each with its hover and
// pressed fills (the focus ring is globals.css's, everywhere).
export const btn = {
  // The one main action of a screen: sky blue with near-black words (Phase 23; near-black in
  // Phases 21 and 22).
  primary: `${office} border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover active:border-accent-press active:bg-accent-press`,
  // Any other action: a white pill with its grey edge, which stays under the pointer and pressed.
  secondary: `${office} border-button-line bg-button text-ink hover:bg-button-hover active:bg-button-press`,
  // Opens a destructive step ("Cancel this shift", "Turn off access"): red words on a white pill.
  danger: `${office} border-button-line bg-button text-urgent hover:bg-button-hover active:bg-button-press`,
  // The final click of a destructive change: a step's "Yes, …", or a destructive action that
  // happens at once ("Block from this site").
  dangerSolid: `${office} border-urgent-fill bg-urgent-fill text-on-urgent hover:border-urgent-fill-hover hover:bg-urgent-fill-hover active:border-urgent-fill-hover active:bg-urgent-fill-hover`,
  // A text link with a 44px target ("Back to …", "Earlier", "Clear"); the casual app's too (in the
  // office, darker while pressed, and it dips like everything you press: `office:press`, Phase 22;
  // a link inside a sentence is text, so it doesn't).
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-ink underline underline-offset-4 hover:text-ink-muted office:press office:active:text-ink-press",
  // A quiet action in words only ("Not urgent", "Add a session").
  text: "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-base font-semibold text-ink hover:bg-quiet-soft active:bg-button-press",
};

// The office's tabs (Phase 23): the "Show" navs over a list (Casuals, Cancellations, Enquiries,
// Strikes) and the events board's filters. A grey track with a hairline (`tabs`), each tab a pill
// 44px tall; the current one (`tabCurrent`, with aria-current) white with a 3:1 edge, never the
// sky main button. On a phone the row scrolls sideways inside its track, never the page.
export const tabs =
  "flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-raised p-1";
export const tab =
  "press inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-transparent px-4 text-base font-medium text-ink-muted hover:text-ink active:bg-button-press";
export const tabCurrent =
  "press inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-card px-4 text-base font-semibold text-ink";

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

// Inputs, selects and textareas (office): white with a 1px edge strong enough to find (3:1), even
// on a tinted panel, darker under the pointer; flat (Phase 23). Add w-full or a width where you
// use it.
export const field =
  "min-h-11 rounded-row border border-line-strong bg-card px-3 py-2 text-base font-normal text-ink transition-colors hover:border-ink-muted pointer-coarse:text-lg";
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
// A key, secret or code shown once (Integrations): white with its hairline, in the system's mono
// so O and 0, l and 1 differ (the one face in the office that isn't Plus Jakarta Sans), easy to
// select whole.
export const codeBox =
  "block rounded-row border border-line bg-card px-3 py-2 font-mono text-base break-all text-ink select-all";
// Staff inputs: full width and bigger.
export const staffField =
  "min-h-14 w-full rounded-xl border-2 border-line-strong bg-card px-4 py-3 text-lg font-normal text-ink";
// A label above its field (htmlFor), or wrapping it: `labelStack` puts the field under the words.
export const label = "block font-semibold text-ink";
export const labelStack = "flex flex-col gap-1 font-semibold text-ink";
// A hint under a field or a form ("Leave it empty to …").
export const hint = "text-sm text-ink-muted";

// A white card on the page, for an item with buttons: the office's (Phase 23: inside the white
// page card, so it has its hairline, 22px round), and the casual app's (`staffCard`).
export const card = "rounded-inner border border-line bg-card p-4 sm:p-6";
export const staffCard = "rounded-2xl border border-line bg-card p-4";
// The casual app's tappable row in a card of rows ("For you", the open shifts' cards): a tile on
// the left, the words, a chevron. Its focus ring sits inside the card.
export const tapRow =
  "flex items-center gap-3.5 p-3.5 text-left hover:bg-quiet-soft focus-visible:-outline-offset-2";
// One card holding compact rows (read-only or repeated items): <ul className={rows}><li className={row}>.
// The office's: one rounded white list with its hairline round it and between its rows (Apple
// Wallet's; Phase 21, flat in Phase 23). The casual app's: `staffRows`, `staffRow`.
export const rows = "divide-y divide-line rounded-inner border border-line bg-card";
export const row = "px-4 py-3";
export const staffRows = "divide-y divide-line rounded-2xl border border-line bg-card";
export const staffRow = "px-4 py-3";

// Section heading (h2), and the space between sections and under a heading.
// In the office (Phase 23) a section heading is bold, as the approved mock-up's.
export const h2 = "text-lg font-semibold tracking-heading text-ink office:font-bold";
export const sectionGap = { office: "mt-8 lg:mt-12", staff: "mt-8" };
export const headingGap = "mt-3";
// A number beside a heading ("Requests 2"): the number only, never a word. The office's count
// (Phase 21; Dylan's brief: "one badge style (grey, red only for urgent)"): a small grey pill, the
// same beside a heading (`count`) and in the menu (`countPill`); the urgent places' count in red
// (`countUrgent`). Phase 22 (round 2, the approved mock-up): in the menu a count takes its
// dashboard card's colour, amber when it needs you (`countNeeds`, Needs attention's) and blue when
// it's waiting with someone else (`countWaiting`, pay queries with payroll). Phase 23: every count
// a flat tinted pill, with no edge. The casual app's own: `staffCount` (Phase 20's).
const countShape =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums";
export const countPill = `${countShape} bg-count text-ink-muted`;
export const countNeeds = `${countShape} bg-hivis text-on-hivis`;
export const countWaiting = `${countShape} bg-wait-tile text-wait-ink`;
export const count = `ml-2 align-middle ${countPill}`;
export const countUrgent = `ml-2 align-middle ${countShape} bg-urgent-tile text-urgent-ink`;
export const staffCount =
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
  // The office's login pages, on its spacing (Phase 21).
  officeLogin: "mx-auto w-full max-w-md px-6 py-8 sm:px-0 sm:py-12",
};

// The login card, inside `page.login`: framed from 640px up; on a phone there's no frame (the
// page is the card), with the same 24px edge as the brand bar. Its one <h1> is `loginTitle`.
export const loginCard = "sm:rounded-3xl sm:border sm:border-line sm:bg-card sm:p-6";
// The office's: a white card with its hairline, as its others (Phase 23).
export const officeLoginCard = "sm:rounded-card sm:border sm:border-line sm:bg-card sm:p-6";
export const loginTitle = "text-title text-balance text-ink";

// Report tables: the wrapper scrolls sideways on small screens. Give it role="region",
// tabIndex={0} and an aria-label. Numbers right aligned (`num`). Grey headers with no band, on the
// card's white (so a sticky heading, the notice report's, hides the rows going under it). The
// office's (Phase 23): a white card with its hairline, 22px round.
export const table = {
  wrap: "overflow-x-auto rounded-inner border border-line bg-card",
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-line bg-card px-4 py-3 font-medium text-ink-muted",
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
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 align-middle text-sm font-semibold leading-5 office:min-h-7 office:border-0 office:px-3 office:py-1 office:leading-4 office:max-w-full office:shrink-0 office:whitespace-normal",
  urgent: "border-urgent-line bg-urgent-soft text-urgent-ink",
  attention: "border-attention-line bg-attention-soft text-attention-ink",
  wait: "border-wait-line bg-wait-soft text-wait-ink",
  done: "border-done-line bg-done-soft text-done-ink",
  quiet: "border-quiet-line bg-quiet-soft text-quiet-ink",
};
