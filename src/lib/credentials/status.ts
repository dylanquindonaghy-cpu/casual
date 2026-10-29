import type { CheckState, RejectReason } from "../db/schema";
import { casualMayUpload } from "../rules/packs";
import { daysUntil, EXPIRING_SOON_DAYS } from "./expiry";

// A casual's qualifications as they stand today (docs/office-v2.md 3.7, 4.2, 4.6; Rules 15; 12F.1,
// 12F.2). Pure: records and dates in, statuses out. The same reading as the rules engine
// (docs/rules-and-credentials.md): only checked records count (D3: the office's own, or an upload a
// named person approved); a suspended one fails whatever else is held; otherwise a valid one in
// date counts; an applied one is being processed; anything else has expired.
//
// - qualificationStatus(): one type's records → Valid, Expiring soon (within EXPIRING_SOON_DAYS),
//   Being checked (her upload is waiting for the office), Not accepted (the office turned her latest
//   upload down, with a reason), Applied for, Expired, Missing (no record) or Suspended. An upload
//   never counts until it's checked: a waiting renewal of a record still in date shows that record
//   (renewing), and an upload never hides a suspension.
// - listQualifications(): every type one of her roles needs (the firm's rules), with the roles that
//   need it, worst first. A type nothing needs isn't listed. Right to work is a status only
//   (rightToWork()), never in the list.
// - needsUpdating(): what she should sort out, in §4.2's order: (1) blocks a booked shift (expired,
//   suspended, missing, not accepted or still being checked, applied for where the firm's rules won't
//   accept it, or expiring before the shift ends); (2) expired, suspended or not accepted; (3)
//   expiring soon, unless she's already applied or sent a renewal; (4) missing. One being checked
//   is otherwise for the office, not her. (The staff photo has its own status: src/lib/uploads/
//   photo.ts.)
// - rolesWithoutRule(): her roles the firm has no rule for: the rules engine refuses those shifts
//   (fail closed), so nothing may say her roles "need none".

export const RIGHT_TO_WORK = "RTW";

export type QualificationStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "missing"
  | "applied"
  | "suspended"
  | "being_checked"
  | "rejected";

// Her upload a record came from (a certificate image), when it was sent, and why it wasn't
// accepted (rejected records only).
export interface RecordUpload {
  id: string;
  sentOn: string; // yyyy-mm-dd, the firm's calendar
  reason?: RejectReason | null;
}

export interface CredentialRecord {
  status: "valid" | "expired" | "applied" | "suspended";
  expiresOn: string | null; // yyyy-mm-dd
  checkState?: CheckState; // default verified (the office's own)
  upload?: RecordUpload | null;
}

export interface QualificationState {
  status: QualificationStatus;
  // The date that goes with it: valid until / expires / expired on (null: no expiry, or none known).
  expiresOn: string | null;
  // The image behind the record that decides it (null: the office's own record, no image).
  evidenceUploadId: string | null;
  // Her upload waiting for the office, whatever the status (a renewal of one still in date too).
  waiting: { uploadId: string; sentOn: string } | null;
  // Not accepted: her latest upload, and why (only with that status).
  rejected: { uploadId: string; sentOn: string; reason: RejectReason } | null;
}

const checked = (r: CredentialRecord) => (r.checkState ?? "verified") === "verified";

const inDate = (r: CredentialRecord, today: string) =>
  checked(r) && r.status === "valid" && (r.expiresOn === null || r.expiresOn >= today);

// The longest-lasting first (no expiry lasts longest).
const lasting = (a: CredentialRecord, b: CredentialRecord) =>
  (b.expiresOn ?? "9999-12-31").localeCompare(a.expiresOn ?? "9999-12-31");

export function qualificationStatus(
  records: readonly CredentialRecord[],
  today: string,
): QualificationState {
  const office = records.filter(checked);
  const upload = (r: CredentialRecord | undefined) => r?.upload ?? null;
  const waitingRecord = records.find((r) => r.checkState === "waiting" && r.upload);
  const waiting = waitingRecord?.upload
    ? { uploadId: waitingRecord.upload.id, sentOn: waitingRecord.upload.sentOn }
    : null;
  const state = (
    status: QualificationStatus,
    expiresOn: string | null,
    from: CredentialRecord | undefined,
  ): QualificationState => ({
    status,
    expiresOn,
    evidenceUploadId: upload(from)?.id ?? null,
    waiting,
    rejected: null,
  });
  const suspended = office.find((r) => r.status === "suspended");
  if (suspended) return state("suspended", suspended.expiresOn, suspended);
  const best = office.filter((r) => inDate(r, today)).sort(lasting)[0];
  if (best) {
    const soon = best.expiresOn !== null && daysUntil(today, best.expiresOn) <= EXPIRING_SOON_DAYS;
    return state(soon ? "expiring_soon" : "valid", best.expiresOn, best);
  }
  if (waiting) return state("being_checked", null, undefined);
  // Her latest upload turned down: what she needs to know, ahead of an older record.
  const turnedDown = records
    .filter((r) => r.checkState === "rejected" && r.upload?.reason)
    .sort((a, b) => (b.upload?.sentOn ?? "").localeCompare(a.upload?.sentOn ?? ""))[0];
  if (turnedDown?.upload?.reason) {
    return {
      ...state("rejected", null, undefined),
      rejected: {
        uploadId: turnedDown.upload.id,
        sentOn: turnedDown.upload.sentOn,
        reason: turnedDown.upload.reason,
      },
    };
  }
  if (office.length === 0) return state("missing", null, undefined);
  const applied = office.find((r) => r.status === "applied");
  if (applied) return state("applied", null, applied);
  // Expired: marked so, or valid with its date gone. The latest date, if any has one.
  const dated = office.filter((r) => r.expiresOn !== null).sort(lasting)[0];
  return state("expired", dated?.expiresOn ?? null, dated ?? office[0]);
}

// Worst first: what stops her working (the office's word, then hers turned down), then what's
// missing or waiting for the office, then what's about to.
export const STATUS_ORDER: readonly QualificationStatus[] = [
  "suspended",
  "expired",
  "rejected",
  "missing",
  "being_checked",
  "expiring_soon",
  "applied",
  "valid",
];

export interface Qualification extends QualificationState {
  type: string;
  name: string; // as stored, mid-sentence ("first aid at work certificate")
  neededFor: string[]; // her roles that need it, sorted
  // Applied for: whether the rules engine may accept it (the type allows it and the firm's
  // allowance is above 0; the share is checked per shift). Otherwise it counts for nothing.
  appliedCounts: boolean;
  // In date, with a renewal on its way: an application in progress, or her new card waiting for
  // the office.
  renewing: boolean;
  // Whether she may upload it (not one the office records itself: src/lib/rules/packs.ts).
  uploadable: boolean;
}

export function listQualifications(o: {
  roles: readonly string[];
  // anyOfTypes: the rule's one-of group (P3.3), if it has one.
  rules: readonly {
    role: string;
    requiredTypes: readonly string[];
    anyOfTypes?: readonly string[];
  }[];
  names: ReadonlyMap<string, string>; // type code → name
  records: readonly ({ type: string } & CredentialRecord)[];
  today: string;
  appliedCounts?: (type: string) => boolean; // default: never (as with no allowance)
  // Whether she may upload it: the firm's types (office_recorded) and the packs' list together
  // (default: the packs' list alone).
  uploadable?: (type: string) => boolean;
}): Qualification[] {
  const rank = (s: QualificationStatus) => STATUS_ORDER.indexOf(s);
  const recordsOf = (type: string) => o.records.filter((r) => r.type === type);
  const needed = new Map<string, Set<string>>();
  for (const rule of o.rules) {
    if (!o.roles.includes(rule.role)) continue;
    // A one-of group (P3.3): the one of its types that stands best for her (the best status, then
    // the latest expiry; its first if she holds none), so she isn't told she's missing, or must
    // renew, the licence she doesn't need. A suspended one first, whatever else: the rules refuse
    // the group then (src/lib/rules/eligibility.ts).
    const group = rule.anyOfTypes ?? [];
    const suspended = (x: { state: { status: QualificationStatus } }) =>
      Number(x.state.status === "suspended");
    const best = group
      .map((type, i) => ({ type, i, state: qualificationStatus(recordsOf(type), o.today) }))
      .sort(
        (a, b) =>
          suspended(b) - suspended(a) ||
          rank(b.state.status) - rank(a.state.status) ||
          (b.state.expiresOn ?? "9999").localeCompare(a.state.expiresOn ?? "9999") ||
          a.i - b.i,
      )[0];
    for (const type of [...rule.requiredTypes, ...(best ? [best.type] : [])]) {
      if (type === RIGHT_TO_WORK) continue;
      const roles = needed.get(type) ?? new Set<string>();
      roles.add(rule.role);
      needed.set(type, roles);
    }
  }
  return [...needed]
    .map(([type, roles]) => {
      const records = recordsOf(type);
      const state = qualificationStatus(records, o.today);
      return {
        type,
        name: o.names.get(type) ?? type.replace(/_/g, " ").toLowerCase(),
        neededFor: [...roles].sort(),
        ...state,
        appliedCounts: o.appliedCounts?.(type) ?? false,
        renewing:
          (state.status === "valid" || state.status === "expiring_soon") &&
          (state.waiting !== null || records.some((r) => checked(r) && r.status === "applied")),
        uploadable: (o.uploadable ?? casualMayUpload)(type) && casualMayUpload(type),
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
}

// Right to work: a status only (Rules 15). Checked: a valid record in date; the date the office
// checked it when it recorded one. Expired: there was a check, but none is in date now (a
// time-limited right to work).
export interface RightToWork {
  checked: boolean;
  checkedOn: string | null;
  expired: boolean;
}

export function rightToWork(
  records: readonly ({ type: string; checkedOn: string | null } & CredentialRecord)[],
  today: string,
): RightToWork {
  const all = records.filter((r) => r.type === RIGHT_TO_WORK && checked(r));
  const checks = all.filter((r) => inDate(r, today));
  if (checks.length === 0) {
    return { checked: false, checkedOn: null, expired: all.some((r) => r.status !== "applied") };
  }
  const dates = checks.map((r) => r.checkedOn).filter((d): d is string => d !== null);
  return { checked: true, checkedOn: dates.sort().at(-1) ?? null, expired: false };
}

export function rolesWithoutRule(
  roles: readonly string[],
  rules: readonly { role: string }[],
): string[] {
  return roles.filter((role) => !rules.some((r) => r.role === role)).sort();
}

export type NeedsLevel = 1 | 2 | 3 | 4;

export interface NeedsItem {
  level: NeedsLevel;
  qualification: Qualification;
  // Level 1: the first booked shift it stops (its role and the local day it starts).
  blocks: { role: string; day: string } | null;
}

export function needsUpdating(o: {
  qualifications: readonly Qualification[];
  // Her confirmed bookings ahead: the role, and the local days the shift starts and ends.
  bookings: readonly { role: string; startDay: string; endDay: string }[];
  today: string;
}): NeedsItem[] {
  const items: NeedsItem[] = [];
  const byStart = [...o.bookings].sort((a, b) => a.startDay.localeCompare(b.startDay));
  for (const q of o.qualifications) {
    // Applied for, where the rules won't accept it: it stops a booked shift. Otherwise nothing for
    // her to do yet.
    const appliedStops = q.status === "applied" && !q.appliedCounts;
    // A shift it stops: the rules need it in date until the shift's last day.
    const stopped = byStart.find(
      (b) =>
        q.neededFor.includes(b.role) &&
        (q.status === "expired" ||
          q.status === "suspended" ||
          q.status === "missing" ||
          q.status === "rejected" ||
          q.status === "being_checked" ||
          appliedStops ||
          ((q.status === "valid" || q.status === "expiring_soon") &&
            q.expiresOn !== null &&
            q.expiresOn < b.endDay)),
    );
    if (stopped) {
      items.push({
        level: 1,
        qualification: q,
        blocks: { role: stopped.role, day: stopped.startDay },
      });
      continue;
    }
    const level: NeedsLevel | null =
      q.status === "expired" || q.status === "suspended" || q.status === "rejected"
        ? 2
        : q.status === "expiring_soon" && !q.renewing
          ? 3
          : q.status === "missing"
            ? 4
            : null;
    if (level) items.push({ level, qualification: q, blocks: null });
  }
  // Within a level: the shift it stops soonest, the worst status, the soonest date, then by name.
  const rank = (s: QualificationStatus) => STATUS_ORDER.indexOf(s);
  return items.sort(
    (a, b) =>
      a.level - b.level ||
      (a.blocks?.day ?? "").localeCompare(b.blocks?.day ?? "") ||
      rank(a.qualification.status) - rank(b.qualification.status) ||
      (a.qualification.expiresOn ?? "").localeCompare(b.qualification.expiresOn ?? "") ||
      a.qualification.name.localeCompare(b.qualification.name),
  );
}
