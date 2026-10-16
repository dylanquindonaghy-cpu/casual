import { and, eq, inArray, sql } from "drizzle-orm";
import { readRequirements, requirementChip, type Requirement } from "../credentials/requirements";
import { qualificationStatus, type QualificationState } from "../credentials/status";
import { credentials, firms, uploads, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { casualMayUpload } from "../rules/packs";
import { strikeSettings } from "../strikes/settings";
import { localDateOf } from "../time/zoned";
import type { TravelFacts } from "../travel/line-copy";
import { travelFor } from "../travel/lines";
import { travelSettings } from "../travel/settings";

// A shift's page in full (docs/office-v2.md 4.4; 12H.2), for the casual it's shown to: the session's
// own facts, how she'd get there, what it needs with her status for each (read as Profile reads
// it: qualificationStatus()), and the firm's notice for a strike. Inside the firm's transaction;
// reads only. Whether she may take it stays the rules engine's (previewBooking): this only shows.

export interface ShiftRequirement extends Requirement {
  chip: string; // "SIA DS", "CSAS"
  // Her status, and whether her new one is waiting for the office (a renewal on its way).
  status: Pick<QualificationState, "status" | "expiresOn"> & { renewing: boolean };
  // She may send it herself: one of her roles needs it (the upload page and saveMyUpload() take
  // only those) and the office doesn't record it itself.
  uploadable: boolean;
}

export interface ShiftFacts {
  eventName: string | null; // as the casual app names it (null for an automatic event)
  payRatePence: number | null;
  post: string | null;
  meetingPoint: string | null;
  uniform: string | null;
  isUrgent: boolean;
  headcount: number;
  travel?: TravelFacts; // none where the firm has travel areas off (13.4)
  requirements: ShiftRequirement[];
  noticeHours: number; // strikes.notice_hours
  lastDay: string; // yyyy-mm-dd, the firm's calendar: the last day the shift touches
}

export async function shiftFacts(
  tx: FirmTx,
  o: {
    shiftId: string;
    workerId: string;
    now: Date;
    session: {
      role: string;
      endsAt: Date;
      requiredCredentials: readonly string[];
      eventName: string | null;
      payRatePence: number | null;
      post: string | null;
      meetingPoint: string | null;
      uniform: string | null;
      isUrgent: boolean;
      headcount: number;
    };
  },
): Promise<ShiftFacts> {
  const { session } = o;
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const zone = firm?.timezone ?? "Europe/London";
  const today = localDateOf(o.now, zone);
  const [me] = await tx
    .select({ roles: workers.roles })
    .from(workers)
    .where(eq(workers.id, o.workerId));
  const myRoles = me?.roles ?? [];
  const reader = await readRequirements(tx, [session.role, ...myRoles]);
  const needed = reader.of(session.role, session.requiredCredentials);
  const codes = needed.map((r) => r.code);
  const records = codes.length
    ? await tx
        .select({
          type: credentials.type,
          status: credentials.status,
          expiresOn: credentials.expiresOn,
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
        .where(and(eq(credentials.workerId, o.workerId), inArray(credentials.type, codes)))
    : [];
  const travel: TravelFacts | undefined = travelSettings(firm?.settings ?? {}).enabled
    ? ((await travelFor(tx, o.workerId, [o.shiftId])).get(o.shiftId) ?? { kind: "unknown" })
    : undefined;
  return {
    eventName: session.eventName,
    payRatePence: session.payRatePence,
    post: session.post,
    meetingPoint: session.meetingPoint,
    uniform: session.uniform,
    isUrgent: session.isUrgent,
    headcount: session.headcount,
    ...(travel ? { travel } : {}),
    requirements: needed.map((r) => {
      const { status, expiresOn, waiting } = qualificationStatus(
        records
          .filter((x) => x.type === r.code)
          .map((x) => ({
            status: x.status,
            expiresOn: x.expiresOn,
            checkState: x.checkState,
            upload:
              x.uploadId && x.sentAt
                ? { id: x.uploadId, sentOn: localDateOf(x.sentAt, zone), reason: x.reason }
                : null,
          })),
        today,
      );
      return {
        ...r,
        chip: requirementChip(r),
        status: { status, expiresOn, renewing: waiting !== null },
        uploadable:
          reader.rolesNeed(myRoles, r.code) &&
          !reader.officeRecorded(r.code) &&
          casualMayUpload(r.code),
      };
    }),
    noticeHours: strikeSettings(firm?.settings ?? {}).noticeHours,
    // A shift ending at midnight doesn't touch the next day.
    lastDay: localDateOf(new Date(session.endsAt.getTime() - 1), zone),
  };
}
