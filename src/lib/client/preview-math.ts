import type { ClientRequestKind } from "../db/schema/client";

// "What accepting does" in numbers (Phase 36.4; the mock-up's "12 places become 16 (9 booked, 7 to
// fill)"): a session's places, booked and to fill before and after, and how many bookings a cut
// cancels. Pure, so the office's page and the accept itself work it out the same way (the accept
// re-reads the session under its lock and applies exactly this).

export interface PlaceCounts {
  places: number;
  booked: number;
  toFill: number;
}

export interface PlacesChange {
  before: PlaceCounts;
  after: PlaceCounts;
  // Bookings the change cancels (fewer places than are free, or the whole session): each casual is
  // given notice by the firm (golden rule 12).
  cancels: number;
}

export type PlacesProblem = "last_place"; // fewer places down to none: that's cancelling it

const counts = (places: number, booked: number): PlaceCounts => ({
  places,
  booked,
  toFill: Math.max(0, places - booked),
});

// `booked` counts live bookings within the places; `places` is the change asked for.
export function placesChange(
  kind: ClientRequestKind,
  session: { headcount: number; booked: number },
  asked: { places?: number } = {},
): PlacesChange | PlacesProblem | null {
  const { headcount, booked } = session;
  const before = counts(headcount, booked);
  switch (kind) {
    case "more_places": {
      const n = asked.places ?? 0;
      return { before, after: counts(headcount + n, booked), cancels: 0 };
    }
    case "fewer_places": {
      const n = asked.places ?? 0;
      const to = headcount - n;
      if (to < 1) return "last_place";
      const cancels = Math.max(0, booked - to);
      return { before, after: counts(to, booked - cancels), cancels };
    }
    case "cancel_session":
      return { before, after: counts(0, 0), cancels: booked };
    case "new_times":
      return { before, after: before, cancels: 0 };
    default:
      return null;
  }
}
