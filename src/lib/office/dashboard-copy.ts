import { roleLabel, timeOnDay } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf } from "../time/zoned";
import type { ExpiredOnBooking, PlannerRefusal } from "./dashboard";

// Needs attention's words (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office/needs-attention`),
// and what a part of an office page says when it couldn't load: short sentences, plain words.
// Pure: the pages and the tests call these with the loaders' data. The dashboard's own words are
// board-copy.ts's (Phase 24).

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Needs attention's heading, the hint under it, and what it says when there's nothing.
export const SECTIONS = {
  needs: {
    heading: "Needs attention",
    hint: "Each item links to where it's dealt with",
    empty: "Nothing needs attention.",
  },
} as const;

// A section (or a count) whose data couldn't be read: the rest of the page still shows.
export const SECTION_ERROR = "This couldn't load. Reload the page to try again.";
export const COUNT_ERROR = "Couldn't load";

// Needs attention's parts, each a heading over its items (only when it has some).
export const NEEDS_HEADINGS = {
  "to-check": "Bookings to check",
  "from-sheet": "From your rota sheet",
  "sheet-names": "Names your rota sheet uses", // Phase 25.2
  "to-mark": "Who worked?",
  expired: "Qualifications out of date on a booking",
  uploads: "Uploads to check",
  evidence: "Strike evidence",
  "planner-refused": "Your planner's change was refused",
  webhook: "Your planner's webhook is failing",
  // Phase 20: counted with Needs attention's items (the one count).
  enquiries: "Enquiries that need a person",
} as const;
export type NeedsKey = keyof typeof NEEDS_HEADINGS;

// "Ben Example's SIA door supervisor licence expired on Sat 3 Oct, before their steward shift on
// Sat 10 Oct." / "… runs out on …" (still in date today) / "…, during their …" (it runs out on a
// day the session covers: a night shift's start) / "… is marked as expired, and they're booked …".
export function expiredText(e: ExpiredOnBooking, today: string, tz: string): string {
  const shiftDay = localDateOf(e.startsAt, tz);
  const shift = `${roleLabel(e.role).toLowerCase()} shift on ${dayLabel(shiftDay)}`;
  if (e.expiresOn === null) {
    return `${e.worker}'s ${e.credential} is marked as expired, and they're booked on a ${shift}.`;
  }
  const when = e.expiresOn < today ? "expired on" : "runs out on";
  const relation = e.expiresOn < shiftDay ? "before" : "during";
  return `${e.worker}'s ${e.credential} ${when} ${dayLabel(e.expiresOn)}, ${relation} their ${shift}.`;
}

// "Your planner's change to the steward session on Sat 7 Nov was refused: 2 booked casuals can't
// work it. Cancel their bookings, then ask your planner to send it again." (docs/office-v2.md
// 5.3.2 step 5), and the same for a role or requirements change, for places taken away and for a
// move or cancellation of a booked session sent with no reason.
export function plannerRefusedText(r: PlannerRefusal, tz: string): string {
  const session = `the ${roleLabel(r.role).toLowerCase()} session on ${dayLabel(localDateOf(r.startsAt, tz))}`;
  const refused = `Your planner's change to ${session} was refused`;
  const again = "then ask your planner to send it again.";
  switch (r.why) {
    case "move":
      return r.casuals === 1
        ? `${refused}: 1 booked casual can't work it. Cancel their booking, ${again}`
        : `${refused}: ${r.casuals > 1 ? `${r.casuals} ` : ""}booked casuals can't work it. Cancel their bookings, ${again}`;
    case "session_has_bookings":
      return `${refused}: it changes the role or the qualifications needed, and casuals are booked. Cancel their bookings, ${again}`;
    case "places_below_booked":
      return `${refused}: it takes away places casuals are booked in. Cancel those bookings, ${again}`;
    case "change_reason_required":
      return `${refused}: it moves or cancels a session casuals are booked on, and gave no reason. Ask your planner to send it again with a reason.`;
  }
}

// "3 uploads wait for a check."
export const uploadsText = (n: number) =>
  `${plural(n, "upload waits", "uploads wait")} for a check.`;

// Your planner's webhook (12J.2): "Since 03:10 on Mon 12 Oct, bookings and cancellations haven't
// reached your planner by webhook. …"
export const webhookFailingText = (since: Date, tz: string): string =>
  `Since ${timeOnDay(since, tz)}, bookings and cancellations haven't reached your planner by webhook. Check its address with whoever runs your planner, then send a test event. Your planner can catch up on what it missed from ShiftDesk.`;

// The rota sheet's names (Needs attention, Phase 25.2; docs/screens.md "The firm's model on the
// office's screens").
// Under a Needs attention list that stops short (Phase 25.3): "Showing the first 50 of 400."
export const showingFirst = (shown: number, total: number) =>
  `Showing the first ${shown} of ${total}.`;

export const SHEET_NAMES_INTRO =
  "Your rota sheet uses these names, but the app can't use them as they are.";

// "Shifts tab, row 14"
export const sheetNamePlace = (tab: "staff" | "shifts", row: number): string =>
  `${tab === "shifts" ? "Shifts" : "Staff"} tab, row ${row}`;

export const SHEET_NAME_UNREADABLE =
  "The app can't read this role, so the row isn't brought in. Change it in the sheet, or ask us to add it to your name map.";

// "Row 9 now says "Holiday", a name your name map skips. …"
export const sheetNameSkippedText = (row: number, name: string): string =>
  `Row ${row} now says “${name}”, a name your name map skips. The session it made is still on here. Cancel or change it if it's no longer needed.`;
