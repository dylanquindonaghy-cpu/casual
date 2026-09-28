import { normaliseMobile } from "../../auth/mobile";
import { WORKER_STATUSES } from "../../db/schema/people";
import { ROLE_PATTERN } from "../../db/schema/roster";
import { nextDay, zonedToUtc, type WallTime } from "../../time/zoned";
import { rosterShiftSchema, rosterStaffSchema, type RosterShift, type RosterStaff } from "../plug";
import type { SheetMapping } from "./mapping";

// A firm's sheet (rows of cell text, as the Sheets API returns them) turned into RosterStaff and
// RosterShift, through the same zod schemas every adapter uses at its boundary. A bad row is
// skipped and reported by tab, row number and a problem code. Never with its contents: they can
// hold names and phone numbers, and problems are stored and logged.
//
// Dates are the firm's local wall-clock dates (dd/mm/yyyy, yyyy-mm-dd or "Sat 7 Nov 2026") and
// times (09:00). A shift whose end is at or before its start ends the next day (a night shift).

export const SHEET_PROBLEM_CODES = [
  "missing_ref",
  "duplicate_ref",
  "missing_name",
  "bad_mobile",
  "duplicate_mobile",
  "bad_role",
  "bad_status",
  "bad_date",
  "bad_time",
  "bad_headcount",
  "text_too_long",
  "unknown_staff", // the assigned cell names a staff id the staff tab doesn't have
  "duplicate_holder", // the assigned cell names someone twice
  "over_headcount", // the assigned cell names more people than the shift needs
  "holder_not_in_sheet", // booked here by someone with no staff id: the shift's holders aren't synced
  "invalid_row",
] as const;
export type SheetProblemCode = (typeof SHEET_PROBLEM_CODES)[number];

export interface SheetProblem {
  tab: "staff" | "shifts";
  row: number; // the sheet's own row number (row 1 is the header)
  problem: SheetProblemCode;
}

// The sheet can't be read at all: a column the mapping names is missing, or appears twice.
export class SheetLayoutError extends Error {
  constructor(
    readonly code: "missing_column" | "duplicate_column",
    readonly tab: "staff" | "shifts",
  ) {
    super(`sheet layout: ${code} in the ${tab} tab`);
    this.name = "SheetLayoutError";
  }
}

export interface SheetStaff extends RosterStaff {
  row: number;
}

export interface SheetShift extends RosterShift {
  row: number;
  // false when the assigned cell couldn't be read (see the problem codes above): the sync then
  // leaves this shift's holders alone rather than guess.
  holdersReadable: boolean;
}

export interface ParsedSheet {
  staff: SheetStaff[];
  shifts: SheetShift[];
  // Where the sync writes back: the shifts tab's id and assigned columns (0-based).
  layout: { shiftsTab: string; refColumn: number; assignedColumn: number };
  problems: SheetProblem[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function columnsOf<W extends Record<string, string | undefined>>(
  headerRow: string[] | undefined,
  wanted: W,
  required: readonly (keyof W)[],
  tab: "staff" | "shifts",
): { [K in keyof W]-?: number | undefined } {
  const headers = (headerRow ?? []).map(norm);
  const found = {} as { [K in keyof W]-?: number | undefined };
  for (const key of Object.keys(wanted) as (keyof W)[]) {
    const name = wanted[key];
    if (name === undefined) continue;
    const hits = headers.flatMap((h, i) => (h === norm(name) ? [i] : []));
    if (hits.length > 1) throw new SheetLayoutError("duplicate_column", tab);
    if (hits.length === 0 && required.includes(key)) {
      throw new SheetLayoutError("missing_column", tab);
    }
    found[key] = hits[0];
  }
  return found;
}

const cellOf = (row: string[], column: number | undefined) =>
  column === undefined ? "" : String(row[column] ?? "").trim();
const isBlank = (row: string[]) => row.every((c) => String(c ?? "").trim() === "");
export const splitHolders = (cell: string) => listOf(cell);
const listOf = (cell: string) =>
  cell
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const rolePattern = new RegExp(ROLE_PATTERN);
export function normaliseRole(raw: string): string | null {
  const role = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return rolePattern.test(role) ? role : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseSheetDate(raw: string): Pick<WallTime, "year" | "month" | "day"> | null {
  const s = raw.trim();
  let year: number, month: number, day: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(s))) {
    const monthIndex = MONTHS.indexOf((m[2] ?? "").slice(0, 3).toLowerCase());
    if (monthIndex < 0) return null;
    [day, month, year] = [Number(m[1]), monthIndex + 1, Number(m[3])];
  } else {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  const real =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return real && year >= 2000 && year <= 2100 ? { year, month, day } : null;
}

export function parseSheetTime(raw: string): Pick<WallTime, "hour" | "minute"> | null {
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function parseSheet(
  input: { staffRows: string[][]; shiftRows: string[][] },
  mapping: SheetMapping,
  timeZone: string,
): ParsedSheet {
  const problems: SheetProblem[] = [];
  const staffCols = columnsOf(
    input.staffRows[0],
    mapping.staff.columns,
    ["ref", "firstName", "lastName", "mobile", "roles"],
    "staff",
  );
  const shiftCols = columnsOf(
    input.shiftRows[0],
    mapping.shifts.columns,
    ["ref", "date", "start", "end", "role", "assigned"],
    "shifts",
  );

  const staff: SheetStaff[] = [];
  const seenStaff = new Set<string>();
  const seenMobiles = new Set<string>();
  input.staffRows.slice(1).forEach((row, i) => {
    const rowNumber = i + 2;
    if (isBlank(row)) return;
    const flag = (problem: SheetProblemCode) =>
      problems.push({ tab: "staff", row: rowNumber, problem });
    const ref = cellOf(row, staffCols.ref);
    if (!ref) return flag("missing_ref");
    if (seenStaff.has(ref)) return flag("duplicate_ref");
    seenStaff.add(ref);
    const firstName = cellOf(row, staffCols.firstName);
    const lastName = cellOf(row, staffCols.lastName);
    if (!firstName || !lastName) return flag("missing_name");
    const mobile = normaliseMobile(cellOf(row, staffCols.mobile));
    if (!mobile) return flag("bad_mobile");
    if (seenMobiles.has(mobile)) return flag("duplicate_mobile");
    const roles = listOf(cellOf(row, staffCols.roles)).map(normaliseRole);
    if (roles.some((r) => r === null)) return flag("bad_role");
    const statusCell = cellOf(row, staffCols.status).toLowerCase();
    const status = statusCell === "" ? "active" : WORKER_STATUSES.find((s) => s === statusCell);
    if (!status) return flag("bad_status");
    const parsed = rosterStaffSchema.safeParse({
      ref,
      firstName,
      lastName,
      mobileE164: mobile,
      roles: [...new Set(roles as string[])],
      status,
    });
    if (!parsed.success) return flag("invalid_row");
    seenMobiles.add(mobile);
    staff.push({ ...parsed.data, row: rowNumber });
  });

  const shifts: SheetShift[] = [];
  const seenShifts = new Set<string>();
  input.shiftRows.slice(1).forEach((row, i) => {
    const rowNumber = i + 2;
    if (isBlank(row)) return;
    const flag = (problem: SheetProblemCode) =>
      problems.push({ tab: "shifts", row: rowNumber, problem });
    const ref = cellOf(row, shiftCols.ref);
    if (!ref) return flag("missing_ref");
    if (seenShifts.has(ref)) return flag("duplicate_ref");
    seenShifts.add(ref);
    const date = parseSheetDate(cellOf(row, shiftCols.date));
    if (!date) return flag("bad_date");
    const start = parseSheetTime(cellOf(row, shiftCols.start));
    const end = parseSheetTime(cellOf(row, shiftCols.end));
    if (!start || !end) return flag("bad_time");
    const startsAt = zonedToUtc({ ...date, ...start }, timeZone);
    let endsAt = zonedToUtc({ ...date, ...end }, timeZone);
    if (endsAt.getTime() <= startsAt.getTime()) {
      endsAt = zonedToUtc({ ...nextDay({ ...date, ...end }), ...end }, timeZone);
    }
    const role = normaliseRole(cellOf(row, shiftCols.role));
    if (!role) return flag("bad_role");
    const headcountCell = cellOf(row, shiftCols.headcount);
    const headcount = headcountCell === "" ? 1 : Number(headcountCell);
    if (
      !/^\d*$/.test(headcountCell) ||
      !Number.isInteger(headcount) ||
      headcount < 1 ||
      headcount > 1000
    ) {
      return flag("bad_headcount");
    }
    const statusCell = cellOf(row, shiftCols.status).toLowerCase();
    const fixedStatus =
      statusCell === "cancelled" || statusCell === "canceled"
        ? "cancelled"
        : statusCell === "draft"
          ? "draft"
          : ["", "open", "filled"].includes(statusCell)
            ? null
            : "bad";
    if (fixedStatus === "bad") return flag("bad_status");
    const site = cellOf(row, shiftCols.site);
    const instructions = cellOf(row, shiftCols.instructions);
    if (site.length > 200 || instructions.length > 2000) return flag("text_too_long");

    const holders = listOf(cellOf(row, shiftCols.assigned));
    let holdersReadable = true;
    if (holders.some((h) => !seenStaff.has(h))) {
      holdersReadable = false;
      flag("unknown_staff");
    } else if (new Set(holders).size !== holders.length) {
      holdersReadable = false;
      flag("duplicate_holder");
    } else if (holders.length > headcount) {
      holdersReadable = false;
      flag("over_headcount");
    }
    const assigned = holdersReadable
      ? holders.map((staffRef, n) => ({ slot: n + 1, staffRef }))
      : [];
    const parsed = rosterShiftSchema.safeParse({
      ref,
      siteName: site || null,
      role,
      startsAt,
      endsAt,
      headcount,
      status: fixedStatus ?? (assigned.length >= headcount ? "filled" : "open"),
      instructions: instructions || null,
      assigned,
    });
    if (!parsed.success) return flag("invalid_row");
    shifts.push({ ...parsed.data, row: rowNumber, holdersReadable });
  });

  return {
    staff,
    shifts,
    layout: {
      shiftsTab: mapping.shifts.tab,
      refColumn: shiftCols.ref ?? 0,
      assignedColumn: shiftCols.assigned ?? 0,
    },
    problems,
  };
}
