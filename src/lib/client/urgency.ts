import type { ClientRequestKind } from "../db/schema/client";

// When a client request is urgent (Phase 36.4; Dylan's approval, 2026-11-11: "the rules decide
// urgency"). Plain code, never the client's say-so: urgent when what it's about starts within 48
// hours, or when it takes places or hours away from casuals already booked (fewer places than are
// free, new times or a cancellation with anyone booked). Worked out when it's sent (stored as
// client_requests.urgent) and again every time it's read, from the session as it is then.

export const CLIENT_URGENT_HOURS = 48;
const HOUR = 3_600_000;

export interface UrgencyFacts {
  kind: ClientRequestKind;
  now: Date;
  // The session's start (the four session kinds; "other" when it names one), or a new event's
  // first session's. Null: nothing dated.
  startsAt: Date | null;
  // New times only: the start asked for.
  newStartsAt?: Date | null;
  booked: number; // casuals booked on the session now (0 when not about one)
  free: number; // places still free on it now
  places?: number; // fewer places: how many fewer
}

export type UrgentWhy = "starts_soon" | "affects_booked";

const soon = (at: Date | null | undefined, now: Date) =>
  at != null &&
  at.getTime() > now.getTime() &&
  at.getTime() - now.getTime() <= CLIENT_URGENT_HOURS * HOUR;

// Why it's urgent, or null when it isn't. A session already under way or over isn't "soon" (the
// office can't act on it in time; it's for the log).
export function urgentWhy(f: UrgencyFacts): UrgentWhy | null {
  if (soon(f.startsAt, f.now) || (f.kind === "new_times" && soon(f.newStartsAt, f.now))) {
    return "starts_soon";
  }
  if (f.kind === "fewer_places" && (f.places ?? 0) > f.free) return "affects_booked";
  if ((f.kind === "new_times" || f.kind === "cancel_session") && f.booked > 0) {
    return "affects_booked";
  }
  return null;
}

export const isUrgent = (f: UrgencyFacts): boolean => urgentWhy(f) !== null;
