import { and, asc, eq, gte, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { assignments, CANCELLED_ASSIGNMENT_STATUSES, shifts, sites, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { consumeEligibilityPass, type EligibilityPass } from "../rules/eligibility";
import { noticeHours } from "./notice";
import {
  cancelInputSchema,
  shiftWindowSchema,
  type AssignResult,
  type CancelInput,
  type CancelResult,
  type RosterPlug,
  type RosterShift,
  type RosterStaff,
} from "./plug";

// The native roster plug: our own tables are the rota (firms with no other system). Built on the
// caller's withFirm transaction, so RLS scopes every statement to the caller's firm and the
// caller's eligibility check, this write and the caller's events row commit together. It never
// opens a transaction of its own. Refs are our ids.
//
// Slots: one assignments row per holder of a slot (docs/data-model.md). Open slot rows up to the
// headcount are created on demand, so a shift made without them can still be taken.
//
// Reads use drizzle's query builder (it turns timestamps into Dates; raw execute() returns them as
// text). The conditional writes are raw SQL, so each is exactly one statement.
//
// Every writer of a shift's slots (this plug, and later office edits and offer waves) must lock
// the shift row first, as lockShift does; otherwise a concurrent write can surface as a
// unique-key error instead of a clean result.

const uuid = z.uuid();
const isId = (value: string) => uuid.safeParse(value).success;

// Live rows hold (or offer) a slot; cancelled rows are kept as evidence. Must mean the same as the
// partial unique indexes' condition, which ON CONFLICT below relies on.
const CANCELLED = sql.raw(`(${CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", ")})`);

type LockedShift = {
  firmId: string;
  status: RosterShift["status"];
  headcount: number;
  startsAt: Date;
};

export function nativeRosterPlug(tx: FirmTx, deps: { clock?: Clock } = {}): RosterPlug {
  return tableRosterPlug(tx, "native", deps.clock ?? systemClock);
}

// The Google Sheets roster plug for portal and office requests: our mirror of the firm's sheet
// (kept in step by the sync job, src/lib/roster/sheets/sync.ts) with the same booking rules, and
// refs that are the sheet's own staff and shift ids. It never reads or writes the sheet: the
// next sync carries bookings made here back to it (docs/architecture.md, "never read the sheet
// per request").
export function sheetsRosterPlug(tx: FirmTx, deps: { clock?: Clock } = {}): RosterPlug {
  return tableRosterPlug(tx, "sheets", deps.clock ?? systemClock);
}

function tableRosterPlug(tx: FirmTx, source: "native" | "sheets", clock: Clock): RosterPlug {
  // Native refs are our ids; Sheets refs are the sheet's ids where the row came from the sheet.
  const refOf = (id: string, externalRef: string | null) =>
    source === "sheets" ? (externalRef ?? id) : id;

  // Takers and cancellers of one shift queue on its row, so the shift's status (open / filled)
  // always matches its slots. Each later statement in READ COMMITTED sees the previous commit.
  // "no key update" is enough (the key never changes) and doesn't block other tables' foreign-key
  // checks against the shift.
  async function lockShift(shiftId: string): Promise<LockedShift | undefined> {
    const [shift] = await tx
      .select({
        firmId: shifts.firmId,
        status: shifts.status,
        headcount: shifts.headcount,
        startsAt: shifts.startsAt,
      })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .for("no key update");
    return shift;
  }

  async function workerExists(workerId: string): Promise<boolean> {
    const found = await tx.select({ id: workers.id }).from(workers).where(eq(workers.id, workerId));
    return found.length > 0;
  }

  async function openMissingSlots(shiftId: string, shift: LockedShift): Promise<void> {
    await tx.execute(sql`
      insert into assignments (firm_id, shift_id, slot)
      select ${shift.firmId}, ${shiftId}, g from generate_series(1, ${shift.headcount}) g
      on conflict (firm_id, shift_id, slot) where status not in ${CANCELLED} do nothing
    `);
  }

  return {
    source,
    canWrite: true,

    async listStaff(): Promise<RosterStaff[]> {
      const rows = await tx
        .select({
          id: workers.id,
          externalRef: workers.externalRef,
          firstName: workers.firstName,
          lastName: workers.lastName,
          mobileE164: workers.mobileE164,
          roles: workers.roles,
          status: workers.status,
        })
        .from(workers)
        .where(isNotNull(workers.mobileE164)) // not the erased (anonymous rows, no one to list)
        .orderBy(asc(workers.lastName), asc(workers.firstName), asc(workers.id));
      return rows.flatMap(({ id, externalRef, mobileE164, ...person }) =>
        mobileE164 === null
          ? []
          : [{ ref: refOf(id, externalRef), ...person, mobileE164, roles: [...person.roles] }],
      );
    },

    async getShifts(from: Date, to: Date): Promise<RosterShift[]> {
      const window = shiftWindowSchema.parse({ from, to });
      const inWindow = and(gte(shifts.startsAt, window.from), lt(shifts.startsAt, window.to));
      const rows = await tx
        .select({
          id: shifts.id,
          externalRef: shifts.externalRef,
          siteName: sites.name,
          role: shifts.role,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          headcount: shifts.headcount,
          status: shifts.status,
          instructions: shifts.instructions,
        })
        .from(shifts)
        .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
        .where(inWindow)
        .orderBy(asc(shifts.startsAt), asc(shifts.id));
      const holders = await tx
        .select({
          shiftId: assignments.shiftId,
          slot: assignments.slot,
          workerId: assignments.workerId,
          workerRef: workers.externalRef,
        })
        .from(assignments)
        .innerJoin(
          shifts,
          and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
        )
        .leftJoin(
          workers,
          and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
        )
        .where(
          and(
            inWindow,
            isNotNull(assignments.workerId),
            notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
          ),
        )
        .orderBy(asc(assignments.slot));
      return rows.map(({ id, externalRef, ...shift }) => ({
        ref: refOf(id, externalRef),
        ...shift,
        assigned: holders.flatMap((h) =>
          h.shiftId === id && h.workerId
            ? [{ slot: h.slot, staffRef: refOf(h.workerId, h.workerRef) }]
            : [],
        ),
      }));
    },

    async assign(shiftId: string, workerId: string, pass: EligibilityPass): Promise<AssignResult> {
      consumeEligibilityPass(pass, { workerId, shiftId });
      if (!isId(shiftId) || !isId(workerId)) return { status: "not_found" };
      const shift = await lockShift(shiftId);
      if (!shift || !(await workerExists(workerId))) return { status: "not_found" };
      if (shift.status === "draft" || shift.status === "cancelled") return { status: "not_open" };
      const { rows: held } = await tx.execute(sql`
        select 1 from assignments
         where shift_id = ${shiftId} and worker_id = ${workerId} and status not in ${CANCELLED}
      `);
      if (held.length > 0) return { status: "already_assigned" };
      if (shift.status === "filled") return { status: "filled" };

      await openMissingSlots(shiftId, shift);
      // First yes wins (golden rule 4): one conditional update on the lowest open slot, only
      // while the shift is open. Zero rows means someone else took the last one.
      const { rows } = await tx.execute<{ id: string; slot: number }>(sql`
        update assignments a
           set worker_id = ${workerId}, status = 'confirmed', confirmed_at = ${clock.now()}
          from shifts s
         where a.id = (select o.id from assignments o
                        where o.shift_id = ${shiftId} and o.worker_id is null
                          and o.status = 'open' and o.slot <= ${shift.headcount}
                        order by o.slot limit 1)
           and a.worker_id is null
           and s.firm_id = a.firm_id and s.id = a.shift_id and s.status = 'open'
        returning a.id, a.slot
      `);
      const taken = rows[0];
      if (!taken) return { status: "filled" };

      await tx.execute(sql`
        update shifts s set status = 'filled'
         where s.id = ${shiftId} and s.status = 'open'
           and (select count(*) from assignments a
                 where a.shift_id = s.id and a.worker_id is not null
                   and a.status not in ${CANCELLED} and a.slot <= s.headcount) >= s.headcount
      `);
      return { status: "assigned", assignmentId: taken.id, slot: taken.slot };
    },

    async markCancelled(
      shiftId: string,
      workerId: string,
      input: CancelInput,
    ): Promise<CancelResult> {
      const cancel = cancelInputSchema.parse(input);
      if (cancel.at.getTime() > clock.now().getTime()) {
        throw new Error("a cancellation can't be dated after now");
      }
      if (!isId(shiftId) || !isId(workerId)) return { status: "not_found" };
      const shift = await lockShift(shiftId);
      if (!shift || !(await workerExists(workerId))) return { status: "not_found" };

      // Only a confirmed booking can be cancelled: not a slot worked or missed, and not an
      // offer (declining an offer isn't a cancellation; what "offered" means is still open).
      const [row] = await tx
        .select({
          id: assignments.id,
          slot: assignments.slot,
          confirmedAt: assignments.confirmedAt,
        })
        .from(assignments)
        .where(
          and(
            eq(assignments.shiftId, shiftId),
            eq(assignments.workerId, workerId),
            eq(assignments.status, "confirmed"),
          ),
        );
      if (!row) return { status: "not_assigned" };
      if (row.confirmedAt && cancel.at.getTime() < row.confirmedAt.getTime()) {
        throw new Error("a cancellation can't be dated before the booking it cancels");
      }

      const notice = noticeHours(shift.startsAt, cancel.at);
      const status = cancel.by === "firm" ? "cancelled_firm" : "cancelled_worker";
      const cancelled = await tx.execute(sql`
        update assignments
           set status = ${status}, cancelled_at = ${cancel.at}, cancel_reason = ${cancel.reason},
               notice_hours = ${notice}
         where id = ${row.id} and status = 'confirmed'
      `);
      if (cancelled.rowCount !== 1) return { status: "not_assigned" }; // changed under us
      // The cancelled row stays as evidence; a new open row reopens the slot, and a filled shift
      // is open again. A slot above a lowered headcount isn't reopened, so the shift stays as is,
      // and neither is a slot on a shift that has started (nobody can take it: it's history).
      if (row.slot <= shift.headcount && shift.startsAt.getTime() > clock.now().getTime()) {
        await tx.execute(sql`
          insert into assignments (firm_id, shift_id, slot)
          values (${shift.firmId}, ${shiftId}, ${row.slot})
        `);
        await tx.execute(sql`
          update shifts set status = 'open' where id = ${shiftId} and status = 'filled'
        `);
      }
      return { status: "cancelled", assignmentId: row.id, noticeHours: notice };
    },
  };
}

// Keeps an open or filled shift's status true to its slots after its headcount changed (a sheet
// sync, an import): filled when every place within the headcount is held, else open. Draft and
// cancelled shifts are left alone. Inside the caller's withFirm transaction.
export async function refreshShiftStatus(tx: FirmTx, shiftId: string): Promise<void> {
  await tx.execute(sql`
    update shifts s set status = case
        when (select count(*) from assignments a
               where a.shift_id = s.id and a.worker_id is not null
                 and a.status not in ${CANCELLED}
                 and a.slot <= s.headcount) >= s.headcount
        then 'filled' else 'open' end
     where s.id = ${shiftId} and s.status in ('open', 'filled')
  `);
}
