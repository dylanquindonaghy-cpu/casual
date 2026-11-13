import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { saveContract, saveMyDashboard } from "@/lib/office/contracts";
import { officeUpdatesPage, type PageUpdate } from "@/lib/office/updates";
import { DEFAULT_VIEW, type UpdatesView } from "@/lib/office/updates-view";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Updates you can filter (Phase 36.2) on the real database, as the app role: how far back (today,
// 3, 7 or 30 days), which event (its choices: the events with something in the period; one of the
// firm's with nothing in it stays chosen; another firm's id is never one), what kind (with each
// chip's count), pay queries for admins only, enquiries for a person and the app's requests
// waiting, a resourcer's contracts still narrowing the sessions, "Low on cover" (the next 7 days'
// events with places to fill, least covered first), and another firm's rows never shown or counted.
// NOW is Monday 2 November 2026, 09:00 London (GMT).

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

async function site(f: BookingFirm, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text as id",
    [f.firmId, name],
  );
  return rows[0]?.id ?? "";
}
const atSite = (shiftId: string, siteId: string) =>
  su.query("update shifts set site_id = $2 where id = $1", [shiftId, siteId]);

async function cancelled(
  f: BookingFirm,
  workerId: string,
  shiftId: string,
  at: Date,
  slot: number,
) {
  const id = await f.booking(workerId, shiftId, "cancelled_worker", slot);
  await su.query("update assignments set cancelled_at = $2, notice_hours = 30 where id = $1", [
    id,
    at,
  ]);
  return id;
}
async function payQuery(f: BookingFirm, workerId: string, at: Date, shiftId: string | null) {
  const { rows } = await su.query<{ id: string }>(
    `insert into pay_queries (firm_id, worker_id, shift_id, work_date, issue_type, created_at)
     values ($1, $2, $3, '2026-10-31', 'missing_hours', $4) returning id::text as id`,
    [f.firmId, workerId, shiftId, at],
  );
  return rows[0]?.id ?? "";
}
// A WhatsApp to the shifts line nothing could sort: it needs a person.
async function forAPerson(f: BookingFirm, workerId: string, at: Date) {
  const { rows } = await su.query<{ id: string }>(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                           body, worker_id, handled_at, handled_as, created_at)
     values ($1, 'in', 'whatsapp', $2, '+447700900999', '+447700900001', 'Who do I ask?', $3,
             $4, 'unknown', $4)
     returning id::text as id`,
    [f.firmId, `SM${randomBytes(16).toString("hex")}`, workerId, at],
  );
  return rows[0]?.id ?? "";
}
async function appRequest(f: BookingFirm, workerId: string, shiftId: string, at: Date) {
  const { rows } = await su.query<{ id: string }>(
    `insert into requests (firm_id, worker_id, shift_id, type, payload, status, created_at)
     values ($1, $2, $3, 'time_change', '{}', 'open', $4) returning id::text as id`,
    [f.firmId, workerId, shiftId, at],
  );
  return rows[0]?.id ?? "";
}

const ids = (items: PageUpdate[]) =>
  items.map((u) =>
    u.kind === "cancelled"
      ? `cancelled ${u.ref}`
      : u.kind === "open-soon"
        ? `open-soon ${u.shiftId}`
        : u.kind === "pay-query"
          ? `pay ${u.id}`
          : u.kind === "enquiry"
            ? `enquiry ${u.messageId}`
            : u.kind === "app-request"
              ? `request ${u.requestId}`
              : u.kind,
  );

// One firm: the Rovers' match at the stadium (in 30 hours, 10 places, 2 booked) and the Arena's
// night at the arena (in 4 days, 4 places, 3 booked); a fair in 9 days (outside the next week);
// cancellations today, 2 days ago and 10 days ago; a pay query yesterday (about the match) and one
// 12 days ago; an enquiry for a person this morning; a request in the app about the match.
async function firm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const stadium = await site(f, "Stadium");
  const arena = await site(f, "Arena");
  const rovers = await f.event({ name: "Rovers v Visitors" });
  const night = await f.event({ name: "Arena Night" });
  const fair = await f.event({ name: "Autumn Fair" });
  const [mo, ben, zoe, kim] = [
    await f.worker({ first: "Mo" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Zoe" }),
    await f.worker({ first: "Kim" }),
  ];
  const match = await f.shift({ startsAt: hoursFromNow(30), headcount: 10, eventId: rovers });
  await atSite(match, stadium);
  await f.booking(ben, match, "confirmed", 1);
  await f.booking(zoe, match, "confirmed", 2);
  const arenaShift = await f.shift({ startsAt: hoursFromNow(96), headcount: 4, eventId: night });
  await atSite(arenaShift, arena);
  for (const [w, slot] of [
    [ben, 1],
    [zoe, 2],
    [kim, 3],
  ] as const)
    await f.booking(w, arenaShift, "confirmed", slot);
  await atSite(await f.shift({ startsAt: hoursFromNow(9 * 24), eventId: fair }), arena);
  const today = await cancelled(f, mo, match, hoursFromNow(-1), 3);
  const twoDays = await cancelled(f, kim, match, hoursFromNow(-50), 4);
  const tenDays = await cancelled(f, mo, arenaShift, hoursFromNow(-240), 4);
  const payRecent = await payQuery(f, mo, hoursFromNow(-17), match);
  const payOld = await payQuery(f, zoe, hoursFromNow(-12 * 24), null);
  const enquiry = await forAPerson(f, kim, hoursFromNow(-2));
  const request = await appRequest(f, ben, match, hoursFromNow(-3));
  const ctx = (officeUserId: string) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: clockAt(NOW),
  });
  const page = (who: string, view: Partial<UpdatesView> = {}) =>
    officeUpdatesPage(ctx(who), { ...DEFAULT_VIEW, ...view });
  return {
    f,
    admin,
    resourcer,
    payroll,
    stadium,
    arena,
    rovers,
    night,
    fair,
    match,
    arenaShift,
    today,
    twoDays,
    tenDays,
    payRecent,
    payOld,
    enquiry,
    request,
    ctx,
    page,
  };
}

describe("Updates you can filter", () => {
  it("how far back: today, 3, 7 or 30 days (what stands now in every period)", async () => {
    const t = await firm();
    const everything = async (period: UpdatesView["period"]) =>
      ids((await t.page(t.admin, { period, kind: "everything" }))?.shown ?? []);
    const today = await everything("today");
    expect(today).toEqual(
      expect.arrayContaining([
        `open-soon ${t.match}`,
        `cancelled ${t.today}`,
        `enquiry ${t.enquiry}`,
        `request ${t.request}`,
      ]),
    );
    expect(today).not.toContain(`cancelled ${t.twoDays}`);
    expect(today).not.toContain(`pay ${t.payRecent}`); // yesterday 16:00
    const three = await everything("3");
    expect(three).toEqual(expect.arrayContaining([`cancelled ${t.twoDays}`, `pay ${t.payRecent}`]));
    expect(three).not.toContain(`cancelled ${t.tenDays}`);
    expect(await everything("7")).not.toContain(`pay ${t.payOld}`);
    const thirty = await everything("30");
    expect(thirty).toEqual(expect.arrayContaining([`cancelled ${t.tenDays}`, `pay ${t.payOld}`]));
    // Still to fill is first, whatever the period.
    expect(thirty[0]).toBe(`open-soon ${t.match}`);
  });

  it("what kind: the chosen kind's list, and each chip's count in the period", async () => {
    const t = await firm();
    const p = await t.page(t.admin, { period: "30", kind: "cancellations" });
    expect(p?.view).toEqual({ period: "30", eventId: null, kind: "cancellations" });
    expect(ids(p?.shown ?? [])).toEqual([
      `cancelled ${t.today}`,
      `cancelled ${t.twoDays}`,
      `cancelled ${t.tenDays}`,
    ]);
    expect(p?.counts).toEqual({
      // The match still to fill near its start, and the three cancellations: each one's place is
      // open again (the match has 8 to fill, the arena's night 1).
      action: 4,
      // No client requests in this firm (Phase 36.4's chip, counted like the rest).
      "client-requests": 0,
      "to-fill": 1,
      cancellations: 3,
      pay: 2,
      uploads: 0,
      enquiries: 2,
      everything: p?.everything.length,
    });
    expect(ids((await t.page(t.admin, { kind: "pay", period: "30" }))?.shown ?? [])).toEqual([
      `pay ${t.payRecent}`,
      `pay ${t.payOld}`,
    ]);
    expect(ids((await t.page(t.admin, { kind: "enquiries" }))?.shown ?? [])).toEqual([
      `enquiry ${t.enquiry}`,
      `request ${t.request}`,
    ]);
    expect(ids((await t.page(t.admin, { kind: "to-fill" }))?.shown ?? [])).toEqual([
      `open-soon ${t.match}`,
    ]);
  });

  it("which event: only its updates; its choices are the events with something in the period", async () => {
    const t = await firm();
    const all = await t.page(t.admin, { period: "30", kind: "everything" });
    expect(all?.events).toEqual([
      { id: t.night, name: "Arena Night" },
      { id: t.rovers, name: "Rovers v Visitors" },
    ]);
    // The last 3 days: only the Rovers' match has something.
    expect((await t.page(t.admin, { period: "3" }))?.events).toEqual([
      { id: t.rovers, name: "Rovers v Visitors" },
    ]);
    const rovers = await t.page(t.admin, { period: "30", kind: "everything", eventId: t.rovers });
    expect(rovers?.view.eventId).toBe(t.rovers);
    // Its session's news, the pay query and the request that name its session; not the arena's,
    // nor the enquiry or the pay query that name no session.
    expect(ids(rovers?.shown ?? []).sort()).toEqual(
      [
        `open-soon ${t.match}`,
        `cancelled ${t.today}`,
        `cancelled ${t.twoDays}`,
        `pay ${t.payRecent}`,
        `request ${t.request}`,
      ].sort(),
    );
    expect(rovers?.counts.cancellations).toBe(2);
    // An event of the firm's with nothing in the period stays chosen, its list empty.
    const fair = await t.page(t.admin, { eventId: t.fair, kind: "everything" });
    expect(fair?.view.eventId).toBe(t.fair);
    expect(fair?.events).toContainEqual({ id: t.fair, name: "Autumn Fair" });
    expect(fair?.shown).toEqual([]);
  });

  it("pay queries for admins only; payroll has no Updates; a resourcer's contracts still narrow the sessions", async () => {
    const t = await firm();
    const admin = await t.page(t.admin, { period: "30", kind: "everything" });
    expect(admin?.kinds).toContain("pay");
    expect(ids(admin?.shown ?? [])).toContain(`pay ${t.payRecent}`);
    const resourcer = await t.page(t.resourcer, { period: "30", kind: "everything" });
    expect(resourcer?.kinds).toEqual([
      "action",
      "client-requests",
      "to-fill",
      "cancellations",
      "uploads",
      "enquiries",
      "everything",
    ]);
    expect(resourcer?.shown.some((u) => u.kind === "pay-query")).toBe(false);
    expect(resourcer?.counts.pay).toBe(0);
    // Asking for pay queries by the address: Needs action instead.
    const asked = await t.page(t.resourcer, { kind: "pay" });
    expect(asked?.view.kind).toBe("action");
    expect(asked?.shown.some((u) => u.kind === "pay-query")).toBe(false);
    expect(await t.page(t.payroll)).toBeNull();

    // The resourcer looks after the arena's contract: the stadium's sessions go (from the list and
    // from Low on cover); enquiries are a casual's, so they stay.
    const added = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Arena Council",
      siteIds: [t.arena],
      before: [],
    });
    if (added.status !== "saved") throw new Error(added.status);
    await saveMyDashboard(t.ctx(t.resourcer), { clientIds: [added.clientId], cards: [] });
    const mine = await t.page(t.resourcer, { period: "30", kind: "everything" });
    expect(mine?.mine).toBe(true);
    const shown = ids(mine?.shown ?? []);
    expect(shown).toContain(`cancelled ${t.tenDays}`);
    expect(shown).not.toContain(`cancelled ${t.today}`);
    expect(shown).not.toContain(`open-soon ${t.match}`);
    expect(shown).toEqual(expect.arrayContaining([`enquiry ${t.enquiry}`]));
    expect(mine?.lowCover.map((c) => c.eventId)).toEqual([t.night]);
  });

  it("Low on cover: the next 7 days' events with places to fill, least covered first", async () => {
    const t = await firm();
    const p = await t.page(t.admin);
    // The match: 10 places, 2 booked (its two cancellations are open again): 20%. The arena's
    // night: 4 places, 3 booked: 75%. The fair is 9 days away.
    expect(p?.lowCover).toEqual([
      {
        eventId: t.rovers,
        name: "Rovers v Visitors",
        firstStart: hoursFromNow(30),
        needed: 10,
        booked: 2,
        toFill: 8,
      },
      {
        eventId: t.night,
        name: "Arena Night",
        firstStart: hoursFromNow(96),
        needed: 4,
        booked: 3,
        toFill: 1,
      },
    ]);
    // Fully booked: no longer low on cover.
    await su.query("update shifts set headcount = 3 where id = $1", [t.arenaShift]);
    expect((await t.page(t.admin))?.lowCover.map((c) => c.eventId)).toEqual([t.rovers]);
  });

  it("another firm's updates, events and cover are never shown, counted or chosen", async () => {
    const a = await firm();
    const b = await firm();
    const p = await a.page(a.admin, { period: "30", kind: "everything" });
    const shown = ids(p?.shown ?? []);
    for (const theirs of [
      `cancelled ${b.today}`,
      `pay ${b.payRecent}`,
      `pay ${b.payOld}`,
      `enquiry ${b.enquiry}`,
      `request ${b.request}`,
      `open-soon ${b.match}`,
    ])
      expect(shown).not.toContain(theirs);
    expect(p?.counts.pay).toBe(2);
    expect(p?.counts.enquiries).toBe(2);
    expect(p?.events.map((e) => e.id)).not.toContain(b.rovers);
    expect(p?.lowCover.map((c) => c.eventId)).not.toContain(b.rovers);
    // Their event's id in the address: not an event here, so every event is shown.
    const theirs = await a.page(a.admin, { eventId: b.rovers, kind: "everything", period: "30" });
    expect(theirs?.view.eventId).toBeNull();
    expect(theirs?.events.map((e) => e.id)).not.toContain(b.rovers);
    expect(ids(theirs?.shown ?? [])).toEqual(shown);
  });
});
