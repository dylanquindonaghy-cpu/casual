import { noticeText } from "./cancel-reasons";
import { roleLabel, timeOnDay } from "./format";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import type { MyStrike } from "./my-strikes";

// The casual's Strikes section on Profile, in words (docs/office-v2.md 4.6; 12C.5). Pure.

const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

// "You have 1 strike in the last 90 days." / "You have 0 strikes in the last 90 days."
export const myStrikeCountText = (n: number, liveDays: number) =>
  `You have ${n} ${n === 1 ? "strike" : "strikes"} in the last ${liveDays} days.`;

// With the firm's strikes switched off (P3.4): those given before stay, and still count.
export const myStrikesOffText = (liveDays: number) =>
  `Strikes are off now: cancelling doesn't give you one. Ones given before count until their ${liveDays} days are up.`;

export const myStrikeRuleText = (noticeHours: number) =>
  `A strike is given when you cancel less than ${noticeHours} hours before a shift starts.`;

// "Steward at Riverside Arena" / "Sat 7 Nov, 14:00 to 22:00" / "Cancelled 18:00 on Fri 6 Nov, with
// 20 hours' notice."
export const myStrikeTitle = (s: MyStrike) =>
  `${roleLabel(s.role)}${s.siteName ? ` at ${s.siteName}` : ""}`;
export const myStrikeSession = (s: MyStrike, tz: string) =>
  `${dayLabel(localDateOf(s.startsAt, tz))}, ${hhmm(s.startsAt, tz)} to ${hhmm(s.endsAt, tz)}`;
export const myStrikeCancelled = (s: MyStrike, tz: string) =>
  `Cancelled ${timeOnDay(s.cancelledAt, tz)}, with ${noticeText(s.noticeHours)}.`;

// Under the list when there are more than it shows.
export const myStrikesMoreText = (shown: number) => `Showing your ${shown} most recent strikes.`;

// "Counts until Thu 4 Feb" / "Withdrawn by the office" / "No longer counts".
export function myStrikeStatus(s: MyStrike, tz: string): string {
  if (s.status === "withdrawn") return "Withdrawn by the office";
  return s.counting ? `Counts until ${dayLabel(localDateOf(s.expiresAt, tz))}` : "No longer counts";
}
