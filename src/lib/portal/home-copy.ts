import type { NeedsItem } from "../credentials/status";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { DISTANCE_NOT_KNOWN, notWorkedOutText, type TravelFacts } from "../travel/line-copy";
import type { StaffPhoto } from "../uploads/photo";
import { inHand, type SortedMark } from "./in-hand";
import type { MyOffer, OfferTake } from "./my-offers";
import type { OpenShift } from "./open-shifts";
import type { ReachPrompt } from "./reach-me";
import { perHour, roleAndEvent, shiftWhen, soonLabel, timeOnDay } from "./format";
import { needsText, needsUpload } from "./qualification-copy";
import { datePartsOfDay } from "./sign-copy";

// The words of Home's redesign (Phases 18, 20 and 24; docs/screens.md `/`): its rows ("Do this",
// with its two "can we reach you" rows since Phase 28.7, "Offered to you" since 28.15, "Shifts you
// can take", "Pay"), the pass's travel figures and its "Bring and wear" items. Pure.

const METRES_PER_MILE = 1609.344;

// "Thu 22 and Fri 23 Oct", "Sun 25, Tue 27 and Wed 28 Oct", "… and more" past three days: the
// days the shifts are on, soonest first, each once, with the month on the last.
export function daysText(shifts: Pick<OpenShift, "startsAt">[], timeZone: string): string {
  const days = [...new Set(shifts.map((s) => localDateOf(s.startsAt, timeZone)))].sort();
  const shown = days.slice(0, 3).map(datePartsOfDay);
  const words = shown.map((p, i) =>
    i === shown.length - 1 ? `${p.dow} ${p.day} ${p.month}` : `${p.dow} ${p.day}`,
  );
  if (words.length === 0) return "";
  const list =
    words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words.at(-1)!}`;
  return days.length > 3 ? `${list.replace(/ and /, ", ")} and more` : list;
}

const shiftsWord = (n: number) => (n === 1 ? "1 shift" : `${n} shifts`);

// One of Home's rows (Phase 24, round 7: "Do this", "Shifts you can take" and "Pay" as cards of
// rows): the one thing to read, and a line under it. A screen reader hears them in that order:
// "2 urgent shifts near you, Thu 22 and Fri 23 Oct · up to £15.50/hour".
export interface RowText {
  title: string;
  sub: string;
}

// Their days and the best pay: "Thu 22 and Fri 23 Oct · up to £15.50/hour".
function daysAndPay(shifts: Pick<OpenShift, "startsAt" | "payRatePence">[], timeZone: string) {
  const rates = shifts.map((s) => s.payRatePence).filter((p): p is number => p != null);
  const days = daysText(shifts, timeZone);
  return rates.length > 0 ? `${days} · up to ${perHour(Math.max(...rates))}` : days;
}

// The urgent shifts she can take: "2 urgent shifts near you" when they're the ones within her
// travel area (`near`), with their days and the best pay.
export function urgentRowText(
  urgent: Pick<OpenShift, "startsAt" | "payRatePence">[],
  near: boolean,
  timeZone: string,
): RowText {
  const n = urgent.length;
  return {
    title: `${n} urgent ${n === 1 ? "shift" : "shifts"}${near ? " near you" : ""}`,
    sub: daysAndPay(urgent, timeZone),
  };
}

// The other shifts she can take ("3 more you can take" under the urgent row), their days and
// the best pay; with none, when she'll hear of the next. `offerAlerts`: we'll tell her, so her
// alerts are on and something reaches her (Home passes false beside "We can't reach you").
export function applyRowText(
  shifts: Pick<OpenShift, "startsAt" | "payRatePence">[],
  afterUrgent: boolean,
  offerAlerts: boolean,
  timeZone: string,
): RowText {
  if (shifts.length === 0) {
    return {
      title: afterUrgent ? "No other shifts now" : "No shifts right now",
      sub: offerAlerts ? "We'll message you when something matches." : "Check back later.",
    };
  }
  return {
    // Phase 26.10 (fix-2): "take", never "apply".
    title: afterUrgent
      ? `${shifts.length} more you can take`
      : `${shiftsWord(shifts.length)} you can take`,
    sub: daysAndPay(shifts, timeZone),
  };
}

// Pay day, on the firm's pay calendar (P3; 25.2): "Pay day: Fri 30 Oct", for the shifts of the
// week it pays ("For shifts Mon 19 to Sun 25 Oct"); on a fortnight's cycle, its dates ("For shifts
// from Mon 26 Oct to Sun 8 Nov"). A week of two months names both ("Mon 26 Oct to Sun 1 Nov").
export function payDayRowText(
  payDay: string,
  period: { days: 7 | 14; start: string; end: string },
): RowText {
  const p = datePartsOfDay(payDay);
  const day = (d: string) => {
    const x = datePartsOfDay(d);
    return `${x.dow} ${x.day} ${x.month}`;
  };
  return {
    title: `Pay day: ${p.dow} ${p.day} ${p.month}`,
    sub:
      period.days === 7
        ? `For shifts ${weekText(period.start, period.end)}`
        : `For shifts from ${day(period.start)} to ${day(period.end)}`,
  };
}

// "Mon 2 to Sun 8 Nov"; "Mon 26 Oct to Sun 1 Nov" across two months.
function weekText(start: string, end: string): string {
  const a = datePartsOfDay(start);
  const b = datePartsOfDay(end);
  const first = a.month === b.month ? `${a.dow} ${a.day}` : `${a.dow} ${a.day} ${a.month}`;
  return `${first} to ${b.dow} ${b.day} ${b.month}`;
}

// Home's two "can we reach you" rows in "Do this" (Phase 28.7; docs/screens.md "The casual app,
// Phase 28", 28.7; when each shows: src/lib/portal/reach-me.ts), online only, both to Profile's
// "How we reach you".
export const REACH_PATH = "/profile#notify-heading";
export const REACH_ROWS: Record<ReachPrompt, RowText> = {
  unreachable: {
    title: "We can't reach you about shifts",
    sub: "You'll miss offers and changes to your shifts. Choose how we reach you.",
  },
  alerts_off: {
    title: "Open-shift alerts are off",
    sub: "We won't tell you about open shifts. Turn them on.",
  },
};

// "Offered to you" (Phase 28.15; docs/screens.md "### 28.15"): an offer still open to her, as a
// row: "Steward · Raceday", "Sat 7 Nov, 14:00 to 22:00 · Riverside Arena", then when it was offered
// ("Offered 21:20" today; "Offered 21:20 on Sun 1 Nov" before) and "First to take it gets it."
// No deadline: an offer stays open until the shift fills, moves or is cancelled.
// The second sentence says what the shift's page would let her do now (`take`, from myOffers, by
// that page's own checks): take it ("First to take it gets it."), only ask for it (the office
// chooses for its event), or take it once fair rotation's hold ends.
export const FIRST_TO_TAKE = "First to take it gets it.";
export const OFFICE_CHOOSES = "The office chooses who works this one. You can ask for it.";
export const heldUntilText = (opensAt: Date, now: Date, timeZone: string) =>
  `You can take it from ${soonLabel(opensAt, now, timeZone)}.`;
export function offerRowText(
  o: Pick<MyOffer, "role" | "eventName" | "siteName" | "startsAt" | "endsAt" | "sentAt"> & {
    take?: OfferTake;
  },
  now: Date,
  timeZone: string,
): RowText & { offered: string } {
  const when = shiftWhen(o.startsAt, o.endsAt, timeZone);
  const sameDay = localDateOf(o.sentAt, timeZone) === localDateOf(now, timeZone);
  const w = wallTimeOf(o.sentAt, timeZone);
  const clock = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  const take = o.take ?? { kind: "now" };
  const next =
    take.kind === "ask"
      ? OFFICE_CHOOSES
      : take.kind === "held"
        ? heldUntilText(take.opensAt, now, timeZone)
        : FIRST_TO_TAKE;
  return {
    title: roleAndEvent(o.role, o.eventName),
    sub: o.siteName ? `${when} · ${o.siteName}` : when,
    offered: `Offered ${sameDay ? clock : timeOnDay(o.sentAt, timeZone)}. ${next}`,
  };
}

// Its "No thanks" step, and what she's told after (every answer ends with words). After saying no
// she holds no waiting offer, so where the office chooses for the event she can only ask for it
// (`lineAsk`; MyOffer.afterNo). Both name the shift's page, not Open shifts: that list shows only
// her travel area and the next 28 days, and an offer can fall outside both.
export const DECLINE_STEP = {
  button: "No thanks",
  title: "Say no to this shift?",
  line: "We won't offer it to you again. You can still take it from the shift's page while it's open.",
  lineAsk:
    "We won't offer it to you again. The office chooses who works this one: you can still ask for it on the shift's page.",
  yes: "Yes, say no",
  sending: "Saying no…",
  keep: "Keep the offer",
};
export const OPEN_THE_SHIFT = "Open the shift";

export type DeclineShown = { tone: "done" | "quiet" | "urgent"; title: string; line?: string };
export function declineOutcomeText(
  status: "declined" | "already" | "taken" | "closed" | "error",
  tryAgain: string,
  afterNo: "take" | "ask" = "take",
): DeclineShown {
  switch (status) {
    case "declined":
      return {
        tone: "done",
        title: "Done. You won't be offered this shift again.",
        line:
          afterNo === "ask"
            ? "The office chooses who works this one. You can still ask for it on the shift's page."
            : "You can still take it from the shift's page while it's open.",
      };
    case "already":
      return { tone: "quiet", title: "You've already said no to this shift." };
    case "taken":
      return {
        tone: "done",
        title: "You've already taken this shift.",
        line: "It's under Shifts.",
      };
    case "closed":
      return {
        tone: "quiet",
        title: "This offer has closed.",
        line: "The shift was filled, moved or cancelled.",
      };
    case "error":
      return { tone: "urgent", title: tryAgain };
  }
}

// The offline copy's first row: what the urgent row said when it was kept.
export const offlineUrgentText = (n: number, at: string) =>
  n === 0
    ? `Open shifts show when you're online again.`
    : `${n === 1 ? "1 was" : `${n} were`} urgent at ${at}. We'll check again when you're online.`;

// What needs doing, as one row: the one thing (its title, the sentence Needs updating would
// say, and where she sorts it), or how many things, with the worst one's sentence (→ Profile). `urgent`: something
// stops her working (a qualification at level 1 or 2, or her photo overdue).
// Phase 28.15 (28.11's hand-off): a qualification the office marked sorted, while that mark still
// stands (inHand, src/lib/portal/in-hand.ts, as Profile reads it), isn't hers to do, so it isn't
// here: Profile says "The office has this in hand." A suspended one goes to Messages, where she
// tells the office (an upload can't lift it).
type NeedsRowItem = { title: string; sub: string; href: string; level: number; photo: boolean };
function needsItems(
  needs: NeedsItem[],
  photo: StaffPhoto,
  year: number,
  mark: SortedMark | null,
): NeedsRowItem[] {
  const items: NeedsRowItem[] = needs
    .filter((n) => !inHand(n.qualification, mark))
    .map((n) => ({
      title: needsTitle(n),
      sub: needsText(n, year),
      href: needsUpload(n.qualification)
        ? `/profile/upload/${n.qualification.type}`
        : n.qualification.status === "suspended"
          ? "/messages"
          : "/profile",
      level: n.level,
      photo: false,
    }));
  if (photo.status === "overdue" || photo.status === "due_soon") {
    items.push({
      title: "Renew your staff photo",
      sub: photoDue(photo),
      href: "/profile#photo-heading",
      level: photo.status === "overdue" ? 2 : 3,
      photo: true,
    });
  }
  return items.sort((a, b) => a.level - b.level);
}

// How many things "Do this" stands for (Phase 30.1: Home's "To do" count, the page adding the two
// "can we reach you" rows): the same items needsRowText() counts.
export const needsCount = (
  needs: NeedsItem[],
  photo: StaffPhoto,
  year: number,
  mark: SortedMark | null = null,
): number => needsItems(needs, photo, year, mark).length;

export function needsRowText(
  needs: NeedsItem[],
  photo: StaffPhoto,
  year: number,
  mark: SortedMark | null = null,
): { title: string; sub: string; href: string; urgent: boolean; photo: boolean } | null {
  const items = needsItems(needs, photo, year, mark);
  if (items.length === 0) return null;
  const first = items[0]!;
  const urgent = first.level <= 2;
  if (items.length === 1) {
    return { title: first.title, sub: first.sub, href: first.href, urgent, photo: first.photo };
  }
  // Several: how many, and the worst one's own sentence (Profile has them all).
  return {
    title: `${items.length} things need doing`,
    sub: `${first.sub} And ${items.length - 1} more.`,
    href: "/profile",
    urgent,
    photo: false,
  };
}

// "Due by 10 Nov.", "It was due by 10 Nov." (her photo's renewal date).
function photoDue(photo: StaffPhoto): string {
  const by = photo.current?.renewBy;
  if (!by) return photo.status === "overdue" ? "It's overdue." : "It's due soon.";
  const p = datePartsOfDay(by);
  return photo.status === "overdue"
    ? `It was due by ${p.day} ${p.month}.`
    : `Due by ${p.day} ${p.month}.`;
}

// A qualification's short title, by what she has to do about it.
// The stored name is already mid-sentence ("SIA door supervisor licence", "first aid at work
// certificate").
function needsTitle(n: NeedsItem): string {
  const lower = n.qualification.name;
  switch (n.qualification.status) {
    case "missing":
      return `Add your ${lower}`;
    case "suspended":
      return `Your ${lower} is suspended`;
    case "applied":
      return `Your ${lower} is applied for`;
    case "being_checked":
      return `We're checking your ${lower}`;
    case "rejected":
      return `Send your ${lower} again`;
    default:
      return `Renew your ${lower}`;
  }
}

// Getting there as three figures with their words (Phase 24, round 7: how far first, "3.1" miles
// away, then "15 min" by car and "31 min" by public transport), or, until the times are worked out,
// the travel line's one sentence (src/lib/travel/line-copy.ts; Phase 28, 28.8: "About 2 miles away.
// Travel time isn't worked out yet." in place of "2 miles in a straight line" and "Not known travel
// time yet", which read as values). On the pass's details and a shift's page.
export type TravelStrip =
  { kind: "cells"; cells: { figure: string; words: string }[] } | { kind: "words"; words: string };

function straightCell(metres: number) {
  const n = Math.max(1, Math.round(metres / METRES_PER_MILE));
  return { figure: String(n), words: `${n === 1 ? "mile" : "miles"} in a straight line` };
}

export function travelStrip(f: TravelFacts): TravelStrip {
  if (f.kind === "unknown") return { kind: "words", words: DISTANCE_NOT_KNOWN };
  if (f.kind === "straight") return { kind: "words", words: notWorkedOutText(f.straightMetres) };
  const miles =
    f.car?.metres != null
      ? { figure: (f.car.metres / METRES_PER_MILE).toFixed(1), words: "miles away" }
      : straightCell(f.straightMetres);
  return {
    kind: "cells",
    cells: [
      miles,
      f.car
        ? { figure: `${f.car.minutes} min`, words: "by car" }
        : { figure: "90+ min", words: "by car" },
      f.publicTransport
        ? { figure: `${f.publicTransport.minutes} min`, words: "by public transport" }
        : { figure: "None", words: "public transport in time" },
    ],
  };
}

// "Bring and wear", as tiles: the firm's uniform words split at commas and semicolons (not
// inside brackets), each item's bracketed words its note ("We provide it"), and what kind of
// thing it is for its icon. Hi-vis comes first, as a full-width sign-yellow tile. More than six
// items, or nothing to split: null (the words are shown as they are).
export type UniformKind = "hivis" | "trousers" | "shoe" | "garment";
export interface UniformItem {
  words: string;
  note: string | null;
  kind: UniformKind;
}

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function uniformItems(text: string | null | undefined): UniformItem[] | null {
  if (!text?.trim()) return null;
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const items = parts
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .map((p): UniformItem => {
      const note = p.match(/\(([^)]*)\)/)?.[1]?.trim() || null;
      const words = p.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      const kind: UniformKind = /\b(hi-?vis|high-?vis|tabard|vest|reflective)\b/i.test(words)
        ? "hivis"
        : /\b(trousers|jeans|skirt|shorts)\b/i.test(words)
          ? "trousers"
          : /\b(shoes?|boots?|footwear|trainers)\b/i.test(words)
            ? "shoe"
            : "garment";
      return { words: capital(words), note: note ? capital(note) : null, kind };
    });
  if (items.length === 0 || items.length > 6) return null;
  // Long items, or sentences ("Black trousers, boots. Hi-vis provided."), read better as written.
  if (items.some((i) => i.words.length > 60 || /[.!?]\s/.test(i.words))) return null;
  return [...items.filter((i) => i.kind === "hivis"), ...items.filter((i) => i.kind !== "hivis")];
}

// --- Phase 30.1: Home as her dashboard (docs/screens.md "### 30.1") --------------------------
// The words of the new parts: the counts under "Hi Zoe", the next shift's countdown line, "Your
// qualifications", "Your week", "Updates" and "Your record". Pure; the figures come from
// src/lib/portal/home-board.ts and home-week.ts.

const two = (n: number) => String(n).padStart(2, "0");
const clockOf = (at: Date, timeZone: string) => {
  const w = wallTimeOf(at, timeZone);
  return `${two(w.hour)}:${two(w.minute)}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The date line under "Hi Zoe": "Friday 6 November", then (online only) "Updated 15:38".
export const dateLineText = (now: Date, timeZone: string) =>
  datePartsOfDay(localDateOf(now, timeZone)).long;
export const updatedText = (now: Date, timeZone: string) => `Updated ${clockOf(now, timeZone)}`;

// The counts, in the office's top-bar chips: each opens the page it counts.
export const COUNTS_LABEL = "Your numbers";
export const COUNT_WORDS = {
  booked: "Booked",
  open: "Open to you",
  urgent: "Urgent",
  todo: "To do",
  messages: "Messages",
} as const;

// The next shift's line under the pass's role: "Starts in 70 hours · 8 hours · about £108.00 before
// tax". Under 72 hours in whole hours, then in whole days; under an hour, "less than an hour".
export function startsInText(startsAt: Date, now: Date): string | null {
  const ms = startsAt.getTime() - now.getTime();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "Starts in less than an hour";
  if (hours < 72) return `Starts in ${plural(hours, "hour", "hours")}`;
  return `Starts in ${plural(Math.floor(hours / 24), "day", "days")}`;
}
export const aboutPayText = (money: string) => `about ${money} before tax`;

// "Your qualifications".
export const QUALS_TITLE = "Your qualifications";
export const QUALS_ALL = "All on Profile";
export const QUALS_PATH = "/profile#qualifications-heading";
export const OTHER_QUALS_PATH = "/profile#other-qualifications-heading";
export const PHOTO_TITLE = "Staff photo";
export const PHOTO_PATH = "/profile#photo-heading";
export const PHOTO_NEW = "Take a new photo";
// With no photo on file there's nothing to replace.
export const PHOTO_FIRST = "Take a photo";
export const PHOTO_NONE = "No photo yet.";
export const PHOTO_CHECKING = "The office will check your new one.";
export const RTW_TITLE = "Right to work";
export const RTW_WORDS = {
  checked: "Checked",
  ranOut: "Check has run out",
  none: "Not recorded",
} as const;
export const RTW_NONE_LINE = "The office will ask if they need it.";
export const RTW_RAN_OUT_LINE = "Ask the office.";
// A status pill's words with days: "Valid · 420 days", "Expires in 20 days", "20 days left".
export const validForText = (days: number) => `Valid · ${plural(days, "day", "days")}`;
export const expiresInText = (days: number) =>
  days <= 0 ? "Expires today" : `Expires in ${plural(days, "day", "days")}`;
export const daysLeftText = (days: number) =>
  days <= 0 ? "Due today" : `${plural(days, "day", "days")} left`;
export const NO_EXPIRY = "No expiry";
export const renewByText = (day: string) => {
  const p = datePartsOfDay(day);
  return `Renew by ${p.day} ${p.month}`;
};
// The kept copy's pill (no signal: it may be opened days later, so never a day count and never the
// bare word "Valid"): the date alone. "Until 22 Nov 2028" (a valid one), "Expires 26 Nov" (one
// expiring soon), and her photo's "Renew by 26 Nov". The date as Profile writes it (the year only
// when it isn't this one).
export const untilText = (date: string) => `Until ${date}`;
export const expiresOnText = (date: string) => `Expires ${date}`;

// "Your week": this week and next, Monday to Sunday.
export const WEEK_TITLE = "Your week";
export const WEEK_ROWS = ["This week", "Next week"] as const;
export const WEEK_LEGEND = "Filled: booked · outlined: shifts you can take";
// The kept copy's (no outlines there: the shifts she could take need signal).
export const WEEK_LEGEND_OFFLINE = "Filled: booked";
// "2 to 8 Nov"; "26 Oct to 1 Nov" across two months.
export function weekRangeText(monday: string, sunday: string): string {
  const a = datePartsOfDay(monday);
  const b = datePartsOfDay(sunday);
  return a.month === b.month
    ? `${a.day} to ${b.day} ${b.month}`
    : `${a.day} ${a.month} to ${b.day} ${b.month}`;
}
// A day tile's name for a screen reader: "Monday 9 November: booked, Steward 14:00 to 22:00",
// "Saturday 7 November: 2 shifts you can take", "Friday 6 November, today: nothing booked", and a
// past day she was marked as not attending, "Monday 2 November: not attended, Steward 14:00 to
// 22:00" (never "booked"). The kept copy's name leaves out "today" and the shifts she can take
// (they go stale): homeWeek passes `today: false, open: 0` for it.
export function dayTileName(o: {
  long: string;
  today: boolean;
  booked: string[]; // "Steward 14:00 to 22:00", one for each booking that day
  missed?: string[]; // the same, for each booking that day marked not attended
  open: number;
}): string {
  const head = o.today ? `${o.long}, today` : o.long;
  const can = o.open > 0 ? `${plural(o.open, "shift", "shifts")} you can take` : "";
  const missed = o.missed ?? [];
  const parts = [
    o.booked.length > 0 ? `booked, ${o.booked.join(" and ")}` : "",
    missed.length > 0 ? `not attended, ${missed.join(" and ")}` : "",
  ].filter(Boolean);
  if (parts.length > 0) {
    const what = parts.join("; ");
    return can ? `${head}: ${what}. Also ${can}` : `${head}: ${what}`;
  }
  return can ? `${head}: ${can}` : `${head}: nothing booked`;
}

// "Updates": her latest entries from her shift record.
export const UPDATES_TITLE = "Updates";
export const UPDATES_EMPTY = "Nothing new yet.";
export const SEE_THE_SHIFT = "See the shift";
export const UPDATES_MAX = 5;
// When it happened: "Today 15:02", "Yesterday 09:14", "Wed 15:02" in the last week, else "Wed 28
// Oct, 15:02".
export function updateWhenText(at: Date, now: Date, timeZone: string): string {
  const day = localDateOf(at, timeZone);
  const today = localDateOf(now, timeZone);
  const clock = clockOf(at, timeZone);
  if (day === today) return `Today ${clock}`;
  const p = datePartsOfDay(day);
  const dayNo = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000);
  };
  const ago = dayNo(today) - dayNo(day);
  if (ago === 1) return `Yesterday ${clock}`;
  if (ago > 1 && ago < 7) return `${p.dow} ${clock}`;
  return updateAtText(at, timeZone);
}
// The kept copy's (its "Today" and "Yesterday" go stale): always the day and date, "Mon 2 Nov,
// 15:02".
export function updateAtText(at: Date, timeZone: string): string {
  const p = datePartsOfDay(localDateOf(at, timeZone));
  return `${p.dow} ${p.day} ${p.month}, ${clockOf(at, timeZone)}`;
}

// "Your record": three figures, as Profile's.
export const RECORD_CARD_TITLE = "Your record";
export const NEW_FIGURE = "New";
export const workedLabel = (n: number) => (n === 1 ? "shift worked" : "shifts worked");
export const RELIABILITY_LABEL = "reliability";
export const scoreAfterText = (min: number) => `score after ${min} shifts`;
export const strikesLabel = (n: number, days: number) =>
  `${n === 1 ? "strike" : "strikes"} in ${days} days`;
