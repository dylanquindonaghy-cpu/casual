import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  assignments,
  credentialRules,
  credentials,
  credentialTypes,
  shifts,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { localDateOf } from "../time/zoned";
import {
  listQualifications,
  needsUpdating,
  rightToWork,
  type NeedsItem,
  type Qualification,
} from "./status";

// Casuals' qualifications as they stand now (12F.1; src/lib/credentials/status.ts has the rules),
// for many casuals at once: the casual's own Profile and My shifts, and the office's Casuals pages.
// A fixed number of queries however many casuals (their roles, the firm's rules and type names,
// their records, their confirmed bookings ahead). Inside the firm's transaction; reads only.

export interface CasualQualifications {
  qualifications: Qualification[];
  rightToWork: { checked: boolean; checkedOn: string | null };
  needs: NeedsItem[];
}

export async function qualificationsFor(
  tx: FirmTx,
  workerIds: readonly string[],
  o: { now: Date; timeZone: string },
): Promise<Map<string, CasualQualifications>> {
  const result = new Map<string, CasualQualifications>();
  const ids = [...new Set(workerIds)];
  if (ids.length === 0) return result;
  const today = localDateOf(o.now, o.timeZone);
  const people = await tx
    .select({ id: workers.id, roles: workers.roles })
    .from(workers)
    .where(inArray(workers.id, ids));
  const rules = await tx
    .select({ role: credentialRules.role, requiredTypes: credentialRules.requiredTypes })
    .from(credentialRules);
  const names = new Map(
    (
      await tx
        .select({ code: credentialTypes.code, name: credentialTypes.name })
        .from(credentialTypes)
    ).map((t) => [t.code, t.name]),
  );
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
  for (const person of people) {
    const mine = records
      .filter((r) => r.workerId === person.id)
      .map((r) => ({
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
    });
    result.set(person.id, {
      qualifications,
      rightToWork: rightToWork(mine),
      needs: needsUpdating({
        qualifications,
        bookings: bookings
          .filter((b) => b.workerId === person.id)
          .map((b) => ({
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
