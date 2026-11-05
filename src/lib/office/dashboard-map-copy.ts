import { noticeText } from "../portal/cancel-reasons";
import { localDateOf } from "../time/zoned";
import { roleLabel, roleWords } from "../portal/format";
import type { MapVenue, Takers, Update, WhoWorkedGroup } from "./dashboard-map";

// Round 8's dashboard in words (Phase 26.2; docs/screens.md "/office, round 8"): the venue map's
// pins and foot, the session card's booked and who-can-take-it tiles, Updates and Who worked?.
// Plain functions, so the tests read every line.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Tue 3" for a yyyy-mm-dd day (a calendar date: no time zone of its own).
export function dayShort(day: string): string {
  const [y = 2000, m = 1, d = 1] = day.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const MAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

// A pin's days with places to fill: "Tue 3, Sat 7, Sun 8", then "and 2 more".
export function pinDays(v: Pick<MapVenue, "days" | "places" | "hidden">): string {
  if (v.places === 0) return "All places filled";
  const shown = v.days.slice(0, 3).map(dayShort).join(", ");
  const rest = v.days.length > 3 ? ` and ${v.days.length - 3} more` : "";
  return `${shown}${rest}${v.hidden ? " · hidden" : ""}`;
}

// What a pin says to a screen reader (and its link's name): "Acme Demo Arena: 10 places to fill,
// urgent, Tue 3, Sat 7, Sun 8".
export function pinLabel(
  v: Pick<MapVenue, "name" | "places" | "urgent" | "hidden" | "days">,
): string {
  if (v.places === 0) return `${v.name}: all places filled`;
  const parts = [plural(v.places, "place to fill", "places to fill")];
  if (v.urgent) parts.push("urgent");
  if (v.hidden) parts.push("hidden from casuals");
  return `${v.name}: ${parts.join(", ")}, ${pinDays({ ...v, hidden: false })}`;
}

export const MAP_KEY = {
  urgent: "Urgent",
  open: "Places to fill",
  hidden: "Hidden: casuals can't see it",
  full: "All filled",
} as const;

// Under the map, on the left: how to use it, or how it's drawn while there's no street map.
export function mapFoot(streets: boolean): string {
  return streets
    ? "Drag to move · Ctrl + scroll to zoom (two fingers on a phone) · a pin's number is its places to fill"
    : "Placed by each venue's postcode · a pin's number is its places to fill";
}

// Under the map, on the right: its venues and places, and the days they cover (the launch review's
// O4: the map holds this pay week and next, while the top bar counts every place to fill): "6
// venues · 29 places to fill this week and next", "… this week", "… next week", "… on Tue 3 Nov".
export function mapCountLine(
  venues: number,
  places: number,
  view: { show: "all" | "urgent" | "this-week" | "next-week"; day?: string | null },
): string {
  let when = "this week and next";
  if (view.day) {
    const [, m = 1] = view.day.split("-").map(Number);
    when = `on ${dayShort(view.day)} ${MONTHS[m - 1]}`;
  } else if (view.show === "this-week") when = "this week";
  else if (view.show === "next-week") when = "next week";
  // Under Urgent, the places counted are the urgent ones (the guardrails review, Phase 27.2).
  const what =
    view.show === "urgent"
      ? plural(places, "urgent place to fill", "urgent places to fill")
      : plural(places, "place to fill", "places to fill");
  return `${plural(venues, "venue", "venues")} · ${what} ${when}`;
}

// The venues with no position: "Not on the map (no postcode yet): Hillside Demo Square, 4 places
// to fill."
export function unplacedLine(list: Pick<MapVenue, "name" | "places">[]): string {
  const each = list.map((v) => `${v.name}, ${plural(v.places, "place to fill", "places to fill")}`);
  return `Not on the map (no postcode yet): ${each.join("; ")}.`;
}

// The map's buttons, top right (Phase 27.4; Dylan, 2026-11-04, "map you can use: yes"): To offer as
// a list on the map, the zoom, and back to the view of every venue. Each is an icon, named by these.
export const MAP_BUTTONS = "Map buttons";
export const listButton = (open: boolean) =>
  open ? "Hide the sessions to offer" : "Show the sessions to offer";
export const ZOOM_IN = "Zoom in";
export const ZOOM_OUT = "Zoom out";
export const FIT_ALL = "Back to every venue";

// The card's row for a venue with more than one session in the view: "‹ Acme Demo Arena · 1 of 2 ›",
// its arrows named for where they go.
export const stepPosition = (index: number, count: number) => `${index + 1} of ${count}`;
export const stepperText = (venue: string, index: number, count: number) =>
  `${venue} · ${stepPosition(index, count)}`;
export const STEP_BEFORE = "The session before";
export const STEP_NEXT = "The next session";

// The map's figures as a table, one tap away (the pre-build audit's aud-9).
export const MAP_TABLE = "Show as a table";
export const MAP_TABLE_HEADS = ["Venue", "Places to fill", "Days"] as const;

// "Show filled venues too": venues with nothing to fill shown too.
export const FULL_VENUES = "Show filled venues too";

// The session card's tiles. Who can take it: the number big, then what it means ("2 have the
// licence, rest and hours for it"), then a chip of the offers sent ("None offered yet", "1 offered").
export const bookedText = (booked: number, headcount: number) => `${booked} / ${headcount}`;
// The number leaves out anyone already offered it (src/lib/offers/candidates.ts: never offered it
// before), so with offers out it's "2 more have …", never a total it isn't (the guardrails review,
// Phase 27.2).
export const canTakeLine = (n: number | null, offered = 0) =>
  `${offered > 0 ? "more " : ""}${n === 1 ? "has" : "have"} the licence, rest and hours for it`;
export const offeredText = (n: number) => (n === 0 ? "None offered yet" : `${n} offered`);

// What the card warns about who can take it, or null: "Only Zoe Adeyemi can take it: 8 hours
// booked that week." / "Nobody can take it right now."
export function takersWarning(t: Takers | null): string | null {
  if (!t) return null;
  if (t.count === 0) return "Nobody can be offered it right now.";
  if (t.only) {
    const h = t.only.hoursThisWeek;
    return `Only ${t.only.name} can take it: ${h === 1 ? "1 hour" : `${h} hours`} booked that week.`;
  }
  return null;
}

// The main button: "Offer to Zoe" when one person can take it, else "Offer to someone".
export function offerButton(t: Takers | null): string {
  return t?.only ? `Offer to ${t.only.name.split(" ")[0]}` : "Offer to someone";
}

// "6 h · £15.00/h" (whole hours shown to the quarter: "7.5 h").
export function lengthAndPay(startsAt: Date, endsAt: Date, payRatePence: number | null): string {
  const hours = Math.round(((endsAt.getTime() - startsAt.getTime()) / 3_600_000) * 4) / 4;
  const length = `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, "")} h`;
  return payRatePence === null ? length : `${length} · £${(payRatePence / 100).toFixed(2)}/h`;
}

// --- Updates ---

const TIME = new Map<string, Intl.DateTimeFormat>();
function hhmm(at: Date, timeZone: string): string {
  let f = TIME.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
    TIME.set(timeZone, f);
  }
  return f.format(at);
}

// "Tue 3 Nov 08:00".
export function sessionWhen(at: Date, timeZone: string): string {
  const day = localDateOf(at, timeZone);
  const [, m = 1] = day.split("-").map(Number);
  return `${dayShort(day)} ${MONTHS[m - 1]} ${hhmm(at, timeZone)}`;
}

// "Mon 08:17": a time with its day.
export function updateWhenLong(at: Date, timeZone: string): string {
  const day = localDateOf(at, timeZone);
  return `${DAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${hhmm(at, timeZone)}`;
}

// When it happened, on the right: "09:06" today, "Sun 08:00" before.
export function updateWhen(at: Date, now: Date, timeZone: string): string {
  const day = localDateOf(at, timeZone);
  return day === localDateOf(now, timeZone)
    ? hhmm(at, timeZone)
    : `${DAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${hhmm(at, timeZone)}`;
}

const where = (u: { role: string; site: string | null; startsAt: Date }, timeZone: string) =>
  [roleLabel(u.role), u.site, sessionWhen(u.startsAt, timeZone)].filter(Boolean).join(", ");

// Each update's two lines, its tone and where it opens.
export function updateLines(
  u: Update,
  timeZone: string,
): { title: string; line: string; tone: "done" | "urgent" | "attention" | "wait"; href: string } {
  switch (u.kind) {
    case "took":
      return {
        title: `${u.worker} took a place`,
        line: `${where(u, timeZone)} · ${u.placesFree === 0 ? "now full" : plural(u.placesFree, "place to fill", "places to fill")}`,
        tone: "done",
        href: `/office/shifts/${u.shiftId}`,
      };
    case "cancelled": {
      const strike =
        u.strike === "live"
          ? "strike issued"
          : u.strike === "withdrawn"
            ? "strike withdrawn"
            : "no strike";
      return {
        title: `${u.worker} cancelled · ${noticeText(u.noticeHours)}`,
        line: `${where(u, timeZone)} · ${strike}${u.reopened ? " · reopened" : ""}`,
        tone: u.noticeHours < 48 ? "urgent" : "attention",
        href: `/office/cancellations/${u.ref}`,
      };
    }
    case "upload":
      return {
        title: `${u.worker} sent ${u.what === "photo" ? "a staff photo" : "a certificate"}`,
        line: "Waiting for a check",
        tone: "wait",
        href: `/office/casuals/${u.workerId}`,
      };
    case "no-reply":
      return {
        title: `No reply yet · ${plural(u.offers, "offer", "offers")}`,
        line: `On ${plural(u.sessions, "session", "sessions")} · the oldest sent ${updateWhenLong(u.oldest, timeZone)}`,
        tone: "attention",
        href: NO_REPLY_HREF,
      };
  }
}

// --- Updates' one action each (Phase 27.10) ---

// Dylan, 2026-11-05, on the dashboard after 27.9: "there still needs to be more ctas and data here
// on the dash but keep it simple". Under each update's lines, one small button, for that row:
// - a casual's cancellation whose place is still to fill (the session reopened, hasn't started and
//   has a place free: the loader's `reopened`): "Offer the place", the dashboard's offer panel as
//   To offer's paper plane opens it (the offer page without JavaScript);
// - any other cancellation: "See the record" (the cancellation's own page);
// - a place taken: "Open the session";
// - the offers with no reply: "See the offers", on Events & sessions' "Need people" (every session
//   with a place free, so every one with an offer waiting: there's no list of those alone).
// Photos and certificates to check (the Updates page's, never the dashboard's since Phase 27.9)
// have none: the row is the link. `name` is what a screen reader hears, saying which row it's for;
// `offer` is the session the offer panel opens for (null: a plain link).
export interface UpdateAction {
  label: string;
  href: string;
  name: string;
  offer: string | null;
}

export const OFFER_THE_PLACE = "Offer the place";
export const SEE_THE_RECORD = "See the record";
export const OPEN_THE_SESSION = "Open the session";
export const SEE_THE_OFFERS = "See the offers";
export const NO_REPLY_HREF = "/office/events?view=need";

// "door supervisor, Sat 7 Nov 08:00".
const sessionWords = (x: { role: string; startsAt: Date }, timeZone: string) =>
  `${roleWords(x.role)}, ${sessionWhen(x.startsAt, timeZone)}`;

export function updateAction(u: Update, timeZone: string): UpdateAction | null {
  switch (u.kind) {
    case "cancelled":
      return u.reopened
        ? {
            label: OFFER_THE_PLACE,
            href: `/office/offer/${u.shiftId}`,
            name: `${OFFER_THE_PLACE}: ${sessionWords(u, timeZone)}`,
            offer: u.shiftId,
          }
        : {
            label: SEE_THE_RECORD,
            href: `/office/cancellations/${u.ref}`,
            name: `${SEE_THE_RECORD} of ${u.worker}'s cancellation: ${sessionWords(u, timeZone)}`,
            offer: null,
          };
    case "took":
      return {
        label: OPEN_THE_SESSION,
        href: `/office/shifts/${u.shiftId}`,
        name: `${OPEN_THE_SESSION}: ${sessionWords(u, timeZone)}`,
        offer: null,
      };
    case "no-reply":
      return {
        label: SEE_THE_OFFERS,
        href: NO_REPLY_HREF,
        name: `${SEE_THE_OFFERS}: ${plural(u.offers, "offer", "offers")} with no reply yet`,
        offer: null,
      };
    case "upload":
      return null;
  }
}

export const UPDATES_TITLE = "Updates";
export const UPDATES_EMPTY = "Nothing new in the last two days.";
// The column's foot: the Updates page (Phase 26.4; until then the action log).
export const UPDATES_ALL = "All updates";

// --- Who worked? ---

type Worked = Pick<WhoWorkedGroup, "role" | "site" | "startsAt" | "endsAt" | "shiftIds">;

// "Sun 1 Nov · Steward · Acme Demo Racecourse · 10:30–18:30", alike sessions too (the people under
// it are what count, so no " · 3 sessions": round 8's "Clearer words", 3 Nov 2026).
export function workedHeading(g: Worked, timeZone: string): string {
  const day = localDateOf(g.startsAt, timeZone);
  const [, m = 1] = day.split("-").map(Number);
  return [
    `${dayShort(day)} ${MONTHS[m - 1]}`,
    roleLabel(g.role),
    g.site,
    `${hhmm(g.startsAt, timeZone)}–${hhmm(g.endsAt, timeZone)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
// Where a group's heading goes: its session (several alike: no one page, so none).
export const workedHref = (g: Pick<WhoWorkedGroup, "shiftIds">) =>
  g.shiftIds.length === 1 ? `/office/shifts/${g.shiftIds[0]}` : null;
export const showAllWorked = (n: number) => `Show all ${n}`;
// Who worked?'s groups before "Show all" (here, with no database code, for the page's own parts).
export const WHO_WORKED_GROUPS = 3;
// The session a person's buttons are for, in their names (each unique on the page, as one person
// can be in two groups: the pre-build audit's aud-5): "Sun 1 Nov 10:30".
export function workedWhen(g: Pick<WhoWorkedGroup, "startsAt">, timeZone: string): string {
  const day = localDateOf(g.startsAt, timeZone);
  const [, m = 1] = day.split("-").map(Number);
  return `${dayShort(day)} ${MONTHS[m - 1]} ${hhmm(g.startsAt, timeZone)}`;
}
export const workedLabel = (name: string, when: string) => `${name} worked, ${when}`;
export const noShowLabel = (name: string, when: string) => `${name} didn't attend, ${when}`;
// The link under a group that marks everyone still listed as worked, after a "Yes".
export const EVERYONE_ELSE = "All of these worked";
export const everyoneElseLabel = (g: Worked, timeZone: string) =>
  `All of these worked: ${workedHeading(g, timeZone)}`;
export const EVERYONE_ELSE_YES = "Yes, all of these worked";
