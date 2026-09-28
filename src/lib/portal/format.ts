import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import type { MyShift } from "./my-shifts";

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

// "door_supervisor" -> "Door supervisor".
export function roleLabel(role: string): string {
  const words = role.replace(/_/g, " ");
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
