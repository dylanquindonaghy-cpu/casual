import { createHash } from "node:crypto";
import { and, count, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { normaliseMobile } from "../auth/mobile";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  credentials,
  shifts,
  sites,
  workers,
  WORKER_STATUSES,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { refreshShiftStatus } from "../roster/native";
import { normaliseRole, parseSheetDate, parseSheetTime } from "../roster/sheets/parse";
import { upsertWorker } from "../roster/workers";
import { nextDay, wallTimeOf, zonedToUtc } from "../time/zoned";
import { resolveColumns, type ColumnsOf, type ImportKind } from "./columns";

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
//   keeps its times and role, and its headcount can't go down: that is a firm-initiated change,
//   logged per worker with notice (golden rule 12), and belongs to the office's shift editor.
//   Shifts that have started are history: never created or changed by an import.

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
  "shift_has_bookings",
  "shift_started",
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

// Excel drops the leading 0 of a mobile typed as a number (7700900123).
export function importMobile(raw: string): string | null {
  return normaliseMobile(/^7\d{9}$/.test(raw) ? `0${raw}` : raw);
}

const email = z.email().max(254);

export async function runImport(tx: FirmTx, opts: ImportOptions): Promise<ImportResult> {
  const [header = [], ...data] = opts.rows;
  const columns = resolveColumns(opts.kind, header); // throws ImportFileError

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

      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(ref ? eq(workers.externalRef, ref) : eq(workers.mobileE164, mobile ?? ""));
      if (!worker) throw new Problem("unknown_worker");
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
        .limit(1);
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
  const timeOf = (cell: string) =>
    parseSheetTime(cell.includes(" ") ? (cell.split(/\s+/).at(-1) ?? "") : cell);
  return async (tx, row) => {
    const date = parseSheetDate(cellOf(row, c.date).split(/\s+/)[0] ?? "");
    if (!date) throw new Problem(cellOf(row, c.date) ? "bad_date" : "missing_value");
    const start = timeOf(cellOf(row, c.start));
    const end = timeOf(cellOf(row, c.end));
    if (!start || !end) throw new Problem("bad_time");
    const startsAt = zonedToUtc({ ...date, ...start }, opts.timeZone);
    let endsAt = zonedToUtc({ ...date, ...end }, opts.timeZone);
    if (endsAt.getTime() <= startsAt.getTime()) {
      endsAt = zonedToUtc({ ...nextDay({ ...date, ...end }), ...end }, opts.timeZone);
    }
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
      })
      .from(shifts)
      .where(and(eq(shifts.source, "csv"), eq(shifts.externalRef, ref)))
      .for("no key update");
    if (!existing) {
      const [added] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
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
    const retimed = changed.some((k) => k === "startsAt" || k === "endsAt" || k === "role");
    // Fewer places could leave a booked slot above the headcount: that's the office's call.
    if (bookings > 0 && (retimed || headcount < existing.headcount)) {
      throw new Problem("shift_has_bookings");
    }
    await tx.update(shifts).set(fields).where(eq(shifts.id, existing.id));
    await refreshShiftStatus(tx, existing.id);
    await event(tx, "shift.changed", "shift", existing.id, { fields: changed });
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
