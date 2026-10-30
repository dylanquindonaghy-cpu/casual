import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";

// Just before offers are written (waves.ts, office-offer.ts): of the workers already chosen from
// the candidate list (candidates.ts, the one place offer recipients come from), the ones still
// active with a mobile, their rows locked (key share) until the transaction ends. It only ever
// drops workers, never adds one. The candidate list is read without locks, so a worker erased
// (GDPR) or made inactive since then is dropped here: an erasure holds their row, so this waits
// for it and then sees the row as it is now.
export async function lockReachableWorkers(tx: FirmTx, workerIds: string[]): Promise<Set<string>> {
  if (workerIds.length === 0) return new Set();
  const { rows } = await tx.execute<{ id: string }>(sql`
    select w.id from workers w
     where w.id in (${sql.join(
       [...new Set(workerIds)].sort().map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       and w.status = 'active' and w.mobile_e164 is not null
     order by w.id
       for key share
  `);
  return new Set(rows.map((r) => r.id));
}

export interface LiveContact {
  mobile: string;
  channel: "whatsapp" | "sms";
  smsAllowed: boolean; // false: they replied STOP to a text
  email: string | null; // the address the firm holds for them: the offer's last way (P2.4)
}

// One worker as they are now, their row locked (key share) until the transaction ends: null unless
// still active, with a mobile, and wanting open-shift messages. An offer wave claims each worker
// with this just before writing their offer, so a STOP, a changed channel or offers turned off
// while the wave was going out are honoured (src/lib/offers/waves.ts).
export async function lockLiveContact(tx: FirmTx, workerId: string): Promise<LiveContact | null> {
  const { rows } = await tx.execute<{
    mobile: string;
    channel: "whatsapp" | "sms";
    sms_allowed: boolean;
    email: string | null;
  }>(sql`
    select w.mobile_e164 as mobile, w.notify_channel as channel,
           w.sms_opted_out_at is null as sms_allowed, w.email
      from workers w
     where w.id = ${workerId}::uuid
       and w.status = 'active' and w.mobile_e164 is not null and w.offer_alerts
       for key share
  `);
  const row = rows[0];
  return row
    ? { mobile: row.mobile, channel: row.channel, smsAllowed: row.sms_allowed, email: row.email }
    : null;
}
