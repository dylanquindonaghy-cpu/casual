import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { putSessionRequest } from "@/lib/integrations/sessions";
import {
  attentionCount,
  loadExpiredOnBookings,
  loadNeedsAttention,
  loadPlannerRefusals,
  needsCount,
  officeUrgentCount,
  part,
} from "@/lib/office/dashboard";
import { loadOfficeFrame } from "@/lib/office/frame";
import { cancelBooking } from "@/lib/roster/cancel";
import { recordMoveRefused } from "@/lib/roster/firm-change";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { answer, apiDeps, apiRequest, plannerKey } from "../helpers/planner-api";

// As the office reads them (Phase 25.3: one office frame a request, src/lib/office/frame.ts): the
// menu's Needs attention count (null for a role without the dashboard), Needs attention's page
// (the frame's items and enquiries, and its urgent places) and the top bar's sessions.
type Ctx = Parameters<typeof loadOfficeFrame>[0];
async function needsAttentionBell(ctx: Ctx): Promise<number | null> {
  const needs = (await loadOfficeFrame(ctx)).needs;
  if (!needs) return null;
  if (!needs.needs.ok) throw new Error("Needs attention didn't load");
  return needsCount(needs.needs.data);
}
async function officeNeedsAttention(ctx: Ctx) {
  const frame = await loadOfficeFrame(ctx);
  const urgent = await officeUrgentCount(ctx);
  if (!frame.needs || !urgent || !frame.needPerson) return null;
  return { ...frame.needs, needPerson: frame.needPerson, urgent };
}
const officeShellCounts = async (ctx: Ctx) => (await loadOfficeFrame(ctx)).shell;

// Needs attention (docs/office-v2.md 3.2, 3.9; 12E.1) on the real database, as the app role: its
// items (a qualification out of date on a booked session read as the rules read it; the planner's
// refused changes worked out from the log, through the planner API itself), its page, the bell's
// number (the menu's count), who may see them, another firm's rows never in them, and that one
// part failing leaves the rest. NOW is Monday 2 November 2026, 09:00 London (GMT). The dashboard
// itself (Phase 24) is tests/integration/office.board.test.ts's; Phase 23's four counts, sections
// and week strip were tested here until they went.

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

const clock = { now: () => NOW };
const TZ = "Europe/London"; // the firms' calendar (the default)

async function dashFirm() {
  const f = await bookingFirm(su, withFirm);
  const load = () => withFirm(f.firmId, (tx) => loadNeedsAttention(tx, NOW, TZ));
  const set = (table: string, id: string, cells: Record<string, unknown>) =>
    su.query(
      `update ${table} set ${Object.keys(cells)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(", ")} where id = $1`,
      [id, ...Object.values(cells)],
    );
  return { ...f, load, set };
}

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
    expect(got.total).toBe(2);
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

  it("past 50: the first 50, soonest first, and how many in all (Phase 25.3)", async () => {
    const t = await scene();
    const ben = await t.worker({
      first: "Ben",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    // Booked on 52 door supervisor sessions from Saturday on, his licence out of date for all.
    await su.query(
      `with s as (
         insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source)
         select $1, $3, 'door_supervisor', $2::timestamptz + (n || ' hours')::interval,
                $2::timestamptz + (n || ' hours')::interval + interval '8 hours', 1, 'filled',
                'native'
           from generate_series(1, 52) as n
         returning id)
       insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       select $1, s.id, 1, $4, 'confirmed', $5 from s`,
      [t.firmId, hoursFromNow(121), await t.event(), ben, NOW],
    );
    const got = await t.items();
    expect([got.items.length, got.total]).toEqual([50, 52]);
    expect(got.items.every((i) => i.workerId === ben)).toBe(true);
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
    const n = await t.load();
    expect(n.toCheck.map((b) => b.worker)).toEqual(["Lena Booker"]);
    expect(n.toMark).toEqual([expect.objectContaining({ shiftId: ended, unmarked: 2 })]);
    expect(n.expired.map((e) => e.worker)).toEqual(["Ben Booker"]);
    expect(n.uploads).toBe(2);
    // The strikes team's address isn't set: one more item.
    expect(n.evidence.addressConfirmed).toBe(false);
    expect(needsCount(n)).toBe(1 + 1 + 1 + 2 + 1);

    const admin = await t.office("admin");
    const bell = await needsAttentionBell({
      firm: { id: t.firmId },
      officeUserId: admin,
      run: withFirm,
      clock,
    });
    expect(bell).toBe(6);
    const payroll = await t.office("payroll");
    expect(
      await needsAttentionBell({ firm: { id: t.firmId }, officeUserId: payroll, run: withFirm }),
    ).toBeNull();
  });

  it("its page (Phase 20): each upload by name, oldest first; the enquiries that need a person; the urgent places", async () => {
    const t = await dashFirm();
    // Two uploads waiting for a check, Ivy's sent first.
    const ben = await t.worker({ first: "Ben" });
    const ivy = await t.worker({ first: "Ivy" });
    for (const [who, at] of [
      [ben, "2026-11-02T08:30:00Z"],
      [ivy, "2026-11-02T08:10:00Z"],
    ] as const) {
      await su.query(
        `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, created_at)
         values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea, $4)`,
        [t.firmId, who, randomBytes(32).toString("hex"), new Date(at)],
      );
    }
    // A message to the shifts line that needs a person.
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, worker_id, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900921', '+447700900922', 'hello', $3, $4,
               'office', 'office', $4)`,
      [t.firmId, `SM${randomBytes(16).toString("hex")}`, ben, new Date("2026-11-02T07:00:00Z")],
    );
    // An urgent session with both its places free.
    const urgent = await t.shift({ startsAt: hoursFromNow(5), headcount: 2 });
    await t.set("shifts", urgent, { is_urgent: true });

    const admin = await t.office("admin");
    const page = await officeNeedsAttention({
      firm: { id: t.firmId },
      officeUserId: admin,
      run: withFirm,
      clock,
    });
    if (!page?.needs.ok) throw new Error("Needs attention didn't load");
    expect(page.needs.data.uploadList.map((u) => [u.name, u.workerId, u.kind])).toEqual([
      ["Ivy Booker", ivy, "photo"],
      ["Ben Booker", ben, "photo"],
    ]);
    expect(page.needs.data.uploadList.map((u) => u.sentAt)).toEqual([
      new Date("2026-11-02T08:10:00Z"),
      new Date("2026-11-02T08:30:00Z"),
    ]);
    expect(page.needPerson).toEqual({ ok: true, data: 1 });
    expect(page.urgent).toEqual({
      ok: true,
      data: { sessions: 1, places: 2, firstStartsAt: hoursFromNow(5) },
    });
    // Its count, as the menu's: the 2 uploads, the strikes team's address not set, the enquiry.
    expect(attentionCount(page.needs.data, page.needPerson.ok ? page.needPerson.data : -1)).toBe(
      2 + 1 + 1,
    );
    // The top bar reads the same figures: its Urgent is these urgent places, its To check this
    // count (Phase 24).
    const shell = await officeShellCounts({
      firm: { id: t.firmId },
      officeUserId: admin,
      run: withFirm,
      clock,
    });
    expect(shell).toMatchObject({ ok: true, data: { urgent: 2 } });
    expect(
      await needsAttentionBell({
        firm: { id: t.firmId },
        officeUserId: admin,
        run: withFirm,
        clock,
      }),
    ).toBe(2 + 1);
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
    const needs = async (at = NOW) => withFirm(t.firmId, (tx) => loadNeedsAttention(tx, at, TZ));
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
    expect(await t.bell()).toBe(2);
    // Sent again as it is now: nothing changes or is logged, so it stays.
    expect((await t.put("S-1", plain())).body.result).toBe("unchanged");
    expect(await t.refused()).toEqual([[id, "session_has_bookings", 0]]);
    // A later change that went through (shift.changed) clears it.
    expect((await t.put("S-1", plain({ pay_rate_pence: 1500 }))).body.result).toBe("updated");
    expect(await t.refused()).toEqual([]);
    expect(await t.bell()).toBe(1);
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
    expect(await b.bell()).toBe(2);
    expect(await a.refused()).toEqual([]);
    expect(await a.bell()).toBe(1);
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

describe("Needs attention: your planner's refused changes past 50 (Phase 25.3)", () => {
  it("the first 50, soonest first, and how many in all", async () => {
    const t = await dashFirm();
    // 53 of the planner's sessions to come, each with a move the rules refused.
    await su.query(
      `with s as (
         insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source,
                             external_ref)
         select $1, $3, 'steward', $2::timestamptz + (n || ' hours')::interval,
                $2::timestamptz + (n || ' hours')::interval + interval '8 hours', 1, 'open', 'api',
                'P-' || n
           from generate_series(1, 53) as n
         returning id)
       insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       select $1, 'system', 'shift.move_refused', 'shift', s.id,
              jsonb_build_object('by', 'firm', 'via', 'api', 'reason', 'rules', 'workers', '[]'::jsonb)
         from s`,
      [t.firmId, hoursFromNow(48), await t.event()],
    );
    const got = await withFirm(t.firmId, (tx) => loadPlannerRefusals(tx, NOW));
    expect([got.items.length, got.total]).toEqual([50, 53]);
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
    // Needs attention's own page (Phase 18): the dashboard's people
    // (tests/integration/office.board.test.ts).
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

describe("isolation", () => {
  it("one firm's Needs attention, its page and the bell never count or show another firm's rows", async () => {
    const a = await dashFirm();
    const b = await dashFirm();
    // B: an urgent gap, a licence out of date on a booking, a booked casual made inactive, a
    // session to mark, an upload waiting and a message that needs a person.
    const gap = await b.shift({ startsAt: hoursFromNow(5) });
    await b.set("shifts", gap, { is_urgent: true });
    const ben = await b.worker({
      first: "Bertram",
      credentials: [{ type: "STEWARD_L2" }, { type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    await b.booking(ben, await b.shift({ startsAt: hoursFromNow(60) }));
    const ended = await b.shift({ startsAt: hoursFromNow(-30) });
    await b.booking(await b.worker({ first: "Marcella" }), ended);
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900933', '+447700900932', 'call me', $3,
               'office', 'office', $3)`,
      [b.firmId, `SM${randomBytes(16).toString("hex")}`, hoursFromNow(-1)],
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
    // B's own Needs attention holds them.
    expect(theirs.expired.map((e) => e.worker)).toEqual(["Bertram Booker"]);
    expect(theirs.toCheck.map((e) => e.worker)).toEqual(["Lenora Booker"]);
    expect(theirs.toMark.map((e) => e.shiftId)).toEqual([ended]);
    expect(theirs.uploads).toBe(1);
    // A's holds nothing of B's: only its own strikes-team address, not confirmed.
    expect(mine).toMatchObject({
      toCheck: [],
      fromSheet: [],
      toMark: [],
      expired: [],
      uploads: 0,
      uploadList: [],
      plannerRefused: [],
      webhookFailing: null,
    });
    expect(needsCount(mine)).toBe(1);
    const text = JSON.stringify(mine);
    for (const word of ["Bertram", "Lenora", "Marcella", "call me", gap, ben, ended, b.firmId]) {
      expect(text).not.toContain(word);
    }
    const admin = await a.office("admin");
    const ctx = (firmId: string, officeUserId: string) => ({
      firm: { id: firmId },
      officeUserId,
      run: withFirm,
      clock,
    });
    expect(await needsAttentionBell(ctx(a.firmId, admin))).toBe(1);
    // Needs attention's page (Phase 20): B's upload by name, its enquiry and its urgent place;
    // none of them in A's.
    const page = (firmId: string, officeUserId: string) =>
      officeNeedsAttention(ctx(firmId, officeUserId));
    const minePage = await page(a.firmId, admin);
    expect(minePage).toMatchObject({
      needs: { ok: true, data: { uploads: 0, uploadList: [] } },
      needPerson: { ok: true, data: 0 },
      urgent: { ok: true, data: { sessions: 0, places: 0, firstStartsAt: null } },
    });
    const pageText = JSON.stringify(minePage);
    for (const word of ["Bertram", "Lenora", "call me", ben, b.firmId]) {
      expect(pageText).not.toContain(word);
    }
    const theirPage = await page(b.firmId, await b.office("admin"));
    expect(theirPage?.needs.ok && theirPage.needs.data.uploadList.map((u) => u.name)).toEqual([
      "Bertram Booker",
    ]);
    expect(theirPage?.needPerson).toEqual({ ok: true, data: 1 });
    expect(theirPage?.urgent.ok && theirPage.urgent.data.places).toBe(1);
    // B's admin asking under A's firm: nothing.
    expect(await needsAttentionBell(ctx(a.firmId, await b.office("admin")))).toBeNull();
    expect(await page(a.firmId, await b.office("admin"))).toBeNull();
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
