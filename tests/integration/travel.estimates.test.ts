import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { createLogger } from "@/lib/log";
import { purgeExpired } from "@/lib/gdpr/retention";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { runOfferWave, type OfferDeps } from "@/lib/offers/waves";
import { editSitePostcode } from "@/lib/office/settings-page";
import { createShifts, editShift } from "@/lib/office/shift-editor";
import { saveMyTravel } from "@/lib/portal/travel";
import { moveShiftByFirm } from "@/lib/roster/firm-change";
import { setShiftUrgent } from "@/lib/roster/urgent";
import {
  AFTER_WAVE_DELAY_SECONDS,
  CASUAL_CHANGE_DELAY_SECONDS,
  TRAVEL_ESTIMATES_QUEUE,
} from "@/lib/travel/estimate-queue";
import {
  BEFORE_WAVE_BUDGET_MS,
  createTravelEstimatesTask,
  estimatesBeforeWave,
  fillEstimates,
  runTravelEstimatesTick,
  TRAVEL_JOB_BUDGET_MS,
  TRAVEL_JOB_EXPIRE_SECONDS,
} from "@/lib/travel/estimates";
import { fakeGeocoder, fakePoint } from "@/lib/travel/geocoder";
import { travelLineText } from "@/lib/travel/line-copy";
import { travelFor } from "@/lib/travel/lines";
import {
  fakeTravelProvider,
  TRAVELTIME_TIMEOUT_MS,
  type TravelProvider,
  type TravelSearch,
} from "@/lib/travel/provider";
import { FIRM_WORK_OPTIONS, registerJobs, TRAVEL_WORK_OPTIONS } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport, quietLogger } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Travel estimates (12G.2; docs/office-v2.md 5.4; S9) on the real database, as the app role, with
// the fake travel provider (never the network): what the job searches and saves, batching, a site
// that moves meanwhile, the provider down and the straight-line fallback, the first urgent wave,
// the nightly window, the purge, every change that queues the job, and each firm's own. NOW is
// Monday 2 November 2026, 09:00 London (GMT).

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
const HOUR = 3_600_000;

// A provider that records each search, answering like the fake (or as told).
function recording(answer?: (s: TravelSearch) => ReturnType<TravelProvider["search"]>) {
  const searches: TravelSearch[] = [];
  const provider: TravelProvider = {
    name: "fake",
    async search(s) {
      searches.push(s);
      return answer ? answer(s) : fakeTravelProvider.search(s);
    },
  };
  return { searches, provider };
}

async function travelFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const point = fakePoint("ZZ1 1AA");
  const { rows } = await su.query<{ id: string }>(
    `insert into sites (firm_id, name, postcode, lat, lng)
     values ($1, 'Riverside Arena', 'ZZ1 1AA', $2, $3) returning id::text as id`,
    [f.firmId, point?.lat, point?.lng],
  );
  const siteId = rows[0]?.id ?? "";
  // A casual's travel area, as Profile saves it.
  const area = async (workerId: string, postcode: string) =>
    expect(
      await saveMyTravel(
        { firm: { id: f.firmId }, run: withFirm, clock, geocoder: fakeGeocoder },
        workerId,
        {
          postcode,
          modes: "both",
          maxMinutes: 45,
        },
      ),
    ).toEqual({ status: "saved" });
  // A session at the arena (steward by default), `h` hours from now.
  const session = async (h = 48, role = "steward") => {
    const id = await f.shift({ startsAt: hoursFromNow(h), role });
    await su.query("update shifts set site_id = $2 where id = $1", [id, siteId]);
    return id;
  };
  const estimates = async () =>
    (
      await su.query<{
        origin_postcode: string;
        mode: string;
        arrive_by: Date;
        minutes: number | null;
        metres: number | null;
        provider: string;
        expires_at: Date;
      }>(
        `select origin_postcode, mode, arrive_by, minutes, metres, provider, expires_at
           from travel_estimates where firm_id = $1 order by arrive_by, origin_postcode, mode`,
        [f.firmId],
      )
    ).rows;
  const queued = async () =>
    (
      await su.query<{
        id: string;
        data: { shiftIds?: string[]; window?: boolean };
        delay: number; // seconds from queued to start
        singleton_key: string | null;
      }>(
        `select id::text, data, singleton_key,
                extract(epoch from start_after - created_on)::float8 as delay
           from pgboss.job
          where name = 'travel.estimates' and data ->> 'firmId' = $1 order by created_on, id`,
        [f.firmId],
      )
    ).rows;
  const queuedIds = async () => (await queued()).flatMap((j) => j.data.shiftIds ?? []);
  const fill = (
    scope: { shiftIds: string[] } | { window: true },
    provider: TravelProvider,
    budgetMs?: number,
  ) => fillEstimates(withFirm, f.firmId, scope, { provider, clock, budgetMs });
  const clearQueued = () =>
    su.query("delete from pgboss.job where name = 'travel.estimates' and data ->> 'firmId' = $1", [
      f.firmId,
    ]);
  const office = (officeUserId = admin) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
  });
  return {
    f,
    admin,
    siteId,
    area,
    session,
    estimates,
    queued,
    queuedIds,
    fill,
    clearQueued,
    office,
  };
}

describe("working estimates out", () => {
  it("both ways, from each postcode of an active casual with the role, once", async () => {
    const t = await travelFirm();
    const [ann, ben, cal, dan, eve] = [
      await t.f.worker({ first: "Ann", roles: ["steward"] }),
      await t.f.worker({ first: "Ben", roles: ["steward"] }),
      await t.f.worker({ first: "Cal", roles: ["steward"] }),
      await t.f.worker({ first: "Dan", roles: ["door_supervisor"] }),
      await t.f.worker({ first: "Eve", roles: ["steward"] }),
    ];
    await t.area(ann, "ZZ2 2BB");
    await t.area(ben, "ZZ2 2BB"); // the same postcode: one estimate for both
    await t.area(cal, "ZZ3 3CC");
    await t.area(dan, "ZZ4 4DD"); // not a steward
    await t.area(eve, "ZZ5 5EE");
    await su.query("update workers set status = 'inactive' where id = $1", [eve]);
    const shiftId = await t.session(48);
    const look = recording();
    expect(await t.fill({ shiftIds: [shiftId] }, look.provider)).toEqual({
      searches: 2,
      saved: 4,
      unavailable: false,
      more: false,
    });
    expect(look.searches.map((s) => [s.mode, s.from.map((o) => o.id)])).toEqual([
      ["car", ["o1", "o2"]],
      ["public_transport", ["o1", "o2"]],
    ]);
    const arriveBy = new Date(hoursFromNow(48).getTime() - 30 * 60_000);
    expect(look.searches[0]?.arriveBy).toEqual(arriveBy);
    const rows = await t.estimates();
    expect(rows.map((r) => [r.origin_postcode, r.mode])).toEqual([
      ["ZZ2 2BB", "car"],
      ["ZZ2 2BB", "public_transport"],
      ["ZZ3 3CC", "car"],
      ["ZZ3 3CC", "public_transport"],
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ arrive_by: arriveBy, provider: "fake" });
      // Kept until 7 days after the session ends (an 8-hour session).
      expect(r.expires_at).toEqual(new Date(hoursFromNow(48 + 8 + 7 * 24).getTime()));
    }
    expect(rows.filter((r) => r.mode === "car").every((r) => (r.metres ?? 0) > 0)).toBe(true);
    // Run again: nothing missing, nothing searched.
    const again = recording();
    expect(await t.fill({ shiftIds: [shiftId] }, again.provider)).toMatchObject({ searches: 0 });
  });

  it("sessions sharing a site and a start share their searches", async () => {
    const t = await travelFirm();
    const [ann, dan] = [
      await t.f.worker({ first: "Ann", roles: ["steward"] }),
      await t.f.worker({ first: "Dan", roles: ["door_supervisor"] }),
    ];
    await t.area(ann, "ZZ2 2BB");
    await t.area(dan, "ZZ3 3CC");
    const a = await t.session(48, "steward");
    const b = await t.session(48, "door_supervisor");
    const look = recording();
    await t.fill({ shiftIds: [a, b] }, look.provider);
    expect(look.searches.map((s) => s.from.length)).toEqual([2, 2]);
  });

  it("casuals sharing a postcode with different points: one start point for it (the latest)", async () => {
    const t = await travelFirm();
    const [ann, ben] = [
      await t.f.worker({ first: "Ann", roles: ["steward"] }),
      await t.f.worker({ first: "Ben", roles: ["steward"] }),
    ];
    await t.area(ann, "ZZ2 2BB");
    await t.area(ben, "ZZ2 2BB");
    // Ben's was looked up later, after the look-up's data for the postcode moved a little.
    await su.query(
      `update worker_travel set lat = lat + 0.001, updated_at = updated_at + interval '1 day'
        where worker_id = $1`,
      [ben],
    );
    const bens = await su.query<{ lat: string; lng: string }>(
      "select lat::text, lng::text from worker_travel where worker_id = $1",
      [ben],
    );
    const shiftId = await t.session(48);
    const look = recording();
    expect(await t.fill({ shiftIds: [shiftId] }, look.provider)).toMatchObject({
      searches: 2,
      saved: 2,
    });
    for (const s of look.searches) {
      expect(s.from.map((o) => o.point)).toEqual([
        { lat: Number(bens.rows[0]?.lat), lng: Number(bens.rows[0]?.lng) },
      ]);
    }
    expect((await t.estimates()).map((r) => [r.origin_postcode, r.mode])).toEqual([
      ["ZZ2 2BB", "car"],
      ["ZZ2 2BB", "public_transport"],
    ]);
  });

  it("a session beyond the job's window (29 days): none yet; the nightly run gives it them", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const [day28, day30] = [await t.session(28 * 24 + 1), await t.session(30 * 24)];
    const look = recording();
    await t.fill({ shiftIds: [day28, day30] }, look.provider);
    expect(look.searches.map((s) => s.arriveBy)).toEqual([
      new Date(hoursFromNow(28 * 24 + 1).getTime() - 30 * 60_000),
      new Date(hoursFromNow(28 * 24 + 1).getTime() - 30 * 60_000),
    ]);
  });

  // Sessions just after each clock change, through the job: arrive-by is 30 real minutes before
  // the start, never 30 minutes off the London clock face.
  // - Autumn: 01:20 GMT on Sunday 25 October 2026, just after 02:00 BST became 01:00 GMT. Arrive by
  //   01:50 BST (00:50 UTC), not "00:50" on the clock (23:50 UTC, an hour early).
  // - Spring: 02:20 BST on Sunday 28 March 2027, just after 01:00 GMT became 02:00 BST. Arrive by
  //   00:50 GMT, not "01:50", a time that night doesn't have.
  it("arrive-by across both clock changes: 30 real minutes before the start", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const cases = [
      {
        now: "2026-10-24T09:00:00Z",
        start: "2026-10-25T01:20:00Z",
        arriveBy: "2026-10-25T00:50:00Z",
      },
      {
        now: "2027-03-27T09:00:00Z",
        start: "2027-03-28T01:20:00Z",
        arriveBy: "2027-03-28T00:50:00Z",
      },
    ];
    for (const c of cases) {
      const id = await t.f.shift({ startsAt: new Date(c.start), role: "steward" });
      await su.query("update shifts set site_id = $2 where id = $1", [id, t.siteId]);
      const look = recording();
      const dayBefore = { now: () => new Date(c.now) };
      expect(
        await fillEstimates(
          withFirm,
          t.f.firmId,
          { shiftIds: [id] },
          {
            provider: look.provider,
            clock: dayBefore,
          },
        ),
      ).toMatchObject({ searches: 2, saved: 2 });
      expect(look.searches.map((s) => s.arriveBy)).toEqual([
        new Date(c.arriveBy),
        new Date(c.arriveBy),
      ]);
    }
    expect((await t.estimates()).map((r) => [r.arrive_by.toISOString(), r.mode])).toEqual([
      ["2026-10-25T00:50:00.000Z", "car"],
      ["2026-10-25T00:50:00.000Z", "public_transport"],
      ["2027-03-28T00:50:00.000Z", "car"],
      ["2027-03-28T00:50:00.000Z", "public_transport"],
    ]);
  });

  it("estimates from another provider are searched again (the switch to the real one)", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    await t.fill({ shiftIds: [shiftId] }, fakeTravelProvider);
    const real = recording();
    const named: TravelProvider = { name: "traveltime", search: real.provider.search };
    expect(await t.fill({ shiftIds: [shiftId] }, named)).toMatchObject({ searches: 2, saved: 2 });
    expect((await t.estimates()).map((r) => r.provider)).toEqual(["traveltime", "traveltime"]);
  });

  it("out of time: what's done is saved, and the job queues the rest as a fresh run", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const [first, second] = [await t.session(48), await t.session(72)];
    const secondArrive = new Date(hoursFromNow(72).getTime() - 30 * 60_000).getTime();
    // Answers the first session's searches at once; never answers the second's.
    const slow = recording((s) =>
      s.arriveBy.getTime() === secondArrive
        ? new Promise(() => undefined)
        : fakeTravelProvider.search(s),
    );
    expect(await t.fill({ shiftIds: [first, second] }, slow.provider, 2_000)).toEqual({
      searches: 3,
      saved: 2,
      unavailable: false,
      more: true,
    });
    expect(await t.estimates()).toHaveLength(2);
    // The job: completes (it isn't the provider's fault), and queues the rest, 30 seconds later.
    await su.query("delete from travel_estimates where firm_id = $1", [t.f.firmId]);
    await t.clearQueued();
    const task = createTravelEstimatesTask(() => ({
      provider: slow.provider,
      clock,
      budgetMs: 2_000,
    }));
    const data = {
      firmId: t.f.firmId,
      idempotencyKey: "travel-estimates:t1",
      shiftIds: [first, second],
    };
    const result = await runFirmTask(task, { id: "j1", data }, withFirm, quietLogger);
    expect(result.status).toBe("completed");
    const jobs = await t.queued();
    expect(jobs.map((j) => j.data.shiftIds)).toEqual([[first, second]]);
    expect(jobs[0]?.delay).toBeCloseTo(30, 0);
  });

  it("out of time having saved nothing: no fresh run (it would only do the same again)", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const [first, second] = [await t.session(48), await t.session(72)];
    const secondArrive = new Date(hoursFromNow(72).getTime() - 30 * 60_000).getTime();
    // Leaves out every start point it's asked about for the first session (nothing to save), and
    // never answers for the second.
    const unhelpful = recording((s) =>
      s.arriveBy.getTime() === secondArrive
        ? new Promise(() => undefined)
        : Promise.resolve({ status: "ok", trips: new Map() }),
    );
    await t.clearQueued();
    const task = createTravelEstimatesTask(() => ({
      provider: unhelpful.provider,
      clock,
      budgetMs: 2_000,
    }));
    for (const data of [
      { firmId: t.f.firmId, idempotencyKey: "travel-estimates:t1", shiftIds: [first, second] },
      { firmId: t.f.firmId, idempotencyKey: "travel-estimates:t2", window: true },
    ]) {
      const result = await runFirmTask(task, { id: "j1", data }, withFirm, quietLogger);
      expect(result).toMatchObject({ status: "completed" });
    }
    expect(unhelpful.searches).toHaveLength(6); // each run: the first's two, then the second's car
    expect(await t.estimates()).toEqual([]);
    expect(await t.queued()).toEqual([]); // the nightly run has the rest
  });

  it("2,001 start points: two searches, 2,000 and 1", async () => {
    const t = await travelFirm();
    // 2,001 stewards, each with their own made-up postcode (as the app would save them).
    await su.query(
      `with w as (
         insert into workers (firm_id, first_name, last_name, mobile_e164, roles)
         select $1, 'Many', 'Steward' || i, '+447700' || lpad(i::text, 6, '0'), array['steward']
           from generate_series(1, 2001) i
         returning id, last_name)
       insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes, max_minutes,
                                  privacy_notice_version, updated_at)
       select $1, w.id,
              'ZZ' || (1 + (n / 260) % 99) || ' ' || (n / 26 % 10) || chr(65 + n % 26) || 'A',
              53.8 + n * 0.0001, -1.5, 'both', 45, 'travel-v1', now()
         from (select id, substring(last_name from 8)::int - 1 as n from w) w`,
      [t.f.firmId],
    );
    const shiftId = await t.session(48);
    const look = recording();
    expect(await t.fill({ shiftIds: [shiftId] }, look.provider)).toMatchObject({
      searches: 4,
      saved: 4002,
    });
    expect(look.searches.map((s) => [s.mode, s.from.length])).toEqual([
      ["car", 2000],
      ["car", 1],
      ["public_transport", 2000],
      ["public_transport", 1],
    ]);
    // Each search's ids are its own, and meaningless.
    expect(new Set(look.searches[0]?.from.map((o) => o.id)).size).toBe(2000);
    expect(look.searches[1]?.from.map((o) => o.id)).toEqual(["o1"]);
  }, 60_000);

  it("a site that moves while it's searched: nothing saved for it", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    const moving = recording(async (s) => {
      await su.query("update sites set lat = 54.2 where id = $1", [t.siteId]);
      return fakeTravelProvider.search(s);
    });
    expect(await t.fill({ shiftIds: [shiftId] }, moving.provider)).toMatchObject({ saved: 0 });
    expect(await t.estimates()).toEqual([]);
  });

  it("the provider down: it stops, saves nothing, the job fails (to be tried again), and the line falls back to the straight line", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    const down = recording(async () => ({ status: "unavailable" }));
    expect(await t.fill({ shiftIds: [shiftId] }, down.provider)).toEqual({
      searches: 1,
      saved: 0,
      unavailable: true,
      more: false,
    });
    expect(down.searches).toHaveLength(1); // no hammering: the rest aren't tried
    const task = createTravelEstimatesTask(() => ({ provider: down.provider, clock }));
    const result = await runFirmTask(
      task,
      {
        id: "j1",
        data: { firmId: t.f.firmId, idempotencyKey: "travel-estimates:t1", shiftIds: [shiftId] },
      },
      withFirm,
      quietLogger,
    );
    expect(result.status).toBe("failed");
    expect(await t.estimates()).toEqual([]);
    const facts = await withFirm(t.f.firmId, (tx) => travelFor(tx, ann, [shiftId]));
    expect(facts.get(shiftId)).toMatchObject({ kind: "straight" });
    expect(travelLineText(facts.get(shiftId) ?? { kind: "unknown" }, "Europe/London")).toBe(
      "about 2 miles (straight line) · Travel time not known yet",
    );
  });
});

describe("reading them", () => {
  it("worked out, not yet, no travel area, no site location", async () => {
    const t = await travelFirm();
    const [ann, ben] = [
      await t.f.worker({ first: "Ann", roles: ["steward"] }),
      await t.f.worker({ first: "Ben", roles: ["steward"] }),
    ];
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    const nowhere = await t.f.shift({ startsAt: hoursFromNow(50) }); // no site
    await t.fill({ shiftIds: [shiftId] }, fakeTravelProvider);
    const facts = await withFirm(t.f.firmId, (tx) => travelFor(tx, ann, [shiftId, nowhere]));
    expect(facts.get(nowhere)).toEqual({ kind: "unknown" });
    expect(travelLineText(facts.get(shiftId) ?? { kind: "unknown" }, "Europe/London")).toBe(
      "3.1 miles · 13 min by car · 27 min by public transport",
    );
    const bens = await withFirm(t.f.firmId, (tx) => travelFor(tx, ben, [shiftId]));
    expect(bens.get(shiftId)).toEqual({ kind: "unknown" }); // no travel area
  });
});

describe("before an urgent session's first wave", () => {
  it("one made with under 24 hours to go has its estimates before anyone is offered it", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    // Tonight, 19:00 (10 hours away), made by the office and marked urgent at once.
    const created = await createShifts(t.office(), {
      date: "2026-11-02",
      siteId: t.siteId,
      instructions: "",
      lines: [{ role: "steward", start: "19:00", end: "23:00", headcount: "1" }],
    });
    const shiftId = created.status === "created" ? (created.shiftIds[0] ?? "") : "";
    expect(
      await setShiftUrgent(
        withFirm,
        t.f.firmId,
        {
          shiftId,
          urgent: true,
          by: { type: "office", id: t.admin },
        },
        { clock },
      ),
    ).toEqual({ status: "marked" });
    // The travel job is queued for it, but the first wave doesn't wait for the job to run.
    expect(await t.queuedIds()).toContain(shiftId);
    const { transport, sent } = captureTransport();
    const atSend: number[] = [];
    const deps: OfferDeps = {
      transport: {
        name: "capture",
        async send(message) {
          atSend.push((await t.estimates()).length);
          return transport.send(message);
        },
      },
      push: {
        name: "none",
        async send() {
          return { status: "sent" };
        },
      },
      baseDomain: "localhost:3000",
      clock,
      travelBeforeFirstWave: (run, firmId, id) =>
        estimatesBeforeWave(run, firmId, id, { provider: fakeTravelProvider, clock }, quietLogger),
    };
    await runOfferWave(
      { firmId: t.f.firmId, idempotencyKey: "t:1", shiftId, wave: 1 },
      withFirm,
      deps,
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(atSend.every((n) => n === 2)).toBe(true);
  });

  it("a travel service that's down never holds the offers back", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(10);
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const { transport, sent } = captureTransport();
    const down: TravelProvider = { name: "fake", search: async () => ({ status: "unavailable" }) };
    const throwing: TravelProvider = {
      name: "fake",
      search: async () => {
        throw new Error("boom");
      },
    };
    for (const provider of [down, throwing]) {
      await runOfferWave(
        { firmId: t.f.firmId, idempotencyKey: `t:${provider === down ? 1 : 2}`, shiftId, wave: 1 },
        withFirm,
        {
          transport,
          push: {
            name: "none",
            async send() {
              return { status: "sent" };
            },
          },
          baseDomain: "localhost:3000",
          clock,
          travelBeforeFirstWave: (run, firmId, id) =>
            estimatesBeforeWave(run, firmId, id, { provider, clock }, quietLogger),
        },
      );
    }
    expect(sent.length).toBeGreaterThan(0);
  });

  it("a travel service that's slow: the wave waits at most its budget (5 seconds), and says so", async () => {
    expect(BEFORE_WAVE_BUDGET_MS).toBe(5_000);
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(10);
    const hanging: TravelProvider = { name: "fake", search: () => new Promise(() => undefined) };
    const lines: string[] = [];
    const started = Date.now();
    await estimatesBeforeWave(
      withFirm,
      t.f.firmId,
      shiftId,
      { provider: hanging, clock, budgetMs: 300 },
      createLogger({ write: (line) => lines.push(line) }),
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines.map((l) => JSON.parse(l) as { level: string; msg: string })).toEqual([
      expect.objectContaining({
        level: "warn",
        msg: "travel estimates before a wave not finished",
      }),
    ]);
  });

  it("a travel step that throws (even loading it) never holds the offers back", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(10);
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
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
      travelBeforeFirstWave: async () => {
        throw new Error("Cannot find module '../travel/estimates'");
      },
    });
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe("the job's queue", () => {
  it("the worker takes travel jobs one at a time (a batch shares one expiry)", async () => {
    const options = new Map<string, unknown>();
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string, opts: unknown) => {
        options.set(name, opts);
        return "id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(TRAVEL_WORK_OPTIONS).toEqual({ ...FIRM_WORK_OPTIONS, batchSize: 1 });
    expect(options.get(TRAVEL_ESTIMATES_QUEUE)).toEqual(TRAVEL_WORK_OPTIONS);
  });

  it("tries again after 5 minutes, backing off to an hour apart, 6 times; a run ends before its expiry", () => {
    expect(QUEUES.find((q) => q.name === TRAVEL_ESTIMATES_QUEUE)?.options).toMatchObject({
      policy: "standard",
      retryLimit: 6,
      retryDelay: 300,
      retryBackoff: true,
      retryDelayMax: 3600,
      expireInSeconds: TRAVEL_JOB_EXPIRE_SECONDS,
    });
    expect(TRAVEL_JOB_EXPIRE_SECONDS * 1000).toBeGreaterThan(
      TRAVEL_JOB_BUDGET_MS + TRAVELTIME_TIMEOUT_MS,
    );
  });
});

describe("the nightly run", () => {
  it("covers every session in the 28-day window, once a day", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    // The window's far edge: 27 days 23 hours is in (the open-shifts window), 29 days is out.
    const [tomorrow, day27, day28, day29] = [
      await t.session(24),
      await t.session(27 * 24),
      await t.session(28 * 24 - 1),
      await t.session(29 * 24),
    ];
    const tick = () =>
      runTravelEstimatesTick({
        listFirmIds: async () => [t.f.firmId],
        run: withFirm,
        clock,
        logger: quietLogger,
      });
    // Clear what the area's save queued: only the tick's job is run here.
    await su.query(
      "delete from pgboss.job where name = 'travel.estimates' and data ->> 'firmId' = $1",
      [t.f.firmId],
    );
    expect(await tick()).toBe(1);
    expect(await tick()).toBe(0); // the same day: nothing new
    const [job] = await t.queued();
    expect(job?.data).toMatchObject({ window: true });
    const task = createTravelEstimatesTask(() => ({ provider: fakeTravelProvider, clock }));
    expect(
      (await runFirmTask(task, { id: job?.id ?? "", data: job?.data }, withFirm, quietLogger))
        .status,
    ).toBe("completed");
    const days = new Set((await t.estimates()).map((r) => r.arrive_by.getTime()));
    const arrive = (h: number) => hoursFromNow(h).getTime() - 30 * 60_000;
    expect(days).toEqual(new Set([arrive(24), arrive(27 * 24), arrive(28 * 24 - 1)]));
    expect(days.has(arrive(29 * 24))).toBe(false);
    void tomorrow;
    void day27;
    void day28;
    void day29;
  });
});

describe("the purge", () => {
  it("deletes estimates 7 days after their last session, whatever a hold says", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    await t.fill({ shiftIds: [shiftId] }, fakeTravelProvider);
    await su.query(
      `update firms set settings = jsonb_set(settings, '{retention}', '{"hold_until":"2027-12-31"}')
        where id = $1`,
      [t.f.firmId],
    );
    // A day before they expire: kept. A day after: gone.
    const expiry = new Date(hoursFromNow(48 + 8 + 7 * 24).getTime());
    const before = await withFirm(t.f.firmId, (tx) =>
      purgeExpired(tx, new Date(expiry.getTime() - 24 * HOUR)),
    );
    expect(before.travelEstimates).toBe(0);
    const after = await withFirm(t.f.firmId, (tx) =>
      purgeExpired(tx, new Date(expiry.getTime() + 24 * HOUR)),
    );
    expect(after.travelEstimates).toBe(2);
    expect(await t.estimates()).toEqual([]);
  });
});

describe("what queues the job", () => {
  it("new shifts, the editor's move, the office's move, marking urgent, and a file import", async () => {
    const t = await travelFirm();
    const created = await createShifts(t.office(), {
      date: "2026-11-07",
      siteId: t.siteId,
      instructions: "",
      lines: [
        { role: "steward", start: "08:00", end: "16:00", headcount: "1" },
        { role: "steward", start: "09:00", end: "17:00", headcount: "1" },
      ],
    });
    const [a, b] = created.status === "created" ? created.shiftIds : [];
    expect(await t.queuedIds()).toEqual([a, b]);
    // The editor: new times (nobody booked).
    expect(
      await editShift(t.office(), a ?? "", {
        date: "2026-11-07",
        start: "10:00",
        end: "18:00",
        role: "steward",
        siteId: t.siteId,
        headcount: "1",
        instructions: "",
      }),
    ).toMatchObject({ status: "saved" });
    // The office's "Move" (and its reason).
    expect(
      await moveShiftByFirm(
        withFirm,
        t.f.firmId,
        {
          shiftId: b ?? "",
          date: "2026-11-08",
          start: "09:00",
          end: "17:00",
          siteId: t.siteId,
          reason: "event_changed",
          by: { type: "office", id: t.admin },
        },
        { clock },
      ),
    ).toMatchObject({ status: "moved" });
    expect(
      await setShiftUrgent(
        withFirm,
        t.f.firmId,
        {
          shiftId: a ?? "",
          urgent: true,
          by: { type: "office", id: t.admin },
        },
        { clock },
      ),
    ).toMatchObject({ status: expect.stringMatching(/^marked/) });
    expect(await t.queuedIds()).toEqual([a, b, a, b, a]);
    // Marked urgent: after the first wave's own fill, so the two don't search at once.
    expect((await t.queued()).at(-1)?.delay).toBeCloseTo(AFTER_WAVE_DELAY_SECONDS, 0);
    expect((await t.queued())[0]?.delay).toBeCloseTo(0, 0);
    // A file import: its new sessions, in one job with the import (none for a dry run).
    const rows = readTable(
      new TextEncoder().encode(
        "Date,Start,End,Site,Role\n09/11/2026,09:00,17:00,Riverside Arena,steward\n10/11/2026,09:00,17:00,Riverside Arena,steward",
      ),
    );
    const before = (await t.queued()).length;
    await withFirm(t.f.firmId, (tx) =>
      runImport(tx, {
        kind: "shifts",
        rows,
        dryRun: true,
        actorId: t.admin,
        timeZone: "Europe/London",
        now: NOW,
      }),
    );
    expect((await t.queued()).length).toBe(before);
    await withFirm(t.f.firmId, (tx) =>
      runImport(tx, {
        kind: "shifts",
        rows,
        dryRun: false,
        actorId: t.admin,
        timeZone: "Europe/London",
        now: NOW,
      }),
    );
    const jobs = await t.queued();
    expect(jobs).toHaveLength(before + 1);
    expect(jobs.at(-1)?.data.shiftIds).toHaveLength(2);
  });

  it("a site's postcode changing: its old estimates go, and its sessions get new ones", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB");
    const shiftId = await t.session(48);
    await t.session(30 * 24); // beyond the job's window: the nightly run's, later
    await t.fill({ shiftIds: [shiftId] }, fakeTravelProvider);
    expect(await t.estimates()).toHaveLength(2);
    await t.clearQueued();
    expect(
      await editSitePostcode({ ...t.office(), geocoder: fakeGeocoder }, t.siteId, {
        postcode: "ZZ9 9ZZ",
      }),
    ).toEqual({ status: "saved" });
    expect(await t.estimates()).toEqual([]);
    expect(await t.queuedIds()).toEqual([shiftId]);
  });

  it("casuals' new postcodes: one window run, 5 minutes later, shared by every change meanwhile", async () => {
    const t = await travelFirm();
    const [ann, ben] = [
      await t.f.worker({ first: "Ann", roles: ["steward"] }),
      await t.f.worker({ first: "Ben", roles: ["steward"] }),
    ];
    const [soon, later, other] = [
      await t.session(48, "steward"),
      await t.session(30 * 24, "steward"), // beyond the window
      await t.session(48, "coss"), // nobody's role
    ];
    const slot = async () =>
      (
        await su.query<{ slot: string }>(
          "select floor(extract(epoch from now()) / $1)::text as slot",
          [CASUAL_CHANGE_DELAY_SECONDS],
        )
      ).rows[0]?.slot;
    const before = await slot();
    await t.area(ann, "ZZ2 2BB");
    await t.area(ann, "ZZ3 3CC"); // changed her mind
    await t.area(ben, "ZZ4 4DD");
    const after = await slot();
    const jobs = await t.queued();
    // One per 5-minute slot (the three saves almost always fall in the same one).
    expect(jobs).toHaveLength(before === after ? 1 : 2);
    for (const j of jobs) {
      expect(j.data).toMatchObject({ window: true });
      expect(j.data.shiftIds).toBeUndefined();
      expect(j.delay).toBeCloseTo(CASUAL_CHANGE_DELAY_SECONDS, 0);
      expect(j.singleton_key).toBe(`${t.f.firmId}:travel-estimates-casuals`);
    }
    // The run: the latest postcodes, for the sessions in the window with their roles.
    const look = recording();
    const task = createTravelEstimatesTask(() => ({ provider: look.provider, clock }));
    const [job] = jobs;
    expect(
      (await runFirmTask(task, { id: job?.id ?? "", data: job?.data }, withFirm, quietLogger))
        .status,
    ).toBe("completed");
    const arrive = new Date(hoursFromNow(48).getTime() - 30 * 60_000);
    expect(look.searches.map((s) => [s.arriveBy, s.from.length])).toEqual([
      [arrive, 2],
      [arrive, 2],
    ]);
    expect(new Set((await t.estimates()).map((r) => r.origin_postcode))).toEqual(
      new Set(["ZZ3 3CC", "ZZ4 4DD"]),
    );
    void soon;
    void later;
    void other;
  });

  it("a casual's ways of travelling changing, same postcode: the shared run; the time limit alone: none", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.area(ann, "ZZ2 2BB"); // both ways, 45 minutes
    await t.clearQueued();
    const save = (modes: "car" | "both", maxMinutes: 45 | 60) =>
      saveMyTravel(
        { firm: { id: t.f.firmId }, run: withFirm, clock, geocoder: fakeGeocoder },
        ann,
        {
          postcode: "ZZ2 2BB",
          modes,
          maxMinutes,
        },
      );
    // The time limit only filters what she sees; the estimates don't change, so nothing queued.
    expect(await save("both", 60)).toEqual({ status: "saved" });
    expect(await t.queued()).toEqual([]);
    // Her ways of travelling alone: the same shared window run as a new postcode.
    expect(await save("car", 60)).toEqual({ status: "saved" });
    const jobs = await t.queued();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({ window: true });
    expect(jobs[0]?.data.shiftIds).toBeUndefined();
    expect(jobs[0]?.delay).toBeCloseTo(CASUAL_CHANGE_DELAY_SECONDS, 0);
    expect(jobs[0]?.singleton_key).toBe(`${t.f.firmId}:travel-estimates-casuals`);
  });
});

describe("each firm's own", () => {
  it("another firm's casuals are never searched from", async () => {
    const a = await travelFirm();
    const b = await travelFirm();
    const ann = await a.f.worker({ first: "Ann", roles: ["steward"] });
    const bea = await b.f.worker({ first: "Bea", roles: ["steward"] });
    await a.area(ann, "ZZ2 2BB");
    await b.area(bea, "ZZ9 9ZZ");
    const shiftId = await a.session(48);
    const look = recording();
    await a.fill({ shiftIds: [shiftId] }, look.provider);
    const points = look.searches.flatMap((s) => s.from.map((o) => o.point));
    expect(points).toEqual([fakePoint("ZZ2 2BB"), fakePoint("ZZ2 2BB")]);
    expect(await b.estimates()).toEqual([]);
    // Firm B's job, given firm A's session, finds nothing.
    expect(await b.fill({ shiftIds: [shiftId] }, look.provider)).toMatchObject({ searches: 0 });
  });
});
