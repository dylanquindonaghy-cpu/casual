import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { officeEventList, officeEventPage } from "@/lib/office/events";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Events & sessions' loaders (12B.5; src/lib/office/events.ts) on the real database, as the app
// role, with a fixed clock (NOW is Monday 2 November 2026, 09:00 London): which events each tab
// lists, a session's fields and requirements, who is booked, who may look, and that a resourcer
// sees a session's pay per hour but never a pay record's amount.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

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

async function eventsFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const tokenFor = async (officeUserId: string) =>
    (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
      )
    ).token;
  const ctx = { firm: { id: f.firmId }, run: withFirm, clock };
  // Raceday: a door supervisor session tomorrow (urgent, 1 of 2 booked, every detail set), a
  // steward session (full), one that ended yesterday and one cancelled.
  const raceday = await f.event({ name: "Raceday" });
  const door = await f.shift({ eventId: raceday, startsAt: hoursFromNow(24), headcount: 2 });
  const steward = await f.shift({ eventId: raceday, role: "steward", startsAt: hoursFromNow(26) });
  const ended = await f.shift({ eventId: raceday, startsAt: hoursFromNow(-30) });
  const cancelled = await f.shift({
    eventId: raceday,
    startsAt: hoursFromNow(28),
    status: "cancelled",
  });
  await su.query(
    `update shifts set is_urgent = true, pay_rate_pence = 1550, post = 'Gate A',
            meeting_point = 'Main gate', uniform = 'Black trousers', required_credentials = '{FIRST_AID}'
      where id = $1`,
    [door],
  );
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  await f.booking(ann, door);
  await f.booking(ben, steward);
  // A pay record for Ann with amounts nobody should see here.
  await su.query(
    `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence, gross_pence)
     values ($1, $2, '2026-10-26', '2026-11-01', 8, 4321, 98765)`,
    [f.firmId, ann],
  );
  // A hidden event with one session to come, and an event whose only session has ended.
  const winter = await f.event({ name: "Winter Fair", showing: false });
  await f.shift({ eventId: winter, startsAt: hoursFromNow(72) });
  const past = await f.event({ name: "Old Fete" });
  await f.shift({ eventId: past, startsAt: hoursFromNow(-60) });
  return {
    f,
    resourcer,
    tokenFor,
    ctx,
    raceday,
    door,
    steward,
    ended,
    cancelled,
    winter,
    ann,
    ben,
  };
}

describe("the events list", () => {
  it("each tab lists the events with a session to come: all, showing, hidden, urgent", async () => {
    const t = await eventsFirm();
    const token = await t.tokenFor(t.resourcer);
    const names = async (view: "all" | "showing" | "hidden" | "urgent") =>
      (await officeEventList(t.ctx, token, view))?.events.map((e) => e.name);
    expect(await names("all")).toEqual(["Raceday", "Winter Fair"]);
    expect(await names("showing")).toEqual(["Raceday"]);
    expect(await names("hidden")).toEqual(["Winter Fair"]);
    expect(await names("urgent")).toEqual(["Raceday"]);
    await su.query("update shifts set is_urgent = false where id = $1", [t.door]);
    expect(await names("urgent")).toEqual([]);
  });

  it("a card holds its sessions to come (not ended, not cancelled), with their totals", async () => {
    const t = await eventsFirm();
    const list = await officeEventList(t.ctx, await t.tokenFor(t.resourcer), "all");
    expect(list?.hasPlanner).toBe(false);
    const card = list?.events.find((e) => e.name === "Raceday");
    expect(card?.sessions.map((s) => s.shiftId)).toEqual([t.door, t.steward]);
    expect(card).toMatchObject({ showing: true, sessionCount: 2, placesFree: 1, urgentGap: true });
    expect(card?.sessions[0]).toMatchObject({
      role: "door_supervisor",
      booked: 1,
      headcount: 2,
      urgentGap: true,
      payRatePence: 1550,
      post: "Gate A",
      meetingPoint: "Main gate",
      uniform: "Black trousers",
      // The role's licence, then the session's extra requirement.
      requirements: [
        { code: "SIA_DS", name: "SIA door supervisor licence" },
        { code: "FIRST_AID", name: "first aid at work certificate" },
      ],
    });
    expect(card?.sessions[1]).toMatchObject({ role: "steward", booked: 1, urgentGap: false });
  });

  it("a firm with a Google Sheet has a planner (no Add or Import shifts)", async () => {
    const t = await eventsFirm();
    await t.f.sheetSource(NOW);
    expect((await officeEventList(t.ctx, await t.tokenFor(t.resourcer), "all"))?.hasPlanner).toBe(
      true,
    );
  });
});

describe("one event's page", () => {
  it("every session (past and cancelled too) and who is booked on each", async () => {
    const t = await eventsFirm();
    const page = await officeEventPage(t.ctx, await t.tokenFor(t.resourcer), t.raceday);
    expect(page?.event.sessions.map((s) => s.shiftId)).toEqual([
      t.ended,
      t.door,
      t.steward,
      t.cancelled,
    ]);
    expect(page?.event.sessions.find((s) => s.shiftId === t.ended)).toMatchObject({
      started: true,
      ended: true,
    });
    expect(page?.booked[t.door]).toEqual([
      { workerId: t.ann, name: "Ann Booker", status: "confirmed" },
    ]);
    expect(page?.booked[t.steward]?.map((b) => b.name)).toEqual(["Ben Booker"]);
  });

  it("a resourcer sees a session's £/hour, never a pay record's amount", async () => {
    const t = await eventsFirm();
    const token = await t.tokenFor(t.resourcer);
    const page = await officeEventPage(t.ctx, token, t.raceday);
    const list = await officeEventList(t.ctx, token, "all");
    if (!page || !list) throw new Error("no page");
    const { SessionItem } = await import("@/app/office/events/session-row");
    const { EventCard } = await import("@/app/office/events/event-card");
    const html = [
      renderToStaticMarkup(
        createElement(
          "ul",
          null,
          page.event.sessions.map((s) =>
            createElement(SessionItem, {
              key: s.shiftId,
              session: s,
              timeZone: page.timeZone,
              withDay: false,
              eventShowing: true,
              full: true,
              switchLabel: "x",
              booked: page.booked[s.shiftId] ?? [],
            }),
          ),
        ),
      ),
      ...list.events.map((e) =>
        renderToStaticMarkup(createElement(EventCard, { event: e, timeZone: list.timeZone })),
      ),
    ].join("");
    expect(html).toContain("£15.50/h");
    // The pay record's rate and gross: in no page's data and on no page.
    for (const data of [JSON.stringify(page), JSON.stringify(list)]) {
      expect(data).not.toContain("98765");
      expect(data).not.toContain("4321");
    }
    expect(html).not.toContain("£987.65");
    expect(html).not.toContain("£43.21");
  });

  it("only admins and resourcers, and only the firm's own events", async () => {
    const t = await eventsFirm();
    expect(
      await officeEventPage(t.ctx, await t.tokenFor(await t.f.office("admin")), t.raceday),
    ).not.toBeNull();
    const payroll = await t.tokenFor(await t.f.office("payroll"));
    expect(await officeEventPage(t.ctx, payroll, t.raceday)).toBeNull();
    expect(await officeEventList(t.ctx, payroll, "all")).toBeNull();
    expect(await officeEventList(t.ctx, "not-a-token", "all")).toBeNull();
    const other = await eventsFirm();
    const token = await t.tokenFor(t.resourcer);
    expect(await officeEventPage(t.ctx, token, other.raceday)).toBeNull();
    expect(await officeEventPage(t.ctx, token, "not-an-id")).toBeNull();
    expect(
      (await officeEventList(t.ctx, token, "all"))?.events.map((e) => e.eventId),
    ).not.toContain(other.raceday);
  });
});
