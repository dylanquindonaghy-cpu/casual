import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { WEB_IMPORT_MAX_BYTES } from "@/lib/office/import-limits";
import { importPayFile } from "@/lib/office/pay-import";
import { myPay } from "@/lib/portal/pay";
import { raisePayQuery } from "@/lib/portal/pay-queries";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Payroll's "Import pay records" (src/lib/office/pay-import.ts, on top of the Phase 3 importer in
// src/lib/imports/import.ts) on the real database, as the app role: who may import, the check
// (nothing saved) and the import, the log without amounts, regrouping waiting pay queries, and the
// worker then seeing the line. NOW is Monday 2 November 2026, 09:00 London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const stepped = (workerId: string) => ({
  worker: { id: workerId },
  session: {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil: new Date(NOW.getTime() + 600_000),
    rotationDue: false,
  } as ActiveSession,
});

const csv = (...lines: string[]) => new TextEncoder().encode(`${lines.join("\n")}\n`);
const HEADER = "Staff ID,Period start,Period end,Hours,Rate,Gross pay,Pay date";

async function importFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  await su.query("update workers set external_ref = 'A1' where id = $1", [ann]);
  await su.query("update workers set external_ref = 'B2' where id = $1", [ben]);
  const payroll = await f.office("payroll");
  const ctx = (officeUserId = payroll) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => NOW },
  });
  const records = async () =>
    (
      await su.query(
        `select worker_id::text as worker_id, period_start::text as period_start,
                period_end::text as period_end, hours::float as hours, rate_pence, gross_pence,
                pay_date::text as pay_date
           from pay_records where firm_id = $1 order by period_start, worker_id`,
        [f.firmId],
      )
    ).rows;
  const payEvents = async () =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        actor_id: string;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, actor_id::text as actor_id, data from events
          where firm_id = $1 and action like 'pay_record.%' order by id`,
        [f.firmId],
      )
    ).rows;
  const allEvents = async () =>
    (
      await su.query<{ n: number }>("select count(*)::int as n from events where firm_id = $1", [
        f.firmId,
      ])
    ).rows[0]?.n;
  return { f, ann, ben, payroll, ctx, records, payEvents, allEvents };
}

const FILE = csv(
  HEADER,
  "A1,26/10/2026,01/11/2026,37.5,12.50,468.75,06/11/2026",
  "B2,26/10/2026,01/11/2026,8,13.00,,",
  "ZZ9,26/10/2026,01/11/2026,8,13.00,,",
);

describe("importing pay records from the office", () => {
  it("the check saves nothing; the import adds the lines, logged by who without amounts", async () => {
    const t = await importFirm();
    const before = await t.allEvents();
    const check = await importPayFile(t.ctx(), FILE, true);
    expect(check).toEqual({
      status: "done",
      result: {
        kind: "pay",
        dryRun: true,
        created: 2,
        updated: 0,
        unchanged: 0,
        skipped: 1,
        problems: [{ row: 4, problem: "unknown_worker" }],
      },
      regrouped: 0,
    });
    expect(await t.records()).toEqual([]);
    // Nothing logged either (not even the import itself).
    expect(await t.allEvents()).toBe(before);

    expect(await importPayFile(t.ctx(), FILE, false)).toMatchObject({
      status: "done",
      result: { dryRun: false, created: 2, updated: 0, skipped: 1 },
      regrouped: 0,
    });
    expect(await t.records()).toEqual(
      [
        {
          worker_id: t.ann,
          period_start: "2026-10-26",
          period_end: "2026-11-01",
          hours: 37.5,
          rate_pence: 1250,
          gross_pence: 46875,
          pay_date: "2026-11-06",
        },
        {
          worker_id: t.ben,
          period_start: "2026-10-26",
          period_end: "2026-11-01",
          hours: 8,
          rate_pence: 1300,
          gross_pence: null,
          pay_date: null,
        },
      ].sort((a, b) => a.worker_id.localeCompare(b.worker_id)),
    );
    const logged = await t.payEvents();
    expect(logged.map((e) => [e.action, e.actor_type, e.actor_id, e.data])).toEqual([
      [
        "pay_record.imported",
        "office",
        t.payroll,
        { periodStart: "2026-10-26", periodEnd: "2026-11-01", source: "csv" },
      ],
      [
        "pay_record.imported",
        "office",
        t.payroll,
        { periodStart: "2026-10-26", periodEnd: "2026-11-01", source: "csv" },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/1250|468|37\.5/);

    // The same file again changes nothing; a corrected hours line updates.
    expect(await importPayFile(t.ctx(), FILE, false)).toMatchObject({
      result: { created: 0, updated: 0, unchanged: 2 },
    });
    expect(
      await importPayFile(t.ctx(), csv(HEADER, "B2,26/10/2026,01/11/2026,9.5,13.00,,"), false),
    ).toMatchObject({ result: { created: 0, updated: 1 } });
    expect((await t.payEvents()).at(-1)).toMatchObject({
      action: "pay_record.updated",
      data: { fields: ["hours"] },
    });
  });

  it("the worker then sees their line on the pay page", async () => {
    const t = await importFirm();
    await importPayFile(t.ctx(), FILE, false);
    const lines = await myPay(
      {
        firm: { id: t.f.firmId, timezone: "Europe/London" },
        run: withFirm,
        clock: { now: () => NOW },
      },
      stepped(t.ann),
    );
    expect(lines).toEqual([
      {
        periodStart: "2026-10-26",
        periodEnd: "2026-11-01",
        hours: 37.5,
        ratePence: 1250,
        grossPence: 46875,
        payDate: "2026-11-06",
      },
    ]);
  });

  it("payroll and admins only", async () => {
    const t = await importFirm();
    const resourcer = await t.f.office("resourcer");
    const gone = await t.f.office("payroll", "disabled");
    const elsewhere = await importFirm();
    for (const who of [
      resourcer,
      gone,
      elsewhere.payroll,
      "00000000-0000-4000-8000-000000000009",
    ]) {
      expect(await importPayFile(t.ctx(who), FILE, true)).toEqual({ status: "not_allowed" });
    }
    expect(await importPayFile(t.ctx(await t.f.office("admin")), FILE, false)).toMatchObject({
      status: "done",
      result: { created: 2 },
    });
  });

  it("a pay line imported after a wrong-rate query moves the query to its group", async () => {
    const t = await importFirm();
    const thursday = await t.f.shift({ startsAt: new Date("2026-10-29T08:00:00Z") });
    await t.f.booking(t.ann, thursday, "completed", 1);
    await raisePayQuery(
      {
        firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
        run: withFirm,
        clock: { now: () => NOW },
      },
      stepped(t.ann),
      { shiftId: thursday, day: null, issue: "wrong_rate", details: null },
    );
    const key = async () =>
      (
        await su.query<{ group_key: string }>(
          "select group_key from pay_queries where firm_id = $1",
          [t.f.firmId],
        )
      ).rows[0]?.group_key;
    expect(await key()).toBe("pay1:wrong_rate:2026-10-26:rate:none");
    // The check moves nothing.
    expect(await importPayFile(t.ctx(), FILE, true)).toMatchObject({ regrouped: 0 });
    expect(await key()).toBe("pay1:wrong_rate:2026-10-26:rate:none");
    expect(await importPayFile(t.ctx(), FILE, false)).toMatchObject({ regrouped: 1 });
    expect(await key()).toBe("pay1:wrong_rate:2026-10-26:rate:1250");
    // Logged, so the action log explains why the group changed.
    expect(
      (
        await su.query<{ data: Record<string, unknown> }>(
          "select data from events where firm_id = $1 and action = 'pay_query.regrouped'",
          [t.f.firmId],
        )
      ).rows.map((r) => r.data),
    ).toEqual([{ changed: 1 }]);
  });

  it("regrouping touches only this firm's queries", async () => {
    const t = await importFirm();
    const other = await importFirm();
    // The other firm has a waiting wrong-rate query whose key would change if its pay line were
    // there; this firm's import mustn't touch it or count it.
    const friday = await other.f.shift({ startsAt: new Date("2026-10-30T08:00:00Z") });
    await other.f.booking(other.ann, friday, "completed", 1);
    await raisePayQuery(
      {
        firm: { id: other.f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
        run: withFirm,
        clock: { now: () => NOW },
      },
      stepped(other.ann),
      { shiftId: friday, day: null, issue: "wrong_rate", details: null },
    );
    await su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
       values ($1, $2, '2026-10-26', '2026-11-01', 8, 1400)`,
      [other.f.firmId, other.ann],
    );
    expect(await importPayFile(t.ctx(), FILE, false)).toMatchObject({ regrouped: 0 });
    const { rows } = await su.query<{ group_key: string }>(
      "select group_key from pay_queries where firm_id = $1",
      [other.f.firmId],
    );
    expect(rows.map((r) => r.group_key)).toEqual(["pay1:wrong_rate:2026-10-26:rate:none"]);
  });

  it("files it can't take: too big, a column missing, not a spreadsheet; another firm's staff are unknown", async () => {
    const t = await importFirm();
    expect(await importPayFile(t.ctx(), new Uint8Array(WEB_IMPORT_MAX_BYTES + 1), true)).toEqual({
      status: "too_big",
    });
    expect(
      await importPayFile(
        t.ctx(),
        csv("Staff ID,Period start,Period end,Hours", "A1,1/1/26,2/1/26,8"),
        true,
      ),
    ).toEqual({ status: "file_error", code: "missing_column" });
    expect(await importPayFile(t.ctx(), new Uint8Array([0x00, 0x01, 0x02, 0xff]), true)).toEqual({
      status: "file_error",
      code: "not_text",
    });
    const other = await importFirm();
    await su.query("update workers set external_ref = 'X7' where id = $1", [other.ann]);
    expect(
      await importPayFile(t.ctx(), csv(HEADER, "X7,26/10/2026,01/11/2026,8,13.00,,"), false),
    ).toMatchObject({
      result: { created: 0, skipped: 1, problems: [{ row: 2, problem: "unknown_worker" }] },
    });
    expect(await other.records()).toEqual([]);
  });
});
