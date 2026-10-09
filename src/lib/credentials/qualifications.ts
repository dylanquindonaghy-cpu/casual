import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  assignments,
  credentialRules,
  credentials,
  credentialTypes,
  firms,
  shifts,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { rulesSettingsSchema } from "../roster/eligibility-input";
import { localDateOf } from "../time/zoned";
import {
  listQualifications,
  needsUpdating,
  rightToWork,
  rolesWithoutRule,
  type NeedsItem,
  type Qualification,
  type RightToWork,
} from "./status";

// Casuals' qualifications as they stand now (12F.1; src/lib/credentials/status.ts has the rules),
// for many casuals at once: the casual's own Profile and My shifts, and the office's Casuals pages.
// A fixed number of queries however many casuals (their roles, the firm's rules and type names,
// their records, their confirmed bookings ahead). Inside the firm's transaction; reads only.

export interface CasualQualifications {
  qualifications: Qualification[];
  rightToWork: RightToWork;
  needs: NeedsItem[];
  rolesWithoutRule: string[]; // her roles the firm has no rule for: those shifts can't be taken
}

// `people`: the casuals' roles when the caller has them already (the office's list), so they
// aren't read twice.
export async function qualificationsFor(
  tx: FirmTx,
  workerIds: readonly string[],
  o: { now: Date; timeZone: string; people?: readonly { id: string; roles: readonly string[] }[] },
): Promise<Map<string, CasualQualifications>> {
  const result = new Map<string, CasualQualifications>();
  const ids = [...new Set(workerIds)];
  if (ids.length === 0) return result;
  const today = localDateOf(o.now, o.timeZone);
  const people =
    o.people ??
    (await tx
      .select({ id: workers.id, roles: workers.roles })
      .from(workers)
      .where(inArray(workers.id, ids)));
  const rules = await tx
    .select({ role: credentialRules.role, requiredTypes: credentialRules.requiredTypes })
    .from(credentialRules);
  const types = await tx
    .select({
      code: credentialTypes.code,
      name: credentialTypes.name,
      appliedAllowed: credentialTypes.appliedAllowed,
    })
    .from(credentialTypes);
  const names = new Map(types.map((t) => [t.code, t.name]));
  // An application in progress counts only as the rules engine counts it: a type that allows it,
  // at a firm with an allowance above 0 (src/lib/rules/eligibility.ts, check 4).
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const settings = rulesSettingsSchema.safeParse(firm?.settings ?? {});
  const allowance = settings.success ? settings.data.credential_applied_allowance_pct : 0;
  const appliedOk = new Set(types.filter((t) => t.appliedAllowed).map((t) => t.code));
  const appliedCounts = (type: string) => allowance > 0 && appliedOk.has(type);
  const records = await tx
    .select({
      workerId: credentials.workerId,
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
      verifiedAt: credentials.verifiedAt,
    })
    .from(credentials)
    .where(inArray(credentials.workerId, ids))
    .orderBy(asc(credentials.type));
  // Bookings still to finish: one in progress still needs its qualifications today.
  const bookings = await tx
    .select({
      workerId: assignments.workerId,
      role: shifts.role,
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
        inArray(assignments.workerId, ids),
        eq(assignments.status, "confirmed"),
        gt(shifts.endsAt, o.now),
        inArray(shifts.status, ["open", "filled"]),
      ),
    );
  // Each casual's own, grouped once (not filtered per casual: a firm may have thousands).
  const recordsOf = groupBy(records, (r) => r.workerId);
  const bookingsOf = groupBy(bookings, (b) => b.workerId ?? "");
  for (const person of people) {
    const mine = (recordsOf.get(person.id) ?? []).map((r) => ({
      type: r.type,
      status: r.status,
      expiresOn: r.expiresOn,
      checkedOn: r.verifiedAt ? localDateOf(r.verifiedAt, o.timeZone) : null,
    }));
    const qualifications = listQualifications({
      roles: person.roles,
      rules,
      names,
      records: mine,
      today,
      appliedCounts,
    });
    result.set(person.id, {
      qualifications,
      rightToWork: rightToWork(mine, today),
      rolesWithoutRule: rolesWithoutRule(person.roles, rules),
      needs: needsUpdating({
        qualifications,
        bookings: (bookingsOf.get(person.id) ?? []).map((b) => ({
          role: b.role,
          startDay: localDateOf(b.startsAt, o.timeZone),
          // The last day it touches: a shift ending at midnight doesn't touch the next day.
          endDay: localDateOf(new Date(b.endsAt.getTime() - 1), o.timeZone),
        })),
        today,
      }),
    });
  }
  return result;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}
