import { wallTimeOf } from "../time/zoned";
import { dateParts } from "./sign-copy";

// "Still coming?" in words (Phase 28.14; docs/screens.md "The casual app, Phase 28" 28.14): the
// card on the pass and on the shift's page in the day before a booked shift, and its answers.
// Pure and browser-safe (no database): the card is a client component. The window is the one
// confirmStillComing() accepts (src/lib/portal/still-coming.ts, 28.2): from STILL_COMING_HOURS
// before the start until the start (tests/unit/portal.still-coming-card.test.ts keeps them equal).

// Must equal STILL_COMING_HOURS in src/lib/portal/still-coming.ts.
export const STILL_COMING_WINDOW_HOURS = 24;

const HOUR_MS = 3_600_000;

// Whether the card shows: her confirmed booking, not started, starting within the window. A
// cancelled shift never reaches here as a booking (the shift's page shows "This shift was
// cancelled."; the pass lists confirmed bookings only).
export function stillComingOpen(shift: { startsAt: Date; status: string }, now: Date): boolean {
  if (shift.status !== "confirmed") return false;
  const left = shift.startsAt.getTime() - now.getTime();
  return left > 0 && left <= STILL_COMING_WINDOW_HOURS * HOUR_MS;
}

export const STILL_COMING_TITLE = "Still coming?";
export const YES_COMING = "Yes, I'm coming";
export const STILL_COMING_THANKS = "Thanks. The office can see you're coming.";
export const STILL_COMING_NOT_NOW = "You can say this in the 24 hours before the shift.";
export const STILL_COMING_ERROR = "That didn't work. Try again.";

const pad = (n: number) => String(n).padStart(2, "0");

// When she said it, as the card shows it: "Fri 13:02", in the firm's time zone.
export function saidAtText(at: Date, timeZone: string): string {
  const w = wallTimeOf(at, timeZone);
  return `${dateParts(at, timeZone).dow} ${pad(w.hour)}:${pad(w.minute)}`;
}

// The card once she has answered: "You said you're coming (Fri 13:02)".
export const saidComingText = (at: Date, timeZone: string) =>
  `You said you're coming (${saidAtText(at, timeZone)})`;
