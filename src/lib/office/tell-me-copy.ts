// "Tell me about" (Phase 26.4; the spec page's upd-4 and upd-5, decision 5; the mock-up's Updates):
// what each office user asked to be told about, and how. The kinds, the defaults and the words, here
// with no database code, so the page's own parts can use them (the schema's check reads the kinds).

// - popup: a pop-up in the office for every casual's cancellation (upd-3).
// - cancel_push: a notification on their phone or computer for a cancellation under 48 hours'
//   notice (decision 5).
// - open_push: a notification for places still open 6 hours before the start (decision 5).
// - uploads: photos and certificates to check counted as new in Updates (the bell and the dots).
// - summary: an email at 08:00 (the firm's time) with what needs action and what happened.
export const TELL_ME_KINDS = ["popup", "cancel_push", "open_push", "uploads", "summary"] as const;
export type TellMeKind = (typeof TELL_ME_KINDS)[number];

// As the mock-up shows them: all on but uploads (they're on Needs attention and Updates anyway).
export const DEFAULT_TELL_ME: readonly TellMeKind[] = [
  "popup",
  "cancel_push",
  "open_push",
  "summary",
];

const isKind = (k: string): k is TellMeKind => (TELL_ME_KINDS as readonly string[]).includes(k);

// What a person's saved choice comes to (null: never changed, the defaults), in the list's order.
export function tellMeOf(saved: readonly string[] | null): TellMeKind[] {
  if (saved === null) return [...DEFAULT_TELL_ME];
  const chosen = new Set(saved.filter(isKind));
  return TELL_ME_KINDS.filter((k) => chosen.has(k));
}

// The choice with one kind switched on or off.
export function withTellMe(saved: readonly string[] | null, kind: TellMeKind, on: boolean) {
  const now = new Set(tellMeOf(saved));
  if (on) now.add(kind);
  else now.delete(kind);
  return TELL_ME_KINDS.filter((k) => now.has(k));
}

// Cancellations under this many hours' notice, and places still open this many hours before the
// start, are pushed (decision 5).
export const CANCEL_PUSH_HOURS = 48;
export const OPEN_PUSH_HOURS = 6;
// The summary goes from this hour of the firm's day, and not after SUMMARY_LATEST_HOUR (a worker
// that was down all morning doesn't send yesterday's news at teatime).
export const SUMMARY_HOUR = 8;
export const SUMMARY_LATEST_HOUR = 11;

export const TELL_ME_TITLE = "Tell me about";
export const tellMeLine = (mine: boolean) =>
  mine
    ? "Only you get these, for your contracts."
    : "Only you get these. You don't look after any contracts, so they cover every venue.";
export const TELL_ME_ROWS: Record<TellMeKind, { title: string; line: string }> = {
  popup: { title: "Every cancellation", line: "A pop-up in the office" },
  cancel_push: {
    title: "Cancellations under 48 hours",
    line: "Also a notification on my phone or computer",
  },
  open_push: {
    title: "Places still open 6 hours before start",
    line: "A notification on my phone or computer",
  },
  uploads: { title: "Uploads to check", line: "Counted as new in Updates" },
  summary: { title: "A summary at 08:00", line: "By email" },
};

export type TellMeResult =
  | { status: "saved"; kind: TellMeKind; on: boolean }
  | { status: "invalid" }
  | { status: "not_allowed" }
  | { status: "error" };

export function tellMeResultText(r: TellMeResult): string {
  if (r.status === "saved") return `Saved. ${TELL_ME_ROWS[r.kind].title}: ${r.on ? "on" : "off"}.`;
  if (r.status === "not_allowed") return "You can't change this.";
  if (r.status === "invalid") return "That isn't a choice here. Reload the page.";
  return "Something went wrong. Try again.";
}

// Notifications on this browser: the device's own switch, under the list.
export const DEVICE_TITLE = "Notifications on this device";
export const DEVICE_WORDS = {
  // No web push keys on the server (O8): the two switches above can't reach anyone yet.
  no_key:
    "Phone and computer notifications aren't turned on for your firm yet, so these two switches do nothing for now.",
  unsupported: "This browser can't show notifications.",
  add_to_home_screen:
    "On an iPhone, add this page to your home screen first: Share, then Add to Home Screen.",
  blocked: "Notifications are blocked for this site. Allow them in your browser's settings.",
  on: "On. The two notification switches above reach this device.",
  off: "Off. Turn them on to get the notifications you switched on above here.",
} as const;
export const DEVICE_ON = "Turn on notifications here";
export const DEVICE_OFF = "Turn off here";
export const DEVICE_TURNED_ON = "Notifications are on for this device.";
export const DEVICE_TURNED_OFF = "Notifications are off for this device.";
