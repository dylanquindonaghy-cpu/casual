import type { StrikeDecision } from "./decide";

// What the casual is told about strikes (docs/office-v2.md 5.7 item 4), exact words. Pure and
// browser-safe: the warning is chosen by strikeDecision() and worded here.

// The warning's wording version, stored on the booking with when they confirmed it (S3). Raise it
// whenever the warning's words change.
export const STRIKE_WARNING_VERSION = "v1";

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

const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const strikesText = (n: number) => (n === 1 ? "1 strike" : `${n} strikes`);

export interface WarningFacts {
  hoursToStart: number;
  thresholdHours: number;
  firmName: string;
  liveStrikes: number; // the casual's live strikes now (before this one)
  liveDays: number;
}

export function strikeWarningText(kind: WarningKind, f: WarningFacts): string {
  switch (kind) {
    case "strike":
      return (
        `This shift starts in ${startsInText(f.hoursToStart)}. Cancelling with less than ` +
        `${f.thresholdHours} hours' notice gives you a strike. ${possessive(f.firmName)} strikes ` +
        `team gets a record of it. You have ${strikesText(f.liveStrikes)} in the last ` +
        `${f.liveDays} days.`
      );
    case "exempt":
      return "The office booked or changed this shift, so cancelling doesn't give you a strike.";
    case "notice":
      return `This shift starts in ${startsInText(f.hoursToStart)}. Cancelling now doesn't give you a strike.`;
  }
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
