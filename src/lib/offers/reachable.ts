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
