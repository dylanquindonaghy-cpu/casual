import { noticeText } from "../portal/cancel-reasons";
import { roleLabel, timeOnDay } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf } from "../time/zoned";
import type { CasualStrike, StrikeView } from "./strikes";

// The Strikes page in words (docs/office-v2.md 3.5; docs/screens.md `/office/strikes`; 12C.5).
// Pure.

export const STRIKE_VIEW_WORDS: Record<StrikeView, string> = {
  live: "Live",
  review: "Needs review",
  all: "All",
};

export const STRIKE_VIEW_EMPTY: Record<StrikeView, string> = {
  live: "No live strikes.",
  review: "No strikes need a review.",
  all: "No strikes yet.",
};

export const strikesIntro = (noticeHours: number, liveDays: number) =>
  `A casual who cancels with less than ${noticeHours} hours' notice gets a strike automatically. It counts for ${liveDays} days. Nothing else happens on its own: what to do next is a person's decision.`;

// "2 live strikes" / "1 live strike" / "No live strikes".
export const liveCountText = (n: number) =>
  n === 0 ? "No live strikes" : `${n} live ${n === 1 ? "strike" : "strikes"}`;

// "Steward at Riverside Arena · 14:00 on Sat 7 Nov · cancelled 18:00 on Fri 6 Nov (20 hours'
// notice)".
export function strikeLine(s: CasualStrike, tz: string): string {
  const what = `${roleLabel(s.role)}${s.siteName ? ` at ${s.siteName}` : ""}`;
  return `${what} · ${timeOnDay(s.startsAt, tz)} · cancelled ${timeOnDay(s.cancelledAt, tz)} (${noticeText(s.noticeHours)})`;
}

// Where a strike stands: "Counts until Thu 4 Feb", "No longer counts", "Withdrawn".
export function strikeStatusText(
  s: Pick<CasualStrike, "status" | "counting" | "expiresAt">,
  tz: string,
): string {
  if (s.status === "withdrawn") return "Withdrawn";
  return s.counting ? `Counts until ${dayLabel(localDateOf(s.expiresAt, tz))}` : "No longer counts";
}
