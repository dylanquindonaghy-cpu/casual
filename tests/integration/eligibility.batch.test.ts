import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import {
  loadAllocationGate,
  loadAllocationGates,
  parseAllocationSettings,
} from "@/lib/roster/allocation-input";
import { previewBooking, previewBookings } from "@/lib/roster/book";
import {
  loadEligibilityInput,
  loadEligibilityInputs,
  pairKey,
} from "@/lib/roster/eligibility-input";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The batched rules input (loadEligibilityInputs, previewBookings) and fair-rotation gate
// (loadAllocationGates) that Open shifts, the urgent board and the offer candidate list use, held to
// the single versions bookings use, pair for pair, over a deliberately mixed firm. Then the reason
// for them (audit L73, L75): a fixed number of queries however many shifts or workers there are.
// Real database, app role, fixed clock (NOW is Monday 2 November 2026, 09:00 London).

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

const sorted = <T>(list: T[]) =>
  [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// A firm with the applied allowance on, and workers and shifts that hit every kind of answer.
async function mixedFirm() {
  const f = await bookingFirm(su, withFirm, { settings: { credential_applied_allowance_pct: 15 } });
  const both = ["steward", "door_supervisor"];
  const w = {
    ok: await f.worker({ first: "Ok", roles: both }),
    expired: await f.worker({
      first: "Exp",
      roles: both,
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" }],
    }),
    applied: await f.worker({
      first: "App",
      roles: both,
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    }),
    appliedToo: await f.worker({
      first: "App2",
      roles: both,
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    }),
    steward: await f.worker({
      first: "Stew",
      roles: ["steward"],
      credentials: [{ type: "STEWARD_L2", expiresOn: null }],
    }),
    none: await f.worker({ first: "None", roles: both, credentials: [] }),
    inactive: await f.worker({ first: "Gone", roles: both, status: "inactive" }),
    busy: await f.worker({ first: "Busy", roles: both }),
    dayOff: await f.worker({ first: "Off", roles: both }),
    expiring: await f.worker({
      first: "Soon",
      roles: both,
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-03" }],
    }),
    barred: await f.worker({ first: "Barred", roles: both }),
  };
  const s = {
    door: await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(30) }), // Tue 15:00
    doorLate: await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(34) }),
    steward: await f.shift({ role: "steward", startsAt: hoursFromNow(54) }),
    doorWeek: await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(100) }),
    full: await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(31), headcount: 4 }),
    // A session that also needs first aid (12B.3), which only Ok holds.
    firstAid: await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(58) }),
  };
  await su.query("update shifts set required_credentials = '{FIRST_AID}' where id = $1", [
    s.firstAid,
  ]);
  await su.query(
    "insert into credentials (firm_id, worker_id, type, status, expires_on) values ($1, $2, 'FIRST_AID', 'valid', '2028-01-01')",
    [f.firmId, w.ok],
  );
  // Busy: booked on another shift overlapping `door`, and one ending just before `steward` starts.
  await f.booking(w.busy, await f.shift({ startsAt: hoursFromNow(29) }));
  await f.booking(
    w.busy,
    await f.shift({ role: "steward", startsAt: hoursFromNow(40) }),
    "confirmed",
  );
  // The day `door` starts: the applied pair and Ok booked on `full` (counts for the allowance).
  await f.booking(w.applied, s.full, "confirmed", 1);
  await f.booking(w.appliedToo, s.full, "confirmed", 2);
  await f.booking(w.ok, s.full, "confirmed", 3);
  await su.query(
    "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-03')",
    [f.firmId, w.dayOff],
  );
  // Two shifts at one site, and Barred blocked from it (rules check 9).
  const { rows: site } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text",
    [f.firmId],
  );
  await su.query("update shifts set site_id = $2 where id = any($1::uuid[])", [
    [s.door, s.steward],
    site[0]?.id,
  ]);
  await su.query(
    "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'incident')",
    [f.firmId, w.barred, site[0]?.id],
  );
  return { f, w, s };
}

// Every pair, batched and single: the same rules input and the same verdict. Returns the batch's
// verdicts and how many pairs were refused.
async function expectParity(firmId: string, shiftIds: string[], workerIds: string[], now: Date) {
  const { inputs, verdicts } = await withFirm(firmId, async (tx) => ({
    inputs: await loadEligibilityInputs(tx, { shiftIds, workerIds, now }),
    verdicts: await previewBookings(tx, { shiftIds, workerIds, now }),
  }));
  expect(inputs.size).toBe(shiftIds.length * workerIds.length);
  let refused = 0;
  for (const shiftId of shiftIds) {
    for (const workerId of workerIds) {
      const single = await withFirm(firmId, async (tx) => ({
        input: await loadEligibilityInput(tx, { shiftId, workerId, now }),
        verdict: await previewBooking(tx, { shiftId, workerId, now }),
      }));
      const batch = inputs.get(pairKey(shiftId, workerId));
      expect(batch).toBeDefined();
      expect({
        ...batch,
        credentials: sorted(batch?.credentials ?? []),
        otherAssignments: sorted(batch?.otherAssignments ?? []),
        unavailableDates: sorted(batch?.unavailableDates ?? []),
        settings: {
          ...batch?.settings,
          appliedAllowedTypes: sorted(batch?.settings.appliedAllowedTypes ?? []),
        },
      }).toEqual({
        ...single.input,
        credentials: sorted(single.input?.credentials ?? []),
        otherAssignments: sorted(single.input?.otherAssignments ?? []),
        unavailableDates: sorted(single.input?.unavailableDates ?? []),
        settings: {
          ...single.input?.settings,
          appliedAllowedTypes: sorted(single.input?.settings.appliedAllowedTypes ?? []),
        },
      });
      expect(verdicts.get(pairKey(shiftId, workerId))).toEqual(single.verdict);
      if (!single.verdict?.ok) refused += 1;
    }
  }
  return { verdicts, refused };
}

describe("the batched rules give the single rules' answers", () => {
  it("every shift and worker of a mixed firm: the same input and the same verdict", async () => {
    const t = await mixedFirm();
    const shiftIds = Object.values(t.s);
    const workerIds = Object.values(t.w);
    const { verdicts, refused } = await expectParity(t.f.firmId, shiftIds, workerIds, NOW);
    // The fixture really does hit refusals of several kinds, and passes too.
    const codes = new Set([...verdicts.values()].flatMap((v) => v.codes));
    expect(refused).toBeGreaterThan(10);
    expect(refused).toBeLessThan(shiftIds.length * workerIds.length);
    for (const code of [
      "credential_expired",
      "credential_missing",
      "wrong_role",
      "not_active",
      "overlap",
      "unavailable",
      "blocked_site",
    ]) {
      expect([...codes]).toContain(code);
    }
    // A session's extra requirement: only the worker who holds it passes.
    expect(verdicts.get(pairKey(t.s.firstAid, t.w.ok))?.ok).toBe(true);
    expect(verdicts.get(pairKey(t.s.firstAid, t.w.dayOff))?.codes).toEqual(["credential_missing"]);
    // Blocked at the site's shifts only.
    expect(verdicts.get(pairKey(t.s.door, t.w.barred))?.codes).toEqual(["blocked_site"]);
    expect(verdicts.get(pairKey(t.s.doorLate, t.w.barred))?.ok).toBe(true);
  });

  it("with the applied allowance off, the same verdicts (the day's counts can't matter)", async () => {
    const t = await mixedFirm();
    await su.query(
      "update firms set settings = settings || '{\"credential_applied_allowance_pct\": 0}' where id = $1",
      [t.f.firmId],
    );
    const shiftIds = Object.values(t.s);
    const workerIds = Object.values(t.w);
    const verdicts = await withFirm(t.f.firmId, (tx) =>
      previewBookings(tx, { shiftIds, workerIds, now: NOW }),
    );
    for (const shiftId of shiftIds) {
      for (const workerId of workerIds) {
        const single = await withFirm(t.f.firmId, (tx) =>
          previewBooking(tx, { shiftId, workerId, now: NOW }),
        );
        expect(verdicts.get(pairKey(shiftId, workerId))).toEqual(single);
      }
    }
  });

  it("in summer (BST), around local midnight: the same input and verdict, by the London day", async () => {
    // Monday 6 July 2026, 09:00 London (08:00 UTC).
    const now = new Date("2026-07-06T08:00:00Z");
    const f = await bookingFirm(su, withFirm, {
      settings: { credential_applied_allowance_pct: 15 },
    });
    const both = ["steward", "door_supervisor"];
    const w = {
      ok: await f.worker({ first: "Ok", roles: both }),
      applied: await f.worker({
        first: "App",
        roles: both,
        credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
      }),
      appliedToo: await f.worker({
        first: "App2",
        roles: both,
        credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
      }),
      busy: await f.worker({ first: "Busy", roles: both }),
      dayOff: await f.worker({ first: "Off", roles: both }),
      expiring: await f.worker({
        first: "Soon",
        roles: both,
        credentials: [{ type: "SIA_DS", expiresOn: "2026-07-07" }],
      }),
    };
    const at = (iso: string) => new Date(iso);
    const s = {
      // 22:30 to 23:30 London on Tuesday 7 July: only the 7th.
      evening: await f.shift({ startsAt: at("2026-07-07T21:30:00Z"), hours: 1 }),
      // 00:30 London on Wednesday 8 July, though still the 7th in UTC.
      lateNight: await f.shift({ startsAt: at("2026-07-07T23:30:00Z"), hours: 4 }),
      // 01:00 London on the 8th: three booked on it (the day's count for the allowance).
      full: await f.shift({ startsAt: at("2026-07-08T00:00:00Z"), hours: 4, headcount: 4 }),
    };
    await f.booking(w.applied, s.full, "confirmed", 1);
    await f.booking(w.appliedToo, s.full, "confirmed", 2);
    await f.booking(w.ok, s.full, "confirmed", 3);
    await f.booking(w.busy, await f.shift({ startsAt: at("2026-07-07T21:00:00Z"), hours: 2 }));
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-07-08')",
      [f.firmId, w.dayOff],
    );
    const { verdicts } = await expectParity(f.firmId, Object.values(s), Object.values(w), now);
    // The London day, not the UTC one: unavailable on the 8th, so free late on the 7th and not at
    // 00:30 on the 8th (still the 7th in UTC).
    expect(verdicts.get(pairKey(s.evening, w.dayOff))?.codes).not.toContain("unavailable");
    expect(verdicts.get(pairKey(s.lateNight, w.dayOff))?.codes).toContain("unavailable");
  });

  it("the fair-rotation gate: the same answer for every shift, inside and outside its window", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "fair_rotation", wave_size: 2, wave_minutes: 120 },
    });
    const workers: string[] = [];
    for (let i = 0; i < 6; i += 1) workers.push(await f.worker({ first: `W${i}` }));
    // Hours booked in the shifts' own week (from Monday 2 November): 0, 8, 16, 24, 32, 40. Eight-hour
    // shifts nine hours apart from Monday 01:00, all over by Tuesday night.
    for (let i = 0; i < workers.length; i += 1) {
      for (let h = 0; h < i; h += 1) {
        const at = -8 + h * 9;
        await f.booking(
          workers[i] ?? "",
          await f.shift({ startsAt: hoursFromNow(at) }),
          at < 0 ? "completed" : "confirmed",
        );
      }
    }
    // Wednesday to Friday of the same week.
    const shiftIds: string[] = [];
    for (let i = 0; i < 5; i += 1)
      shiftIds.push(await f.shift({ startsAt: hoursFromNow(48 + i * 12) }));
    // Opened 10 minutes ago (inside the 2-hour window), except: [1] opened 5 hours ago (past its
    // window); [2] opened 5 hours ago but reopened by a cancellation an hour ago (inside it again);
    // [3] has W0 on it (8 hours this week now, so the others' cutoff is 8), and its own cutoff is
    // counted without W0.
    const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    await su.query("update shifts set created_at = $2 where id = any($1::uuid[])", [
      shiftIds,
      ago(1 / 6),
    ]);
    await su.query("update shifts set created_at = $2 where id = any($1::uuid[])", [
      [shiftIds[1], shiftIds[2]],
      ago(5),
    ]);
    await f.booking(workers[0] ?? "", shiftIds[2] ?? "", "cancelled_worker", 1);
    await su.query("update assignments set cancelled_at = $2 where shift_id = $1", [
      shiftIds[2],
      ago(1),
    ]);
    await f.booking(workers[0] ?? "", shiftIds[3] ?? "", "confirmed", 1);
    await su.query("update shifts set headcount = 2 where id = $1", [shiftIds[3]]);
    const settings = parseAllocationSettings({
      allocation_mode: "fair_rotation",
      wave_size: 2,
      wave_minutes: 120,
    });
    const answers = new Map<string, boolean>();
    for (const workerId of workers) {
      const batch = await withFirm(f.firmId, (tx) =>
        loadAllocationGates(tx, { shiftIds, workerId, now: NOW }, settings),
      );
      for (const shiftId of shiftIds) {
        const single = await withFirm(f.firmId, (tx) =>
          loadAllocationGate(tx, { shiftId, workerId, now: NOW }, settings),
        );
        expect(batch.get(shiftId)).toEqual(single);
        answers.set(`${workers.indexOf(workerId)}:${shiftIds.indexOf(shiftId)}`, single.ok);
      }
    }
    // The fixture does what it says. W2 (16 hours): held on [0] (the two lowest are W0's 8 and
    // W1's 8); free on [1] (past its window); held on [2] (reopened); free on [3] (without W0, the
    // two lowest are 8 and 16). W1 (8) is free on [0]; W5 (40) is held on [4]; W0 is on [3].
    expect(
      ["2:0", "2:1", "2:2", "2:3", "1:0", "5:4", "0:3"].map((k) => [k, answers.get(k)]),
    ).toEqual([
      ["2:0", false],
      ["2:1", true],
      ["2:2", false],
      ["2:3", true],
      ["1:0", true],
      ["5:4", false],
      ["0:3", true],
    ]);
  });
});

// A pool that counts the statements sent through it.
function countingPool() {
  const pool = appRolePool(1);
  const counter = { n: 0 };
  pool.on("connect", (client: PoolClient) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (
      ...args: unknown[]
    ) => {
      counter.n += 1;
      return query(...args);
    };
  });
  return { pool, counter, run: createWithFirm(pool) };
}

describe("a bounded number of queries (audit L73, L75)", () => {
  it("Open shifts and the urgent board: the same count for 5 shifts as for 40", async () => {
    const counts: number[] = [];
    for (const n of [5, 40]) {
      const f = await bookingFirm(su, withFirm, {
        settings: {
          allocation_mode: "fair_rotation",
          wave_size: 2,
          wave_minutes: 120,
          credential_applied_allowance_pct: 15,
        },
      });
      const me = await f.worker({ first: "Me" });
      for (let i = 0; i < 4; i += 1) await f.worker({ first: `O${i}` });
      for (let i = 0; i < n; i += 1) {
        const id = await f.shift({ startsAt: hoursFromNow(30 + i), headcount: 2 });
        if (i % 2 === 0) await su.query("update shifts set is_urgent = true where id = $1", [id]);
      }
      await su.query("update shifts set created_at = $2 where firm_id = $1", [
        f.firmId,
        new Date(NOW.getTime() - 10 * 60_000),
      ]);
      const c = countingPool();
      const ctx = { firm: { id: f.firmId }, run: c.run, clock: { now: () => NOW } };
      const list = await openShiftsFor(ctx, me);
      expect(list.shifts.length).toBe(n);
      const board = await openShiftsFor(ctx, me, { urgent: true });
      expect(board.shifts.length).toBe(Math.ceil(n / 2));
      counts.push(c.counter.n);
      await c.pool.end();
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeLessThan(60);
  });

  it("the offer candidate list: the same count for 5 workers as for 60", async () => {
    const counts: number[] = [];
    for (const n of [5, 60]) {
      const f = await bookingFirm(su, withFirm, {
        settings: { credential_applied_allowance_pct: 15 },
      });
      for (let i = 0; i < n; i += 1) await f.worker({ first: `W${i}` });
      const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
      const c = countingPool();
      const list = await c.run(f.firmId, (tx) => waveCandidates(tx, shiftId, NOW));
      expect(list).toHaveLength(n);
      counts.push(c.counter.n);
      await c.pool.end();
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeLessThan(25);
  });
});

describe("the lookups have their indexes (audit L74, L76)", () => {
  it("a worker's credentials, a worker's phones, and messages from a number", async () => {
    const { rows } = await su.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where indexname in ('credentials_firm_id_worker_id_idx',
                            'push_subscriptions_firm_id_worker_id_idx',
                            'messages_firm_id_from_e164_idx')
        order by indexname`,
    );
    expect(rows.map((r) => r.indexdef.replace(/^.* USING btree /, ""))).toEqual([
      "(firm_id, worker_id)",
      "(firm_id, from_e164)",
      "(firm_id, worker_id)",
    ]);
  });
});
