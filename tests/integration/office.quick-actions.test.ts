import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { OutboundMessage } from "@/lib/messaging/transport";
import { runEscalation, runOfferWave, type OfferDeps } from "@/lib/offers/waves";
import { markFilled, markUrgent, openAgain } from "@/lib/office/quick-actions";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The dashboard's quick actions (src/lib/office/quick-actions.ts → src/lib/roster/close.ts and urgent.ts)
// on the real database, as the app role. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const clock = { clock: { now: () => NOW } };

async function firmWithShift(o: { headcount?: number; startsAt?: Date } = {}) {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const shiftId = await f.shift({
    startsAt: o.startsAt ?? hoursFromNow(10),
    headcount: o.headcount ?? 1,
  });
  const ctx = {
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => NOW },
  };
  return { f, resourcer, shiftId, ctx };
}

const statusOf = async (shiftId: string) =>
  (await su.query<{ status: string }>("select status from shifts where id = $1", [shiftId])).rows[0]
    ?.status;
const eventsOf = async (firmId: string, entityId: string) =>
  (
    await su.query<{ action: string; actor_type: string; actor_id: string; data: unknown }>(
      `select action, actor_type, actor_id::text, data from events
        where firm_id = $1 and entity_id = $2 order by id`,
      [firmId, entityId],
    )
  ).rows;

describe("Mark as filled", () => {
  it("closes an open shift with places free, logged as the office's", async () => {
    const t = await firmWithShift({ headcount: 2 });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, t.shiftId, "confirmed", 1);
    expect(await markFilled(t.ctx, t.shiftId)).toEqual({ status: "closed", placesLeft: 1 });
    expect(await statusOf(t.shiftId)).toBe("filled");
    expect(await eventsOf(t.f.firmId, t.shiftId)).toEqual([
      {
        action: "shift.closed",
        actor_type: "office",
        actor_id: t.resourcer,
        data: { by: "firm", placesLeft: 1 },
      },
    ]);
  });

  it("then nobody can book it, waves stop, escalation isn't needed, and unanswered offers are filled elsewhere", async () => {
    const t = await firmWithShift();
    await t.f.office("admin");
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    const ben = await t.f.worker({ first: "Ben" });
    const cal = await t.f.worker({ first: "Cal" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [t.f.firmId, t.shiftId, ben, hoursFromNow(-1)],
    );
    await markFilled(t.ctx, t.shiftId);

    const { rows } = await su.query<{ response: string }>(
      "select response from offers where shift_id = $1",
      [t.shiftId],
    );
    expect(rows).toEqual([{ response: "filled_elsewhere" }]);
    const booked = await bookShift(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: cal, by: { type: "worker", id: cal } },
      clock,
    );
    expect(booked.status).toBe("filled");

    const { transport, sent } = captureTransport();
    const deps: OfferDeps = {
      transport,
      push: {
        name: "none",
        async send() {
          return { status: "skipped" };
        },
      },
      baseDomain: "localhost:3000",
      clock: { now: () => NOW },
    };
    expect(
      await runOfferWave(
        { firmId: t.f.firmId, idempotencyKey: "k:2", shiftId: t.shiftId, wave: 2 },
        withFirm,
        deps,
      ),
    ).toEqual({ status: "stopped", reason: "filled" });
    expect(
      await runEscalation(
        { firmId: t.f.firmId, idempotencyKey: "k:e", shiftId: t.shiftId },
        withFirm,
        { ...deps, clock: { now: () => hoursFromNow(7) } },
      ),
    ).toEqual({ status: "not_needed" });
    expect(sent as OutboundMessage[]).toEqual([]);
  });

  it("Open it again: back to open, logged; a shift that isn't urgent gets no offers by itself", async () => {
    const t = await firmWithShift();
    await markFilled(t.ctx, t.shiftId);
    expect(await openAgain(t.ctx, t.shiftId)).toEqual({ status: "reopened", placesLeft: 1 });
    expect(await statusOf(t.shiftId)).toBe("open");
    expect((await eventsOf(t.f.firmId, t.shiftId)).map((e) => e.action)).toEqual([
      "shift.closed",
      "shift.reopened",
    ]);
    const { rows } = await su.query("select 1 from pgboss.job where data ->> 'shiftId' = $1", [
      t.shiftId,
    ]);
    expect(rows).toEqual([]);
  });

  it("twice, or opening an open or full shift: nothing changes, nothing is logged", async () => {
    const t = await firmWithShift();
    await markFilled(t.ctx, t.shiftId);
    expect(await markFilled(t.ctx, t.shiftId)).toEqual({ status: "unchanged" });
    await openAgain(t.ctx, t.shiftId);
    expect(await openAgain(t.ctx, t.shiftId)).toEqual({ status: "unchanged" });

    const full = await t.f.shift({ startsAt: hoursFromNow(30) });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, full);
    await su.query("update shifts set status = 'filled' where id = $1", [full]);
    expect(await openAgain(t.ctx, full)).toEqual({ status: "unchanged" });
    expect(await statusOf(full)).toBe("filled");
    expect((await eventsOf(t.f.firmId, t.shiftId)).map((e) => e.action)).toEqual([
      "shift.closed",
      "shift.reopened",
    ]);
  });

  it("not a started, draft or cancelled shift; not a sheet's shift; not another firm's", async () => {
    const t = await firmWithShift();
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    const draft = await t.f.shift({ status: "draft" });
    const cancelled = await t.f.shift({ status: "cancelled" });
    const sheet = await t.f.shift({ source: "sheets" });
    for (const id of [started, draft, cancelled]) {
      expect(await markFilled(t.ctx, id)).toEqual({ status: "not_open" });
    }
    expect(await markFilled(t.ctx, sheet)).toEqual({ status: "sheet" });
    const other = await firmWithShift();
    expect(await markFilled(t.ctx, other.shiftId)).toEqual({ status: "not_found" });
    expect(await markFilled(t.ctx, "not-a-uuid")).toEqual({ status: "not_found" });
    expect(await statusOf(other.shiftId)).toBe("open");
  });

  it("only active admins and resourcers", async () => {
    const t = await firmWithShift();
    const payroll = await t.f.office("payroll");
    const disabled = await t.f.office("resourcer", "disabled");
    for (const officeUserId of [payroll, disabled]) {
      expect(await markFilled({ ...t.ctx, officeUserId }, t.shiftId)).toEqual({
        status: "not_allowed",
      });
      expect(await markUrgent({ ...t.ctx, officeUserId }, t.shiftId, true)).toEqual({
        status: "not_allowed",
      });
    }
    expect(await statusOf(t.shiftId)).toBe("open");
  });

  it("an offered worker the office placed on it took it; the others' offers were filled elsewhere", async () => {
    const t = await firmWithShift({ headcount: 2 });
    const ann = await t.f.worker({ first: "Ann" });
    const ben = await t.f.worker({ first: "Ben" });
    for (const w of [ann, ben]) {
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.f.firmId, t.shiftId, w, hoursFromNow(-1)],
      );
    }
    await t.f.booking(ann, t.shiftId, "confirmed", 1); // the office placed Ann
    await markFilled(t.ctx, t.shiftId);
    const { rows } = await su.query<{ worker_id: string; response: string }>(
      "select worker_id::text, response from offers where shift_id = $1",
      [t.shiftId],
    );
    expect(Object.fromEntries(rows.map((r) => [r.worker_id, r.response]))).toEqual({
      [ann]: "accepted",
      [ben]: "filled_elsewhere",
    });
  });

  it("opening an urgent shift again starts its offers again", async () => {
    const t = await firmWithShift();
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    await markFilled(t.ctx, t.shiftId);
    await openAgain(t.ctx, t.shiftId);
    const { rows } = await su.query<{ name: string }>(
      "select name from pgboss.job where data ->> 'shiftId' = $1 order by name",
      [t.shiftId],
    );
    expect(rows.map((r) => r.name)).toEqual(["escalate-shift", "offer-wave"]);
  });

  it("a booked worker cancelling a closed shift opens it again (a new gap)", async () => {
    const t = await firmWithShift({ headcount: 2, startsAt: hoursFromNow(48) });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, t.shiftId, "confirmed", 1);
    await markFilled(t.ctx, t.shiftId);
    const result = await cancelBooking(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: ann, reason: "I'm unwell", by: { type: "worker", id: ann } },
      clock,
    );
    expect(result.status).toBe("cancelled");
    expect(await statusOf(t.shiftId)).toBe("open");
  });
});

describe("Mark urgent / Not urgent", () => {
  it("marks it urgent (starting the waves) and clears it, both logged as the office's", async () => {
    const t = await firmWithShift();
    expect(await markUrgent(t.ctx, t.shiftId, true)).toEqual({ status: "marked" });
    const { rows } = await su.query<{ name: string }>(
      "select name from pgboss.job where data ->> 'shiftId' = $1 order by name",
      [t.shiftId],
    );
    expect(rows.map((r) => r.name)).toEqual(["escalate-shift", "offer-wave"]);
    expect(await markUrgent(t.ctx, t.shiftId, false)).toEqual({ status: "cleared" });
    expect((await eventsOf(t.f.firmId, t.shiftId)).map((e) => [e.action, e.actor_type])).toEqual([
      ["shift.marked_urgent", "office"],
      ["shift.urgent_cleared", "office"],
    ]);
  });
});
