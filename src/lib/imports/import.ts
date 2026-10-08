import { createHash } from "node:crypto";
import { and, count, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { spreadsheetMobile } from "../auth/mobile";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  credentials,
  payRecords,
  shifts,
  sites,
  workers,
  WORKER_STATUSES,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { refreshShiftStatus } from "../roster/native";
import { automaticEventId } from "../roster/shift-events";
import { normaliseRole, parseSheetDate, parseSheetTime } from "../roster/sheets/parse";
import {
  sameName,
  upsertWorker,
  WorkerIdentityChange,
  WorkerNameMismatch,
} from "../roster/workers";
import { shiftWindow } from "../roster/shift-window";
import { wallTimeOf } from "../time/zoned";
import { resolveColumns, type ColumnsOf, type ImportKind } from "./columns";
import { appDatabaseIsLocal } from "../db/where";
import { requireAgreementForImport } from "./gate-b";

// Imports a list of workers, credentials or shifts (rows from readTable) into the caller's firm,
// inside the caller's withFirm transaction (docs/architecture.md, Roster plugs: CSV/Excel).
//
// Every row is checked at the boundary before it touches the database; a bad row is skipped and
// reported by its row number (as the office sees it in the spreadsheet) and a code, never its
// contents. Good rows create or update, each change logged with the office user who ran the
// import (golden rule 5). A dry run does exactly the same work inside a savepoint and rolls it
// back, so the preview the office sees can never differ from the real import.
//
// - Workers: by Staff ID when the file has one, else by mobile (src/lib/roster/workers.ts).
//   A column the file doesn't have, or a blank email or status, leaves that field as it is.
// - Credentials: the worker by Staff ID or mobile, then the worker's credential of that type is
//   updated or created. On an update, a blank or missing number, expiry or status leaves it as
//   it is (a re-import never resets a suspended credential or wipes an expiry); an expired one
//   given a new future expiry with no status is a renewal and becomes valid (rules doc). A change
//   clears its verification. New credentials are valid unless the file says otherwise.
// - Shifts: by the file's Shift ID, or by a key made from site, role and times when there is none,
//   so importing the same file twice updates rather than duplicates. A shift with live bookings
//   keeps its times, role and site, and its headcount can't go down: that is a firm-initiated change,
//   logged per worker with notice (golden rule 12), and belongs to the office's shift editor.
//   Shifts that have started are history: never created or changed by an import.
// - Pay: the worker by Staff ID or mobile; one line per worker, pay period and rate (a re-import
//   updates its hours, gross and pay date). The figures are the payroll's, stored as given (money
//   in pence). The log records what changed, never the amounts.

export const IMPORT_PROBLEM_CODES = [
  "missing_value",
  "bad_mobile",
  "bad_email",
  "bad_role",
  "bad_status",
  "bad_date",
  "bad_time",
  "bad_headcount",
  "bad_type",
  "text_too_long",
  "unknown_worker",
  "duplicate_row", // the same worker, credential or shift twice in one file
  "duplicate_mobile", // the mobile belongs to another worker already
  "name_mismatch", // no Staff ID, and the mobile belongs to a worker with another name
  "name_needed", // credentials or pay: no Staff ID, and no name to check the mobile's worker against
  "identity_change", // a Staff ID whose name and mobile both changed at once (reused for a new person)
  "shift_has_bookings",
  "shift_started",
  "bad_hours", // pay: hours that aren't a number from 0 to 1000 with at most 2 decimals
  "bad_money", // pay: a rate or gross that isn't an amount of money
  "bad_period", // pay: the period ends before it starts
] as const;
export type ImportProblemCode = (typeof IMPORT_PROBLEM_CODES)[number];

export interface ImportProblem {
  row: number;
  problem: ImportProblemCode;
}

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  problems: ImportProblem[];
}

export interface ImportOptions {
  kind: ImportKind;
  rows: string[][]; // readTable's output: rows[0] is the header
  dryRun: boolean;
  actorId: string; // the office user running the import
  timeZone: string; // the firm's, for dates and times in the file
  now: Date;
  // Set by `npm run import`: its --as isn't a login, so its events say so.
  via?: "cli";
  // Is the database on this machine? A live one saves rows only for a firm whose agreement is
  // recorded (Gate B, gate-b.ts). Unset: from DATABASE_URL; tests pass false to try a live one.
  localDatabase?: boolean;
}

type RowOutcome = "created" | "updated" | "unchanged" | ImportProblemCode;

class Problem extends Error {
  constructor(readonly code: ImportProblemCode) {
    super(code);
  }
}
class DryRun extends Error {
  constructor(readonly result: ImportResult) {
    super("dry run");
  }
}

const cellOf = (row: string[], column: number | undefined) =>
  column === undefined ? "" : String(row[column] ?? "").trim();
const isBlank = (row: string[]) => row.every((c) => String(c ?? "").trim() === "");
const tooLong = (value: string, max: number) => {
  if (value.length > max) throw new Problem("text_too_long");
  return value;
};

// Excel drops the leading 0 of a mobile typed as a number (7700900123): the same reader as the
// Sheets sync's (src/lib/auth/mobile.ts).
export const importMobile = spreadsheetMobile;

const email = z.email().max(254);

// The worker a credentials or pay row is for: by Staff ID, or by mobile and name together. A row
// found by mobile alone must name the worker (First name and Last name, or Name), and the name must
// be theirs: a mistyped or reused number never gives one person's licence or pay to another (audit
// L71, L78). Checked after the mobile is found, so an unknown number still says so.
async function workerForRow(
  tx: FirmTx,
  row: string[],
  c: {
    ref: number | undefined;
    mobile: number | undefined;
    firstName: number | undefined;
    lastName: number | undefined;
    name: number | undefined;
  },
): Promise<string> {
  const ref = cellOf(row, c.ref);
  const mobileCell = cellOf(row, c.mobile);
  if (!ref && !mobileCell) throw new Problem("missing_value");
  const mobile = ref ? null : importMobile(mobileCell);
  if (!ref && !mobile) throw new Problem("bad_mobile");
  const [worker] = await tx
    .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
    .from(workers)
    .where(ref ? eq(workers.externalRef, ref) : eq(workers.mobileE164, mobile ?? ""));
  if (!worker) throw new Problem("unknown_worker");
  if (ref) return worker.id;
  const first = cellOf(row, c.firstName);
  const last = cellOf(row, c.lastName);
  const full = cellOf(row, c.name);
  if (first || last) {
    if (!sameName(first, worker.first) || !sameName(last, worker.last)) {
      throw new Problem("name_mismatch");
    }
  } else if (full) {
    if (!sameName(full, `${worker.first} ${worker.last}`)) throw new Problem("name_mismatch");
  } else {
    throw new Problem("name_needed");
  }
  return worker.id;
}

// A spreadsheet's stored number can carry float noise ("36.299999999999997" for 36.3): take it
// as 2 decimals only when it is that close to one; anything else is left for the checks to refuse.
function spreadsheetDecimal(text: string): string {
  if (!/^\d+\.\d{3,}$/.test(text)) return text;
  const value = Number(text);
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(value - rounded) < 1e-6 ? rounded.toFixed(2) : text;
}

// Hours as payroll writes them ("37.5", "7.25"): 0 to 1000, at most 2 decimals. As text, for the
// numeric column (no float rounding on the way in).
export function importHours(raw: string): string | null {
  const text = spreadsheetDecimal(raw.trim());
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value <= 1000 ? value.toFixed(2) : null;
}

// Money as payroll writes it ("£12.50", "12.5", "1,234.56", " £ 12 "), in whole pence, up to
// £9,999,999.99. Commas only as thousands separators in groups of three: "12,50" (a decimal
// comma) is refused, never read as £1,250. Spaces only around the amount and after the pound sign:
// "12 50" is refused, never read as £1,250 (audit M16).
export function importPence(raw: string): number | null {
  const text = spreadsheetDecimal(raw.trim().replace(/^£\s*/, ""));
  if (!/^(\d{1,3}(,\d{3})+|\d{1,7})(\.\d{1,2})?$/.test(text)) return null;
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.replace(/,/g, ""));
  if (!m) return null;
  const pounds = Number(m[1]);
  const pence = Number((m[2] ?? "").padEnd(2, "0"));
  return pounds * 100 + pence;
}

export async function runImport(tx: FirmTx, opts: ImportOptions): Promise<ImportResult> {
  const [header = [], ...data] = opts.rows;
  const columns = resolveColumns(opts.kind, header); // throws ImportFileError
  await requireAgreementForImport(tx, {
    saving: !opts.dryRun,
    localDatabase: opts.localDatabase ?? appDatabaseIsLocal(),
  }); // throws AgreementNotRecorded

  const work = async (sp: FirmTx): Promise<ImportResult> => {
    const result: ImportResult = {
      kind: opts.kind,
      dryRun: opts.dryRun,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      problems: [],
    };
    const seen = new Set<string>();
    const importRow = rowImporter(opts, columns, seen);
    for (const [i, row] of data.entries()) {
      if (isBlank(row)) continue;
      let outcome: RowOutcome;
      try {
        outcome = await sp.transaction((rowTx) => importRow(rowTx, row));
      } catch (err) {
        if (err instanceof Problem) outcome = err.code;
        else if (err instanceof WorkerNameMismatch) outcome = "name_mismatch";
        else if (err instanceof WorkerIdentityChange) outcome = "identity_change";
        else if (uniqueViolation(err) === "workers_firm_id_mobile_key")
          outcome = "duplicate_mobile";
        else if (uniqueViolation(err)) outcome = "duplicate_row";
        else throw err;
      }
      if (outcome === "created" || outcome === "updated" || outcome === "unchanged") {
        result[outcome] += 1;
      } else {
        result.skipped += 1;
        result.problems.push({ row: i + 2, problem: outcome });
      }
    }
    await recordEvent(sp, {
      actorType: "office",
      actorId: opts.actorId,
      action: "import.completed",
      entityType: "import",
      data: {
        kind: result.kind,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        ...(opts.via ? { via: opts.via } : {}),
      },
    });
    return result;
  };

  if (!opts.dryRun) return work(tx);
  try {
    await tx.transaction(async (sp) => {
      throw new DryRun(await work(sp));
    });
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
  throw new Error("unreachable");
}

function rowImporter(
  opts: ImportOptions,
  columns: ColumnsOf<ImportKind>,
  seen: Set<string>,
): (tx: FirmTx, row: string[]) => Promise<RowOutcome> {
  const once = (key: string) => {
    if (seen.has(key)) throw new Problem("duplicate_row");
    seen.add(key);
  };
  const office = { type: "office" as const, id: opts.actorId };
  const event = (tx: FirmTx, action: string, entityType: string, entityId: string, data: object) =>
    recordEvent(tx, {
      actorType: "office",
      actorId: opts.actorId,
      action,
      entityType,
      entityId,
      data: { source: "csv", ...(opts.via ? { via: opts.via } : {}), ...data },
    });
  const siteId = async (tx: FirmTx, name: string): Promise<string | null> => {
    const [added] = await tx
      .insert(sites)
      .values({ firmId: sql`app_current_firm_id()`, name })
      .onConflictDoNothing({ target: [sites.firmId, sites.name] })
      .returning({ id: sites.id });
    if (added) {
      await event(tx, "site.created", "site", added.id, {});
      return added.id;
    }
    const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.name, name));
    return site?.id ?? null;
  };

  if (opts.kind === "workers") {
    const c = columns as ColumnsOf<"workers">;
    return async (tx, row) => {
      const ref = tooLong(cellOf(row, c.ref), 200) || undefined;
      const firstName = tooLong(cellOf(row, c.firstName), 100);
      const lastName = tooLong(cellOf(row, c.lastName), 100);
      if (!firstName || !lastName) throw new Problem("missing_value");
      const mobileE164 = importMobile(cellOf(row, c.mobile));
      if (!mobileE164) throw new Problem("bad_mobile");
      const emailCell = cellOf(row, c.email).toLowerCase();
      if (emailCell && !email.safeParse(emailCell).success) throw new Problem("bad_email");
      let roles: string[] | undefined;
      if (c.roles !== undefined) {
        const parsed = cellOf(row, c.roles)
          .split(/[,;\n]/)
          .map((r) => r.trim())
          .filter(Boolean)
          .map(normaliseRole);
        if (parsed.some((r) => r === null)) throw new Problem("bad_role");
        roles = [...new Set(parsed as string[])];
      }
      const statusCell = cellOf(row, c.status).toLowerCase();
      const status = statusCell ? WORKER_STATUSES.find((s) => s === statusCell) : undefined;
      if (statusCell && !status) throw new Problem("bad_status");
      if (ref) once(`worker:${ref}`);
      once(`mobile:${mobileE164}`);
      const { outcome } = await upsertWorker(
        tx,
        {
          ref,
          firstName,
          lastName,
          mobileE164,
          roles,
          status,
          email: emailCell || undefined,
        },
        { source: "csv", actor: office, now: opts.now, via: opts.via },
      );
      return outcome === "added" ? "created" : outcome === "unchanged" ? "unchanged" : "updated";
    };
  }

  if (opts.kind === "pay") {
    const c = columns as ColumnsOf<"pay">;
    const iso = (d: { year: number; month: number; day: number }) =>
      `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    const dateCell = (cell: string, required: boolean): string | null => {
      if (!cell) {
        if (required) throw new Problem("missing_value");
        return null;
      }
      const parsed = parseSheetDate(cell);
      if (!parsed) throw new Problem("bad_date");
      return iso(parsed);
    };
    return async (tx, row) => {
      const ref = cellOf(row, c.ref);
      const mobileCell = cellOf(row, c.mobile);
      if (!ref && !mobileCell) throw new Problem("missing_value");
      const mobile = ref ? null : importMobile(mobileCell);
      if (!ref && !mobile) throw new Problem("bad_mobile");
      const periodStart = dateCell(cellOf(row, c.periodStart), true) ?? "";
      const periodEnd = dateCell(cellOf(row, c.periodEnd), true) ?? "";
      if (periodEnd < periodStart) throw new Problem("bad_period");
      const hoursCell = cellOf(row, c.hours);
      if (!hoursCell) throw new Problem("missing_value");
      const hours = importHours(hoursCell);
      if (hours === null) throw new Problem("bad_hours");
      const rateCell = cellOf(row, c.rate);
      if (!rateCell) throw new Problem("missing_value");
      const ratePence = importPence(rateCell);
      if (ratePence === null) throw new Problem("bad_money");
      const grossCell = cellOf(row, c.gross);
      const grossPence = grossCell ? importPence(grossCell) : null;
      if (grossCell && grossPence === null) throw new Problem("bad_money");
      const payDate = dateCell(cellOf(row, c.payDate), false);

      const worker = { id: await workerForRow(tx, row, c) };
      once(`pay:${worker.id}:${periodStart}:${periodEnd}:${ratePence}`);

      const line = and(
        eq(payRecords.workerId, worker.id),
        eq(payRecords.periodStart, periodStart),
        eq(payRecords.periodEnd, periodEnd),
        eq(payRecords.ratePence, ratePence),
      );
      const [existing] = await tx
        .select({
          id: payRecords.id,
          hours: payRecords.hours,
          grossPence: payRecords.grossPence,
          payDate: payRecords.payDate,
        })
        .from(payRecords)
        .where(line)
        .for("no key update");
      if (!existing) {
        const [added] = await tx
          .insert(payRecords)
          .values({
            firmId: sql`app_current_firm_id()`,
            workerId: worker.id,
            periodStart,
            periodEnd,
            hours,
            ratePence,
            grossPence,
            payDate,
          })
          .returning({ id: payRecords.id });
        if (added) {
          await event(tx, "pay_record.imported", "pay_record", added.id, {
            periodStart,
            periodEnd,
          });
        }
        return "created";
      }
      // A blank pay date leaves what's there (a later file may not repeat it). A blank gross does
      // too, unless the hours changed: a gross from before a correction no longer matches them, so
      // it's cleared rather than shown next to the new hours.
      const hoursChanged = Number(existing.hours) !== Number(hours);
      const next = {
        hours,
        grossPence: grossPence ?? (hoursChanged ? null : existing.grossPence),
        payDate: payDate ?? existing.payDate,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) =>
        k === "hours" ? Number(existing.hours) !== Number(next.hours) : existing[k] !== next[k],
      );
      if (changed.length === 0) return "unchanged";
      await tx
        .update(payRecords)
        .set({ ...next, updatedAt: opts.now })
        .where(eq(payRecords.id, existing.id));
      await event(tx, "pay_record.updated", "pay_record", existing.id, { fields: changed });
      return "updated";
    };
  }

  if (opts.kind === "credentials") {
    const c = columns as ColumnsOf<"credentials">;
    const statuses = ["valid", "expired", "applied", "suspended"] as const;
    return async (tx, row) => {
      const ref = cellOf(row, c.ref);
      const mobileCell = cellOf(row, c.mobile);
      if (!ref && !mobileCell) throw new Problem("missing_value");
      const mobile = ref ? null : importMobile(mobileCell);
      if (!ref && !mobile) throw new Problem("bad_mobile");
      const typeCell = cellOf(row, c.type);
      if (!typeCell) throw new Problem("missing_value");
      const type = typeCell.toUpperCase().replace(/[\s-]+/g, "_");
      if (!/^[A-Z][A-Z0-9_]*$/.test(type) || type.length > 50) throw new Problem("bad_type");
      const numberCell = tooLong(cellOf(row, c.number), 50);
      const expiresCell = cellOf(row, c.expires);
      const expiresDate = expiresCell ? parseSheetDate(expiresCell) : null;
      if (expiresCell && !expiresDate) throw new Problem("bad_date");
      const pad = (n: number) => String(n).padStart(2, "0");
      const expiresOn = expiresDate
        ? `${expiresDate.year}-${pad(expiresDate.month)}-${pad(expiresDate.day)}`
        : null;
      const statusCell = cellOf(row, c.status).toLowerCase();
      const status = statusCell ? statuses.find((s) => s === statusCell) : undefined;
      if (statusCell && !status) throw new Problem("bad_status");

      const worker = { id: await workerForRow(tx, row, c) };
      once(`credential:${worker.id}:${type}`);

      const [existing] = await tx
        .select({
          id: credentials.id,
          number: credentials.number,
          expiresOn: credentials.expiresOn,
          status: credentials.status,
          verifiedAt: credentials.verifiedAt,
        })
        .from(credentials)
        .where(and(eq(credentials.workerId, worker.id), eq(credentials.type, type)))
        .orderBy(desc(credentials.createdAt))
        .limit(1)
        // Locked, so a renewal waits for a credential scan that is marking this row expired, then
        // sees "expired" and makes it valid again (never writes a new date over a stale status).
        .for("update");
      if (!existing) {
        const [added] = await tx
          .insert(credentials)
          .values({
            firmId: sql`app_current_firm_id()`,
            workerId: worker.id,
            type,
            number: numberCell || null,
            expiresOn,
            status: status ?? "valid",
          })
          .returning({ id: credentials.id });
        if (added) await event(tx, "credential.added", "credential", added.id, { type });
        return "created";
      }
      // Only what the file says: a blank or missing cell leaves the field as it is.
      const next: Partial<Pick<typeof existing, "number" | "expiresOn" | "status">> = {};
      if (numberCell) next.number = numberCell;
      if (expiresOn) next.expiresOn = expiresOn;
      if (status) next.status = status;
      else if (existing.status === "expired" && expiresOn && expiresOn > todayIn(opts)) {
        next.status = "valid"; // a renewal (docs/rules-and-credentials.md, Expiry warnings)
      }
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => existing[k] !== next[k],
      );
      if (changed.length === 0) return "unchanged";
      // A new number, expiry or status needs checking again.
      await tx
        .update(credentials)
        .set({ ...next, verifiedAt: null, verifiedBy: null })
        .where(eq(credentials.id, existing.id));
      await event(tx, "credential.updated", "credential", existing.id, {
        type,
        fields: changed,
        ...(existing.verifiedAt ? { verificationCleared: true } : {}),
      });
      return "updated";
    };
  }

  const c = columns as ColumnsOf<"shifts">;
  // A time cell can hold a date too (Excel's date-and-time cells): the time is the last part.
  const timeOf = (cell: string) =>
    parseSheetTime(cell.includes(" ") ? (cell.split(/\s+/).at(-1) ?? "") : cell);
  return async (tx, row) => {
    // The same readers and rule as the Sheets sync and the office's editor (audit L67, L70).
    const date = parseSheetDate(cellOf(row, c.date));
    if (!date) throw new Problem(cellOf(row, c.date) ? "bad_date" : "missing_value");
    const start = timeOf(cellOf(row, c.start));
    const end = timeOf(cellOf(row, c.end));
    if (!start || !end) throw new Problem("bad_time");
    const window = shiftWindow(date, start, end, opts.timeZone);
    if (!window) throw new Problem("bad_time");
    const { startsAt, endsAt } = window;
    if (startsAt.getTime() <= opts.now.getTime()) throw new Problem("shift_started");
    const roleCell = cellOf(row, c.role);
    if (!roleCell) throw new Problem("missing_value");
    const role = normaliseRole(roleCell);
    if (!role) throw new Problem("bad_role");
    const headcountCell = cellOf(row, c.headcount);
    const headcount = headcountCell === "" ? 1 : Number(headcountCell);
    if (!/^\d*$/.test(headcountCell) || headcount < 1 || headcount > 1000) {
      throw new Problem("bad_headcount");
    }
    const siteName = tooLong(cellOf(row, c.site), 200) || null;
    const instructions = tooLong(cellOf(row, c.instructions), 2000) || null;
    const ref =
      tooLong(cellOf(row, c.ref), 200) ||
      `auto-${createHash("sha256")
        .update(`${siteName ?? ""}|${role}|${startsAt.toISOString()}|${endsAt.toISOString()}`)
        .digest("hex")
        .slice(0, 16)}`;
    once(`shift:${ref}`);

    const fields = {
      siteId: siteName ? await siteId(tx, siteName) : null,
      role,
      startsAt,
      endsAt,
      headcount,
      instructions,
    };
    const [existing] = await tx
      .select({
        id: shifts.id,
        siteId: shifts.siteId,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        instructions: shifts.instructions,
        status: shifts.status,
      })
      .from(shifts)
      .where(and(eq(shifts.source, "csv"), eq(shifts.externalRef, ref)))
      .for("no key update");
    if (!existing) {
      const [added] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
          // A new row joins its site and day's automatic event (no file column for it). Only here:
          // a re-import never changes the event, a switch or a session detail.
          shiftEventId: await automaticEventId(tx, {
            siteId: fields.siteId,
            startsAt,
            source: "csv",
            timeZone: opts.timeZone,
          }),
          ...fields,
          status: "open",
          source: "csv",
          externalRef: ref,
        })
        .returning({ id: shifts.id });
      if (added) await event(tx, "shift.created", "shift", added.id, {});
      return "created";
    }
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => {
      const a = existing[k];
      const b = fields[k];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    });
    if (changed.length === 0) return "unchanged";
    if (existing.startsAt.getTime() <= opts.now.getTime()) throw new Problem("shift_started");
    const [held] = await tx
      .select({ n: count() })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, existing.id),
          isNotNull(assignments.workerId),
          notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
        ),
      );
    const bookings = held?.n ?? 0;
    // A new time, role or site for people booked on it is a firm-initiated move (notice per worker).
    const retimed = changed.some(
      (k) => k === "startsAt" || k === "endsAt" || k === "role" || k === "siteId",
    );
    // Fewer places could leave a booked slot above the headcount: that's the office's call.
    if (bookings > 0 && (retimed || headcount < existing.headcount)) {
      throw new Problem("shift_has_bookings");
    }
    await tx.update(shifts).set(fields).where(eq(shifts.id, existing.id));
    await event(tx, "shift.changed", "shift", existing.id, { fields: changed });
    // The status follows the places, as in the office's shift editor: never for a shift the office
    // marked as filled with places still free (src/lib/roster/close.ts), which stays closed until
    // the office opens it again (audit M11). A filled shift that a re-import does open again (more
    // places than its bookings fill) is logged as reopened, by the import.
    const closedByOffice = existing.status === "filled" && bookings < existing.headcount;
    if (!closedByOffice) {
      await refreshShiftStatus(tx, existing.id, opts.now);
      if (existing.status === "filled") {
        const [now] = await tx
          .select({ status: shifts.status })
          .from(shifts)
          .where(eq(shifts.id, existing.id));
        if (now?.status === "open") await event(tx, "shift.reopened", "shift", existing.id, {});
      }
    }
    return "updated";
  };
}

// The constraint a unique violation (23505) hit, if that's what err is.
function uniqueViolation(err: unknown): string | null {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505") return typeof constraint === "string" ? constraint : "unknown";
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

// Today's date (yyyy-mm-dd) in the firm's time zone.
function todayIn(opts: ImportOptions): string {
  const w = wallTimeOf(opts.now, opts.timeZone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
