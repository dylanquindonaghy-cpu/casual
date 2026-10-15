import { and, count, eq, isNotNull, isNull, max, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  credentialTypes,
  firms,
  offers,
  shifts,
  sites,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { importPence } from "../imports/import";
import { officeCanPlace } from "../roster/book";
import { refreshShiftStatus } from "../roster/native";
import { normaliseRole } from "../roster/sheets/parse";
import { automaticEventId, createNamedEvent, EVENT_NAME_MAX } from "../roster/shift-events";
import { isoDate, timesOn } from "../roster/shift-times";
import type { OfficeContext } from "./quick-actions";
import { queueTravelEstimates } from "../travel/estimate-queue";

// The office's shift editor (docs/screens.md `/office/shifts`): creating shifts one at a time or
// several for an event, and editing one. Active admins and resourcers only (checked inside the
// firm's transaction). Every line is checked at the boundary before anything is written.
//
// - createShifts: one date, one site (or none), shared instructions, meeting point and uniform,
//   and 1-12 lines of role, start, finish, places, pay rate, post and extra requirements. A finish
//   before the start is the next day (a night shift); one equal to it, 24 hours or more, or a time
//   the clocks skip is refused (src/lib/roster/shift-window.ts). Never in the past. If any line is
//   wrong nothing is saved, and each problem names its line. Native shifts, open at once, each
//   logged shift.created {by: "firm"}. With an event name ("Shifts for an event") they make a new
//   event of that name; without ("New shift") they join their site and day's automatic event.
// - editShiftDetails: the session's own details (pay rate, post, meeting point, uniform, extra
//   requirements; docs/office-v2.md S2) on any shift, from a sheet or a file too: the sync and the
//   import never write them. Not a session from the firm's planner, whose PUTs send them
//   (docs/office-v2.md 5.3.2: the office can't edit an API session at all). Requirements can't
//   change once someone is booked (they were checked against the old list); the rest can. Logged
//   shift.changed {by: "firm", fields}, the fields named as in DETAIL_FIELDS: "requirements",
//   never a name holding "credential", which the log masker would hide (docs/office-v2.md 6.1).
// - editShift: with nobody booked, anything. With people booked, only the places and the
//   instructions: new times, role or site are a firm-initiated move (notice per worker, golden
//   rule 12: the office's move/cancel flow), and places can't drop below a booked place. Never a
//   shift that has started or was cancelled, nor a Google Sheet's or the firm's planner's (the
//   next sync or PUT would undo it).
//   Logged shift.changed {by: "firm", fields, from/to times}. The status follows the places when
//   they changed (a shift the office marked as filled stays closed). Moving a shift nobody is
//   booked on expires the offers still out (they describe the old shift).

export const MAX_EVENT_LINES = 12;
const MAX_INSTRUCTIONS = 2000;
const MAX_POST = 200;
const MAX_PLACE_TEXT = 300; // meeting point, uniform
export const MAX_REQUIREMENTS = 20;
const CANCELLED = [...CANCELLED_ASSIGNMENT_STATUSES];

export const SHIFT_PROBLEMS = [
  "bad_date",
  "bad_time",
  "bad_role",
  "bad_headcount",
  "bad_site",
  "in_past",
  "text_too_long",
  "no_lines",
  "bad_event_name",
  "bad_pay",
  "post_too_long",
  "details_too_long", // meeting point or uniform
  "unknown_requirement",
  "too_many_requirements",
  "bad_form", // the form itself didn't make sense (too many lines, or far too much text)
] as const;
export type ShiftProblem = (typeof SHIFT_PROBLEMS)[number];

const requirementsSchema = z.array(z.string().max(50)).max(50);

const lineSchema = z.strictObject({
  role: z.string().max(100),
  start: z.string().max(10),
  end: z.string().max(10),
  headcount: z.string().max(10),
  payRate: z.string().max(20).optional(), // pounds an hour, "" for none
  post: z.string().max(1000).optional(),
  requirements: requirementsSchema.optional(), // qualification codes
});

export const createShiftsSchema = z.strictObject({
  date: z.string().max(20),
  siteId: z.string().max(100), // "" for no site
  instructions: z.string().max(10_000),
  // "Shifts for an event" sends one (required there); "New shift" doesn't.
  eventName: z.string().max(1000).optional(),
  meetingPoint: z.string().max(2000).optional(),
  uniform: z.string().max(2000).optional(),
  lines: z.array(lineSchema).max(MAX_EVENT_LINES),
});
export type CreateShiftsInput = z.input<typeof createShiftsSchema>;

export type CreateShiftsResult =
  | { status: "created"; shiftIds: string[] }
  | { status: "invalid"; problems: { line: number | null; problem: ShiftProblem }[] }
  | { status: "not_allowed" };

interface CheckedLine {
  role: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  payRatePence: number | null;
  post: string | null;
  requiredCredentials: string[];
}

// Optional text: trimmed, "" for none, refused over `max` characters.
const optionalText = (raw: string | undefined, max: number): string | null | false => {
  const text = (raw ?? "").trim();
  if (!text) return null;
  return [...text].length <= max ? text : false;
};

// Pay in pounds an hour as typed ("12.50", "£12.50"), in whole pence; "" for none. "12 50" and
// "12,50" are refused, never read as £1,250 (importPence, audit M16), and so is anything over
// £1,000 an hour (a rate typed in pence, "1250", would otherwise show casuals £1,250 an hour).
export const MAX_PAY_RATE_PENCE = 100_000;
const payRateOf = (raw: string | undefined): number | null | false => {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const pence = importPence(text);
  return pence !== null && pence <= MAX_PAY_RATE_PENCE ? pence : false;
};

// The firm's own qualification types: a requirement must be one of them.
async function knownCodes(tx: FirmTx): Promise<Set<string>> {
  const rows = await tx.select({ code: credentialTypes.code }).from(credentialTypes);
  return new Set(rows.map((r) => r.code));
}

// Each code once, in order, so a different order isn't a change. Every one must be the firm's,
// or already on the session (a type the firm later removed never blocks saving the rest).
const requirementsOf = (
  raw: string[] | undefined,
  known: Set<string>,
  kept: readonly string[] = [],
): string[] | "unknown_requirement" | "too_many_requirements" => {
  const codes = [...new Set((raw ?? []).map((c) => c.trim()).filter(Boolean))].sort();
  if (!codes.every((c) => known.has(c) || kept.includes(c))) return "unknown_requirement";
  return codes.length <= MAX_REQUIREMENTS ? codes : "too_many_requirements";
};

// A line left empty: no role, start or finish (the places box starts at 1, so it doesn't count).
const blankLine = (l: z.output<typeof lineSchema>) =>
  !l.role.trim() && !l.start.trim() && !l.end.trim();

const headcountOf = (raw: string) => {
  const n = Number(raw.trim());
  return /^\d{1,4}$/.test(raw.trim()) && n >= 1 && n <= 1000 ? n : null;
};

async function firmZone(tx: FirmTx): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

async function siteExists(tx: FirmTx, siteId: string): Promise<boolean> {
  if (!z.uuid().safeParse(siteId).success) return false;
  const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId));
  return site !== undefined;
}

export async function createShifts(
  ctx: OfficeContext,
  raw: CreateShiftsInput,
): Promise<CreateShiftsResult> {
  const input = createShiftsSchema.parse(raw);
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" };
    const timeZone = await firmZone(tx);
    const problems: { line: number | null; problem: ShiftProblem }[] = [];
    const date = isoDate(input.date);
    if (!date) problems.push({ line: null, problem: "bad_date" });
    const siteId = input.siteId.trim() || null;
    if (siteId && !(await siteExists(tx, siteId)))
      problems.push({ line: null, problem: "bad_site" });
    const instructions = input.instructions.trim() || null;
    if (instructions && instructions.length > MAX_INSTRUCTIONS) {
      problems.push({ line: null, problem: "text_too_long" });
    }
    const eventName = input.eventName === undefined ? undefined : input.eventName.trim();
    if (eventName !== undefined && (!eventName || [...eventName].length > EVENT_NAME_MAX)) {
      problems.push({ line: null, problem: "bad_event_name" });
    }
    const meetingPoint = optionalText(input.meetingPoint, MAX_PLACE_TEXT);
    const uniform = optionalText(input.uniform, MAX_PLACE_TEXT);
    if (meetingPoint === false || uniform === false) {
      problems.push({ line: null, problem: "details_too_long" });
    }
    const lines = input.lines.map((l, i) => ({ l, line: i + 1 })).filter(({ l }) => !blankLine(l));
    if (lines.length === 0) problems.push({ line: null, problem: "no_lines" });
    const known = lines.some(({ l }) => (l.requirements ?? []).length > 0)
      ? await knownCodes(tx)
      : new Set<string>();
    const checked: CheckedLine[] = [];
    for (const { l, line } of lines) {
      const role = normaliseRole(l.role);
      if (!role) {
        problems.push({ line, problem: "bad_role" });
        continue;
      }
      const headcount = headcountOf(l.headcount === "" ? "1" : l.headcount);
      if (!headcount) {
        problems.push({ line, problem: "bad_headcount" });
        continue;
      }
      const times = date ? timesOn(date, l.start, l.end, timeZone) : null;
      if (date && !times) {
        problems.push({ line, problem: "bad_time" });
        continue;
      }
      if (times && times.startsAt.getTime() <= now.getTime()) {
        problems.push({ line, problem: "in_past" });
        continue;
      }
      const payRatePence = payRateOf(l.payRate);
      if (payRatePence === false) {
        problems.push({ line, problem: "bad_pay" });
        continue;
      }
      const post = optionalText(l.post, MAX_POST);
      if (post === false) {
        problems.push({ line, problem: "post_too_long" });
        continue;
      }
      const requiredCredentials = requirementsOf(l.requirements, known);
      if (typeof requiredCredentials === "string") {
        problems.push({ line, problem: requiredCredentials });
        continue;
      }
      if (times)
        checked.push({ role, headcount, payRatePence, post, requiredCredentials, ...times });
    }
    if (problems.length > 0 || meetingPoint === false || uniform === false) {
      return { status: "invalid", problems };
    }

    // "Shifts for an event" makes its event; "New shift" joins its site and day's automatic one.
    const named = eventName ? await createNamedEvent(tx, { name: eventName, siteId }) : null;
    const shiftIds: string[] = [];
    for (const c of checked) {
      const [added] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
          shiftEventId:
            named ??
            (await automaticEventId(tx, {
              siteId,
              startsAt: c.startsAt,
              source: "native",
              timeZone,
            })),
          siteId,
          role: c.role,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          headcount: c.headcount,
          instructions,
          payRatePence: c.payRatePence,
          post: c.post,
          meetingPoint,
          uniform,
          requiredCredentials: c.requiredCredentials,
          status: "open",
          source: "native",
        })
        .returning({ id: shifts.id });
      if (!added) throw new Error("shift insert returned nothing");
      shiftIds.push(added.id);
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "shift.created",
        entityType: "shift",
        entityId: added.id,
        data: { by: "firm" },
      });
    }
    // Their travel estimates (12G.2), worked out by the worker.
    await queueTravelEstimates(tx, shiftIds);
    return { status: "created", shiftIds };
  });
}

export const editShiftSchema = z.strictObject({
  date: z.string().max(20),
  start: z.string().max(10),
  end: z.string().max(10),
  role: z.string().max(100),
  siteId: z.string().max(100),
  headcount: z.string().max(10),
  instructions: z.string().max(10_000),
});
export type EditShiftInput = z.input<typeof editShiftSchema>;

export type EditShiftResult =
  | { status: "saved"; fields: string[] }
  | { status: "unchanged" }
  | { status: "invalid"; problems: ShiftProblem[] }
  | { status: "has_bookings" } // times, role or site with people booked: move it instead
  | { status: "below_bookings" } // fewer places than a booked place needs
  | { status: "not_open" } // started or cancelled
  | { status: "sheet" }
  | { status: "planner" } // a session from the firm's planner: changed there
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function editShift(
  ctx: OfficeContext,
  shiftId: string,
  raw: EditShiftInput,
): Promise<EditShiftResult> {
  const input = editShiftSchema.parse(raw);
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" };
    const [shift] = await tx
      .select({
        siteId: shifts.siteId,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        instructions: shifts.instructions,
        status: shifts.status,
        source: shifts.source,
      })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .for("no key update");
    if (!shift) return { status: "not_found" };
    if (shift.source === "sheets") return { status: "sheet" };
    if (shift.source === "api") return { status: "planner" };
    if (shift.status === "cancelled" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    const timeZone = await firmZone(tx);
    const problems: ShiftProblem[] = [];
    const date = isoDate(input.date);
    if (!date) problems.push("bad_date");
    const times = date ? timesOn(date, input.start, input.end, timeZone) : null;
    if (date && !times) problems.push("bad_time");
    if (times && times.startsAt.getTime() <= now.getTime()) problems.push("in_past");
    const role = normaliseRole(input.role);
    if (!role) problems.push("bad_role");
    const headcount = headcountOf(input.headcount);
    if (!headcount) problems.push("bad_headcount");
    const siteId = input.siteId.trim() || null;
    if (siteId && siteId !== shift.siteId && !(await siteExists(tx, siteId))) {
      problems.push("bad_site");
    }
    const instructions = input.instructions.trim() || null;
    if (instructions && instructions.length > MAX_INSTRUCTIONS) problems.push("text_too_long");
    if (problems.length > 0 || !times || !role || !headcount) {
      return { status: "invalid", problems };
    }

    const next = { siteId, role, headcount, instructions, ...times };
    const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => {
      const a = shift[k];
      const b = next[k];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    });
    if (fields.length === 0) return { status: "unchanged" };

    const [held] = await tx
      .select({ n: count(), top: max(assignments.slot) })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          isNotNull(assignments.workerId),
          notInArray(assignments.status, CANCELLED),
        ),
      );
    const booked = held?.n ?? 0;
    const moved = fields.some((f) => ["startsAt", "endsAt", "role", "siteId"].includes(f));
    if (booked > 0 && moved) return { status: "has_bookings" };
    if (booked > 0 && headcount < (held?.top ?? 0)) return { status: "below_bookings" };

    await tx.update(shifts).set(next).where(eq(shifts.id, shiftId));
    // The status follows the places only when the places changed, and never for a shift the office
    // marked as filled with places still free (close.ts): that stays closed until "Open it again".
    const closedByOffice = shift.status === "filled" && booked < shift.headcount;
    if (fields.includes("headcount") && !closedByOffice) await refreshShiftStatus(tx, shiftId, now);
    // Moved with nobody booked: offers still out describe the old shift, so they've expired, and
    // its travel estimates are worked out again (12G.2).
    if (moved) {
      await tx
        .update(offers)
        .set({ response: "expired", respondedAt: now })
        .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)));
      await queueTravelEstimates(tx, [shiftId]);
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: {
        by: "firm",
        fields,
        // Old and new times when they changed (ISO times hold nothing personal).
        ...(fields.includes("startsAt") || fields.includes("endsAt")
          ? {
              from: { startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString() },
              to: { startsAt: times.startsAt.toISOString(), endsAt: times.endsAt.toISOString() },
            }
          : {}),
      },
    });
    return { status: "saved", fields };
  });
}

export const editDetailsSchema = z.strictObject({
  payRate: z.string().max(20), // pounds an hour, "" for none
  post: z.string().max(1000),
  meetingPoint: z.string().max(2000),
  uniform: z.string().max(2000),
  requirements: requirementsSchema, // qualification codes
});
export type EditDetailsInput = z.input<typeof editDetailsSchema>;

// The names shift.changed gives each detail (docs/office-v2.md 6.1): never "credential".
export const DETAIL_FIELDS = {
  payRatePence: "payRatePence",
  post: "post",
  meetingPoint: "meetingPoint",
  uniform: "uniform",
  requiredCredentials: "requirements",
} as const;
export type DetailField = (typeof DETAIL_FIELDS)[keyof typeof DETAIL_FIELDS];

export type EditDetailsResult =
  | { status: "saved"; fields: DetailField[] }
  | { status: "unchanged" }
  | { status: "invalid"; problems: ShiftProblem[] }
  | { status: "has_bookings" } // requirements with people booked
  | { status: "not_open" } // started or cancelled
  | { status: "planner" } // a session from the firm's planner: changed there
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function editShiftDetails(
  ctx: OfficeContext,
  shiftId: string,
  raw: EditDetailsInput,
): Promise<EditDetailsResult> {
  const input = editDetailsSchema.parse(raw);
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" };
    const [shift] = await tx
      .select({
        source: shifts.source,
        startsAt: shifts.startsAt,
        status: shifts.status,
        payRatePence: shifts.payRatePence,
        post: shifts.post,
        meetingPoint: shifts.meetingPoint,
        uniform: shifts.uniform,
        requiredCredentials: shifts.requiredCredentials,
      })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .for("no key update");
    if (!shift) return { status: "not_found" };
    if (shift.source === "api") return { status: "planner" };
    if (shift.status === "cancelled" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    const problems: ShiftProblem[] = [];
    const payRatePence = payRateOf(input.payRate);
    if (payRatePence === false) problems.push("bad_pay");
    const post = optionalText(input.post, MAX_POST);
    if (post === false) problems.push("post_too_long");
    const meetingPoint = optionalText(input.meetingPoint, MAX_PLACE_TEXT);
    const uniform = optionalText(input.uniform, MAX_PLACE_TEXT);
    if (meetingPoint === false || uniform === false) problems.push("details_too_long");
    const requiredCredentials = requirementsOf(
      input.requirements,
      await knownCodes(tx),
      shift.requiredCredentials,
    );
    if (typeof requiredCredentials === "string") problems.push(requiredCredentials);
    if (
      problems.length > 0 ||
      payRatePence === false ||
      post === false ||
      meetingPoint === false ||
      uniform === false ||
      typeof requiredCredentials === "string"
    ) {
      return { status: "invalid", problems };
    }

    const next = { payRatePence, post, meetingPoint, uniform, requiredCredentials };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) =>
      k === "requiredCredentials"
        ? next[k].join(",") !== [...shift[k]].sort().join(",")
        : next[k] !== shift[k],
    );
    if (changed.length === 0) return { status: "unchanged" };

    if (changed.includes("requiredCredentials")) {
      const [held] = await tx
        .select({ n: count() })
        .from(assignments)
        .where(
          and(
            eq(assignments.shiftId, shiftId),
            isNotNull(assignments.workerId),
            notInArray(assignments.status, CANCELLED),
          ),
        );
      if ((held?.n ?? 0) > 0) return { status: "has_bookings" };
    }

    await tx.update(shifts).set(next).where(eq(shifts.id, shiftId));
    const fields = changed.map((k) => DETAIL_FIELDS[k]);
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields },
    });
    return { status: "saved", fields };
  });
}
