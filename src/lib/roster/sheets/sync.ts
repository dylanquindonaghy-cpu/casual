import { and, asc, eq, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { MINUTE, type Clock } from "../../auth/clock";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  firms,
  rosterSources,
  shifts,
  sites,
  workers,
} from "../../db/schema";
import type { FirmTx, WithFirm } from "../../db/scoped";
import { recordEvent } from "../../events/record";
import { retryAborted } from "../../db/retry";
import { checkBooking } from "../book";
import { RulesSettingsError } from "../eligibility-input";
import { refreshShiftStatus, sheetsRosterPlug } from "../native";
import { upsertWorker } from "../workers";
import { noticeHours } from "../notice";
import { cellRange, columnRange, tabRange } from "./a1";
import { SheetsError, type SheetsClient } from "./client";
import { sheetMappingSchema } from "./mapping";
import { mergeHolders, sameHolders } from "./merge";
import {
  parseSheet,
  SheetLayoutError,
  splitHolders,
  type ParsedSheet,
  type SheetProblem,
  type SheetShift,
} from "./parse";
import { markUrgentAfterDropout } from "../urgent";

// One sync of a firm's Google Sheet with our mirror of it (docs/architecture.md, Roster plugs;
// ADR-013). Run by the sheets-sync job, never by a request:
//
// 1. Claim the firm's sync lease. Every later write to roster_sources is fenced on it, so a sync
//    that overran its lease can't clobber the next one.
// 2. Read the sheet: one batch read of the staff and shifts tabs.
// 3. In one transaction: mirror staff and shifts into our tables, then merge who holds each
//    shift three ways (merge.ts). Office changes in the sheet are applied through the roster plug
//    and logged (golden rules 5 and 12). Shifts that have started are mirrored but their bookings
//    are left alone: no bookings or cancellations after the fact, and no history booked on a
//    first sync. The merge base becomes what the sheet held at this read.
// 4. Write back, in one batch write, every assigned cell that differs from our bookings, after
//    re-reading (one request) each target row's id and assigned cells: a row that moved, or a
//    cell the office edited meanwhile, is left for the next sync.
// 5. Record each written cell as the new merge base, and the sync as done.
//
// A failed or skipped write loses nothing: the base stays at the sheet's last read, so the next
// sync pushes the same bookings and still sees any newer office edit. The sheet is only ever
// touched here.

export const SYNC_LEASE_MS = 5 * MINUTE;
export const REMOVED_ON_SHEET = "Removed on the rota sheet";
export const CANCELLED_ON_SHEET = "Shift cancelled on the rota sheet";
export const CHANGED_ON_SHEET = "Times changed on the rota sheet";
export const ADDED_ON_SHEET = "Put on the rota sheet by the office";
// A name in the office's own sheet may override these (never credentials, role, account, a
// double booking or a blocked site; golden rule 6). "Started" isn't among them: a sync never books
// a shift that has started.
export const SHEET_OVERRIDES = ["rest", "weekly_hours", "unavailable"] as const;

export type SyncOutcome =
  | { status: "no_source" }
  | { status: "busy" }
  | { status: "failed"; code: string }
  | {
      status: "synced";
      staff: number;
      shifts: number;
      booked: number;
      cancelled: number;
      writes: number;
      skippedWrites: number;
      notBooked: number;
      problems: SheetProblem[];
    };

interface Claimed {
  id: string;
  claimedAt: Date;
  spreadsheetId: string;
  mapping: unknown;
  previousErrorCode: string | null;
  timezone: string;
}

interface PendingWrite {
  ref: string;
  row: number;
  theirs: string[]; // the cell as read in step 2
  holders: string[]; // what we write
}

interface MirrorResult {
  writes: PendingWrite[];
  booked: number;
  cancelled: number;
  notBooked: number;
  problems: SheetProblem[];
}

export interface SyncDeps {
  run: WithFirm;
  firmId: string;
  client: SheetsClient;
  clock: Clock;
}

class LeaseLost extends Error {}

export async function syncSheet({ run, firmId, client, clock }: SyncDeps): Promise<SyncOutcome> {
  const now = clock.now();
  const claim = await run(firmId, (tx) => claimLease(tx, now));
  if (claim === "none") return { status: "no_source" };
  if (claim === "busy") return { status: "busy" };
  const ours = and(
    eq(rosterSources.id, claim.id),
    eq(rosterSources.syncStartedAt, claim.claimedAt),
  );

  // Logs a failure once per new code, not every retry.
  const fail = async (code: string): Promise<SyncOutcome> => {
    await run(firmId, async (tx) => {
      const [held] = await tx
        .update(rosterSources)
        .set({ lastErrorCode: code, syncStartedAt: null })
        .where(ours)
        .returning({ id: rosterSources.id });
      if (held && code !== claim.previousErrorCode) {
        await recordEvent(tx, {
          actorType: "system",
          action: "roster.sync_failed",
          entityType: "roster_source",
          entityId: claim.id,
          data: { code },
        });
      }
    });
    return { status: "failed", code };
  };

  try {
    const mapping = sheetMappingSchema.safeParse(claim.mapping);
    if (!mapping.success) return await fail("bad_mapping");

    let parsed: ParsedSheet;
    try {
      const [staffRows = [], shiftRows = []] = await client.batchGet(claim.spreadsheetId, [
        tabRange(mapping.data.staff.tab),
        tabRange(mapping.data.shifts.tab),
      ]);
      parsed = parseSheet({ staffRows, shiftRows }, mapping.data, claim.timezone);
    } catch (err) {
      if (err instanceof SheetsError || err instanceof SheetLayoutError) {
        return await fail(err.code);
      }
      throw err;
    }

    // All database work on the sheet as read: if Postgres aborts it to break a deadlock with a
    // portal booking (book.ts), it runs again on the same read.
    const mirrored = await retryAborted(() =>
      run(firmId, async (tx) => {
        const [held] = await tx
          .select({ id: rosterSources.id })
          .from(rosterSources)
          .where(ours)
          .for("update");
        if (!held) throw new LeaseLost();
        return mirror(tx, parsed, clock, now);
      }),
    );

    let written: PendingWrite[] = [];
    if (mirrored.writes.length > 0) {
      const { shiftsTab, refColumn, assignedColumn } = parsed.layout;
      try {
        const [idColumn = [], assignedCells = []] = await client.batchGet(claim.spreadsheetId, [
          columnRange(shiftsTab, refColumn),
          columnRange(shiftsTab, assignedColumn),
        ]);
        written = mirrored.writes.filter((w) => {
          const sameRow = String(idColumn[w.row - 1]?.[0] ?? "").trim() === w.ref;
          const cell = splitHolders(String(assignedCells[w.row - 1]?.[0] ?? ""));
          const untouched = cell.length === w.theirs.length && sameHolders(cell, w.theirs);
          return sameRow && untouched;
        });
        if (written.length > 0) {
          await client.batchUpdate(
            claim.spreadsheetId,
            written.map((w) => ({
              range: cellRange(shiftsTab, assignedColumn, w.row),
              value: w.holders.join(", "),
            })),
          );
        }
      } catch (err) {
        if (err instanceof SheetsError) return await fail(err.code);
        throw err;
      }
    }

    return await run(firmId, async (tx) => {
      const [held] = await tx
        .update(rosterSources)
        .set({ lastSyncedAt: now, lastErrorCode: null, syncStartedAt: null })
        .where(ours)
        .returning({ id: rosterSources.id });
      if (!held) throw new LeaseLost();
      for (const w of written) {
        await tx
          .update(shifts)
          .set({ syncedHolders: w.holders })
          .where(and(eq(shifts.source, "sheets"), eq(shifts.externalRef, w.ref)));
      }
      const outcome = {
        status: "synced" as const,
        staff: parsed.staff.length,
        shifts: parsed.shifts.length,
        booked: mirrored.booked,
        cancelled: mirrored.cancelled,
        writes: written.length,
        skippedWrites: mirrored.writes.length - written.length,
        notBooked: mirrored.notBooked,
        problems: mirrored.problems,
      };
      await recordEvent(tx, {
        actorType: "system",
        action: "roster.synced",
        entityType: "roster_source",
        entityId: claim.id,
        data: {
          staff: outcome.staff,
          shifts: outcome.shifts,
          booked: outcome.booked,
          cancelled: outcome.cancelled,
          writes: outcome.writes,
          skippedWrites: outcome.skippedWrites,
          notBooked: outcome.notBooked,
          problems: outcome.problems.length,
        },
      });
      return outcome;
    });
  } catch (err) {
    // Another sync holds the lease now: leave its state alone.
    if (err instanceof LeaseLost) return { status: "busy" };
    await fail("sync_error");
    throw err;
  }
}

async function claimLease(tx: FirmTx, now: Date): Promise<Claimed | "none" | "busy"> {
  const staleBefore = new Date(now.getTime() - SYNC_LEASE_MS);
  const [claimed] = await tx
    .update(rosterSources)
    .set({ syncStartedAt: now, lastAttemptedAt: now })
    .where(
      and(
        eq(rosterSources.kind, "sheets"),
        eq(rosterSources.enabled, true),
        or(isNull(rosterSources.syncStartedAt), lt(rosterSources.syncStartedAt, staleBefore)),
      ),
    )
    .returning({
      id: rosterSources.id,
      spreadsheetId: rosterSources.spreadsheetId,
      mapping: rosterSources.mapping,
      previousErrorCode: rosterSources.lastErrorCode,
    });
  if (!claimed) {
    const [exists] = await tx
      .select({ id: rosterSources.id })
      .from(rosterSources)
      .where(and(eq(rosterSources.kind, "sheets"), eq(rosterSources.enabled, true)));
    return exists ? "busy" : "none";
  }
  const [firm] = await tx.select({ timezone: firms.timezone }).from(firms);
  return { ...claimed, claimedAt: now, timezone: firm?.timezone ?? "Europe/London" };
}

async function liveHolders(tx: FirmTx, shiftId: string) {
  return tx
    .select({
      assignmentId: assignments.id,
      workerId: assignments.workerId,
      ref: workers.externalRef,
      status: assignments.status,
    })
    .from(assignments)
    .innerJoin(
      workers,
      and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
    )
    .where(
      and(
        eq(assignments.shiftId, shiftId),
        isNotNull(assignments.workerId),
        notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
      ),
    )
    .orderBy(asc(assignments.slot));
}

const system = (action: string, entityType: string, entityId: string, data: object) => ({
  actorType: "system" as const,
  action,
  entityType,
  entityId,
  data: { source: "sheets", ...data },
});

async function mirror(
  tx: FirmTx,
  sheet: ParsedSheet,
  clock: Clock,
  now: Date,
): Promise<MirrorResult> {
  const problems = [...sheet.problems];
  const plug = sheetsRosterPlug(tx, { clock });

  for (const person of sheet.staff) {
    try {
      await tx.transaction((sp) =>
        upsertWorker(
          sp,
          {
            ref: person.ref,
            firstName: person.firstName,
            lastName: person.lastName,
            mobileE164: person.mobileE164,
            roles: person.roles,
            status: person.status,
          },
          { source: "sheets", actor: { type: "system" }, now },
        ),
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      problems.push({ tab: "staff", row: person.row, problem: "duplicate_mobile" });
    }
  }
  const workerIds = new Map(
    (
      await tx
        .select({ id: workers.id, ref: workers.externalRef })
        .from(workers)
        .where(isNotNull(workers.externalRef))
    ).map((w) => [w.ref ?? "", w.id]),
  );

  const siteNames = [...new Set(sheet.shifts.flatMap((s) => (s.siteName ? [s.siteName] : [])))];
  for (const name of siteNames) {
    const [added] = await tx
      .insert(sites)
      .values({ firmId: sql`app_current_firm_id()`, name })
      .onConflictDoNothing({ target: [sites.firmId, sites.name] })
      .returning({ id: sites.id });
    if (added) await recordEvent(tx, system("site.created", "site", added.id, {}));
  }
  const siteIds = new Map(
    (await tx.select({ id: sites.id, name: sites.name }).from(sites)).map((s) => [s.name, s.id]),
  );

  let booked = 0;
  let cancelled = 0;
  let notBooked = 0;
  const writes: PendingWrite[] = [];

  for (const row of sheet.shifts) {
    const fields = {
      siteId: row.siteName ? (siteIds.get(row.siteName) ?? null) : null,
      role: row.role,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      headcount: row.headcount,
      instructions: row.instructions,
    };
    // Lock our copy first (as the plug does), so no booking lands between our read and our
    // changes.
    const [existing] = await tx
      .select({
        id: shifts.id,
        status: shifts.status,
        siteId: shifts.siteId,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        instructions: shifts.instructions,
        syncedHolders: shifts.syncedHolders,
      })
      .from(shifts)
      .where(and(eq(shifts.source, "sheets"), eq(shifts.externalRef, row.ref)))
      .for("no key update");
    // A shift that has started (by the sheet or by our copy) is mirrored, but its bookings are
    // history: never booked, cancelled or re-timed after the fact.
    const started =
      row.startsAt.getTime() <= now.getTime() ||
      (existing !== undefined && existing.startsAt.getTime() <= now.getTime());
    const sheetStatus = row.status === "cancelled" || row.status === "draft" ? row.status : null;

    let shiftId: string;
    if (!existing) {
      const [inserted] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
          ...fields,
          status: sheetStatus ?? "open",
          source: "sheets",
          externalRef: row.ref,
        })
        .returning({ id: shifts.id });
      if (!inserted) throw new Error("shift insert returned nothing");
      shiftId = inserted.id;
      await recordEvent(tx, system("shift.created", "shift", shiftId, {}));
    } else {
      shiftId = existing.id;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) =>
        fields[k] instanceof Date
          ? (existing[k] as Date).getTime() !== (fields[k] as Date).getTime()
          : existing[k] !== fields[k],
      );
      if (changed.length > 0) {
        if ((changed.includes("startsAt") || changed.includes("endsAt")) && !started) {
          if (sheetStatus !== "cancelled") await logTimeChange(tx, shiftId, existing, row, now);
        }
        await tx.update(shifts).set(fields).where(eq(shifts.id, shiftId));
        await recordEvent(tx, system("shift.changed", "shift", shiftId, { fields: changed }));
      }
    }

    // Status set in the sheet: Cancelled or Draft; otherwise open/filled follow the slots.
    const before = existing?.status ?? sheetStatus ?? "open";
    if (sheetStatus === "cancelled" && before !== "cancelled" && !started) {
      for (const holder of await liveHolders(tx, shiftId)) {
        if (holder.status !== "confirmed" || !holder.workerId) continue;
        const result = await plug.markCancelled(shiftId, holder.workerId, {
          reason: CANCELLED_ON_SHEET,
          by: "firm",
          at: now,
        });
        if (result.status === "cancelled") {
          cancelled += 1;
          await logCancel(
            tx,
            { ...result, shiftId, workerId: holder.workerId },
            CANCELLED_ON_SHEET,
          );
        }
      }
    }
    const after = sheetStatus ?? (before === "cancelled" || before === "draft" ? "open" : before);
    if (existing && after !== before) {
      await tx.update(shifts).set({ status: after }).where(eq(shifts.id, shiftId));
      await recordEvent(
        tx,
        system("shift.status_changed", "shift", shiftId, { from: before, to: after }),
      );
    }

    // Who holds it. Not for a draft (its names are the office's plan: left alone in the sheet),
    // a cancelled or started shift (history), or a cell we couldn't read (reported).
    if (row.holdersReadable && sheetStatus === null && !started) {
      const result = await mergeShift(
        tx,
        plug,
        shiftId,
        row,
        existing?.syncedHolders ?? [],
        workerIds,
        now,
      );
      booked += result.booked;
      cancelled += result.cancelled;
      notBooked += result.notBooked;
      if (result.write) writes.push(result.write);
      if (result.problem) problems.push(result.problem);
    } else if (row.holdersReadable) {
      // Nothing merged: the sheet's cell as read is the base from now on.
      await tx
        .update(shifts)
        .set({ syncedHolders: holdersOf(row) })
        .where(eq(shifts.id, shiftId));
    }

    // The sheet may have changed the headcount: keep open / filled true to the slots.
    await refreshShiftStatus(tx, shiftId);
  }

  return { writes, booked, cancelled, notBooked, problems };
}

async function mergeShift(
  tx: FirmTx,
  plug: ReturnType<typeof sheetsRosterPlug>,
  shiftId: string,
  row: SheetShift,
  base: string[],
  workerIds: Map<string, string>,
  now: Date,
): Promise<{
  booked: number;
  cancelled: number;
  notBooked: number;
  write?: PendingWrite;
  problem?: SheetProblem;
}> {
  const theirs = holdersOf(row);
  const ours = await liveHolders(tx, shiftId);
  if (ours.some((h) => !h.ref)) {
    // Booked here by someone the sheet has no staff id for: we can't show them in the sheet, so
    // this shift's holders aren't synced until the office adds them to the staff tab.
    await recordEvent(
      tx,
      system("roster.sheet_conflict", "shift", shiftId, { holderNotInSheet: true }),
    );
    return {
      booked: 0,
      cancelled: 0,
      notBooked: 0,
      problem: { tab: "shifts", row: row.row, problem: "holder_not_in_sheet" },
    };
  }
  const merged = mergeHolders({
    base,
    theirs,
    ours: ours.map((h) => h.ref ?? ""),
    headcount: row.headcount,
  });
  let booked = 0;
  let cancelled = 0;
  const keep = new Set(merged.holders);
  for (const holder of ours) {
    if (!holder.ref || keep.has(holder.ref) || !holder.workerId) continue;
    if (holder.status !== "confirmed") continue;
    const result = await plug.markCancelled(shiftId, holder.workerId, {
      reason: REMOVED_ON_SHEET,
      by: "firm",
      at: now,
    });
    if (result.status === "cancelled") {
      cancelled += 1;
      await logCancel(tx, { ...result, shiftId, workerId: holder.workerId }, REMOVED_ON_SHEET);
    }
  }
  const held = new Set(ours.map((h) => h.ref));
  let unbooked = merged.notBooked.length;
  for (const ref of merged.holders) {
    if (held.has(ref)) continue;
    const workerId = workerIds.get(ref);
    // A name in the office's sheet is the office placing someone: the rules still decide, with the
    // office's overrides (SHEET_OVERRIDES). Anything else they refuse isn't booked, and the refusal
    // is logged for the office. A firm whose rules settings are broken books no sheet names until
    // they're fixed, but the rest of the sync (cancellations, time changes) still goes through.
    let check: Awaited<ReturnType<typeof checkBooking>> | null = null;
    if (workerId) {
      try {
        check = await checkBooking(tx, { shiftId, workerId, now, overrides: [...SHEET_OVERRIDES] });
      } catch (err) {
        if (!(err instanceof RulesSettingsError)) throw err;
        unbooked += 1;
        await recordEvent(
          tx,
          system("roster.sheet_booking_refused", "shift", shiftId, {
            workerId,
            codes: ["settings_invalid"],
          }),
        );
        continue;
      }
    }
    if (!workerId || check?.status !== "checked") {
      unbooked += 1;
      continue;
    }
    if (!check.result.pass) {
      unbooked += 1;
      await recordEvent(
        tx,
        system("roster.sheet_booking_refused", "shift", shiftId, {
          workerId,
          codes: check.result.codes,
        }),
      );
      continue;
    }
    const result = await plug.assign(shiftId, workerId, check.result.pass);
    if (result.status === "assigned") {
      booked += 1;
      await recordEvent(
        tx,
        system("shift.assigned", "assignment", result.assignmentId, {
          by: "firm",
          shiftId,
          workerId,
          slot: result.slot,
          noticeHours: noticeHours(check.startsAt, now),
          reason: ADDED_ON_SHEET,
          ...(check.result.overridden.length > 0 ? { overridden: check.result.overridden } : {}),
        }),
      );
    } else {
      unbooked += 1;
    }
  }
  if (unbooked > 0) {
    await recordEvent(
      tx,
      system("roster.sheet_conflict", "shift", shiftId, { notBooked: unbooked }),
    );
  }
  // A name taken off close to the start leaves an urgent gap, as any dropout does, but only if
  // the sheet's changes as a whole left one: checked after its new names are booked, so a name
  // swapped for another is not a dropout.
  if (cancelled > 0) await markUrgentAfterDropout(tx, { shiftId, now, source: "sheets" });
  const final = (await liveHolders(tx, shiftId)).map((h) => h.ref ?? "");
  const inStep = sameHolders(final, theirs);
  // The sheet's changes up to this read are applied: its cell as read is the base, until a
  // write succeeds (then the written value is).
  await tx
    .update(shifts)
    .set({ syncedHolders: inStep ? final : theirs })
    .where(eq(shifts.id, shiftId));
  return {
    booked,
    cancelled,
    notBooked: unbooked,
    write: inStep ? undefined : { ref: row.ref, row: row.row, theirs, holders: final },
  };
}

const holdersOf = (row: SheetShift) => row.assigned.map((a) => a.staffRef);

// The same shape as a person's cancellation (cancel.ts), plus the fixed reason: never free text.
async function logCancel(
  tx: FirmTx,
  cancel: { assignmentId: string; shiftId: string; workerId: string; noticeHours: number },
  reason: string,
): Promise<void> {
  await recordEvent(
    tx,
    system("shift.cancelled", "assignment", cancel.assignmentId, {
      by: "firm",
      shiftId: cancel.shiftId,
      workerId: cancel.workerId,
      reason,
      noticeHours: cancel.noticeHours,
    }),
  );
}

// Golden rule 12: a move or curtailment by the office is logged per booked worker, with the old
// and new times and the notice given (counted from the old start).
async function logTimeChange(
  tx: FirmTx,
  shiftId: string,
  before: { startsAt: Date; endsAt: Date },
  after: { startsAt: Date; endsAt: Date },
  now: Date,
): Promise<void> {
  const curtailed =
    after.startsAt.getTime() >= before.startsAt.getTime() &&
    after.endsAt.getTime() <= before.endsAt.getTime();
  for (const holder of await liveHolders(tx, shiftId)) {
    if (holder.status !== "confirmed") continue;
    await recordEvent(
      tx,
      system(curtailed ? "shift.curtailed" : "shift.moved", "assignment", holder.assignmentId, {
        by: "firm",
        shiftId,
        workerId: holder.workerId,
        reason: CHANGED_ON_SHEET,
        oldStartsAt: before.startsAt.toISOString(),
        oldEndsAt: before.endsAt.toISOString(),
        newStartsAt: after.startsAt.toISOString(),
        newEndsAt: after.endsAt.toISOString(),
        noticeHours: noticeHours(before.startsAt, now),
      }),
    );
  }
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
