import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { homeMap } from "@/lib/portal/home-map";
import { loadMapPlaces } from "@/lib/portal/home-map-places";
import { myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Home's map (Phase 32, 32.2; docs/screens.md "## Phase 32") on the real database, as the app role:
// the pins are her next shift's venue and the venues of the very list "Open to you" counts
// (openShiftsFor: the rules decide), each venue's point read inside her firm. Another firm's venue
// is never read, even when its id is asked for; a venue with no point has no pin.

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
const clock = { now: () => NOW };
const ctxOf = (f: BookingFirm) => ({ firm: { id: f.firmId, timezone: TZ }, run: withFirm, clock });

async function site(f: BookingFirm, name: string, point: [number, number] | null) {
  const { rows } = await su.query<{ id: string }>(
    `insert into sites (firm_id, name, lat, lng) values ($1, $2, $3, $4) returning id::text as id`,
    [f.firmId, name, point?.[0] ?? null, point?.[1] ?? null],
  );
  return rows[0]!.id;
}
const atSite = (shiftId: string, siteId: string) =>
  su.query("update shifts set site_id = $2 where id = $1", [shiftId, siteId]);

describe("Home's map: her shift's venue and the venues open to her, inside her firm", () => {
  it("pins from the page's own lists, points from her firm only", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker({ first: "Sam" });
    const riverside = await site(f, "Riverside Demo Park", [53.79, -1.52]);
    const northgate = await site(f, "Northgate Demo Common", [53.82, -1.5]);
    const nowhere = await site(f, "No Postcode Yet Hall", null);
    const theirs = await site(other, "Other Firm Arena", [53.8, -1.55]);

    // Her booking on Thursday at Riverside; two shifts open to her at Northgate (one urgent), one
    // at a venue with no point; one she can't take (a role she doesn't have) at Riverside.
    const thursday = await f.shift({ role: "steward", startsAt: hoursFromNow(72) });
    await atSite(thursday, riverside);
    await su.query("update shifts set status = 'filled' where id = $1", [thursday]);
    await f.booking(sam, thursday);
    const a = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(48) });
    const b = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(8 * 24) });
    await su.query("update shifts set is_urgent = true where id = $1", [a]);
    await atSite(a, northgate);
    await atSite(b, northgate);
    const c = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(30) });
    await atSite(c, nowhere);
    const notHers = await f.shift({ role: "cleaner", startsAt: hoursFromNow(30) });
    await atSite(notHers, riverside);
    // The other firm's open shift at its own venue.
    const elsewhere = await other.shift({ role: "door_supervisor", startsAt: hoursFromNow(30) });
    await su.query("update shifts set site_id = $2 where id = $1", [elsewhere, theirs]);

    const ctx = ctxOf(f);
    const [upcoming, open] = await Promise.all([
      myShifts(ctx, sam, "upcoming"),
      openShiftsFor(ctx, sam),
    ]);
    expect(open.shifts.map((s) => s.shiftId).sort()).toEqual([a, b, c].sort());
    const places = await loadMapPlaces(ctx, upcoming[0] ?? null, open.shifts);
    expect(places.nextPlace?.siteId).toBe(riverside);
    expect([...places.places.keys()].sort()).toEqual([northgate, nowhere].sort());
    const map = homeMap({
      next: upcoming[0] ?? null,
      nextPlace: places.nextPlace,
      open: open.shifts,
      places: places.places,
      now: NOW,
      timeZone: TZ,
    });
    expect(map.pins.map((p) => [p.name, p.mine, p.shifts.length])).toEqual([
      ["Riverside Demo Park", true, 1],
      ["Northgate Demo Common", false, 2],
    ]);
    expect(map.counts).toEqual({ all: 4, urgent: 1, this: 3, next: 1 });

    // The loader, asked for another firm's venue by id (as a forged list would): nothing comes
    // back. This proves the loader as a whole (its firm_id predicate and RLS together), not which
    // of the two stopped it.
    const forged = await loadMapPlaces(ctx, null, [
      { ...open.shifts[0]!, site: { ...open.shifts[0]!.site!, id: theirs } },
    ]);
    expect(forged.places.size).toBe(0);
    // The loader run as the other firm, asked for her booking and her venues: nothing of hers.
    const theirsRead = await loadMapPlaces(ctxOf(other), { shiftId: thursday }, open.shifts);
    expect(theirsRead.nextPlace).toBeNull();
    expect(theirsRead.places.size).toBe(0);

    // Row Level Security alone: the same raw select of sites by id with no firm_id predicate, as
    // the app role inside the wrong firm's withFirm. The other firm's venue isn't there, while the
    // same select inside its own firm finds it (so the id is real and only RLS hides it).
    const bare = (firmId: string) =>
      withFirm(firmId, async (tx) => {
        const { rows } = await tx.execute<{ id: string }>(
          sql`select v.id::text as id from sites v where v.id = ${theirs}::uuid`,
        );
        return rows.length;
      });
    expect(await bare(f.firmId)).toBe(0);
    expect(await bare(other.firmId)).toBe(1);
  });
});
