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
  workerSiteBlocks,
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
//   local start date to the day after its end (the rules check the days it touches).
// - Whether the office has blocked the worker from the shift's site (worker_site_blocks, Phase
//   10): the site's id in blockedSites if so, else none (rules check 9).

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
      requiredCredentials: shifts.requiredCredentials,
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
    // Checked records only (D3; 12F.2): a casual's upload counts once the office approves it.
    .where(and(eq(credentials.workerId, workerId), eq(credentials.checkState, "verified")));
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

  const blocked =
    shift.siteId === null
      ? []
      : await tx
          .select({ siteId: workerSiteBlocks.siteId })
          .from(workerSiteBlocks)
          .where(
            and(eq(workerSiteBlocks.workerId, workerId), eq(workerSiteBlocks.siteId, shift.siteId)),
          );

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
      extraTypes: [...shift.requiredCredentials],
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
      blockedSites: blocked.map((b) => b.siteId),
    },
    names: Object.fromEntries(types.map((t) => [t.code, t.name])),
    ...(request.overrides?.length ? { overrides: request.overrides } : {}),
  };
}

// Everyone else booked on a shift starting the same local day as this one, and how many of them
// are working on an application in progress: a type their shift's role or the shift itself (its
// extra requirements) needs, that may count "applied", held as applied with no valid one in date
// that day.
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
               from credentials c
               join credential_types t
                 on t.firm_id = c.firm_id and t.code = c.type and t.applied_allowed
              where c.firm_id = s.firm_id and c.worker_id = a.worker_id and c.status = 'applied'
                and c.check_state = 'verified'
                and (c.type = any (s.required_credentials)
                  or exists (select 1 from credential_rules r
                              where r.firm_id = s.firm_id and r.role = s.role
                                and c.type = any (r.required_types)))
                and not exists (
                  select 1 from credentials v
                   where v.firm_id = c.firm_id and v.worker_id = c.worker_id and v.type = c.type
                     and v.status = 'valid' and v.check_state = 'verified'
                     and (v.expires_on is null or v.expires_on >= ${day}::date))
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

// The same input for many pairs at once, with a fixed number of queries however many shifts or
// workers there are: Open shifts and the urgent board (one worker, up to 50 shifts) and the offer
// candidate list (one shift, every worker with the role). Shared reads (the shifts, the firm, the
// rules, the types) happen once; each worker's rows are read for all of them together and split
// per pair. The day's deployed and "applied" counts are read only when the firm's applied
// allowance is above 0 (otherwise they can't change a verdict: eligibility.ts). Bookings use the
// single loader above, under their locks; tests/integration/eligibility.batch.test.ts holds the
// two to the same verdicts, pair for pair.
export const pairKey = (shiftId: string, workerId: string) => `${shiftId}|${workerId}`;

export async function loadEligibilityInputs(
  tx: FirmTx,
  batch: { shiftIds: string[]; workerIds: string[]; now: Date },
): Promise<Map<string, EligibilityInput>> {
  const out = new Map<string, EligibilityInput>();
  const shiftIds = [...new Set(batch.shiftIds)];
  const workerIds = [...new Set(batch.workerIds)];
  if (shiftIds.length === 0 || workerIds.length === 0) return out;

  const shiftRows = await tx
    .select({
      id: shifts.id,
      firmId: shifts.firmId,
      role: shifts.role,
      siteId: shifts.siteId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      requiredCredentials: shifts.requiredCredentials,
    })
    .from(shifts)
    .where(inArray(shifts.id, shiftIds));
  const workerRows = await tx
    .select({ id: workers.id, status: workers.status, roles: workers.roles })
    .from(workers)
    .where(inArray(workers.id, workerIds));
  const first = shiftRows[0];
  if (!first || workerRows.length === 0) return out;

  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, first.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  const parsed = rulesSettingsSchema.safeParse(firm.settings);
  if (!parsed.success) throw new RulesSettingsError();
  const settings = parsed.data;
  const zone = firm.timezone;
  const presentWorkers = workerRows.map((w) => w.id);

  const held = await tx
    .select({
      workerId: credentials.workerId,
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
    })
    .from(credentials)
    // Checked records only (D3; 12F.2).
    .where(
      and(inArray(credentials.workerId, presentWorkers), eq(credentials.checkState, "verified")),
    );
  const roles = [...new Set(shiftRows.map((s) => s.role))];
  const rules = await tx
    .select({ role: credentialRules.role, requiredTypes: credentialRules.requiredTypes })
    .from(credentialRules)
    .where(inArray(credentialRules.role, roles));
  const types = await tx
    .select({
      code: credentialTypes.code,
      name: credentialTypes.name,
      appliedAllowed: credentialTypes.appliedAllowed,
    })
    .from(credentialTypes);

  const earliest = Math.min(...shiftRows.map((s) => s.startsAt.getTime()));
  const latest = Math.max(...shiftRows.map((s) => s.endsAt.getTime()));
  const others = await tx
    .select({
      workerId: assignments.workerId,
      shiftId: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
    })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .where(
      and(
        inArray(assignments.workerId, presentWorkers),
        inArray(assignments.status, [...BOOKED_STATUSES]),
        ne(shifts.status, "cancelled"),
        gt(shifts.endsAt, new Date(earliest - NEARBY_MS)),
        lt(shifts.startsAt, new Date(latest + NEARBY_MS)),
      ),
    );

  const daysOf = (s: { startsAt: Date; endsAt: Date }) => ({
    first: localDateOf(s.startsAt, zone),
    last: localDateOf(new Date(s.endsAt.getTime() - 1), zone),
  });
  const spans = shiftRows.map(daysOf);
  const unavailable = await tx
    .select({ workerId: workerUnavailableDays.workerId, day: workerUnavailableDays.day })
    .from(workerUnavailableDays)
    .where(
      and(
        inArray(workerUnavailableDays.workerId, presentWorkers),
        gte(workerUnavailableDays.day, addDays(spans.map((d) => d.first).sort()[0] ?? "", -1)),
        lte(
          workerUnavailableDays.day,
          addDays(
            spans
              .map((d) => d.last)
              .sort()
              .at(-1) ?? "",
            1,
          ),
        ),
      ),
    );

  // The batch's workers blocked from the batch's sites.
  const siteIds = [...new Set(shiftRows.flatMap((s) => (s.siteId === null ? [] : [s.siteId])))];
  const blocks =
    siteIds.length === 0
      ? []
      : await tx
          .select({ workerId: workerSiteBlocks.workerId, siteId: workerSiteBlocks.siteId })
          .from(workerSiteBlocks)
          .where(
            and(
              inArray(workerSiteBlocks.workerId, presentWorkers),
              inArray(workerSiteBlocks.siteId, siteIds),
            ),
          );
  const blockedAt = new Set(blocks.map((b) => `${b.workerId}|${b.siteId}`));

  // Who is booked each local day a batch shift starts on, and whether each is there on an
  // application in progress: only needed when "applied" can count at this firm.
  const booked = new Map<string, { all: Set<string>; applied: Set<string> }>();
  if (settings.credential_applied_allowance_pct > 0) {
    const days = [...new Set(spans.map((d) => d.first))];
    for (const d of days) booked.set(d, { all: new Set(), applied: new Set() });
    for (const row of await bookedOnDays(tx, days, zone)) {
      const day = booked.get(row.day);
      if (!day) continue;
      day.all.add(row.worker_id);
      if (row.applied) day.applied.add(row.worker_id);
    }
  }

  const ruleOf = new Map(rules.map((r) => [r.role, [...r.requiredTypes]]));
  const appliedAllowedTypes = types.filter((t) => t.appliedAllowed).map((t) => t.code);
  const names = Object.fromEntries(types.map((t) => [t.code, t.name]));
  for (const shift of shiftRows) {
    const span = daysOf(shift);
    const day = booked.get(span.first);
    for (const worker of workerRows) {
      const without = (set: Set<string> | undefined) =>
        set ? set.size - (set.has(worker.id) ? 1 : 0) : 0;
      out.set(pairKey(shift.id, worker.id), {
        now: batch.now,
        timeZone: zone,
        worker: { id: worker.id, status: worker.status, roles: [...worker.roles] },
        credentials: held
          .filter((c) => c.workerId === worker.id)
          .map((c) => ({ type: c.type, status: c.status, expiresOn: c.expiresOn })),
        shift: {
          id: shift.id,
          role: shift.role,
          siteId: shift.siteId,
          requiredTypes: ruleOf.get(shift.role) ?? null,
          extraTypes: [...shift.requiredCredentials],
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
        },
        otherAssignments: others
          .filter(
            (o) =>
              o.workerId === worker.id &&
              o.shiftId !== shift.id &&
              o.endsAt.getTime() > shift.startsAt.getTime() - NEARBY_MS &&
              o.startsAt.getTime() < shift.endsAt.getTime() + NEARBY_MS,
          )
          .map((o) => ({ shiftId: o.shiftId, startsAt: o.startsAt, endsAt: o.endsAt })),
        unavailableDates: unavailable
          .filter(
            (u) =>
              u.workerId === worker.id &&
              u.day >= addDays(span.first, -1) &&
              u.day <= addDays(span.last, 1),
          )
          .map((u) => u.day),
        settings: {
          minRestHours: settings.min_rest_hours,
          weeklyHoursCap: settings.weekly_hours_cap,
          travelBufferMinutes: settings.travel_buffer_minutes,
          appliedAllowancePct: settings.credential_applied_allowance_pct,
          appliedAllowedTypes,
          appliedInUseCount: without(day?.applied),
          deployedCount: without(day?.all),
          blockedSites:
            shift.siteId !== null && blockedAt.has(`${worker.id}|${shift.siteId}`)
              ? [shift.siteId]
              : [],
        },
        names,
      });
    }
  }
  return out;
}

// Everyone booked on a shift starting on each of these local days, and whether they're there on an
// application in progress (the same test as deployedThatDay above, per worker and day).
async function bookedOnDays(
  tx: FirmTx,
  days: string[],
  timeZone: string,
): Promise<{ day: string; worker_id: string; applied: boolean }[]> {
  if (days.length === 0) return [];
  const sorted = [...days].sort();
  const wall = (date: string) => {
    const [year = 2000, month = 1, d = 1] = date.split("-").map(Number);
    return zonedToUtc({ year, month, day: d, hour: 0, minute: 0 }, timeZone);
  };
  const from = wall(sorted[0] ?? "");
  const to = wall(addDays(sorted.at(-1) ?? "", 1));
  const booked = sql.raw(BOOKED_STATUSES.map((s) => `'${s}'`).join(", "));
  const { rows } = await tx.execute<{ day: string; worker_id: string; applied: boolean }>(sql`
    select x.day, x.worker_id, bool_or(x.applied) as applied from (
      select to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
             a.worker_id::text as worker_id,
             exists (
               select 1
                 from credentials c
                 join credential_types t
                   on t.firm_id = c.firm_id and t.code = c.type and t.applied_allowed
                where c.firm_id = s.firm_id and c.worker_id = a.worker_id and c.status = 'applied'
                  and c.check_state = 'verified'
                  and (c.type = any (s.required_credentials)
                    or exists (select 1 from credential_rules r
                                where r.firm_id = s.firm_id and r.role = s.role
                                  and c.type = any (r.required_types)))
                  and not exists (
                    select 1 from credentials v
                     where v.firm_id = c.firm_id and v.worker_id = c.worker_id and v.type = c.type
                       and v.status = 'valid' and v.check_state = 'verified'
                       and (v.expires_on is null
                            or v.expires_on >= (s.starts_at at time zone ${timeZone})::date))
             ) as applied
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
       where a.worker_id is not null and a.status in (${booked})
         and s.status <> 'cancelled'
         and s.starts_at >= ${from} and s.starts_at < ${to}
    ) x
    where x.day in (${sql.join(
      sorted.map((d) => sql`${d}`),
      sql`, `,
    )})
    group by x.day, x.worker_id
  `);
  return rows;
}
