import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { addEventWithSession, addSteward, cancelOwnShift } from "../db";

// Task 28.15's rows (Phase 28; tests/e2e/casual.p28-offers.spec.ts), made with tests/e2e/db.ts's
// helpers (imported, never edited). Made-up details only, on drama-range numbers no other spec or
// the seed uses:
// - Ines: a steward of the spec's own with one offer still open to her (wave 1, sent 40 minutes
//   ago) on a steward session of an event of the spec's own, 5 days ahead: she says "No thanks".
// - Owen: the same, on a session of his own: he opens the offer and takes the shift.
// Each run makes fresh sessions (and cancels them after), so a rerun starts clean.
export const P28_15_INES = {
  firstName: "Ines",
  lastName: "Marlow",
  mobileE164: "+447700900815",
} as const;
export const P28_15_INES_TYPED = "07700 900815";
export const P28_15_OWEN = {
  firstName: "Owen",
  lastName: "Petrak",
  mobileE164: "+447700900915",
} as const;
export const P28_15_OWEN_TYPED = "07700 900915";

export const P28_15_EVENT = "Harbour Lights Fair";
export const P28_15_SITE = "Quayside Hall";

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inAcme<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await createWithFirm(pool)(seedId("firm/acme"), fn);
  } finally {
    await pool.end();
  }
}

export interface OfferScene {
  workerId: string;
  shiftId: string;
  offerId: string;
}

// A steward of the spec's own, a fresh session for them, and an offer of it still open to them.
// Any session an earlier run left open to them is cancelled first.
export async function offerScene(casual: {
  firstName: string;
  lastName: string;
  mobileE164: string;
}): Promise<OfferScene> {
  const workerId = await addSteward("acme", casual);
  const earlier = await inAcme(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select distinct o.shift_id::text as id from offers o
        join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
       where o.worker_id = ${workerId} and s.status = 'open'`);
    return rows.map((r) => r.id);
  });
  for (const id of earlier) await cancelOwnShift("acme", id);
  const { shiftId } = await addEventWithSession("acme", {
    name: P28_15_EVENT,
    // A site of this scene's own (site names are unique in a firm, and the spec's two tests and
    // any retry each make one): "Quayside Hall Marlow 3f9a".
    site: `${P28_15_SITE} ${casual.lastName} ${randomBytes(2).toString("hex")}`,
    role: "steward",
    daysAhead: 5,
  });
  const offerId = await inAcme(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
      values (${seedId("firm/acme")}, ${shiftId}, ${workerId}, 1, 'push',
              -- 40 minutes ago, but never before today's midnight in London: an offer from
              -- yesterday reads "Offered 23:37 on Thu 12 Nov", and the spec checks today's wording
              -- (a run between 00:00 and 00:40 failed on that).
              greatest(now() - interval '40 minutes',
                       (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London'))
      returning id::text as id`);
    const id = rows[0]?.id;
    if (!id) throw new Error("offer insert returned nothing");
    return id;
  });
  return { workerId, shiftId, offerId };
}

// The offer's answer as stored, and its offer.declined entries (what the office sees).
export async function offerAnswer(
  offerId: string,
): Promise<{ response: string | null; declinedLogged: number }> {
  return inAcme(async (tx) => {
    const { rows } = await tx.execute<{ response: string | null; logged: number }>(sql`
      select o.response,
             (select count(*)::int from events e
               where e.action = 'offer.declined' and e.entity_id = o.id) as logged
        from offers o where o.id = ${offerId}`);
    return { response: rows[0]?.response ?? null, declinedLogged: rows[0]?.logged ?? 0 };
  });
}

// Done with a session: cancelled, so no later spec sees its open place.
export const endOfferScene = (s: OfferScene) => cancelOwnShift("acme", s.shiftId);
