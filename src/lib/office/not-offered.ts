import { sql } from "drizzle-orm";
import { CANCELLED_ASSIGNMENT_STATUSES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { previewBookings } from "../roster/book";
import { pairKey } from "../roster/eligibility-input";
import type { RuleCheck, RuleCode } from "../rules/eligibility";
import { localDayOf, mayOfferToday } from "../rules/offer-cap";
import { localDateOf, wallTimeOf } from "../time/zoned";

// "Not offered, and why" on the offer page and the dashboard's offer panel (Phase 26.9, off-2): the
// firm's active casuals with the session's role who aren't on its candidate list
// (src/lib/offers/candidates.ts), each with one reason, the first that applies, in the candidate
// list's own order: on it already (booked, or cancelled off it), already offered it, offers turned
// off, over the day's offers (unless the session is urgent), then the booking rules' first no
// (previewBookings: the same verdicts as booking). The caller adds those on the list whom nothing
// can reach ("unreachable"). Reads only; it decides nothing, nothing is sent from it, and it writes
// no events row.
//
// A licence or card (Phase 37.3, w1-03): the first card the rules found, by the firm's own name for
// it (credential_types, read here inside withFirm), with its state and date, read from the rules'
// own checks (licenceOf, pure). It changes no decision (golden rule 1) and states only what the
// record shows: "runs out" only for a valid card, "marked expired" only for one marked expired.

export type NotOfferedWhy =
  | "booked"
  | "cancelled"
  | "offered"
  | "offers_off"
  | "cap"
  | "licence"
  | "elsewhere"
  | "rest"
  | "hours"
  | "unavailable"
  | "blocked"
  | "no_rule"
  | "unreachable"
  | "rules";

// What the rules found about the first card that failed.
export type LicenceState =
  | "missing"
  | "applied"
  | "out_of_date"
  | "runs_out"
  | "marked_expired"
  | "suspended"
  | "over_allowance";

// Plain JSON, so it crosses to the dashboard's client panel. `names`: the firm's names for the card
// (every one of a one-of group she holds none of); `date`: yyyy-mm-dd or null; `year`: the
// session's (a date in another year shows its year).
export interface NotOfferedLicence {
  names: string[];
  state: LicenceState;
  date: string | null;
  year: number;
}

export interface NotOffered {
  workerId: string;
  name: string;
  why: NotOfferedWhy;
  licence?: NotOfferedLicence; // only when why is "licence"
}

// The rules' first no, as the office reads it.
const RULE_WHY: Partial<Record<RuleCode, NotOfferedWhy>> = {
  credential_missing: "licence",
  credential_expired: "licence",
  credential_suspended: "licence",
  applied_over_allowance: "licence",
  overlap: "elsewhere",
  rest: "rest",
  weekly_hours: "hours",
  unavailable: "unavailable",
  blocked_site: "blocked",
  no_rule: "no_rule",
};

// A type's name as the firm writes it, else its code in words (as enquiries-copy.ts does).
const typeName = (names: Readonly<Record<string, string>>, type: string) =>
  names[type] ?? type.replace(/_/g, " ").toLowerCase();

// The first card the rules found, from their own checks. The first failed qualification check is
// the card behind codes[0]: the rules push a credential failure and its check in the same order,
// and the checks before it (started, active, role) carry other codes. `today` and `year` are the
// rule's own (the firm's zone). The check's detail shows the record the rule shows (the latest
// valid, else a suspended one, else the first held), so each state needs that record to say it.
// Undefined when no card is found: the words fall back. Pure.
export function licenceOf(
  code: RuleCode | undefined,
  checks: readonly RuleCheck[],
  names: Readonly<Record<string, string>>,
  today: string,
  year: number,
): NotOfferedLicence | undefined {
  if (
    code !== "credential_missing" &&
    code !== "credential_expired" &&
    code !== "credential_suspended" &&
    code !== "applied_over_allowance"
  ) {
    return undefined;
  }
  const check = checks.find((c) => c.code === "qualification" && !c.passed);
  if (!check) return undefined;
  const d = check.detail;
  if (typeof d.type !== "string") return undefined;
  const held = typeof d.held === "string" ? d.held : "none";
  const expiresOn = typeof d.expiresOn === "string" ? d.expiresOn : null;
  const until = typeof d.until === "string" ? d.until : null;
  const one = [typeName(names, d.type)];
  const out = (state: LicenceState, date: string | null = null, n = one): NotOfferedLicence => ({
    names: n,
    state,
    date,
    year,
  });
  switch (code) {
    case "credential_suspended":
      return out("suspended");
    case "applied_over_allowance":
      return out("over_allowance");
    case "credential_missing": {
      if (held === "applied") return out("applied");
      const group =
        held === "none" && Array.isArray(d.anyOf) && d.anyOf.length > 0
          ? d.anyOf.map((t) => typeName(names, t))
          : one;
      return out("missing", null, group);
    }
    case "credential_expired": {
      const dated = expiresOn !== null && until !== null && expiresOn < until ? expiresOn : null;
      if (held === "valid" && dated !== null) {
        return dated >= today ? out("runs_out", dated) : out("out_of_date", dated);
      }
      if (held === "expired" && dated !== null) return out("out_of_date", dated);
      if (held === "expired") return out("marked_expired");
      // Any other mix of records: never claim a state the record doesn't show.
      return out("out_of_date");
    }
  }
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export async function loadNotOffered(
  tx: FirmTx,
  shiftId: string,
  now: Date,
  candidateIds: ReadonlySet<string>,
): Promise<NotOffered[]> {
  const { rows: found } = await tx.execute<{
    role: string;
    is_urgent: boolean;
    time_zone: string;
    starts_at: Date | string;
  }>(sql`
    select s.role, s.is_urgent, f.timezone as time_zone, s.starts_at
      from shifts s join firms f on f.id = s.firm_id
     where s.id = ${shiftId}
  `);
  const shift = found[0];
  if (!shift) return [];
  const today = localDayOf(now, shift.time_zone);
  const { rows } = await tx.execute<{
    worker_id: string;
    first_name: string;
    last_name: string;
    offer_alerts: boolean;
    booked: boolean;
    cancelled: boolean;
    offered: boolean;
    offers_today: number;
  }>(sql`
    select w.id::text as worker_id, w.first_name, w.last_name, w.offer_alerts,
           exists (select 1 from assignments a
                    where a.shift_id = ${shiftId} and a.worker_id = w.id
                      and a.status not in (${CANCELLED})) as booked,
           exists (select 1 from assignments a
                    where a.shift_id = ${shiftId} and a.worker_id = w.id
                      and a.status in (${CANCELLED})) as cancelled,
           exists (select 1 from offers o
                    where o.shift_id = ${shiftId} and o.worker_id = w.id) as offered,
           (select count(*)::int from offers o
             where o.worker_id = w.id and o.response is distinct from 'failed'
               and o.sent_at >= ${today.from} and o.sent_at < ${today.to}) as offers_today
      from workers w
     where w.status = 'active' and ${shift.role} = any (w.roles)
       and w.mobile_e164 is not null
     order by w.last_name, w.first_name, w.id
  `);
  const out: NotOffered[] = [];
  const toCheck: string[] = [];
  const first = new Map<string, NotOfferedWhy>();
  const licences = new Map<string, NotOfferedLicence>();
  for (const r of rows) {
    if (candidateIds.has(r.worker_id)) continue;
    const why: NotOfferedWhy | null = r.booked
      ? "booked"
      : r.cancelled
        ? "cancelled"
        : r.offered
          ? "offered"
          : !r.offer_alerts
            ? "offers_off"
            : !mayOfferToday({ offersToday: r.offers_today, urgent: shift.is_urgent })
              ? "cap"
              : null;
    if (why) first.set(r.worker_id, why);
    else toCheck.push(r.worker_id);
  }
  const verdicts =
    toCheck.length > 0
      ? await previewBookings(tx, { shiftIds: [shiftId], workerIds: toCheck, now })
      : new Map();
  // The firm's own names for its cards (RLS: this firm's rows only), read once when needed.
  let names: Record<string, string> | null = null;
  const firmNames = async (): Promise<Record<string, string>> => {
    if (names) return names;
    const { rows: types } = await tx.execute<{ code: string; name: string }>(
      sql`select code, name from credential_types`,
    );
    names = Object.fromEntries(types.map((t) => [t.code, t.name]));
    return names;
  };
  const localToday = localDateOf(now, shift.time_zone);
  const shiftYear = wallTimeOf(new Date(shift.starts_at), shift.time_zone).year;
  for (const id of toCheck) {
    const v = verdicts.get(pairKey(shiftId, id));
    // Allowed by the rules but not a candidate (a travel area rules it out for a wave, say): the
    // rules' reason can't be named, so it isn't listed.
    if (!v || v.ok) continue;
    const code = v.codes[0] as RuleCode | undefined;
    const why = (code && RULE_WHY[code]) ?? "rules";
    first.set(id, why);
    if (why === "licence") {
      const licence = licenceOf(code, v.checks, await firmNames(), localToday, shiftYear);
      if (licence) licences.set(id, licence);
    }
  }
  for (const r of rows) {
    const why = first.get(r.worker_id);
    if (!why) continue;
    const licence = licences.get(r.worker_id);
    out.push({
      workerId: r.worker_id,
      name: `${r.first_name} ${r.last_name}`,
      why,
      ...(licence ? { licence } : {}),
    });
  }
  return out;
}
