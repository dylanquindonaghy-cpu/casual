import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runOfferWave, type OfferDeps } from "@/lib/offers/waves";
import { editShift } from "@/lib/office/shift-editor";
import { assignWorker } from "@/lib/office/quick-actions";
import { takeShift } from "@/lib/portal/take-shift";
import type { PushTransport } from "@/lib/push/transport";
import { cancelBooking } from "@/lib/roster/cancel";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { closeShift } from "@/lib/roster/close";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// A casual cancelling under 48 hours a shift they took confirms against the strike warning (12C.1).
const STRIKE_WARNING = { kind: "strike", version: STRIKE_WARNING_VERSION } as const;

// When a shift fills, every offer of it still waiting is answered at once, in every mode and by
// every route that fills it (src/lib/offers/close.ts; audit finding M5): an offered worker who holds
// a place took it (`accepted`), everyone else's was filled elsewhere (`filled_elsewhere`), logged
// `offer.closed`. Before, only a later wave noticing the fill closed them, so under first come,
// first served (the default) and after the last fair-rotation wave they showed "waiting" for ever.
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

const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};
const clock = { now: () => NOW };

// A firm in the given mode with `count` door supervisors, an urgent shift at 19:00 today with
// `headcount` places, and a resourcer; wave 1 sent to whoever it goes to.
async function offeredShift(settings: Record<string, unknown>, count: number, headcount = 1) {
  const f = await bookingFirm(su, withFirm, { settings });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await f.worker({ first: `W${i}` }));
  const shiftId = await f.shift({ startsAt: hoursFromNow(10), headcount });
  await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
  const officeId = await f.office("resourcer");
  const { transport } = captureTransport();
  const deps: OfferDeps = { transport, push: noPush, baseDomain: "localhost:3000", clock };
  const wave = await runOfferWave(
    { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:1`, shiftId, wave: 1 },
    withFirm,
    deps,
  );
  const portal = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
    run: withFirm,
    clock,
  };
  const office = { firm: { id: f.firmId }, officeUserId: officeId, run: withFirm, clock };
  return { f, ids, shiftId, officeId, wave, portal, office };
}

async function responses(shiftId: string): Promise<Record<string, string | null>> {
  const { rows } = await su.query<{ worker_id: string; response: string | null }>(
    "select worker_id::text, response from offers where shift_id = $1",
    [shiftId],
  );
  return Object.fromEntries(rows.map((r) => [r.worker_id, r.response]));
}

async function closedEvents(shiftId: string) {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    "select data from events where entity_id = $1 and action = 'offer.closed' order by id",
    [shiftId],
  );
  return rows.map((r) => r.data);
}

describe("a shift that fills closes its waiting offers at once", () => {
  it("first come, first served (the default): a worker takes it, everyone else's is filled elsewhere", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 4);
    expect(t.wave).toEqual({ status: "sent", sent: 4, next: null });
    const [taker, ...others] = t.ids as [string, ...string[]];
    expect((await takeShift(t.portal, taker, t.shiftId)).status).toBe("booked");
    const r = await responses(t.shiftId);
    expect(r[taker]).toBe("accepted");
    for (const id of others) expect(r[id]).toBe("filled_elsewhere");
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 3 },
    ]);
  });

  it("after the last fair-rotation wave (no next wave to notice it): closed when it's taken", async () => {
    const t = await offeredShift({ allocation_mode: "fair_rotation", wave_size: 2 }, 2);
    expect(t.wave).toEqual({ status: "sent", sent: 2, next: null });
    const [a, b] = t.ids as [string, string];
    expect((await takeShift(t.portal, b, t.shiftId)).status).toBe("booked");
    expect(await responses(t.shiftId)).toEqual({ [b]: "accepted", [a]: "filled_elsewhere" });
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 1 },
    ]);
  });

  it("the office places an offered worker (Assign): their offer accepted, the rest filled elsewhere", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3);
    const [placed, ...others] = t.ids as [string, ...string[]];
    expect((await assignWorker(t.office, t.shiftId, placed, null)).status).toBe("booked");
    const r = await responses(t.shiftId);
    expect(r[placed]).toBe("accepted");
    for (const id of others) expect(r[id]).toBe("filled_elsewhere");
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 2 },
    ]);
  });

  it("the office places someone who wasn't offered it: every offer filled elsewhere", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 2);
    const outsider = await t.f.worker({ first: "Late" }); // joined after the wave
    expect((await assignWorker(t.office, t.shiftId, outsider, null)).status).toBe("booked");
    expect(Object.values(await responses(t.shiftId))).toEqual([
      "filled_elsewhere",
      "filled_elsewhere",
    ]);
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 2 },
    ]);
  });

  it("two places: the first booking closes nothing, the second closes the rest", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 4, 2);
    const [first, second, ...others] = t.ids as [string, string, ...string[]];
    expect((await takeShift(t.portal, first, t.shiftId)).status).toBe("booked");
    const half = await responses(t.shiftId);
    expect(half[first]).toBe("accepted");
    expect([half[second], ...others.map((id) => half[id])]).toEqual([null, null, null]);
    expect(await closedEvents(t.shiftId)).toEqual([]);
    expect((await assignWorker(t.office, t.shiftId, second, null)).status).toBe("booked");
    const full = await responses(t.shiftId);
    expect(full[second]).toBe("accepted");
    for (const id of others) expect(full[id]).toBe("filled_elsewhere");
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 2 },
    ]);
  });

  it("the office marks it filled with a place free: every waiting offer filled elsewhere", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3);
    expect(
      await closeShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, by: { type: "office", id: t.officeId } },
        { clock },
      ),
    ).toMatchObject({ status: "closed" });
    expect(Object.values(await responses(t.shiftId)).sort()).toEqual([
      "filled_elsewhere",
      "filled_elsewhere",
      "filled_elsewhere",
    ]);
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 3 },
    ]);
  });

  it("the office cuts the places to the ones booked: the shift fills and the rest are closed", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3, 2);
    const [booked, ...others] = t.ids as [string, ...string[]];
    expect((await takeShift(t.portal, booked, t.shiftId)).status).toBe("booked");
    expect(await closedEvents(t.shiftId)).toEqual([]);
    // 19:00 to 03:00, the same as before, but 1 place.
    expect(
      await editShift(t.office, t.shiftId, {
        date: "2026-11-02",
        start: "19:00",
        end: "03:00",
        role: "door supervisor",
        siteId: "",
        headcount: "1",
        instructions: "",
      }),
    ).toMatchObject({ status: "saved" });
    const r = await responses(t.shiftId);
    expect(r[booked]).toBe("accepted");
    for (const id of others) expect(r[id]).toBe("filled_elsewhere");
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 2 },
    ]);
  });
});

describe("the answers stay true afterwards", () => {
  it("a dropout reopens it and an earlier offeree takes it: their 'filled elsewhere' becomes accepted", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3);
    const [first, second] = t.ids as [string, string, string];
    expect((await takeShift(t.portal, first, t.shiftId)).status).toBe("booked");
    expect((await responses(t.shiftId))[second]).toBe("filled_elsewhere");
    // The first worker drops out; the place is free again.
    const dropout = new Date(NOW.getTime() + 60 * 60_000);
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: t.shiftId,
          workerId: first,
          reason: "I'm unwell",
          // Under 48 hours on a shift they took: the strike warning they confirmed (12C.1).
          by: { type: "worker", id: first, warning: STRIKE_WARNING },
        },
        { clock: { now: () => dropout } },
      ),
    ).toMatchObject({ status: "cancelled" });
    // The second taps Take shift on their original WhatsApp link.
    const retaken = new Date(NOW.getTime() + 90 * 60_000);
    expect(
      (await takeShift({ ...t.portal, clock: { now: () => retaken } }, second, t.shiftId)).status,
    ).toBe("booked");
    const { rows } = await su.query<{ response: string; responded_at: Date }>(
      "select response, responded_at from offers where shift_id = $1 and worker_id = $2",
      [t.shiftId, second],
    );
    expect(rows).toEqual([{ response: "accepted", responded_at: retaken }]);
  });

  it("two places, both dropouts, an earlier offeree retakes one: accepted with a place still free", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3, 2);
    const [a, b, c] = t.ids as [string, string, string];
    expect((await takeShift(t.portal, a, t.shiftId)).status).toBe("booked");
    expect((await takeShift(t.portal, b, t.shiftId)).status).toBe("booked");
    expect((await responses(t.shiftId))[c]).toBe("filled_elsewhere");
    const dropout = { now: () => new Date(NOW.getTime() + 60 * 60_000) };
    for (const w of [a, b]) {
      expect(
        await cancelBooking(
          withFirm,
          t.f.firmId,
          {
            shiftId: t.shiftId,
            workerId: w,
            reason: "I'm unwell",
            by: { type: "worker", id: w, warning: STRIKE_WARNING },
          },
          { clock: dropout },
        ),
      ).toMatchObject({ status: "cancelled" });
    }
    // One of two places taken again: nothing fills, so only the taker's own answer changes.
    expect((await takeShift({ ...t.portal, clock: dropout }, c, t.shiftId)).status).toBe("booked");
    expect((await responses(t.shiftId))[c]).toBe("accepted");
  });

  it("a holder's offer still waiting when the office marks it filled is accepted, and counted", async () => {
    const t = await offeredShift({ allocation_mode: "first_come_first_served" }, 3, 2);
    const [holder] = t.ids as [string, string, string];
    // Booked by another route that doesn't touch offers (an earlier import, say).
    await t.f.booking(holder, t.shiftId, "confirmed", 1);
    expect(
      await closeShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, by: { type: "office", id: t.officeId } },
        { clock },
      ),
    ).toMatchObject({ status: "closed" });
    const r = await responses(t.shiftId);
    expect(r[holder]).toBe("accepted");
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 1, filledElsewhere: 2 },
    ]);
    // Every closed offer is stamped with the time of the fill.
    const { rows } = await su.query<{ responded_at: Date }>(
      "select responded_at from offers where shift_id = $1",
      [t.shiftId],
    );
    expect(rows.map((x) => x.responded_at)).toEqual([NOW, NOW, NOW]);
  });

  it("fair rotation over two waves: a wave-1 worker takes it after the last wave; all 3 others closed, once", async () => {
    const t = await offeredShift({ allocation_mode: "fair_rotation", wave_size: 2 }, 4);
    expect(t.wave).toEqual({ status: "sent", sent: 2, next: 2 });
    const { transport } = captureTransport();
    const later = new Date(NOW.getTime() + 20 * 60_000);
    const deps: OfferDeps = {
      transport,
      push: noPush,
      baseDomain: "localhost:3000",
      clock: { now: () => later },
    };
    const wave2 = {
      firmId: t.f.firmId,
      idempotencyKey: `offer-wave:${t.shiftId}:2`,
      shiftId: t.shiftId,
      wave: 2,
    };
    expect(await runOfferWave(wave2, withFirm, deps)).toEqual({
      status: "sent",
      sent: 2,
      next: null,
    });
    const before = await responses(t.shiftId);
    const taker = t.ids.find((id) => before[id] === null) ?? "";
    expect(
      (await takeShift({ ...t.portal, clock: { now: () => later } }, taker, t.shiftId)).status,
    ).toBe("booked");
    const after = await responses(t.shiftId);
    expect(Object.values(after).sort()).toEqual([
      "accepted",
      "filled_elsewhere",
      "filled_elsewhere",
      "filled_elsewhere",
    ]);
    expect(await closedEvents(t.shiftId)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 3 },
    ]);
  });

  it("taken between waves: the next wave stops and logs no second close", async () => {
    const t = await offeredShift({ allocation_mode: "fair_rotation", wave_size: 2 }, 4);
    const offered = Object.keys(await responses(t.shiftId));
    expect((await takeShift(t.portal, offered[0] ?? "", t.shiftId)).status).toBe("booked");
    const { transport, sent } = captureTransport();
    const deps: OfferDeps = { transport, push: noPush, baseDomain: "localhost:3000", clock };
    const wave2 = {
      firmId: t.f.firmId,
      idempotencyKey: `offer-wave:${t.shiftId}:2`,
      shiftId: t.shiftId,
      wave: 2,
    };
    expect(await runOfferWave(wave2, withFirm, deps)).toEqual({
      status: "stopped",
      reason: "filled",
    });
    expect(sent).toEqual([]);
    expect(await closedEvents(t.shiftId)).toHaveLength(1);
  });

  it("an offer whose send fails while the shift fills is recorded failed, not filled elsewhere", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "first_come_first_served" },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(await f.worker({ first: `W${i}` }));
    // A wave goes fewest hours this week first (P4.3; before, by worker id): 0, 8 and 16 hours, so
    // the first is messaged, then `failing`, then the wave comes to `taker`.
    const [, failing, taker] = ids as [string, string, string];
    await f.booking(failing, await f.shift({ startsAt: hoursFromNow(72) }));
    for (const h of [72, 96]) await f.booking(taker, await f.shift({ startsAt: hoursFromNow(h) }));
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [failing],
    );
    const failingMobile = rows[0]?.mobile;
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const portal = {
      firm: { id: f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
      run: withFirm,
      clock,
    };
    // Once `failing` is claimed and before that message goes, someone else takes the shift (the
    // fill closes the offer); then that send fails (a timeout: it never arrived). The take is made
    // just after the claim, not inside the send: with 4 messages at once (P4.4) the next claim no
    // longer waits for this send, and would race the take.
    const run: WithFirm = async (firmId, fn) => {
      const value = await withFirm(firmId, fn);
      const claim = value as { kind?: unknown; contact?: { mobile?: unknown } } | null;
      if (claim?.kind === "claimed" && claim.contact?.mobile === failingMobile) {
        expect((await takeShift(portal, taker, shiftId)).status).toBe("booked");
      }
      return value;
    };
    const { transport: capture } = captureTransport();
    const transport: typeof capture = {
      name: "capture",
      async send(message) {
        if (message.to === failingMobile) throw new Error("timed out");
        return capture.send(message);
      },
    };
    expect(
      await runOfferWave(
        { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:1`, shiftId, wave: 1 },
        run,
        { transport, push: noPush, baseDomain: "localhost:3000", clock },
      ),
    ).toEqual({ status: "stopped", reason: "filled", sent: 1 });
    expect((await responses(shiftId))[failing]).toBe("failed");
    const { rows: failed } = await su.query(
      "select 1 from events where entity_id = $1 and action = 'offer.send_failed' and data ->> 'workerId' = $2",
      [shiftId, failing],
    );
    expect(failed).toHaveLength(1);
  });
});
