import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runOfferWave, type OfferDeps } from "@/lib/offers/waves";
import type { PushTransport } from "@/lib/push/transport";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { BULK_MAX, bulkBookings, bulkWorkers } from "../helpers/bulk-seed";
import { appRolePool, superuserPool } from "../helpers/db";

// A big firm's gap (PLAN.md P4.3; decision 10): 2,000 casuals could take one urgent place. First
// come, first served texts the best 5 a wave (fewest hours this week first), not all 2,000: at
// about 20p a text, £1 a wave rather than £400. Real database, app role, fixed clock (NOW is
// Monday 2 November 2026, 09:00 London), nothing sent anywhere.

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

const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

describe("a wave at 2,000 casuals", () => {
  it("2,000 could take one place: each wave texts 5, the fewest hours first, nobody twice", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "first_come_first_served" },
    });
    const ids = await bulkWorkers(su, f.firmId, BULK_MAX);
    // All but 5 (from both number ranges) work Thursday, 8 hours this week: those 5 go first.
    const first = [3, 777, 1000, 1500, 1999].map((i) => ids[i] ?? "");
    const busy = ids.filter((id) => !first.includes(id));
    for (let i = 0; i < busy.length; i += 1000) {
      // At most 1,000 places a shift.
      const thursday = await f.shift({ startsAt: hoursFromNow(72), headcount: 1000 });
      await bulkBookings(su, f.firmId, thursday, busy.slice(i, i + 1000));
    }
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) }); // 19:00 today, one place
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);

    const { transport, sent } = captureTransport();
    const deps = (when: Date): OfferDeps => ({
      transport,
      push: noPush,
      baseDomain: "localhost:3000",
      clock: { now: () => when },
    });
    const wave = (n: number, when: Date) =>
      runOfferWave(
        { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:${n}`, shiftId, wave: n },
        withFirm,
        deps(when),
      );
    const { rows: people } = await su.query<{ id: string; mobile: string }>(
      "select id::text as id, mobile_e164 as mobile from workers where firm_id = $1",
      [f.firmId],
    );
    const byMobile = new Map(people.map((p) => [p.mobile, p.id]));
    const to = () => sent.map((m) => (m.channel === "email" ? "" : (byMobile.get(m.to) ?? m.to)));

    expect(await wave(1, NOW)).toEqual({ status: "sent", sent: 5, next: 2 });
    expect(to().sort()).toEqual([...first].sort());
    expect(await wave(2, new Date(NOW.getTime() + 15 * MINUTE))).toEqual({
      status: "sent",
      sent: 5,
      next: 3,
    });
    expect(sent).toHaveLength(10);
    expect(new Set(to()).size).toBe(10);
    for (const id of to().slice(5)) expect(busy).toContain(id);

    // One offer and one logged send each: 10, not 2,000.
    const { rows: offers } = await su.query<{ n: number; workers: number }>(
      "select count(*)::int as n, count(distinct worker_id)::int as workers from offers where shift_id = $1",
      [shiftId],
    );
    expect(offers[0]).toEqual({ n: 10, workers: 10 });
    const { rows: logged } = await su.query<{ n: number }>(
      "select count(*)::int as n from events where action = 'offer.sent' and data ->> 'shiftId' = $1",
      [shiftId],
    );
    expect(logged[0]?.n).toBe(10);
  }, 180_000);
});
