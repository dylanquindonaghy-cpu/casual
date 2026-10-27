import { payWeek } from "../pay/pay-week";
import { roleLabel, soonLabel } from "../portal/format";
import { datePartsOfDay, timeRange } from "../portal/sign-copy";
import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import type {
  BoardShow,
  BoardSession,
  ChartDay,
  OfferChannel,
  OvernightTake,
} from "./dashboard-board";
import type { PlannerLink } from "./integrations";
import type { TodayToMark } from "./today";

// The dashboard's words (Phase 24, 24.3: round 7 of the canvas, docs/mockups/phase-24/README.md;
// docs/screens.md `/office`): short sentences, plain words, the mock-up's own wherever they're
// true (where they wouldn't be, the README's "Where the build differs" says what changed). Pure:
// the page and the tests call these with the loader's data.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date, timeZone: string) => {
  const w = wallTimeOf(d, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
// A role in a sentence: "door supervisor", "CSAS officer" (an acronym stays in capitals).
const inSentence = (role: string) => {
  const label = roleLabel(role);
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
};

// --- The head --------------------------------------------------------------------------------

// "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated 11:20 from your planner": the day, the
// pay week and its pay day (from the top bar since 24.2), and when the planner or the rota sheet
// last sent changes (none when neither has: nothing to say).
export function headLine(
  today: string,
  planner: PlannerLink | null,
  now: Date,
  timeZone: string,
): string {
  const week = payWeek(today);
  const parts = [datePartsOfDay(today).long, `Week ${week.week}`, `Pay ${dayLabel(week.payDay)}`];
  if (planner?.kind === "api")
    parts.push(`Updated ${soonLabel(planner.lastChangeAt, now, timeZone)} from your planner`);
  if (planner?.kind === "sheet" && planner.syncedAt)
    parts.push(`Updated ${soonLabel(planner.syncedAt, now, timeZone)} from your rota sheet`);
  return parts.join(" · ");
}

// The track: sessions with places to fill, all of them or under a filter.
export const SHOW_WORDS: Record<BoardShow, string> = {
  all: "All",
  urgent: "Urgent",
  "this-week": "This week",
  "next-week": "Next week",
};

export const showHref = (show: BoardShow): string =>
  show === "all" ? "/office" : `/office?show=${show}`;

// The address with a session picked into the detail card (the filter kept).
export const pickHref = (show: BoardShow, shiftId: string): string =>
  `/office?${show === "all" ? "" : `show=${show}&`}session=${shiftId}`;

// --- The places chart ------------------------------------------------------------------------

export const CHART_TITLE = "Places to fill";
export const CHART_SUB = "This week and next, by day";
export const CHART_KEY = { toOffer: "To offer", offered: "Offered, no reply yet" } as const;

// The y axis's top: 10, or the most on a day rounded up to the next 10, so the axis reads 0, its
// half and its top in whole numbers and the bars keep their size from day to day.
export function chartTop(days: ChartDay[]): number {
  const most = Math.max(0, ...days.map((d) => d.toOffer + d.offered));
  return Math.max(10, Math.ceil(most / 10) * 10);
}

// "Sat 31: 3 to offer, 7 offered" (a bar's tip), or "Sat 31: nothing to fill".
export function dayTip(d: ChartDay): string {
  const p = datePartsOfDay(d.date);
  const parts = [
    d.toOffer > 0 ? `${d.toOffer} to offer` : null,
    d.offered > 0 ? `${d.offered} offered` : null,
  ].filter(Boolean);
  return `${p.dow} ${p.day}: ${parts.length > 0 ? parts.join(", ") : "nothing to fill"}`;
}

// What the chart shows, in a sentence (its summary for a screen reader): "Places to fill this week
// and next: 13 to offer, 13 offered with no reply yet. Saturday 31 October has the most, 10."
export function chartSummary(days: ChartDay[]): string {
  const toOffer = days.reduce((n, d) => n + d.toOffer, 0);
  const offered = days.reduce((n, d) => n + d.offered, 0);
  if (toOffer + offered === 0) return "No places to fill this week or next.";
  const most = days.reduce((a, b) => (b.toOffer + b.offered > a.toOffer + a.offered ? b : a));
  return `Places to fill this week and next: ${toOffer} to offer, ${offered} offered with no reply yet. ${datePartsOfDay(most.date).long} has the most, ${most.toOffer + most.offered}.`;
}

// --- A session (a card and the detail card) --------------------------------------------------

export const placesText = (n: number) => plural(n, "place to fill", "places to fill");

// "Tue 27 Oct, 08:00–16:00".
export const whenText = (s: Pick<BoardSession, "startsAt" | "endsAt">, timeZone: string) =>
  `${dayLabel(localDateOf(s.startsAt, timeZone))}, ${timeRange(s.startsAt, s.endsAt, timeZone).range}`;

// "Northern Lights Live · Gate A, Acme Demo Arena": the event, then the post and the site.
export function whereText(s: Pick<BoardSession, "eventName" | "post" | "site">): string {
  const place = [s.post, s.site].filter(Boolean).join(", ");
  return place ? `${s.eventName} · ${place}` : s.eventName;
}

// How long until it starts: "45 min", "21 h" (under 2 days), then "3 days" by the firm's calendar.
// `soon` (red): under 2 days.
export function startsIn(
  startsAt: Date,
  now: Date,
  timeZone: string,
): { text: string; soon: boolean } {
  const ms = startsAt.getTime() - now.getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return { text: `${Math.max(1, Math.floor(ms / 60_000))} min`, soon: true };
  if (hours < 48) return { text: `${hours} h`, soon: true };
  const days = Math.round(
    (Date.parse(`${localDateOf(startsAt, timeZone)}T00:00:00Z`) -
      Date.parse(`${localDateOf(now, timeZone)}T00:00:00Z`)) /
      86_400_000,
  );
  return { text: `${days} days`, soon: false };
}

// Under "Offers sent": how they were answered ("No reply yet", "1 said no · 1 no reply yet"), or
// "Not offered yet".
export function repliesText(o: BoardSession["offers"]): string {
  if (o.sent === 0) return "Not offered yet";
  if (o.waiting === o.sent) return "No reply yet";
  return [
    o.tookIt > 0 ? `${o.tookIt} took it` : null,
    o.saidNo > 0 ? `${o.saidNo} said no` : null,
    o.closed > 0 ? `${o.closed} closed` : null,
    o.waiting > 0 ? `${o.waiting} no reply yet` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The detail card's banner: what's in the way of filling it. Amber while offers wait ("Mo Rahman
// hasn't replied since 07:19."), red when nothing is out or casuals can't see it.
export function bannerText(
  s: Pick<BoardSession, "hidden" | "offers">,
  now: Date,
  timeZone: string,
): { text: string; tone: "amber" | "red" } {
  if (s.hidden)
    return {
      text: "Hidden from casuals, so it can't be offered. Show it to casuals first.",
      tone: "red",
    };
  const o = s.offers;
  if (o.waiting > 0 && o.waitingSince) {
    const since = soonLabel(o.waitingSince, now, timeZone);
    const [first = "", second = ""] = o.waitingNames;
    const who =
      o.waiting === 1
        ? `${first} hasn't`
        : o.waiting === 2 && second
          ? `${first} and ${second} haven't`
          : `${first} and ${o.waiting - 1} others haven't`;
    return { text: `${who} replied since ${since}.`, tone: "amber" };
  }
  if (o.sent === 0) return { text: "Not offered to anyone yet.", tone: "red" };
  return { text: "No offers out. Offer it to someone else.", tone: "red" };
}

// A session card's pick button: "Urgent. Door supervisor, Northern Lights Live, Tue 27 Oct,
// 08:00–16:00. 1 to fill, 1 offered, no reply yet. Show its details."
export function cardLabel(s: BoardSession, timeZone: string): string {
  const waiting = s.offers.waiting > 0 ? `, ${s.offers.waiting} offered, no reply yet` : "";
  return `${s.urgent ? "Urgent. " : ""}${roleLabel(s.role)}, ${s.eventName}, ${whenText(s, timeZone)}. ${s.placesFree} to fill${waiting}. Show its details.`;
}

// A session card's paper plane: "Offer door supervisor, Tue 27 Oct 08:00, to someone".
export function offerLabel(s: Pick<BoardSession, "role" | "startsAt">, timeZone: string): string {
  return `Offer ${inSentence(s.role)}, ${dayLabel(localDateOf(s.startsAt, timeZone))} ${clock(s.startsAt, timeZone)}, to someone`;
}

// The detail card's "…": "More for Tuesday's door supervisor at 08:00".
export function moreLabel(s: Pick<BoardSession, "role" | "startsAt">, timeZone: string): string {
  const day = datePartsOfDay(localDateOf(s.startsAt, timeZone)).long.split(" ")[0];
  return `More for ${day}'s ${inSentence(s.role)} at ${clock(s.startsAt, timeZone)}`;
}

// --- The board's columns ---------------------------------------------------------------------

export const COLUMN_TITLES = {
  toOffer: "To offer",
  offered: "Offered",
  overnight: "While you were out",
  toMark: "Who worked?",
} as const;
export type ColumnKey = keyof typeof COLUMN_TITLES;

// Each column's anchor (the top bar's "Offers out" opens #offered).
export const COLUMN_IDS: Record<ColumnKey, string> = {
  toOffer: "to-offer",
  offered: "offered",
  overnight: "while-you-were-out",
  toMark: "who-worked",
};

export const toOfferLine = (places: number) =>
  `${plural(places, "place", "places")}, no offers out`;

export const offeredLine = (places: number, waiting: number) =>
  `${plural(places, "place", "places")} · ${plural(waiting, "offer", "offers")}, no reply yet`;

export const OVERNIGHT_LINE = "Taken by casuals from offers, 18:00 to 08:00";

// "5 sessions from Sun 25 Oct", or from the first day to the last: "Thu 22 to Sun 25 Oct".
export function toMarkLine(items: Pick<TodayToMark, "startsAt">[], timeZone: string): string {
  if (items.length === 0) return "From the last 7 days";
  const days = items.map((i) => localDateOf(i.startsAt, timeZone)).sort();
  const first = days[0]!;
  const last = days.at(-1)!;
  const sessions = plural(items.length, "session", "sessions");
  if (first === last) return `${sessions} from ${dayLabel(first)}`;
  const a = datePartsOfDay(first);
  const from = first.slice(0, 7) === last.slice(0, 7) ? `${a.dow} ${a.day}` : dayLabel(first);
  return `${sessions} from ${from} to ${dayLabel(last)}`;
}

// The count beside a column's title, for a screen reader.
export const countWords = {
  toOffer: (n: number) => plural(n, "session", "sessions"),
  offered: (n: number) => plural(n, "session", "sessions"),
  overnight: (n: number) => plural(n, "place taken", "places taken"),
  toMark: (n: number) => plural(n, "session to mark", "sessions to mark"),
};

// What an empty column says. With nothing at all to fill, To offer says so (under a filter, for
// that filter).
export function emptyText(key: ColumnKey, nothingToFill: boolean, show: BoardShow): string {
  switch (key) {
    case "toOffer":
      if (!nothingToFill) return "Every place here has been offered.";
      return show === "all"
        ? "No places to fill."
        : show === "urgent"
          ? "No urgent places to fill."
          : `No places to fill ${show === "this-week" ? "this week" : "next week"}.`;
    case "offered":
      return "No offers waiting.";
    case "overnight":
      return "Nothing taken last night.";
    case "toMark":
      return "Nothing to mark.";
  }
}

export const showMoreText = (n: number) => `Show ${n} more`;

// A column cut at its first 50: where the rest are.
export const columnMoreText = (n: number) =>
  `${plural(n, "more session", "more sessions")} on Events & sessions`;

// --- While you were out ----------------------------------------------------------------------

export const CHANNEL_WORDS: Record<OfferChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "text message",
  push: "app notification",
};

// "BF" for Ben Fraser.
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

export function takeCard(t: OvernightTake, timeZone: string) {
  const p = datePartsOfDay(localDateOf(t.startsAt, timeZone));
  const at = clock(t.answeredAt, timeZone);
  const how = CHANNEL_WORDS[t.channel];
  return {
    title: `${t.worker} said yes`,
    sub: `${roleLabel(t.role)} · ${t.eventName}`,
    when: `${p.dow} ${p.day} · ${clock(t.startsAt, timeZone)}`,
    said: `${at} · ${how}`,
    label: `${t.worker} took ${inSentence(t.role)}, ${t.eventName}, ${dayLabel(localDateOf(t.startsAt, timeZone))} at ${clock(t.startsAt, timeZone)}: said yes at ${at} by ${how}. Open the shift.`,
  };
}

// --- Who worked? -----------------------------------------------------------------------------

// "Since 16:00" (ended today), "Since yesterday", "Since Sat 24 Oct".
export function sinceText(endedAt: Date, now: Date, timeZone: string): string {
  const day = localDateOf(endedAt, timeZone);
  const today = localDateOf(now, timeZone);
  if (day === today) return `Since ${clock(endedAt, timeZone)}`;
  if (day === addDays(today, -1)) return "Since yesterday";
  return `Since ${dayLabel(day)}`;
}

export const toMarkCount = (n: number) => `${n} to mark`;

export function markLabel(
  g: { role: string; site: string | null; startsAt: Date; endsAt: Date; unmarked: number },
  sessions: number,
  timeZone: string,
): string {
  const at = g.site ? ` at ${g.site}` : "";
  const what =
    sessions > 1
      ? plural(sessions, "session", "sessions")
      : timeRange(g.startsAt, g.endsAt, timeZone).range;
  return `Mark who worked: ${roleLabel(g.role)}${at}, ${dayLabel(localDateOf(g.startsAt, timeZone))}, ${what}, ${plural(g.unmarked, "person", "people")} to mark`;
}
