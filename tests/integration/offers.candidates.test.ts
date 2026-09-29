import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { previewBooking } from "@/lib/roster/book";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Who a shift offer may go to (src/lib/offers/candidates.ts), on the real database as the app
// role: only workers the rules allow, and at most 3 offers per worker per firm-local day unless
// the offer is urgent. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

// `count` offers to the worker for other shifts, sent at `at`, with this response.
async function offersFor(
  f: BookingFirm,
  workerId: string,
  count: number,
  at: Date,
  response: string | null = null,
) {
  for (let i = 0; i < count; i++) {
    const other = await f.shift({ startsAt: hoursFromNow(200 + i * 24) });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at, response,
                           responded_at)
       values ($1, $2, $3, 1, 'whatsapp', $4::timestamptz, $5,
               case when $5::text is null then null else $4::timestamptz end)`,
      [f.firmId, other, workerId, at, response],
    );
  }
}

// The candidates for a shift, with the shift marked urgent or not first (the list reads the
// urgency from the shift itself).
async function candidates(f: BookingFirm, shiftId: string, urgent: boolean, now = NOW) {
  await su.query("update shifts set is_urgent = $2 where id = $1", [shiftId, urgent]);
  return withFirm(f.firmId, async (tx) =>
    (await waveCandidates(tx, shiftId, now)).map((c) => c.workerId).sort(),
  );
}

describe("the daily offer cap", () => {
  it("not urgent: a worker offered 3 shifts today is left out; one offered 2 isn't", async () => {
    const f = await bookingFirm(su, withFirm);
    const two = await f.worker({ first: "Two" });
    const three = await f.worker({ first: "Three" });
    const none = await f.worker({ first: "None" });
    await offersFor(f, two, 2, hoursFromNow(-2));
    await offersFor(f, three, 3, hoursFromNow(-1));
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });

    expect(await candidates(f, shiftId, false)).toEqual([none, two].sort());
  });

  it("urgent: the cap doesn't apply", async () => {
    const f = await bookingFirm(su, withFirm);
    const three = await f.worker({ first: "Three" });
    const many = await f.worker({ first: "Many" });
    await offersFor(f, three, 3, hoursFromNow(-1));
    await offersFor(f, many, 6, hoursFromNow(-3));
    const shiftId = await f.shift({ startsAt: hoursFromNow(8) });

    expect(await candidates(f, shiftId, true)).toEqual([many, three].sort());
  });

  it("yesterday's offers don't count, nor ones that failed to send", async () => {
    const f = await bookingFirm(su, withFirm);
    const yesterday = await f.worker({ first: "Yday" });
    const failed = await f.worker({ first: "Failed" });
    const mixed = await f.worker({ first: "Mixed" });
    // 23:59 on Sunday, London (GMT): the day before.
    await offersFor(f, yesterday, 3, new Date("2026-11-01T23:59:00Z"));
    await offersFor(f, failed, 3, hoursFromNow(-1), "failed");
    await offersFor(f, mixed, 2, hoursFromNow(-1));
    await offersFor(f, mixed, 1, hoursFromNow(-1), "failed");
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });

    expect(await candidates(f, shiftId, false)).toEqual([failed, mixed, yesterday].sort());
  });

  it("answered offers still count: accepted, declined, expired, filled elsewhere", async () => {
    const f = await bookingFirm(su, withFirm);
    const w = await f.worker({ first: "Busy" });
    await offersFor(f, w, 1, hoursFromNow(-5), "accepted");
    await offersFor(f, w, 1, hoursFromNow(-4), "declined");
    await offersFor(f, w, 1, hoursFromNow(-3), "expired");
    await offersFor(f, w, 1, hoursFromNow(-2), "filled_elsewhere");
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });

    expect(await candidates(f, shiftId, false)).toEqual([]);
  });

  it("the day is London's: in summer, an offer at 23:30 UTC counts for the next day", async () => {
    const summer = new Date("2026-07-15T09:00:00Z"); // 10:00 BST, Wednesday
    const f = await bookingFirm(su, withFirm);
    const early = await f.worker({ first: "Early" }); // 3 offers at 00:30 BST today
    const late = await f.worker({ first: "Late" }); // 3 offers at 23:59 BST yesterday
    await offersFor(f, early, 3, new Date("2026-07-14T23:30:00Z"));
    await offersFor(f, late, 3, new Date("2026-07-14T22:59:00Z"));
    const shiftId = await f.shift({ startsAt: new Date(summer.getTime() + 30 * HOUR) });

    expect(await candidates(f, shiftId, false, summer)).toEqual([late]);
  });

  // Its offers could never count anyway: an offer's composite key (firm_id, worker_id) ties it to a
  // worker of its own firm. This shows RLS keeps the other firm's workers out of the list.
  it("another firm's workers are never candidates, however many offers they've had", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const w = await f.worker({ first: "Mine" });
    const theirs = await other.worker({ first: "Theirs" });
    await offersFor(other, theirs, 3, hoursFromNow(-1));
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });

    expect(await candidates(f, shiftId, false)).toEqual([w]);
  });
});

describe("only eligible workers", () => {
  // One eligible worker and one of each kind the rules or the worker's settings leave out. The last
  // three are out only for `twoPlaces` (on it, cancelled off it, offered it); `onIt` is also out
  // for `shiftId`, which clashes with the place they hold.
  async function mixedFirm() {
    const f = await bookingFirm(su, withFirm);
    const startsAt = hoursFromNow(30); // Tuesday 15:00
    const shiftId = await f.shift({ startsAt });
    const ok = await f.worker({ first: "Ok" });
    const out = {
      noLicence: await f.worker({ first: "NoLicence", credentials: [] }),
      expired: await f.worker({
        first: "Expired",
        credentials: [
          { type: "STEWARD_L2", expiresOn: null },
          { type: "SIA_DS", expiresOn: "2026-10-01", status: "expired" },
        ],
      }),
      suspended: await f.worker({
        first: "Suspended",
        credentials: [
          { type: "STEWARD_L2", expiresOn: null },
          { type: "SIA_DS", expiresOn: "2029-01-01", status: "suspended" },
        ],
      }),
      otherRole: await f.worker({ first: "Steward", roles: ["steward"] }),
      inactive: await f.worker({ first: "Inactive", status: "inactive" }),
      blocked: await f.worker({ first: "Blocked", status: "blocked" }),
      alertsOff: await f.worker({ first: "AlertsOff" }),
      unavailable: await f.worker({ first: "Away" }),
      overlapping: await f.worker({ first: "Overlap" }),
      onIt: await f.worker({ first: "OnIt" }),
      cancelledOff: await f.worker({ first: "Cancelled" }),
      offeredBefore: await f.worker({ first: "Offered" }),
    };
    await su.query("update workers set offer_alerts = false where id = $1", [out.alertsOff]);
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-03')",
      [f.firmId, out.unavailable],
    );
    // Booked on another shift at the same time.
    await f.booking(out.overlapping, await f.shift({ startsAt: hoursFromNow(31) }), "confirmed");
    const twoPlaces = await f.shift({ startsAt, headcount: 2 });
    await f.booking(out.onIt, twoPlaces, "confirmed", 1);
    await f.booking(out.cancelledOff, twoPlaces, "cancelled_worker", 2);
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [f.firmId, twoPlaces, out.offeredBefore, hoursFromNow(-1)],
    );
    return { f, shiftId, twoPlaces, ok, out };
  }

  it("urgent or not, only the workers the rules allow are candidates", async () => {
    const { f, shiftId, ok, out } = await mixedFirm();
    const allowed = [ok, out.cancelledOff, out.offeredBefore].sort();
    expect(await candidates(f, shiftId, true)).toEqual(allowed);
    expect(await candidates(f, shiftId, false)).toEqual(allowed);
  });

  it("on a shift some already hold or were offered: never them again", async () => {
    const { f, twoPlaces, ok } = await mixedFirm();
    expect(await candidates(f, twoPlaces, true)).toEqual([ok]);
  });

  it("every candidate is one the booking rules say yes to, on the same rows", async () => {
    const { f, shiftId, ok, out } = await mixedFirm();
    const verdicts = await withFirm(f.firmId, async (tx) => {
      const all = [ok, ...Object.values(out)];
      const result: Record<string, boolean> = {};
      for (const workerId of all) {
        result[workerId] = (await previewBooking(tx, { shiftId, workerId, now: NOW }))?.ok ?? false;
      }
      return result;
    });
    const chosen = await candidates(f, shiftId, true);
    for (const workerId of chosen) expect(verdicts[workerId]).toBe(true);
    // The credential and clash cases are the rules' "no", not a filter of their own.
    for (const w of [out.noLicence, out.expired, out.suspended, out.unavailable, out.overlapping]) {
      expect(verdicts[w]).toBe(false);
    }
  });
});
