import { possessive } from "../portal/copy";
import type { StrikeDecision } from "./decide";

// What the casual is told about strikes (docs/office-v2.md 5.7 item 4; the strike's words since
// Phase 27.2: docs/screens.md), exact words. Pure and browser-safe: the warning is chosen by
// strikeDecision() and worded here.

// The warning's wording version, stored on the booking with when they confirmed it (S3). Raise it
// whenever the warning's words change.
export const STRIKE_WARNING_VERSION = "v2";

export type WarningKind = "strike" | "exempt" | "notice";

// A firm cancellation never shows a warning (the casual doesn't see the step).
export function warningKind(decision: StrikeDecision): WarningKind {
  if (decision.result === "strike") return "strike";
  if (decision.result === "exempt") return "exempt";
  return "notice";
}

// "26 hours", "1 hour", "less than an hour"; 48 hours or more in whole days ("5 days"). Rounded
// down, as the notice on the done screen is.
export function startsInText(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  const whole = Math.floor(hours);
  return whole === 1 ? "1 hour" : `${whole} hours`;
}

const strikesText = (n: number) => (n === 1 ? "1 strike" : `${n} strikes`);

// What a strike is, wherever one is explained (the cancel sheet, a shift's page, Profile, Help).
export const STRIKE_IS_A_RECORD = "A strike is a record, not a fine. It never comes off your pay.";

export interface WarningFacts {
  hoursToStart: number;
  thresholdHours: number;
  firmName: string;
  liveStrikes: number; // the casual's live strikes now (before this one)
  liveDays: number;
}

// Every version of the warning's words, as the casual saw them (S3: proof of what they were told;
// a booking keeps the version it was confirmed under, src/lib/roster/cancel.ts). Never change an
// entry: to change the words, add a new version, point STRIKE_WARNING_VERSION at it, and pin its
// words in tests/unit/strikes.test.ts. The blanks are filled from the firm's own settings and the
// casual's own record ({startsIn} "26 hours", {threshold} 48, {firm} "Acme Events'",
// {strikes} "1 strike", {liveDays} 90).
export const STRIKE_WARNING_WORDS: Readonly<Record<string, Readonly<Record<WarningKind, string>>>> =
  {
    // 12C.1 to Phase 27.2 (2026-11-03).
    v1: {
      strike:
        "This shift starts in {startsIn}. Cancelling with less than {threshold} hours' notice " +
        "gives you a strike. {firm} strikes team gets a record of it. You have {strikes} in the " +
        "last {liveDays} days.",
      exempt: "The office booked or changed this shift, so cancelling doesn't give you a strike.",
      notice: "This shift starts in {startsIn}. Cancelling now doesn't give you a strike.",
    },
    // Phase 27.2 (Dylan, 2026-11-03; the launch review's C1): no "strikes team", and what a strike is.
    v2: {
      strike:
        "This shift starts in {startsIn}. Cancelling now gives you a strike (less than " +
        "{threshold} hours' notice). " +
        STRIKE_IS_A_RECORD +
        " You have {strikes} in the last {liveDays} days.",
      exempt: "The office booked or changed this shift, so cancelling doesn't give you a strike.",
      notice: "This shift starts in {startsIn}. Cancelling now doesn't give you a strike.",
    },
  };

// A version's words with its blanks filled (the record's words for an old booking, too).
export function warningWordsFor(version: string, kind: WarningKind, f: WarningFacts): string {
  const words = STRIKE_WARNING_WORDS[version]?.[kind];
  if (!words) throw new Error(`No strike warning words for ${version}`);
  const blanks: Record<string, string> = {
    startsIn: startsInText(f.hoursToStart),
    threshold: String(f.thresholdHours),
    firm: possessive(f.firmName),
    strikes: strikesText(f.liveStrikes),
    liveDays: String(f.liveDays),
  };
  return words.replace(/\{(\w+)\}/g, (_, k: string) => blanks[k] ?? `{${k}}`);
}

// The words a casual sees now.
export function strikeWarningText(kind: WarningKind, f: WarningFacts): string {
  return warningWordsFor(STRIKE_WARNING_VERSION, kind, f);
}

export const CANCEL_FOOTER =
  "Your cancellation is recorded the moment you confirm. Nobody needs to approve it.";

export const WHAT_HAPPENED_PROMPT = "If something stopped you, tell us what happened.";

// The done screen's first line. `until` is the strike's last day, in the firm's words ("Sat 30 Jan").
export function cancelledText(ref: string, strike: { until: string } | null): string {
  return strike
    ? `Cancelled. Reference ${ref}. A strike has been recorded. It counts until ${strike.until}.`
    : `Cancelled. Reference ${ref}. No strike.`;
}
