import { and, count, eq, isNotNull, isNull, max, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  firms,
  offers,
  shifts,
  sites,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace } from "../roster/book";
import { refreshShiftStatus } from "../roster/native";
import { normaliseRole, parseSheetDate, parseSheetTime } from "../roster/sheets/parse";
import { nextDay, zonedToUtc } from "../time/zoned";
import type { OfficeContext } from "./quick-actions";

// The office's shift editor (docs/screens.md `/office/shifts`): creating shifts one at a time or
// several for an event, and editing one. Active admins and resourcers only (checked inside the
// firm's transaction). Every line is checked at the boundary before anything is written.
//
// - createShifts: one date, one site (or none), shared instructions, and 1-12 lines of role,
//   start, finish and places. A finish at or before the start is the next day (a night shift).
//   Never in the past. If any line is wrong nothing is saved, and each problem names its line.
//   Native shifts, open at once, each logged shift.created {by: "firm"}.
// - editShift: with nobody booked, anything. With people booked, only the places and the
//   instructions: new times, role or site are a firm-initiated move (notice per worker, golden
//   rule 12: the office's move/cancel flow), and places can't drop below a booked place. Never a
//   shift that has started or was cancelled, nor a Google Sheet's (the next sync would undo it).
//   Logged shift.changed {by: "firm", fields, from/to times}. The status follows the places when
//   they changed (a shift the office marked as filled stays closed). Moving a shift nobody is
//   booked on expires the offers still out (they describe the old shift).

export const MAX_EVENT_LINES = 12;
const MAX_INSTRUCTIONS = 2000;
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
  "bad_form", // the form itself didn't make sense (too many lines, or far too much text)
] as const;
export type ShiftProblem = (typeof SHIFT_PROBLEMS)[number];

const lineSchema = z.strictObject({
  role: z.string().max(100),
  start: z.string().max(10),
  end: z.string().max(10),
  headcount: z.string().max(10),
});

export const createShiftsSchema = z.strictObject({
  date: z.string().max(20),
  siteId: z.string().max(100), // "" for no site
  instructions: z.string().max(10_000),
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
}

// A line left empty: no role, start or finish (the places box starts at 1, so it doesn't count).
const blankLine = (l: z.output<typeof lineSchema>) =>
  !l.role.trim() && !l.start.trim() && !l.end.trim();

// The start and finish on the date, in the firm's time zone; a finish at or before the start is
// the next day.
function timesOn(
  date: { year: number; month: number; day: number },
  start: string,
  end: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } | null {
  const s = parseSheetTime(start);
  const e = parseSheetTime(end);
  if (!s || !e) return null;
  const startsAt = zonedToUtc({ ...date, ...s }, timeZone);
  let endsAt = zonedToUtc({ ...date, ...e }, timeZone);
  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt = zonedToUtc({ ...nextDay({ ...date, ...e }), ...e }, timeZone);
  }
  return { startsAt, endsAt };
}

const isoDate = (raw: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? parseSheetDate(raw.trim()) : null;

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
    const lines = input.lines.map((l, i) => ({ l, line: i + 1 })).filter(({ l }) => !blankLine(l));
    if (lines.length === 0) problems.push({ line: null, problem: "no_lines" });
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
      if (times) checked.push({ role, headcount, ...times });
    }
    if (problems.length > 0) return { status: "invalid", problems };

    const shiftIds: string[] = [];
    for (const c of checked) {
      const [added] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
          siteId,
          role: c.role,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          headcount: c.headcount,
          instructions,
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
    if (fields.includes("headcount") && !closedByOffice) await refreshShiftStatus(tx, shiftId);
    // Moved with nobody booked: offers still out describe the old shift, so they've expired.
    if (moved) {
      await tx
        .update(offers)
        .set({ response: "expired", respondedAt: now })
        .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)));
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
