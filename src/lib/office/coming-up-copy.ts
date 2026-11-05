import { roleLabel } from "../portal/format";
import { timeRange } from "../portal/sign-copy";
import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, startOfDay } from "../time/zoned";
import { expiredText } from "./dashboard-copy";

// The dashboard's Coming up in words (Phase 27.9; docs/screens.md "/office, round 8"): who's
// working on the person's contracts today and tomorrow, by session, each person by name, flagged
// where their licence won't be in date for it or they've asked to change times. Pure: the loader
// (coming-up.ts) reads the rows and decides the flags (the credential rule is
// dashboard.ts outOfDateBookings), the page and the tests call these with what it read. The days
// are the firm's calendar days, so "today" and "tomorrow" hold across midnight and the clock change.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Sessions the column lists before "All sessions" (the loader says whether there were more).
export const COMING_UP_SHOWN = 6;

// Today and tomorrow in the firm's time zone (yyyy-mm-dd), and the end of tomorrow: the next
// midnight but one, 23 or 25 hours after the one before on the days the clocks change.
export function comingUpDays(
  now: Date,
  timeZone: string,
): { today: string; tomorrow: string; end: Date } {
  const today = localDateOf(now, timeZone);
  return { today, tomorrow: addDays(today, 1), end: startOfDay(addDays(today, 2), timeZone) };
}

// A session's day, from where the person stands: "Today", "Tomorrow", "Yesterday" (a night shift
// still under way), else its date ("Wed 4 Nov").
export function dayWord(startsAt: Date, now: Date, timeZone: string): string {
  const day = localDateOf(startsAt, timeZone);
  const today = localDateOf(now, timeZone);
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayLabel(day);
}

export interface ComingUpHeading {
  role: string;
  site: string | null; // the session's venue, else its event's
  eventName: string; // when it has no venue at all
  startsAt: Date;
  endsAt: Date;
}

// A session's line, a link to its page: "Today 19:00–01:00 · CSAS officer · Northgate Demo Town
// Centre".
export function comingUpHeading(s: ComingUpHeading, now: Date, timeZone: string): string {
  const when = `${dayWord(s.startsAt, now, timeZone)} ${timeRange(s.startsAt, s.endsAt, timeZone).range}`;
  return [when, roleLabel(s.role), s.site ?? s.eventName].join(" · ");
}

// "3 of 4 booked".
export const bookedOf = (booked: number, headcount: number) => `${booked} of ${headcount} booked`;

// Red: places still free on a session that starts today.
export function placesShort(
  s: { booked: number; headcount: number; startsAt: Date },
  now: Date,
  timeZone: string,
): boolean {
  return s.booked < s.headcount && localDateOf(s.startsAt, timeZone) === localDateOf(now, timeZone);
}

// Under the title: "Today and tomorrow · 5 people on 3 sessions", "… on your contracts" when the
// dashboard is narrowed to the person's contracts.
export function comingUpLine(people: number, sessions: number, mine: boolean): string {
  const counts = `${plural(people, "person", "people")} on ${plural(sessions, "session", "sessions")}`;
  return `Today and tomorrow · ${counts}${mine ? " on your contracts" : ""}`;
}

// Nobody booked: what the column says.
export const comingUpEmpty = (mine: boolean) =>
  mine
    ? "Nobody's booked on your contracts today or tomorrow."
    : "Nobody's booked today or tomorrow.";

// The column's foot: every session by day (Events & sessions' "All sessions by day").
export const COMING_UP_ALL = "All sessions";
export const COMING_UP_ALL_HREF = "/office/shifts";

// A session's line for a screen reader: "Open the session: Today 19:00–01:00 · CSAS officer ·
// Northgate Demo Town Centre, 3 of 4 booked".
export const sessionLabel = (heading: string, booked: string) =>
  `Open the session: ${heading}, ${booked}`;

// --- A person's flags ---

// A licence (a qualification the session needs) that won't be in date for it: the rule's own
// (dashboard.ts outOfDateBookings), with its name and the day it ran or runs out (null: marked
// expired by the office).
export interface ComingUpLicence {
  credential: string;
  expiresOn: string | null; // yyyy-mm-dd
}

// The chip, short, by the qualification's own name (credentials are each sector's data, never
// "licence" for all): "SIA door supervisor licence out of date" (it has run out, or is marked
// expired), or "SIA door supervisor licence runs out Sat 7 Nov" (still in date today, but not for
// the whole session), as expiredText reads it.
export function licenceChip(l: ComingUpLicence, today: string): string {
  if (l.expiresOn === null || l.expiresOn < today) return `${l.credential} out of date`;
  return `${l.credential} runs out ${dayLabel(l.expiresOn)}`;
}

// The chip's full words (a screen reader's, and its tip): Needs attention's own sentence, "Zoe
// Adeyemi's SIA door supervisor licence runs out on Sat 7 Nov, during their door supervisor session
// on Sat 7 Nov."
export function licenceWords(
  name: string,
  l: ComingUpLicence,
  s: { role: string; startsAt: Date },
  today: string,
  timeZone: string,
): string {
  return expiredText(
    { worker: name, credential: l.credential, expiresOn: l.expiresOn, ...s },
    today,
    timeZone,
  );
}

// They've asked for a change to this session, waiting for an answer (Enquiries' Requests from the
// app): a time change or a swap.
export type AskedType = "time_change" | "swap";

export function askedChip(type: AskedType): string {
  return type === "swap" ? "Asked to swap" : "Asked to change times";
}

// Its link's name: "Zoe Adeyemi asked to change times. Open their request."
export const askedLabel = (name: string, type: AskedType) =>
  `${name} ${askedChip(type).replace(/^A/, "a")}. Open their request.`;

// Where it opens: their request on Enquiries' Requests from the app.
export const askedHref = (requestId: string) => `/office/enquiries?view=app#request-${requestId}`;

// A person's name: their casual page.
export const casualHref = (workerId: string) => `/office/casuals/${workerId}`;
