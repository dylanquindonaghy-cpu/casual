import { daysUntil, EXPIRING_SOON_DAYS } from "./expiry";

// A casual's qualifications as they stand today (docs/office-v2.md 3.7, 4.2, 4.6; Rules 15; 12F.1).
// Pure: records and dates in, statuses out. The same reading as the rules engine
// (docs/rules-and-credentials.md): a suspended record fails whatever else is held; otherwise a
// valid record in date counts; an applied one is being processed; anything else has expired.
//
// - qualificationStatus(): one type's records → Valid, Expiring soon (within EXPIRING_SOON_DAYS),
//   Expired, Missing (no record), Applied for or Suspended. ("Being checked" and "Not accepted"
//   join with 12F.2's uploads.)
// - listQualifications(): every type one of her roles needs (the firm's rules), with the roles that
//   need it, worst first. A type nothing needs isn't listed. Right to work is a status only
//   (rightToWork()), never in the list.
// - needsUpdating(): what she should sort out, in §4.2's order: (1) blocks a booked shift (expired,
//   suspended or missing, applied for where the firm's rules won't accept it, or expiring before
//   the shift ends); (2) expired or suspended; (3) expiring soon, unless she's already applied to
//   renew it; (4) missing. The staff photo's levels join with 12F.2.
// - rolesWithoutRule(): her roles the firm has no rule for: the rules engine refuses those shifts
//   (fail closed), so nothing may say her roles "need none".

export const RIGHT_TO_WORK = "RTW";

export type QualificationStatus =
  "valid" | "expiring_soon" | "expired" | "missing" | "applied" | "suspended";

export interface CredentialRecord {
  status: "valid" | "expired" | "applied" | "suspended";
  expiresOn: string | null; // yyyy-mm-dd
}

export interface QualificationState {
  status: QualificationStatus;
  // The date that goes with it: valid until / expires / expired on (null: no expiry, or none known).
  expiresOn: string | null;
}

const inDate = (r: CredentialRecord, today: string) =>
  r.status === "valid" && (r.expiresOn === null || r.expiresOn >= today);

// The longest-lasting first (no expiry lasts longest).
const lasting = (a: CredentialRecord, b: CredentialRecord) =>
  (b.expiresOn ?? "9999-12-31").localeCompare(a.expiresOn ?? "9999-12-31");

export function qualificationStatus(
  records: readonly CredentialRecord[],
  today: string,
): QualificationState {
  if (records.length === 0) return { status: "missing", expiresOn: null };
  const suspended = records.find((r) => r.status === "suspended");
  if (suspended) return { status: "suspended", expiresOn: suspended.expiresOn };
  const best = records.filter((r) => inDate(r, today)).sort(lasting)[0];
  if (best) {
    const soon = best.expiresOn !== null && daysUntil(today, best.expiresOn) <= EXPIRING_SOON_DAYS;
    return { status: soon ? "expiring_soon" : "valid", expiresOn: best.expiresOn };
  }
  if (records.some((r) => r.status === "applied")) return { status: "applied", expiresOn: null };
  // Expired: marked so, or valid with its date gone. The latest date, if any has one.
  const dated = records.filter((r) => r.expiresOn !== null).sort(lasting)[0];
  return { status: "expired", expiresOn: dated?.expiresOn ?? null };
}

// Worst first: what stops her working, then what's missing, then what's about to.
export const STATUS_ORDER: readonly QualificationStatus[] = [
  "suspended",
  "expired",
  "missing",
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
  renewing: boolean; // in date, with an application to renew it in progress
}

export function listQualifications(o: {
  roles: readonly string[];
  rules: readonly { role: string; requiredTypes: readonly string[] }[];
  names: ReadonlyMap<string, string>; // type code → name
  records: readonly ({ type: string } & CredentialRecord)[];
  today: string;
  appliedCounts?: (type: string) => boolean; // default: never (as with no allowance)
}): Qualification[] {
  const needed = new Map<string, Set<string>>();
  for (const rule of o.rules) {
    if (!o.roles.includes(rule.role)) continue;
    for (const type of rule.requiredTypes) {
      if (type === RIGHT_TO_WORK) continue;
      const roles = needed.get(type) ?? new Set<string>();
      roles.add(rule.role);
      needed.set(type, roles);
    }
  }
  const rank = (s: QualificationStatus) => STATUS_ORDER.indexOf(s);
  return [...needed]
    .map(([type, roles]) => {
      const records = o.records.filter((r) => r.type === type);
      const state = qualificationStatus(records, o.today);
      return {
        type,
        name: o.names.get(type) ?? type.replace(/_/g, " ").toLowerCase(),
        neededFor: [...roles].sort(),
        ...state,
        appliedCounts: o.appliedCounts?.(type) ?? false,
        renewing:
          (state.status === "valid" || state.status === "expiring_soon") &&
          records.some((r) => r.status === "applied"),
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
  const all = records.filter((r) => r.type === RIGHT_TO_WORK);
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
          appliedStops ||
          (q.status !== "applied" && q.expiresOn !== null && q.expiresOn < b.endDay)),
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
      q.status === "expired" || q.status === "suspended"
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
