import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { queueOfficeOffer, runOfficeOffer } from "@/lib/offers/office-offer";
import {
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  runOfferWave,
  type OfferDeps,
} from "@/lib/offers/waves";
import { officeOfferPage } from "@/lib/office/offer-page";
import { setShowing } from "@/lib/office/showing";
import { myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { askForReview } from "@/lib/portal/review";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { takeShift } from "@/lib/portal/take-shift";
import type { PushTransport } from "@/lib/push/transport";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { setShiftUrgent } from "@/lib/roster/urgent";
import { isVisibleToCasuals } from "@/lib/roster/visibility";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// What casuals see (12B.4; docs/office-v2.md 3.3, "What a switch does"): one check
// (src/lib/roster/visibility.ts), the event's switch and the session's, used on every path a casual
// reaches a shift by. Each path is tested twice: with the event switched off, and with only the
// session switched off inside an event that's showing. Every switch goes through setShowing() as a
// resourcer. Real database, app role, fixed clock (NOW is Monday 2 November 2026, 09:00 London),
// nothing sent anywhere.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(8);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };
const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

const showingOf = async (shiftId: string) =>
  (
    await su.query<{ session: boolean; event: boolean }>(
      `select s.showing_to_casuals as session, e.showing_to_casuals as event
         from shifts s join shift_events e on e.id = s.event_id where s.id = $1`,
      [shiftId],
    )
  ).rows[0];
const jobsFor = async (shiftId: string) =>
  (
    await su.query<{ name: string }>(
      "select name from pgboss.job where data ->> 'shiftId' = $1 order by name",
      [shiftId],
    )
  ).rows.map((r) => r.name);
const waveJobs = async (shiftId: string) =>
  (
    await su.query<{ data: { firmId: string; idempotencyKey: string; wave: number } }>(
      "select data from pgboss.job where name = $1 and data ->> 'shiftId' = $2",
      [OFFER_WAVE_QUEUE, shiftId],
    )
  ).rows.map((r) => r.data);
const logged = async (entityId: string) =>
  (
    await su.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      entity_type: string;
      data: Record<string, unknown>;
    }>(
      `select action, actor_type, actor_id::text, entity_type, data from events
        where entity_id = $1 order by created_at, id`,
      [entityId],
    )
  ).rows;

// A firm with an event holding two door supervisor sessions (48 hours away, one place each), a
// second event with one more, a casual who may work them all, and a resourcer.
async function showingFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const casual = await f.worker({ first: "Cas" });
  const eventId = await f.event({ name: "Acme Demo Arena · Wed 4 Nov" });
  const shiftId = await f.shift({ eventId, startsAt: hoursFromNow(48) });
  const sibling = await f.shift({ eventId, startsAt: hoursFromNow(49) });
  const elsewhere = await f.shift({ eventId: await f.event(), startsAt: hoursFromNow(50) });
  const office = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
  const portal = { firm: { id: f.firmId }, run: withFirm, clock };
  // The portal's context with the firm's voice, for Take shift and "Ask the office to review".
  const voiced = {
    ...portal,
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Acme Shift Team" },
  };
  return { f, resourcer, casual, eventId, shiftId, sibling, elsewhere, office, portal, voiced };
}
type ShowingFirm = Awaited<ReturnType<typeof showingFirm>>;

// The two ways a session is hidden, through the office's switch. `stillShown`: a session the same
// switch leaves showing (another event's, or a sibling in the same event).
const HOW = [
  {
    how: "a hidden event",
    hide: (t: ShowingFirm) =>
      setShowing(t.office, { target: "event", id: t.eventId, showing: false }),
    show: (t: ShowingFirm) =>
      setShowing(t.office, { target: "event", id: t.eventId, showing: true }),
    stillShown: (t: ShowingFirm) => t.elsewhere,
    alsoHidden: (t: ShowingFirm) => [t.sibling],
  },
  {
    how: "a hidden session inside a showing event",
    hide: (t: ShowingFirm) =>
      setShowing(t.office, { target: "session", id: t.shiftId, showing: false }),
    show: (t: ShowingFirm) =>
      setShowing(t.office, { target: "session", id: t.shiftId, showing: true }),
    stillShown: (t: ShowingFirm) => t.sibling,
    alsoHidden: () => [] as string[],
  },
] as const;

describe.each(HOW)("$how", ({ hide, show, stillShown, alsoHidden }) => {
  it("is hidden by the one check, and only it (and an event's sessions) is", async () => {
    const t = await showingFirm();
    expect(await hide(t)).toEqual({ status: "hidden" });
    const visible = await withFirm(t.f.firmId, async (tx) => ({
      it: await isVisibleToCasuals(tx, t.shiftId),
      other: await isVisibleToCasuals(tx, stillShown(t)),
      also: await Promise.all(alsoHidden(t).map((id) => isVisibleToCasuals(tx, id))),
    }));
    expect(visible).toEqual({ it: false, other: true, also: alsoHidden(t).map(() => false) });
  });

  it("leaves Open shifts, and comes back when shown again", async () => {
    const t = await showingFirm();
    const ids = async () =>
      (await openShiftsFor(t.portal, t.casual)).shifts.map((s) => s.shiftId).sort();
    expect(await ids()).toEqual([t.shiftId, t.sibling, t.elsewhere].sort());
    await hide(t);
    const hidden = await ids();
    expect(hidden).not.toContain(t.shiftId);
    expect(hidden).toContain(stillShown(t));
    expect(await show(t)).toEqual({ status: "shown", offering: 0, eventHidden: false });
    expect(await ids()).toEqual([t.shiftId, t.sibling, t.elsewhere].sort());
  });

  it("leaves the urgent board and the Home count", async () => {
    const t = await showingFirm();
    await su.query("update shifts set is_urgent = true where id = any($1)", [
      [t.shiftId, stillShown(t)],
    ]);
    // The Home page counts the urgent board (src/app/page.tsx: openShiftsFor with urgent).
    const board = async () => (await openShiftsFor(t.portal, t.casual, { urgent: true })).shifts;
    expect((await board()).map((s) => s.shiftId).sort()).toEqual([t.shiftId, stillShown(t)].sort());
    expect((await board()).length).toBe(2);
    await hide(t);
    expect((await board()).map((s) => s.shiftId)).toEqual([stillShown(t)]);
    expect((await board()).length).toBe(1);
  });

  it("the shift page says it isn't available", async () => {
    const t = await showingFirm();
    expect((await shiftForWorker(t.portal, t.casual, t.shiftId)).state).toBe("open");
    await hide(t);
    expect(await shiftForWorker(t.portal, t.casual, t.shiftId)).toEqual({ state: "missing" });
    expect((await shiftForWorker(t.portal, t.casual, stillShown(t))).state).toBe("open");
  });

  it("someone whose place was cancelled still hears the shift was cancelled; nobody else does", async () => {
    const t = await showingFirm();
    await t.f.booking(t.casual, t.shiftId, "cancelled_worker");
    const stranger = await t.f.worker({ first: "Str" });
    await su.query("update shifts set status = 'cancelled' where id = $1", [t.shiftId]);
    await hide(t);
    expect((await shiftForWorker(t.portal, t.casual, t.shiftId)).state).toBe("cancelled");
    expect(await shiftForWorker(t.portal, stranger, t.shiftId)).toEqual({ state: "missing" });
    // Open again (with their cancelled place): still missing to them, as nothing can be taken.
    await su.query("update shifts set status = 'open' where id = $1", [t.shiftId]);
    expect(await shiftForWorker(t.portal, t.casual, t.shiftId)).toEqual({ state: "missing" });
  });

  it("Ask the office to review is refused, as if it weren't there", async () => {
    const t = await showingFirm();
    const unlicensed = await t.f.worker({ first: "Nol", credentials: [] }); // the rules say no
    expect((await shiftForWorker(t.portal, unlicensed, t.shiftId)).state).toBe("blocked");
    await hide(t);
    expect(await askForReview(t.voiced, unlicensed, t.shiftId, "")).toEqual({
      status: "not_open",
    });
    const { rows } = await su.query("select 1 from requests where shift_id = $1", [t.shiftId]);
    expect(rows).toHaveLength(0);
    expect(await askForReview(t.voiced, unlicensed, stillShown(t), "")).toMatchObject({
      status: "created",
    });
  });

  it("bookShift refuses a casual, and Take shift says it's gone", async () => {
    const t = await showingFirm();
    await hide(t);
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.casual, by: { type: "worker", id: t.casual } },
        { clock },
      ),
    ).toEqual({ status: "not_found" });
    expect(await takeShift(t.voiced, t.casual, t.shiftId)).toEqual({ status: "gone" });
    const { rows } = await su.query("select 1 from assignments where shift_id = $1", [t.shiftId]);
    expect(rows).toHaveLength(0);
    // Nothing logged as a refusal: to the casual it isn't there.
    expect((await logged(t.shiftId)).map((e) => e.action)).not.toContain("shift.booking_refused");
  });

  it("the office can still assign a casual", async () => {
    const t = await showingFirm();
    await hide(t);
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        {
          shiftId: t.shiftId,
          workerId: t.casual,
          by: { type: "office", id: t.resourcer, overrides: [] },
        },
        { clock },
      ),
    ).toMatchObject({ status: "booked" });
  });

  it("a booked casual keeps the shift, and still sees it as booked", async () => {
    const t = await showingFirm();
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.casual, by: { type: "worker", id: t.casual } },
        { clock },
      ),
    ).toMatchObject({ status: "booked" });
    await hide(t);
    const { rows } = await su.query<{ status: string }>(
      "select status from assignments where shift_id = $1 and worker_id = $2",
      [t.shiftId, t.casual],
    );
    expect(rows).toEqual([{ status: "confirmed" }]);
    expect((await shiftForWorker(t.portal, t.casual, t.shiftId)).state).toBe("booked");
    expect((await myShifts(t.portal, t.casual, "upcoming")).map((s) => s.shiftId)).toContain(
      t.shiftId,
    );
  });

  it("no wave starts: not after a dropout, not when marked urgent, and one queued earlier sends nothing", async () => {
    const t = await showingFirm();
    const by = { type: "office" as const, id: t.resourcer };
    const other = await t.f.worker({ first: "Oth" });
    // Inside the urgent window (10 hours away), booked.
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      t.shiftId,
      hoursFromNow(10),
      hoursFromNow(18),
    ]);
    await t.f.booking(other, t.shiftId);
    // Marked urgent while it's showing: wave 1 is queued. Then it's hidden.
    expect(
      await setShiftUrgent(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, urgent: true, by },
        { clock },
      ),
    ).toEqual({ status: "marked" });
    const [queued] = await waveJobs(t.shiftId);
    if (!queued) throw new Error("no wave queued");
    expect(queued.wave).toBe(1);
    await hide(t);

    // A dropout inside the urgent window: the office's escalation is queued, no wave.
    await cancelBooking(
      withFirm,
      t.f.firmId,
      {
        shiftId: t.shiftId,
        workerId: other,
        reason: "I'm unwell",
        by: { type: "worker", id: other },
      },
      { clock },
    );
    expect(await waveJobs(t.shiftId)).toHaveLength(1);
    expect((await jobsFor(t.shiftId)).filter((n) => n === ESCALATE_SHIFT_QUEUE)).toHaveLength(2);

    // The office marking it urgent again (cleared first): no wave, and the office is told why.
    await setShiftUrgent(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, urgent: false, by },
      { clock },
    );
    expect(
      await setShiftUrgent(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, urgent: true, by },
        { clock },
      ),
    ).toEqual({ status: "marked_hidden" });
    expect(await waveJobs(t.shiftId)).toHaveLength(1);

    // Nobody is a candidate, and the wave queued while it showed stops (logged): nothing is sent.
    expect(await withFirm(t.f.firmId, (tx) => waveCandidates(tx, t.shiftId, NOW))).toEqual([]);
    const { transport, sent } = captureTransport();
    const deps: OfferDeps = { transport, push: noPush, baseDomain: "localhost:3000", clock };
    expect(
      await runOfferWave(
        {
          firmId: queued.firmId,
          idempotencyKey: queued.idempotencyKey,
          shiftId: t.shiftId,
          wave: 1,
        },
        withFirm,
        deps,
      ),
    ).toEqual({ status: "stopped", reason: "hidden" });
    expect(sent).toEqual([]);
    const { rows: offerRows } = await su.query("select 1 from offers where shift_id = $1", [
      t.shiftId,
    ]);
    expect(offerRows).toHaveLength(0);
    expect((await logged(t.shiftId)).find((e) => e.action === "offer.waves_stopped")?.data).toEqual(
      { reason: "hidden", wave: 1 },
    );
  });

  it("the office can't offer it: refused when asked, and one queued before it was hidden isn't sent", async () => {
    const t = await showingFirm();
    const by = { type: "office" as const, id: t.resourcer };
    // Queued while showing.
    expect(
      await queueOfficeOffer(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.casual, by },
        { clock },
      ),
    ).toEqual({ status: "queued" });
    await hide(t);
    const other = await t.f.worker({ first: "Oth" });
    expect(
      await queueOfficeOffer(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: other, by },
        { clock },
      ),
    ).toEqual({ status: "hidden" });
    const { transport, sent } = captureTransport();
    expect(
      await runOfficeOffer(
        {
          firmId: t.f.firmId,
          idempotencyKey: `office-offer:${t.shiftId}:${t.casual}`,
          shiftId: t.shiftId,
          workerId: t.casual,
          officeUserId: t.resourcer,
        },
        withFirm,
        { transport, push: noPush, baseDomain: "localhost:3000", clock },
      ),
    ).toEqual({ status: "not_sent", reason: "hidden" });
    expect(sent).toEqual([]);
    expect(
      (await logged(t.shiftId)).find((e) => e.action === "offer.office_not_sent")?.data,
    ).toEqual({ workerId: t.casual, reason: "hidden" });
    // The offer page lists nobody, and says why.
    const token = (
      await withFirm(t.f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: t.resourcer, now: NOW }),
      )
    ).token;
    const page = await officeOfferPage(
      { firm: { id: t.f.firmId }, run: withFirm, clock },
      token,
      t.shiftId,
    );
    expect(page?.shift).toMatchObject({ open: true, hidden: true });
    expect(page?.candidates).toEqual([]);
  });
});

describe("a switch and a booking at the same moment", () => {
  it("switching the event off waits for a booking that read it on; the next booking sees it off", async () => {
    const t = await showingFirm();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let read: () => void = () => undefined;
    const hasRead = new Promise<void>((resolve) => (read = resolve));
    // A casual's booking in progress: it has the shift locked and has read the switch (as
    // bookShift does), and hasn't finished yet.
    const booking = withFirm(t.f.firmId, async (tx) => {
      const visible = await isVisibleToCasuals(tx, t.shiftId, { lock: true });
      read();
      await held;
      return visible;
    });
    await hasRead;
    let switched = false;
    const hiding = setShowing(t.office, { target: "event", id: t.eventId, showing: false }).then(
      (r) => {
        switched = true;
        return r;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(switched).toBe(false);
    release();
    expect(await booking).toBe(true);
    expect(await hiding).toEqual({ status: "hidden" });
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.casual, by: { type: "worker", id: t.casual } },
        { clock },
      ),
    ).toEqual({ status: "not_found" });
  });
});

// The real paths take the event's lock: each waits while the event is being switched (a transaction
// holding the event row, not yet committed), then sees the switch as it is once that commits.
async function switchingEvent(eventId: string, showing: boolean) {
  const c = await su.connect();
  await c.query("begin");
  await c.query("update shift_events set showing_to_casuals = $2 where id = $1", [
    eventId,
    showing,
  ]);
  return {
    commit: async () => {
      await c.query("commit");
      c.release();
    },
  };
}
const settles = (p: Promise<unknown>) => {
  const state = { done: false };
  void p.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  return state;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a switch in progress", () => {
  it("a booking, a wave, an office offer, a review and an urgent mark each wait for the event being hidden, then see it hidden", async () => {
    const t = await showingFirm();
    const at = (h: number) => t.f.shift({ eventId: t.eventId, startsAt: hoursFromNow(h) });
    const [toBook, toWave, toOffer, toReview, toMark] = [
      await at(30),
      await at(10),
      await at(31),
      await at(32),
      await at(33),
    ];
    await su.query("update shifts set is_urgent = true where id = $1", [toWave]);
    const unlicensed = await t.f.worker({ first: "Nol", credentials: [] });
    const { transport, sent } = captureTransport();
    const deps: OfferDeps = { transport, push: noPush, baseDomain: "localhost:3000", clock };

    const hiding = await switchingEvent(t.eventId, false);
    const runs = {
      book: bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: toBook, workerId: t.casual, by: { type: "worker", id: t.casual } },
        { clock },
      ),
      wave: runOfferWave(
        { firmId: t.f.firmId, idempotencyKey: "t:lock", shiftId: toWave, wave: 1 },
        withFirm,
        deps,
      ),
      offer: runOfficeOffer(
        {
          firmId: t.f.firmId,
          idempotencyKey: `office-offer:${toOffer}:${t.casual}`,
          shiftId: toOffer,
          workerId: t.casual,
          officeUserId: t.resourcer,
        },
        withFirm,
        deps,
      ),
      review: askForReview(t.voiced, unlicensed, toReview, ""),
      mark: setShiftUrgent(
        withFirm,
        t.f.firmId,
        { shiftId: toMark, urgent: true, by: { type: "office", id: t.resourcer } },
        { clock },
      ),
    };
    const states = Object.fromEntries(Object.entries(runs).map(([k, p]) => [k, settles(p)]));
    await pause(400);
    expect(
      Object.entries(states)
        .filter(([, s]) => s.done)
        .map(([k]) => k),
    ).toEqual([]);
    await hiding.commit();
    expect(await runs.book).toEqual({ status: "not_found" });
    expect(await runs.wave).toEqual({ status: "stopped", reason: "hidden" });
    expect(await runs.offer).toEqual({ status: "not_sent", reason: "hidden" });
    expect(await runs.review).toEqual({ status: "not_open" });
    expect(await runs.mark).toEqual({ status: "marked_hidden" });
    expect(sent).toEqual([]);
    expect(await waveJobs(toMark)).toEqual([]);
  });

  it("a session marked urgent while its event is being shown gets its wave", async () => {
    const t = await showingFirm();
    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    const showing = await switchingEvent(t.eventId, true);
    const mark = setShiftUrgent(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, urgent: true, by: { type: "office", id: t.resourcer } },
      { clock },
    );
    const state = settles(mark);
    await pause(400);
    expect(state.done).toBe(false);
    await showing.commit();
    expect(await mark).toEqual({ status: "marked" });
    expect(await waveJobs(t.shiftId)).toHaveLength(1);
  });

  it("a session switched on while its event is being switched on sees the event on, and offers go out", async () => {
    const t = await showingFirm();
    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    await setShowing(t.office, { target: "session", id: t.shiftId, showing: false });
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    const showing = await switchingEvent(t.eventId, true);
    const on = setShowing(t.office, { target: "session", id: t.shiftId, showing: true });
    const state = settles(on);
    await pause(400);
    expect(state.done).toBe(false);
    await showing.commit();
    expect(await on).toEqual({ status: "shown", offering: 1, eventHidden: false });
    expect(await waveJobs(t.shiftId)).toHaveLength(1);
  });
});

describe("setShowing()", () => {
  it("logs who switched what, and nothing when nothing changes", async () => {
    const t = await showingFirm();
    expect(await setShowing(t.office, { target: "event", id: t.eventId, showing: true })).toEqual({
      status: "unchanged",
    });
    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    await setShowing(t.office, { target: "event", id: t.eventId, showing: true });
    await setShowing(t.office, { target: "session", id: t.shiftId, showing: false });
    await setShowing(t.office, { target: "session", id: t.shiftId, showing: true });
    const event = await logged(t.eventId);
    expect(event.map((e) => [e.action, e.actor_type, e.actor_id, e.entity_type, e.data])).toEqual([
      ["event.hidden", "office", t.resourcer, "shift_event", { by: "firm" }],
      ["event.shown", "office", t.resourcer, "shift_event", { by: "firm" }],
    ]);
    const session = (await logged(t.shiftId)).filter((e) => e.action.startsWith("session."));
    expect(session.map((e) => [e.action, e.actor_type, e.actor_id, e.entity_type])).toEqual([
      ["session.hidden", "office", t.resourcer, "shift"],
      ["session.shown", "office", t.resourcer, "shift"],
    ]);
    expect(await showingOf(t.shiftId)).toEqual({ session: true, event: true });
  });

  it("is for active admins and resourcers only", async () => {
    const t = await showingFirm();
    for (const officeUserId of [
      await t.f.office("payroll"),
      await t.f.office("resourcer", "disabled"),
    ]) {
      expect(
        await setShowing(
          { ...t.office, officeUserId },
          { target: "event", id: t.eventId, showing: false },
        ),
      ).toEqual({ status: "not_allowed" });
    }
    expect(
      await setShowing(
        { ...t.office, officeUserId: await t.f.office("admin") },
        { target: "session", id: t.shiftId, showing: false },
      ),
    ).toEqual({ status: "hidden" });
    expect(await showingOf(t.shiftId)).toEqual({ session: false, event: true });
  });

  it("never reaches another firm's event or session, or an id that isn't one", async () => {
    const t = await showingFirm();
    const other = await showingFirm();
    for (const target of ["event", "session"] as const) {
      const id = target === "event" ? other.eventId : other.shiftId;
      expect(await setShowing(t.office, { target, id, showing: false })).toEqual({
        status: "not_found",
      });
      expect(await setShowing(t.office, { target, id: "not-an-id", showing: false })).toEqual({
        status: "not_found",
      });
    }
    expect(await showingOf(other.shiftId)).toEqual({ session: true, event: true });
    expect(await logged(other.eventId)).toEqual([]);
  });

  it("showing an event again starts offers for its urgent sessions with a place free", async () => {
    const t = await showingFirm();
    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    // Urgent with a place: offered again. Urgent but full, or not urgent: not.
    const full = await t.f.shift({ eventId: t.eventId, startsAt: hoursFromNow(30) });
    await t.f.booking(await t.f.worker({ first: "Ful" }), full);
    await su.query("update shifts set is_urgent = true where id = any($1)", [[t.shiftId, full]]);
    expect(await setShowing(t.office, { target: "event", id: t.eventId, showing: true })).toEqual({
      status: "shown",
      offering: 1,
      eventHidden: false,
    });
    expect(await jobsFor(t.shiftId)).toEqual([ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE]);
    expect(await jobsFor(full)).toEqual([]);
    expect(await jobsFor(t.sibling)).toEqual([]);
    expect((await logged(t.eventId)).at(-1)?.data).toEqual({ by: "firm", offersStarted: 1 });
    // A session still switched off itself stays without offers when its event is shown.
    await su.query("update shifts set is_urgent = true, showing_to_casuals = false where id = $1", [
      t.sibling,
    ]);
    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    expect(await setShowing(t.office, { target: "event", id: t.eventId, showing: true })).toEqual({
      status: "shown",
      offering: 1,
      eventHidden: false,
    });
    expect(await jobsFor(t.sibling)).toEqual([]);
  });

  it("showing a session again starts its offers; inside a hidden event it says casuals still can't see it", async () => {
    const t = await showingFirm();
    await setShowing(t.office, { target: "session", id: t.shiftId, showing: false });
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    expect(await setShowing(t.office, { target: "session", id: t.shiftId, showing: true })).toEqual(
      { status: "shown", offering: 1, eventHidden: false },
    );
    expect(await waveJobs(t.shiftId)).toHaveLength(1);
    expect((await logged(t.shiftId)).at(-1)).toMatchObject({
      action: "session.shown",
      data: { by: "firm", offersStarted: 1 },
    });

    await setShowing(t.office, { target: "event", id: t.eventId, showing: false });
    await setShowing(t.office, { target: "session", id: t.shiftId, showing: false });
    expect(await setShowing(t.office, { target: "session", id: t.shiftId, showing: true })).toEqual(
      { status: "shown", offering: 0, eventHidden: true },
    );
    expect(await waveJobs(t.shiftId)).toHaveLength(1);
  });
});
