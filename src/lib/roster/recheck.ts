import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { assignments, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { RuleCode } from "../rules/eligibility";
import { localDateOf } from "../time/zoned";
import { lockAppliedDay, previewBooking } from "./book";

// Can the people booked on a shift still work it, now that it has changed (its times, its site or
// its role)? For the office's move (src/lib/roster/firm-change.ts) and the Sheets sync's change to
// a booked shift (src/lib/roster/sheets/sync.ts): one answer for both editors. Called inside the
// caller's transaction, after it has locked the shift and written the change to it (the rules read
// the shift as it now is; the shift itself is left out of each person's other bookings).
//
// - Each booked worker's row held first (in id order, after the shift's: the order a booking takes
//   them), so a booking of theirs happening at this moment finishes first and is seen, or waits
//   (audit L21); "kept" is read after it (the office's worker controls clear it under that lock:
//   src/lib/office/worker-access.ts). Then the new day's "applied" lock, as a booking takes it, so
//   a booking on an application in progress that day and this change count the allowance in turn.
//   The shift's lock keeps who is booked from changing meanwhile.
// - Blocked: someone fails a check the editor can't override (`allowed`), or couldn't be checked
//   at all (their record missing). A booking the office chose to keep (the dashboard's "Bookings to check")
//   though its worker isn't active, or is blocked from the site: those two don't count unless the
//   site changes, so a block at a new site is never kept unseen. Only for an editor that honours
//   the office's keep (`honourKept`: the office and the rota sheet); the planner's API doesn't, so a
//   kept booking's checks stop the planner's move like any other (12J.1 review).

export interface RecheckHolder {
  assignmentId: string;
  workerId: string;
  name: string;
  ok: boolean;
  codes: RuleCode[];
  reasons: string[];
}

export async function recheckHolders(
  tx: FirmTx,
  opts: {
    shiftId: string;
    now: Date;
    startsAt: Date; // the shift's start now (for the day's "applied" lock)
    timeZone: string;
    siteChanged: boolean;
    allowed: readonly RuleCode[]; // codes this editor may override
    honourKept: boolean; // the office's "keep" counts for this editor
  },
): Promise<{ holders: RecheckHolder[]; blocked: RecheckHolder[] }> {
  const booked = await tx
    .select({ workerId: assignments.workerId })
    .from(assignments)
    .where(
      and(
        eq(assignments.shiftId, opts.shiftId),
        eq(assignments.status, "confirmed"),
        isNotNull(assignments.workerId),
      ),
    );
  const ids = [...new Set(booked.flatMap((b) => (b.workerId ? [b.workerId] : [])))].sort();
  if (ids.length === 0) return { holders: [], blocked: [] };
  await tx
    .select({ id: workers.id })
    .from(workers)
    .where(inArray(workers.id, ids))
    .orderBy(asc(workers.id))
    .for("no key update");
  await lockAppliedDay(tx, localDateOf(opts.startsAt, opts.timeZone));

  const rows = await tx
    .select({
      assignmentId: assignments.id,
      workerId: assignments.workerId,
      first: workers.firstName,
      last: workers.lastName,
      kept: assignments.officeKeptAt,
    })
    .from(assignments)
    .innerJoin(
      workers,
      and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
    )
    .where(
      and(
        eq(assignments.shiftId, opts.shiftId),
        eq(assignments.status, "confirmed"),
        isNotNull(assignments.workerId),
      ),
    )
    .orderBy(asc(assignments.slot));

  const holders: RecheckHolder[] = [];
  const blocked: RecheckHolder[] = [];
  for (const r of rows) {
    if (!r.workerId) continue;
    const verdict = await previewBooking(tx, {
      shiftId: opts.shiftId,
      workerId: r.workerId,
      now: opts.now,
    });
    // No answer (their record is missing) counts as a no nobody can override.
    const v = verdict ?? { ok: false, codes: [], reasons: ["Their record couldn't be checked."] };
    const holder = {
      assignmentId: r.assignmentId,
      workerId: r.workerId,
      name: `${r.first} ${r.last}`,
      ok: v.ok,
      codes: v.codes,
      reasons: v.reasons,
    };
    holders.push(holder);
    if (v.ok) continue;
    if (v.codes.length === 0) {
      blocked.push(holder);
      continue;
    }
    const counted =
      opts.honourKept && r.kept !== null && !opts.siteChanged
        ? v.codes.filter((c) => c !== "not_active" && c !== "blocked_site")
        : v.codes;
    if (counted.length > 0 && !counted.every((c) => opts.allowed.includes(c))) {
      blocked.push(holder);
    }
  }
  return { holders, blocked };
}
