import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { casualsList } from "@/lib/office/casuals";
import { workerAccessView } from "@/lib/office/worker-access";
import { saveMyTravel } from "@/lib/portal/travel";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's Casuals pages (12F.1; docs/office-v2.md 3.7) on the real database, as the app role:
// the list's views and counts, each row's qualifications (worst first), travel district, live
// strikes and what needs updating; a casual's page with the same, their right to work and their
// strikes; who may see them; and each firm's own. NOW is Monday 2 November 2026, 09:00 London.

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

const clock = { now: () => NOW };

async function casualsFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const ctx = (officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
  });
  const list = (view: "all" | "needs" = "all", officeUserId = resourcer) =>
    casualsList(ctx(officeUserId), view);
  // A strike on a cancelled booking, issued `daysAgo` and counting for 90 days.
  const strike = async (
    workerId: string,
    daysAgo: number,
    status: "live" | "withdrawn" = "live",
  ) => {
    const shiftId = await f.shift({ startsAt: hoursFromNow(-daysAgo * 24 + 20) });
    const { rows } = await su.query<{ id: string }>(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at,
                                cancelled_at, cancel_reason, notice_hours, cancel_via)
       values ($1, $2, 1, $3, 'cancelled_worker', $4, $4, 'Travel problem', 20, 'app')
       returning id::text as id`,
      [f.firmId, shiftId, workerId, hoursFromNow(-daysAgo * 24)],
    );
    await su.query(
      `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                            threshold_hours, issued_at, expires_at, status, withdrawn_at,
                            withdrawn_by, withdrawn_reason)
       values ($1, $2, $3, $4, 20, 48, $5, $5::timestamptz + interval '90 days', $6, $7, $9, $8)`,
      [
        f.firmId,
        workerId,
        rows[0]?.id,
        shiftId,
        hoursFromNow(-daysAgo * 24),
        status,
        status === "withdrawn" ? NOW : null,
        status === "withdrawn" ? "Hospital letter" : null,
        status === "withdrawn" ? resourcer : null,
      ],
    );
    return rows[0]?.id ?? "";
  };
  return { f, ctx, list, strike, resourcer };
}

describe("the Casuals list", () => {
  it("everyone not erased, by name, with qualifications worst first, district, live strikes and needs", async () => {
    const t = await casualsFirm();
    const ann = await t.f.worker({
      first: "Ann",
      roles: ["door_supervisor", "steward"],
      credentials: [
        { type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" },
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    const ben = await t.f.worker({
      first: "Ben",
      roles: ["steward"],
      credentials: [{ type: "STEWARD_L2", expiresOn: null }],
    });
    const gone = await t.f.worker({ first: "Gone" });
    // Erased, as src/lib/gdpr/worker-erase.ts leaves a worker.
    await su.query(
      `update workers set erased_at = now(), mobile_e164 = null, email = null, external_ref = null,
              first_name = 'Deleted', last_name = 'worker', status = 'inactive', roles = '{}'
        where id = $1`,
      [gone],
    );
    await saveMyTravel(
      { firm: { id: t.f.firmId }, run: withFirm, clock, geocoder: fakeGeocoder },
      ann,
      { postcode: "ZZ1 4AB", modes: "both", maxMinutes: 45 },
    );
    await t.strike(ann, 10);
    await t.strike(ann, 120); // past its 90 days: no longer counts
    await t.strike(ann, 5, "withdrawn");

    const list = await t.list();
    expect(list?.counts).toEqual({ all: 2, needs: 1 });
    expect(list?.rows.map((r) => r.id)).toEqual([ann, ben]); // both "Booker": by first name
    const [a, b] = list?.rows ?? [];
    expect(a?.qualifications.map((q) => [q.type, q.status])).toEqual([
      ["SIA_DS", "expired"],
      ["STEWARD_L2", "valid"],
    ]);
    expect(a?.travel).toEqual({ district: "ZZ1", maxMinutes: 45, modes: "both" });
    expect(JSON.stringify(list)).not.toContain("ZZ1 4AB"); // never the full postcode
    expect(a?.liveStrikes).toBe(1);
    expect(a?.needs.map((n) => [n.level, n.qualification.type])).toEqual([[2, "SIA_DS"]]);
    expect(b).toMatchObject({ travel: null, liveStrikes: 0, needs: [] });
  });

  it("'Need updating': active casuals only, the worst first; inactive and blocked ones aren't", async () => {
    const t = await casualsFirm();
    const soon = await t.f.worker({
      first: "Soon",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-20" }],
    });
    const blocking = await t.f.worker({
      first: "Booked",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-03" }],
    });
    await t.f.booking(blocking, await t.f.shift({ startsAt: hoursFromNow(4 * 24) }));
    const missing = await t.f.worker({
      first: "Missing",
      roles: ["door_supervisor"],
      credentials: [],
    });
    const inactive = await t.f.worker({
      first: "Left",
      roles: ["door_supervisor"],
      credentials: [],
    });
    await su.query("update workers set status = 'inactive' where id = $1", [inactive]);
    await t.f.worker({
      first: "Fine",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", expiresOn: "2029-01-01" }],
    });

    const needs = await t.list("needs");
    expect(needs?.view).toBe("needs");
    expect(needs?.counts).toEqual({ all: 5, needs: 3 });
    expect(needs?.rows.map((r) => r.id)).toEqual([blocking, soon, missing]);
    expect(needs?.rows[0]?.needs[0]).toMatchObject({
      level: 1,
      blocks: { role: "door_supervisor", day: "2026-11-06" },
    });
    // All still lists the inactive casual.
    expect((await t.list("all"))?.rows.map((r) => r.id)).toContain(inactive);
  });

  it("only admins and resourcers who are active may see it", async () => {
    const t = await casualsFirm();
    await t.f.worker();
    const admin = await t.f.office("admin");
    const payroll = await t.f.office("payroll");
    const disabled = await t.f.office("resourcer", "disabled");
    expect(await t.list("all", admin)).not.toBeNull();
    expect(await t.list("all", payroll)).toBeNull();
    expect(await t.list("all", disabled)).toBeNull();
  });

  it("each firm sees only its own", async () => {
    const a = await casualsFirm();
    const b = await casualsFirm();
    const ann = await a.f.worker({ first: "Ann" });
    const bea = await b.f.worker({ first: "Bea" });
    await b.strike(bea, 3);
    const list = await a.list();
    expect(list?.rows.map((r) => r.id)).toEqual([ann]);
    expect(list?.counts.all).toBe(1);
    // A's resourcer asking with B's firm: not theirs.
    expect(await casualsList({ ...a.ctx(), firm: { id: b.f.firmId } }, "all")).toBeNull();
  });
});

describe("one casual's page", () => {
  it("needs updating, qualifications, right to work, travel district, strikes and bookings ahead", async () => {
    const t = await casualsFirm();
    const ann = await t.f.worker({
      first: "Ann",
      roles: ["door_supervisor", "steward"],
      credentials: [
        { type: "SIA_DS", expiresOn: "2026-11-25" },
        { type: "STEWARD_L2", status: "suspended", expiresOn: null },
      ],
    });
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status, verified_at)
       values ($1, $2, 'RTW', 'valid', '2026-01-12T10:00:00Z')`,
      [t.f.firmId, ann],
    );
    await t.f.booking(ann, await t.f.shift({ startsAt: hoursFromNow(48) }));
    const record = await t.strike(ann, 10);
    await t.strike(ann, 5, "withdrawn");

    const page = await workerAccessView(t.ctx(), ann);
    expect(page?.qualifications.map((q) => [q.type, q.status])).toEqual([
      ["STEWARD_L2", "suspended"],
      ["SIA_DS", "expiring_soon"],
    ]);
    expect(page?.rightToWork).toEqual({ checked: true, checkedOn: "2026-01-12" });
    expect(page?.needs.map((n) => [n.level, n.qualification.type])).toEqual([
      [2, "STEWARD_L2"],
      [3, "SIA_DS"],
    ]);
    expect(page?.liveStrikes).toBe(1);
    expect(page?.strikes.map((s) => [s.status, s.counting])).toEqual([
      ["withdrawn", false],
      ["live", true],
    ]);
    expect(page?.strikes[1]?.assignmentId).toBe(record);
    expect(page?.ahead).toHaveLength(1);
    expect(page?.timeZone).toBe("Europe/London");
  });

  it("payroll, and another firm, get nothing", async () => {
    const t = await casualsFirm();
    const other = await casualsFirm();
    const ann = await t.f.worker();
    const payroll = await t.f.office("payroll");
    expect(await workerAccessView(t.ctx(payroll), ann)).toBeNull();
    expect(await workerAccessView(other.ctx(), ann)).toBeNull();
  });
});
