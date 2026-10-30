import { and, eq, inArray, sql } from "drizzle-orm";
import { readRequirements, requirementChip, type Requirement } from "../credentials/requirements";
import { bestOfGroup, qualificationStatus, type QualificationState } from "../credentials/status";
import { credentials, firms, uploads, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { casualMayUpload } from "../rules/packs";
import { orList } from "../rules/reasons";
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
  // A one-of group she holds none of (P3.3; 25.2): any one of these will do, so its name and chip
  // say "A or B", and she may send whichever she has.
  anyOf?: { code: string; name: string; chip: string; uploadable: boolean }[];
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
  strikesOn: boolean; // strikes.enabled: off, no strike note under Take shift (P3.4)
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
  const shown = reader.of(session.role, session.requiredCredentials);
  // The role's one-of group (P3.3): every type of it is read, so the one that stands best for her
  // is shown in place of its first (unless the session asks for that one outright).
  const group = reader.groupOf(session.role);
  const codes = [...new Set([...shown.map((r) => r.code), ...group])];
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
  const stateOf = (code: string) =>
    qualificationStatus(
      records
        .filter((x) => x.type === code)
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
  const first = group[0];
  const best = bestOfGroup(group, stateOf);
  const needed =
    first && best && best !== first && !session.requiredCredentials.includes(first)
      ? shown.map((r) =>
          r.code === first && !shown.some((s) => s.code === best)
            ? { code: best, name: reader.nameOf(best) }
            : r,
        )
      : shown;
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
      const { status, expiresOn, waiting } = stateOf(r.code);
      const uploadable = (code: string) =>
        reader.rolesNeed(myRoles, code) && !reader.officeRecorded(code) && casualMayUpload(code);
      // The group's first type standing in for a group she holds none of: say all of it.
      // Not when the session asks for one of them outright: then that one must be held.
      const noneHeld =
        group.length > 1 &&
        r.code === first &&
        !group.some((code) => session.requiredCredentials.includes(code)) &&
        group.every((code) => stateOf(code).status === "missing");
      if (noneHeld) {
        const anyOf = group.map((code) => {
          const one = { code, name: reader.nameOf(code) };
          return { ...one, chip: requirementChip(one), uploadable: uploadable(code) };
        });
        return {
          code: r.code,
          name: orList(anyOf.map((a) => a.name)),
          chip: orList(anyOf.map((a) => a.chip)),
          status: { status, expiresOn, renewing: false },
          uploadable: anyOf.some((a) => a.uploadable),
          anyOf,
        };
      }
      return {
        ...r,
        chip: requirementChip(r),
        status: { status, expiresOn, renewing: waiting !== null },
        uploadable: uploadable(r.code),
      };
    }),
    noticeHours: strikeSettings(firm?.settings ?? {}).noticeHours,
    strikesOn: strikeSettings(firm?.settings ?? {}).enabled,
    // A shift ending at midnight doesn't touch the next day.
    lastDay: localDateOf(new Date(session.endsAt.getTime() - 1), zone),
  };
}
