import { addDays, localDateOf, zonedToUtc } from "../time/zoned";

// The daily offer cap (docs/messaging-templates.md, "Notification policy"): at most 3 shift offers
// per worker per day, unless the offer is urgent. "A day" is the firm's calendar day, midnight to
// midnight local time. Every offer the worker got that day counts, urgent ones too (they still
// landed on their phone); one that failed to send doesn't. Pure functions: the candidate list
// (src/lib/offers/candidates.ts) counts the offers and asks.

export const DAILY_OFFER_CAP = 3;

export function mayOfferToday(input: { offersToday: number; urgent: boolean }): boolean {
  return input.urgent || input.offersToday < DAILY_OFFER_CAP;
}

// The firm-local day `now` falls in, as UTC instants: [from, to). 23 or 25 hours long on the days
// the clocks change.
export function localDayOf(now: Date, timeZone: string): { from: Date; to: Date } {
  const today = localDateOf(now, timeZone);
  const midnight = (isoDate: string) => {
    const [year = 2000, month = 1, day = 1] = isoDate.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
  };
  return { from: midnight(today), to: midnight(addDays(today, 1)) };
}
