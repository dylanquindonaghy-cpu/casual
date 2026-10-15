import { roleLabel, timeOnDay } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import type {
  DashboardCounts,
  ExpiredOnBooking,
  PlannerRefusal,
  UrgentSessionCard,
} from "./dashboard";
import { stoppedText } from "./today-copy";

// The dashboard's words (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`): short sentences,
// plain words. Pure: the page and the tests call these with the loader's data.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, "0");

// The four counts, in order: each labelled exactly as the spec says, and a link to its list.
export const COUNTS = [
  { key: "urgent", label: "Urgent shifts not filled", href: "/office/events?view=urgent" },
  { key: "showing", label: "Events showing to casuals", href: "/office/events?view=showing" },
  { key: "cancellations", label: "Cancellations today", href: "/office/cancellations?day=today" },
  { key: "enquiries", label: "Enquiries today", href: "/office/enquiries?day=today" },
] as const;
export type CountKey = (typeof COUNTS)[number]["key"];

// The number a count shows (null: it couldn't be read).
export function countNumber(key: CountKey, c: DashboardCounts): number | null {
  switch (key) {
    case "urgent":
      return c.urgent.ok ? c.urgent.data.sessions : null;
    case "showing":
      return c.showing.ok ? c.showing.data.events : null;
    case "cancellations":
      return c.cancellations.ok ? c.cancellations.data.total : null;
    case "enquiries":
      return c.enquiries.ok ? c.enquiries.data.total : null;
  }
}

// "Wed 10:30" (the firm's clock).
const dayAndTime = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${dayLabel(localDateOf(d, tz)).split(" ")[0] ?? ""} ${pad(w.hour)}:${pad(w.minute)}`;
};

// The small line under each count.
export function countLine(key: CountKey, c: DashboardCounts, tz: string): string {
  switch (key) {
    case "urgent": {
      if (!c.urgent.ok) return COUNT_ERROR;
      const u = c.urgent.data;
      return u.sessions === 0 || u.firstStartsAt === null
        ? "Every urgent shift is filled"
        : `${plural(u.places, "place", "places")} · first starts ${dayAndTime(u.firstStartsAt, tz)}`;
    }
    case "showing": {
      if (!c.showing.ok) return COUNT_ERROR;
      const sh = c.showing.data;
      return sh.events === 0
        ? "Nothing is showing"
        : `${plural(sh.places, "open place", "open places")} across ${plural(sh.sessions, "session", "sessions")}`;
    }
    case "cancellations": {
      if (!c.cancellations.ok) return COUNT_ERROR;
      const x = c.cancellations.data;
      return x.total === 0
        ? "None since midnight"
        : `${x.underNotice} under ${x.threshold} hours · ${plural(x.strikes, "strike", "strikes")} issued`;
    }
    case "enquiries": {
      if (!c.enquiries.ok) return COUNT_ERROR;
      const q = c.enquiries.data;
      return q.total === 0 && q.needPerson === 0
        ? "None since midnight"
        : `${q.automatic} answered automatically · ${q.needPerson} ${q.needPerson === 1 ? "needs" : "need"} a person`;
    }
  }
}

// The sections, in order, with their hint under the heading, and what each says when empty.
export const SECTIONS = {
  urgent: {
    heading: "Urgent shifts not filled",
    hint: "Casuals see these first, and get an alert",
    empty: "Every urgent shift is filled.",
  },
  showing: {
    heading: "Showing to casuals",
    hint: "Switch an event off to hide all its sessions from casuals",
    empty: "No events are showing to casuals.",
  },
  cancellations: {
    heading: "Cancellations",
    hint: "Recorded automatically, never approved or declined",
    empty: "No cancellations recorded.",
  },
  enquiries: {
    heading: "Enquiries",
    hint: "What casuals asked, and the reply they got",
    empty: "No enquiries in the last 90 days.",
  },
  needs: {
    heading: "Needs attention",
    hint: "Each item links to where it's dealt with",
    empty: "Nothing needs attention.",
  },
} as const;
export type SectionKey = keyof typeof SECTIONS;

// A section (or a count) whose data couldn't be read: the rest of the page still shows.
export const SECTION_ERROR = "This couldn't load. Reload the page to try again.";
export const COUNT_ERROR = "Couldn't load";

// The line on an urgent session, written by code from its offers: why they stopped, or how many
// casuals it went to.
export function urgentLine(s: Pick<UrgentSessionCard, "offered" | "stopped">): string {
  return stoppedText(s) ?? `Offered to ${plural(s.offered, "casual", "casuals")}`;
}

// On a hidden event's card when it has an urgent gap.
export const HIDDEN_WARNING = "Hidden from casuals: nobody can see this gap.";

// Showing to casuals: a card's sessions past the first few (SHOWING_SESSIONS, dashboard.ts).
export const moreSessionsText = (n: number) => `+ ${n} more`;

// The bell in the top bar: its accessible name and the number it shows.
export const bellLabel = (n: number | null, more: boolean) =>
  n === null ? "Needs attention" : `Needs attention, ${more ? `${n}+` : n}`;

// Needs attention's parts, each a heading over its items (only when it has some).
export const NEEDS_HEADINGS = {
  "to-check": "Bookings to check",
  "from-sheet": "From your rota sheet",
  "to-mark": "Who worked?",
  expired: "Qualifications out of date on a booking",
  uploads: "Uploads to check",
  evidence: "Strike evidence",
  "planner-refused": "Your planner's change was refused",
  webhook: "Your planner's webhook is failing",
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

// Who cancelled: "Ben Carter cancelled", or "The office cancelled Ben Carter" (and the planner's
// and the rota sheet's own words).
export function cancelledByText(r: {
  by: "casual" | "office" | "planner" | "sheet";
  casual: string;
}) {
  switch (r.by) {
    case "casual":
      return `${r.casual} cancelled`;
    case "office":
      return `The office cancelled ${r.casual}`;
    case "planner":
      return `Your planner cancelled ${r.casual}`;
    case "sheet":
      return `Your rota sheet cancelled ${r.casual}`;
  }
}

// "2 hours' notice" as a chip ("Less than an hour's notice", "3 days' notice").
export const noticeChip = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

// Your planner's webhook (12J.2): "Since 03:10 on Mon 12 Oct, bookings and cancellations haven't
// reached your planner by webhook. …"
export const webhookFailingText = (since: Date, tz: string): string =>
  `Since ${timeOnDay(since, tz)}, bookings and cancellations haven't reached your planner by webhook. Check its address with whoever runs your planner, then send a test event. Your planner can catch up on what it missed from ShiftDesk.`;
