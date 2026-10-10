import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { assignments, firms, shiftEvents, shifts, sites, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { AUTOMATIC_REPLY, type FirmVoice } from "../messaging/templates";
import { openShiftsFor, type NotOfferedReason, type OpenShift } from "../portal/open-shifts";
import type { RuleCheck } from "../rules/eligibility";
import { dayLabel } from "../rules/reasons";
import { noticeHours } from "../roster/notice";
import { decideForWorker, firmStrikeSettings } from "../strikes/issue";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";
import { travelLineText, type TravelFacts } from "../travel/line-copy";

// The shifts line's personal replies (docs/office-v2.md 3.6, 5.7 items 1 and 2; 12D.2): the answer
// to "shifts" and "cancel", built by code from the firm's data, never by AI. Server only.
//
// - Shifts: the casual app's own Open shifts (openShiftsFor(): the rules, the showing switches and
//   her travel area), urgent first, then the nearest; at most 5, each "Role · event, site · date
//   times · £/h · post" with its travel line, inside the 1,600 characters a WhatsApp or text may
//   hold (names cut to set lengths, then fewer shifts, then "+ N more: {link}"); always "Take one
//   here: {link}" (no booking by reply number: D6 deferred). The booked line and the day words only
//   when she named a day (a weekday, "weekend", "today" or "tomorrow"). Her home is "your home
//   area", never the postcode: the office reads the reply word for word.
// - Cancel: her next booking, named, with the link to it; the strike sentence only when a strike
//   would apply (the cancel step's own strikeDecision(), via decideForWorker()); "Your other
//   shifts" with two or more bookings ahead.
// Every instant reply ends "Automatic reply. Send OFFICE to reach a person." before the sign-off.
// What the office sees of how it was built goes in `enquiry.checks` (EnquiryChecks below): ids,
// codes, dates and minutes only.

export const MAX_BODY = 1600; // a WhatsApp's or a text's limit (src/lib/messaging/transport.ts)
export const MAX_LISTED = { whatsapp: 5, sms: 3 } as const;
export const AUTOMATIC = AUTOMATIC_REPLY;
const CUTS = [60, 40, 25, 15]; // the longest a name may be, tried in turn until the reply fits

type Channel = "whatsapp" | "sms";

const signed = (firm: FirmVoice, channel: Channel, text: string) =>
  channel === "sms" ? `${text} - ${firm.signOff}` : `${text}\n— ${firm.signOff}`;

// A name cut to `max` characters. A text's cut ends "..." (GSM-7: "…" would make the whole text
// cost 70-character parts), and never splits a character in two.
const cut = (text: string, max: number, ellipsis = "…") => {
  const chars = [...text];
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, Math.max(1, max - ellipsis.length))
        .join("")
        .trimEnd()}${ellipsis}`;
};
const FIRST_NAME_MAX = 40;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
// "Sat 10 Oct 08:00–16:00" (a text: "08:00-16:00").
const when = (s: { startsAt: Date; endsAt: Date }, tz: string, dash = "–") =>
  `${dayLabel(localDateOf(s.startsAt, tz))} ${hhmm(s.startsAt, tz)}${dash}${hhmm(s.endsAt, tz)}`;
// Midnight at the start of a firm-local date.
const midnight = (date: string, timeZone: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
};
const money = (pence: number) => `£${(pence / 100).toFixed(2)}/h`;
// "Door supervisor", "CSAS officer" (an acronym stays in capitals, as on her Profile).
const roleLabel = (role: string) => {
  const words = role.replace(/_/g, " ").replace(/\bcsas\b/g, "CSAS");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// The days a message names, from her own words (code, not AI): a weekday (the next one, today
// counting), "weekend", "today" or "tomorrow". Null: no day named.
const WEEKDAYS: [string, number][] = [
  ["monday", 1],
  ["mon", 1],
  ["tuesday", 2],
  ["tue", 2],
  ["tues", 2],
  ["wednesday", 3],
  ["wed", 3],
  ["weds", 3],
  ["thursday", 4],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["friday", 5],
  ["fri", 5],
  ["saturday", 6],
  ["sat", 6],
  ["sunday", 0],
  ["sun", 0],
];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface AskedDays {
  dates: string[]; // yyyy-mm-dd, the firm's local dates
  forWords: string; // "For Saturday", "For the weekend", "For today"
  onWords: string; // "on Saturday", "at the weekend", "today"
}

export function askedDays(text: string, now: Date, timeZone: string): AskedDays | null {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const today = localDateOf(now, timeZone);
  const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
  const next = (weekday: number) => {
    let d = today;
    for (let i = 0; i < 7 && weekdayOf(d) !== weekday; i++) d = addDays(d, 1);
    return d;
  };
  const found: { dates: string[]; name: string; on: string }[] = [];
  if (words.has("today") || words.has("tonight")) {
    found.push({ dates: [today], name: "today", on: "today" });
  }
  if (words.has("tomorrow")) {
    found.push({ dates: [addDays(today, 1)], name: "tomorrow", on: "tomorrow" });
  }
  if (words.has("weekend")) {
    const sat = next(6);
    // On a Sunday, "this weekend" is what's left of it: today.
    const dates = weekdayOf(today) === 0 ? [today] : [sat, addDays(sat, 1)];
    found.push({ dates, name: "the weekend", on: "at the weekend" });
  }
  const seen = new Set<number>();
  for (const [word, weekday] of WEEKDAYS) {
    if (!words.has(word) || seen.has(weekday)) continue;
    seen.add(weekday);
    const name = WEEKDAY_NAMES[weekday] ?? "";
    found.push({ dates: [next(weekday)], name, on: `on ${name}` });
  }
  if (found.length === 0) return null;
  const dates = [...new Set(found.flatMap((f) => f.dates))].sort();
  const name = found.map((f) => f.name).join(" and ");
  return {
    dates,
    forWords: `For ${name}`,
    onWords: found.length === 1 ? (found[0]?.on ?? "") : `on ${name}`,
  };
}

// One shift as the reply lists it.
export interface ListedShift {
  shiftId: string;
  role: string;
  eventName: string | null;
  siteName: string | null;
  startsAt: Date;
  endsAt: Date;
  payRatePence: number | null;
  post: string | null;
  urgent: boolean;
  holdsCsas: boolean; // the session needs CSAS, which she holds (§5.7's "you hold CSAS")
  travel: TravelFacts;
}

export interface BookedLine {
  role: string;
  eventName: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface ShiftsReplyInput {
  firstName: string;
  firm: FirmVoice;
  timeZone: string;
  asked: AskedDays | null;
  booked: BookedLine[]; // her bookings on the days she asked about
  shifts: ListedShift[]; // all she could take, in order
  area: { maxMinutes: number } | null; // her travel area (null: none set)
  offerAlerts: boolean; // she gets told of new shifts ("We'll message you…")
  links: { take: string; profile: string };
}

function whatsappLine(s: ListedShift, i: number, tz: string, max: number, area: boolean): string {
  const place = [s.eventName, s.siteName].filter((x): x is string => !!x).map((x) => cut(x, max));
  const parts = [
    `${i + 1}. ${cut(roleLabel(s.role), max)}${place.length ? ` · ${place.join(", ")}` : ""}`,
    when(s, tz),
    ...(s.payRatePence !== null ? [money(s.payRatePence)] : []),
    ...(s.post ? [cut(s.post, max)] : []),
    ...(s.urgent ? ["urgent"] : []),
    ...(s.holdsCsas ? ["you hold CSAS"] : []),
  ];
  const line = parts.join(" · ");
  return area ? `${line}\n   ${travelLineText(s.travel, tz)}` : line;
}

// A text's travel: the app's travel line (the distance and the time by car and by public
// transport, or why they aren't known), with commas: "·" isn't in the plain text alphabet.
function smsTravel(f: TravelFacts, tz: string): string {
  return travelLineText(f, tz)
    .split(" · ")
    .map((part) => part.charAt(0).toLowerCase() + part.slice(1))
    .join(", ");
}

function smsLine(s: ListedShift, i: number, tz: string, max: number, area: boolean): string {
  const travel = area ? smsTravel(s.travel, tz) : null;
  const parts = [
    `${when(s, tz, "-")} ${cut(roleLabel(s.role), max, "...")}`,
    ...(s.siteName ? [cut(s.siteName, max, "...")] : []),
    ...(s.payRatePence !== null ? [money(s.payRatePence)] : []),
    ...(travel ? [travel] : []),
  ];
  return `${i + 1}) ${parts.join(", ")}.`;
}

// Her bookings on the days she named: at most two, names cut like the list's, then "and N more".
const BOOKED_SHOWN = 2;
const bookedWords = (b: BookedLine[], tz: string, max: number) => {
  const shown = b
    .slice(0, BOOKED_SHOWN)
    .map(
      (x) =>
        `${dayLabel(localDateOf(x.startsAt, tz))} (${cut(roleLabel(x.role), max)}${x.eventName ? ` · ${cut(x.eventName, max)}` : ""} · ${hhmm(x.startsAt, tz)}–${hhmm(x.endsAt, tz)})`,
    );
  const rest = b.length - shown.length;
  return [...shown, ...(rest > 0 ? [`${rest} more`] : [])].join(" and ");
};

// The shifts reply in one channel, and how many shifts it lists. Always within 1,600 characters:
// names are cut shorter, then fewer shifts listed, and as a last resort only the link.
export function shiftsReplyText(
  input: ShiftsReplyInput,
  channel: Channel,
): { text: string; listed: number } {
  const { firm, timeZone: tz, asked, area } = input;
  const firstName = cut(input.firstName, FIRST_NAME_MAX);
  const booked = (max: number) =>
    asked && input.booked.length > 0
      ? `you're booked on ${bookedWords(input.booked, tz, max)}.`
      : null;
  const fits = (text: string) => {
    const body = signed(firm, channel, text);
    return body.length <= MAX_BODY ? body : null;
  };
  if (input.shifts.length === 0) {
    const day = asked ? ` ${asked.onWords}` : "";
    const within = area ? ` within ${area.maxMinutes} minutes of your home area` : "";
    const alerts = input.offerAlerts ? " We'll message you if something comes up." : "";
    for (const max of CUTS) {
      const b = booked(max);
      const body = fits(
        channel === "sms"
          ? `${firm.name}: nothing you can take${day} right now. All open shifts: ${input.links.take} ${AUTOMATIC}`
          : `Hi ${firstName}, ${b ? `${b} There's nothing else` : "there's nothing"} you can take${day}${within} right now.${alerts} All open shifts: ${input.links.take}\n${AUTOMATIC}`,
      );
      if (body) return { text: body, listed: 0 };
    }
    return { text: lastResort(input, channel), listed: 0 };
  }
  const most = Math.min(MAX_LISTED[channel], input.shifts.length);
  for (let n = most; n >= 1; n--) {
    for (const max of CUTS) {
      const listed = input.shifts.slice(0, n);
      const more = input.shifts.length - n;
      let text: string;
      if (channel === "sms") {
        const lines = listed.map((s, i) => smsLine(s, i, tz, max, area !== null)).join(" ");
        text = [
          `${firm.name}: shifts for you: ${lines}`,
          ...(more > 0 ? [`+ ${more} more.`] : []),
          ...(area ? [] : [`Add your home area: ${input.links.profile}`]),
          `Take one: ${input.links.take}`,
          AUTOMATIC,
        ].join(" ");
      } else {
        const b = booked(max);
        const opening = asked
          ? `Hi ${firstName}, ${b ? `${b} ` : ""}${b ? asked.forWords : asked.forWords.replace(/^For/, "for")} you can take:`
          : `Hi ${firstName}, shifts you can take:`;
        text = [
          opening,
          ...listed.map((s, i) => whatsappLine(s, i, tz, max, area !== null)),
          ...(more > 0 ? [`+ ${more} more: ${input.links.take}`] : []),
          ...(area
            ? []
            : [`Add your home area to see how far each one is: ${input.links.profile}`]),
          `Take one here: ${input.links.take}`,
          AUTOMATIC,
        ].join("\n");
      }
      const body = fits(text);
      if (body) return { text: body, listed: n };
    }
  }
  return { text: lastResort(input, channel), listed: 0 };
}

// Only the link, when nothing else fits (a firm's name or a link far longer than any real one).
function lastResort(input: ShiftsReplyInput, channel: Channel): string {
  const text = `Shifts you can take: ${input.links.take} ${AUTOMATIC}`;
  const body = signed(input.firm, channel, text);
  return body.length <= MAX_BODY ? body : text.slice(0, MAX_BODY);
}

export interface CancelReplyInput {
  firstName: string;
  firm: FirmVoice;
  timeZone: string;
  // Her next booking (null: none ahead), and whether cancelling it now gives her a strike.
  next: {
    role: string;
    eventName: string | null;
    siteName: string | null;
    startsAt: Date;
    endsAt: Date;
    post: string | null;
    link: string;
  } | null;
  strike: { thresholdHours: number } | null;
  others: number; // her other bookings ahead (only whether there are any is read)
  links: { booked: string };
}

export function cancelReplyText(input: CancelReplyInput, channel: Channel): string {
  const { firm, timeZone: tz, next } = input;
  const firstName = cut(input.firstName, FIRST_NAME_MAX);
  if (!next) {
    return signed(
      firm,
      channel,
      `Hi ${firstName}, you have no shifts booked, so there's nothing to cancel. ${AUTOMATIC}`,
    );
  }
  // Every part cut, so the reply stays far inside 1,600 characters.
  const ellipsis = channel === "sms" ? "..." : "…";
  const place = [next.eventName, next.siteName]
    .filter((x): x is string => !!x)
    .map((x) => cut(x, 60, ellipsis));
  const what = [
    `${cut(roleLabel(next.role), 60, ellipsis)}${place.length ? ` · ${place.join(", ")}` : ""}`,
    when(next, tz, channel === "sms" ? "-" : "–"),
    ...(next.post ? [cut(next.post, 60, ellipsis)] : []),
  ].join(" · ");
  const strike = input.strike
    ? ` It starts in less than ${input.strike.thresholdHours} hours, so cancelling now gives you a strike.`
    : "";
  const others = input.others > 0 ? ` Your other shifts: ${input.links.booked}` : "";
  return signed(
    firm,
    channel,
    `Hi ${firstName}, you're booked on ${what}. To cancel, open it and tap Cancel this shift: ${next.link}.${strike}${others} ${AUTOMATIC}`,
  );
}

// What `enquiry.checks` records (docs/office-v2.md 3.6, 6.1): ids, codes, dates and minutes only,
// never a postcode, a name or typed text. At most 50 not-offered sessions, then a count.
export interface EnquiryChecks {
  template: "shifts_list" | "shifts_none" | "cancel_booking" | "cancel_none";
  days: string[]; // the days she asked about (none: any)
  area: { maxMinutes: number } | null;
  offered: {
    shiftId: string;
    car: number | null; // minutes (null: over 90 or not known)
    publicTransport: number | null;
    checks: LoggedCheck[];
  }[];
  more: number; // she could take these too: "+ N more"
  notOffered: { shiftId: string; reasons: NotOfferedReason[] }[];
  notOfferedMore: number; // not offered, beyond the 50 listed
  notChecked: number; // considered but past the sessions read, so not checked one by one
  bookings: string[]; // the bookings a cancel reply named (assignment ids)
}

// A check as logged: its figures beside its code (lists as text, so the entry stays shallow).
export type LoggedCheck = { code: string; passed: boolean } & Record<
  string,
  string | number | boolean | null
>;
export const loggedCheck = (c: RuleCheck): LoggedCheck => {
  const flat: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(c.detail)) flat[k] = Array.isArray(v) ? v.join(",") : v;
  return { ...flat, code: c.code, passed: c.passed };
};

const minutesOf = (f: TravelFacts) =>
  f.kind === "estimated"
    ? { car: f.car?.minutes ?? null, publicTransport: f.publicTransport?.minutes ?? null }
    : { car: null, publicTransport: null };

// The reply in each channel's words, and what each was built from: the shifts line logs the one
// for the channel it went by (a text lists at most 3, a WhatsApp 5).
export interface PersonalReply {
  whatsapp: string;
  sms: string;
  checks: Record<Channel, EnquiryChecks>;
}

// The shifts reply for one casual, from her own words and the casual app's list.
export async function shiftsReply(
  run: WithFirm,
  input: {
    firmId: string;
    workerId: string;
    text: string | null;
    now: Date;
    firm: FirmVoice;
    portal: string; // the firm's portal address
  },
): Promise<PersonalReply> {
  const { firmId, workerId, now } = input;
  const facts = await run(firmId, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const [me] = await tx
      .select({ firstName: workers.firstName })
      .from(workers)
      .where(eq(workers.id, workerId));
    return { timeZone: firm?.timezone ?? "Europe/London", firstName: me?.firstName ?? "" };
  });
  const asked = input.text ? askedDays(input.text, now, facts.timeZone) : null;
  const list = await openShiftsFor(
    { firm: { id: firmId }, run, clock: { now: () => now } },
    workerId,
    asked ? { days: asked.dates } : {},
    { explain: true },
  );
  // Takeable now: one held for others (fair rotation) isn't offered.
  const takeable = list.shifts.filter((s) => s.opensAt === null);
  const heldBack = list.shifts.filter((s) => s.opensAt !== null);
  const checksOf = (id: string) => list.explain?.checks.get(id) ?? [];
  const listed = takeable.map((s: OpenShift): ListedShift => ({
    shiftId: s.shiftId,
    role: s.role,
    eventName: s.eventName ?? null,
    siteName: s.site?.name ?? null,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    payRatePence: s.payRatePence ?? null,
    post: s.post ?? null,
    urgent: s.isUrgent,
    // Held, not applied for: "you hold CSAS" only for a valid one.
    holdsCsas: checksOf(s.shiftId).some(
      (c) =>
        c.code === "qualification" &&
        c.passed &&
        c.detail.type === "CSAS" &&
        c.detail.held === "valid",
    ),
    travel: s.travel,
  }));
  const booked = asked
    ? await run(firmId, (tx) => bookingsOn(tx, workerId, asked.dates, facts.timeZone, now))
    : [];
  const replyInput: ShiftsReplyInput = {
    firstName: facts.firstName,
    firm: input.firm,
    timeZone: facts.timeZone,
    asked,
    booked,
    shifts: listed,
    area: list.area,
    offerAlerts: list.offerAlerts,
    links: { take: `${input.portal}/shifts/open`, profile: `${input.portal}/profile/travel` },
  };
  const whatsapp = shiftsReplyText(replyInput, "whatsapp");
  const sms = shiftsReplyText(replyInput, "sms");
  const notOffered = [
    ...heldBack.map((s) => ({
      shiftId: s.shiftId,
      reasons: [{ code: "held", ...(s.opensAt ? { to: s.opensAt.toISOString() } : {}) }],
    })),
    ...(list.explain?.notOffered ?? []).map((n) => ({ shiftId: n.shiftId, reasons: n.reasons })),
  ];
  const shown = notOffered.slice(0, 50);
  const checksFor = (count: number): EnquiryChecks => ({
    template: listed.length > 0 ? "shifts_list" : "shifts_none",
    days: asked?.dates ?? [],
    area: list.area,
    offered: listed.slice(0, count).map((s) => ({
      shiftId: s.shiftId,
      ...minutesOf(s.travel),
      checks: checksOf(s.shiftId).map(loggedCheck),
    })),
    more: Math.max(0, listed.length - count),
    notOffered: shown,
    notOfferedMore: notOffered.length - shown.length + (list.explain?.notOfferedMore ?? 0),
    notChecked: list.explain?.notChecked ?? 0,
    bookings: [],
  });
  return {
    whatsapp: whatsapp.text,
    sms: sms.text,
    checks: { whatsapp: checksFor(whatsapp.listed), sms: checksFor(sms.listed) },
  };
}

// Her confirmed bookings on sessions still on (not cancelled) starting on these local dates.
async function bookingsOn(
  tx: FirmTx,
  workerId: string,
  dates: string[],
  timeZone: string,
  now: Date,
): Promise<BookedLine[]> {
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return [];
  const rows = await tx
    .select({
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      eventName: shiftEvents.name,
    })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .leftJoin(
      shiftEvents,
      and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
    )
    .where(
      and(
        eq(assignments.workerId, workerId),
        eq(assignments.status, "confirmed"),
        inArray(shifts.status, ["open", "filled"]),
        gt(shifts.endsAt, now),
        // From the first day's midnight to the last's end (local), then the days themselves.
        gte(shifts.startsAt, midnight(first, timeZone)),
        lt(shifts.startsAt, midnight(addDays(last, 1), timeZone)),
      ),
    )
    .orderBy(asc(shifts.startsAt));
  const wanted = new Set(dates);
  return rows.filter((r) => wanted.has(localDateOf(r.startsAt, timeZone)));
}

// The cancel reply: her next booking (not started), and whether cancelling it now is a strike.
export async function cancelReply(
  run: WithFirm,
  input: { firmId: string; workerId: string; now: Date; firm: FirmVoice; portal: string },
): Promise<PersonalReply> {
  const { workerId, now } = input;
  return run(input.firmId, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const timeZone = firm?.timezone ?? "Europe/London";
    const [me] = await tx
      .select({ firstName: workers.firstName })
      .from(workers)
      .where(eq(workers.id, workerId));
    const ahead = await tx
      .select({
        assignmentId: assignments.id,
        shiftId: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        post: shifts.post,
        eventName: shiftEvents.name,
        siteName: sites.name,
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .leftJoin(
        shiftEvents,
        and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
      )
      .where(
        and(
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
          gt(shifts.startsAt, now),
          inArray(shifts.status, ["open", "filled"]),
        ),
      )
      .orderBy(asc(shifts.startsAt), asc(shifts.id))
      // The next one, and whether there's another ("Your other shifts").
      .limit(2);
    const next = ahead[0];
    let strike: CancelReplyInput["strike"] = null;
    if (next) {
      const settings = await firmStrikeSettings(tx);
      const decision = await decideForWorker(tx, {
        assignmentId: next.assignmentId,
        shiftId: next.shiftId,
        noticeHours: noticeHours(next.startsAt, now),
        reason: null,
        settings,
      });
      if (decision.result === "strike") strike = { thresholdHours: settings.noticeHours };
    }
    const replyInput: CancelReplyInput = {
      firstName: me?.firstName ?? "",
      firm: input.firm,
      timeZone,
      next: next
        ? {
            role: next.role,
            eventName: next.eventName,
            siteName: next.siteName,
            startsAt: next.startsAt,
            endsAt: next.endsAt,
            post: next.post,
            link: `${input.portal}/shifts/${next.shiftId}`,
          }
        : null,
      strike,
      others: Math.max(0, ahead.length - 1),
      links: { booked: `${input.portal}/` },
    };
    const cancelChecks: EnquiryChecks = {
      template: next ? "cancel_booking" : "cancel_none",
      days: [],
      area: null,
      offered: [],
      more: 0,
      notOffered: [],
      notOfferedMore: 0,
      notChecked: 0,
      bookings: next ? [next.assignmentId] : [], // the one it named
    };
    return {
      whatsapp: cancelReplyText(replyInput, "whatsapp"),
      sms: cancelReplyText(replyInput, "sms"),
      checks: { whatsapp: cancelChecks, sms: cancelChecks },
    };
  });
}
