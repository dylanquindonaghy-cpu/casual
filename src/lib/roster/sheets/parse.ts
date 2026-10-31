import { spreadsheetMobile } from "../../auth/mobile";
import { WORKER_STATUSES } from "../../db/schema/people";
import { SHEET_NAME_MAX } from "../../db/schema/roster";
import { NO_NAMES, normaliseRole, readRoleName, readRoleNames, type NameMap } from "../names";
import type { WallTime } from "../../time/zoned";
import { shiftWindow } from "../shift-window";
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
  // A new Staff ID whose mobile belongs to a worker here with another name: not linked or renamed
  // (src/lib/roster/workers.ts).
  "name_mismatch",
  // A Staff ID whose name and mobile both changed at once: not given the old record.
  "identity_change",
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
  "change_refused", // a booked shift's role, times or site changed, and someone booked can't work it
  "started_change", // a shift that has started was re-timed, re-roled, moved or cancelled: ignored
  // P3.2: a row whose role the firm's name map skips, though a session to come that it made is
  // still on here: that session is left as it is (cancel or change it in the office).
  "skipped_live",
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
  // Shift rows whose role the firm's name map skips (P3.2): not sessions, so not brought in. `name`:
  // the role cell as the sheet spells it (sheetRoleText), for Needs attention (Phase 25.2); null
  // when it can't be shown.
  skipped: { row: number; ref: string; name: string | null }[];
  // The role names a bad_role row couldn't read (Phase 25.2), for Needs attention: a role cell's
  // text only, the one exception to "never a cell's contents" (sheetRoleText), and only when it
  // has some. A staff row's first unreadable role in its list.
  unreadable: { tab: "staff" | "shifts"; row: number; name: string }[];
}

// A role cell's text as Needs attention shows it (sheet_name_problems.outside_name): no control or
// format characters, spaces run together, at most SHEET_NAME_MAX characters; null when nothing is
// left. Only the role columns are read with it. A role cell can still hold anything typed into it,
// so text with an email address or a phone number's digits (7 or more) in it is never kept: a role
// name has neither ("12D", "Door Supervisor (NLW)").
export function sheetRoleText(raw: string): string | null {
  const text = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "" || text.includes("@") || (text.match(/\d/g) ?? []).length >= 7) return null;
  return Array.from(text).slice(0, SHEET_NAME_MAX).join("").trim();
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

export { normaliseRole };

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// A month or weekday as people write it: in full, its first three letters, or a usual short form
// ("Sept", "Tues", "Weds", "Thur", "Thurs").
const SHORT_FORMS: Record<string, string> = {
  sept: "september",
  tues: "tuesday",
  weds: "wednesday",
  thur: "thursday",
  thurs: "thursday",
};
const nameIndex = (names: string[], word: string) => {
  const w = word.toLowerCase();
  return names.findIndex((n) => n === w || n.slice(0, 3) === w || SHORT_FORMS[w] === n);
};

// A date as a spreadsheet cell holds it, the one reader for the Sheets sync and every import
// column (shift dates, licence expiry dates, pay periods): day first, as in the UK (07/11/2026,
// 7/11/2026), yyyy-mm-dd, or "7 Nov 2026" / "Sat 7 November 2026". A time after it (Excel's date
// and time cells, "07/11/2026 00:00") is allowed and ignored. A weekday, if given, must be that
// date's; a month name must be a real one, not any three letters ("Junk" isn't June) (audit L70).
export function parseSheetDate(raw: string): Pick<WallTime, "year" | "month" | "day"> | null {
  let s = raw.trim();
  // A time after the date: 00:00, 9:00:00, 00:00:00.000, 12:00 AM, or an ISO time ending Z.
  const timed =
    /^(.*\S)[\sT]+(\d{1,2})[:.](\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap]\.?m\.?)?Z?$/i.exec(s);
  if (timed) {
    const hour = Number(timed[2]);
    if (hour > (timed[5] ? 12 : 23) || Number(timed[3]) > 59 || Number(timed[4] ?? 0) > 59) {
      return null;
    }
    s = timed[1] ?? "";
  }
  let weekday: number | null = null;
  const named = /^([A-Za-z]{3,9}),?\s+(.+)$/.exec(s);
  if (named) {
    weekday = nameIndex(WEEKDAYS, named[1] ?? "");
    if (weekday < 0) return null;
    s = named[2] ?? "";
  }
  let year: number, month: number, day: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/.exec(s))) {
    const monthIndex = nameIndex(MONTHS, m[2] ?? "");
    if (monthIndex < 0) return null;
    [day, month, year] = [Number(m[1]), monthIndex + 1, Number(m[3])];
  } else {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  const real =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  if (!real || year < 2000 || year > 2100) return null;
  if (weekday !== null && d.getUTCDay() !== weekday) return null;
  return { year, month, day };
}

export function parseSheetTime(raw: string): Pick<WallTime, "hour" | "minute"> | null {
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

// `names`: the firm's name map (P3.2, src/lib/roster/names.ts): a role it maps is read as its code,
// one it skips is left off a worker's roles, and a shift row with one isn't brought in (not a
// problem: the firm said it isn't a session). Others are read as before.
export function parseSheet(
  input: { staffRows: string[][]; shiftRows: string[][] },
  mapping: SheetMapping,
  timeZone: string,
  names: NameMap = NO_NAMES,
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

  const unreadable: ParsedSheet["unreadable"] = [];
  const unreadableRole = (tab: "staff" | "shifts", row: number, raw: string | undefined) => {
    const name = raw === undefined ? null : sheetRoleText(raw);
    if (name) unreadable.push({ tab, row, name });
  };
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
    const mobile = spreadsheetMobile(cellOf(row, staffCols.mobile));
    if (!mobile) return flag("bad_mobile");
    if (seenMobiles.has(mobile)) return flag("duplicate_mobile");
    const roleNames = listOf(cellOf(row, staffCols.roles));
    const roles = readRoleNames(roleNames, names);
    if (roles === null) {
      unreadableRole(
        "staff",
        rowNumber,
        roleNames.find((raw) => readRoleName(raw, names) === null),
      );
      return flag("bad_role");
    }
    const statusCell = cellOf(row, staffCols.status).toLowerCase();
    const status = statusCell === "" ? "active" : WORKER_STATUSES.find((s) => s === statusCell);
    if (!status) return flag("bad_status");
    const parsed = rosterStaffSchema.safeParse({
      ref,
      firstName,
      lastName,
      mobileE164: mobile,
      roles,
      status,
    });
    if (!parsed.success) return flag("invalid_row");
    seenMobiles.add(mobile);
    staff.push({ ...parsed.data, row: rowNumber });
  });

  const shifts: SheetShift[] = [];
  const skipped: ParsedSheet["skipped"] = [];
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
    const roleCell = cellOf(row, shiftCols.role);
    const roleName = readRoleName(roleCell, names);
    // A role the firm's name map skips: not a session, whatever else the row says.
    if (roleName && "skip" in roleName) {
      return void skipped.push({ row: rowNumber, ref, name: sheetRoleText(roleCell) });
    }
    const date = parseSheetDate(cellOf(row, shiftCols.date));
    if (!date) return flag("bad_date");
    const start = parseSheetTime(cellOf(row, shiftCols.start));
    const end = parseSheetTime(cellOf(row, shiftCols.end));
    if (!start || !end) return flag("bad_time");
    const window = shiftWindow(date, start, end, timeZone);
    if (!window) return flag("bad_time");
    const { startsAt, endsAt } = window;
    if (!roleName) {
      unreadableRole("shifts", rowNumber, roleCell);
      return flag("bad_role");
    }
    const { role } = roleName;
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
    skipped,
    unreadable,
  };
}
