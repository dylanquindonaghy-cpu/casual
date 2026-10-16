import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { officeOfferCandidates } from "@/lib/offers/office-offer";
import { runOfferWave } from "@/lib/offers/waves";
import { myShifts } from "@/lib/portal/my-shifts";
import { MAX_CANDIDATES, openShiftsFor } from "@/lib/portal/open-shifts";
import { takeShift } from "@/lib/portal/take-shift";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { saveMyTravel } from "@/lib/portal/travel";
import { areaVerdict, type TravelArea, type WayEstimate } from "@/lib/travel/area";
import { fakeGeocoder, fakePoint } from "@/lib/travel/geocoder";
import { travelLineText } from "@/lib/travel/line-copy";
import type { TravelMode } from "@/lib/travel/modes";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The travel filter (12G.3; docs/office-v2.md 4.3, 5.4; D2, Rules 14) on the real database, as the
// app role: which shifts a casual's travel area lets her see on Open shifts, the urgent board and
// Home (all openShiftsFor()), and be offered by a wave; the order; the "further than you travel"
// count; and what it never stops (a direct link, the office's offer by hand, an unknown distance).
// Estimates are written straight in, so each test sets the exact minutes. NOW is Monday
// 2 November 2026, 09:00 London (GMT).

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
const HOME = "ZZ2 2BB";

// Travel areas on (13.4: a firm's are off until its owner switches them on).
async function filterFirm() {
  const f = await bookingFirm(su, withFirm, { settings: { travel: { enabled: true } } });
  const site = async (o: { located?: boolean; postcode?: string } = {}) => {
    const postcode = o.postcode ?? "ZZ1 1AA";
    const point = o.located === false ? null : fakePoint(postcode);
    const { rows } = await su.query<{ id: string }>(
      `insert into sites (firm_id, name, postcode, lat, lng)
       values ($1, $2, $3, $4, $5) returning id::text as id`,
      [
        f.firmId,
        `Site ${Math.random().toString(36).slice(2, 7)}`,
        postcode,
        point?.lat,
        point?.lng,
      ],
    );
    return rows[0]?.id ?? "";
  };
  const arena = await site();
  // A casual (door supervisor and steward, valid licences) with a travel area, as Profile saves it.
  const casual = async (modes: TravelMode | null, maxMinutes = 45, postcode = HOME) => {
    const id = await f.worker({ first: "Cass" });
    if (modes) {
      const saved = await saveMyTravel(
        { firm: { id: f.firmId }, run: withFirm, clock, geocoder: fakeGeocoder },
        id,
        { postcode, modes, maxMinutes },
      );
      expect(saved).toEqual({ status: "saved" });
    }
    return id;
  };
  // A door supervisor session `h` hours from now at a site (the arena by default).
  const session = async (
    h: number,
    o: { siteId?: string | null; urgent?: boolean; headcount?: number; role?: string } = {},
  ) => {
    const id = await f.shift({ startsAt: hoursFromNow(h), headcount: o.headcount, role: o.role });
    await su.query("update shifts set site_id = $2, is_urgent = $3 where id = $1", [
      id,
      o.siteId === undefined ? arena : o.siteId,
      o.urgent ?? false,
    ]);
    return id;
  };
  // An estimate as the travel job saves it: from a postcode, for the session's site and arrive-by.
  const estimate = async (
    shiftId: string,
    mode: "car" | "public_transport",
    minutes: number | null,
    postcode = HOME,
  ) => {
    await su.query(
      `insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by, minutes,
                                     metres, provider, computed_at, expires_at)
       select s.firm_id, $2, s.site_id, $3, s.starts_at - interval '30 minutes', $4,
              case when $3 = 'car' and $4::int is not null then $4::int * 300 end, 'fake', now(),
              s.ends_at + interval '7 days'
         from shifts s where s.id = $1`,
      [shiftId, postcode, mode, minutes],
    );
  };
  const open = (workerId: string, filters: { urgent?: boolean } = {}) =>
    openShiftsFor({ firm: { id: f.firmId }, run: withFirm, clock }, workerId, filters);
  const listed = async (workerId: string, filters: { urgent?: boolean } = {}) =>
    (await open(workerId, filters)).shifts.map((s) => s.shiftId);
  const candidates = (shiftId: string, opts: { byHand?: boolean } = {}) =>
    withFirm(f.firmId, async (tx) =>
      (await waveCandidates(tx, shiftId, NOW, opts)).map((c) => c.workerId),
    );
  // The firm's travel areas switched on or off (13.4), as the owner's `firm:settings` sets them.
  const travelSwitch = (on: boolean) =>
    su.query(
      `update firms set settings = jsonb_set(settings, '{travel,enabled}', to_jsonb($2::boolean))
        where id = $1`,
      [f.firmId, on],
    );
  return { f, site, arena, casual, session, estimate, open, listed, candidates, travelSwitch };
}

describe("in her travel area", () => {
  it("when any way she chose is within her limit: car 40, public transport 50, limit 45", async () => {
    const t = await filterFirm();
    const [both, car, transport] = [
      await t.casual("both"),
      await t.casual("car"),
      await t.casual("public_transport"),
    ];
    const shiftId = await t.session(48);
    await t.estimate(shiftId, "car", 40);
    await t.estimate(shiftId, "public_transport", 50);
    expect(await t.listed(both)).toEqual([shiftId]); // in: car is within
    expect(await t.listed(car)).toEqual([shiftId]); // in
    expect(await t.listed(transport)).toEqual([]); // out: 50 is over 45
    // A wave offers it to the first two only.
    const offered = await t.candidates(shiftId);
    expect(offered).toContain(both);
    expect(offered).toContain(car);
    expect(offered).not.toContain(transport);
  });

  it("the database's filter and areaVerdict() agree on every case", async () => {
    const t = await filterFirm();
    const MODES: TravelMode[] = ["car", "public_transport", "both"];
    const workers = new Map<TravelMode, string>();
    for (const m of MODES) workers.set(m, await t.casual(m, 45));
    // Each way: not worked out, beyond the ceiling (null), within (30), the limit itself (45),
    // over it (60).
    const WAYS: (number | null | "none")[] = ["none", null, 30, 45, 60];
    const cases: { shiftId: string; car: WayEstimate; pt: WayEstimate }[] = [];
    let h = 24;
    for (const car of WAYS) {
      for (const pt of WAYS) {
        const shiftId = await t.session(h);
        h += 24;
        if (car !== "none") await t.estimate(shiftId, "car", car);
        if (pt !== "none") await t.estimate(shiftId, "public_transport", pt);
        cases.push({
          shiftId,
          car: car === "none" ? undefined : { minutes: car },
          pt: pt === "none" ? undefined : { minutes: pt },
        });
      }
    }
    let outs = 0;
    for (const m of MODES) {
      const workerId = workers.get(m) ?? "";
      const area: TravelArea = { modes: m, maxMinutes: 45 };
      const seen = new Set(await t.listed(workerId));
      for (const c of cases) {
        const verdict = areaVerdict(
          area,
          { located: true },
          { car: c.car, public_transport: c.pt },
        );
        if (verdict === "out") outs += 1;
        expect({ m, c, shown: seen.has(c.shiftId) }).toEqual({ m, c, shown: verdict !== "out" });
      }
    }
    expect(outs).toBeGreaterThan(5); // the table really rules some out
    // Waves agree too (one shift each way).
    for (const c of cases) {
      const offered = new Set(await t.candidates(c.shiftId));
      for (const m of MODES) {
        const verdict = areaVerdict(
          { modes: m, maxMinutes: 45 },
          { located: true },
          { car: c.car, public_transport: c.pt },
        );
        expect({ m, c, offered: offered.has(workers.get(m) ?? "") }).toEqual({
          m,
          c,
          offered: verdict !== "out",
        });
      }
    }
  }, 60_000);

  it("an unknown distance is shown, labelled, and offered: a site with no location, no site, not worked out yet", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car");
    const nowhere = await t.site({ located: false });
    const [noLocation, noSite, notYet] = [
      await t.session(24, { siteId: nowhere }),
      await t.session(48, { siteId: null }),
      await t.session(72),
    ];
    const list = await t.open(cass);
    expect(list.shifts.map((s) => s.shiftId)).toEqual([noLocation, noSite, notYet]);
    const words = list.shifts.map((s) => travelLineText(s.travel!, "Europe/London"));
    expect(words[0]).toBe("Distance not known yet");
    expect(words[1]).toBe("Distance not known yet");
    expect(words[2]).toMatch(/^about \d+ miles? \(straight line\) · Travel time not known yet$/);
    for (const shiftId of [noLocation, noSite, notYet]) {
      expect(await t.candidates(shiftId)).toContain(cass);
    }
  });

  it("no travel area: everything shown, unfiltered, and the list says there's none", async () => {
    const t = await filterFirm();
    const free = await t.casual(null);
    const far = await t.session(48);
    await t.estimate(far, "car", 80);
    await t.estimate(far, "public_transport", null);
    const list = await t.open(free);
    expect(list.area).toBeNull();
    expect(list.shifts.map((s) => s.shiftId)).toEqual([far]);
    expect(list.shifts[0]?.travel).toEqual({ kind: "unknown" });
    expect(list.further).toEqual({ count: 0, atLeast: false });
    expect(await t.candidates(far)).toContain(free);
  });
});

describe("the list", () => {
  it("a near shift is never cut off by the cap: the filter is in the query", async () => {
    const t = await filterFirm();
    const [cass, free] = [await t.casual("car"), await t.casual(null)];
    // 55 shifts outside her area (80 minutes by car), all sooner than the one near shift.
    const far: string[] = [];
    for (let i = 0; i < MAX_CANDIDATES + 5; i += 1) {
      const id = await t.session(12 + i * 4);
      await t.estimate(id, "car", 80);
      far.push(id);
    }
    const near = await t.session(12 + (MAX_CANDIDATES + 5) * 4 + 4);
    await t.estimate(near, "car", 15);
    const list = await t.open(cass);
    expect(list.shifts.map((s) => s.shiftId)).toEqual([near]);
    expect(list.truncated).toBe(false);
    expect(list.further).toEqual({ count: MAX_CANDIDATES, atLeast: true });
    // Without an area, the cap would have cut the near shift off.
    const unfiltered = await t.open(free);
    expect(unfiltered.truncated).toBe(true);
    expect(unfiltered.shifts.map((s) => s.shiftId)).not.toContain(near);
  }, 60_000);

  it("urgent first, then the nearest (her quickest chosen way), then the date; unknown last", async () => {
    const t = await filterFirm();
    const cass = await t.casual("both", 60);
    const unknown = await t.session(24);
    const a20 = await t.session(72);
    await t.estimate(a20, "car", 20);
    const e10 = await t.session(96);
    await t.estimate(e10, "public_transport", 10); // her quickest way here is public transport
    await t.estimate(e10, "car", 50);
    const b10 = await t.session(120);
    await t.estimate(b10, "car", 10);
    const urgent30 = await t.session(144, { urgent: true });
    await t.estimate(urgent30, "car", 30);
    expect(await t.listed(cass)).toEqual([urgent30, e10, b10, a20, unknown]);
  });

  it("'nearest' is her quickest chosen way: a way she didn't choose doesn't count", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car", 60);
    const busOnly = await t.session(48); // 5 min by public transport, but she drives: 40
    await t.estimate(busOnly, "car", 40);
    await t.estimate(busOnly, "public_transport", 5);
    const drive = await t.session(72);
    await t.estimate(drive, "car", 15);
    expect(await t.listed(cass)).toEqual([drive, busOnly]);
  });

  it("each row carries both times, whichever way she chose", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car");
    const shiftId = await t.session(48);
    await t.estimate(shiftId, "car", 18);
    await t.estimate(shiftId, "public_transport", 41);
    const [row] = (await t.open(cass)).shifts;
    expect(travelLineText(row?.travel ?? { kind: "unknown" }, "Europe/London")).toBe(
      "3.4 miles · 18 min by car · 41 min by public transport",
    );
  });

  it("the filter choices leave out shifts outside her area", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car");
    const elsewhere = await t.site({ postcode: "ZZ9 9ZZ" });
    const near = await t.session(48);
    await t.estimate(near, "car", 20);
    const far = await t.session(72, { siteId: elsewhere });
    await t.estimate(far, "car", 85);
    const list = await t.open(cass);
    expect(list.choices.sites.map((s) => s.id)).toEqual([t.arena]);
    expect(list.choices.days).toEqual(["2026-11-04"]);
  });

  it("'N more shifts are further than you travel': ones she could take but for her area", async () => {
    const t = await filterFirm();
    const [cass, other] = [await t.casual("car"), await t.casual(null)];
    const near = await t.session(24);
    await t.estimate(near, "car", 20);
    const far = [await t.session(48), await t.session(72, { urgent: true })];
    const full = await t.session(96); // taken already: not one she could take
    const steward = await t.session(120, { role: "coss" }); // not her role
    for (const id of [...far, full, steward]) await t.estimate(id, "car", 70);
    await t.f.booking(other, full);
    expect((await t.open(cass)).further).toEqual({ count: 2, atLeast: false });
    expect((await t.open(cass, { urgent: true })).further).toEqual({ count: 1, atLeast: false });
  });
});

describe("the urgent board and Home (openShiftsFor with urgent)", () => {
  it("only urgent shifts in her area; the rest counted as further", async () => {
    const t = await filterFirm();
    const cass = await t.casual("public_transport", 30);
    const inArea = await t.session(10, { urgent: true });
    await t.estimate(inArea, "public_transport", 25);
    const outside = await t.session(12, { urgent: true });
    await t.estimate(outside, "public_transport", 45);
    const notUrgent = await t.session(14);
    await t.estimate(notUrgent, "public_transport", 5);
    const board = await t.open(cass, { urgent: true });
    expect(board.shifts.map((s) => s.shiftId)).toEqual([inArea]);
    expect(board.further).toEqual({ count: 1, atLeast: false });
  });
});

describe("offer waves", () => {
  it("a casual outside the area gets no offer; one with an unknown distance does", async () => {
    const t = await filterFirm();
    const [inside, outside, unknown] = [
      await t.casual("car", 30, "ZZ2 2BB"),
      await t.casual("car", 30, "ZZ3 3CC"),
      await t.casual("car", 30, "ZZ4 4DD"),
    ];
    const shiftId = await t.session(10, { urgent: true, headcount: 3 });
    await t.estimate(shiftId, "car", 20, "ZZ2 2BB");
    await t.estimate(shiftId, "car", 35, "ZZ3 3CC");
    const { transport, sent } = captureTransport();
    await runOfferWave({ firmId: t.f.firmId, idempotencyKey: "t:1", shiftId, wave: 1 }, withFirm, {
      transport,
      push: {
        name: "none",
        async send() {
          return { status: "sent" };
        },
      },
      baseDomain: "localhost:3000",
      clock,
    });
    const { rows } = await su.query<{ worker_id: string }>(
      "select worker_id::text from offers where shift_id = $1 order by worker_id",
      [shiftId],
    );
    expect(new Set(rows.map((r) => r.worker_id))).toEqual(new Set([inside, unknown]));
    expect(rows.map((r) => r.worker_id)).not.toContain(outside);
    expect(sent).toHaveLength(2);
  });

  it("the office's offer by hand still lists a casual outside the area (D2)", async () => {
    const t = await filterFirm();
    const outside = await t.casual("car", 30);
    const shiftId = await t.session(48);
    await t.estimate(shiftId, "car", 60);
    expect(await t.candidates(shiftId)).not.toContain(outside);
    expect(await t.candidates(shiftId, { byHand: true })).toContain(outside);
    const office = await withFirm(t.f.firmId, (tx) => officeOfferCandidates(tx, shiftId, NOW));
    expect(office.map((c) => c.workerId)).toContain(outside);
  });
});

describe("what the area never stops", () => {
  it("a shift opened from a direct link outside her area still books", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car", 30);
    const far = await t.session(48);
    await t.estimate(far, "car", 75);
    expect(await t.listed(cass)).toEqual([]);
    const result = await takeShift(
      {
        firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
        run: withFirm,
        clock,
      },
      cass,
      far,
    );
    expect(result).toMatchObject({ status: "booked" });
  });

  it("Booked: upcoming bookings carry the travel line; past ones don't", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car", 30);
    const ahead = await t.session(48);
    await t.estimate(ahead, "car", 75); // outside her area: booked anyway, still has its line
    await t.estimate(ahead, "public_transport", null);
    await t.f.booking(cass, ahead);
    const past = await t.session(-30);
    await t.f.booking(cass, past);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    const [upcoming] = await myShifts(ctx, cass, "upcoming");
    expect(upcoming?.shiftId).toBe(ahead);
    expect(travelLineText(upcoming?.travel ?? { kind: "unknown" }, "Europe/London")).toBe(
      "14.0 miles · 75 min by car · no public transport by 08:30",
    );
    const [done] = await myShifts(ctx, cass, "past");
    expect(done?.shiftId).toBe(past);
    expect(done?.travel).toBeUndefined();
  });
});

describe("each firm's own", () => {
  it("another firm's estimates and areas never filter this firm's shifts", async () => {
    const a = await filterFirm();
    const b = await filterFirm();
    const cass = await a.casual("car", 30);
    const shiftId = await a.session(48);
    await a.estimate(shiftId, "car", 20);
    // Firm B's casual with the same postcode, and an estimate of B's own that would rule it out.
    await b.casual("car", 30);
    const theirs = await b.session(48);
    await b.estimate(theirs, "car", 80);
    expect(await a.listed(cass)).toEqual([shiftId]);
    // Firm B's run never sees firm A's casual.
    expect(await b.candidates(shiftId)).toEqual([]);
  });
});

describe("travel areas switched off for the firm (13.4)", () => {
  it("a saved area filters, orders and shows nothing; Home, the lists and waves as if none; on again: as before", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car", 45);
    // Inside her area, later but nearer; inside, sooner but further; outside (60 minutes).
    const near = await t.session(48);
    await t.estimate(near, "car", 10);
    const inside = await t.session(24);
    await t.estimate(inside, "car", 40);
    const outside = await t.session(36);
    await t.estimate(outside, "car", 60);
    // On: the outside one left out (counted as further), the nearest first, each with its line.
    expect(await t.listed(cass)).toEqual([near, inside]);
    expect(await t.candidates(outside)).toEqual([]);

    await t.travelSwitch(false);
    const list = await t.open(cass);
    // Every one listed, by date only; no area (so no prompt), nothing further, no travel lines.
    expect(list.shifts.map((s) => s.shiftId)).toEqual([inside, outside, near]);
    expect(list).toMatchObject({
      travelOn: false,
      area: null,
      further: { count: 0, atLeast: false },
    });
    expect(list.shifts.every((s) => !("travel" in s))).toBe(true);
    expect(await t.listed(cass, { urgent: true })).toEqual([]);
    // The shifts line's reasons never say "outside their travel area".
    const explained = await openShiftsFor(
      { firm: { id: t.f.firmId }, run: withFirm, clock },
      cass,
      {},
      { explain: true },
    );
    expect(
      explained.explain?.notOffered.flatMap((n) => n.reasons.map((r) => r.code)),
    ).not.toContain("outside_area");
    // A wave offers it to her.
    expect(await t.candidates(outside)).toEqual([cass]);

    await t.travelSwitch(true);
    expect(await t.listed(cass)).toEqual([near, inside]);
    expect(await t.candidates(outside)).toEqual([]);
  });

  it("Booked and the shift page carry no travel lines (the maps button stays: the page's own)", async () => {
    const t = await filterFirm();
    const cass = await t.casual("car", 45);
    const ahead = await t.session(48);
    await t.estimate(ahead, "car", 20);
    await t.f.booking(cass, ahead);
    const other = await t.session(72);
    await t.estimate(other, "car", 20);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    // On: both carry their travel.
    expect((await myShifts(ctx, cass, "upcoming"))[0]?.travel).toBeDefined();
    const before = await shiftForWorker(ctx, cass, other);
    expect(before.state === "open" && before.facts.travel).toBeTruthy();

    await t.travelSwitch(false);
    const [booked] = await myShifts(ctx, cass, "upcoming");
    expect(booked?.shiftId).toBe(ahead);
    expect(booked && "travel" in booked).toBe(false);
    const page = await shiftForWorker(ctx, cass, other);
    expect(page.state).toBe("open");
    expect(page.state === "open" && "travel" in page.facts).toBe(false);
    const mine = await shiftForWorker(ctx, cass, ahead);
    expect(mine.state).toBe("booked");
    expect(mine.state === "booked" && "travel" in mine.facts).toBe(false);
  });
});
