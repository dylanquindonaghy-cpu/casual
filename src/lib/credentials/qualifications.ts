import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  assignments,
  credentialRules,
  credentials,
  credentialTypes,
  firms,
  shifts,
  uploads,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { rulesSettingsSchema } from "../roster/eligibility-input";
import { localDateOf } from "../time/zoned";
import { staffPhoto, type StaffPhoto } from "../uploads/photo";
import { photoSettings } from "../uploads/settings";
import {
  listQualifications,
  needsUpdating,
  rightToWork,
  rolesWithoutRule,
  type NeedsItem,
  type Qualification,
  type RightToWork,
} from "./status";

// Casuals' qualifications and staff photos as they stand now (12F.1, 12F.2;
// src/lib/credentials/status.ts and src/lib/uploads/photo.ts have the rules), for many casuals at
// once: the casual's own Profile and My shifts, and the office's Casuals pages. A fixed number of
// queries however many casuals (their roles, the firm's rules, type names and settings, their
// records with the upload each came from, their photos, their confirmed bookings ahead). Image
// bytes are never read here. Inside the firm's transaction; reads only.

export interface CasualQualifications {
  qualifications: Qualification[];
  rightToWork: RightToWork;
  needs: NeedsItem[];
  rolesWithoutRule: string[]; // her roles the firm has no rule for: those shifts can't be taken
  photo: StaffPhoto;
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
    .select({
      role: credentialRules.role,
      requiredTypes: credentialRules.requiredTypes,
      anyOfTypes: credentialRules.anyOfTypes,
    })
    .from(credentialRules);
  const types = await tx
    .select({
      code: credentialTypes.code,
      name: credentialTypes.name,
      appliedAllowed: credentialTypes.appliedAllowed,
      officeRecorded: credentialTypes.officeRecorded,
    })
    .from(credentialTypes);
  // The firm's own word on which types only the office records (the packs' list holds as well).
  const officeOnly = new Set(types.filter((t) => t.officeRecorded).map((t) => t.code));
  const uploadable = (type: string) => !officeOnly.has(type);
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
  const { renewalMonths } = photoSettings(firm?.settings ?? {});
  // Each record with the upload it came from (when it was sent; why it was turned down).
  const records = await tx
    .select({
      workerId: credentials.workerId,
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
      verifiedAt: credentials.verifiedAt,
      checkState: credentials.checkState,
      uploadId: uploads.id,
      sentAt: uploads.createdAt,
      reason: credentials.rejectedReason,
    })
    .from(credentials)
    .leftJoin(
      uploads,
      and(eq(uploads.firmId, credentials.firmId), eq(uploads.id, credentials.evidenceUploadId)),
    )
    .where(inArray(credentials.workerId, ids))
    .orderBy(asc(credentials.type));
  // Their photos, waiting or approved (a turned-down one changes nothing): never the bytes.
  const photos = await tx
    .select({
      workerId: uploads.workerId,
      id: uploads.id,
      status: uploads.status,
      uploadedAt: uploads.createdAt,
    })
    .from(uploads)
    .where(
      and(
        inArray(uploads.workerId, ids),
        eq(uploads.kind, "photo"),
        ne(uploads.status, "rejected"),
      ),
    );
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
  const photosOf = groupBy(photos, (p) => p.workerId);
  const bookingsOf = groupBy(bookings, (b) => b.workerId ?? "");
  for (const person of people) {
    const mine = (recordsOf.get(person.id) ?? []).map((r) => ({
      type: r.type,
      status: r.status,
      expiresOn: r.expiresOn,
      checkedOn: r.verifiedAt ? localDateOf(r.verifiedAt, o.timeZone) : null,
      checkState: r.checkState,
      upload:
        r.uploadId && r.sentAt
          ? { id: r.uploadId, sentOn: localDateOf(r.sentAt, o.timeZone), reason: r.reason }
          : null,
    }));
    const qualifications = listQualifications({
      roles: person.roles,
      rules,
      names,
      records: mine,
      today,
      appliedCounts,
      uploadable,
    });
    result.set(person.id, {
      qualifications,
      rightToWork: rightToWork(mine, today),
      rolesWithoutRule: rolesWithoutRule(person.roles, rules),
      photo: staffPhoto(
        (photosOf.get(person.id) ?? []).map((p) => ({
          id: p.id,
          status: p.status,
          uploadedAt: p.uploadedAt,
          uploadedOn: localDateOf(p.uploadedAt, o.timeZone),
        })),
        today,
        renewalMonths,
      ),
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
