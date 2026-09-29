import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { weeklyHours } from "../roster/allocation-input";
import { previewBooking } from "../roster/book";
import type { RotationCandidate } from "../rules/allocation";
import { weekOf } from "../rules/eligibility";
import { localDayOf, mayOfferToday } from "../rules/offer-cap";
import { localDateOf } from "../time/zoned";

// Who a shift offer may go to (docs/api-and-jobs.md, "Offer-wave ranking"): active workers with
// the shift's role who want open-shift messages (their profile setting), have never held a place
// on the shift (on it now, or cancelled off it: a cancellation is a "no"), haven't been offered it
// before (an offer that failed to send doesn't count), who are under the daily offer cap unless the
// shift is urgent (src/lib/rules/offer-cap.ts), and whom the rules allow (previewBooking: the same
// check as the boards). Each comes with what the fair-rotation order needs: confirmed hours in the
// shift's week and when they were last offered any shift. Reads only; the wave job decides.
//
// The shift's role, start, urgency and the firm's time zone are read here from the shift id, never
// taken from the caller, so no caller can skip the cap or move its day. Offers pick their workers
// here and nowhere else (tests/unit/offers.boundary.test.ts); the integration tests
// (tests/integration/offers.candidates.test.ts, offers.waves.test.ts) prove the ones left out
// never get an offer.

export interface WaveCandidate extends RotationCandidate {
  mobile: string;
  channel: "whatsapp" | "sms";
  smsAllowed: boolean; // false: they replied STOP to a text (src/lib/notify/send.ts)
}

// Holds, until the transaction ends, the lock on each worker's offer count for the day (in id
// order, so two holders never wait on each other). Every sender takes it before writing offers,
// and the office's offer before counting too, so two offers at the same moment can't both see
// "2 today" and send a 3rd and a 4th that isn't urgent.
export async function lockOfferCounts(tx: FirmTx, workerIds: string[]): Promise<void> {
  for (const workerId of [...new Set(workerIds)].sort()) {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended('offer-count:' || app_current_firm_id()::text || ':' || ${workerId}, 0))
    `);
  }
}

export async function waveCandidates(
  tx: FirmTx,
  shiftId: string,
  now: Date,
): Promise<WaveCandidate[]> {
  const { rows: found } = await tx.execute<{
    role: string;
    starts_at: string | Date;
    is_urgent: boolean;
    time_zone: string;
  }>(sql`
    select s.role, s.starts_at, s.is_urgent, f.timezone as time_zone
      from shifts s join firms f on f.id = s.firm_id
     where s.id = ${shiftId}
  `);
  const row = found[0];
  if (!row) return [];
  const shift = {
    id: shiftId,
    role: row.role,
    startsAt: new Date(row.starts_at),
    urgent: row.is_urgent,
    timeZone: row.time_zone,
  };
  const today = localDayOf(now, shift.timeZone);
  const { rows } = await tx.execute<{
    worker_id: string;
    mobile: string;
    channel: "whatsapp" | "sms";
    sms_allowed: boolean;
    last_offered_at: string | Date | null;
    offers_today: number;
  }>(sql`
    select w.id as worker_id, w.mobile_e164 as mobile, w.notify_channel as channel,
           w.sms_opted_out_at is null as sms_allowed,
           (select max(o.sent_at) from offers o where o.worker_id = w.id) as last_offered_at,
           (select count(*)::int from offers o
             where o.worker_id = w.id and o.response is distinct from 'failed'
               and o.sent_at >= ${today.from}
               and o.sent_at < ${today.to}) as offers_today
      from workers w
     where w.status = 'active' and w.offer_alerts and ${shift.role} = any (w.roles)
       and not exists (select 1 from assignments a
                        where a.shift_id = ${shift.id} and a.worker_id = w.id)
       and not exists (select 1 from offers o
                        where o.shift_id = ${shift.id} and o.worker_id = w.id
                          and o.response is distinct from 'failed')
     order by w.id
  `);
  if (rows.length === 0) return [];
  const hours = await weeklyHours(tx, {
    shiftId: shift.id,
    role: shift.role,
    week: weekOf(localDateOf(shift.startsAt, shift.timeZone), shift.timeZone),
    workerId: rows[0]?.worker_id ?? "",
  });
  const kept: WaveCandidate[] = [];
  for (const r of rows) {
    if (!mayOfferToday({ offersToday: r.offers_today, urgent: shift.urgent })) continue;
    const verdict = await previewBooking(tx, { shiftId: shift.id, workerId: r.worker_id, now });
    if (!verdict?.ok) continue;
    kept.push({
      workerId: r.worker_id,
      mobile: r.mobile,
      channel: r.channel,
      smsAllowed: r.sms_allowed,
      hoursThisWeek: hours.get(r.worker_id) ?? 0,
      lastOfferedAt: r.last_offered_at ? new Date(r.last_offered_at) : null,
    });
  }
  return kept;
}
