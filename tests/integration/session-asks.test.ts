import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  ASK_ANSWER_QUEUE,
  createAskAnswerTask,
  type AskAnswerDeps,
} from "@/lib/notices/ask-answer";
import { setCasualsAsk } from "@/lib/office/casuals-ask";
import { assignWorker, cancelShift, markFilled, moveShift } from "@/lib/office/quick-actions";
import { bookTheBest } from "@/lib/office/session-asks-office";
import { loadSessionCasuals } from "@/lib/office/session-casuals";
import { editShift } from "@/lib/office/shift-editor";
import { askShift } from "@/lib/portal/ask-shift";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { takeShift } from "@/lib/portal/take-shift";
import { askForShift, declineAsk } from "@/lib/roster/asks";
import { bookShift } from "@/lib/roster/book";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Casuals ask, you choose" (Phase 26.6, ses-1, ses-4, ses-6; decision 2), on the real database as
// the app role: on an event with the setting on, a casual's own booking is refused and they ask
// instead; the office books from who asked through every rule (first yes wins); "Not this time" and
// a session filling with others tell those still waiting; a cancellation or move closes asks
// untold; an offer still takes it. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

async function askingFirm(headcount = 2) {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const eventId = await f.event({ name: "Riverside Food Festival" });
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Demo Park') returning id::text as id",
    [f.firmId],
  );
  // Friday 6 November, 11:00 to 19:00: outside the urgent window.
  const shiftId = await f.shift({
    role: "steward",
    startsAt: new Date("2026-11-06T11:00:00Z"),
    headcount,
    eventId,
  });
  await su.query("update shifts set site_id = $2 where id = $1", [shiftId, rows[0]?.id]);
  const ctx = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
  expect(await setCasualsAsk(ctx, { eventId, on: true })).toEqual({ status: "on" });
  const ask = (workerId: string) =>
    askForShift(withFirm, f.firmId, { shiftId, workerId }, { clock });
  const take = (workerId: string) =>
    bookShift(
      withFirm,
      f.firmId,
      { shiftId, workerId, by: { type: "worker", id: workerId } },
      { clock },
    );
  return { f, resourcer, eventId, shiftId, ctx, ask, take };
}

const asksOf = async (shiftId: string) =>
  (
    await su.query<{ worker_id: string; status: string }>(
      "select worker_id::text, status from session_asks where shift_id = $1 order by worker_id",
      [shiftId],
    )
  ).rows;
const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events where firm_id = $1 and action like $2 order by id`,
      [firmId, like],
    )
  ).rows;
const jobsOf = async (firmId: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
        order by (data ->> 'eventId')::bigint`,
      [ASK_ANSWER_QUEUE, firmId],
    )
  ).rows.map((r) => r.data);

function capture(when = NOW) {
  const sent: OutboundMessage[] = [];
  const pushes: { title: string; body: string; url: string }[] = [];
  const deps = (): AskAnswerDeps => ({
    transport: {
      name: "capture",
      async send(m) {
        sent.push(m);
        return { providerMessageId: `id-${sent.length}` };
      },
    },
    push: {
      name: "capture",
      async send(_target, payload) {
        pushes.push(payload);
        return { status: "sent" };
      },
    },
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const run = (data: Record<string, unknown>) =>
    runFirmTask(createAskAnswerTask(deps), { id: "job", data }, withFirm);
  const bodies = () => sent.map((m) => ("body" in m ? m.body : ""));
  return { sent, pushes, run, bodies };
}

describe("a casual asks instead of taking a place", () => {
  it("taking is refused; asking is saved once and logged; the setting off, they take it", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    expect(await t.take(sam)).toEqual({ status: "ask_first" });
    const asked = await t.ask(sam);
    expect(asked).toEqual({ status: "asked", askedAt: NOW });
    expect(await t.ask(sam)).toEqual({ status: "already_asked", askedAt: NOW });
    expect(await asksOf(t.shiftId)).toEqual([{ worker_id: sam, status: "asked" }]);
    expect(await eventsOf(t.f.firmId, "shift.ask%")).toEqual([
      { action: "shift.asked", data: { workerId: sam } },
    ]);
    expect(await eventsOf(t.f.firmId, "event.asks%")).toEqual([
      { action: "event.asks_on", data: { by: "firm" } },
    ]);
    // Switched off: the first to tap takes it again; an ask now says so.
    expect(await setCasualsAsk(t.ctx, { eventId: t.eventId, on: false })).toEqual({
      status: "off",
    });
    expect(await setCasualsAsk(t.ctx, { eventId: t.eventId, on: false })).toEqual({
      status: "unchanged",
    });
    const ned = await t.f.worker({ first: "Ned" });
    expect(await t.ask(ned)).toEqual({ status: "take_it" });
    expect(await t.take(ned)).toMatchObject({ status: "booked" });
  });

  it("the rules still decide: a casual without the licence can't ask (logged with the codes)", async () => {
    const t = await askingFirm();
    const noCard = await t.f.worker({ first: "Nia", credentials: [] });
    const answer = await t.ask(noCard);
    expect(answer).toMatchObject({ status: "not_eligible" });
    expect(answer.status === "not_eligible" && answer.reasons.length).toBeGreaterThan(0);
    expect(await asksOf(t.shiftId)).toEqual([]);
    const [refused] = await eventsOf(t.f.firmId, "shift.ask_refused");
    expect(refused?.data).toMatchObject({ workerId: noCard, codes: ["credential_missing"] });
  });

  it("a casual holding an offer of it takes it as before", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, 1, 'push')`,
      [t.f.firmId, t.shiftId, sam],
    );
    expect(await t.ask(sam)).toEqual({ status: "take_it" });
    expect(await t.take(sam)).toMatchObject({ status: "booked" });
  });

  it("another firm's casual can't ask (their session reads as not there)", async () => {
    const t = await askingFirm();
    const other = await bookingFirm(su, withFirm);
    const theirs = await other.worker({ first: "Tia" });
    expect(
      await askForShift(
        withFirm,
        other.firmId,
        { shiftId: t.shiftId, workerId: theirs },
        { clock },
      ),
    ).toEqual({ status: "gone" });
    expect(
      await askForShift(withFirm, t.f.firmId, { shiftId: t.shiftId, workerId: theirs }, { clock }),
    ).toEqual({ status: "gone" });
  });
});

describe("the office chooses", () => {
  it("booking from the list runs the rules; filling it closes the rest and tells them, once", async () => {
    const t = await askingFirm(2);
    const [amy, ben, cal] = [
      await t.f.worker({ first: "Amy" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
    ];
    for (const w of [amy, ben, cal]) expect(await t.ask(w)).toMatchObject({ status: "asked" });
    expect(await assignWorker(t.ctx, t.shiftId, amy, null)).toMatchObject({ status: "booked" });
    // One place left: nobody else's ask has closed.
    expect(await jobsOf(t.f.firmId)).toEqual([]);
    expect(await assignWorker(t.ctx, t.shiftId, ben, null)).toMatchObject({ status: "booked" });
    // Full: Cal's ask closes, logged, one message queued (ids only).
    const statuses = Object.fromEntries(
      (await asksOf(t.shiftId)).map((a) => [a.worker_id, a.status]),
    );
    expect(statuses).toEqual({ [amy]: "booked", [ben]: "booked", [cal]: "closed" });
    expect(await eventsOf(t.f.firmId, "shift.ask_closed")).toEqual([
      { action: "shift.ask_closed", data: { workerId: cal, reason: "filled" } },
    ]);
    const [job, ...more] = await jobsOf(t.f.firmId);
    expect(more).toEqual([]);
    expect(Object.keys(job ?? {}).sort()).toEqual(["askId", "eventId", "firmId", "idempotencyKey"]);
    // First yes wins: a third booking finds no place.
    expect(await assignWorker(t.ctx, t.shiftId, cal, null)).toMatchObject({ status: "filled" });

    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "sent", channel: "sms" },
    });
    expect(n.bodies()).toEqual([
      expect.stringMatching(
        /^Not this time: you're not booked for Fri 6 Nov 11:00–19:00 at Riverside Demo Park \(steward\)\. Thanks for asking\. Open shifts: http:\/\/[a-z0-9-]+\.localhost:3000\/shifts\/open\. — Booking Test [a-z0-9-]+ Shift Team$/,
      ),
    ]);
    // Once only.
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    expect((await eventsOf(t.f.firmId, "shift.ask_answer%")).map((e) => e.action)).toEqual([
      "shift.ask_answer_notice",
      "shift.ask_answer_sent",
    ]);
  });

  it("Not this time: the casual is told, can't ask again, and the office can't say it twice", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    await t.ask(sam);
    const by = t.resourcer;
    expect(
      await declineAsk(withFirm, t.f.firmId, { shiftId: t.shiftId, workerId: sam, by }, { clock }),
    ).toEqual({ status: "declined" });
    expect(
      await declineAsk(withFirm, t.f.firmId, { shiftId: t.shiftId, workerId: sam, by }, { clock }),
    ).toEqual({ status: "not_waiting" });
    expect(await t.ask(sam)).toEqual({ status: "not_this_time" });
    expect(await eventsOf(t.f.firmId, "shift.ask_declined")).toEqual([
      { action: "shift.ask_declined", data: { workerId: sam } },
    ]);
    const [job] = await jobsOf(t.f.firmId);
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "sent" } });
    expect(n.bodies()[0]).toMatch(/^Not this time: you're not booked for Fri 6 Nov/);
    // Payroll can't answer asks.
    const payroll = await t.f.office("payroll");
    const ned = await t.f.worker({ first: "Ned" });
    await t.ask(ned);
    expect(
      await declineAsk(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: ned, by: payroll },
        { clock },
      ),
    ).toEqual({ status: "not_allowed" });
  });

  it("booked after a 'Not this time' (the office changed its mind): the message isn't sent", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    await t.ask(sam);
    await declineAsk(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: sam, by: t.resourcer },
      { clock },
    );
    expect(await assignWorker(t.ctx, t.shiftId, sam, null)).toMatchObject({ status: "booked" });
    expect(await asksOf(t.shiftId)).toEqual([{ worker_id: sam, status: "booked" }]);
    const [job] = await jobsOf(t.f.firmId);
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "skipped", reason: "booked" },
    });
    expect(n.sent).toEqual([]);
  });

  it("marked filled closes waiting asks; a cancelled session closes them untold, and they may ask again", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    await t.ask(sam);
    expect(await markFilled(t.ctx, t.shiftId)).toMatchObject({ status: "closed" });
    expect(await asksOf(t.shiftId)).toEqual([{ worker_id: sam, status: "closed" }]);
    expect(await jobsOf(t.f.firmId)).toHaveLength(1);

    const u = await askingFirm();
    const ned = await u.f.worker({ first: "Ned" });
    await u.ask(ned);
    expect(await cancelShift(u.ctx, u.shiftId, "event_cancelled")).toMatchObject({
      status: "cancelled",
    });
    expect(await asksOf(u.shiftId)).toEqual([{ worker_id: ned, status: "closed" }]);
    expect(await eventsOf(u.f.firmId, "shift.asks_closed")).toEqual([
      { action: "shift.asks_closed", data: { reason: "cancelled", count: 1 } },
    ]);
    expect(await jobsOf(u.f.firmId)).toEqual([]);
    // A closed ask on a session open again may be asked again.
    const v = await askingFirm();
    const cy = await v.f.worker({ first: "Cy" });
    await v.ask(cy);
    await su.query(
      "update session_asks set status = 'closed', answered_at = now() where shift_id = $1",
      [v.shiftId],
    );
    expect(await v.ask(cy)).toMatchObject({ status: "asked" });
    expect(await asksOf(v.shiftId)).toEqual([{ worker_id: cy, status: "asked" }]);
  });
});

it("a session starting soon: nothing left to ask for once it's started or full", async () => {
  const t = await askingFirm(1);
  const amy = await t.f.worker({ first: "Amy" });
  const ben = await t.f.worker({ first: "Ben" });
  await t.ask(amy);
  await assignWorker(t.ctx, t.shiftId, amy, null);
  expect(await t.ask(amy)).toEqual({ status: "booked" });
  expect(await t.ask(ben)).toEqual({ status: "filled" });
  const later = { now: () => hoursFromNow(24 * 5) };
  const s2 = await t.f.shift({ role: "steward", startsAt: hoursFromNow(1), eventId: t.eventId });
  expect(
    await askForShift(withFirm, t.f.firmId, { shiftId: s2, workerId: ben }, { clock: later }),
  ).toEqual({ status: "gone" });
});

describe("in the casual app (ses-6)", () => {
  it("I can do this, then Asked: we'll tell you, then Not this time; Take shift says to ask", async () => {
    const t = await askingFirm();
    const sam = await t.f.worker({ first: "Sam" });
    const portal = {
      firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
      run: withFirm,
      clock,
      secret: "test-secret-for-the-limit-bucket-0123456789",
    };
    const pageOf = () => shiftForWorker(portal, sam, t.shiftId);
    const listed = async () =>
      (await openShiftsFor(portal, sam)).shifts.find((x) => x.shiftId === t.shiftId)?.ask;
    expect(await pageOf()).toMatchObject({ state: "ask", ask: { status: "ask" } });
    expect(await listed()).toBe("ask");
    expect(await takeShift(portal, sam, t.shiftId)).toEqual({ status: "ask_first" });
    expect(await askShift(portal, sam, t.shiftId)).toEqual({
      status: "asked",
      at: "09:00 on Mon 2 Nov",
    });
    expect(await pageOf()).toMatchObject({ state: "ask", ask: { status: "asked", askedAt: NOW } });
    expect(await listed()).toBe("asked");
    await declineAsk(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: sam, by: t.resourcer },
      { clock },
    );
    expect(await pageOf()).toMatchObject({ state: "ask", ask: { status: "not_this_time" } });
    expect(await listed()).toBe("not_this_time");
    expect(await askShift(portal, sam, t.shiftId)).toEqual({ status: "not_this_time" });
    // The setting off: an ordinary open shift again.
    await setCasualsAsk(t.ctx, { eventId: t.eventId, on: false });
    expect(await pageOf()).toMatchObject({ state: "open" });
    expect(await listed()).toBeNull();
  });
});

describe("the review's cases (Phase 26.6 guardrails)", () => {
  it("Edit with nobody booked closes asks, Not this time ones too: they may ask for the new time", async () => {
    const t = await askingFirm();
    const [sam, ned] = [await t.f.worker({ first: "Sam" }), await t.f.worker({ first: "Ned" })];
    await t.ask(sam);
    await t.ask(ned);
    await declineAsk(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: ned, by: t.resourcer },
      { clock },
    );
    const { rows } = await su.query<{ site_id: string | null }>(
      "select site_id::text from shifts where id = $1",
      [t.shiftId],
    );
    // Friday 6 November 14:00 to 20:00 (was 11:00 to 19:00).
    expect(
      await editShift(t.ctx, t.shiftId, {
        date: "2026-11-06",
        start: "14:00",
        end: "20:00",
        role: "steward",
        siteId: rows[0]?.site_id ?? "",
        headcount: "2",
        instructions: "",
      }),
    ).toMatchObject({ status: "saved" });
    expect(await asksOf(t.shiftId)).toEqual(
      [sam, ned].sort().map((w) => ({ worker_id: w, status: "closed" })),
    );
    expect(await eventsOf(t.f.firmId, "shift.asks_closed")).toEqual([
      { action: "shift.asks_closed", data: { reason: "moved", count: 2 } },
    ]);
    // Nobody can be booked "from their ask" for the new time; both may ask again.
    expect(await bookTheBest(t.ctx, t.shiftId, [sam])).toMatchObject({
      status: "done",
      booked: [],
      notAsking: ["Sam Booker"],
    });
    expect(await t.ask(ned)).toMatchObject({ status: "asked" });
  });

  it("the office's move of a booked session closes the asks still waiting", async () => {
    const t = await askingFirm(2);
    const [amy, ben] = [await t.f.worker({ first: "Amy" }), await t.f.worker({ first: "Ben" })];
    await t.ask(amy);
    await t.ask(ben);
    await assignWorker(t.ctx, t.shiftId, amy, null);
    const { rows } = await su.query<{ site_id: string | null }>(
      "select site_id::text from shifts where id = $1",
      [t.shiftId],
    );
    expect(
      await moveShift(t.ctx, t.shiftId, {
        date: "2026-11-06",
        start: "12:00",
        end: "20:00",
        siteId: rows[0]?.site_id ?? "",
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved" });
    expect(
      Object.fromEntries((await asksOf(t.shiftId)).map((a) => [a.worker_id, a.status])),
    ).toEqual({ [amy]: "booked", [ben]: "closed" });
  });

  it("Book the best N books only those confirmed and still asking; a refusal is reported, a full session stops it", async () => {
    const t = await askingFirm(2);
    const [amy, ben, cal, dee] = [
      await t.f.worker({ first: "Amy" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
      await t.f.worker({ first: "Dee" }),
    ];
    for (const w of [amy, ben, cal, dee]) await t.ask(w);
    // Ben was told "Not this time" after the page was drawn; Cal's licence lapsed since.
    await declineAsk(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: ben, by: t.resourcer },
      { clock },
    );
    await su.query("update credentials set status = 'expired' where worker_id = $1", [cal]);
    const done = await bookTheBest(t.ctx, t.shiftId, [ben, cal, amy, dee]);
    expect(done).toMatchObject({
      status: "done",
      booked: ["Amy Booker", "Dee Booker"],
      notAsking: ["Ben Booker"],
      refused: [{ name: "Cal Booker", result: { status: "not_eligible" } }],
    });
    // Full: nobody else, and no one unconfirmed was booked.
    const { rows } = await su.query<{ worker_id: string }>(
      "select worker_id::text from assignments where shift_id = $1 and status = 'confirmed' order by worker_id",
      [t.shiftId],
    );
    expect(rows.map((r) => r.worker_id)).toEqual([amy, dee].sort());
    const again = await t.f.worker({ first: "Eve" });
    await su.query(
      `insert into session_asks (firm_id, shift_id, worker_id, asked_at) values ($1, $2, $3, now())`,
      [t.f.firmId, t.shiftId, again],
    );
    expect(await bookTheBest(t.ctx, t.shiftId, [again])).toMatchObject({
      status: "done",
      booked: [],
      refused: [],
    });
    // Payroll can't.
    const payroll = await t.f.office("payroll");
    expect(await bookTheBest({ ...t.ctx, officeUserId: payroll }, t.shiftId, [again])).toEqual({
      status: "not_allowed",
    });
  });

  it("the list: tabs, who can be booked, most reliable first, the reliability filter", async () => {
    const t = await askingFirm(2);
    const [amy, ben, cal, dee] = [
      await t.f.worker({ first: "Amy" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
      await t.f.worker({ first: "Dee" }),
    ];
    // Ben: 5 sessions worked in the last weeks (100%); Amy: 4 worked, 1 not attended (80%).
    for (let i = 1; i <= 5; i++) {
      await t.f.booking(
        ben,
        await t.f.shift({ role: "steward", startsAt: hoursFromNow(-i * 30) }),
        "completed",
      );
      await t.f.booking(
        amy,
        await t.f.shift({ role: "steward", startsAt: hoursFromNow(-i * 30 - 200) }),
        i === 1 ? "no_show" : "completed",
      );
    }
    await t.ask(amy);
    await t.ask(ben);
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
       values ($1, $2, $3, 1, 'push', 'declined', now())`,
      [t.f.firmId, t.shiftId, cal],
    );
    const { rows } = await su.query<{ site_id: string | null; tz: string }>(
      "select s.site_id::text, f.timezone as tz from shifts s join firms f on f.id = s.firm_id where s.id = $1",
      [t.shiftId],
    );
    const load = (filters = {}) =>
      withFirm(t.f.firmId, (tx) =>
        loadSessionCasuals(
          tx,
          {
            shiftId: t.shiftId,
            eventId: t.eventId,
            role: "steward",
            siteId: rows[0]?.site_id ?? null,
            startsAt: new Date("2026-11-06T11:00:00Z"),
            headcount: 2,
            status: "open",
            requiredCredentials: [],
            timeZone: rows[0]?.tz ?? "Europe/London",
          },
          NOW,
          filters,
        ),
      );
    const all = await load();
    expect(all.casualsAsk).toBe(true);
    expect(all.rows.asked.map((c) => c.name)).toEqual(["Ben Booker", "Amy Booker"]);
    expect(all.rows.asked.map((c) => c.canBook)).toEqual([true, true]);
    expect(all.rows.said_no.map((c) => c.name)).toEqual(["Cal Booker"]);
    expect(all.rows.could.map((c) => c.workerId)).toEqual([dee]);
    expect(all.best.map((c) => c.name)).toEqual(["Ben Booker", "Amy Booker"]);
    expect(all.counts).toMatchObject({ asked: 2, said_no: 1, could: 1, booked: 0, offered: 0 });
    // 80% or more: Amy (80%) and Ben (100%); New ones (Dee) aren't a figure.
    const reliable = await load({ reliable: true });
    expect(reliable.rows.asked.map((c) => c.name)).toEqual(["Ben Booker", "Amy Booker"]);
    expect(reliable.rows.could).toEqual([]);
    expect(reliable.counts.could).toBe(1);
  });

  it("the Worked here before filter: only those who worked at this venue", async () => {
    const t = await askingFirm(2);
    const [amy, ben] = [await t.f.worker({ first: "Amy" }), await t.f.worker({ first: "Ben" })];
    const { rows } = await su.query<{ site_id: string; tz: string }>(
      "select s.site_id::text, f.timezone as tz from shifts s join firms f on f.id = s.firm_id where s.id = $1",
      [t.shiftId],
    );
    const siteId = rows[0]?.site_id ?? null;
    // Amy worked a session at this venue last month; Ben worked one elsewhere, and one here he
    // didn't attend (not "worked").
    const here = await t.f.shift({ role: "steward", startsAt: hoursFromNow(-24 * 30) });
    const elsewhere = await t.f.shift({ role: "steward", startsAt: hoursFromNow(-24 * 20) });
    const missed = await t.f.shift({ role: "steward", startsAt: hoursFromNow(-24 * 10) });
    await su.query("update shifts set site_id = $2 where id = any($1::uuid[])", [
      [here, missed],
      siteId,
    ]);
    await t.f.booking(amy, here, "completed");
    await t.f.booking(ben, elsewhere, "completed");
    await t.f.booking(ben, missed, "no_show");
    await t.ask(amy);
    await t.ask(ben);
    const load = (filters = {}) =>
      withFirm(t.f.firmId, (tx) =>
        loadSessionCasuals(
          tx,
          {
            shiftId: t.shiftId,
            eventId: t.eventId,
            role: "steward",
            siteId,
            startsAt: new Date("2026-11-06T11:00:00Z"),
            headcount: 2,
            status: "open",
            requiredCredentials: [],
            timeZone: rows[0]?.tz ?? "Europe/London",
          },
          NOW,
          filters,
        ),
      );
    const all = await load();
    expect(Object.fromEntries(all.rows.asked.map((c) => [c.name, c.workedHere]))).toEqual({
      "Amy Booker": 1,
      "Ben Booker": 0,
    });
    expect((await load({ here: true })).rows.asked.map((c) => c.name)).toEqual(["Amy Booker"]);
    // Travel areas are off for this firm: Within 45 min changes nothing.
    expect(all.travelOn).toBe(false);
    expect((await load({ near: true })).rows.asked.map((c) => c.name).sort()).toEqual([
      "Amy Booker",
      "Ben Booker",
    ]);
  });

  it("the message isn't sent when the answer no longer stands (they asked again), and waits for quiet hours", async () => {
    const t = await askingFirm(1);
    const [amy, ben] = [await t.f.worker({ first: "Amy" }), await t.f.worker({ first: "Ben" })];
    await t.ask(amy);
    await t.ask(ben);
    // Amy is booked (Ben's ask closes, a message queued); then Amy's booking goes and Ben asks again.
    await assignWorker(t.ctx, t.shiftId, amy, null);
    await su.query(
      "update assignments set status = 'cancelled_worker', cancelled_at = now(), cancel_reason = 'Unwell', notice_hours = 50 where shift_id = $1",
      [t.shiftId],
    );
    // As a casual's own cancellation leaves it: open again.
    await su.query("update shifts set status = 'open' where id = $1", [t.shiftId]);
    expect(await t.ask(ben)).toMatchObject({ status: "asked" });
    const [job] = await jobsOf(t.f.firmId);
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "skipped", reason: "changed" },
    });
    expect(n.sent).toEqual([]);

    // A "Not this time" at 23:00: held until the quiet hours end, logged.
    const u = await askingFirm();
    const cy = await u.f.worker({ first: "Cy" });
    await u.ask(cy);
    await declineAsk(
      withFirm,
      u.f.firmId,
      { shiftId: u.shiftId, workerId: cy, by: u.resourcer },
      { clock },
    );
    const [held] = await jobsOf(u.f.firmId);
    const night = capture(new Date("2026-11-02T23:00:00Z"));
    expect(await night.run(held ?? {})).toMatchObject({ output: { status: "held" } });
    expect(night.sent).toEqual([]);
    expect((await eventsOf(u.f.firmId, "shift.ask_answer_held")).length).toBe(1);
  });
});
