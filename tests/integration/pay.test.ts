import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runImport, type ImportResult } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { myPay, StepUpRequiredError } from "@/lib/portal/pay";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";

// Pay data on the real database, as the app role: imported from payroll's file (the `pay` kind of
// `npm run import`), and shown to the worker only behind a pay-page code from the last 30 minutes.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const NOW = new Date("2026-11-06T09:00:00Z"); // Friday 6 Nov

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

let mobiles = 0;
async function payFirm() {
  const slug = uniqueSlug("p");
  const one = async (text: string, values: unknown[]) =>
    (await su.query<{ id: string }>(`${text} returning id::text as id`, values)).rows[0]?.id ?? "";
  const firmId = await one("insert into firms (name, slug, sector) values ($1, $2, 'security')", [
    `Pay Test ${slug}`,
    slug,
  ]);
  const officeId = await one(
    "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Payroll', 'payroll')",
    [firmId, `${slug}@example.com`],
  );
  const worker = async (ref: string) => {
    mobiles += 1;
    return one(
      "insert into workers (firm_id, first_name, last_name, mobile_e164, external_ref) values ($1, 'Sam', 'Payee', $2, $3)",
      [firmId, `+447700900${String(mobiles % 1000).padStart(3, "0")}`, ref],
    );
  };
  const load = (text: string, now = NOW): Promise<ImportResult> =>
    withFirm(firmId, (tx) =>
      runImport(tx, {
        kind: "pay",
        rows: readTable(new TextEncoder().encode(text)),
        dryRun: false,
        actorId: officeId,
        timeZone: "Europe/London",
        now,
      }),
    );
  return { firmId, worker, load };
}

const session = (workerId: string, steppedUpUntil: Date | null): ActiveSession => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "worker",
  subjectId: workerId,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  rotatedAt: NOW,
  steppedUpUntil,
  rotationDue: false,
});
const steppedUp = (workerId: string) => ({
  worker: { id: workerId },
  session: session(workerId, new Date(NOW.getTime() + 10 * 60_000)),
});
const ctxFor = (firmId: string) => ({
  firm: { id: firmId, timezone: "Europe/London" },
  run: withFirm,
  clock: { now: () => NOW },
});

const HEADER = "Staff ID,Week start,Week ending,Hours,Rate,Gross pay,Pay date";

describe("importing pay (npm run import --kind pay)", () => {
  it("adds one line per worker, period and rate, and a re-import updates it", async () => {
    const f = await payFirm();
    const sam = await f.worker("S1");
    const file = `${HEADER}
S1,26/10/2026,01/11/2026,37.5,£12.50,£468.75,06/11/2026
S1,26/10/2026,01/11/2026,4,£15.00,,06/11/2026`;
    expect(await f.load(file)).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    const { rows } = await su.query(
      `select period_start::text, period_end::text, hours::text, rate_pence, gross_pence, pay_date::text
         from pay_records where worker_id = $1 order by rate_pence`,
      [sam],
    );
    expect(rows).toEqual([
      {
        period_start: "2026-10-26",
        period_end: "2026-11-01",
        hours: "37.50",
        rate_pence: 1250,
        gross_pence: 46875,
        pay_date: "2026-11-06",
      },
      {
        period_start: "2026-10-26",
        period_end: "2026-11-01",
        hours: "4.00",
        rate_pence: 1500,
        gross_pence: null,
        pay_date: "2026-11-06",
      },
    ]);
    // The same file again: nothing changes. Corrected hours with a blank gross: the hours update and
    // the old gross is cleared (it no longer matches them); the pay date stays.
    expect(await f.load(file)).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(
      await f.load(`${HEADER}
S1,26/10/2026,01/11/2026,38,12.50,,`),
    ).toMatchObject({ updated: 1 });
    const { rows: after } = await su.query(
      "select hours::text, gross_pence, pay_date::text from pay_records where worker_id = $1 and rate_pence = 1250",
      [sam],
    );
    expect(after).toEqual([{ hours: "38.00", gross_pence: null, pay_date: "2026-11-06" }]);
    // A later file adding the gross for the same hours: added.
    expect(
      await f.load(`${HEADER}
S1,26/10/2026,01/11/2026,38,12.50,£475.00,`),
    ).toMatchObject({ updated: 1 });
    // Logged by field, never by amount.
    const { rows: events } = await su.query(
      "select action, data from events where firm_id = $1 and action like 'pay_record.%' order by id",
      [f.firmId],
    );
    expect(events.map((e) => e.action)).toEqual([
      "pay_record.imported",
      "pay_record.imported",
      "pay_record.updated",
      "pay_record.updated",
    ]);
    expect(events[2]?.data).toEqual({ source: "csv", fields: ["hours", "grossPence"] });
    expect(events[3]?.data).toEqual({ source: "csv", fields: ["grossPence"] });
    expect(JSON.stringify(events)).not.toMatch(/1250|46875|468|475/);
  });

  it("skips rows it can't trust, each by row number and a plain reason", async () => {
    const f = await payFirm();
    await f.worker("S1");
    const result = await f.load(`${HEADER}
S1,26/10/2026,01/11/2026,lots,12.50,,
S1,26/10/2026,01/11/2026,8,twelve,,
S1,02/11/2026,26/10/2026,8,12.50,,
S1,26/13/2026,01/11/2026,8,12.50,,
S9,26/10/2026,01/11/2026,8,12.50,,
S1,26/10/2026,01/11/2026,1001,12.50,,
S1,26/10/2026,01/11/2026,8,12.50,£x,
S1,26/10/2026,01/11/2026,,12.50,,
S1,26/10/2026,01/11/2026,8,12.50,,
S1,26/10/2026,01/11/2026,9,12.50,,`);
    expect(result.problems).toEqual([
      { row: 2, problem: "bad_hours" },
      { row: 3, problem: "bad_money" },
      { row: 4, problem: "bad_period" },
      { row: 5, problem: "bad_date" },
      { row: 6, problem: "unknown_worker" },
      { row: 7, problem: "bad_hours" },
      { row: 8, problem: "bad_money" },
      { row: 9, problem: "missing_value" },
      { row: 11, problem: "duplicate_row" },
    ]);
    expect(result.created).toBe(1);
  });
});

describe("myPay", () => {
  it("shows the last 8 weeks, newest first, only after a code in the last 30 minutes", async () => {
    const f = await payFirm();
    const sam = await f.worker("S1");
    const jo = await f.worker("S2");
    await f.load(`${HEADER}
S1,26/10/2026,01/11/2026,37.5,12.50,468.75,06/11/2026
S1,19/10/2026,25/10/2026,20,12.50,,30/10/2026
S1,01/09/2026,07/09/2026,10,12.00,,11/09/2026
S2,26/10/2026,01/11/2026,8,12.50,,06/11/2026`);

    expect(await myPay(ctxFor(f.firmId), steppedUp(sam))).toEqual([
      {
        periodStart: "2026-10-26",
        periodEnd: "2026-11-01",
        hours: 37.5,
        ratePence: 1250,
        grossPence: 46875,
        payDate: "2026-11-06",
      },
      {
        periodStart: "2026-10-19",
        periodEnd: "2026-10-25",
        hours: 20,
        ratePence: 1250,
        grossPence: null,
        payDate: "2026-10-30",
      },
    ]);

    // No code, an expired one, or someone else's session: no figures at all.
    const refused = [
      { worker: { id: sam }, session: session(sam, null) },
      { worker: { id: sam }, session: session(sam, new Date(NOW.getTime() - 1)) },
      { worker: { id: sam }, session: session(jo, new Date(NOW.getTime() + 60_000)) },
    ];
    for (const stepped of refused) {
      await expect(myPay(ctxFor(f.firmId), stepped)).rejects.toBeInstanceOf(StepUpRequiredError);
    }
  });

  it("never shows another firm's pay", async () => {
    const mine = await payFirm();
    const theirs = await payFirm();
    const kit = await theirs.worker("S1");
    await theirs.load(`${HEADER}
S1,26/10/2026,01/11/2026,8,12.50,,06/11/2026`);
    expect(await myPay(ctxFor(mine.firmId), steppedUp(kit))).toEqual([]);
    expect(await myPay(ctxFor(theirs.firmId), steppedUp(kit))).toHaveLength(1);
  });
});
