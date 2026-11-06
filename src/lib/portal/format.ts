import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import type { MyShift } from "./my-shifts";
import { pounds } from "./pay-format";
import { roleWords } from "../text/role";

// How the staff portal shows a shift (docs/screens.md copy rules: short, plain, readable). Pure
// functions: the page passes the firm's time zone (times are stored in UTC, shown in London time).

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (instant: Date, timeZone: string) => {
  const w = wallTimeOf(instant, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// "Sat 7 Nov, 14:00 to 22:00"; a night shift names its second day: "Sat 7 Nov, 22:00 to 06:00 Sun".
export function shiftWhen(startsAt: Date, endsAt: Date, timeZone: string): string {
  const startDay = localDateOf(startsAt, timeZone);
  const endDay = localDateOf(endsAt, timeZone);
  const start = `${dayLabel(startDay)}, ${timeOf(startsAt, timeZone)}`;
  const end = timeOf(endsAt, timeZone);
  if (endDay === startDay) return `${start} to ${end}`;
  // Ending at midnight belongs to the day the shift started.
  if (end === "00:00" && localDateOf(new Date(endsAt.getTime() - 1), timeZone) === startDay) {
    return `${start} to midnight`;
  }
  return `${start} to ${end} ${dayLabel(endDay).split(" ")[0]}`;
}

// "Steward · Raceday": the role and, when the session has one, its event.
export function roleAndEvent(role: string, eventName: string | null | undefined): string {
  return eventName ? `${roleLabel(role)} · ${eventName}` : roleLabel(role);
}

// A session's length in hours (never below 0).
export const sessionHours = (startsAt: Date, endsAt: Date): number =>
  Math.max(0, endsAt.getTime() - startsAt.getTime()) / 3_600_000;

// The pay estimate, in pence: the rate times the session's length (a guide: breaks and the firm's
// own rounding can change it). The one sum: the booked shift's page, the pass's details and Home's
// next-shift line (Phase 30.1) all use it.
export const payEstimatePence = (ratePence: number, startsAt: Date, endsAt: Date): number =>
  Math.round(ratePence * sessionHours(startsAt, endsAt));

// "£12.60 an hour, about £100.80 before tax": the rate, and the estimate.
export function payWords(ratePence: number, startsAt: Date, endsAt: Date): string {
  return `${pounds(ratePence)} an hour, about ${pounds(payEstimatePence(ratePence, startsAt, endsAt))} before tax`;
}

// "£12.60/hour", for a line of facts.
export const perHour = (ratePence: number): string => `${pounds(ratePence)}/hour`;

// A session with no pay rate set: where its pay would be, never a blank. On its own ("Pay not
// given yet", an open shift's card, which opens the shift's page where she can ask the office about
// it: Phase 28, 28.8), or under a "Pay" label ("Ask the office", the pass's details). A shift's own
// page has its own words since 28.5: "Not given yet." and an "Ask the office about the pay" link
// (src/lib/portal/shift-page-copy.ts).
export const NO_RATE_TEXT = "Pay not given yet";
export const NO_RATE_UNDER_LABEL = "Ask the office";

// A role mid-sentence: "CSAS officer" (src/lib/text/role.ts).
export { roleWords };

// "door_supervisor" -> "Door supervisor"; an acronym stays in capitals ("csas_officer" -> "CSAS
// officer").
export function roleLabel(role: string): string {
  const words = roleWords(role);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The site's address on one line, or null when it has none.
export function siteAddress(site: NonNullable<MyShift["site"]>): string | null {
  const parts = [site.addressLine1, site.addressLine2, site.town, site.postcode]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}

// A maps search link for the site, for the worker's phone to open. Only a link: nothing is sent
// anywhere until the worker taps it. Null without an address (a site name alone is too vague).
export function mapLink(site: NonNullable<MyShift["site"]>): string | null {
  const address = siteAddress(site);
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.name}, ${address}`)}`;
}

// A shift that has started and not ended.
export const isOnNow = (shift: Pick<MyShift, "startsAt" | "endsAt">, now: Date) =>
  shift.startsAt.getTime() <= now.getTime() && now.getTime() < shift.endsAt.getTime();

// A moment with its day, for "when": "14:05 on Mon 2 Nov".
export function timeOnDay(instant: Date, timeZone: string): string {
  return `${timeOf(instant, timeZone)} on ${dayLabel(localDateOf(instant, timeZone))}`;
}

// A moment soon after now, as the worker would say it: "14:15" today, "Sat 7 Nov, 00:10" otherwise.
export function soonLabel(instant: Date, now: Date, timeZone: string): string {
  const time = timeOf(instant, timeZone);
  const day = localDateOf(instant, timeZone);
  return day === localDateOf(now, timeZone) ? time : `${dayLabel(day)}, ${time}`;
}

// "today", "tomorrow" or "on Sat 7 Nov", in the firm's time zone.
export function dayWords(startsAt: Date, now: Date, timeZone: string): string {
  const day = localDateOf(startsAt, timeZone);
  const today = localDateOf(now, timeZone);
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  return `on ${dayLabel(day)}`;
}
