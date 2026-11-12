import { zonedToUtc } from "../time/zoned";
import { urgentWhy, type UrgentWhy } from "./urgency";

// The client's request form (Phase 36.4; docs/screens.md "## Phase 36", "36.4 screens"), checked in
// the browser before it's sent so each problem shows next to its field, and turned into the shape
// createClientRequest() takes (which checks it all again with zod, on the server, with the
// session's contract). Plain code with no database imports: the form uses it in the browser
// (tests/unit/client-boundary.test.ts). The limits are payloads.ts's (tests/unit/client.form.test.ts
// holds the two to each other).

export const FORM_NOTE_MAX = 1000;
export const FORM_TEXT_MAX = 1000;
export const FORM_SESSIONS_MAX = 12;
export const FORM_MORE_MAX = 200;
export const FORM_NAME_MAX = 200;
export const FORM_ADDRESS_MAX = 300;
export const FORM_LINE_NOTES_MAX = 500;
export const FORM_PLACES_MAX = 1000;

export const FORM_KINDS = [
  "new_event",
  "more_places",
  "fewer_places",
  "new_times",
  "cancel_session",
  "other",
] as const;
export type FormKind = (typeof FORM_KINDS)[number];
export const isFormKind = (v: unknown): v is FormKind =>
  typeof v === "string" && (FORM_KINDS as readonly string[]).includes(v);
// The kinds about one session (a session must be chosen).
export const SESSION_FORM_KINDS: readonly FormKind[] = [
  "more_places",
  "fewer_places",
  "new_times",
  "cancel_session",
];

// One of their sessions the form offers (numbers only: never a casual).
export interface SessionChoice {
  shiftId: string;
  eventId: string;
  label: string; // "North Gate · SIA steward · Sat 14 Nov 12:30–19:30"
  startsAt: number; // ms
  places: number;
  booked: number;
  date: string; // its day, yyyy-mm-dd, the firm's time
  start: string; // hh:mm
  end: string; // hh:mm
}

export interface EventLine {
  role: string;
  places: string;
  start: string;
  end: string;
  notes: string;
}
export const blankLine = (): EventLine => ({
  role: "",
  places: "",
  start: "",
  end: "",
  notes: "",
});

export interface FormState {
  kind: FormKind | "";
  shiftId: string;
  places: string;
  date: string;
  start: string;
  end: string;
  text: string;
  note: string;
  // A new event:
  name: string;
  venue: string; // a venue's id, or "address"
  address: string;
  eventDate: string;
  lines: EventLine[];
}

export type FieldErrors = Partial<Record<string, string>>;

// The words next to a field.
export const FIELD_WORDS = {
  kind: "Choose what you need.",
  shiftId: "Choose a session.",
  morePlaces: `Type how many more, from 1 to ${FORM_MORE_MAX}.`,
  fewerPlaces: (max: number) =>
    max < 1
      ? "This session has 1 place. To have none, cancel the session."
      : `Type how many fewer, from 1 to ${max}. To have none, cancel the session.`,
  date: "Choose a date.",
  start: "Type a start time, like 09:30.",
  end: "Type a finish time, like 17:00.",
  sameTimes: "These are the times it has now. Change one of them.",
  past: "That time has gone. Choose a later one.",
  text: "Say what you need.",
  textLong: `Keep it under ${FORM_TEXT_MAX} characters.`,
  note: `Keep it under ${FORM_NOTE_MAX} characters.`,
  name: "Give the event a name.",
  venue: "Choose a venue, or type the address.",
  address: "Type the venue's address.",
  role: "Choose a role.",
  places: `Type how many places, from 1 to ${FORM_PLACES_MAX}.`,
  lineNotes: `Keep it under ${FORM_LINE_NOTES_MAX} characters.`,
} as const;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const wholeNumber = (raw: string): number | null =>
  /^\s*\d{1,5}\s*$/.test(raw) ? Number(raw.trim()) : null;

// A date and clock time in the firm's zone as an instant (null: not a date or time).
export function zonedStart(date: string, time: string, timeZone: string): Date | null {
  if (!DAY.test(date) || !CLOCK.test(time)) return null;
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedToUtc({ year, month, day, hour, minute }, timeZone);
}

export type RequestShape =
  | {
      kind: "new_event";
      payload: {
        name: string;
        venue: { siteId: string } | { address: string };
        date: string;
        sessions: { role: string; places: number; start: string; end: string; notes?: string }[];
      };
      note?: string;
    }
  | {
      kind: "more_places" | "fewer_places";
      shiftId: string;
      payload: { places: number };
      note?: string;
    }
  | {
      kind: "new_times";
      shiftId: string;
      payload: { date: string; start: string; end: string };
      note?: string;
    }
  | { kind: "cancel_session"; shiftId: string; payload: Record<string, never>; note?: string }
  | {
      kind: "other";
      shiftId?: string;
      eventId?: string;
      payload: { text: string };
      note?: string;
    };

// The form checked: the request to send, or the problem next to each field. `eventId`: the event
// the form was opened from ("Something else" about the event when no session is chosen).
export function checkForm(
  s: FormState,
  o: { sessions: SessionChoice[]; timeZone: string; now: Date; eventId?: string },
): { ok: true; request: RequestShape } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const note = s.note.trim();
  if (note.length > FORM_NOTE_MAX) errors.note = FIELD_WORDS.note;
  const withNote = note ? { note } : {};
  if (!s.kind) return { ok: false, errors: { ...errors, kind: FIELD_WORDS.kind } };
  const session = o.sessions.find((x) => x.shiftId === s.shiftId) ?? null;
  if (SESSION_FORM_KINDS.includes(s.kind) && !session) errors.shiftId = FIELD_WORDS.shiftId;

  switch (s.kind) {
    case "more_places": {
      const n = wholeNumber(s.places);
      if (n === null || n < 1 || n > FORM_MORE_MAX) errors.places = FIELD_WORDS.morePlaces;
      if (Object.keys(errors).length > 0 || !session || n === null) return { ok: false, errors };
      return {
        ok: true,
        request: {
          kind: "more_places",
          shiftId: session.shiftId,
          payload: { places: n },
          ...withNote,
        },
      };
    }
    case "fewer_places": {
      const n = wholeNumber(s.places);
      const max = session ? session.places - 1 : FORM_PLACES_MAX;
      if (n === null || n < 1 || n > max) errors.places = FIELD_WORDS.fewerPlaces(max);
      if (Object.keys(errors).length > 0 || !session || n === null) return { ok: false, errors };
      return {
        ok: true,
        request: {
          kind: "fewer_places",
          shiftId: session.shiftId,
          payload: { places: n },
          ...withNote,
        },
      };
    }
    case "new_times": {
      if (!DAY.test(s.date)) errors.date = FIELD_WORDS.date;
      if (!CLOCK.test(s.start)) errors.start = FIELD_WORDS.start;
      if (!CLOCK.test(s.end)) errors.end = FIELD_WORDS.end;
      else if (s.end === s.start) errors.end = FIELD_WORDS.end;
      const at = zonedStart(s.date, s.start, o.timeZone);
      if (!errors.date && !errors.start && at && at.getTime() <= o.now.getTime()) {
        errors.start = FIELD_WORDS.past;
      }
      if (
        session &&
        !errors.date &&
        !errors.start &&
        !errors.end &&
        s.date === session.date &&
        s.start === session.start &&
        s.end === session.end
      ) {
        errors.start = FIELD_WORDS.sameTimes;
      }
      if (Object.keys(errors).length > 0 || !session) return { ok: false, errors };
      return {
        ok: true,
        request: {
          kind: "new_times",
          shiftId: session.shiftId,
          payload: { date: s.date, start: s.start, end: s.end },
          ...withNote,
        },
      };
    }
    case "cancel_session": {
      if (Object.keys(errors).length > 0 || !session) return { ok: false, errors };
      return {
        ok: true,
        request: { kind: "cancel_session", shiftId: session.shiftId, payload: {}, ...withNote },
      };
    }
    case "other": {
      const text = s.text.trim();
      if (!text) errors.text = FIELD_WORDS.text;
      else if (text.length > FORM_TEXT_MAX) errors.text = FIELD_WORDS.textLong;
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return {
        ok: true,
        request: {
          kind: "other",
          ...(session ? { shiftId: session.shiftId } : o.eventId ? { eventId: o.eventId } : {}),
          payload: { text },
          ...withNote,
        },
      };
    }
    case "new_event": {
      const name = s.name.trim();
      if (!name || name.length > FORM_NAME_MAX) errors.name = FIELD_WORDS.name;
      const address = s.address.trim();
      let venue: { siteId: string } | { address: string } | null = null;
      if (s.venue === "address") {
        if (address.length < 5 || address.length > FORM_ADDRESS_MAX)
          errors.address = FIELD_WORDS.address;
        else venue = { address };
      } else if (s.venue) venue = { siteId: s.venue };
      else errors.venue = FIELD_WORDS.venue;
      if (!DAY.test(s.eventDate) || !zonedStart(s.eventDate, "12:00", o.timeZone))
        errors.eventDate = FIELD_WORDS.date;
      const sessions: {
        role: string;
        places: number;
        start: string;
        end: string;
        notes?: string;
      }[] = [];
      s.lines.slice(0, FORM_SESSIONS_MAX).forEach((l, i) => {
        const key = (f: string) => `line-${i}-${f}`;
        const places = wholeNumber(l.places);
        if (!l.role) errors[key("role")] = FIELD_WORDS.role;
        if (places === null || places < 1 || places > FORM_PLACES_MAX)
          errors[key("places")] = FIELD_WORDS.places;
        if (!CLOCK.test(l.start)) errors[key("start")] = FIELD_WORDS.start;
        if (!CLOCK.test(l.end) || l.end === l.start) errors[key("end")] = FIELD_WORDS.end;
        if (l.notes.trim().length > FORM_LINE_NOTES_MAX)
          errors[key("notes")] = FIELD_WORDS.lineNotes;
        const at = zonedStart(s.eventDate, l.start, o.timeZone);
        if (!errors.eventDate && !errors[key("start")] && at && at.getTime() <= o.now.getTime())
          errors[key("start")] = FIELD_WORDS.past;
        const notes = l.notes.trim();
        sessions.push({
          role: l.role,
          places: places ?? 0,
          start: l.start,
          end: l.end,
          ...(notes ? { notes } : {}),
        });
      });
      if (Object.keys(errors).length > 0 || !venue || sessions.length === 0)
        return { ok: false, errors };
      return {
        ok: true,
        request: {
          kind: "new_event",
          payload: { name, venue, date: s.eventDate, sessions },
          ...withNote,
        },
      };
    }
  }
}

// Whether the rules will find it urgent (the form's yellow box before sending; the server works it
// out again when it's sent, and whenever the office reads it): the session, the new times or a new
// event's first session starts within 48 hours, or it takes places or hours from casuals booked.
export function formUrgent(
  s: FormState,
  o: { sessions: SessionChoice[]; timeZone: string; now: Date },
): UrgentWhy | null {
  if (!s.kind) return null;
  const session = o.sessions.find((x) => x.shiftId === s.shiftId) ?? null;
  if (s.kind === "new_event") {
    const starts = s.lines
      .map((l) => zonedStart(s.eventDate, l.start, o.timeZone))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return urgentWhy({
      kind: "new_event",
      now: o.now,
      startsAt: starts[0] ?? null,
      booked: 0,
      free: 0,
    });
  }
  if (!session) return null;
  const places = wholeNumber(s.places) ?? undefined;
  return urgentWhy({
    kind: s.kind,
    now: o.now,
    startsAt: new Date(session.startsAt),
    newStartsAt: s.kind === "new_times" ? zonedStart(s.date, s.start, o.timeZone) : null,
    booked: session.booked,
    free: Math.max(0, session.places - session.booked),
    ...(places !== undefined ? { places } : {}),
  });
}

// The server's answers that come back to the form, in the client's words (next to a field where
// there is one).
export type SendProblem =
  | "form"
  | "bad_time"
  | "in_past"
  | "too_many_fewer"
  | "same_times"
  | "not_found"
  | "not_allowed"
  | "logged_out"
  | "error";

export function sendProblemErrors(problem: SendProblem, kind: FormKind | ""): FieldErrors {
  switch (problem) {
    case "too_many_fewer":
      return { places: "That's every place it has. To have none, cancel the session." };
    case "same_times":
      return { start: FIELD_WORDS.sameTimes };
    case "in_past":
      return kind === "new_event" ? { eventDate: FIELD_WORDS.past } : { start: FIELD_WORDS.past };
    case "bad_time":
      return kind === "new_event"
        ? { eventDate: "Check the date and times." }
        : { date: "Check the date and times." };
    case "not_found":
      return kind === "new_event"
        ? { venue: "That venue isn't one of yours any more. Reload the page." }
        : { shiftId: "That session has started, been cancelled or isn't yours. Reload the page." };
    default:
      return {};
  }
}

export function sendProblemText(problem: SendProblem): string {
  switch (problem) {
    case "logged_out":
    case "not_allowed":
      return "You're logged out. Log in again to send it.";
    case "error":
      return "Something went wrong. Nothing was sent. Try again.";
    case "form":
      return "Check the form: something in it isn't right.";
    default:
      return "Nothing was sent. Check the fields marked.";
  }
}
