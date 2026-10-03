import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { noticeHours } from "../roster/notice";

// An offer claimed (its row written and committed) whose outcome was never logged: the job stopped
// between the claim and the record step (a crash, a deploy, a failed commit). Its message may have
// gone, and it's never sent again. So that the action log and the notice report (which counts
// `offer.sent`) still have it, the job logs it as sent, marked `unconfirmed`, when it runs again
// (pg-boss retries a job that failed or never finished). The record step and this catch-up both
// lock the offer row and look before they write, so an offer is logged once whichever comes first.

// Locks the offer and says whether its outcome is logged already (sent, or failed to send).
export async function lockOfferOutcome(tx: FirmTx, offerId: string): Promise<boolean> {
  await tx.execute(sql`select 1 from offers where id = ${offerId} for update`);
  const { rows } = await tx.execute(sql`
    select 1 from events
     where (action = 'offer.sent' and entity_id = ${offerId})
        or (action = 'offer.send_failed' and data ->> 'offerId' = ${offerId}::text)
     limit 1
  `);
  return rows.length > 0;
}

// Logs every claimed offer of the shift (one wave's, or one office offer) with no outcome yet as
// sent, unconfirmed. Its notice hours count from when it was claimed. How many it logged.
export async function logUnconfirmedOffers(
  tx: FirmTx,
  shift: { id: string; startsAt: Date },
  which: { wave: number } | { offerId: string },
): Promise<number> {
  const { rows } = await tx.execute<{
    id: string;
    worker_id: string;
    wave: number | null;
    offered_by: string | null;
    channel: string;
    sent_at: string | Date;
  }>(sql`
    select o.id::text, o.worker_id::text, o.wave, o.offered_by::text, o.channel, o.sent_at
      from offers o
     where o.shift_id = ${shift.id} and o.response is distinct from 'failed'
       and ${"wave" in which ? sql`o.wave = ${which.wave}` : sql`o.id = ${which.offerId}`}
       and not exists (select 1 from events e where e.action = 'offer.sent' and e.entity_id = o.id)
     order by o.id
  `);
  let logged = 0;
  for (const o of rows) {
    if (await lockOfferOutcome(tx, o.id)) continue;
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.sent",
      entityType: "offer",
      entityId: o.id,
      data: {
        shiftId: shift.id,
        workerId: o.worker_id,
        ...(o.wave !== null ? { wave: o.wave } : {}),
        ...(o.offered_by ? { offeredBy: o.offered_by } : {}),
        noticeHours: noticeHours(shift.startsAt, new Date(o.sent_at)),
        channel: o.channel,
        unconfirmed: true, // claimed, and may have gone; the job stopped before it heard back
      },
    });
    logged += 1;
  }
  return logged;
}
