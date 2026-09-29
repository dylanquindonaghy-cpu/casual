import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { weeklyHours } from "../roster/allocation-input";
import { previewBooking } from "../roster/book";
import type { RotationCandidate } from "../rules/allocation";
import { weekOf } from "../rules/eligibility";
import { localDateOf } from "../time/zoned";

// Who an offer wave may go to (docs/api-and-jobs.md, "Offer-wave ranking"): active workers with
// the shift's role who want open-shift messages (their profile setting), have never held a place
// on the shift (on it now, or cancelled off it: a cancellation is a "no"), haven't been offered it
// before, and whom the rules allow (previewBooking: the same check as the boards). Each comes with what the fair-rotation order needs: confirmed hours in the shift's
// week and when they were last offered any shift. Reads only; the wave job decides.

export interface WaveCandidate extends RotationCandidate {
  mobile: string;
  channel: "whatsapp" | "sms";
}

export async function waveCandidates(
  tx: FirmTx,
  shift: { id: string; role: string; startsAt: Date; timeZone: string },
  now: Date,
): Promise<WaveCandidate[]> {
  const { rows } = await tx.execute<{
    worker_id: string;
    mobile: string;
    channel: "whatsapp" | "sms";
    last_offered_at: string | Date | null;
  }>(sql`
    select w.id as worker_id, w.mobile_e164 as mobile, w.notify_channel as channel,
           (select max(o.sent_at) from offers o where o.worker_id = w.id) as last_offered_at
      from workers w
     where w.status = 'active' and w.offer_alerts and ${shift.role} = any (w.roles)
       and not exists (select 1 from assignments a
                        where a.shift_id = ${shift.id} and a.worker_id = w.id)
       and not exists (select 1 from offers o where o.shift_id = ${shift.id} and o.worker_id = w.id)
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
    const verdict = await previewBooking(tx, { shiftId: shift.id, workerId: r.worker_id, now });
    if (!verdict?.ok) continue;
    kept.push({
      workerId: r.worker_id,
      mobile: r.mobile,
      channel: r.channel,
      hoursThisWeek: hours.get(r.worker_id) ?? 0,
      lastOfferedAt: r.last_offered_at ? new Date(r.last_offered_at) : null,
    });
  }
  return kept;
}
