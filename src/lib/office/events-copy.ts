import { pounds } from "../portal/pay-format";
import { roleLabel } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import type { EventCardData, EventView, SessionRow } from "./events";

// Events & sessions in plain words (docs/office-v2.md 3.3; docs/screens.md `/office/events`).
// Pure: the pages and the tests call these with the loader's data.

export const EVENT_VIEW_WORDS: Record<EventView, string> = {
  all: "All",
  showing: "Showing",
  hidden: "Hidden",
  urgent: "Urgent, not filled",
};

export const EVENT_VIEW_EMPTY: Record<EventView, string> = {
  all: "No events with a session to come.",
  showing: "No events are showing to casuals.",
  hidden: "No events are hidden from casuals.",
  urgent: "Every urgent shift is filled.",
};

// Short names for the chips; any other qualification uses its own name.
const SHORT_NAMES: Record<string, string> = {
  SIA_DS: "SIA DS",
  SIA_SG: "SIA SG",
  SIA_CP: "SIA CP",
  STEWARD_L2: "Steward L2",
  FIRST_AID: "First aid",
  CSAS: "CSAS",
  MANUAL_HANDLING: "Manual handling",
};

export const requirementChip = (r: { code: string; name: string }): string =>
  SHORT_NAMES[r.code] ?? r.name.charAt(0).toUpperCase() + r.name.slice(1);

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// "Sat 10 Oct", or "Sat 10 Oct to Sun 11 Oct" for an event over more than one day.
export function eventDateText(e: EventCardData, tz: string): string {
  const first = localDateOf(e.firstStartsAt, tz);
  const last = localDateOf(e.lastStartsAt, tz);
  return first === last ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`;
}

export const spansDays = (e: EventCardData, tz: string): boolean =>
  localDateOf(e.firstStartsAt, tz) !== localDateOf(e.lastStartsAt, tz);

// "Acme Demo Arena · Sat 10 Oct" (the place only when there is one).
export const eventWhereWhen = (e: EventCardData, tz: string): string =>
  [e.place, eventDateText(e, tz)].filter(Boolean).join(" · ");

// The one status tag.
export const eventStatus = (e: EventCardData) =>
  e.showing
    ? { tone: "done" as const, words: "Showing to casuals" }
    : { tone: "quiet" as const, words: "Hidden from casuals" };

// "2 sessions · 3 places free", "1 session · Full" (every one booked to its places), or "No
// places to offer" (none free in a session still to start, though not all are full: one has
// started, or is a draft).
export function eventSummary(e: EventCardData): string {
  const sessions = `${e.sessionCount} ${e.sessionCount === 1 ? "session" : "sessions"}`;
  const free =
    e.placesFree > 0
      ? `${e.placesFree} ${e.placesFree === 1 ? "place free" : "places free"}`
      : e.full
        ? "Full"
        : "No places to offer";
  return `${sessions} · ${free}`;
}

export const eventSwitchLabel = (e: { name: string }): string => `Show ${e.name} to casuals`;

// "08:00–16:00"; with the day ("Sat 10 Oct 08:00–16:00") when the event spans days.
export function sessionTime(s: SessionRow, tz: string, withDay: boolean): string {
  const times = `${hhmm(s.startsAt, tz)}–${hhmm(s.endsAt, tz)}`;
  return withDay ? `${dayLabel(localDateOf(s.startsAt, tz))} ${times}` : times;
}

// "Door supervisor 08:00–16:00": how the page names a session (its switch, its menu).
export const sessionName = (s: SessionRow, tz: string, withDay: boolean): string =>
  `${roleLabel(s.role)} ${sessionTime(s, tz, withDay)}`;

// Each session's name, unique among these ("Steward 08:00–16:00"; two alike get "(2)", "(3)"):
// for its switch, its "…" menu and its urgent button, so no two controls share a name.
export function uniqueSessionNames(
  sessions: SessionRow[],
  tz: string,
  withDay: boolean,
): Map<string, string> {
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const s of sessions) {
    const name = sessionName(s, tz, withDay);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    names.set(s.shiftId, n > 1 ? `${name} (${n})` : name);
  }
  return names;
}

export const sessionSwitchLabel = (uniqueName: string): string => `Show ${uniqueName} to casuals`;

// Each session's switch label, unique on the page ("Show Steward 08:00–16:00 (2) to casuals").
export function sessionSwitchLabels(
  sessions: SessionRow[],
  tz: string,
  withDay: boolean,
): Map<string, string> {
  return new Map(
    [...uniqueSessionNames(sessions, tz, withDay)].map(([id, name]) => [
      id,
      sessionSwitchLabel(name),
    ]),
  );
}

export const isFull = (s: SessionRow): boolean => s.booked >= s.headcount || s.status === "filled";

// Beside a session's switch: whether casuals can see it, and why not.
export function sessionShowingText(s: SessionRow, eventShowing: boolean): string {
  if (s.status === "cancelled") return "Cancelled";
  if (s.status === "draft") return "Draft: not showing";
  if (s.started) return "Started: not showing";
  if (isFull(s)) return "Full: not showing";
  if (!s.showing) return "Hidden from casuals";
  if (!eventShowing) return "Its event is hidden from casuals";
  return "Showing to casuals";
}

export const filledText = (s: SessionRow): string => `${s.booked}/${s.headcount} filled`;

// The session's details, each only when set: "£15.50/h", "Post: Gate A", "Meeting point: …",
// "Uniform: …".
export function sessionDetails(s: SessionRow): string[] {
  return [
    s.payRatePence !== null ? `${pounds(s.payRatePence)}/h` : null,
    s.post ? `Post: ${s.post}` : null,
    s.meetingPoint ? `Meeting point: ${s.meetingPoint}` : null,
    s.uniform ? `Uniform: ${s.uniform}` : null,
  ].filter((x): x is string => x !== null);
}

// The "…" menu's words for a session from a Google Sheet or the firm's planner (the API): it can't
// be changed or cancelled here.
export const SHEET_SESSION_WORDS = "This session comes from your Google Sheet. Change it there.";
export const PLANNER_SESSION_WORDS = "This session comes from your planner. Change it there.";
