import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift, previewBooking, previewBookings } from "@/lib/roster/book";
import {
  loadEligibilityInput,
  loadEligibilityInputs,
  pairKey,
} from "@/lib/roster/eligibility-input";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// A session's extra requirements (shifts.required_credentials, 12B.3) reach the rules engine
// through both loaders (one booking, and the batches Open shifts, the urgent board and offer waves
// use), so a casual without one can't book or be offered it and the office can't override it.
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

const clock = { now: () => NOW };
const requires = (shiftId: string, codes: string[]) =>
  su.query("update shifts set required_credentials = $2 where id = $1", [shiftId, codes]);

async function csasFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const without = await f.worker({ first: "NoCsas" }); // SIA_DS and STEWARD_L2 only
  const holder = await f.worker({
    first: "Csas",
    credentials: [
      { type: "SIA_DS", expiresOn: "2029-01-01" },
      { type: "CSAS", expiresOn: "2027-06-01" },
    ],
  });
  const shift = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(48) });
  await requires(shift, ["CSAS"]);
  return { f, without, holder, shift };
}

describe("a session's extra requirements in the rules (12B.3)", () => {
  it("both loaders pass them to the rules; only the casual who holds them may take it", async () => {
    const t = await csasFirm();
    const single = await withFirm(t.f.firmId, async (tx) => ({
      input: await loadEligibilityInput(tx, { shiftId: t.shift, workerId: t.without, now: NOW }),
      without: await previewBooking(tx, { shiftId: t.shift, workerId: t.without, now: NOW }),
      holder: await previewBooking(tx, { shiftId: t.shift, workerId: t.holder, now: NOW }),
    }));
    expect(single.input?.shift).toMatchObject({ requiredTypes: ["SIA_DS"], extraTypes: ["CSAS"] });
    expect(single.without).toMatchObject({ ok: false, codes: ["credential_missing"] });
    expect(single.holder).toMatchObject({ ok: true });

    const batch = await withFirm(t.f.firmId, async (tx) => ({
      inputs: await loadEligibilityInputs(tx, {
        shiftIds: [t.shift],
        workerIds: [t.without, t.holder],
        now: NOW,
      }),
      verdicts: await previewBookings(tx, {
        shiftIds: [t.shift],
        workerIds: [t.without, t.holder],
        now: NOW,
      }),
    }));
    expect(batch.inputs.get(pairKey(t.shift, t.without))?.shift).toMatchObject({
      extraTypes: ["CSAS"],
    });
    expect(batch.verdicts.get(pairKey(t.shift, t.without))).toMatchObject({
      ok: false,
      codes: ["credential_missing"],
    });
    expect(batch.verdicts.get(pairKey(t.shift, t.holder))).toMatchObject({ ok: true });
  });

  it("booking refuses a casual without it, and the office can't override it; one who holds it books", async () => {
    const t = await csasFirm();
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shift, workerId: t.without, by: { type: "worker", id: t.without } },
        { clock },
      ),
    ).toMatchObject({ status: "not_eligible" });
    const office = await t.f.office("resourcer");
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        {
          shiftId: t.shift,
          workerId: t.without,
          by: { type: "office", id: office, overrides: ["rest"], reason: "Short of staff." },
        },
        { clock },
      ),
    ).toMatchObject({ status: "not_eligible" });
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shift, workerId: t.holder, by: { type: "worker", id: t.holder } },
        { clock },
      ),
    ).toMatchObject({ status: "booked" });
  });

  it("one expiring before the session ends refuses; an empty list asks nothing more", async () => {
    const t = await csasFirm();
    // A night session: 22:00 Wednesday to 06:00 Thursday (GMT).
    const night = await t.f.shift({
      role: "door_supervisor",
      startsAt: new Date("2026-11-04T22:00:00Z"),
    });
    await requires(night, ["CSAS"]);
    await su.query(
      "update credentials set expires_on = '2026-11-04' where worker_id = $1 and type = 'CSAS'",
      [t.holder],
    );
    const verdict = (shiftId: string, workerId: string) =>
      withFirm(t.f.firmId, (tx) => previewBooking(tx, { shiftId, workerId, now: NOW }));
    expect(await verdict(night, t.holder)).toMatchObject({
      ok: false,
      codes: ["credential_expired"],
    });
    const plain = await t.f.shift({ role: "door_supervisor", startsAt: hoursFromNow(50) });
    expect(await verdict(plain, t.without)).toMatchObject({ ok: true });
  });

  it("someone deployed on an extra requirement still in progress counts toward the day's 'applied' share", async () => {
    // SIA_SG may count "applied" (the security pack); a steward session that also needs it.
    const t = await csasFirm({ credential_applied_allowance_pct: 50 });
    const applying = await t.f.worker({
      first: "Applying",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_SG", status: "applied", expiresOn: null },
      ],
    });
    const gate = await t.f.shift({ role: "steward", startsAt: hoursFromNow(30) });
    await requires(gate, ["SIA_SG"]);
    await t.f.booking(applying, gate);
    // Another session the same day, seen by someone else: one deployed, and that one "applied".
    const other = await t.f.shift({ role: "door_supervisor", startsAt: hoursFromNow(32) });
    const input = await withFirm(t.f.firmId, (tx) =>
      loadEligibilityInput(tx, { shiftId: other, workerId: t.holder, now: NOW }),
    );
    expect(input?.settings).toMatchObject({ deployedCount: 1, appliedInUseCount: 1 });
    const batch = await withFirm(t.f.firmId, (tx) =>
      loadEligibilityInputs(tx, { shiftIds: [other], workerIds: [t.holder], now: NOW }),
    );
    expect(batch.get(pairKey(other, t.holder))?.settings).toMatchObject({
      deployedCount: 1,
      appliedInUseCount: 1,
    });
  });
});
