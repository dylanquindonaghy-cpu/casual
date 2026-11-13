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
import { runOfficeAlertsTick } from "@/lib/office/alerts";
import { loadNeedsAttention } from "@/lib/office/dashboard";
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
    // The event-cancelled reason (not "fewer staff"), on the log and on each booking (L1).
    expect((await eventsOf(t.f.firmId, "shift.cancelled_by_firm"))[0]?.data).toMatchObject({
      reason: "The event was cancelled",
      bookings: 2,
    });
    const { rows: why } = await su.query<{ cancel_reason: string }>(
      "select cancel_reason from assignments where shift_id = $1 and worker_id is not null",
      [s],
    );
    expect(why.map((w) => w.cancel_reason)).toEqual([
      "The event was cancelled",
      "The event was cancelled",
    ]);
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
    // Each session's notes are its instructions (M4: never squeezed into the 200-character post).
    const { rows: ss } = await su.query<{
      role: string;
      headcount: number;
      post: string | null;
      instructions: string | null;
      site_id: string;
    }>(
      "select role, headcount, post, instructions, site_id::text from shifts where event_id = $1 order by role",
      [eventId],
    );
    expect(ss).toEqual([
      { role: "door_supervisor", headcount: 2, post: null, instructions: null, site_id: t.venue },
      {
        role: "steward",
        headcount: 8,
        post: null,
        instructions: "North Gate",
        site_id: t.venue,
      },
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

// The guardrails review's findings on 36.3/36.4's back end, each held by a test.
describe("the review's fixes", () => {
  function fakes(at: Date) {
    const pushes: { endpoint: string; payload: PushPayload }[] = [];
    const mail: OutboundMessage[] = [];
    const deps: ClientNotifyDeps = {
      push: {
        name: "test",
        send: async (target, payload) => {
          pushes.push({ endpoint: target.endpoint, payload });
          return { status: "sent" };
        },
      },
      transport: {
        name: "test",
        send: async (m) => {
          mail.push(m);
          return { providerMessageId: `m${mail.length}` };
        },
      },
      baseDomain: "shiftdesk.test",
      clock: clockAt(at),
    };
    return { pushes, mail, deps };
  }
  const newEvent = (
    venue: { siteId: string } | { address: string },
    sessions: { role: string; places: number; start: string; end: string; notes?: string }[] = [
      { role: "steward", places: 4, start: "10:00", end: "16:00" },
    ],
  ) => ({
    kind: "new_event",
    payload: { name: "Winter Fair", venue, date: "2026-11-28", sessions },
  });
  const otherVenueOf = async (t: Awaited<ReturnType<typeof clientFirm>>) => {
    const { rows } = await su.query<{ id: string }>(
      "select site_id::text as id from shift_events where id = $1",
      [t.otherEvent],
    );
    return rows[0]?.id ?? "";
  };
  const winterFairs = async (firmId: string) =>
    (
      await su.query("select 1 from shift_events where firm_id = $1 and name = 'Winter Fair'", [
        firmId,
      ])
    ).rowCount;

  it("M2: a new event at a typed address needs one of the contract's venues chosen; the client then sees it", async () => {
    const t = await clientFirm();
    const r = await sent(t, newEvent({ address: "Winter Park, 9 Frost Lane, ZZ9 9ZZ" }));
    // The preview says a venue must be chosen, and lists the contract's to choose from.
    expect((await officeClientRequestPreview(t.office(), r.requestId))?.accept).toMatchObject({
      kind: "new_event",
      venue: { address: "Winter Park, 9 Frost Lane, ZZ9 9ZZ" },
      venues: [{ siteId: t.venue, name: "Demo Stadium" }],
      problems: ["choose_venue"],
    });
    // Without one, another contract's, another firm's or none at all: refused, nothing made.
    const other = await clientFirm();
    for (const siteId of [undefined, await otherVenueOf(t), other.venue, randomUUID()]) {
      expect(
        await acceptClientRequest(t.office(), {
          requestId: r.requestId,
          ...(siteId ? { siteId } : {}),
        }),
      ).toEqual({ status: "invalid", problem: "venue" });
    }
    expect(await winterFairs(t.f.firmId)).toBe(0);
    expect((await requestRow(r.requestId))?.status).toBe("waiting");
    // One of theirs: made there, and the client sees it.
    const accepted = await acceptClientRequest(t.office(), {
      requestId: r.requestId,
      siteId: t.venue,
    });
    if (accepted.status !== "accepted" || accepted.applied.kind !== "new_event")
      throw new Error(JSON.stringify(accepted));
    const { rows } = await su.query<{ site_id: string }>(
      "select site_id::text from shift_events where id = $1",
      [accepted.applied.eventId],
    );
    expect(rows[0]?.site_id).toBe(t.venue);
    expect((await clientEvent(t.client(), accepted.applied.eventId))?.places).toBe(4);
  });

  it("M3: a venue that's no longer the contract's when accepting: refused, nothing made", async () => {
    const t = await clientFirm();
    const r = await sent(t, newEvent({ siteId: t.venue }));
    // The venue moves to the other contract after the request was sent.
    await su.query("update sites set client_id = $2 where id = $1", [t.venue, t.otherContract]);
    expect((await officeClientRequestPreview(t.office(), r.requestId))?.accept).toMatchObject({
      kind: "new_event",
      problems: ["bad_venue"],
      venues: [],
    });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "invalid",
      problem: "new_event",
      problems: [{ line: null, problem: "bad_site" }],
    });
    expect(await winterFairs(t.f.firmId)).toBe(0);
    expect((await requestRow(r.requestId))?.status).toBe("waiting");
  });

  it("M4: notes up to 500 characters become each session's instructions, all in one event", async () => {
    const t = await clientFirm();
    const long = "Meet at the North Gate steward point; bring hi-vis and ID. ".repeat(9).trim();
    const notes = long.slice(0, 500);
    expect([...notes].length).toBe(500);
    const r = await sent(
      t,
      newEvent({ siteId: t.venue }, [
        { role: "steward", places: 4, start: "10:00", end: "16:00", notes },
        { role: "steward", places: 2, start: "12:00", end: "18:00" },
        { role: "door_supervisor", places: 1, start: "10:00", end: "16:00", notes: "Main door" },
      ]),
    );
    const preview = await officeClientRequestPreview(t.office(), r.requestId);
    if (preview?.accept.kind !== "new_event") throw new Error("not a new event");
    expect(preview.accept.sessions.map((x) => x.instructions)).toEqual([notes, null, "Main door"]);
    expect(preview.accept.problems).toEqual([]);
    const accepted = await acceptClientRequest(t.office(), { requestId: r.requestId });
    if (accepted.status !== "accepted" || accepted.applied.kind !== "new_event")
      throw new Error(JSON.stringify(accepted));
    expect(accepted.applied.shiftIds).toHaveLength(3);
    const { rows } = await su.query<{
      event_id: string;
      headcount: number;
      post: string | null;
      instructions: string | null;
    }>(
      `select event_id::text, headcount, post, instructions from shifts
        where id = any($1::uuid[]) order by headcount desc`,
      [accepted.applied.shiftIds],
    );
    expect(rows.map((x) => [x.headcount, x.post, x.instructions])).toEqual([
      [4, null, notes],
      [2, null, null],
      [1, null, "Main door"],
    ]);
    expect(new Set(rows.map((x) => x.event_id))).toEqual(new Set([accepted.applied.eventId]));
    expect(await winterFairs(t.f.firmId)).toBe(1);
    expect(await eventsOf(t.f.firmId, "event.hidden")).toHaveLength(1);
  });

  it("M5: a reply putting an urgent request back, and the tick for one that's become urgent, alert each person once", async () => {
    const t = await clientFirm();
    await su.query(
      `insert into office_push_subscriptions (firm_id, office_user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, 'k', 'a')`,
      [t.f.firmId, t.resourcer, `https://fcm.googleapis.com/fcm/send/client-${randomUUID()}`],
    );
    const alertJobs = async () =>
      (await jobsOf(t.f.firmId, "client-request-alert")).map((j) => ({
        firmId: t.f.firmId,
        idempotencyKey: String(j.idempotencyKey),
        requestId: String(j.requestId),
      }));
    const later = hoursFromNow(60);
    const tick = (at: Date) =>
      runOfficeAlertsTick({
        listFirmIds: async () => [t.f.firmId],
        run: withFirm,
        clock: clockAt(at),
      });

    // Urgent when sent (20 hours away): alerted then; asked, replied: queued again, nobody twice.
    const soon = await t.session({ startsAt: hoursFromNow(20) });
    const a = await sent(t, { kind: "more_places", shiftId: soon, payload: { places: 1 } });
    const [created] = await alertJobs();
    if (!created) throw new Error("no alert");
    expect(await runClientRequestAlert(created, withFirm, fakes(NOW).deps)).toMatchObject({
      status: "sent",
      people: 1,
    });
    await askClient(t.office(), { requestId: a.requestId, question: "Which gate?" });
    expect(
      await replyToClientQuestion(t.client(), { requestId: a.requestId, note: "North." }),
    ).toEqual({ status: "sent" });
    const afterReply = (await alertJobs()).filter(
      (j) => j.idempotencyKey !== created.idempotencyKey,
    );
    expect(afterReply.map((j) => j.requestId)).toEqual([a.requestId]);
    expect(afterReply[0]?.idempotencyKey).toMatch(/:reply-\d+$/);
    expect(
      await runClientRequestAlert(afterReply[0] ?? created, withFirm, fakes(NOW).deps),
    ).toEqual({
      status: "not_needed",
    });

    // Not urgent when sent (100 hours away); asked; replied 60 hours later, when it starts within
    // 48: queued on the reply, and the resourcer told.
    const far = await t.session({ startsAt: hoursFromNow(100) });
    const b = await sent(t, { kind: "more_places", shiftId: far, payload: { places: 1 } });
    expect(b.urgent).toBeNull();
    await askClient(t.office(), { requestId: b.requestId, question: "How many?" });
    expect(
      await replyToClientQuestion(t.client(t.contact, later), {
        requestId: b.requestId,
        note: "1.",
      }),
    ).toEqual({ status: "sent" });
    const forB = (await alertJobs()).filter((j) => j.requestId === b.requestId);
    expect(forB).toHaveLength(1);
    const { pushes, deps } = fakes(later);
    expect(await runClientRequestAlert(forB[0] ?? created, withFirm, deps)).toMatchObject({
      status: "sent",
      people: 1,
    });
    expect(pushes).toHaveLength(1);

    // Waiting all along, not urgent when sent: the tick queues it once it starts within 48 hours.
    const far2 = await t.session({ startsAt: hoursFromNow(100) });
    const c = await sent(t, { kind: "more_places", shiftId: far2, payload: { places: 1 } });
    expect(c.urgent).toBeNull();
    expect((await tick(NOW)).clientRequests).toBe(0); // not urgent yet; a and b told already
    expect((await tick(later)).clientRequests).toBe(1);
    const forC = (await alertJobs()).filter((j) => j.requestId === c.requestId);
    expect(forC).toHaveLength(1);
    expect(forC[0]?.idempotencyKey).toMatch(/:tick-\d+$/);
    expect(
      await runClientRequestAlert(forC[0] ?? created, withFirm, fakes(later).deps),
    ).toMatchObject({ status: "sent", people: 1 });
    // Told: the next slot queues nothing more.
    expect((await tick(new Date(later.getTime() + 5 * 60_000))).clientRequests).toBe(0);
    expect(
      (await eventsOf(t.f.firmId, "office.alerted")).filter(
        (e) => e.data.kind === "client_requests",
      ),
    ).toHaveLength(3);
  });

  it("M6: 20 requests and 20 replies an hour per contact, then rate_limited with nothing stored", async () => {
    const t = await clientFirm();
    const other = (text: string) => ({ kind: "other", payload: { text } });
    for (let i = 0; i < 20; i++) await sent(t, other(`Question ${i}`));
    expect(await createClientRequest(t.client(), other("One more"))).toEqual({
      status: "rate_limited",
      retryAfterMinutes: 60,
    });
    expect(await createClientRequest(t.client(), other("And another"))).toEqual({
      status: "rate_limited",
      retryAfterMinutes: 60,
    });
    const count = async () =>
      (
        await su.query<{ n: number }>(
          "select count(*)::int as n from client_requests where firm_id = $1",
          [t.f.firmId],
        )
      ).rows[0]?.n;
    expect(await count()).toBe(20);
    // Logged once, when first reached, with the contact's id only.
    const limited = await eventsOf(t.f.firmId, "auth.rate_limited");
    expect(limited).toEqual([
      { entity_id: t.contact, actor_type: "system", data: { limit: "client_request:contact" } },
    ]);
    // A colleague on the same contract has their own; an hour on, theirs again.
    const colleague = await one(
      `insert into client_contacts (firm_id, contract_id, name, email, created_by)
       values ($1, $2, 'Sam Lee', $3, $4)`,
      [t.f.firmId, t.contract, `sam.${randomUUID().slice(0, 6)}@example.com`, t.admin],
    );
    expect((await createClientRequest(t.client(colleague), other("Hi"))).status).toBe("sent");
    expect(
      (await createClientRequest(t.client(t.contact, hoursFromNow(1)), other("Later"))).status,
    ).toBe("sent");

    // Replies: every try counts (an answer to nothing asked too); over 20, nothing changes.
    const [first] = (await clientRequestList(t.client())) ?? [];
    if (!first) throw new Error("no request");
    await askClient(t.office(), { requestId: first.id, question: "When?" });
    const asked = (await clientRequestList(t.client()))?.find((x) => x.status === "asked");
    const notAsked = (await clientRequestList(t.client()))?.find((x) => x.status === "waiting");
    if (!asked || !notAsked) throw new Error("no requests");
    for (let i = 0; i < 20; i++) {
      expect(
        await replyToClientQuestion(t.client(), { requestId: notAsked.id, note: "Hello" }),
      ).toEqual({ status: "not_asked" });
    }
    expect(
      await replyToClientQuestion(t.client(), { requestId: asked.id, note: "Friday." }),
    ).toEqual({ status: "rate_limited", retryAfterMinutes: 60 });
    expect((await requestRow(asked.id))?.status).toBe("asked");
    expect(
      await replyToClientQuestion(t.client(t.contact, hoursFromNow(1)), {
        requestId: asked.id,
        note: "Friday.",
      }),
    ).toEqual({ status: "sent" });
  });

  it("L2: the client's list and the office's queue agree on urgency (new times within 48 hours)", async () => {
    const t = await clientFirm();
    const s = await t.session({ startsAt: hoursFromNow(100) }); // nobody booked
    const r = await sent(t, {
      kind: "new_times",
      shiftId: s,
      payload: { date: "2026-11-03", start: "10:00", end: "15:00" }, // 25 hours away
    });
    expect(r.urgent).toBe("starts_soon");
    expect((await clientRequestList(t.client()))?.[0]?.urgent).toBe("starts_soon");
    expect((await officeClientRequests(t.office()))?.requests[0]?.urgent).toBe("starts_soon");
  });

  it("L3: a session at their venue in another contract's event shows their venue, never the other's name or address", async () => {
    const t = await clientFirm();
    await su.query(
      "update sites set address_line1 = '99 Hidden Street', postcode = 'ZZ2 2ZZ' where name = 'Other Hall' and firm_id = $1",
      [t.f.firmId],
    );
    const s = await t.session({ eventId: t.otherEvent });
    await su.query("update shifts set site_id = $2 where id = $1", [s, t.venue]);
    const events = await clientEvents(t.client());
    expect(events?.map((e) => [e.name, e.site, e.address])).toEqual([
      ["Demo Stadium", "Demo Stadium", "1 Demo Road, ZZ1 4AA"],
    ]);
    expect(events?.[0]?.sessions.map((x) => x.site)).toEqual(["Demo Stadium"]);
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/Other Gala|Other Hall|Hidden Street|ZZ2 2ZZ/);
    // Their own event still shows its own name.
    await t.session();
    expect((await clientEvents(t.client()))?.map((e) => e.name)).toContain(
      "Demo Rovers v Visitors FC",
    );
  });

  it("L4: a request's contact must be on the request's own contract (the database holds it)", async () => {
    const t = await clientFirm();
    const elsewhere = await one(
      `insert into client_contacts (firm_id, contract_id, name, email, created_by)
       values ($1, $2, 'Other Person', $3, $4)`,
      [t.f.firmId, t.otherContract, `other.${randomUUID().slice(0, 6)}@example.com`, t.admin],
    );
    const err = await su
      .query(
        `insert into client_requests (firm_id, contract_id, client_contact_id, kind, payload)
         values ($1, $2, $3, 'other', '{"text": "Probe"}'::jsonb)`,
        [t.f.firmId, t.contract, elsewhere],
      )
      .then(
        () => null,
        (e: { code?: string; constraint?: string }) => e,
      );
    expect(err).toMatchObject({ code: "23503", constraint: "client_requests_contact_fk" });
  });

  it("L5: the answer email links to the firm's verified own domain, else its portal", async () => {
    const t = await clientFirm();
    const domain = `shifts-${randomUUID().slice(0, 8)}.example.test`;
    const answer = async () => {
      const r = await sent(t, { kind: "other", payload: { text: "Hello" } });
      await declineClientRequest(t.office(), { requestId: r.requestId, reason: "Not this time." });
      const job = (await jobsOf(t.f.firmId, "client-request-answer")).find(
        (j) => j.requestId === r.requestId,
      );
      const { mail, deps } = fakes(NOW);
      await runClientRequestAnswer(
        {
          firmId: t.f.firmId,
          idempotencyKey: String(job?.idempotencyKey),
          requestId: r.requestId,
          answerEventId: Number(job?.answerEventId),
        },
        withFirm,
        deps,
      );
      return (mail[0] as Extract<OutboundMessage, { channel: "email" }> | undefined)?.body ?? "";
    };
    // Set but not verified: the portal.
    await su.query("update firms set custom_domain = $2 where id = $1", [t.f.firmId, domain]);
    const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
      t.f.firmId,
    ]);
    expect(await answer()).toContain(`https://${rows[0]?.slug}.shiftdesk.test/client/requests`);
    await su.query("update firms set domain_verified = true where id = $1", [t.f.firmId]);
    const body = await answer();
    expect(body).toContain(`https://${domain}/client/requests`);
    expect(body).not.toContain("shiftdesk.test");
  });

  it("L6: Needs attention counts client requests only for someone who may use them", async () => {
    const t = await clientFirm();
    await sent(t, { kind: "other", payload: { text: "Hello" } });
    const needs = (clientRequests: boolean) =>
      withFirm(t.f.firmId, (tx) =>
        loadNeedsAttention(tx, NOW, "Europe/London", { clientRequests }),
      );
    expect((await needs(true)).clientRequests).toEqual({ waiting: 1, urgent: 0, plannerToDo: 0 });
    expect((await needs(false)).clientRequests).toEqual({ waiting: 0, urgent: 0, plannerToDo: 0 });
  });
});

// The second review of Phase 36 (N1, N2, N3, N6, N7), each held by a test.
describe("the second review's fixes", () => {
  const mailFakes = () => {
    const mail: OutboundMessage[] = [];
    const deps: ClientNotifyDeps = {
      push: { name: "test", send: async () => ({ status: "sent" }) },
      transport: {
        name: "test",
        send: async (m) => {
          mail.push(m);
          return { providerMessageId: `m${mail.length}` };
        },
      },
      baseDomain: "shiftdesk.test",
      clock: clockAt(NOW),
    };
    return { mail, deps };
  };
  const assignmentsOf = async (shiftId: string) =>
    (
      await su.query<{ status: string }>(
        "select status from assignments where shift_id = $1 and worker_id is not null order by id",
        [shiftId],
      )
    ).rows.map((r) => r.status);

  it("N1: a session moved to another contract's venue can't be changed by this contract's request, and the client never sees that venue", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 4, startsAt: hoursFromNow(72) });
    await book(t.f, s, 2);
    const fewer = await sent(t, { kind: "fewer_places", shiftId: s, payload: { places: 3 } });
    const times = await sent(t, {
      kind: "new_times",
      shiftId: s,
      payload: { date: "2026-11-05", start: "10:00", end: "15:00" },
    });
    const cancel = await sent(t, { kind: "cancel_session", shiftId: s, payload: {} });
    // The session moves to the other contract's venue, at a door of theirs.
    const { rows: hall } = await su.query<{ id: string }>(
      "select id::text from sites where firm_id = $1 and name = 'Other Hall'",
      [t.f.firmId],
    );
    await su.query("update shifts set site_id = $2, post = 'Hall B door' where id = $1", [
      s,
      hall[0]?.id,
    ]);
    const before = await shiftRow(s);
    for (const r of [fewer, times, cancel]) {
      expect((await officeClientRequestPreview(t.office(), r.requestId))?.accept).toEqual({
        kind: "gone",
        why: "moved",
      });
      expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
        status: "not_theirs",
      });
      expect((await requestRow(r.requestId))?.status).toBe("waiting");
    }
    // Nothing changed on the other contract's session.
    expect(await shiftRow(s)).toEqual(before);
    expect(await assignmentsOf(s)).toEqual(["confirmed", "confirmed"]);
    expect(await eventsOf(t.f.firmId, "client_request.accepted")).toEqual([]);
    // A planner's session moved the same way isn't put on the planner's to-do list either.
    await su.query("update shifts set source = 'api' where id = $1", [s]);
    expect(await acceptClientRequest(t.office(), { requestId: fewer.requestId })).toEqual({
      status: "not_theirs",
    });
    await su.query("update shifts set source = 'native' where id = $1", [s]);

    // The client's list holds no session for them now: never the other venue, its door or times.
    const list = await clientRequestList(t.client());
    expect(list?.map((r) => r.session)).toEqual([null, null, null]);
    expect(JSON.stringify(list)).not.toMatch(/Other Hall|Hall B door/);
    // Nor does the answer's email.
    await declineClientRequest(t.office(), { requestId: fewer.requestId, reason: "It moved." });
    const job = (await jobsOf(t.f.firmId, "client-request-answer")).find(
      (j) => j.requestId === fewer.requestId,
    );
    const { mail, deps } = mailFakes();
    expect(
      await runClientRequestAnswer(
        {
          firmId: t.f.firmId,
          idempotencyKey: String(job?.idempotencyKey),
          requestId: fewer.requestId,
          answerEventId: Number(job?.answerEventId),
        },
        withFirm,
        deps,
      ),
    ).toEqual({ status: "sent" });
    const email = mail[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(email.body).toContain("3 places fewer");
    expect(`${email.subject}\n${email.body}`).not.toMatch(/Other Hall|Hall B door/);
    // Back at their venue, it's theirs again.
    await su.query("update shifts set site_id = $2, post = null where id = $1", [s, t.venue]);
    expect((await officeClientRequestPreview(t.office(), times.requestId))?.accept.kind).toBe(
      "times",
    );
  });

  it("N2: a new event's role must be one the contract's events can have, when sent and when accepted", async () => {
    const t = await clientFirm();
    const event = (role: string) => ({
      kind: "new_event",
      payload: {
        name: "Chef's Table",
        venue: { siteId: t.venue },
        date: "2026-11-28",
        sessions: [
          { role: "steward", places: 2, start: "10:00", end: "16:00" },
          { role, places: 1, start: "10:00", end: "16:00" },
        ],
      },
    });
    expect(await createClientRequest(t.client(), event("pastry_chef"))).toEqual({
      status: "invalid",
      problem: "bad_role",
    });
    // One stored before the role list changed (written straight in): refused when accepted.
    const id = await one(
      `insert into client_requests (firm_id, contract_id, client_contact_id, kind, payload)
       values ($1, $2, $3, 'new_event', $4::jsonb)`,
      [t.f.firmId, t.contract, t.contact, JSON.stringify(event("pastry_chef").payload)],
    );
    const preview = await officeClientRequestPreview(t.office(), id);
    expect(preview?.accept).toMatchObject({ kind: "new_event", problems: ["bad_role"] });
    expect(await acceptClientRequest(t.office(), { requestId: id })).toEqual({
      status: "invalid",
      problem: "new_event",
      problems: [{ line: 2, problem: "bad_role" }],
    });
    expect(
      (await su.query("select 1 from shift_events where name = 'Chef''s Table'")).rowCount,
    ).toBe(0);
    // A role the firm has goes through.
    expect((await createClientRequest(t.client(), event("door_supervisor"))).status).toBe("sent");
  });

  it("N3: fewer places leaving none, or no change at all, previews as nothing to accept, as accepting refuses", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 3 });
    const r = await sent(t, { kind: "fewer_places", shiftId: s, payload: { places: 2 } });
    // The office has lowered the places since: two fewer now leaves none.
    await su.query("update shifts set headcount = 2 where id = $1", [s]);
    expect((await officeClientRequestPreview(t.office(), r.requestId))?.accept).toEqual({
      kind: "gone",
      why: "last_place",
    });
    expect(await acceptClientRequest(t.office(), { requestId: r.requestId })).toEqual({
      status: "invalid",
      problem: "last_place",
    });
    // A stored "more places" with no number (not a shape the form sends): no change.
    const odd = await one(
      `insert into client_requests (firm_id, contract_id, client_contact_id, kind, shift_id, payload)
       values ($1, $2, $3, 'more_places', $4, '{}'::jsonb)`,
      [t.f.firmId, t.contract, t.contact, s],
    );
    expect((await officeClientRequestPreview(t.office(), odd))?.accept).toEqual({
      kind: "gone",
      why: "no_change",
    });
    expect(await acceptClientRequest(t.office(), { requestId: odd })).toEqual({
      status: "invalid",
      problem: "form",
    });
    // The same for a stored "fewer places" with no number: nothing to accept, and accepting
    // refuses and changes nothing (the second re-review's L1).
    const noNumber = await one(
      `insert into client_requests (firm_id, contract_id, client_contact_id, kind, shift_id, payload)
       values ($1, $2, $3, 'fewer_places', $4, '{}'::jsonb)`,
      [t.f.firmId, t.contract, t.contact, s],
    );
    expect((await officeClientRequestPreview(t.office(), noNumber))?.accept).toEqual({
      kind: "gone",
      why: "no_change",
    });
    expect(await acceptClientRequest(t.office(), { requestId: noNumber })).toEqual({
      status: "invalid",
      problem: "form",
    });
    expect(
      (await su.query("select headcount from shifts where id = $1", [s])).rows[0]?.headcount,
    ).toBe(2);
    expect(
      (
        await su.query(
          "select count(*)::int as n from events where action = 'client_request.accepted' and entity_id = $1",
          [noNumber],
        )
      ).rows[0]?.n,
    ).toBe(0);
  });

  it("N6: a failure in the tick's client-request part keeps the open-places and summary jobs", async () => {
    const t = await clientFirm();
    let calls = 0;
    const run: WithFirm = (firmId, fn) => {
      calls += 1;
      // The second transaction for the firm is the client-request part's.
      if (calls === 2) return Promise.reject(new Error("the client requests' part failed"));
      return withFirm(firmId, fn);
    };
    const errors: string[] = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (msg: string) => {
        errors.push(msg);
      },
      child: () => logger,
    };
    expect(
      await runOfficeAlertsTick({
        listFirmIds: async () => [t.f.firmId],
        run,
        clock: clockAt(new Date("2026-11-02T08:00:00Z")),
        logger,
      }),
    ).toEqual({ open: 1, summaries: 1, clientRequests: 0 });
    expect(await jobsOf(t.f.firmId, "office-open-alert")).toHaveLength(1);
    expect(await jobsOf(t.f.firmId, "office-summary")).toHaveLength(1);
    expect(errors).toEqual(["client request alerts tick failed for a firm"]);
  });

  it("N7: an accept a deadlock aborted runs again and applies once", async () => {
    const t = await clientFirm();
    const s = await t.session({ headcount: 3 });
    const r = await sent(t, { kind: "more_places", shiftId: s, payload: { places: 2 } });
    let tries = 0;
    const run: WithFirm = async (firmId, fn) => {
      tries += 1;
      if (tries === 1) {
        // Postgres's own error for a transaction it aborted to break a deadlock.
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      }
      return withFirm(firmId, fn);
    };
    expect(
      await acceptClientRequest({ ...t.office(), run }, { requestId: r.requestId, offer: false }),
    ).toEqual({
      status: "accepted",
      applied: { kind: "more_places", from: 3, to: 5, offers: "not_asked" },
    });
    expect(tries).toBe(2);
    expect((await shiftRow(s))?.headcount).toBe(5);
    expect(await eventsOf(t.f.firmId, "client_request.accepted")).toHaveLength(1);
  });
});
