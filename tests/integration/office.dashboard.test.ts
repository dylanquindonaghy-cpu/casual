import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadDashboard,
  loadExpiredOnBookings,
  needsAttentionBell,
  needsCount,
  officeDashboard,
  part,
} from "@/lib/office/dashboard";
import { loadCancellations } from "@/lib/office/cancellations";
import { loadEnquiries } from "@/lib/office/enquiries";
import { loadEventCards } from "@/lib/office/events";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office dashboard (docs/office-v2.md 3.2, 3.9; 12E.1) on the real database, as the app role:
// what each of the four counts counts ("today" is the London calendar day), the sections' data,
// Needs attention's items (a qualification out of date on a booked session read as the rules read
// it), the bell's number, who may see it, and that one part failing leaves the rest. NOW is Monday
// 2 November 2026, 09:00 London (GMT), so midnight was 00:00 UTC.

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
