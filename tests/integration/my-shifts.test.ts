import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myNeedsUpdating, myShifts } from "@/lib/portal/my-shifts";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// What My shifts shows, from the real database as the app role: the worker's own bookings only,
// upcoming or the last 30 days, with the site and instructions; and the credential banner.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const clock = { now: () => NOW };

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const ctxFor = (f: BookingFirm) => ({ firm: { id: f.firmId }, run: withFirm, clock });

async function addSite(f: BookingFirm, shiftId: string, instructions: string | null) {
  const { rows } = await su.query<{ id: string }>(
    `insert into sites (firm_id, name, address_line1, town, postcode)
     values ($1, 'Demo Arena ' || substr(md5(random()::text), 1, 6), '1 Test Road', 'Leeds', 'LS1 1AA')
     returning id::text as id`,
    [f.firmId],
  );
  await su.query("update shifts set site_id = $1, instructions = $2 where id = $3", [
    rows[0]?.id,
    instructions,
    shiftId,
  ]);
}

describe("myShifts", () => {
  it("lists the worker's upcoming bookings, soonest first, with the site and instructions", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const later = await f.shift({ startsAt: hoursFromNow(72) });
    const soon = await f.shift({ startsAt: hoursFromNow(24) });
    const onNow = await f.shift({ startsAt: hoursFromNow(-2) }); // 8 hours long: still on
    await addSite(f, soon, "Report to Gate C at 13:30.\nBring your licence.");
    for (const s of [later, soon, onNow]) await f.booking(sam, s);

    const shifts = await myShifts(ctxFor(f), sam, "upcoming");
    expect(shifts.map((s) => s.shiftId)).toEqual([onNow, soon, later]);
    expect(shifts[1]).toMatchObject({
      role: "door_supervisor",
      status: "confirmed",
      startsAt: hoursFromNow(24),
      endsAt: hoursFromNow(32),
      instructions: "Report to Gate C at 13:30.\nBring your licence.",
      site: {
        name: expect.stringMatching(/^Demo Arena /),
        addressLine1: "1 Test Road",
        addressLine2: null,
        town: "Leeds",
        postcode: "LS1 1AA",
      },
    });
    expect(shifts[0]?.site).toBeNull();
  });

  it("leaves out cancelled bookings, cancelled shifts, offers and other workers' bookings", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const mine = await f.shift({ startsAt: hoursFromNow(24) });
    const cancelledBooking = await f.shift({ startsAt: hoursFromNow(30) });
    const cancelledShift = await f.shift({ startsAt: hoursFromNow(36), status: "cancelled" });
    const offered = await f.shift({ startsAt: hoursFromNow(40) });
    const jos = await f.shift({ startsAt: hoursFromNow(44) });
    await f.booking(sam, mine);
    await f.booking(sam, cancelledBooking, "cancelled_worker");
    await f.booking(sam, cancelledShift);
    await f.booking(sam, offered, "offered");
    await f.booking(jo, jos);
    expect((await myShifts(ctxFor(f), sam, "upcoming")).map((s) => s.shiftId)).toEqual([mine]);
  });

  it("shows the last 30 days, newest first: worked, not attended, or still marked booked", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const worked = await f.shift({ startsAt: hoursFromNow(-48) });
    const missed = await f.shift({ startsAt: hoursFromNow(-24 * 10) });
    const unmarked = await f.shift({ startsAt: hoursFromNow(-24 * 20) });
    const tooOld = await f.shift({ startsAt: hoursFromNow(-24 * 31) });
    const cancelled = await f.shift({ startsAt: hoursFromNow(-24 * 5) });
    const upcoming = await f.shift({ startsAt: hoursFromNow(24) });
    await f.booking(sam, worked, "completed");
    await f.booking(sam, missed, "no_show");
    await f.booking(sam, unmarked);
    await f.booking(sam, tooOld, "completed");
    await f.booking(sam, cancelled, "cancelled_worker");
    await f.booking(sam, upcoming);
    // Cancelled on the rota sheet after it started: its bookings are history, still shown.
    const cancelledLate = await f.shift({ startsAt: hoursFromNow(-24 * 3), status: "cancelled" });
    await f.booking(sam, cancelledLate, "completed");
    const past = await myShifts(ctxFor(f), sam, "past");
    expect(past.map((s) => [s.shiftId, s.status])).toEqual([
      [worked, "completed"],
      [cancelledLate, "completed"],
      [missed, "no_show"],
      [unmarked, "confirmed"],
    ]);
  });

  it("keeps a shift in progress on screen even once the office has marked it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const running = await f.shift({ startsAt: hoursFromNow(-1) });
    await f.booking(sam, running, "no_show"); // marked while Sam is still on the way
    expect((await myShifts(ctxFor(f), sam, "upcoming")).map((s) => s.shiftId)).toEqual([running]);
  });

  it("never shows another firm's bookings, even for its worker's id", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const kit = await theirs.worker();
    await theirs.booking(kit, await theirs.shift());
    expect(await myShifts(ctxFor(mine), kit, "upcoming")).toEqual([]);
    expect(await myShifts(ctxFor(theirs), kit, "upcoming")).toHaveLength(1);
  });
});

// "Needs updating" (12F.1; docs/office-v2.md 4.2): what the worker's roles need, in its four levels
// (the rules: tests/unit/credentials.status.test.ts). It replaced the credential banners: the same
// cases, in the new shape.
describe("myNeedsUpdating", () => {
  const brief = (items: Awaited<ReturnType<typeof myNeedsUpdating>>) =>
    items.map((n) => ({
      level: n.level,
      type: n.qualification.type,
      name: n.qualification.name,
      status: n.qualification.status,
      expiresOn: n.qualification.expiresOn,
    }));

  it("lists what the worker's roles need: expired first, then expiring within 30 days", async () => {
    const f = await bookingFirm(su, withFirm);
    // NOW is 2 Nov 2026: 30 days on is 2 Dec. Sam is a steward and a door supervisor, so the
    // firm's rules need STEWARD_L2 and SIA_DS.
    const sam = await f.worker({
      roles: ["steward", "door_supervisor"],
      credentials: [
        { type: "SIA_DS", expiresOn: "2026-11-20" }, // soon
        { type: "STEWARD_L2", status: "expired", expiresOn: "2026-10-01" }, // expired
        { type: "FIRST_AID", status: "expired", expiresOn: "2026-10-01" }, // no role needs it
        { type: "SIA_SG", expiresOn: "2026-11-10" }, // no role needs it
      ],
    });
    expect(brief(await myNeedsUpdating(ctxFor(f), sam))).toEqual([
      {
        level: 2,
        type: "STEWARD_L2",
        name: "Level 2 spectator safety qualification",
        status: "expired",
        expiresOn: "2026-10-01",
      },
      {
        level: 3,
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        status: "expiring_soon",
        expiresOn: "2026-11-20",
      },
    ]);
  });

  it("counts a valid one past its date as expired, one with no expiry as fine, and none as missing", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({
      roles: ["steward", "door_supervisor", "security_officer"],
      credentials: [
        { type: "SIA_DS", expiresOn: "2026-10-30" }, // still marked valid, date gone
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    expect(brief(await myNeedsUpdating(ctxFor(f), sam))).toEqual([
      {
        level: 2,
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        status: "expired",
        expiresOn: "2026-10-30",
      },
      {
        level: 4,
        type: "SIA_SG",
        name: "SIA security guard licence",
        status: "missing",
        expiresOn: null,
      },
    ]);
  });

  it("puts first one that stops a booked shift: missing, or expiring before it ends", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({
      roles: ["steward", "door_supervisor"],
      credentials: [
        { type: "STEWARD_L2", expiresOn: "2027-06-01" }, // fine for the booking
        { type: "SIA_DS", expiresOn: "2026-11-05" }, // ends before Friday's shift
      ],
    });
    // Friday 6 November, 09:00 to 17:00 London: the licence runs out the day before.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(4 * 24) }));
    const [first] = await myNeedsUpdating(ctxFor(f), sam);
    expect(first).toMatchObject({
      level: 1,
      qualification: { type: "SIA_DS", status: "expiring_soon" },
      blocks: { role: "door_supervisor", day: "2026-11-06" },
    });
  });

  it("says nothing about a type the worker has replaced or is renewing", async () => {
    const f = await bookingFirm(su, withFirm);
    const replaced = await f.worker({
      credentials: [
        { type: "SIA_DS", status: "expired", expiresOn: "2026-09-01" },
        { type: "SIA_DS", expiresOn: "2029-09-01" },
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    const renewing = await f.worker({
      credentials: [
        { type: "SIA_DS", status: "expired", expiresOn: "2026-09-01" },
        { type: "SIA_DS", status: "applied", expiresOn: null },
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    expect(await myNeedsUpdating(ctxFor(f), replaced)).toEqual([]);
    expect(await myNeedsUpdating(ctxFor(f), renewing)).toEqual([]);
  });

  it("never shows another worker's or another firm's qualifications", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const soon = [
      { type: "SIA_DS", expiresOn: "2026-11-20" },
      { type: "STEWARD_L2", expiresOn: null },
    ];
    const fine = [
      { type: "SIA_DS", expiresOn: "2029-11-20" },
      { type: "STEWARD_L2", expiresOn: null },
    ];
    const sam = await mine.worker({ credentials: fine });
    await mine.worker({ first: "Jo", credentials: soon });
    const kit = await theirs.worker({ credentials: soon });
    expect(await myNeedsUpdating(ctxFor(mine), sam)).toEqual([]);
    expect(await myNeedsUpdating(ctxFor(mine), kit)).toEqual([]);
    expect(await myNeedsUpdating(ctxFor(theirs), kit)).toHaveLength(1);
  });
});
