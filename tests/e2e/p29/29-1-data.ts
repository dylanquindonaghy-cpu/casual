import { and, eq, like } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { messages, payQueries, requests } from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";

// Task 29.1's reads (Phase 29; tests/e2e/casual.p28-message-office.spec.ts "From Pay"): what a
// message sent from Messages about her pay left in the e2e database (never the dev one), read as
// the app role inside Acme, as the app would: the pay queries holding the run's own words (one,
// for payroll), and the office requests made from that message (none). Reads only: the casual and
// her rows come from tests/e2e/p28/28-6-data.ts (`messageOfficeScene`).

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inAcme<T>(work: (tx: FirmTx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await createWithFirm(pool)(seedId("firm/acme"), work);
  } finally {
    await pool.end();
  }
}

export interface PayFromMessages {
  queries: { ref: string; issue: string; status: string; shiftId: string | null }[];
  requests: number; // office requests made from her message
}

// The run's pay question (`tag` is in her words): its pay queries and the requests from it.
export async function payFromMessages(workerId: string, tag: string): Promise<PayFromMessages> {
  return inAcme(async (tx) => {
    const queries = await tx
      .select({
        id: payQueries.id,
        issue: payQueries.issueType,
        status: payQueries.status,
        shiftId: payQueries.shiftId,
      })
      .from(payQueries)
      .where(and(eq(payQueries.workerId, workerId), like(payQueries.details, `%${tag}%`)));
    const sent = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.workerId, workerId), like(messages.body, `%${tag}%`)));
    let made = 0;
    for (const m of sent) {
      made += (
        await tx.select({ id: requests.id }).from(requests).where(eq(requests.messageId, m.id))
      ).length;
    }
    return {
      queries: queries.map((q) => ({
        ref: q.id.slice(0, 8).toUpperCase(),
        issue: q.issue,
        status: q.status,
        shiftId: q.shiftId,
      })),
      requests: made,
    };
  });
}
