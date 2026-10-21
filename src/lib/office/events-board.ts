import { addDays, localDateOf } from "../time/zoned";
import { datePartsOfDay, timeRange } from "../portal/sign-copy";
import { roleLabel } from "../portal/format";
import type { EventCardData, SessionRow } from "./events";
import { isFull } from "./events-copy";

// Events & sessions as a rota board (Phase 18; docs/screens.md `/office/events`): 14 days across,
// an event per row, each session a pill on its day saying how many of its places are filled, red
// for an urgent gap, outlined while places are open, grey when full. Pure.

export const BOARD_DAYS = 14;

// The board's two weeks, from the page's `from` (yyyy-mm-dd, a real day after today; anything
// else is today): `later` starts the next two weeks; `earlier` the two weeks before (`today`: back
// to today, which needs no `from`), or null at today (nothing earlier to show).
export function boardWindow(
  fromParam: unknown,
  today: string,
): { from: string; earlier: string | "today" | null; later: string } {
  const real =
    typeof fromParam === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromParam) &&
    addDays(fromParam, 0) === fromParam;
  const from = real && fromParam > today ? fromParam : today;
  const back = addDays(from, -BOARD_DAYS);
  return {
    from,
    earlier: from === today ? null : back > today ? back : "today",
    later: addDays(from, BOARD_DAYS),
  };
}

export interface BoardDay {
  date: string;
  dow: string; // "Today" for today
  day: string;
  weekend: boolean;
  today: boolean;
}

// The board's days from `from` (yyyy-mm-dd).
export function boardDays(from: string, today: string): BoardDay[] {
  return Array.from({ length: BOARD_DAYS }, (_, i) => {
    const date = addDays(from, i);
    const p = datePartsOfDay(date);
    return {
      date,
      dow: date === today ? "Today" : p.dow,
      day: p.day,
      weekend: p.dow === "Sat" || p.dow === "Sun",
      today: date === today,
    };
  });
}

// "21 Oct to 3 Nov".
export function windowText(days: BoardDay[]): string {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return "";
  const a = datePartsOfDay(first.date);
  const b = datePartsOfDay(last.date);
  return `${a.day} ${a.month} to ${b.day} ${b.month}`;
}

export type PillTone = "urgent" | "open" | "full";

export interface Pill {
  shiftId: string;
  text: string; // "3/4": filled out of needed
  tone: PillTone;
  label: string; // "Door supervisor, Thu 22, 08:00–16:00: 3 of 4 filled, urgent"
  sessions?: number; // a day's sessions combined into this one pill (more than DAY_PILLS)
}

// More sessions than this on one day and they show as one pill, their places added up.
export const DAY_PILLS = 2;

export const sessionWhen = (s: Pick<SessionRow, "startsAt" | "endsAt">, timeZone: string) => {
  const p = datePartsOfDay(localDateOf(s.startsAt, timeZone));
  return `${p.dow} ${p.day}, ${timeRange(s.startsAt, s.endsAt, timeZone).range}`;
};

export function pillOf(s: SessionRow, timeZone: string): Pill {
  const full = isFull(s);
  const tone: PillTone = s.urgentGap ? "urgent" : full ? "full" : "open";
  const filled = s.status === "filled" ? s.headcount : Math.min(s.booked, s.headcount);
  return {
    shiftId: s.shiftId,
    text: `${filled}/${s.headcount}`,
    tone,
    label: `${roleLabel(s.role)}, ${sessionWhen(s, timeZone)}: ${filled} of ${s.headcount} filled${
      tone === "urgent" ? ", urgent" : tone === "full" ? ", full" : ""
    }`,
  };
}

// An event's pills, one list per board day (its sessions that start that day); a day with more
// than DAY_PILLS sessions has one pill for them all (red if any has an urgent gap, outlined if any
// has a place open, else grey).
export function eventCells(e: EventCardData, days: BoardDay[], timeZone: string): Pill[][] {
  return days.map((d) => {
    const sessions = e.sessions.filter(
      (s) => s.status !== "cancelled" && localDateOf(s.startsAt, timeZone) === d.date,
    );
    if (sessions.length <= DAY_PILLS) return sessions.map((s) => pillOf(s, timeZone));
    const filled = sessions.reduce(
      (n, s) => n + (s.status === "filled" ? s.headcount : Math.min(s.booked, s.headcount)),
      0,
    );
    const needed = sessions.reduce((n, s) => n + s.headcount, 0);
    const urgent = sessions.filter((s) => s.urgentGap).length;
    const tone: PillTone =
      urgent > 0 ? "urgent" : sessions.some((s) => !isFull(s)) ? "open" : "full";
    const p = datePartsOfDay(d.date);
    return [
      {
        shiftId: `${d.date}-day`,
        text: `${filled}/${needed}`,
        tone,
        sessions: sessions.length,
        label: `${sessions.length} sessions on ${p.dow} ${p.day}: ${filled} of ${needed} places filled${
          urgent > 0 ? `, ${urgent} urgent` : tone === "full" ? ", full" : ""
        }`,
      },
    ];
  });
}

// The line under an event's name: hidden first, then its open places (or full), then its urgent
// gaps. `tone`: urgent when it has an urgent gap and casuals can see it.
export function eventNote(e: EventCardData): { text: string; urgent: boolean } {
  const urgent = e.sessions.filter((s) => s.urgentGap).length;
  const parts = [
    ...(e.showing ? [] : ["Hidden from casuals"]),
    e.placesFree > 0 ? `${e.placesFree} open` : "Full",
    ...(urgent > 0 ? [`${urgent} urgent`] : []),
  ];
  return { text: parts.join(", "), urgent: urgent > 0 && e.showing };
}
