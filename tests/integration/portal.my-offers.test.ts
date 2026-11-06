import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { offerState } from "@/lib/office/offer-state";
import { declineOffer, myOffers } from "@/lib/portal/my-offers";
import { takeShift } from "@/lib/portal/take-shift";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Offered to you" on Home and its "No thanks" (Phase 28.15; src/lib/portal/my-offers.ts) on the
// real database as the app role: which offers show (the offers code's own rule: unansweredFor in
// src/lib/offers/close.ts, on a session open, shown, to come, with a place free), and the decline as
// one conditional UPDATE with one offer.declined (ids only); her own offers only, in her own firm.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SENT = hoursFromNow(-2); // 07:00 London

async function offer(
  f: BookingFirm,
  workerId: string,
  shiftId: string,
  o: { response?: string | null; wave?: number; sentAt?: Date } = {},
): Promise<string> {
  const response = o.response ?? null;
  const { rows } = await su.query<{ id: string }>(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at, response, responded_at)
     values ($1, $2, $3, $4, 'push', $5, $6, $7) returning id::text as id`,
    [
      f.firmId,
      shiftId,
      workerId,
      o.wave ?? 1,
      o.sentAt ?? SENT,
      response,
      response ? hoursFromNow(-1) : null,
    ],
  );
  return rows[0]?.id ?? "";
}

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const sam = await f.worker();
  const ctx = { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } };
  const portal = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  const response = async (offerId: string) =>
    (
      await su.query<{ response: string | null; responded_at: Date | null }>(
        "select response, responded_at from offers where id = $1",
        [offerId],
      )
    ).rows[0];
  const logged = async () =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        actor_id: string;
        entity_type: string;
        entity_id: string;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, actor_id::text as actor_id, entity_type,
                entity_id::text as entity_id, data
           from events where firm_id = $1 and action = 'offer.declined' order by id`,
        [f.firmId],
      )
    ).rows;
  return { f, sam, ctx, portal, response, logged };
}

describe("myOffers", () => {
  it("shows a waiting offer with when it was offered, and the session's facts", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
    const id = await offer(t.f, t.sam, shift);
    const list = await myOffers(t.ctx, t.sam);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      offerId: id,
      shiftId: shift,
      role: "door_supervisor",
      eventName: "Fixture event",
      sentAt: SENT,
      startsAt: hoursFromNow(30),
    });
  });

  it("shows a filled_elsewhere offer only while a place is free again", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const shift = await t.f.shift({ startsAt: hoursFromNow(30), headcount: 1 });
    const id = await offer(t.f, t.sam, shift, { response: "filled_elsewhere" });
    const booking = await t.f.booking(jo, shift);
    expect(await myOffers(t.ctx, t.sam)).toEqual([]); // full
    await su.query(
      "update assignments set status = 'cancelled_worker', cancelled_at = $2, notice_hours = 30, cancel_reason = 'Unwell' where id = $1",
      [booking, NOW],
    );
    expect((await myOffers(t.ctx, t.sam)).map((o) => o.offerId)).toEqual([id]); // a place again
  });

  it("leaves out accepted, declined, expired and failed offers", async () => {
    const t = await setup();
    for (const response of ["accepted", "declined", "expired", "failed"]) {
      const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
      await offer(t.f, t.sam, shift, { response });
    }
    expect(await myOffers(t.ctx, t.sam)).toEqual([]);
  });

  it("leaves out offers on a hidden, started, cancelled or draft session, or one she's booked on", async () => {
    const t = await setup();
    const hiddenEvent = await t.f.event({ name: "Hidden", showing: false });
    const shifts = [
      await t.f.shift({ startsAt: hoursFromNow(30), eventId: hiddenEvent }),
      await t.f.shift({ startsAt: hoursFromNow(31) }), // its own switch off, below
      await t.f.shift({ startsAt: hoursFromNow(-1) }),
      await t.f.shift({ startsAt: hoursFromNow(32), status: "cancelled" }),
      await t.f.shift({ startsAt: hoursFromNow(33), status: "draft" }),
      await t.f.shift({ startsAt: hoursFromNow(34), headcount: 2 }),
    ];
    await su.query("update shifts set showing_to_casuals = false where id = $1", [shifts[1]]);
    await t.f.booking(t.sam, shifts[5]!);
    for (const s of shifts) await offer(t.f, t.sam, s);
    expect(await myOffers(t.ctx, t.sam)).toEqual([]);
  });

  it("never shows another casual's offers, or firm B's", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const shift = await t.f.shift({ startsAt: hoursFromNow(30), headcount: 2 });
    await offer(t.f, jo, shift);
    expect(await myOffers(t.ctx, t.sam)).toEqual([]);

    const b = await setup();
    const bShift = await b.f.shift({ startsAt: hoursFromNow(30) });
    await offer(b.f, b.sam, bShift);
    // Firm A's context asking for firm B's casual: RLS hides every row.
    expect(await myOffers(t.ctx, b.sam)).toEqual([]);
    expect(await myOffers(b.ctx, b.sam)).toHaveLength(1);
  });

  it("shows one row per session, the latest offer", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
    await offer(t.f, t.sam, shift, { wave: 1, sentAt: hoursFromNow(-5) });
    const later = await offer(t.f, t.sam, shift, { wave: 2, sentAt: hoursFromNow(-1) });
    expect((await myOffers(t.ctx, t.sam)).map((o) => o.offerId)).toEqual([later]);
  });
});

describe("declineOffer", () => {
  it("sets declined once and logs offer.declined with ids only; the office reads said_no", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
    const id = await offer(t.f, t.sam, shift);

    expect(await declineOffer(t.ctx, t.sam, id)).toEqual({ status: "declined" });
    expect(await t.response(id)).toEqual({ response: "declined", responded_at: NOW });
    expect(await myOffers(t.ctx, t.sam)).toEqual([]);

    // A second tap changes nothing.
    expect(await declineOffer(t.ctx, t.sam, id)).toEqual({ status: "already" });
    expect(await t.logged()).toEqual([
      {
        action: "offer.declined",
        actor_type: "worker",
        actor_id: t.sam,
        entity_type: "offer",
        entity_id: id,
        data: { offerId: id, shiftId: shift, workerId: t.sam },
      },
    ]);

    expect(
      offerState({ response: "declined", shiftStatus: "open", startsAt: hoursFromNow(30) }, NOW),
    ).toEqual({ state: "closed", why: "said_no" });
  });

  it("changes nothing on an accepted offer, another casual's, firm B's, a closed one or a made-up id", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const taken = await t.f.shift({ startsAt: hoursFromNow(30), headcount: 2 });
    const accepted = await offer(t.f, t.sam, taken, { response: "accepted" });
    await t.f.booking(t.sam, taken);
    const josShift = await t.f.shift({ startsAt: hoursFromNow(31), headcount: 2 });
    const jos = await offer(t.f, jo, josShift);
    const cancelled = await t.f.shift({ startsAt: hoursFromNow(32), status: "cancelled" });
    const closed = await offer(t.f, t.sam, cancelled, { response: "expired" });
    const b = await setup();
    const bShift = await b.f.shift({ startsAt: hoursFromNow(30) });
    const bOffer = await offer(b.f, b.sam, bShift);

    expect(await declineOffer(t.ctx, t.sam, accepted)).toEqual({ status: "taken" });
    expect(await declineOffer(t.ctx, t.sam, jos)).toEqual({ status: "closed" });
    expect(await declineOffer(t.ctx, t.sam, closed)).toEqual({ status: "closed" });
    // Firm B's offer through firm A, even naming firm B's casual: nothing is seen or changed.
    expect(await declineOffer(t.ctx, b.sam, bOffer)).toEqual({ status: "closed" });
    expect(await declineOffer(t.ctx, t.sam, "not-a-uuid")).toEqual({ status: "closed" });

    expect((await t.response(accepted))?.response).toBe("accepted");
    expect((await t.response(jos))?.response).toBeNull();
    expect((await t.response(closed))?.response).toBe("expired");
    expect((await t.response(bOffer))?.response).toBeNull();
    expect(await t.logged()).toEqual([]);
    expect(await b.logged()).toEqual([]);
  });

  it("after declining she can still take it, and her offer reads accepted; a later wave never offers it to her again", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
    const id = await offer(t.f, t.sam, shift);
    expect(await declineOffer(t.ctx, t.sam, id)).toEqual({ status: "declined" });

    const candidates = await withFirm(t.f.firmId, (tx) => waveCandidates(tx, shift, NOW));
    expect(candidates.map((c) => c.workerId)).toContain(jo); // the wave still runs for others
    expect(candidates.map((c) => c.workerId)).not.toContain(t.sam);

    expect((await takeShift(t.portal, t.sam, shift)).status).toBe("booked");
    expect((await t.response(id))?.response).toBe("accepted");
  });

  it("someone else filling the shift leaves her 'no' as it is (closeOpenOffers never reads it)", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const shift = await t.f.shift({ startsAt: hoursFromNow(30) });
    const mine = await offer(t.f, t.sam, shift);
    const jos = await offer(t.f, jo, shift);
    expect(await declineOffer(t.ctx, t.sam, mine)).toEqual({ status: "declined" });
    expect((await takeShift(t.portal, jo, shift)).status).toBe("booked");
    expect((await t.response(mine))?.response).toBe("declined");
    expect((await t.response(jos))?.response).toBe("accepted");
  });
});
