import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import {
  ALLOCATION_MODES,
  allocationGate,
  fairRotationCutoff,
  type AllocationGate,
  type AllocationMode,
} from "../rules/allocation";
import { weekOf } from "../rules/eligibility";
import { urgentWindowHoursSchema } from "../rules/urgent";
import { localDateOf } from "../time/zoned";
import { BOOKED_STATUSES } from "./eligibility-input";
import { FIRM_CHANGE_REASONS } from "./firm-reasons";

// Reads what the allocation gate (src/lib/rules/allocation.ts) needs for one worker and one shift,
// inside the caller's withFirm transaction, and asks it. Only reads; the gate decides.
//
// - The firm's `allocation_mode` (default first come, first served; anything else throws). Under
//   fair rotation only: `wave_size` (the group, default 4), `wave_minutes` (how long it has, default
//   15) and `urgent_window_hours` (default 24: a shift starting sooner is never held, so late
//   dropouts fill at once). A value that makes no sense throws.
// - Nothing is held unless the shift is open and the worker isn't already on it: then the plug's
//   own answer (filled, not open, already booked) is the right one.
// - When the place opened: the shift's creation, or the latest cancellation of a booking on it.
// - Confirmed and completed hours in the shift's Monday-to-Sunday week (local), for this worker and
//   for every active worker with the shift's role who isn't already on it (weeklyHours).

const modeSchema = z.object({
  allocation_mode: z.enum(ALLOCATION_MODES).default("first_come_first_served"),
});
const fairRotationSchema = z.object({
  wave_size: z.number().int().min(1).max(50).default(4),
  wave_minutes: z.number().int().min(1).max(240).default(15),
  urgent_window_hours: urgentWindowHoursSchema,
});

export class AllocationSettingsError extends Error {
  constructor() {
    super("the firm's allocation settings are invalid");
    this.name = "AllocationSettingsError";
  }
}

export type AllocationSettings =
  | { mode: "first_come_first_served" }
  | {
      mode: "fair_rotation";
      groupSize: number;
      priorityMinutes: number;
      urgentWindowHours: number;
    };

// The firm's allocation settings (read once per page by the Open shifts list).
export function parseAllocationSettings(settings: Record<string, unknown>): AllocationSettings {
  const mode = modeSchema.safeParse(settings);
  if (!mode.success) throw new AllocationSettingsError();
  if ((mode.data.allocation_mode as AllocationMode) === "first_come_first_served") {
    return { mode: "first_come_first_served" };
  }
  const fair = fairRotationSchema.safeParse(settings);
  if (!fair.success) throw new AllocationSettingsError();
  return {
    mode: "fair_rotation",
    groupSize: fair.data.wave_size,
    priorityMinutes: fair.data.wave_minutes,
    urgentWindowHours: fair.data.urgent_window_hours,
  };
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const BOOKED = sql.raw(BOOKED_STATUSES.map((s) => `'${s}'`).join(", "));

export async function loadAllocationGate(
  tx: FirmTx,
  request: { shiftId: string; workerId: string; now: Date },
  known?: AllocationSettings,
): Promise<AllocationGate> {
  const [shift] = await tx
    .select({
      firmId: shifts.firmId,
      role: shifts.role,
      status: shifts.status,
      startsAt: shifts.startsAt,
      createdAt: shifts.createdAt,
      isUrgent: shifts.isUrgent,
    })
    .from(shifts)
    .where(eq(shifts.id, request.shiftId));
  // Not there, not open, or full: nothing to hold (the booking says why). An urgent shift is
  // offered out by the waves (src/lib/offers/waves.ts), so it's never held either: whoever an
  // offer reached can take it.
  if (!shift || shift.status !== "open" || shift.isUrgent) return { ok: true };
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, shift.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  const settings = known ?? parseAllocationSettings(firm.settings);
  if (settings.mode === "first_come_first_served") return { ok: true };

  const { rows: facts } = await tx.execute<{
    last_cancel: string | Date | null;
    mine: boolean;
  }>(sql`
    select (select max(cancelled_at) from assignments
             where shift_id = ${request.shiftId} and cancelled_at is not null
               -- The office's "fewer staff" took its place away: no place opened (Phase 10 task 19).
               and not (status = 'cancelled_firm'
                        and cancel_reason = ${FIRM_CHANGE_REASONS.fewer_staff})) as last_cancel,
           exists (select 1 from assignments
                    where shift_id = ${request.shiftId} and worker_id = ${request.workerId}
                      and status not in (${CANCELLED})) as mine
  `);
  if (facts[0]?.mine) return { ok: true }; // already on it: the booking says so
  const lastCancel = facts[0]?.last_cancel ? new Date(facts[0].last_cancel) : null;
  const openedAt =
    lastCancel && lastCancel.getTime() > shift.createdAt.getTime() ? lastCancel : shift.createdAt;
  // Past the window, starting soon, or the window would run past the start: nobody is held, so
  // there's nothing more to read. A place is never held beyond its shift's start.
  const windowEnds = openedAt.getTime() + settings.priorityMinutes * 60_000;
  if (
    request.now.getTime() >= windowEnds ||
    shift.startsAt.getTime() - request.now.getTime() <= settings.urgentWindowHours * 3_600_000 ||
    windowEnds >= shift.startsAt.getTime()
  ) {
    return { ok: true };
  }

  const hours = await weeklyHours(tx, {
    shiftId: request.shiftId,
    role: shift.role,
    week: weekOf(localDateOf(shift.startsAt, firm.timezone), firm.timezone),
    workerId: request.workerId,
  });
  const mine = hours.get(request.workerId) ?? 0;
  return allocationGate({
    mode: settings.mode,
    now: request.now,
    openedAt,
    priorityMinutes: settings.priorityMinutes,
    workerHours: mine,
    cutoffHours: fairRotationCutoff([...hours.values()], settings.groupSize),
  });
}

// Confirmed and completed hours, in the week, on shifts that aren't cancelled: for this worker,
// and for every active worker with the role who isn't already on the shift (workers with none
// count as 0).
export async function weeklyHours(
  tx: FirmTx,
  q: { shiftId: string; role: string; week: { from: number; to: number }; workerId: string },
): Promise<Map<string, number>> {
  const { rows } = await tx.execute<{ worker_id: string; hours: string | number }>(sql`
    select w.id as worker_id, coalesce(booked.hours, 0) as hours
      from workers w
      left join (
        select a.worker_id, sum(extract(epoch from (s2.ends_at - s2.starts_at)) / 3600) as hours
          from assignments a
          join shifts s2 on s2.firm_id = a.firm_id and s2.id = a.shift_id
         where a.status in (${BOOKED}) and s2.status <> 'cancelled'
           and s2.starts_at >= ${new Date(q.week.from)} and s2.starts_at < ${new Date(q.week.to)}
         group by a.worker_id
      ) booked on booked.worker_id = w.id
     where w.id = ${q.workerId}
        or (w.status = 'active' and ${q.role} = any (w.roles)
            and not exists (select 1 from assignments held
                             where held.firm_id = w.firm_id and held.shift_id = ${q.shiftId}
                               and held.worker_id = w.id and held.status not in (${CANCELLED})))
  `);
  return new Map(rows.map((r) => [r.worker_id, Number(r.hours)]));
}

// The same gate for one worker and many shifts at once (Open shifts and the urgent board), with a
// bounded number of queries: the shifts' facts together, then one week's hours per role and week
// the held shifts touch (at most the window's weeks times the worker's roles), and everyone on
// those shifts together. Held to loadAllocationGate, shift for shift, by
// tests/integration/eligibility.batch.test.ts.
export async function loadAllocationGates(
  tx: FirmTx,
  request: { shiftIds: string[]; workerId: string; now: Date },
  settings: AllocationSettings,
): Promise<Map<string, AllocationGate>> {
  const out = new Map<string, AllocationGate>();
  const shiftIds = [...new Set(request.shiftIds)];
  for (const id of shiftIds) out.set(id, { ok: true });
  if (settings.mode === "first_come_first_served" || shiftIds.length === 0) return out;

  const ids = sql.join(
    shiftIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const { rows: facts } = await tx.execute<{
    id: string;
    firm_id: string;
    role: string;
    status: string;
    starts_at: string | Date;
    created_at: string | Date;
    is_urgent: boolean;
    last_cancel: string | Date | null;
    mine: boolean;
  }>(sql`
    select s.id::text as id, s.firm_id::text as firm_id, s.role, s.status, s.starts_at,
           s.created_at, s.is_urgent,
           (select max(a.cancelled_at) from assignments a
             where a.shift_id = s.id and a.cancelled_at is not null) as last_cancel,
           exists (select 1 from assignments a
                    where a.shift_id = s.id and a.worker_id = ${request.workerId}
                      and a.status not in (${CANCELLED})) as mine
      from shifts s
     where s.id in (${ids})
  `);
  const firstFirm = facts[0]?.firm_id;
  if (!firstFirm) return out;
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, firstFirm));
  if (!firm) throw new Error("firm not visible inside its own transaction");

  // The shifts still inside their priority window: they need the week's hours.
  const waiting: {
    id: string;
    role: string;
    week: { from: number; to: number };
    openedAt: Date;
    startsAt: Date;
  }[] = [];
  for (const f of facts) {
    if (f.status !== "open" || f.is_urgent || f.mine) continue;
    const startsAt = new Date(f.starts_at);
    const createdAt = new Date(f.created_at);
    const lastCancel = f.last_cancel ? new Date(f.last_cancel) : null;
    const openedAt =
      lastCancel && lastCancel.getTime() > createdAt.getTime() ? lastCancel : createdAt;
    const windowEnds = openedAt.getTime() + settings.priorityMinutes * 60_000;
    if (
      request.now.getTime() >= windowEnds ||
      startsAt.getTime() - request.now.getTime() <= settings.urgentWindowHours * 3_600_000 ||
      windowEnds >= startsAt.getTime()
    ) {
      continue;
    }
    waiting.push({
      id: f.id,
      role: f.role,
      week: weekOf(localDateOf(startsAt, firm.timezone), firm.timezone),
      openedAt,
      startsAt,
    });
  }
  if (waiting.length === 0) return out;

  // Everyone already on each waiting shift (they don't count towards its cutoff).
  const { rows: holders } = await tx.execute<{ shift_id: string; worker_id: string }>(sql`
    select a.shift_id::text as shift_id, a.worker_id::text as worker_id
      from assignments a
     where a.shift_id in (${sql.join(
       waiting.map((w) => sql`${w.id}::uuid`),
       sql`, `,
     )})
       and a.worker_id is not null and a.status not in (${CANCELLED})
  `);
  // One week's hours per role and week, for every active worker with the role and this worker.
  const hoursFor = new Map<string, Map<string, number>>();
  for (const w of waiting) {
    const key = `${w.role}|${w.week.from}`;
    if (hoursFor.has(key)) continue;
    const { rows } = await tx.execute<{ worker_id: string; hours: string | number }>(sql`
      select w.id::text as worker_id, coalesce(booked.hours, 0) as hours
        from workers w
        left join (
          select a.worker_id, sum(extract(epoch from (s2.ends_at - s2.starts_at)) / 3600) as hours
            from assignments a
            join shifts s2 on s2.firm_id = a.firm_id and s2.id = a.shift_id
           where a.status in (${BOOKED}) and s2.status <> 'cancelled'
             and s2.starts_at >= ${new Date(w.week.from)} and s2.starts_at < ${new Date(w.week.to)}
           group by a.worker_id
        ) booked on booked.worker_id = w.id
       where w.id = ${request.workerId} or (w.status = 'active' and ${w.role} = any (w.roles))
    `);
    hoursFor.set(key, new Map(rows.map((r) => [r.worker_id, Number(r.hours)])));
  }
  for (const w of waiting) {
    const all = hoursFor.get(`${w.role}|${w.week.from}`) ?? new Map<string, number>();
    const on = new Set(holders.filter((h) => h.shift_id === w.id).map((h) => h.worker_id));
    // As weeklyHours: this worker, and every other active worker with the role not on the shift.
    const hours = new Map<string, number>();
    for (const [id, h] of all) if (id === request.workerId || !on.has(id)) hours.set(id, h);
    out.set(
      w.id,
      allocationGate({
        mode: settings.mode,
        now: request.now,
        openedAt: w.openedAt,
        priorityMinutes: settings.priorityMinutes,
        workerHours: hours.get(request.workerId) ?? 0,
        cutoffHours: fairRotationCutoff([...hours.values()], settings.groupSize),
      }),
    );
  }
  return out;
}
