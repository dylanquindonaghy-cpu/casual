import { and, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { DAY } from "../auth/clock";
import {
  assignments,
  credentialRules,
  credentials,
  credentialTypes,
  firms,
  shifts,
  workers,
  workerUnavailableDays,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { EligibilityInput, OverridableCode } from "../rules/eligibility";
import { addDays, localDateOf, zonedToUtc } from "../time/zoned";

// Builds the rules engine's input (docs/rules-and-credentials.md, "Function shape") for one worker
// and one shift from the firm's rows, inside the caller's withFirm transaction. The rules decide;
// this only reads (golden rule 1). Locking is the caller's (checkBooking in book.ts).
//
// - The role's credential rule, or null when the firm has none (the rules then fail closed).
// - The worker's other bookings (confirmed or completed, on shifts that aren't cancelled) from a
//   week and a day before this shift to a week and a day after it: enough for overlap, rest and
//   every Monday-Sunday week the shift touches. Never this shift itself.
// - Credential names and the types where "applied" may count, from the firm's credential_types.
// - The day's deployed and "applied" counts for the allowance, never counting this worker.
// - The firm's rules settings, with the doc's defaults; a value that makes no sense throws (a
//   misconfigured firm must never loosen a rule by accident).
// - The days the worker marked unavailable (the profile page), from the day before the shift's
//   local start date to the day after its end (the rules check the days it touches). No
//   blocked-site store exists yet (Phase 5 office): an empty list until then.

export const BOOKED_STATUSES = ["confirmed", "completed"] as const;
const NEARBY_MS = 8 * DAY;

export const rulesSettingsSchema = z.object({
  min_rest_hours: z.number().min(0).max(48).default(11),
  weekly_hours_cap: z.number().positive().max(168).default(48),
  travel_buffer_minutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(0),
  credential_applied_allowance_pct: z.number().min(0).max(100).default(0),
});

// The firm's rules settings don't make sense: no booking can be checked until they are fixed.
export class RulesSettingsError extends Error {
  constructor() {
    super("the firm's rules settings are invalid");
    this.name = "RulesSettingsError";
  }
}

export async function loadEligibilityInput(
  tx: FirmTx,
  request: { shiftId: string; workerId: string; now: Date; overrides?: OverridableCode[] },
): Promise<EligibilityInput | null> {
  const { shiftId, workerId, now } = request;
  const [shift] = await tx
    .select({
      id: shifts.id,
      firmId: shifts.firmId,
      role: shifts.role,
      siteId: shifts.siteId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
    })
    .from(shifts)
    .where(eq(shifts.id, shiftId));
  const [worker] = await tx
    .select({ id: workers.id, status: workers.status, roles: workers.roles })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!shift || !worker) return null;

  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, shift.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  const parsed = rulesSettingsSchema.safeParse(firm.settings);
  if (!parsed.success) throw new RulesSettingsError();
  const settings = parsed.data;

  const held = await tx
    .select({
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
    })
    .from(credentials)
    .where(eq(credentials.workerId, workerId));
  const [rule] = await tx
    .select({ requiredTypes: credentialRules.requiredTypes })
    .from(credentialRules)
    .where(eq(credentialRules.role, shift.role));
  const types = await tx
    .select({
      code: credentialTypes.code,
      name: credentialTypes.name,
      appliedAllowed: credentialTypes.appliedAllowed,
    })
    .from(credentialTypes);

  const others = await tx
    .select({ shiftId: shifts.id, startsAt: shifts.startsAt, endsAt: shifts.endsAt })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .where(
      and(
        eq(assignments.workerId, workerId),
        inArray(assignments.status, [...BOOKED_STATUSES]),
        ne(shifts.id, shiftId),
        ne(shifts.status, "cancelled"),
        gt(shifts.endsAt, new Date(shift.startsAt.getTime() - NEARBY_MS)),
        lt(shifts.startsAt, new Date(shift.endsAt.getTime() + NEARBY_MS)),
      ),
    );

  const firstDay = localDateOf(shift.startsAt, firm.timezone);
  const lastDay = localDateOf(new Date(shift.endsAt.getTime() - 1), firm.timezone);
  const unavailable = await tx
    .select({ day: workerUnavailableDays.day })
    .from(workerUnavailableDays)
    .where(
      and(
        eq(workerUnavailableDays.workerId, workerId),
        gte(workerUnavailableDays.day, addDays(firstDay, -1)),
        lte(workerUnavailableDays.day, addDays(lastDay, 1)),
      ),
    );

  const counts = await deployedThatDay(tx, {
    workerId,
    startsAt: shift.startsAt,
    timeZone: firm.timezone,
  });

  return {
    now,
    timeZone: firm.timezone,
    worker: { id: worker.id, status: worker.status, roles: [...worker.roles] },
    credentials: held,
    shift: {
      id: shift.id,
      role: shift.role,
      siteId: shift.siteId,
      requiredTypes: rule ? [...rule.requiredTypes] : null,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    },
    otherAssignments: others,
    unavailableDates: unavailable.map((u) => u.day),
    settings: {
      minRestHours: settings.min_rest_hours,
      weeklyHoursCap: settings.weekly_hours_cap,
      travelBufferMinutes: settings.travel_buffer_minutes,
      appliedAllowancePct: settings.credential_applied_allowance_pct,
      appliedAllowedTypes: types.filter((t) => t.appliedAllowed).map((t) => t.code),
      appliedInUseCount: counts.applied,
      deployedCount: counts.deployed,
      blockedSites: [],
    },
    names: Object.fromEntries(types.map((t) => [t.code, t.name])),
    ...(request.overrides?.length ? { overrides: request.overrides } : {}),
  };
}

// Everyone else booked on a shift starting the same local day as this one, and how many of them
// are working on an application in progress: a type their shift's role needs, that may count
// "applied", held as applied with no valid one in date that day.
async function deployedThatDay(
  tx: FirmTx,
  at: { workerId: string; startsAt: Date; timeZone: string },
): Promise<{ deployed: number; applied: number }> {
  const day = localDateOf(at.startsAt, at.timeZone);
  const wall = (date: string) => {
    const [year = 2000, month = 1, d = 1] = date.split("-").map(Number);
    return zonedToUtc({ year, month, day: d, hour: 0, minute: 0 }, at.timeZone);
  };
  const from = wall(day);
  const to = wall(addDays(day, 1));
  const booked = sql.raw(BOOKED_STATUSES.map((s) => `'${s}'`).join(", "));
  const { rows } = await tx.execute<{ deployed: number; applied: number }>(sql`
    select count(distinct a.worker_id)::int as deployed,
           count(distinct a.worker_id) filter (where exists (
             select 1
               from credential_rules r
               join credentials c
                 on c.firm_id = r.firm_id and c.worker_id = a.worker_id
                and c.status = 'applied' and c.type = any (r.required_types)
               join credential_types t
                 on t.firm_id = c.firm_id and t.code = c.type and t.applied_allowed
              where r.firm_id = s.firm_id and r.role = s.role
                and not exists (
                  select 1 from credentials v
                   where v.firm_id = c.firm_id and v.worker_id = c.worker_id and v.type = c.type
                     and v.status = 'valid' and (v.expires_on is null or v.expires_on >= ${day}::date))
           ))::int as applied
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
     where a.worker_id is not null and a.worker_id <> ${at.workerId}
       and a.status in (${booked})
       and s.status <> 'cancelled'
       and s.starts_at >= ${from} and s.starts_at < ${to}
  `);
  const row = rows[0];
  return { deployed: Number(row?.deployed ?? 0), applied: Number(row?.applied ?? 0) };
}
