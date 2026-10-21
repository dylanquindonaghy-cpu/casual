import { addDays, localDateOf } from "../time/zoned";
import type { OpenShift } from "./open-shifts";
import { datePartsOfDay } from "./sign-copy";

// Open shifts' strip of the next 8 days (Phase 18; docs/screens.md `/shifts/open`): for each day,
// whether she's booked, how many urgent shifts she can take, or how many open ones. Pure.

export const STRIP_DAYS = 8;

export type StripKind = "booked" | "urgent" | "open" | "none";

export interface StripDay {
  date: string; // yyyy-mm-dd
  dow: string; // "Today" for the first, else "Thu"
  day: string; // "22"
  kind: StripKind;
  count: number; // the urgent shifts on an urgent day, the open ones on an open day
  label: string; // for screen readers: "Thu 22 Oct: 1 urgent shift"
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Booked wins (she has that day), then urgent, then open.
export function shiftsStrip(
  now: Date,
  timeZone: string,
  open: Pick<OpenShift, "startsAt" | "isUrgent">[],
  bookedDays: readonly string[],
): StripDay[] {
  const today = localDateOf(now, timeZone);
  const booked = new Set(bookedDays);
  return Array.from({ length: STRIP_DAYS }, (_, i) => {
    const date = addDays(today, i);
    const p = datePartsOfDay(date);
    const here = open.filter((s) => localDateOf(s.startsAt, timeZone) === date);
    const urgent = here.filter((s) => s.isUrgent).length;
    const kind: StripKind = booked.has(date)
      ? "booked"
      : urgent > 0
        ? "urgent"
        : here.length > 0
          ? "open"
          : "none";
    const count = kind === "urgent" ? urgent : kind === "open" ? here.length : 0;
    const what =
      kind === "booked"
        ? "you're booked"
        : kind === "urgent"
          ? plural(urgent, "urgent shift")
          : kind === "open"
            ? plural(here.length, "open shift")
            : "nothing open";
    return {
      date,
      dow: i === 0 ? "Today" : p.dow,
      day: p.day,
      kind,
      count,
      label: `${p.dow} ${p.day} ${p.month}${i === 0 ? ", today" : ""}: ${what}`,
    };
  });
}
