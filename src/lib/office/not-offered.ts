import { sql } from "drizzle-orm";
import { CANCELLED_ASSIGNMENT_STATUSES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { previewBookings } from "../roster/book";
import { pairKey } from "../roster/eligibility-input";
import type { RuleCode } from "../rules/eligibility";
import { localDayOf, mayOfferToday } from "../rules/offer-cap";

// "Not offered, and why" on the offer page and the dashboard's offer panel (Phase 26.9, off-2): the
// firm's active casuals with the session's role who aren't on its candidate list
// (src/lib/offers/candidates.ts), each with one reason, the first that applies, in the candidate
// list's own order: on it already (booked, or cancelled off it), already offered it, offers turned
// off, over the day's offers (unless the session is urgent), then the booking rules' first no
// (previewBookings: the same verdicts as booking). The caller adds those on the list whom nothing
// can reach ("unreachable"). Reads only; it decides nothing, and nothing is sent from it.

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

export interface NotOffered {
  workerId: string;
  name: string;
  why: NotOfferedWhy;
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
  }>(sql`
    select s.role, s.is_urgent, f.timezone as time_zone
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
  for (const id of toCheck) {
    const v = verdicts.get(pairKey(shiftId, id));
    // Allowed by the rules but not a candidate (a travel area rules it out for a wave, say): the
    // rules' reason can't be named, so it isn't listed.
    if (!v || v.ok) continue;
    const code = v.codes[0] as RuleCode | undefined;
    first.set(id, (code && RULE_WHY[code]) ?? "rules");
  }
  for (const r of rows) {
    const why = first.get(r.worker_id);
    if (why) out.push({ workerId: r.worker_id, name: `${r.first_name} ${r.last_name}`, why });
  }
  return out;
}
