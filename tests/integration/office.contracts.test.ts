import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadContracts,
  loadMyDashboard,
  removeContract,
  saveContract,
  saveMyDashboard,
} from "@/lib/office/contracts";
import { loadBoard } from "@/lib/office/dashboard-board";
import {
  loadCancelWeeks,
  loadFillRates,
  loadNextTwoWeeks,
  loadNoShowWeeks,
} from "@/lib/office/dashboard-cards-data";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Contracts and each person's own dashboard (Phase 26.3; the spec page's "Customise and contracts",
// cus-1 to cus-4, and dash-7) on the real database, as the app role: an admin's contracts and the
// venues each owns, a resourcer's choice of contracts and cards saved to them, the dashboard
// narrowed to their contracts' venues ("Show everything" not), the date choice, the extra cards'
// figures, each change logged, and who may do what. NOW is Monday 2 November 2026, 09:00 London.

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

const TZ = "Europe/London";
const ok = <T>(p: { ok: true; data: T } | { ok: false } | null): T => {
  if (!p?.ok) throw new Error("a part failed");
  return p.data;
};

async function site(f: BookingFirm, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text as id",
    [f.firmId, name],
  );
  return rows[0]?.id ?? "";
}
async function atSite(f: BookingFirm, siteId: string, o: Parameters<BookingFirm["shift"]>[0]) {
  const id = await f.shift(o);
  await su.query("update shifts set site_id = $2 where id = $1", [id, siteId]);
  return id;
}
const events = async (f: BookingFirm, action: string) =>
  (
    await su.query<{ actor_id: string; entity_id: string; data: Record<string, unknown> }>(
      `select actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = $2 order by id`,
      [f.firmId, action],
    )
  ).rows;

async function firm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const arena = await site(f, "Acme Arena");
  const depot = await site(f, "Acme Depot");
  const ctx = (officeUserId: string) => ({ firm: { id: f.firmId }, officeUserId, run: withFirm });
  return { f, admin, resourcer, payroll, arena, depot, ctx };
}

describe("contracts on Settings (admins)", () => {
  it("added with its venues, saved (a venue moves from another), removed (its venues stay), each logged", async () => {
    const t = await firm();
    const a = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "  Northgate Council ",
      siteIds: [t.arena],
    });
    expect(a.status).toBe("saved");
    const north = a.status === "saved" ? a.clientId : "";
    const b = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Riverside",
      siteIds: [t.depot],
    });
    const river = b.status === "saved" ? b.clientId : "";
    // Saving Northgate with the depot ticked too (it had the arena): the depot moves from Riverside.
    expect(
      (
        await saveContract(t.ctx(t.admin), {
          clientId: north,
          name: "Northgate Council",
          siteIds: [t.arena, t.depot],
          before: [t.arena],
        })
      ).status,
    ).toBe("saved");
    const listed = await withFirm(t.f.firmId, (tx) => loadContracts(tx));
    expect(listed.contracts.map((c) => [c.name, [...c.siteIds].sort()])).toEqual([
      ["Northgate Council", [t.arena, t.depot].sort()],
      ["Riverside", []],
    ]);
    // A name taken (any case), none, or an unknown venue: nothing changes.
    expect(
      (
        await saveContract(t.ctx(t.admin), {
          clientId: river,
          name: "NORTHGATE council",
          siteIds: [],
        })
      ).status,
    ).toBe("name_taken");
    expect(
      (await saveContract(t.ctx(t.admin), { clientId: null, name: " ", siteIds: [] })).status,
    ).toBe("invalid");
    expect(
      (
        await saveContract(t.ctx(t.admin), {
          clientId: river,
          name: "Riverside",
          siteIds: ["00000000-0000-4000-8000-000000000000"],
        })
      ).status,
    ).toBe("not_found");
    // Removed: its venues stay, with no contract; anyone's choice of it goes too.
    await saveMyDashboard(t.ctx(t.resourcer), { clientIds: [north], cards: ["map"] });
    expect((await removeContract(t.ctx(t.admin), north)).status).toBe("removed");
    const after = await withFirm(t.f.firmId, (tx) => loadContracts(tx));
    expect(after.contracts.map((c) => c.name)).toEqual(["Riverside"]);
    expect(after.sites.every((s) => s.clientId === null)).toBe(true);
    expect(
      (await withFirm(t.f.firmId, (tx) => loadMyDashboard(tx, t.resourcer, NOW))).clientIds,
    ).toEqual([]);
    // Logged with ids and counts, never a name.
    expect((await events(t.f, "client.added")).map((e) => e.data)).toEqual([
      { sites: 1, added: 1, removed: 0 },
      { sites: 1, added: 1, removed: 0 },
    ]);
    // Which venue moved, and from which contract (ids only).
    expect((await events(t.f, "client.saved")).map((e) => [e.entity_id, e.data])).toEqual([
      [north, { sites: 2, added: 1, removed: 0, taken: [{ siteId: t.depot, from: river }] }],
    ]);
    expect((await events(t.f, "client.removed")).map((e) => [e.actor_id, e.data])).toEqual([
      [t.admin, { sites: 2 }],
    ]);
  });

  it("a form loaded before a venue moved can't take it back; names are one whatever their case", async () => {
    const t = await firm();
    const a = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Northgate",
      siteIds: [t.arena, t.depot],
    });
    const north = a.status === "saved" ? a.clientId : "";
    // Another admin moves the depot to a new contract.
    const b = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Riverside",
      siteIds: [t.depot],
    });
    const river = b.status === "saved" ? b.clientId : "";
    // Northgate's form, still showing both, saved with only its name changed: the depot stays.
    await saveContract(t.ctx(t.admin), {
      clientId: north,
      name: "Northgate Council",
      siteIds: [t.arena, t.depot],
      before: [t.arena, t.depot],
    });
    const listed = await withFirm(t.f.firmId, (tx) => loadContracts(tx));
    expect(listed.contracts.map((c) => [c.name, c.siteIds])).toEqual([
      ["Northgate Council", [t.arena]],
      ["Riverside", [t.depot]],
    ]);
    // Unticking a venue another contract has since taken leaves it there.
    await saveContract(t.ctx(t.admin), {
      clientId: north,
      name: "Northgate Council",
      siteIds: [t.arena],
      before: [t.arena, t.depot],
    });
    expect(
      (await withFirm(t.f.firmId, (tx) => loadContracts(tx))).sites.find(
        (s) => s.siteId === t.depot,
      )?.clientId,
    ).toBe(river);
    // The database holds one name per firm whatever the case (two admins at once).
    await expect(
      su.query("insert into clients (firm_id, name) values ($1, 'RIVERSIDE')", [t.f.firmId]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("only an admin; another firm's contract is never found", async () => {
    const t = await firm();
    for (const who of [t.resourcer, t.payroll])
      expect(
        (await saveContract(t.ctx(who), { clientId: null, name: "X", siteIds: [] })).status,
      ).toBe("not_allowed");
    const other = await firm();
    const theirs = await saveContract(other.ctx(other.admin), {
      clientId: null,
      name: "Theirs",
      siteIds: [other.arena],
    });
    const id = theirs.status === "saved" ? theirs.clientId : "";
    expect((await removeContract(t.ctx(t.admin), id)).status).toBe("not_found");
    expect(
      (await saveContract(t.ctx(t.admin), { clientId: id, name: "Mine now", siteIds: [] })).status,
    ).toBe("not_found");
    // Nor can a site of theirs join one of mine.
    expect(
      (await saveContract(t.ctx(t.admin), { clientId: null, name: "Mine", siteIds: [other.arena] }))
        .status,
    ).toBe("not_found");
  });
});

describe("each person's own dashboard", () => {
  it("their contracts and cards saved to them (not anyone else's), and logged", async () => {
    const t = await firm();
    const c = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Northgate",
      siteIds: [t.arena],
    });
    const north = c.status === "saved" ? c.clientId : "";
    const at = await atSite(t.f, t.arena, { startsAt: hoursFromNow(24), headcount: 2 });
    expect(
      await saveMyDashboard(t.ctx(t.resourcer), {
        clientIds: [north, north],
        cards: ["noShows", "map", "noShows"],
      }),
    ).toEqual({ status: "saved" });
    const mine = await withFirm(t.f.firmId, (tx) => loadMyDashboard(tx, t.resourcer, NOW));
    expect(mine).toEqual({
      cards: ["map", "noShows"],
      clientIds: [north],
      sites: [t.arena],
      choices: [{ clientId: north, name: "Northgate", sites: 1, sessions: 1 }],
    });
    // The admin's own: the defaults, every venue.
    const admins = await withFirm(t.f.firmId, (tx) => loadMyDashboard(tx, t.admin, NOW));
    expect(admins.cards).toEqual(["map", "toOffer", "updates", "whoWorked"]);
    expect(admins.sites).toBeNull();
    // Unknown cards, another firm's contract, or payroll: nothing saved.
    expect(
      (await saveMyDashboard(t.ctx(t.resourcer), { clientIds: [], cards: ["watchList"] })).status,
    ).toBe("invalid");
    const other = await firm();
    const theirs = await saveContract(other.ctx(other.admin), {
      clientId: null,
      name: "Theirs",
      siteIds: [],
    });
    expect(
      (
        await saveMyDashboard(t.ctx(t.resourcer), {
          clientIds: [theirs.status === "saved" ? theirs.clientId : ""],
          cards: [],
        })
      ).status,
    ).toBe("invalid");
    expect((await saveMyDashboard(t.ctx(t.payroll), { clientIds: [], cards: [] })).status).toBe(
      "not_allowed",
    );
    expect(
      (await events(t.f, "office_user.dashboard_saved")).map((e) => [e.actor_id, e.data]),
    ).toEqual([[t.resourcer, { contracts: 1, cards: ["map", "noShows"] }]]);
    expect(at).toBeTruthy();
  });

  it("the dashboard narrowed to their contracts' venues, everything with Show everything; the date choice", async () => {
    const t = await firm();
    const c = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Arena",
      siteIds: [t.arena],
    });
    const arenaContract = c.status === "saved" ? c.clientId : "";
    const here = await atSite(t.f, t.arena, { startsAt: hoursFromNow(24), headcount: 2 });
    const there = await atSite(t.f, t.depot, { startsAt: hoursFromNow(48), headcount: 3 });
    // A session at no venue of its own whose event is at the arena: the event's venue counts.
    const viaEvent = await t.f.shift({ startsAt: hoursFromNow(50), headcount: 1 }); // Wednesday
    await su.query(
      `update shift_events set site_id = $2
        where id = (select event_id from shifts where id = $1)`,
      [viaEvent, t.arena],
    );
    await saveMyDashboard(t.ctx(t.resourcer), { clientIds: [arenaContract], cards: [] });
    const load = (o: { everything?: boolean; day?: string | null } = {}) =>
      withFirm(t.f.firmId, (tx) => loadBoard(tx, NOW, { officeUserId: t.resourcer, ...o }));
    const ids = (b: Awaited<ReturnType<typeof load>>) => {
      const g = ok(b.gaps);
      return [...g.toOffer.sessions, ...g.offered.sessions].map((s) => s.shiftId).sort();
    };
    const mine = await load();
    expect(mine.mine).toBe(true);
    expect(ids(mine)).toEqual([here, viaEvent].sort());
    expect(ok(mine.counts).all).toBe(2);
    expect(ok(mine.venues).map((v) => v.siteId)).toEqual([t.arena]);
    const all = await load({ everything: true });
    expect(all.mine).toBe(false);
    expect(ids(all)).toEqual([here, there, viaEvent].sort());
    // The date choice: the days with places (under the contracts), and one of them picked.
    expect(ok(mine.days).map((d) => d.places)).toEqual([2, 1]);
    const tue = ok(mine.days)[0]!.date;
    const picked = await load({ day: tue });
    expect(picked.day).toBe(tue);
    expect(ids(picked)).toEqual([here]);
    // A day not on offer: every day.
    expect((await load({ day: "2027-01-01" })).day).toBeNull();
    // Cards they didn't choose aren't loaded.
    expect(mine.nextTwoWeeks).toBeNull();
    expect(mine.fillRates).toBeNull();
  });
});

describe("the extra cards' figures", () => {
  it("next 2 weeks: booked, offered with no reply, open, each day from today", async () => {
    const t = await firm();
    const s = await atSite(t.f, t.arena, { startsAt: hoursFromNow(26), headcount: 3 });
    const w = await t.f.worker({ first: "Ann" });
    await t.f.booking(w, s);
    const days = await withFirm(t.f.firmId, (tx) => loadNextTwoWeeks(tx, NOW, TZ, null));
    expect(days).toHaveLength(14);
    expect(days[0]?.date).toBe("2026-11-02");
    expect(days[1]).toEqual({ date: "2026-11-03", booked: 1, offered: 0, open: 2 });
    // Only the depot's: nothing.
    const depot = await withFirm(t.f.firmId, (tx) => loadNextTwoWeeks(tx, NOW, TZ, [t.depot]));
    expect(depot.every((d) => d.booked + d.offered + d.open === 0)).toBe(true);
  });

  it("cancellations and no-shows by week, and each contract's fill rate", async () => {
    const t = await firm();
    const w = await t.f.worker({ first: "Bo" });
    // Cancelled last Wednesday with 10 hours' notice; a no-show at a session last Thursday.
    const s = await atSite(t.f, t.arena, { startsAt: hoursFromNow(-110), headcount: 1 });
    await t.f.booking(w, s, "cancelled_worker", 1);
    await su.query(
      "update assignments set cancelled_at = $2, notice_hours = 10 where shift_id = $1",
      [s, hoursFromNow(-120)],
    );
    const n = await atSite(t.f, t.depot, { startsAt: hoursFromNow(-90), headcount: 1 });
    await t.f.booking(w, n, "no_show", 1);
    const cancels = await withFirm(t.f.firmId, (tx) => loadCancelWeeks(tx, NOW, TZ, null));
    expect(cancels).toHaveLength(8);
    expect(cancels.at(-2)).toEqual({ week: "2026-10-26", short: 1, longer: 0 });
    const noShows = await withFirm(t.f.firmId, (tx) => loadNoShowWeeks(tx, NOW, TZ, null));
    expect(noShows.at(-2)).toEqual({ week: "2026-10-26", noShows: 1 });
    // Under the arena's contract only: its cancellation, not the depot's no-show.
    expect(
      (await withFirm(t.f.firmId, (tx) => loadNoShowWeeks(tx, NOW, TZ, [t.arena]))).at(-2),
    ).toEqual({ week: "2026-10-26", noShows: 0 });
    // Fill rate: a contract's places in the next 14 days, booked of needed; no contract together.
    const c = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Arena",
      siteIds: [t.arena],
    });
    const future = await atSite(t.f, t.arena, { startsAt: hoursFromNow(50), headcount: 4 });
    await t.f.booking(w, future, "confirmed", 1);
    await atSite(t.f, t.depot, { startsAt: hoursFromNow(70), headcount: 2 });
    expect(await withFirm(t.f.firmId, (tx) => loadFillRates(tx, NOW, TZ, null))).toEqual([
      { clientId: c.status === "saved" ? c.clientId : "", name: "Arena", needed: 4, booked: 1 },
      { clientId: null, name: null, needed: 2, booked: 0 },
    ]);
  });
});
