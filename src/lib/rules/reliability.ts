// Reliability (Phase 26.7, the spec page's cas-1, cas-2 and aud-11; decision 3): worked out by
// code from what the office marked and what was logged, never by AI. Pure functions over a casual's
// counts, so every rule here is tested on its own (tests/unit/rules.reliability.test.ts).
//
// - Over the last 90 days: worked ÷ (worked + no-shows + cancellations under 48 hours' notice). Only
//   sessions someone marked count as worked or not attended (an unmarked one counts for neither).
// - At least 5 of those (worked, no-shows and late cancellations together) before it's a figure;
//   fewer: "New", with the counts beside it.
// - Its band: green from 90%, amber from 75%, red below.
// - Regular: worked in 6 or more of the last 8 weeks. Reliable: 95% or more. Cancel often: 3 or
//   more cancellations under 48 hours. Not worked lately: nothing worked in the last 60 days.
// - Who's offered first doesn't change (cas-7): nothing here is read by the offer waves.

export const RELIABILITY_DAYS = 90;
export const RELIABILITY_MIN = 5;
export const LATE_NOTICE_HOURS = 48;
export const REGULAR_WEEKS = 6;
export const REGULAR_OF_WEEKS = 8;
export const RELIABLE_PERCENT = 95;
export const CANCEL_OFTEN = 3;
export const NOT_WORKED_DAYS = 60;

export interface ReliabilityCounts {
  worked: number; // marked worked, in the window
  noShows: number; // marked not attended, in the window
  lateCancels: number; // their own cancellations under 48 hours' notice, in the window
}

export type Reliability =
  | { kind: "figure"; percent: number; band: "green" | "amber" | "red"; counts: ReliabilityCounts }
  | { kind: "new"; counted: number; counts: ReliabilityCounts };

export function reliabilityOf(c: ReliabilityCounts): Reliability {
  const counted = c.worked + c.noShows + c.lateCancels;
  if (counted < RELIABILITY_MIN) return { kind: "new", counted, counts: c };
  // Whole percent, rounded down, so 94.9% is never shown as reliable's 95%.
  const percent = Math.floor((c.worked / counted) * 100);
  const band = percent >= 90 ? "green" : percent >= 75 ? "amber" : "red";
  return { kind: "figure", percent, band, counts: c };
}

export interface CasualStanding {
  regular: boolean;
  reliable: boolean;
  cancelOften: boolean;
  notWorkedLately: boolean;
}

export function standingOf(
  r: Reliability,
  weeksWorked: number, // of the last REGULAR_OF_WEEKS weeks, how many with a shift worked
  daysSinceWorked: number | null, // null: never worked
): CasualStanding {
  return {
    regular: weeksWorked >= REGULAR_WEEKS,
    reliable: r.kind === "figure" && r.percent >= RELIABLE_PERCENT,
    cancelOften: r.counts.lateCancels >= CANCEL_OFTEN,
    notWorkedLately: daysSinceWorked === null || daysSinceWorked > NOT_WORKED_DAYS,
  };
}

// In words: "98%" or "New: 3 shifts so far"; and the counts, always beside it.
export function reliabilityWords(r: Reliability): string {
  if (r.kind === "figure") return `${r.percent}%`;
  return `New: ${r.counted} ${r.counted === 1 ? "shift" : "shifts"} so far`;
}

// A casual's own Profile while they're new (fewer than RELIABILITY_MIN counted): no score yet, and
// when they'll get one (the counts beside it show how far along they are).
export const NEW_RELIABILITY_TEXT = "You're new, so there's no score yet.";
export const NEW_RELIABILITY_WHEN = `You'll get one after ${RELIABILITY_MIN} shifts.`;

// "0 shifts worked · 0 no-shows · 0 late cancellations" (the office's casual page shows it too).
export function countsWords(c: ReliabilityCounts): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    n(c.worked, "shift worked", "shifts worked"),
    n(c.noShows, "no-show", "no-shows"),
    n(c.lateCancels, "late cancellation", "late cancellations"),
  ].join(" · ");
}
