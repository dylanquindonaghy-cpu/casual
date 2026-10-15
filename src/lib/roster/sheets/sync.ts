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
  type SheetIssues,
} from "../../db/schema";
import type { FirmTx, WithFirm } from "../../db/scoped";
import { recordEvent } from "../../events/record";
import { strikeDecision } from "../../strikes/decide";
import { acceptOwnOffer } from "../../offers/close";
import { retryAborted } from "../../db/retry";
import { checkBooking } from "../book";
import { RulesSettingsError } from "../eligibility-input";
import {
  placeAfterCancel,
  refreshShiftStatus,
  sheetsRosterPlug,
  type PlaceAfterCancel,
} from "../native";
import { automaticEventId } from "../shift-events";
import { upsertWorker, WorkerIdentityChange, WorkerNameMismatch } from "../workers";
import { changeNoticeHours, noticeHours } from "../notice";
import { cellRange, columnRange, tabRange } from "./a1";
import { SHEET_LOCALE, SHEET_LOCALE_ERROR, SheetsError, type SheetsClient } from "./client";
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
import { recheckHolders, type RecheckHolder } from "../recheck";
import type { RuleCode } from "../../rules/eligibility";
import { queueTravelEstimates } from "../../travel/estimate-queue";

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
export const SITE_CHANGED_ON_SHEET = "Site changed on the rota sheet";
export const ADDED_ON_SHEET = "Put on the rota sheet by the office";
// A name in the office's own sheet may override these (never credentials, role, account, a
// double booking or a blocked site; golden rule 6). "Started" isn't among them: a sync never books
// a shift that has started.
export const SHEET_OVERRIDES = ["rest", "weekly_hours", "unavailable"] as const;
// The fields of a shift that decide who may work it: a change to one of them on a booked shift is
// made only if everyone booked can still work it (recheckHolders), never on a started shift.
const RULED_FIELDS = ["role", "startsAt", "endsAt", "siteId"] as const;

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
  base: string[]; // the merge base once written: what we write, less names we couldn't book
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
      // Only a United Kingdom sheet: its dates read day first, as the parser reads them.
      if ((await client.locale(claim.spreadsheetId)) !== SHEET_LOCALE) {
        return await fail(SHEET_LOCALE_ERROR);
      }
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
        return mirror(tx, parsed, clock, now, claim.timezone);
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
          .set({ syncedHolders: w.base })
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
          // Staff rows not taken because they'd give someone else's record to them (the office's
          // to sort out in the sheet): said in the action log.
          ...(staffRefused(outcome.problems) > 0
            ? { staffRefused: staffRefused(outcome.problems) }
            : {}),
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
  timeZone: string,
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
      if (err instanceof WorkerNameMismatch || err instanceof WorkerIdentityChange) {
        const problem = err instanceof WorkerNameMismatch ? "name_mismatch" : "identity_change";
        problems.push({ tab: "staff", row: person.row, problem });
        continue;
      }
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
  // Sessions added, back from draft or cancelled, or given a new time, role or site: their travel
  // estimates (12G.2), queued once with the sync, so they're there without waiting for the nightly
  // run. (Drafts and cancelled sessions need none: a new one isn't queued, and the job skips any.)
  const travel = new Set<string>();
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
        sheetIssues: shifts.sheetIssues,
      })
      .from(shifts)
      .where(and(eq(shifts.source, "sheets"), eq(shifts.externalRef, row.ref)))
      .for("no key update");
    // What this sync couldn't do for this row, for the dashboard (saved at the end of the row).
    const issues: SheetIssues = {};
    // A shift that has started (our copy's start, or the sheet's for a new row) is mirrored, but
    // its bookings are history: never booked, cancelled, re-timed, re-roled or moved after the fact.
    const started = (existing?.startsAt ?? row.startsAt).getTime() <= now.getTime();
    const sheetStatus = row.status === "cancelled" || row.status === "draft" ? row.status : null;
    const theirs = holdersOf(row);
    // Who holds it is merged only for a row we can read, not a draft (its names are the office's
    // plan), a cancelled shift or a started one (history).
    const merging = row.holdersReadable && sheetStatus === null && !started;

    let shiftId: string;
    let removedFirst = 0;
    if (!existing) {
      const [inserted] = await tx
        .insert(shifts)
        .values({
          firmId: sql`app_current_firm_id()`,
          // A new row joins its site and day's automatic event (no sheet column for it). Only
          // here: an update never changes the event, a switch or a session detail.
          shiftEventId: await automaticEventId(tx, {
            siteId: fields.siteId,
            startsAt: fields.startsAt,
            source: "sheets",
            timeZone,
          }),
          ...fields,
          status: sheetStatus ?? "open",
          source: "sheets",
          externalRef: row.ref,
        })
        .returning({ id: shifts.id });
      if (!inserted) throw new Error("shift insert returned nothing");
      shiftId = inserted.id;
      await recordEvent(tx, system("shift.created", "shift", shiftId, {}));
      if (!sheetStatus) travel.add(shiftId);
    } else {
      shiftId = existing.id;
      // 1. The people the sheet took off it go first, at the shift as they knew it, so their
      //    notice is right and they don't stand in the way of its other changes.
      if (merging) {
        const removed = await sheetRemovals(tx, plug, shiftId, theirs, existing.syncedHolders, now);
        cancelled += removed;
        removedFirst = removed;
      }
      // 2. Role, times and site decide who may work a shift: the office editor's rules apply to
      //    the sheet too (audit M1, M2). A started shift is never changed by a sync (ADR-013), nor
      //    one moved into the past; a booked one only if everyone still booked can work it (the
      //    rules, with the sheet's overrides), tried in a savepoint. Otherwise our copy keeps
      //    them, the office is told (the dashboard, and the log), and the rest of the row still applies.
      //    A shift the sheet cancels in the same edit keeps the times its people knew this sync.
      const differs = (k: keyof typeof fields, value: (typeof fields)[keyof typeof fields]) =>
        value instanceof Date
          ? (existing[k] as Date).getTime() !== value.getTime()
          : existing[k] !== value;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) =>
        differs(k, fields[k]),
      );
      const checked = changed.filter((k) => (RULED_FIELDS as readonly string[]).includes(k));
      const cancelling = sheetStatus === "cancelled" && existing.status !== "cancelled";
      let refusal: NonNullable<SheetIssues["change"]>["reason"] | null = null;
      let refusedBy: { workerId: string; codes: RuleCode[] }[] = [];
      let verdicts: RecheckHolder[] = [];
      if (checked.length > 0) {
        if (started) refusal = "started";
        else if (cancelling) {
          // Held back this sync (below): its people are told of the shift they knew.
        } else if (row.startsAt.getTime() <= now.getTime()) refusal = "in_past";
        else {
          const tried = await tryRuledChange(tx, {
            shiftId,
            ruled: {
              role: fields.role,
              startsAt: fields.startsAt,
              endsAt: fields.endsAt,
              siteId: fields.siteId,
            },
            existing,
            timeZone,
            now,
          });
          if (tried.refusal) {
            refusal = tried.refusal;
            refusedBy = tried.workers;
          } else {
            verdicts = tried.holders;
          }
        }
      }
      const apply =
        refusal !== null || cancelling
          ? {
              ...fields,
              role: existing.role,
              startsAt: existing.startsAt,
              endsAt: existing.endsAt,
              siteId: existing.siteId,
            }
          : fields;
      if (refusal !== null) {
        issues.change = {
          fields: checked,
          wanted: Object.fromEntries(
            checked.map((k) => [
              k,
              fields[k] instanceof Date ? fields[k].toISOString() : fields[k],
            ]),
          ),
          reason: refusal,
          workers: refusedBy,
        };
        problems.push({
          tab: "shifts",
          row: row.row,
          problem: refusal === "started" ? "started_change" : "change_refused",
        });
      }
      // 3. What's left of the row.
      const applied = changed.filter((k) => differs(k, apply[k]));
      if (applied.length > 0) {
        const moved = applied.some((k) => k === "startsAt" || k === "endsAt" || k === "siteId");
        if (moved) await logTimeChange(tx, shiftId, existing, apply, now, verdicts);
        if (moved || applied.includes("role")) travel.add(shiftId);
        await tx.update(shifts).set(apply).where(eq(shifts.id, shiftId));
        // A new site: a booking the office kept (Phase 10, the dashboard's "Bookings to check") is looked
        // at again, in case its worker is blocked from the new site.
        if (applied.includes("siteId")) {
          await tx
            .update(assignments)
            .set({ officeKeptAt: null })
            .where(eq(assignments.shiftId, shiftId));
        }
        // Anyone the sheet's own overrides let through (rest, hours, a day off), for the record.
        const overridden = verdicts
          .filter((v) => !v.ok)
          .map((v) => ({ workerId: v.workerId, codes: v.codes }));
        await recordEvent(
          tx,
          system("shift.changed", "shift", shiftId, {
            fields: applied,
            ...(overridden.length > 0 ? { overridden } : {}),
          }),
        );
        // More places (or fewer): open / filled follow before any new name is booked.
        if (applied.includes("headcount")) await refreshShiftStatus(tx, shiftId, now);
      }
    }

    // 4. Status set in the sheet: Cancelled or Draft; otherwise open/filled follow the slots.
    const before = existing?.status ?? sheetStatus ?? "open";
    if (sheetStatus === "cancelled" && before !== "cancelled" && !started) {
      for (const holder of await liveHolders(tx, shiftId)) {
        if (holder.status !== "confirmed" || !holder.workerId) continue;
        const result = await plug.markCancelled(shiftId, holder.workerId, {
          reason: CANCELLED_ON_SHEET,
          by: "firm",
          at: now,
          via: "sheet",
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
    let after = sheetStatus ?? (before === "cancelled" || before === "draft" ? "open" : before);
    // A shift that has started is never cancelled (or drafted) by a sync: its bookings are history.
    if (existing && started && after !== before) {
      issues.change = {
        fields: [...(issues.change?.fields ?? []), "status"],
        wanted: { ...(issues.change?.wanted ?? {}), status: after },
        reason: "started",
        workers: [],
      };
      problems.push({ tab: "shifts", row: row.row, problem: "started_change" });
      after = before;
    }
    if (existing && after !== before) {
      // Back from draft or cancelled: it needs travel lines again (12G.2).
      if ((after === "open" || after === "filled") && before !== "open" && before !== "filled") {
        travel.add(shiftId);
      }
      await tx.update(shifts).set({ status: after }).where(eq(shifts.id, shiftId));
      await recordEvent(
        tx,
        system("shift.status_changed", "shift", shiftId, { from: before, to: after }),
      );
    }

    // 5. Who holds it: the sheet's new names.
    const previousNames = existing?.sheetIssues?.names ?? [];
    if (merging) {
      const result = await mergeShift(tx, plug, shiftId, row, {
        base: existing?.syncedHolders ?? [],
        saved: existing?.syncedHolders ?? null,
        workerIds,
        now,
        previous: previousNames,
        removedFirst,
      });
      if (result.names.length > 0) issues.names = result.names;
      booked += result.booked;
      cancelled += result.cancelled;
      notBooked += result.notBooked;
      if (result.write) writes.push(result.write);
      if (result.problem) problems.push(result.problem);
    } else {
      if (row.holdersReadable) {
        // Nothing merged. A draft's base is who's booked here, so its planned names count as new
        // when it's published; otherwise the sheet's cell as read is the base from now on.
        const base =
          sheetStatus === "draft"
            ? (await liveHolders(tx, shiftId)).flatMap((h) => (h.ref ? [h.ref] : []))
            : theirs;
        await saveBase(tx, shiftId, existing?.syncedHolders ?? null, base);
      }
      // A started shift's names are history; otherwise what was said last still stands.
      if (!started && previousNames.length > 0) issues.names = previousNames;
    }

    // 6. Tell the office what's new (once: a sync that sees the same sheet says nothing), and keep
    //    what's true now for the dashboard.
    if (issues.change && canon(issues.change) !== canon(existing?.sheetIssues?.change ?? null)) {
      await recordEvent(tx, system("roster.sheet_change_refused", "shift", shiftId, issues.change));
    }
    const next = issues.change || issues.names ? issues : null;
    if (canon(next) !== canon(existing?.sheetIssues ?? null)) {
      await tx.update(shifts).set({ sheetIssues: next }).where(eq(shifts.id, shiftId));
    }

    // The sheet may have changed the headcount: keep open / filled true to the slots.
    await refreshShiftStatus(tx, shiftId, now);
  }

  await queueTravelEstimates(tx, [...travel]);
  return { writes, booked, cancelled, notBooked, problems };
}

// The people the sheet took off a shift since the last sync (in the base, booked here, not in the
// cell now): cancelled by the firm with notice, before the row's other changes are made.
async function sheetRemovals(
  tx: FirmTx,
  plug: ReturnType<typeof sheetsRosterPlug>,
  shiftId: string,
  theirs: string[],
  base: string[] | null,
  now: Date,
): Promise<number> {
  const ours = await liveHolders(tx, shiftId);
  // Someone booked here with no staff id: this shift's holders aren't synced (mergeShift says so).
  if (ours.some((h) => !h.ref)) return 0;
  const inBase = new Set(base ?? []);
  const inTheirs = new Set(theirs);
  let cancelled = 0;
  for (const holder of ours) {
    if (!holder.ref || !holder.workerId || holder.status !== "confirmed") continue;
    if (!inBase.has(holder.ref) || inTheirs.has(holder.ref)) continue;
    const result = await plug.markCancelled(shiftId, holder.workerId, {
      reason: REMOVED_ON_SHEET,
      by: "firm",
      at: now,
      via: "sheet",
    });
    if (result.status === "cancelled") {
      cancelled += 1;
      await logCancel(tx, { ...result, shiftId, workerId: holder.workerId }, REMOVED_ON_SHEET);
    }
  }
  return cancelled;
}

async function mergeShift(
  tx: FirmTx,
  plug: ReturnType<typeof sheetsRosterPlug>,
  shiftId: string,
  row: SheetShift,
  opts: {
    base: string[];
    saved: string[] | null; // the base as stored (null: never synced)
    workerIds: Map<string, string>;
    now: Date;
    previous: NonNullable<SheetIssues["names"]>; // what the last sync told the office
    removedFirst: number; // people the sheet took off this sync (sheetRemovals)
  },
): Promise<{
  booked: number;
  cancelled: number;
  notBooked: number;
  names: NonNullable<SheetIssues["names"]>;
  write?: PendingWrite;
  problem?: SheetProblem;
}> {
  const { base, workerIds, now, previous } = opts;
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
      names: previous,
      problem: { tab: "shifts", row: row.row, problem: "holder_not_in_sheet" },
    };
  }
  // Who the merge keeps, and every name the sheet added since base (no headcount here: the rules
  // run before a place is given, so a name they refuse doesn't use up a place a later name could
  // have had: audit L12). The sheet's removals were made first (sheetRemovals).
  const merged = mergeHolders({
    base,
    theirs,
    ours: ours.map((h) => h.ref ?? ""),
    headcount: Number.MAX_SAFE_INTEGER,
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
      via: "sheet",
    });
    if (result.status === "cancelled") {
      cancelled += 1;
      await logCancel(tx, { ...result, shiftId, workerId: holder.workerId }, REMOVED_ON_SHEET);
    }
  }
  const held = new Set(ours.map((h) => h.ref));
  // Places left: the people still booked here.
  let room = row.headcount - ours.filter((h) => !h.ref || keep.has(h.ref)).length;
  // Names the sheet added that aren't booked (refused, no place, or unknown): they stay in the
  // sheet's cell while there's room, for the office to see (the dashboard, "From your rota sheet"), but
  // out of the merge base, so each sync tries them again (booked once they can work it, or a place
  // frees up).
  const left = new Map<string, { workerId?: string; codes: string[] }>();
  const refuse = (ref: string, workerId: string | undefined, codes: string[]) => {
    left.set(ref, { ...(workerId ? { workerId } : {}), codes });
  };
  for (const ref of merged.holders) {
    if (held.has(ref)) continue;
    const workerId = workerIds.get(ref);
    if (room <= 0) {
      refuse(ref, workerId, ["no_place"]);
      continue;
    }
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
        refuse(ref, workerId, ["settings_invalid"]);
        continue;
      }
    }
    if (!workerId || check?.status !== "checked") {
      refuse(ref, workerId, ["not_found"]);
      continue;
    }
    if (!check.result.pass) {
      refuse(ref, workerId, check.result.codes);
      continue;
    }
    const result = await plug.assign(shiftId, workerId, check.result.pass);
    if (result.status === "assigned") {
      booked += 1;
      room -= 1;
      // Named on the sheet after being offered it: they took it (src/lib/offers/close.ts).
      await acceptOwnOffer(tx, shiftId, workerId, now);
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
      refuse(ref, workerId, ["no_place"]);
    }
  }
  // A name taken off close to the start leaves an urgent gap, as any dropout does, but only if
  // the sheet's changes as a whole left one: checked after its new names are booked, so a name
  // swapped for another is not a dropout.
  if (cancelled + opts.removedFirst > 0) {
    await markUrgentAfterDropout(tx, { shiftId, now, source: "sheets" });
  }
  const live = await liveHolders(tx, shiftId);
  const final = live.map((h) => h.ref ?? "");
  // What the cell should say: our bookings, then the sheet's names we couldn't book (in the
  // sheet's order) while there's room for them. A sheet name is never written into a cell past
  // the shift's places (the next read couldn't use the cell), so a name with no room left is the
  // only one taken out of the office's sheet: on the dashboard and in the log, never silently.
  const spare = Math.max(0, row.headcount - final.length);
  const stayInSheet = theirs.filter((ref) => left.has(ref) && !final.includes(ref)).slice(0, spare);
  const wanted = [...final, ...stayInSheet];
  // For the dashboard: the names left this sync (dropped when there was no room in the cell), and any
  // dropped before that still isn't booked or back in the sheet.
  const finalIds = new Set(live.flatMap((h) => (h.workerId ? [h.workerId] : [])));
  const theirsIds = new Set(theirs.flatMap((ref) => workerIds.get(ref) ?? []));
  const now_ = [...left].flatMap(([ref, l]) =>
    l.workerId
      ? [
          {
            workerId: l.workerId,
            codes: l.codes,
            ...(stayInSheet.includes(ref) ? {} : { dropped: true }),
          },
        ]
      : [],
  );
  const names: NonNullable<SheetIssues["names"]> = [
    ...now_,
    ...previous.filter(
      (p) =>
        p.dropped &&
        !finalIds.has(p.workerId) &&
        !theirsIds.has(p.workerId) &&
        !now_.some((n) => n.workerId === p.workerId),
    ),
  ];
  // Each refusal is logged once, until what's said about that name changes (from the last sync's
  // own record, so a sync that sees the same sheet says nothing new).
  const told = new Set(previous.map((p) => canon(p)));
  let newlyRefused = 0;
  for (const n of now_) {
    if (told.has(canon(n))) continue;
    newlyRefused += 1;
    await recordEvent(
      tx,
      system("roster.sheet_booking_refused", "shift", shiftId, {
        workerId: n.workerId,
        codes: n.codes,
        ...(n.dropped ? { droppedFromSheet: true } : {}),
      }),
    );
  }
  if (newlyRefused > 0) {
    await recordEvent(
      tx,
      system("roster.sheet_conflict", "shift", shiftId, { notBooked: left.size }),
    );
  }
  const inStep = sameHolders(wanted, theirs);
  // The sheet's changes up to this read are applied: its cell as read is the base (less the names
  // we couldn't book), until a write succeeds (then the written value is, less the same).
  const notLeft = (refs: string[]) => refs.filter((ref) => !left.has(ref));
  await saveBase(tx, shiftId, opts.saved, notLeft(theirs));
  return {
    booked,
    cancelled,
    notBooked: left.size,
    names,
    write: inStep
      ? undefined
      : { ref: row.ref, row: row.row, theirs, holders: wanted, base: notLeft(wanted) },
  };
}

// The merge base, written only when it changes (every sheet row is synced every minute).
async function saveBase(
  tx: FirmTx,
  shiftId: string,
  was: string[] | null,
  base: string[],
): Promise<void> {
  if (was !== null && was.length === base.length && was.every((ref, i) => ref === base[i])) return;
  await tx.update(shifts).set({ syncedHolders: base }).where(eq(shifts.id, shiftId));
}

// Compares two values as JSON with every object's keys in order (jsonb reorders them on the way
// in, so a plain JSON.stringify of what we read back never matches what we built).
function canon(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, w]) => [k, sorted(w)]),
          )
        : v;
  return JSON.stringify(sorted(value));
}

const holdersOf = (row: SheetShift) => row.assigned.map((a) => a.staffRef);

// The same shape as a person's cancellation (cancel.ts), plus the fixed reason: never free text.
// What became of the place: the whole shift cancelled on the sheet, or (a name removed) what the
// cancellation did to its slot, read straight after it (placeAfterCancel).
async function logCancel(
  tx: FirmTx,
  cancel: { assignmentId: string; shiftId: string; workerId: string; noticeHours: number },
  reason: typeof CANCELLED_ON_SHEET | typeof REMOVED_ON_SHEET,
): Promise<void> {
  const place: PlaceAfterCancel =
    reason === CANCELLED_ON_SHEET
      ? { place: "session_cancelled" }
      : await placeAfterCancel(tx, cancel.assignmentId);
  await recordEvent(
    tx,
    system("shift.cancelled", "assignment", cancel.assignmentId, {
      by: "firm",
      shiftId: cancel.shiftId,
      workerId: cancel.workerId,
      reason,
      noticeHours: cancel.noticeHours,
      // The sheet is the firm's: never a strike (src/lib/strikes/decide.ts).
      strike: strikeDecision({ cancelledBy: "firm" }).code,
      ...place,
    }),
  );
}

// Golden rule 12: a move or curtailment by the office is logged per booked worker, with the old
// and new times and site and the notice given (counted from the earlier of the old and new start,
// as the office editor counts it: changeNoticeHours), and the rules' answer for them at the new
// shift (rulesOk, codes: what the sheet's overrides let through). Curtailed when the new times
// sit inside the old ones at the same site; otherwise moved (the office editor's rule). The
// reason says what changed: the times, or only the site.
async function logTimeChange(
  tx: FirmTx,
  shiftId: string,
  before: { startsAt: Date; endsAt: Date; siteId: string | null },
  after: { startsAt: Date; endsAt: Date; siteId: string | null },
  now: Date,
  verdicts: RecheckHolder[],
): Promise<void> {
  const sameTimes =
    after.startsAt.getTime() === before.startsAt.getTime() &&
    after.endsAt.getTime() === before.endsAt.getTime();
  const curtailed =
    before.siteId === after.siteId &&
    after.startsAt.getTime() >= before.startsAt.getTime() &&
    after.endsAt.getTime() <= before.endsAt.getTime();
  const verdictOf = new Map(verdicts.map((v) => [v.workerId, v]));
  for (const holder of await liveHolders(tx, shiftId)) {
    if (holder.status !== "confirmed" || !holder.workerId) continue;
    const v = verdictOf.get(holder.workerId);
    await recordEvent(
      tx,
      system(curtailed ? "shift.curtailed" : "shift.moved", "assignment", holder.assignmentId, {
        by: "firm",
        shiftId,
        workerId: holder.workerId,
        reason: sameTimes ? SITE_CHANGED_ON_SHEET : CHANGED_ON_SHEET,
        oldStartsAt: before.startsAt.toISOString(),
        oldEndsAt: before.endsAt.toISOString(),
        newStartsAt: after.startsAt.toISOString(),
        newEndsAt: after.endsAt.toISOString(),
        oldSiteId: before.siteId,
        newSiteId: after.siteId,
        noticeHours: changeNoticeHours(before.startsAt, after.startsAt, now),
        ...(v ? { rulesOk: v.ok, ...(!v.ok ? { codes: v.codes } : {}) } : {}),
      }),
    );
  }
}

class ChangeRefused extends Error {
  constructor(readonly workers: { workerId: string; codes: RuleCode[] }[]) {
    super("the people booked can't work the changed shift");
  }
}

// A booked shift's role, times or site changed in the sheet: made in a savepoint, then everyone
// still booked checked at the changed shift (src/lib/roster/recheck.ts, with the sheet's
// overrides). Someone can't work it, or the firm's rules settings can't be read (fail closed):
// rolled back, and who and why are returned. Otherwise it stands, with everyone's answer (the
// caller writes the same row again and logs it).
async function tryRuledChange(
  tx: FirmTx,
  opts: {
    shiftId: string;
    ruled: { role: string; startsAt: Date; endsAt: Date; siteId: string | null };
    existing: { siteId: string | null };
    timeZone: string;
    now: Date;
  },
): Promise<
  | { refusal: "rules" | "settings"; workers: { workerId: string; codes: RuleCode[] }[] }
  | { refusal: null; holders: RecheckHolder[] }
> {
  try {
    const holders = await tx.transaction(async (sp) => {
      await sp.update(shifts).set(opts.ruled).where(eq(shifts.id, opts.shiftId));
      const result = await recheckHolders(sp, {
        shiftId: opts.shiftId,
        now: opts.now,
        startsAt: opts.ruled.startsAt,
        timeZone: opts.timeZone,
        siteChanged: opts.ruled.siteId !== opts.existing.siteId,
        allowed: SHEET_OVERRIDES,
        honourKept: true,
      });
      if (result.blocked.length > 0) {
        throw new ChangeRefused(
          result.blocked.map((b) => ({ workerId: b.workerId, codes: b.codes })),
        );
      }
      return result.holders;
    });
    return { refusal: null, holders };
  } catch (err) {
    if (err instanceof ChangeRefused) return { refusal: "rules", workers: err.workers };
    if (err instanceof RulesSettingsError) return { refusal: "settings", workers: [] };
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const staffRefused = (problems: SheetProblem[]) =>
  problems.filter((p) => p.problem === "name_mismatch" || p.problem === "identity_change").length;
