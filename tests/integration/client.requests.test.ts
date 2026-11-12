import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import {
  acceptClientRequest,
  askClient,
  declineClientRequest,
  markPlannerDone,
} from "@/lib/client/answer";
import {
  runClientRequestAlert,
  runClientRequestAnswer,
  type ClientNotifyDeps,
} from "@/lib/client/notify";
import { officeClientRequestPreview, officeClientRequests } from "@/lib/client/queue";
import {
  clientEvent,
  clientEvents,
  clientFormChoices,
  clientRequestList,
  type ClientContext,
} from "@/lib/client/reads";
import { createClientRequest, replyToClientQuestion } from "@/lib/client/requests";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { passesLogCheck } from "@/lib/events/record";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { countNeedsAction, countSince, loadUpdatesPage } from "@/lib/office/updates";
import { loadOfficeFrame } from "@/lib/office/frame";
import type { PushPayload, PushTransport } from "@/lib/push/transport";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Client requests (Phase 36.4) on the real database, as the app role: a client sees their own
// contract's events in numbers only and asks about them (never another contract's or firm's); the
// rules decide urgency; the office's queue and "what accepting does"; accepting applies the change
// through the office's own paths (more places offered at once, fewer places cancelling bookings with
// notice, new times as a firm move, a cancellation, a new event made hidden), or lists a planner's
// session to do there; declining and asking, the client's reply; the notifications; and every log
// entry passing the log's check. NOW is Monday 2 November 2026, 09:00 London.

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

const clockAt = (d: Date): Clock => ({ now: () => d });

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`no id: ${text}`);
  return id;
}

// A firm with a contract (Demo Stadium Ltd) owning one venue, an event there and a session of 3
// places in 72 hours; another contract with its own venue and event; an admin, a resourcer and a
// payroll user; and a client login on the first contract.
async function clientFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const contract = await one(
    "insert into clients (firm_id, name) values ($1, 'Demo Stadium Ltd')",
    [f.firmId],
  );
  const venue = await one(
    `insert into sites (firm_id, name, client_id, address_line1, postcode)
     values ($1, 'Demo Stadium', $2, '1 Demo Road', 'ZZ1 4AA')`,
    [f.firmId, contract],
  );
  const event = await one(
    "insert into shift_events (firm_id, name, site_id) values ($1, 'Demo Rovers v Visitors FC', $2)",
    [f.firmId, venue],
  );
  const otherContract = await one(
    "insert into clients (firm_id, name) values ($1, 'Other Venue Ltd')",
    [f.firmId],
  );
  const otherVenue = await one(
    "insert into sites (firm_id, name, client_id) values ($1, 'Other Hall', $2)",
    [f.firmId, otherContract],
  );
  const otherEvent = await one(
    "insert into shift_events (firm_id, name, site_id) values ($1, 'Other Gala', $2)",
    [f.firmId, otherVenue],
  );
  const contact = await one(
    `insert into client_contacts (firm_id, contract_id, name, email, created_by)
     values ($1, $2, 'Priya Shah', $3, $4)`,
    [f.firmId, contract, `priya.${randomUUID().slice(0, 6)}@example.com`, admin],
  );
  const session = (
    o: { eventId?: string; startsAt?: Date; headcount?: number; role?: string } = {},
  ) =>
    f.shift({
      eventId: o.eventId ?? event,
      startsAt: o.startsAt ?? hoursFromNow(72),
      headcount: o.headcount ?? 3,
      role: o.role ?? "steward",
    });
  const client = (id = contact, at = NOW): ClientContext => ({
    firm: { id: f.firmId },
    clientContactId: id,
    run: withFirm,
    clock: clockAt(at),
  });
  const office = (id = resourcer, at = NOW) => ({
    firm: { id: f.firmId },
    officeUserId: id,
    run: withFirm,
    clock: clockAt(at),
  });
  return {
    f,
    admin,
    resourcer,
    payroll,
    contract,
    venue,
    event,
    otherContract,
    otherEvent,
    contact,
    session,
    client,
    office,
  };
}

// Casuals booked on a session, one a slot, each booked an hour after the one before.
async function book(f: BookingFirm, shiftId: string, n: number, firstSlot = 1) {
  const people: { workerId: string; assignmentId: string }[] = [];
  for (let i = 0; i < n; i++) {
    const workerId = await f.worker({ first: `Casual${i}`, roles: ["steward"] });
    const assignmentId = await f.booking(workerId, shiftId, "confirmed", firstSlot + i);
    await su.query("update assignments set confirmed_at = $2 where id = $1", [
      assignmentId,
      hoursFromNow(-50 + i),
    ]);
    people.push({ workerId, assignmentId });
  }
  return people;
}

const shiftRow = async (id: string) =>
  (
    await su.query<{
      headcount: number;
      status: string;
      starts_at: Date;
      ends_at: Date;
      is_urgent: boolean;
    }>("select headcount, status, starts_at, ends_at, is_urgent from shifts where id = $1", [id])
  ).rows[0];
const requestRow = async (id: string) =>
  (
    await su.query<{
      status: string;
      urgent: boolean;
      office_answer: string | null;
      event_id: string | null;
      planner_done_at: Date | null;
    }>(
      "select status, urgent, office_answer, event_id::text, planner_done_at from client_requests where id = $1",
      [id],
    )
  ).rows[0];
const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ entity_id: string; actor_type: string; data: Record<string, unknown> }>(
      "select entity_id::text, actor_type, data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;
const jobsOf = async (firmId: string, name: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
      [name, firmId],
    )
  ).rows.map((r) => r.data);

async function sent(t: Awaited<ReturnType<typeof clientFirm>>, input: unknown, at = NOW) {
  const r = await createClientRequest(t.client(t.contact, at), input);
  if (r.status !== "sent") throw new Error(`not sent: ${JSON.stringify(r)}`);
  return r;
}

describe("what a client sees: their contract's events, numbers only", () => {
  it("their events to come with places, booked and to fill; never another contract's, firm's, or a casual", async () => {
    const t = await clientFirm();
    const mine = await t.session({ headcount: 3 });
    const people = await book(t.f, mine, 2);
    await t.session({ eventId: t.otherEvent });
    // An event at no venue of theirs, and one long over.
    await t.session({ startsAt: hoursFromNow(-30) });

    const events = await clientEvents(t.client());
    expect(events?.map((e) => [e.name, e.places, e.booked, e.toFill])).toEqual([
      ["Demo Rovers v Visitors FC", 3, 2, 1],
    ]);
    expect(events?.[0]?.address).toBe("1 Demo Road, ZZ1 4AA");
    expect(events?.[0]?.sessions).toHaveLength(1);
    // Nothing about any casual: no id, no name, no number.
    const text = JSON.stringify(events);
    for (const p of people) {
      expect(text).not.toContain(p.workerId);
      expect(text).not.toContain(p.assignmentId);
    }
    expect(text).not.toMatch(/Casual\d|Booker|\+447700/);

    expect(await clientEvent(t.client(), t.event)).toMatchObject({
      name: "Demo Rovers v Visitors FC",
    });
    expect(await clientEvent(t.client(), t.otherEvent)).toBeNull();
    // Another firm's client login, asking under this firm: nothing.
    const other = await clientFirm();
    expect(await clientEvents({ ...other.client(), firm: { id: t.f.firmId } })).toBeNull();
    expect(await clientEvents({ ...t.client(), firm: { id: other.f.firmId } })).toBeNull();
    // Switched off: nothing.
    await su.query("update client_contacts set is_on = false where id = $1", [t.contact]);
    expect(await clientEvents(t.client())).toBeNull();
  });

  it("the form's choices: their venues and the firm's roles", async () => {
    const t = await clientFirm();
    await t.session({ role: "door_supervisor" });
    const choices = await clientFormChoices(t.client());
    expect(choices?.venues).toEqual([{ siteId: t.venue, name: "Demo Stadium" }]);
    expect(choices?.roles).toContain("steward");
    expect(choices?.roles).toContain("door_supervisor");
  });
});

describe("sending a request", () => {
  it("only about their own sessions and venues, to come; checked by code; logged with ids only", async () => {
    const t = await clientFirm();
    const mine = await t.session();
    const theirs = await t.session({ eventId: t.otherEvent });
    const other = await clientFirm();
    const otherFirms = await other.session();
    const past = await t.session({ startsAt: hoursFromNow(-2) });
    for (const shiftId of [theirs, otherFirms, past, randomUUID()]) {
      expect(
        await createClientRequest(t.client(), {
          kind: "more_places",
          shiftId,
          payload: { places: 2 },
        }),
      ).toEqual({ status: "not_found" });
    }
    expect(
      await createClientRequest(t.client(), {
        kind: "fewer_places",
        shiftId: mine,
        payload: { places: 3 },
      }),
    ).toEqual({ status: "invalid", problem: "too_many_fewer" });
    expect(
      await createClientRequest(t.client(), {
        kind: "new_times",
        shiftId: mine,
        payload: { date: "2026-11-01", start: "10:00", end: "12:00" },
      }),
    ).toEqual({ status: "invalid", problem: "in_past" });
    expect(await createClientRequest(t.client(), { kind: "more_places", shiftId: mine })).toEqual({
      status: "invalid",
      problem: "form",
    });
    // A new event at another contract's venue is no venue of theirs.
    const { rows: otherVenue } = await su.query<{ id: string }>(
      "select id::text from sites where firm_id = $1 and name = 'Other Hall'",
      [t.f.firmId],
    );
    expect(
      await createClientRequest(t.client(), {
        kind: "new_event",
        payload: {
          name: "Gala",
          venue: { siteId: otherVenue[0]?.id },
          date: "2026-11-20",
          sessions: [{ role: "steward", places: 2, start: "10:00", end: "14:00" }],
        },
      }),
    ).toEqual({ status: "not_found" });
    // Switched off: refused.
    const off = await su.query(
      "update client_contacts set is_on = false where id = $1 returning id",
      [t.contact],
    );
    expect(off.rowCount).toBe(1);
    expect(
      await createClientRequest(t.client(), { kind: "other", payload: { text: "Hello" } }),
    ).toEqual({ status: "not_allowed" });
    await su.query("update client_contacts set is_on = true where id = $1", [t.contact]);

    const r = await sent(t, {
      kind: "more_places",
      shiftId: mine,
      payload: { places: 2 },
      note: "Category raised to B. Call Priya on 07700 900123.",
    });
    expect(r.urgent).toBeNull(); // 72 hours away, nothing taken from anyone
    const [created] = await eventsOf(t.f.firmId, "client_request.created");
    expect(created).toEqual({
      entity_id: r.requestId,
      actor_type: "client",
      data: {
        contractId: t.contract,
        kind: "more_places",
        shiftId: mine,
        eventId: t.event,
        urgent: false,
      },
    });
    // The client's words stay on the request, never in the log.
    expect(passesLogCheck(created?.data ?? {})).toBe(true);
    expect(JSON.stringify(created)).not.toContain("Category");
    expect(await jobsOf(t.f.firmId, "client-request-alert")).toEqual([]);
  });

  it("the rules decide urgency: starts within 48 hours, or takes from people booked; urgent ones alert", async () => {
    const t = await clientFirm();
    const soon = await t.session({ startsAt: hoursFromNow(30) });
    const later = await t.session({ startsAt: hoursFromNow(100), headcount: 3 });
    await book(t.f, later, 2);
    const a = await sent(t, { kind: "more_places", shiftId: soon, payload: { places: 1 } });
    expect(a.urgent).toBe("starts_soon");
    const b = await sent(t, { kind: "fewer_places", shiftId: later, payload: { places: 1 } });
    expect(b.urgent).toBeNull(); // one free place goes
    const c = await sent(t, { kind: "fewer_places", shiftId: later, payload: { places: 2 } });
    expect(c.urgent).toBe("affects_booked");
    const d = await sent(t, { kind: "cancel_session", shiftId: later, payload: {} });
    expect(d.urgent).toBe("affects_booked");
    expect((await requestRow(a.requestId))?.urgent).toBe(true);
    expect((await requestRow(b.requestId))?.urgent).toBe(false);
    expect((await jobsOf(t.f.firmId, "client-request-alert")).map((j) => j.requestId)).toEqual([
      a.requestId,
      c.requestId,
      d.requestId,
    ]);
  });
});

describe("the office's queue and what accepting does", () => {
  it("waiting first, urgent first; narrowed to the contracts a resourcer looks after; payroll refused", async () => {
    const t = await clientFirm();
    const far = await t.session({ startsAt: hoursFromNow(100) });
    const near = await t.session({ startsAt: hoursFromNow(20) });
    const calm = await sent(t, { kind: "more_places", shiftId: far, payload: { places: 1 } });
    const urgent = await sent(t, { kind: "more_places", shiftId: near, payload: { places: 1 } });
    const q = await officeClientRequests(t.office());
    expect(q?.requests.map((r) => r.id)).toEqual([urgent.requestId, calm.requestId]);
    expect(q?.counts).toEqual({ waiting: 2, accepted: 0, declined: 0, planner: 0 });
    expect(q?.urgent).toBe(1);
    expect(q?.requests[0]).toMatchObject({
      contractName: "Demo Stadium Ltd",
      contactName: "Priya Shah",
      urgent: "starts_soon",
    });
    // A resourcer who looks after the other contract only: none of these (all: both).
    await su.query(
      "insert into office_user_clients (firm_id, office_user_id, client_id) values ($1, $2, $3)",
      [t.f.firmId, t.resourcer, t.otherContract],
    );
    expect((await officeClientRequests(t.office()))?.requests).toEqual([]);
    expect((await officeClientRequests(t.office(), { scope: "all" }))?.requests).toHaveLength(2);
    expect(await officeClientRequests(t.office(t.payroll))).toBeNull();
    expect(await officeClientRequestPreview(t.office(t.payroll), calm.requestId)).toBeNull();
  });

  it("the preview: places before and after, who a cut cancels with their notice, offers, a planner's session", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 12, startsAt: hoursFromNow(40) });
    await book(t.f, s, 9);
    const more = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 4 } });
    const p = await officeClientRequestPreview(t.office(), more.requestId);
    expect(p?.accept).toMatchObject({
      kind: "places",
      change: {
        before: { places: 12, booked: 9, toFill: 3 },
        after: { places: 16, booked: 9, toFill: 7 },
        cancels: 0,
      },
      cancels: [],
      offers: "now",
    });
    const fewer = await sent(t, { kind: "fewer_places", shiftId: s, payload: { places: 5 } });
    const pf = await officeClientRequestPreview(t.office(), fewer.requestId);
    if (pf?.accept.kind !== "places") throw new Error("not places");
    expect(pf.accept.change.cancels).toBe(2);
    // The latest booked first, each with the notice they'd get (40 hours).
    expect(pf.accept.cancels.map((c) => [c.name, c.noticeHours])).toEqual([
      ["Casual8 Booker", 40],
      ["Casual7 Booker", 40],
    ]);
    await su.query("update shifts set source = 'api' where id = $1", [s]);
    const planner = await officeClientRequestPreview(t.office(), fewer.requestId);
    expect(planner?.accept).toEqual({ kind: "planner", owner: "planner", plannerName: null });
  });
});

describe("accepting", () => {
  it("more places: added, and offered at once while the session shows to casuals", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 3 });
    await book(t.f, s, 3);
    expect((await shiftRow(s))?.status).toBe("open"); // the fixture leaves the status as it is
    await su.query("update shifts set status = 'filled' where id = $1", [s]);
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 2 } });
    const accepted = await acceptClientRequest(t.office(), { requestId: r.requestId });
    expect(accepted).toEqual({
      status: "accepted",
      applied: { kind: "more_places", from: 3, to: 5, offers: "offering" },
    });
    expect(await shiftRow(s)).toMatchObject({ headcount: 5, status: "open", is_urgent: true });
    expect((await jobsOf(t.f.firmId, "offer-wave")).map((j) => j.shiftId)).toEqual([s]);
    expect((await requestRow(r.requestId))?.status).toBe("accepted");
    const [log] = await eventsOf(t.f.firmId, "client_request.accepted");
    expect(log?.data).toEqual({
      contractId: t.contract,
      kind: "more_places",
      shiftId: s,
      from: 3,
      to: 5,
      offers: "offering",
    });
    expect((await eventsOf(t.f.firmId, "shift.changed")).at(-1)?.data).toMatchObject({
      by: "firm",
      fields: ["headcount"],
      from: { headcount: 3 },
      to: { headcount: 5 },
    });
    // The client is emailed: one answer job, keyed by the log entry.
    expect(await jobsOf(t.f.firmId, "client-request-answer")).toHaveLength(1);
    // Answered once only.
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "already_answered",
    });
  });

  it("more places on a session hidden from casuals: added, no offers until it's shown", async () => {
    const t = await clientFirm();
    const s = await t.session();
    await su.query("update shift_events set showing_to_casuals = false where id = $1", [t.event]);
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 1 } });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toMatchObject({
      applied: { offers: "offering_hidden" },
    });
    expect(await jobsOf(t.f.firmId, "offer-wave")).toEqual([]);
  });

  it("fewer places with people booked: the latest booked are cancelled by the firm, with notice and a message each", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 4, startsAt: hoursFromNow(30) });
    const people = await book(t.f, s, 3); // one place free
    const r = await sent(t, { kind: "fewer_places", shiftId: s, payload: { places: 3 } });
    expect(r.urgent).toBe("starts_soon");
    const accepted = await acceptClientRequest(t.office(), { requestId: r.requestId });
    expect(accepted).toEqual({
      status: "accepted",
      applied: { kind: "fewer_places", from: 4, to: 1, cancelled: 2 },
    });
    expect((await shiftRow(s))?.headcount).toBe(1);
    const { rows } = await su.query<{
      worker_id: string;
      status: string;
      slot: number;
      notice_hours: string;
      cancel_reason: string | null;
      cancel_asked_by: string | null;
      cancel_via: string | null;
    }>(
      `select worker_id::text, status, slot, notice_hours, cancel_reason, cancel_asked_by, cancel_via
         from assignments where shift_id = $1 and worker_id is not null order by confirmed_at`,
      [s],
    );
    expect(rows.map((a) => [a.worker_id, a.status])).toEqual([
      [people[0]?.workerId, "confirmed"],
      [people[1]?.workerId, "cancelled_firm"],
      [people[2]?.workerId, "cancelled_firm"],
    ]);
    expect(rows[0]?.slot).toBe(1);
    for (const a of rows.slice(1)) {
      expect(a).toMatchObject({
        notice_hours: "30.00",
        cancel_reason: "The client needs fewer staff",
        cancel_asked_by: "client",
        cancel_via: "office",
      });
    }
    // Each logged as the firm's cancellation (golden rule 12), and each casual told.
    const cancelled = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(cancelled.map((e) => [e.data.by, e.data.askedBy, e.data.noticeHours])).toEqual([
      ["firm", "client", 30],
      ["firm", "client", 30],
    ]);
    expect(await jobsOf(t.f.firmId, "firm-change-notice")).toHaveLength(2);
  });

  it("fewer places, all free: the bookings move down into the places left, nobody is cancelled", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 4 });
    // Booked in the top place, the three below free.
    const [p] = await book(t.f, s, 1, 4);
    const r = await sent(t, { kind: "fewer_places", shiftId: s, payload: { places: 3 } });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "accepted",
      applied: { kind: "fewer_places", from: 4, to: 1, cancelled: 0 },
    });
    expect(await shiftRow(s)).toMatchObject({ headcount: 1, status: "filled" });
    const { rows } = await su.query<{ slot: number; status: string }>(
      "select slot, status from assignments where id = $1",
      [p?.assignmentId],
    );
    expect(rows[0]).toEqual({ slot: 1, status: "confirmed" });
    expect(await eventsOf(t.f.firmId, "shift.cancelled")).toEqual([]);
  });

  it("new times: the firm's move, each booked casual given notice and told", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(72) }); // Thu 5 Nov 09:00 London
    await book(t.f, s, 1);
    const r = await sent(t, {
      kind: "new_times",
      shiftId: s,
      payload: { date: "2026-11-05", start: "10:00", end: "15:00" },
    });
    expect(r.urgent).toBe("affects_booked");
    const accepted = await acceptClientRequest(t.office(), { requestId: r.requestId });
    expect(accepted).toMatchObject({
      status: "accepted",
      applied: { kind: "new_times", status: "curtailed", told: 1, noticeHours: 72 },
    });
    const row = await shiftRow(s);
    expect(row?.starts_at.toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(row?.ends_at.toISOString()).toBe("2026-11-05T15:00:00.000Z");
    expect((await eventsOf(t.f.firmId, "shift.curtailed"))[0]?.data).toMatchObject({
      by: "firm",
      reason: "The event's times or place changed",
      noticeHours: 72,
    });
    expect(await jobsOf(t.f.firmId, "firm-change-notice")).toHaveLength(1);
  });

  it("new times someone booked can't work: refused as a whole, the request still waits, the refusal logged", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(72) });
    const [p] = await book(t.f, s, 1);
    // Their only licence runs out before the new day.
    await su.query("update credentials set expires_on = '2026-11-06' where worker_id = $1", [
      p?.workerId,
    ]);
    await su.query(
      "update credentials set status = 'expired' where worker_id = $1 and type = 'STEWARD_L2'",
      [p?.workerId],
    );
    const r = await sent(t, {
      kind: "new_times",
      shiftId: s,
      payload: { date: "2026-11-05", start: "11:00", end: "18:00" },
    });
    const result = await acceptClientRequest(t.office(), { requestId: r.requestId });
    expect(result.status).toBe("blocked");
    expect((await requestRow(r.requestId))?.status).toBe("waiting");
    expect((await shiftRow(s))?.starts_at.toISOString()).toBe(hoursFromNow(72).toISOString());
    expect(await eventsOf(t.f.firmId, "shift.move_refused")).toHaveLength(1);
    expect(await eventsOf(t.f.firmId, "client_request.accepted")).toEqual([]);
  });

  it("cancel: the firm cancels the session, every booking with notice, asked by the client", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(50) });
    await book(t.f, s, 2);
    const r = await sent(t, { kind: "cancel_session", shiftId: s, payload: {} });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "accepted",
      applied: { kind: "cancel_session", bookings: 2 },
    });
    expect((await shiftRow(s))?.status).toBe("cancelled");
    const { rows } = await su.query<{ status: string; cancel_asked_by: string }>(
      "select status, cancel_asked_by from assignments where shift_id = $1 and worker_id is not null",
      [s],
    );
    expect(rows).toEqual([
      { status: "cancelled_firm", cancel_asked_by: "client" },
      { status: "cancelled_firm", cancel_asked_by: "client" },
    ]);
    expect((await eventsOf(t.f.firmId, "shift.cancelled_by_firm"))[0]?.data).toMatchObject({
      reason: "The client needs fewer staff",
      bookings: 2,
    });
  });

  it("a session from the firm's planner or sheet: unchanged here, on 'To do in <planner>' until marked done", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 3 });
    await su.query("update shifts set source = 'api' where id = $1", [s]);
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 2 } });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "planner",
      owner: "planner",
    });
    expect((await shiftRow(s))?.headcount).toBe(3);
    expect((await requestRow(r.requestId))?.status).toBe("done_in_planner");
    expect((await officeClientRequests(t.office(), { tab: "planner" }))?.requests).toHaveLength(1);
    // The client sees it accepted.
    expect((await clientRequestList(t.client()))?.[0]?.status).toBe("done_in_planner");
    expect(await markPlannerDone(t.office(), r.requestId)).toEqual({ status: "done" });
    expect(await markPlannerDone(t.office(), r.requestId)).toEqual({ status: "not_to_do" });
    expect((await officeClientRequests(t.office(), { tab: "accepted" }))?.requests).toHaveLength(1);
    expect((await eventsOf(t.f.firmId, "client_request.planner_done"))[0]?.data).toEqual({
      contractId: t.contract,
      kind: "more_places",
    });
  });

  it("a new event: made here with its sessions, hidden from casuals until the office shows it", async () => {
    const t = await clientFirm();
    const r = await sent(t, {
      kind: "new_event",
      payload: {
        name: "Demo Rovers v City Demo",
        venue: { siteId: t.venue },
        date: "2026-11-28",
        sessions: [
          { role: "steward", places: 8, start: "11:00", end: "18:00", notes: "North Gate" },
          { role: "door_supervisor", places: 2, start: "12:00", end: "19:00" },
        ],
      },
    });
    const accepted = await acceptClientRequest(t.office(), { requestId: r.requestId });
    if (accepted.status !== "accepted" || accepted.applied.kind !== "new_event")
      throw new Error(JSON.stringify(accepted));
    const { eventId } = accepted.applied;
    const { rows: ev } = await su.query<{
      name: string;
      showing_to_casuals: boolean;
      site_id: string;
    }>("select name, showing_to_casuals, site_id::text from shift_events where id = $1", [eventId]);
    expect(ev[0]).toEqual({
      name: "Demo Rovers v City Demo",
      showing_to_casuals: false,
      site_id: t.venue,
    });
    const { rows: ss } = await su.query<{ role: string; headcount: number; post: string | null }>(
      "select role, headcount, post from shifts where event_id = $1 order by role",
      [eventId],
    );
    expect(ss).toEqual([
      { role: "door_supervisor", headcount: 2, post: null },
      { role: "steward", headcount: 8, post: "North Gate" },
    ]);
    expect((await requestRow(r.requestId))?.event_id).toBe(eventId);
    expect(await eventsOf(t.f.firmId, "event.hidden")).toHaveLength(1);
    // The client now sees it, numbers only.
    expect((await clientEvent(t.client(), eventId))?.places).toBe(10);
  });

  it("payroll can't answer; something else is accepted with nothing changed", async () => {
    const t = await clientFirm();
    const r = await sent(t, { kind: "other", payload: { text: "Can we meet?" } });
    expect(await acceptClientRequest(t.office(t.payroll), { requestId: r.requestId })).toEqual({
      status: "not_allowed",
    });
    expect(
      await acceptClientRequest(t.office(), { requestId: r.requestId, note: "See you Tuesday." }),
    ).toEqual({
      status: "accepted",
      applied: { kind: "other" },
    });
    expect((await requestRow(r.requestId))?.office_answer).toBe("See you Tuesday.");
  });
});

describe("declining, asking and the client's reply", () => {
  it("a decline needs a reason the client sees; a question waits for their reply", async () => {
    const t = await clientFirm();
    const s = await t.session();
    const a = await sent(t, { kind: "cancel_session", shiftId: s, payload: {} });
    expect(
      await declineClientRequest(t.office(), { requestId: a.requestId, reason: "  " }),
    ).toEqual({
      status: "invalid",
    });
    expect(
      await declineClientRequest(t.office(), {
        requestId: a.requestId,
        reason: "Under 24 hours: casuals are paid anyway.",
      }),
    ).toEqual({ status: "declined" });
    // A minute later (the list is newest first).
    const b = await sent(
      t,
      { kind: "more_places", shiftId: s, payload: { places: 2 } },
      new Date(NOW.getTime() + 60_000),
    );
    expect(
      await askClient(t.office(), { requestId: b.requestId, question: "Which gate?" }),
    ).toEqual({ status: "asked" });
    const list = await clientRequestList(t.client());
    expect(list?.map((r) => [r.status, r.officeAnswer])).toEqual([
      ["asked", "Which gate?"],
      ["declined", "Under 24 hours: casuals are paid anyway."],
    ]);
    // Their reply puts it back with the office; only a question can be replied to.
    expect(
      await replyToClientQuestion(t.client(), { requestId: a.requestId, note: "Please?" }),
    ).toEqual({ status: "not_asked" });
    expect(
      await replyToClientQuestion(t.client(), { requestId: b.requestId, note: "North Gate." }),
    ).toEqual({ status: "sent" });
    expect((await requestRow(b.requestId))?.status).toBe("waiting");
    // Another firm's client can't reply to it.
    const other = await clientFirm();
    expect(
      await replyToClientQuestion(
        { ...other.client(), firm: { id: t.f.firmId } },
        {
          requestId: b.requestId,
          note: "x",
        },
      ),
    ).toEqual({ status: "not_allowed" });
    // The log: ids and kinds only.
    for (const action of [
      "client_request.declined",
      "client_request.asked",
      "client_request.replied",
    ]) {
      const [e] = await eventsOf(t.f.firmId, action);
      expect(passesLogCheck(e?.data ?? {})).toBe(true);
      expect(JSON.stringify(e)).not.toMatch(/gate|24 hours/i);
    }
  });
});

describe("the client's email and the office's notification", () => {
  function fakes() {
    const pushes: { endpoint: string; payload: PushPayload }[] = [];
    const mail: OutboundMessage[] = [];
    const push: PushTransport = {
      name: "test",
      send: async (target, payload) => {
        pushes.push({ endpoint: target.endpoint, payload });
        return { status: "sent" };
      },
    };
    const transport: MessagingTransport = {
      name: "test",
      send: async (m) => {
        mail.push(m);
        return { providerMessageId: `m${mail.length}` };
      },
    };
    const deps: ClientNotifyDeps = {
      push,
      transport,
      baseDomain: "shiftdesk.test",
      clock: clockAt(NOW),
    };
    return { pushes, mail, deps };
  }

  it("each answer emailed once to the client who sent it; a superseded answer isn't", async () => {
    const t = await clientFirm();
    const s = await t.session();
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 1 } });
    await askClient(t.office(), { requestId: r.requestId, question: "Which gate?" });
    await replyToClientQuestion(t.client(), { requestId: r.requestId, note: "North." });
    await declineClientRequest(t.office(), { requestId: r.requestId, reason: "No casuals left." });
    const jobs = await jobsOf(t.f.firmId, "client-request-answer");
    expect(jobs).toHaveLength(2);
    const { mail, deps } = fakes();
    const run = (j: Record<string, unknown>) =>
      runClientRequestAnswer(
        {
          firmId: t.f.firmId,
          idempotencyKey: String(j.idempotencyKey),
          requestId: String(j.requestId),
          answerEventId: Number(j.answerEventId),
        },
        withFirm,
        deps,
      );
    expect(await run(jobs[0] ?? {})).toEqual({ status: "superseded" });
    expect(await run(jobs[1] ?? {})).toEqual({ status: "sent" });
    expect(await run(jobs[1] ?? {})).toEqual({ status: "already" });
    expect(mail).toHaveLength(1);
    const { rows } = await su.query<{ email: string }>(
      "select email from client_contacts where id = $1",
      [t.contact],
    );
    expect(mail[0]).toMatchObject({ channel: "email", to: rows[0]?.email });
    const email = mail[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(email.subject).toMatch(/can't do your request$/);
    expect(email.body).toContain("Why: No casuals left.");
    expect(email.body).toContain("/client/requests");
    expect((await eventsOf(t.f.firmId, "client_request.email_sent")).length).toBe(1);
  });

  it("an urgent request is pushed to those on its contract who want it, once each", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(20) });
    // The resourcer looks after this contract; a second resourcer another; the admin none (every
    // contract) but switched client requests off; payroll never.
    const other = await t.f.office("resourcer");
    await su.query(
      `insert into office_user_clients (firm_id, office_user_id, client_id) values ($1, $2, $3), ($1, $4, $5)`,
      [t.f.firmId, t.resourcer, t.contract, other, t.otherContract],
    );
    await su.query("update office_users set tell_me = array['summary'] where id = $1", [t.admin]);
    for (const id of [t.resourcer, other, t.admin, t.payroll]) {
      await su.query(
        `insert into office_push_subscriptions (firm_id, office_user_id, endpoint, p256dh, auth)
         values ($1, $2, $3, 'k', 'a')`,
        [t.f.firmId, id, `https://fcm.googleapis.com/fcm/send/client-${randomUUID()}`],
      );
    }
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 2 } });
    const { pushes, deps } = fakes();
    const payload = {
      firmId: t.f.firmId,
      idempotencyKey: `client-request-alert:${r.requestId}`,
      requestId: r.requestId,
    };
    expect(await runClientRequestAlert(payload, withFirm, deps)).toEqual({
      status: "sent",
      people: 1,
      pushes: 1,
    });
    expect(pushes[0]?.payload).toMatchObject({
      title: "Urgent client request · Demo Stadium Ltd",
      url: "/office/client-requests",
      urgent: true,
    });
    expect(JSON.stringify(pushes)).not.toMatch(/Casual|Booker/);
    expect(await runClientRequestAlert(payload, withFirm, deps)).toEqual({ status: "not_needed" });
  });

  it("Updates, the bell, Needs attention, the top bar and the summary count client requests", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(20) });
    const r = await sent(
      t,
      { kind: "more_places", shiftId: s, payload: { places: 2 } },
      hoursFromNow(-1),
    );
    const page = await withFirm(t.f.firmId, (tx) => loadUpdatesPage(tx, NOW, t.resourcer));
    const item = page.needsAction.find((u) => u.kind === "client-request");
    expect(item).toMatchObject({
      kind: "client-request",
      requestId: r.requestId,
      status: "waiting",
      contract: "Demo Stadium Ltd",
      urgent: "starts_soon",
    });
    expect(page.newCount).toBe(1);
    expect(
      await withFirm(t.f.firmId, (tx) => countNeedsAction(tx, NOW, null)),
    ).toBeGreaterThanOrEqual(1);
    const since = await withFirm(t.f.firmId, (tx) => countSince(tx, hoursFromNow(-2), NOW, null));
    expect(since.clientRequests).toBe(1);
    const frame = await loadOfficeFrame(t.office());
    expect(frame.clientRequests).toEqual({
      ok: true,
      data: { waiting: 1, urgent: 1, plannerToDo: 0 },
    });
    if (!frame.needs?.needs.ok) throw new Error("no needs");
    expect(frame.needs.needs.data.clientRequests).toEqual({
      waiting: 1,
      urgent: 1,
      plannerToDo: 0,
    });
    // Once answered, gone from Needs action.
    await declineClientRequest(t.office(), { requestId: r.requestId, reason: "No." });
    const after = await withFirm(t.f.firmId, (tx) => loadUpdatesPage(tx, NOW, t.resourcer));
    expect(after.everything.some((u) => u.kind === "client-request")).toBe(false);
  });

  it("every client log entry passes the log's check", async () => {
    const { rows } = await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events
        where action like 'client_request.%' or action like 'client_contact.%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(passesLogCheck(r.data), r.action).toBe(true);
  });
});
