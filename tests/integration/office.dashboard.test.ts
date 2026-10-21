import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { putSessionRequest } from "@/lib/integrations/sessions";
import {
  loadDashboard,
  loadExpiredOnBookings,
  needsAttentionBell,
  needsCount,
  officeDashboard,
  officeNeedsAttention,
  part,
} from "@/lib/office/dashboard";
import { loadCancellations } from "@/lib/office/cancellations";
import { loadEnquiries } from "@/lib/office/enquiries";
import { loadEventCards } from "@/lib/office/events";
import { cancelBooking } from "@/lib/roster/cancel";
import { recordMoveRefused } from "@/lib/roster/firm-change";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { answer, apiDeps, apiRequest, plannerKey } from "../helpers/planner-api";

// The office dashboard (docs/office-v2.md 3.2, 3.9; 12E.1) on the real database, as the app role:
// what each of the four counts counts ("today" is the London calendar day), the sections' data,
// Needs attention's items (a qualification out of date on a booked session read as the rules read
// it; the planner's refused changes worked out from the log, through the planner API itself), the
// bell's number, who may see it, and that one part failing leaves the rest. NOW is Monday
// 2 November 2026, 09:00 London (GMT), so midnight was 00:00 UTC.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let resolveKey: ReturnType<typeof createKeyDirectory>;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
  resolveKey = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const MIDNIGHT = new Date("2026-11-02T00:00:00Z");
const clock = { now: () => NOW };

async function dashFirm() {
  const f = await bookingFirm(su, withFirm);
  const load = () => withFirm(f.firmId, (tx) => loadDashboard(tx, NOW));
  const set = (table: string, id: string, cells: Record<string, unknown>) =>
    su.query(
      `update ${table} set ${Object.keys(cells)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(", ")} where id = $1`,
      [id, ...Object.values(cells)],
    );
  return { ...f, load, set };
}

const counts = async (t: Awaited<ReturnType<typeof dashFirm>>) => {
  const d = await t.load();
  const c = d.counts;
  if (!c.urgent.ok || !c.showing.ok || !c.cancellations.ok || !c.enquiries.ok) {
    throw new Error("a count failed");
  }
  return {
    urgent: c.urgent.data,
    showing: c.showing.data,
    cancellations: c.cancellations.data,
    enquiries: c.enquiries.data,
  };
};

describe("the four counts", () => {
  it("urgent shifts not filled: urgent, open, not started, a place free; the places and the first start", async () => {
    const t = await dashFirm();
    const sam = await t.worker();
    const two = await t.shift({ startsAt: hoursFromNow(5), headcount: 2 }); // 1 of 2 free
    await t.booking(sam, two);
    const later = await t.shift({ startsAt: hoursFromNow(30) }); // 1 free
    const full = await t.shift({ startsAt: hoursFromNow(6) });
    await t.booking(await t.worker(), full);
    const started = await t.shift({ startsAt: hoursFromNow(-1) });
    const draft = await t.shift({ startsAt: hoursFromNow(7), status: "draft" });
    const cancelled = await t.shift({ startsAt: hoursFromNow(8), status: "cancelled" });
    const plain = await t.shift({ startsAt: hoursFromNow(9) }); // not urgent
    for (const id of [two, later, full, started, draft, cancelled]) {
      await t.set("shifts", id, { is_urgent: true });
    }
    const { urgent } = await counts(t);
    expect(urgent).toEqual({ sessions: 2, places: 2, firstStartsAt: hoursFromNow(5) });
    // The count links to Events' "Urgent, not filled": the same sessions.
    const listed = await withFirm(t.firmId, (tx) => loadEventCards(tx, NOW, "urgent"));
    expect(
      listed.events.flatMap((e) => e.sessions.filter((s) => s.urgentGap).map((s) => s.shiftId)),
    ).toEqual([two, later]);
    expect(plain).toBeTruthy();
  });

  it("events showing to casuals: switched on with a session to come; their open places", async () => {
    const t = await dashFirm();
    const on = await t.event({ name: "Showing fair" });
    const a = await t.shift({ startsAt: hoursFromNow(20), headcount: 3, eventId: on });
    await t.booking(await t.worker(), a); // 2 places free
    const hiddenSession = await t.shift({ startsAt: hoursFromNow(22), eventId: on });
    await t.set("shifts", hiddenSession, { showing_to_casuals: false }); // not offered
    const off = await t.event({ name: "Hidden fair", showing: false });
    await t.shift({ startsAt: hoursFromNow(20), eventId: off });
    const past = await t.event({ name: "Over" });
    await t.shift({ startsAt: hoursFromNow(-30), eventId: past });
    const gone = await t.event({ name: "Called off" });
    await t.shift({ startsAt: hoursFromNow(40), eventId: gone, status: "cancelled" });
    const { showing } = await counts(t);
    expect(showing).toEqual({ events: 1, sessions: 1, places: 2 });
    const listed = await withFirm(t.firmId, (tx) => loadEventCards(tx, NOW, "showing"));
    expect(listed.events.map((e) => e.eventId)).toEqual([on]);
  });

  it("showing to casuals: the first 6 cards, 2 sessions each, and how many more there are", async () => {
    const t = await dashFirm();
    for (let n = 1; n <= 8; n += 1) {
      const eventId = await t.event({ name: `Fair ${n}` });
      for (const h of [0, 1, 2]) {
        await t.shift({ startsAt: hoursFromNow(10 * n + h), eventId });
      }
    }
    const d = await t.load();
    if (!d.showing.ok) throw new Error("showing failed");
    expect(d.showing.data.events.map((e) => e.name)).toEqual([
      "Fair 1",
      "Fair 2",
      "Fair 3",
      "Fair 4",
      "Fair 5",
      "Fair 6",
    ]);
    expect(d.showing.data.events.map((e) => [e.sessions.length, e.moreSessions])).toEqual(
      Array(6).fill([2, 1]),
    );
    expect(d.showing.data.more).toBe(2);
  });

  it("cancellations today: since London midnight, by anyone; under the notice; strikes issued", async () => {
    const t = await dashFirm();
    const cancel = async (at: Date, notice: number, status = "cancelled_worker") => {
      const shiftId = await t.shift({ startsAt: hoursFromNow(notice) });
      const id = await t.booking(await t.worker(), shiftId);
      await t.set("assignments", id, {
        status,
        cancelled_at: at,
        cancel_reason: "Unwell",
        notice_hours: notice,
      });
      return { id, shiftId };
    };
    const early = await cancel(new Date("2026-11-02T00:30:00Z"), 20); // today, under 48 hours
    await cancel(new Date("2026-11-02T08:00:00Z"), 72, "cancelled_firm"); // today, by the office
    await cancel(new Date("2026-11-01T23:59:00Z"), 10); // yesterday
    const workers = await su.query<{ worker_id: string }>(
      "select worker_id::text from assignments where id = $1",
      [early.id],
    );
    await su.query(
      `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                            threshold_hours, issued_at, expires_at)
       values ($1, $2, $3, $4, 20, 48, $5, $5::timestamptz + interval '90 days')`,
      [
        t.firmId,
        workers.rows[0]?.worker_id,
        early.id,
        early.shiftId,
        new Date("2026-11-02T00:31:00Z"),
      ],
    );
    const { cancellations } = await counts(t);
    expect(cancellations).toEqual({ total: 2, underNotice: 1, strikes: 1, threshold: 48 });
    // Its link's list (`/office/cancellations?day=today`) holds the same two; without it, all three.
    const list = (day?: "today") =>
      withFirm(t.firmId, (tx) =>
        loadCancellations(tx, { view: "all", now: NOW, limit: 100, ...(day ? { day } : {}) }),
      );
    const todays = await list("today");
    expect(todays.day).toBe("today");
    expect(todays.rows.map((r) => r.cancelledAt.toISOString())).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T00:30:00.000Z",
    ]);
    expect(todays.total).toBe(2);
    expect((await list()).rows).toHaveLength(3);
  });

  it("enquiries today: messages to the shifts line since midnight plus requests made in the app", async () => {
    const t = await dashFirm();
    const ann = await t.worker({ first: "Ann" });
    const message = (at: Date, cells: { handled_as: string | null; intent: string | null }) =>
      su.query(
        `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                               body, worker_id, handled_at, handled_as, intent, created_at)
         values ($1, 'in', 'whatsapp', $2, '+447700900921', '+447700900922', 'hello', $3, $4, $5,
                 $6, $4)`,
        [t.firmId, `SM${randomBytes(16).toString("hex")}`, ann, at, cells.handled_as, cells.intent],
      );
    const today = new Date("2026-11-02T07:00:00Z");
    await message(today, { handled_as: "keyword", intent: "shifts" }); // automatic
    await message(today, { handled_as: "ai", intent: "cancel" }); // automatic
    await message(today, { handled_as: "keyword", intent: "pay" }); // pay: always a person
    await message(today, { handled_as: "office", intent: "office" }); // needs a person
    await message(new Date("2026-11-01T22:00:00Z"), { handled_as: "office", intent: "office" });
    const shiftId = await t.shift({ startsAt: hoursFromNow(48) });
    await su.query(
      `insert into requests (firm_id, worker_id, shift_id, type, payload, created_at)
       values ($1, $2, $3, 'time_change', '{}', $4), ($1, $2, $3, 'swap', '{}', $5)`,
      [t.firmId, ann, shiftId, new Date("2026-11-02T06:00:00Z"), new Date("2026-11-01T12:00:00Z")],
    );
    const { enquiries } = await counts(t);
    // 4 messages today + 1 request made in the app today; 2 by keyword or AI; 2 waiting for a
    // person (today's and yesterday's).
    expect(enquiries).toEqual({ total: 5, automatic: 2, needPerson: 2 });
    // Its link's list (`/office/enquiries?day=today`) holds today's 4 messages, and says how many
    // requests were made in the app today (the fifth); without it, all 5 messages.
    const list = (day?: "today") =>
      withFirm(t.firmId, (tx) => loadEnquiries(tx, "all", NOW, day ? { day } : {}));
    const todays = await list("today");
    expect(todays.day).toBe("today");
    expect(todays.rows).toHaveLength(4);
    expect(todays.rows.every((r) => r.at >= MIDNIGHT)).toBe(true);
    expect(todays.appToday).toBe(1);
    expect((await list()).rows).toHaveLength(5);
  });
});

describe("today in British Summer Time", () => {
  // Wednesday 15 July 2026, 10:00 in London (09:00 UTC): London's midnight was 23:00 UTC the day
  // before. A UTC midnight would count 23:30 UTC as yesterday, and 22:59 UTC as today.
  const SUMMER = new Date("2026-07-15T09:00:00Z");
  const TODAY_EARLY = new Date("2026-07-14T23:30:00Z"); // 00:30 in London: today
  const YESTERDAY_LATE = new Date("2026-07-14T22:59:00Z"); // 23:59 in London: yesterday

  it("the cancellations and enquiries counts, and their lists, start at London's midnight", async () => {
    const t = await dashFirm();
    const cancelAt = async (at: Date) => {
      const shiftId = await t.shift({ startsAt: new Date("2026-07-20T09:00:00Z") });
      const id = await t.booking(await t.worker(), shiftId);
      await t.set("assignments", id, {
        status: "cancelled_worker",
        cancelled_at: at,
        cancel_reason: "Unwell",
        notice_hours: 120,
      });
    };
    await cancelAt(TODAY_EARLY);
    await cancelAt(YESTERDAY_LATE);
    const ann = await t.worker({ first: "Ann" });
    for (const at of [TODAY_EARLY, YESTERDAY_LATE]) {
      await su.query(
        `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                               body, worker_id, handled_at, handled_as, intent, created_at)
         values ($1, 'in', 'whatsapp', $2, '+447700900951', '+447700900952', 'shifts', $3, $4,
                 'keyword', 'shifts', $4)`,
        [t.firmId, `SM${randomBytes(16).toString("hex")}`, ann, at],
      );
    }
    const d = await withFirm(t.firmId, (tx) => loadDashboard(tx, SUMMER));
    expect(d.today).toBe("2026-07-15");
    expect(d.counts.cancellations).toMatchObject({ ok: true, data: { total: 1 } });
    expect(d.counts.enquiries).toMatchObject({ ok: true, data: { total: 1, automatic: 1 } });
    // The lists the counts open hold the same one each.
    const cancellations = await withFirm(t.firmId, (tx) =>
      loadCancellations(tx, { view: "all", now: SUMMER, limit: 100, day: "today" }),
    );
    expect(cancellations.rows.map((r) => r.cancelledAt.toISOString())).toEqual([
      TODAY_EARLY.toISOString(),
    ]);
    const enquiries = await withFirm(t.firmId, (tx) =>
      loadEnquiries(tx, "all", SUMMER, { day: "today" }),
    );
    expect(enquiries.rows.map((r) => r.at.toISOString())).toEqual([TODAY_EARLY.toISOString()]);
  });
});

describe("the sections", () => {
  it("urgent cards hold only their urgent gaps, each with its offers; a hidden event says so", async () => {
    const t = await dashFirm();
    const hidden = await t.event({ name: "Hidden gala", showing: false });
    const gap = await t.shift({ startsAt: hoursFromNow(10), eventId: hidden });
    const other = await t.shift({ startsAt: hoursFromNow(12), eventId: hidden }); // not urgent
    await t.set("shifts", gap, { is_urgent: true });
    for (const n of [1, 2, 3]) {
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.firmId, gap, await t.worker({ first: `Off${n}` }), hoursFromNow(-1)],
      );
    }
    const d = await t.load();
    expect(d.urgent).toMatchObject({
      ok: true,
      data: {
        events: [
          {
            name: "Hidden gala",
            showing: false,
            sessions: [{ shiftId: gap, offered: 3, stopped: null, placesLeft: 1 }],
          },
        ],
      },
    });
    expect(JSON.stringify(d.urgent)).not.toContain(other);
  });

  it("a session hidden on its own, in an event casuals can see, is marked hidden on its card", async () => {
    const t = await dashFirm();
    const fair = await t.event({ name: "Open fair" });
    const hiddenGap = await t.shift({ startsAt: hoursFromNow(10), eventId: fair });
    const shownGap = await t.shift({ startsAt: hoursFromNow(12), eventId: fair });
    for (const id of [hiddenGap, shownGap]) await t.set("shifts", id, { is_urgent: true });
    await t.set("shifts", hiddenGap, { showing_to_casuals: false });
    const d = await t.load();
    expect(d.urgent).toMatchObject({
      ok: true,
      data: {
        events: [
          {
            name: "Open fair",
            showing: true,
            sessions: [
              { shiftId: hiddenGap, showing: false },
              { shiftId: shownGap, showing: true },
            ],
          },
        ],
      },
    });
  });

  it("a session past the 50 soonest urgent ones still shows its own offers", async () => {
    const t = await dashFirm();
    const busy = await t.event({ name: "Busy day" });
    await su.query(
      `insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source,
                           is_urgent)
       select $1, $2, 'steward', $3::timestamptz + (n || ' minutes')::interval,
              $3::timestamptz + (n || ' minutes')::interval + interval '8 hours', 1, 'open',
              'native', true
         from generate_series(1, 51) as n`,
      [t.firmId, busy, hoursFromNow(5)],
    );
    const late = await t.shift({ startsAt: hoursFromNow(30) });
    await t.set("shifts", late, { is_urgent: true });
    for (const n of [1, 2]) {
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.firmId, late, await t.worker({ first: `Late${n}` }), hoursFromNow(-1)],
      );
    }
    const d = await t.load();
    if (!d.urgent.ok) throw new Error("urgent failed");
    const sessions = d.urgent.data.events.flatMap((e) => e.sessions);
    expect(sessions).toHaveLength(52);
    expect(sessions.find((s) => s.shiftId === late)).toMatchObject({ offered: 2, stopped: null });
  });

  it("the latest three cancellations and the latest four enquiries with their replies' first lines", async () => {
    const t = await dashFirm();
    for (const h of [1, 2, 3, 4]) {
      const shiftId = await t.shift({ startsAt: hoursFromNow(40 + h) });
      const id = await t.booking(await t.worker(), shiftId);
      await t.set("assignments", id, {
        status: "cancelled_worker",
        cancelled_at: hoursFromNow(-h),
        cancel_reason: "Unwell",
        notice_hours: 40,
      });
    }
    const asked = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900931', '+447700900932', 'shifts?', $3, 'keyword',
               'shifts', $3)
       returning id::text as id`,
      [t.firmId, `SM${randomBytes(16).toString("hex")}`, hoursFromNow(-2)],
    );
    const askedId = asked.rows[0]?.id ?? "";
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, reply_to, created_at)
       values ($1, 'out', 'whatsapp', $2, '+447700900932', '+447700900931',
               $3, $4, $5)`,
      [
        t.firmId,
        `SM${randomBytes(16).toString("hex")}`,
        "Hi Ann, shifts you can take:\n1. Steward",
        askedId,
        hoursFromNow(-2),
      ],
    );
    const d = await t.load();
    expect(d.cancellations.ok && d.cancellations.data.rows.map((r) => r.noticeHours)).toEqual([
      40, 40, 40,
    ]);
    expect(d.cancellations.ok && d.cancellations.data.rows.length).toBe(3);
    expect(d.enquiries).toMatchObject({
      ok: true,
      data: {
        rows: [{ messageId: askedId }],
        replies: { [askedId]: "Hi Ann, shifts you can take:" },
      },
    });
  });
});

describe("the reply an enquiry got", () => {
  it("the office's reply only once it has gone: not while it waits to be sent, or if it failed", async () => {
    const t = await dashFirm();
    const asked = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900941', '+447700900942', 'Can I bring a friend?',
               $3, 'office', 'office', $3)
       returning id::text as id`,
      [t.firmId, `SM${randomBytes(16).toString("hex")}`, hoursFromNow(-2)],
    );
    const messageId = asked.rows[0]?.id ?? "";
    // Stored before it's sent, under the placeholder id (src/lib/office/enquiry-actions.ts).
    const reply = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, reply_to, created_at)
       values ($1, 'out', 'whatsapp', $2, '+447700900942', '+447700900941', 'Yes, bring them along.',
               $3, $4)
       returning id::text as id`,
      [t.firmId, `office-reply:${randomUUID()}`, messageId, hoursFromNow(-1)],
    );
    const replies = async () => {
      const d = await t.load();
      if (!d.enquiries.ok) throw new Error("enquiries failed");
      return d.enquiries.data.replies;
    };
    expect(await replies()).toEqual({ [messageId]: null });
    // Sent: it carries the provider's id now.
    await t.set("messages", reply.rows[0]?.id ?? "", {
      provider_message_id: `SM${randomBytes(16).toString("hex")}`,
    });
    expect(await replies()).toEqual({ [messageId]: "Yes, bring them along." });
  });
});

describe("Needs attention: a qualification out of date on a booked session", () => {
  async function scene() {
    const t = await dashFirm();
    const expired = (workerId: string, type: string, status: string, on: string | null) =>
      su.query(
        `insert into credentials (firm_id, worker_id, type, status, expires_on)
         values ($1, $2, $3, $4, $5)`,
        [t.firmId, workerId, type, status, on],
      );
    const items = () => withFirm(t.firmId, (tx) => loadExpiredOnBookings(tx, NOW, "Europe/London"));
    return { ...t, expired, items };
  }

  it("lists a booking whose licence ran out before it, and one running out before the day it ends", async () => {
    const t = await scene();
    // Ben's door supervisor licence ran out on 1 Nov; he's booked on Sat 7 Nov.
    const ben = await t.worker({
      first: "Ben",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    const sat = await t.shift({ startsAt: hoursFromNow(121) });
    const benBooking = await t.booking(ben, sat);
    // Cara's runs out on Sat 7 Nov, during her night shift Sat 22:00 to Sun 06:00.
    const cara = await t.worker({
      first: "Cara",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-07" }],
    });
    const night = await t.shift({ startsAt: hoursFromNow(133) });
    await t.booking(cara, night);
    // Dev's is in date for his shift: not listed.
    const dev = await t.worker({ first: "Dev" });
    await t.booking(dev, await t.shift({ startsAt: hoursFromNow(121) }));
    const got = await t.items();
    expect(got.more).toBe(false);
    expect(got.items).toEqual([
      {
        assignmentId: benBooking,
        workerId: ben,
        worker: "Ben Booker",
        shiftId: sat,
        role: "door_supervisor",
        startsAt: hoursFromNow(121),
        type: "SIA_DS",
        credential: "SIA door supervisor licence",
        expiresOn: "2026-11-01",
      },
      expect.objectContaining({ worker: "Cara Booker", shiftId: night, expiresOn: "2026-11-07" }),
    ]);
  });

  it("a session's own requirement too; marked expired by the office; a checked renewal clears it, one waiting for a check doesn't", async () => {
    const t = await scene();
    const eve = await t.worker({ first: "Eve" });
    await t.expired(eve, "FIRST_AID", "valid", "2026-11-03");
    const aid = await t.shift({ startsAt: hoursFromNow(72) });
    await t.set("shifts", aid, { required_credentials: ["FIRST_AID"] });
    await t.booking(eve, aid);
    const fay = await t.worker({ first: "Fay", credentials: [{ type: "STEWARD_L2" }] });
    await t.expired(fay, "SIA_DS", "expired", null);
    await t.booking(fay, await t.shift({ startsAt: hoursFromNow(50) }));
    let got = await t.items();
    expect(got.items.map((i) => [i.worker, i.type, i.expiresOn])).toEqual([
      ["Fay Booker", "SIA_DS", null],
      ["Eve Booker", "FIRST_AID", "2026-11-03"],
    ]);
    // Eve's renewal waits for a check: still listed. Fay's checked one in date: off the list.
    // (An unchecked record is stored as expired, with the upload it came from.)
    await su.query(
      `with u as (
         insert into uploads (firm_id, worker_id, kind, credential_type, content_type, size, sha256,
                              data)
         values ($1, $2, 'certificate', 'FIRST_AID', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea)
         returning id)
       insert into credentials (firm_id, worker_id, type, status, expires_on, check_state,
                                evidence_upload_id)
       select $1, $2, 'FIRST_AID', 'expired', '2029-01-01', 'waiting', u.id from u`,
      [t.firmId, eve, randomBytes(32).toString("hex")],
    );
    await t.expired(fay, "SIA_DS", "valid", "2029-01-01");
    got = await t.items();
    expect(got.items.map((i) => i.worker)).toEqual(["Eve Booker"]);
  });

  it("marked expired with a later date: no date given, so it reads 'marked as expired'", async () => {
    const t = await scene();
    const kit = await t.worker({ first: "Kit", credentials: [{ type: "STEWARD_L2" }] });
    // A file can say "expired" with a date still to come.
    await t.expired(kit, "SIA_DS", "expired", "2027-06-01");
    await t.booking(kit, await t.shift({ startsAt: hoursFromNow(30) }));
    expect((await t.items()).items.map((i) => [i.worker, i.expiresOn])).toEqual([
      ["Kit Booker", null],
    ]);
  });

  it("not for a cancelled booking, a cancelled or started session, or a suspended licence", async () => {
    const t = await scene();
    const gus = await t.worker({
      first: "Gus",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-10-01" }],
    });
    const cancelledBooking = await t.booking(gus, await t.shift({ startsAt: hoursFromNow(30) }));
    await t.set("assignments", cancelledBooking, {
      status: "cancelled_worker",
      cancelled_at: NOW,
      cancel_reason: "Unwell",
      notice_hours: 30,
    });
    await t.booking(gus, await t.shift({ startsAt: hoursFromNow(40), status: "cancelled" }));
    await t.booking(gus, await t.shift({ startsAt: hoursFromNow(-2) }));
    const hal = await t.worker({ first: "Hal", credentials: [{ type: "STEWARD_L2" }] });
    await t.expired(hal, "SIA_DS", "suspended", "2027-01-01");
    await t.expired(hal, "SIA_DS", "expired", "2026-10-01");
    await t.booking(hal, await t.shift({ startsAt: hoursFromNow(30) }));
    expect((await t.items()).items).toEqual([]);
  });
});

describe("Needs attention: an application in progress", () => {
  it("not listed when the firm's allowance counts it, as the rules do; listed when it doesn't", async () => {
    const t = await dashFirm();
    // Ivy's SIA licence ran out; her renewal is in progress (an "applied" record, checked).
    const ivy = await t.worker({
      first: "Ivy",
      credentials: [
        { type: "STEWARD_L2" },
        { type: "SIA_DS", expiresOn: "2026-10-01" },
        { type: "SIA_DS", status: "applied" },
      ],
    });
    await t.booking(ivy, await t.shift({ startsAt: hoursFromNow(30) }));
    const items = async () =>
      (await withFirm(t.firmId, (tx) => loadExpiredOnBookings(tx, NOW, "Europe/London"))).items;
    // No allowance (the default): the application doesn't count, so the booking is listed.
    expect((await items()).map((i) => i.worker)).toEqual(["Ivy Booker"]);
    // An allowance, for a type that allows it (the security pack's SIA licences): not listed.
    await su.query(
      `update firms set settings = settings || '{"credential_applied_allowance_pct": 15}'::jsonb
        where id = $1`,
      [t.firmId],
    );
    expect(await items()).toEqual([]);
    // A type that doesn't allow it: listed again.
    await su.query(
      "update credential_types set applied_allowed = false where firm_id = $1 and code = 'SIA_DS'",
      [t.firmId],
    );
    expect((await items()).map((i) => i.worker)).toEqual(["Ivy Booker"]);
  });
});

describe("Needs attention and the bell", () => {
  it("holds every to-do, and the bell counts each item; payroll gets neither", async () => {
    const t = await dashFirm();
    // A booking to check: the casual was made inactive.
    const lena = await t.worker({ first: "Lena" });
    await t.booking(lena, await t.shift({ startsAt: hoursFromNow(48) }));
    await su.query("update workers set status = 'inactive' where id = $1", [lena]);
    // Who worked?: a shift that ended yesterday with two people not marked.
    const ended = await t.shift({ startsAt: hoursFromNow(-30), headcount: 2 });
    await t.booking(await t.worker(), ended, "confirmed", 1);
    await t.booking(await t.worker(), ended, "confirmed", 2);
    // A qualification out of date on a booking.
    const ben = await t.worker({
      first: "Ben",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    await t.booking(ben, await t.shift({ startsAt: hoursFromNow(60) }));
    // Two uploads waiting for a check (one waiting photo per casual).
    for (const who of [ben, await t.worker({ first: "Ivy" })]) {
      await su.query(
        `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data)
         values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea)`,
        [t.firmId, who, randomBytes(32).toString("hex")],
      );
    }
    const d = await t.load();
    expect(d.needs.ok).toBe(true);
    if (!d.needs.ok) return;
    const n = d.needs.data;
    expect(n.toCheck.map((b) => b.worker)).toEqual(["Lena Booker"]);
    expect(n.toMark).toEqual([expect.objectContaining({ shiftId: ended, unmarked: 2 })]);
    expect(n.expired.map((e) => e.worker)).toEqual(["Ben Booker"]);
    expect(n.uploads).toBe(2);
    // The strikes team's address isn't set: one more item.
    expect(n.evidence.addressConfirmed).toBe(false);
    expect(needsCount(n)).toEqual({ count: 1 + 1 + 1 + 2 + 1, more: false });

    const admin = await t.office("admin");
    const bell = await needsAttentionBell({
      firm: { id: t.firmId },
      officeUserId: admin,
      run: withFirm,
      clock,
    });
    expect(bell).toEqual({ count: 6, more: false });
    const payroll = await t.office("payroll");
    expect(
      await needsAttentionBell({ firm: { id: t.firmId }, officeUserId: payroll, run: withFirm }),
    ).toBeNull();
  });
});

describe("Needs attention: your planner's change was refused", () => {
  // A firm with a planner key; the planner's PUTs (at NOW), and the refused changes Needs
  // attention shows at `at`, as [session, why, casuals].
  async function plannerFirm() {
    const t = await dashFirm();
    const admin = await t.office("admin");
    const key = await plannerKey(su, t.firmId, admin);
    const deps = apiDeps({ run: withFirm, resolveKey, now: () => NOW });
    const put = async (ref: string, body: unknown) =>
      answer<{ result?: string; session?: { id: string } | null; error?: { code: string } }>(
        await putSessionRequest(
          apiRequest("PUT", `/api/v1/sessions/${ref}`, { key: key.key, body }),
          ref,
          deps,
        ),
      );
    const create = async (ref: string, body: unknown) => {
      const made = await put(ref, body);
      const id = made.body.session?.id;
      if (made.status !== 201 || !id) throw new Error(`not created: ${made.status}`);
      return id;
    };
    const needs = async (at = NOW) => {
      const d = await withFirm(t.firmId, (tx) => loadDashboard(tx, at));
      if (!d.needs.ok) throw new Error("needs couldn't load");
      return d.needs.data;
    };
    const refused = async (at = NOW) =>
      (await needs(at)).plannerRefused.map((r) => [r.shiftId, r.why, r.casuals]);
    const bell = async () =>
      needsAttentionBell({ firm: { id: t.firmId }, officeUserId: admin, run: withFirm, clock });
    return { ...t, admin, key, put, create, needs, refused, bell };
  }

  // A plain session: steward, Saturday 7 November 08:00 to 16:00, at the arena.
  const plain = (o: Record<string, unknown> = {}) => ({
    site: { name: "Riverside Arena" },
    role: "steward",
    starts_at: "2026-11-07T08:00:00Z",
    ends_at: "2026-11-07T16:00:00Z",
    places: 2,
    ...o,
  });
  const code = (a: { status: number; body: { error?: { code: string } } }) => [
    a.status,
    a.body.error?.code,
  ];

  it("a booked session's move sent with no reason shows; sent again with a reason, it goes through and clears", async () => {
    const t = await plannerFirm();
    const id = await t.create("S-1", plain());
    await t.booking(await t.worker({ first: "Ann" }), id, "confirmed", 1);
    const later = plain({ starts_at: "2026-11-07T10:00:00Z", ends_at: "2026-11-07T18:00:00Z" });
    expect(code(await t.put("S-1", later))).toEqual([422, "change_reason_required"]);
    expect(await t.refused()).toEqual([[id, "change_reason_required", 0]]);
    expect((await t.needs()).plannerRefused[0]).toMatchObject({
      shiftId: id,
      why: "change_reason_required",
      casuals: 0,
    });
    expect((await t.put("S-1", { ...later, change_reason: "event_changed" })).body.result).toBe(
      "updated",
    );
    expect(await t.refused()).toEqual([]);
  });

  it("a role change a booking blocks shows, counted by the bell; an unchanged PUT leaves it, a later successful PUT clears it", async () => {
    const t = await plannerFirm();
    const id = await t.create("S-1", plain());
    await t.booking(await t.worker({ first: "Ann" }), id, "confirmed", 1);
    expect(await t.refused()).toEqual([]);
    expect(code(await t.put("S-1", plain({ role: "door_supervisor" })))).toEqual([
      409,
      "session_has_bookings",
    ]);
    expect(await t.refused()).toEqual([[id, "session_has_bookings", 0]]);
    expect((await t.needs()).plannerRefused[0]).toEqual({
      shiftId: id,
      role: "steward",
      site: "Riverside Arena",
      startsAt: new Date("2026-11-07T08:00:00Z"),
      endsAt: new Date("2026-11-07T16:00:00Z"),
      refusedAt: expect.any(Date),
      why: "session_has_bookings",
      casuals: 0,
    });
    // The strikes team's address isn't set (one item), plus the refused change.
    expect(await t.bell()).toEqual({ count: 2, more: false });
    // Sent again as it is now: nothing changes or is logged, so it stays.
    expect((await t.put("S-1", plain())).body.result).toBe("unchanged");
    expect(await t.refused()).toEqual([[id, "session_has_bookings", 0]]);
    // A later change that went through (shift.changed) clears it.
    expect((await t.put("S-1", plain({ pay_rate_pence: 1500 }))).body.result).toBe("updated");
    expect(await t.refused()).toEqual([]);
    expect(await t.bell()).toEqual({ count: 1, more: false });
  });

  it("places taken away from a booking show; a booking cancelled after it clears it, and a newer refusal shows again", async () => {
    const t = await plannerFirm();
    const id = await t.create("S-1", plain({ places: 3 }));
    await t.booking(await t.worker({ first: "Ann" }), id, "confirmed", 1);
    const cal = await t.worker({ first: "Cal" });
    await t.booking(cal, id, "confirmed", 3);
    expect(code(await t.put("S-1", plain({ places: 2 })))).toEqual([409, "places_below_booked"]);
    expect(await t.refused()).toEqual([[id, "places_below_booked", 0]]);
    // The office cancels the booking in the place it takes away (shift.cancelled on the booking).
    expect(
      await cancelBooking(
        withFirm,
        t.firmId,
        {
          shiftId: id,
          workerId: cal,
          reason: "They can't work it now",
          by: { type: "office", id: t.admin },
        },
        { clock },
      ),
    ).toMatchObject({ status: "cancelled" });
    expect(await t.refused()).toEqual([]);
    // A refusal logged after that shows again: the latest one counts.
    expect(code(await t.put("S-1", plain({ requirements: ["FIRST_AID"] })))).toEqual([
      409,
      "session_has_bookings",
    ]);
    expect(await t.refused()).toEqual([[id, "session_has_bookings", 0]]);
  });

  it("a move the rules refuse shows how many casuals can't work it; a later move clears it, and so does cancelling the session", async () => {
    const t = await plannerFirm();
    const evening = plain({ starts_at: "2026-11-07T18:00:00Z", ends_at: "2026-11-07T22:00:00Z" });
    const id = await t.create("S-1", evening);
    const ann = await t.worker({ first: "Ann" });
    await t.booking(ann, id, "confirmed", 1);
    // Ann works until 06:00 that morning elsewhere: 4 hours' rest before a 10:00 start.
    const night = await t.shift({ startsAt: new Date("2026-11-06T22:00:00Z"), role: "steward" });
    await t.booking(ann, night, "confirmed", 1);
    const tooSoon = plain({
      starts_at: "2026-11-07T10:00:00Z",
      ends_at: "2026-11-07T14:00:00Z",
      change_reason: "event_changed",
    });
    expect(code(await t.put("S-1", tooSoon))).toEqual([409, "bookings_block_change"]);
    expect(await t.refused()).toEqual([[id, "move", 1]]);
    // A later move the rules allow (shift.moved for Ann, then shift.changed) clears it.
    const later = plain({
      starts_at: "2026-11-07T19:00:00Z",
      ends_at: "2026-11-07T23:00:00Z",
      change_reason: "event_changed",
    });
    expect((await t.put("S-1", later)).status).toBe(200);
    expect(await t.refused()).toEqual([]);
    // Refused again, then the planner cancels the session (shift.cancelled_by_firm).
    expect(code(await t.put("S-1", tooSoon))).toEqual([409, "bookings_block_change"]);
    expect(await t.refused()).toEqual([[id, "move", 1]]);
    const cancelled = await t.put("S-1", { ...later, status: "cancelled" });
    expect([cancelled.status, cancelled.body.result]).toEqual([200, "cancelled"]);
    expect(await t.refused()).toEqual([]);
  });

  it("stays until the session ends; only the planner's own refusals count", async () => {
    const t = await plannerFirm();
    const id = await t.create("S-1", plain());
    await t.booking(await t.worker({ first: "Ann" }), id, "confirmed", 1);
    expect(code(await t.put("S-1", plain({ role: "door_supervisor" })))).toEqual([
      409,
      "session_has_bookings",
    ]);
    expect(await t.refused(new Date("2026-11-07T15:59:00Z"))).toEqual([
      [id, "session_has_bookings", 0],
    ]);
    expect(await t.refused(new Date("2026-11-07T16:00:00Z"))).toEqual([]);
    // The office's own refused move of its own session is the office's to see on the session: not
    // a planner's change.
    const native = await t.shift({ startsAt: hoursFromNow(48) });
    const ben = await t.worker({ first: "Ben" });
    await t.booking(ben, native, "confirmed", 1);
    await recordMoveRefused(withFirm, t.firmId, {
      shiftId: native,
      reason: "event_changed",
      by: { type: "office", id: t.admin },
      workers: [{ workerId: ben, codes: ["rest"] }],
    });
    expect(await t.refused()).toEqual([[id, "session_has_bookings", 0]]);
  });

  it("is each firm's own: the same ref refused in one firm shows nothing in the other", async () => {
    const a = await plannerFirm();
    const b = await plannerFirm();
    const mine = await a.create("S-1", plain());
    const theirs = await b.create("S-1", plain());
    expect(mine).not.toBe(theirs);
    await b.booking(await b.worker({ first: "Bertram" }), theirs, "confirmed", 1);
    expect(code(await b.put("S-1", plain({ role: "door_supervisor" })))).toEqual([
      409,
      "session_has_bookings",
    ]);
    expect(await b.refused()).toEqual([[theirs, "session_has_bookings", 0]]);
    expect(await b.bell()).toEqual({ count: 2, more: false });
    expect(await a.refused()).toEqual([]);
    expect(await a.bell()).toEqual({ count: 1, more: false });
    expect(JSON.stringify(await a.needs())).not.toContain(theirs);
    // B's admin asking under A's firm: nothing.
    expect(
      await needsAttentionBell({
        firm: { id: a.firmId },
        officeUserId: b.admin,
        run: withFirm,
        clock,
      }),
    ).toBeNull();
  });
});

describe("who may see it", () => {
  it("admins and resourcers; not payroll, a disabled user, or another firm's", async () => {
    const t = await dashFirm();
    const other = await dashFirm();
    const ctx = (officeUserId: string, firmId = t.firmId) => ({
      firm: { id: firmId },
      officeUserId,
      run: withFirm,
      clock,
    });
    expect(await officeDashboard(ctx(await t.office("admin")))).not.toBeNull();
    expect(await officeDashboard(ctx(await t.office("resourcer")))).not.toBeNull();
    expect(await officeDashboard(ctx(await t.office("payroll")))).toBeNull();
    expect(await officeDashboard(ctx(await t.office("admin", "disabled")))).toBeNull();
    expect(await officeDashboard(ctx(await other.office("admin"), t.firmId))).toBeNull();
    // Needs attention's own page (Phase 18): the same people.
    expect(await officeNeedsAttention(ctx(await t.office("admin")))).toMatchObject({
      today: "2026-11-02",
      needs: { ok: true },
    });
    expect(await officeNeedsAttention(ctx(await t.office("resourcer")))).not.toBeNull();
    expect(await officeNeedsAttention(ctx(await t.office("payroll")))).toBeNull();
    expect(await officeNeedsAttention(ctx(await t.office("admin", "disabled")))).toBeNull();
    expect(await officeNeedsAttention(ctx(await other.office("admin"), t.firmId))).toBeNull();
  });
});

describe("this week (Phase 18's strip)", () => {
  it("each London day Monday to Sunday: places in open or filled sessions, filled, still to fill, urgent", async () => {
    const t = await dashFirm();
    const other = await dashFirm();
    // Monday: one started at 06:00 (2 places, 1 booked: the other can't be filled now), one
    // urgent at 14:00 (3 places, 1 booked).
    const started = await t.shift({ startsAt: hoursFromNow(-3), headcount: 2 });
    await t.booking(await t.worker(), started);
    const urgent = await t.shift({ startsAt: hoursFromNow(5), headcount: 3 });
    await t.set("shifts", urgent, { is_urgent: true });
    await t.booking(await t.worker(), urgent);
    // Tuesday: a draft and a cancelled session: neither counts.
    await t.shift({ startsAt: hoursFromNow(24), headcount: 4, status: "draft" });
    await t.shift({ startsAt: hoursFromNow(25), headcount: 4, status: "cancelled" });
    // Wednesday: marked filled by the office with nobody booked: full.
    await t.shift({ startsAt: hoursFromNow(48), headcount: 2, status: "filled" });
    // Sunday 23:30 is still this week; Monday 00:30 and last Sunday 23:00 aren't.
    await t.shift({ startsAt: hoursFromNow(158.5) });
    await t.shift({ startsAt: hoursFromNow(159.5) });
    await t.shift({ startsAt: hoursFromNow(-10) });
    // Another firm's sessions this week: never in this one's.
    await other.shift({ startsAt: hoursFromNow(5), headcount: 9 });
    const zero = (date: string) => ({ date, places: 0, filled: 0, open: 0, urgent: 0 });
    expect((await t.load()).week).toEqual({
      ok: true,
      data: [
        { date: "2026-11-02", places: 5, filled: 2, open: 2, urgent: 2 },
        zero("2026-11-03"),
        { date: "2026-11-04", places: 2, filled: 2, open: 0, urgent: 0 },
        zero("2026-11-05"),
        zero("2026-11-06"),
        zero("2026-11-07"),
        { date: "2026-11-08", places: 1, filled: 0, open: 1, urgent: 0 },
      ],
    });
  });
});

describe("isolation", () => {
  it("one firm's dashboard and bell never count or show another firm's rows; every part loads", async () => {
    const a = await dashFirm();
    const b = await dashFirm();
    // B: an urgent gap, a cancellation today, an enquiry with its reply, a licence out of date on
    // a booking, a booked casual made inactive, and an upload waiting.
    const gap = await b.shift({ startsAt: hoursFromNow(5) });
    await b.set("shifts", gap, { is_urgent: true });
    const ben = await b.worker({
      first: "Bertram",
      credentials: [{ type: "STEWARD_L2" }, { type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    await b.booking(ben, await b.shift({ startsAt: hoursFromNow(60) }));
    const cancelled = await b.booking(
      await b.worker(),
      await b.shift({ startsAt: hoursFromNow(20) }),
    );
    await b.set("assignments", cancelled, {
      status: "cancelled_worker",
      cancelled_at: new Date("2026-11-02T08:00:00Z"),
      cancel_reason: "Unwell",
      notice_hours: 11,
    });
    const asked = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900931', '+447700900932', 'shifts?', $3,
               'keyword', 'shifts', $3)
       returning id::text as id`,
      [b.firmId, `SM${randomBytes(16).toString("hex")}`, hoursFromNow(-2)],
    );
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, reply_to, created_at)
       values ($1, 'out', 'whatsapp', $2, '+447700900932', '+447700900931', 'Firm B reply words',
               $3, $4)`,
      [b.firmId, `SM${randomBytes(16).toString("hex")}`, asked.rows[0]?.id, hoursFromNow(-2)],
    );
    const lena = await b.worker({ first: "Lenora" });
    await b.booking(lena, await b.shift({ startsAt: hoursFromNow(48) }));
    await b.set("workers", lena, { status: "inactive" });
    await su.query(
      `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data)
       values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea)`,
      [b.firmId, ben, randomBytes(32).toString("hex")],
    );

    const mine = await a.load();
    const theirs = await b.load();
    // Every part of both loads (a broken query would show "This couldn't load" and pass unseen).
    for (const d of [mine, theirs]) {
      const parts = [
        ...Object.values(d.counts),
        d.week,
        d.urgent,
        d.showing,
        d.cancellations,
        d.enquiries,
        d.needs,
      ];
      expect(parts.map((p) => p.ok)).toEqual(Array(parts.length).fill(true));
    }
    // B's own dashboard holds them.
    expect(theirs.counts.urgent.ok && theirs.counts.urgent.data.sessions).toBe(1);
    expect(theirs.counts.cancellations.ok && theirs.counts.cancellations.data.total).toBe(1);
    expect(theirs.counts.enquiries.ok && theirs.counts.enquiries.data.total).toBe(1);
    expect(theirs.needs.ok && theirs.needs.data.expired.map((e) => e.worker)).toEqual([
      "Bertram Booker",
    ]);
    expect(theirs.needs.ok && theirs.needs.data.uploads).toBe(1);
    expect(theirs.enquiries.ok && Object.values(theirs.enquiries.data.replies)).toEqual([
      "Firm B reply words",
    ]);
    // A's counts are all 0, and nothing of B's is in A's dashboard.
    expect(mine.counts).toEqual({
      urgent: { ok: true, data: { sessions: 0, places: 0, firstStartsAt: null } },
      showing: { ok: true, data: { events: 0, sessions: 0, places: 0 } },
      cancellations: { ok: true, data: { total: 0, underNotice: 0, strikes: 0, threshold: 48 } },
      enquiries: { ok: true, data: { total: 0, automatic: 0, needPerson: 0 } },
    });
    // B's week holds its sessions; A's has none of them.
    expect(theirs.week.ok && theirs.week.data.reduce((n, d) => n + d.places, 0)).toBeGreaterThan(0);
    expect(mine.week.ok && mine.week.data.every((d) => d.places === 0 && d.open === 0)).toBe(true);
    const text = JSON.stringify(mine);
    for (const word of ["Firm B reply words", "Bertram", "Lenora", "shifts?", gap, b.firmId]) {
      expect(text).not.toContain(word);
    }
    // A's bell: only its own strikes-team address, not confirmed.
    const admin = await a.office("admin");
    const ctx = (firmId: string, officeUserId: string) => ({
      firm: { id: firmId },
      officeUserId,
      run: withFirm,
      clock,
    });
    expect(await needsAttentionBell(ctx(a.firmId, admin))).toEqual({ count: 1, more: false });
    // B's admin asking under A's firm: nothing.
    expect(await needsAttentionBell(ctx(a.firmId, await b.office("admin")))).toBeNull();
    expect(await officeDashboard(ctx(a.firmId, await b.office("admin")))).toBeNull();
  });
});

describe("one part failing", () => {
  it("shows that part's error and keeps the transaction for the rest", async () => {
    const t = await dashFirm();
    await withFirm(t.firmId, async (tx) => {
      const failed = await part(tx, "test", async (sp) => {
        await sp.execute(sql`select 1 / 0`);
        return 1;
      });
      expect(failed).toEqual({ ok: false });
      const after = await part(tx, "test", async (sp) => {
        const { rows } = await sp.execute<{ n: number }>(sql`select 2 as n`);
        return rows[0]?.n;
      });
      expect(after).toEqual({ ok: true, data: 2 });
    });
  });
});
