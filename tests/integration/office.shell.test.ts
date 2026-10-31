import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { offerState } from "@/lib/office/offer-state";
import { officeEventList } from "@/lib/office/events";
import { officeSearch, officeSearchHits } from "@/lib/office/search";
import { loadOfficeFrame } from "@/lib/office/frame";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The top bar's counts as the office frame reads them (Phase 25.3: with the menu's, in one
// transaction): null for a role without Events & sessions.
const officeShellCounts = async (ctx: Parameters<typeof loadOfficeFrame>[0]) =>
  (await loadOfficeFrame(ctx)).shell;

// The office shell's loaders on the real database, as the app role, with a fixed clock (NOW is
// Monday 2 November 2026, 09:00 London; Phase 24, PLAN.md 24.2): the top bar's counts (places to
// fill, urgent places, offers out with no reply) and that they add up with the pages they open; the
// search (casuals, shifts, sites), with another firm's rows never found; who may use each; and
// Events & sessions at one site (where a site found by the search opens).

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

async function offer(
  f: BookingFirm,
  shiftId: string,
  workerId: string,
  response: "accepted" | "declined" | "failed" | null = null,
) {
  await su.query(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at, response, responded_at)
     values ($1, $2, $3, 1, 'whatsapp', $4, $5, $6)`,
    [f.firmId, shiftId, workerId, hoursFromNow(-2), response, response ? hoursFromNow(-1) : null],
  );
}

async function site(f: BookingFirm, name: string, town: string | null = null): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name, town) values ($1, $2, $3) returning id::text as id",
    [f.firmId, name, town],
  );
  return rows[0]?.id ?? "";
}

// A firm with: Raceday at the Acme Arena (Leeds): an urgent door supervisor session tomorrow at
// Gate A (3 places, 1 booked), a steward session (2 places, none booked), one that ended and one
// cancelled; the Winter Fair, with a session at the Acme Depot; a draft and a filled session; and
// offers: two waiting, one declined, one failed, one on the ended session and one on the cancelled
// one. Ann Booker and Ben Booker, and a deleted casual.
async function shellFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const arena = await site(f, "Acme Arena", "Leeds");
  const depot = await site(f, "Acme Depot");
  const raceday = await f.event({ name: "Raceday" });
  await su.query("update shift_events set site_id = $2 where id = $1", [raceday, arena]);
  const door = await f.shift({ eventId: raceday, startsAt: hoursFromNow(24), headcount: 3 });
  await su.query("update shifts set is_urgent = true, post = 'Gate A' where id = $1", [door]);
  const steward = await f.shift({
    eventId: raceday,
    role: "steward",
    startsAt: hoursFromNow(30),
    headcount: 2,
  });
  const ended = await f.shift({ eventId: raceday, startsAt: hoursFromNow(-30), headcount: 2 });
  const cancelled = await f.shift({
    eventId: raceday,
    startsAt: hoursFromNow(28),
    status: "cancelled",
  });
  const winter = await f.event({ name: "Winter Fair" });
  const fair = await f.shift({ eventId: winter, role: "steward", startsAt: hoursFromNow(72) });
  await su.query("update shifts set site_id = $2 where id = $1", [fair, depot]);
  await f.shift({ eventId: winter, startsAt: hoursFromNow(80), status: "draft" });
  await f.shift({ eventId: winter, startsAt: hoursFromNow(90), status: "filled" });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  await f.booking(ben, door);
  await offer(f, door, ann);
  await offer(f, steward, ann);
  await offer(f, steward, ben, "declined");
  await offer(f, fair, ann, "failed");
  await offer(f, ended, ann);
  await offer(f, cancelled, ben);
  // A casual deleted on request: a row named "Deleted worker" and nothing else.
  const gone = await f.worker({ first: "Gone" });
  await su.query("delete from credentials where worker_id = $1", [gone]);
  await su.query(
    `update workers set erased_at = now(), mobile_e164 = null, email = null, first_name = 'Deleted',
            last_name = 'worker', status = 'inactive', roles = '{}' where id = $1`,
    [gone],
  );
  const { rows } = await su.query<{ mobile: string }>(
    "select mobile_e164 as mobile from workers where id = $1",
    [ann],
  );
  const as = (officeUserId: string) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
  });
  return {
    f,
    admin,
    resourcer,
    payroll,
    as,
    arena,
    depot,
    raceday,
    winter,
    door,
    steward,
    cancelled,
    fair,
    ann,
    ben,
    annMobile: rows[0]?.mobile ?? "",
  };
}

// Another firm with rows that would match everything above: never counted, never found.
async function otherFirm() {
  const f = await bookingFirm(su, withFirm);
  const arena = await site(f, "Acme Arena", "Leeds");
  const raceday = await f.event({ name: "Raceday" });
  await su.query("update shift_events set site_id = $2 where id = $1", [raceday, arena]);
  const door = await f.shift({ eventId: raceday, startsAt: hoursFromNow(24), headcount: 5 });
  await su.query("update shifts set is_urgent = true, post = 'Gate A' where id = $1", [door]);
  const ann = await f.worker({ first: "Ann" });
  await offer(f, door, ann);
  const { rows } = await su.query<{ mobile: string }>(
    "select mobile_e164 as mobile from workers where id = $1",
    [ann],
  );
  return { f, arena, door, ann, annMobile: rows[0]?.mobile ?? "" };
}

const tokenFor = async (firmId: string, officeUserId: string) =>
  (
    await withFirm(firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
    )
  ).token;

describe("the top bar's counts", () => {
  it("places to fill, urgent places and offers out with no reply, in sessions to come", async () => {
    const t = await shellFirm();
    await otherFirm();
    // To fill: door 2 (3, 1 booked) + steward 2 + the fair's 1; the ended, cancelled, draft and
    // filled sessions hold none. Urgent: the door's 2. Offers out: the two with no reply on
    // sessions to come (not the declined, the failed, nor those on the ended or cancelled one).
    expect(await officeShellCounts(t.as(t.admin))).toEqual({
      ok: true,
      data: { toFill: 5, urgent: 2, offersOut: 2 },
    });
    expect(await officeShellCounts(t.as(t.resourcer))).toEqual({
      ok: true,
      data: { toFill: 5, urgent: 2, offersOut: 2 },
    });
  });

  it("add up with the pages they open: Events & sessions' places, its urgent sessions' gaps, each offer's state", async () => {
    const t = await shellFirm();
    await otherFirm();
    const counts = await officeShellCounts(t.as(t.admin));
    if (!counts?.ok) throw new Error("no counts");
    const token = await tokenFor(t.f.firmId, t.admin);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    const all = await officeEventList(ctx, token, "all");
    expect(counts.data.toFill).toBe(all?.open.places);
    const need = await officeEventList(ctx, token, "need");
    expect(need?.events.reduce((n, e) => n + e.placesFree, 0)).toBe(counts.data.toFill);
    const urgent = await officeEventList(ctx, token, "urgent");
    expect(
      urgent?.events
        .flatMap((e) => e.sessions)
        .filter((s) => s.urgentGap)
        .reduce((n, s) => n + (s.headcount - s.booked), 0),
    ).toBe(counts.data.urgent);
    // Every offer the firm sent, through the board's own rule (offerState: offer-state.ts).
    const { rows } = await su.query<{
      response: "accepted" | "declined" | "failed" | null;
      status: "draft" | "open" | "filled" | "cancelled";
      starts_at: Date;
    }>(
      `select o.response, s.status, s.starts_at from offers o join shifts s on s.id = o.shift_id
        where o.firm_id = $1`,
      [t.f.firmId],
    );
    expect(
      rows.filter(
        (r) =>
          offerState({ response: r.response, shiftStatus: r.status, startsAt: r.starts_at }, NOW)
            ?.state === "waiting",
      ),
    ).toHaveLength(counts.data.offersOut);
  });

  it("payroll, a disabled user and another firm's user get none", async () => {
    const t = await shellFirm();
    const o = await otherFirm();
    expect(await officeShellCounts(t.as(t.payroll))).toBeNull();
    const disabled = await t.f.office("resourcer", "disabled");
    expect(await officeShellCounts(t.as(disabled))).toBeNull();
    // An office user of this firm, asked inside the other firm: not one of its users.
    expect(await officeShellCounts({ ...t.as(t.admin), firm: { id: o.f.firmId } })).toBeNull();
  });
});

describe("the search", () => {
  it("finds casuals by name or mobile number, never a deleted one", async () => {
    const t = await shellFirm();
    const ids = async (q: string) =>
      (await officeSearch(t.as(t.resourcer), q))?.casuals?.rows.map((c) => c.id);
    expect(await ids("booker")).toEqual([t.ann, t.ben]);
    expect(await ids("ann boo")).toEqual([t.ann]);
    // A mobile as people type it (07700 900123), found exactly.
    expect(await ids(`0${t.annMobile.slice(3, 7)} ${t.annMobile.slice(7)}`)).toEqual([t.ann]);
    expect(await ids("Deleted")).toEqual([]);
    // What's typed is matched as written: "_" and "%" are characters, not wildcards (any two
    // letters would match every name).
    expect(await ids("__")).toEqual([]);
    expect(await ids("%%")).toEqual([]);
  });

  it("never finds another firm's casuals, shifts or sites, even with the same names", async () => {
    const t = await shellFirm();
    const o = await otherFirm();
    const f = await officeSearch(t.as(t.admin), "ann");
    expect(f?.casuals?.rows.map((c) => c.id)).toEqual([t.ann]);
    // The other firm's Ann by her own mobile: not in this firm.
    const byMobile = await officeSearch(t.as(t.admin), o.annMobile);
    expect(byMobile?.casuals?.rows).toEqual([]);
    const arena = await officeSearch(t.as(t.admin), "arena");
    expect(arena?.sites?.rows.map((s) => s.id)).toEqual([t.arena]);
    expect(arena?.sessions?.rows.map((s) => s.id)).toEqual([t.door, t.steward]);
    const door = await officeSearch(t.as(t.admin), "door super");
    // This firm's door supervisor sessions to come: Raceday's, and the fair's draft and full ones.
    expect(door?.sessions?.rows.map((s) => [s.event, s.role])).toEqual([
      ["Raceday", "door_supervisor"],
      ["Winter Fair", "door_supervisor"],
      ["Winter Fair", "door_supervisor"],
    ]);
    expect(door?.sessions?.rows[0]?.id).toBe(t.door);
    expect(JSON.stringify([f, byMobile, arena, door])).not.toContain(o.ann);
    expect(JSON.stringify([arena, door])).not.toContain(o.door);
    expect(JSON.stringify([arena])).not.toContain(o.arena);
  });

  it("finds shifts to come by role, event, site or post, soonest first, with their places", async () => {
    const t = await shellFirm();
    const sessions = async (q: string) =>
      (await officeSearch(t.as(t.resourcer), q))?.sessions?.rows.map((s) => s.id);
    // Not the ended or cancelled sessions; drafts and full ones are still shifts.
    expect(await sessions("raceday")).toEqual([t.door, t.steward]);
    expect(await sessions("gate a")).toEqual([t.door]);
    expect(await sessions("depot")).toEqual([t.fair]);
    const winter = await officeSearch(t.as(t.resourcer), "winter");
    expect(winter?.sessions?.rows.map((s) => s.role)).toEqual([
      "steward",
      "door_supervisor",
      "door_supervisor",
    ]);
    const door = (await officeSearch(t.as(t.resourcer), "raceday"))?.sessions?.rows[0];
    expect(door).toMatchObject({
      event: "Raceday",
      place: "Acme Arena",
      post: "Gate A",
      placesFree: 2,
      urgentGap: true,
    });
  });

  it("finds sites by name or town, with their events to come", async () => {
    const t = await shellFirm();
    const sites = await officeSearch(t.as(t.admin), "acme");
    expect(sites?.sites?.rows).toEqual([
      { id: t.arena, name: "Acme Arena", town: "Leeds", events: 1 },
      { id: t.depot, name: "Acme Depot", town: null, events: 1 },
    ]);
    expect((await officeSearch(t.as(t.admin), "leeds"))?.sites?.rows.map((s) => s.id)).toEqual([
      t.arena,
    ]);
  });

  it("up to 5 of each, saying there were more", async () => {
    const t = await shellFirm();
    for (let i = 0; i < 5; i += 1) await t.f.worker({ first: `Zed${i}` });
    const f = await officeSearch(t.as(t.admin), "booker");
    expect(f?.casuals?.rows).toHaveLength(5);
    expect(f?.casuals?.more).toBe(true);
    expect((await officeSearch(t.as(t.admin), "ann"))?.casuals?.more).toBe(false);
  });

  it("only for the roles that can open what it finds; too little typed finds nothing", async () => {
    const t = await shellFirm();
    expect(await officeSearch(t.as(t.payroll), "ann")).toBeNull();
    const disabled = await t.f.office("admin", "disabled");
    expect(await officeSearch(t.as(disabled), "ann")).toBeNull();
    expect(await officeSearch(t.as(t.admin), " a ")).toEqual({
      casuals: { rows: [], more: false },
      sessions: { rows: [], more: false },
      sites: { rows: [], more: false },
    });
  });

  it("as lines with their pages, in the firm's time zone", async () => {
    const t = await shellFirm();
    const hits = await officeSearchHits(t.as(t.admin), "raceday", "Europe/London");
    expect(hits?.groups.map((g) => g.kind)).toEqual(["sessions"]);
    expect(hits?.groups[0]?.hits[0]).toEqual({
      href: `/office/shifts/${t.door}`,
      title: "Door supervisor · Raceday",
      detail: "Tue 3 Nov, 09:00–17:00 · Gate A, Acme Arena · 2 places to fill",
      urgent: true,
    });
  });
});

describe("Events & sessions at one site", () => {
  it("only the events there, by the event's site or a session's; its counts and places too", async () => {
    const t = await shellFirm();
    const o = await otherFirm();
    const token = await tokenFor(t.f.firmId, t.resourcer);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    const arena = await officeEventList(ctx, token, "all", t.arena);
    expect(arena?.site).toEqual({ id: t.arena, name: "Acme Arena" });
    expect(arena?.events.map((e) => e.name)).toEqual(["Raceday"]);
    expect(arena?.counts.all).toBe(1);
    expect(arena?.open).toEqual({ places: 4, sessions: 2 });
    const depot = await officeEventList(ctx, token, "all", t.depot);
    expect(depot?.events.map((e) => e.name)).toEqual(["Winter Fair"]);
    expect(depot?.open).toEqual({ places: 1, sessions: 1 });
    expect((await officeEventList(ctx, token, "urgent", t.depot))?.events).toEqual([]);
    // Only a session still to come puts an event at a site, as the search counts it: Raceday's
    // cancelled session at the depot doesn't.
    await su.query("update shifts set site_id = $2 where id = $1", [t.cancelled, t.depot]);
    expect((await officeEventList(ctx, token, "all", t.depot))?.events.map((e) => e.name)).toEqual([
      "Winter Fair",
    ]);
    expect(
      (await officeSearch(t.as(t.resourcer), "depot"))?.sites?.rows.map((s) => s.events),
    ).toEqual([1]);
    // Every site: no site, another firm's site or anything that isn't an id.
    for (const id of [null, o.arena, "not-an-id"]) {
      const list = await officeEventList(ctx, token, "all", id);
      expect(list?.site).toBeNull();
      expect(list?.events.map((e) => e.name)).toEqual(["Raceday", "Winter Fair"]);
      expect(list?.open).toEqual({ places: 5, sessions: 3 });
    }
  });
});
