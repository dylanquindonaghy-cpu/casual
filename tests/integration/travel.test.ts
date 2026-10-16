import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { editSitePostcode, officeSettingsPage } from "@/lib/office/settings-page";
import { siteLocationText } from "@/lib/office/settings-copy";
import { casualsList } from "@/lib/office/casuals";
import { changeWorkerStatus, workerAccessView } from "@/lib/office/worker-access";
import { myTravel, removeMyTravel, saveMyTravel, TRAVEL_NOTICE_VERSION } from "@/lib/portal/travel";
import { fakeGeocoder, type Geocoder } from "@/lib/travel/geocoder";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Postcode look-ups and the casual's travel area (12G.1; docs/office-v2.md 4.6, 5.4; S8) on the
// real database, as the app role: saving (looked up first, with the fake geocoder: never the
// network), what the office sees (the district only), deletion on "They've left" and erasure, site
// locations on Settings, and each firm's own. NOW is Monday 2 November 2026, 09:00 London.

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

// A geocoder that says what it was asked, and answers like the fake (or as told).
function recording(answer?: Awaited<ReturnType<Geocoder["locate"]>>) {
  const asked: string[] = [];
  const geocoder: Geocoder = {
    async locate(postcode) {
      asked.push(postcode);
      return answer ?? fakeGeocoder.locate(postcode);
    },
  };
  return { asked, geocoder };
}

// Travel areas on (13.4: a firm's are off until its owner switches them on), with any other
// settings.
async function travelFirm(settings: Record<string, unknown> = {}) {
  const travel = { enabled: true, ...(settings.travel as Record<string, unknown> | undefined) };
  const f = await bookingFirm(su, withFirm, { settings: { ...settings, travel } });
  const admin = await f.office("admin");
  const portal = (geocoder: Geocoder = fakeGeocoder) => ({
    firm: { id: f.firmId },
    run: withFirm,
    clock,
    geocoder,
  });
  const office = (officeUserId: string, geocoder: Geocoder = fakeGeocoder) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
    geocoder,
  });
  const row = async (workerId: string) =>
    (
      await su.query<{
        start_postcode: string;
        lat: string;
        lng: string;
        modes: string;
        max_minutes: number;
        privacy_notice_version: string;
        updated_at: Date;
      }>(
        `select start_postcode, lat::text, lng::text, modes, max_minutes, privacy_notice_version,
                updated_at
           from worker_travel where worker_id = $1`,
        [workerId],
      )
    ).rows[0];
  const logged = async (action: string) =>
    (
      await su.query<{ actor_type: string; actor_id: string; data: Record<string, unknown> }>(
        `select actor_type, actor_id::text, data from events
          where firm_id = $1 and action = $2 order by id`,
        [f.firmId, action],
      )
    ).rows;
  const everything = async () =>
    JSON.stringify(
      (await su.query("select action, data from events where firm_id = $1", [f.firmId])).rows,
    );
  return { f, admin, portal, office, row, logged, everything };
}

const area = { postcode: "zz1 1aa", modes: "both", maxMinutes: 45 } as const;

describe("saving a travel area", () => {
  it("looks the postcode up, saves it with its point, and logs what changed without it", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const look = recording();
    expect(await saveMyTravel(t.portal(look.geocoder), ann, area)).toEqual({ status: "saved" });
    // Only the postcode goes to the look-up.
    expect(look.asked).toEqual(["ZZ1 1AA"]);
    expect(await t.row(ann)).toMatchObject({
      start_postcode: "ZZ1 1AA",
      lat: "53.833000",
      lng: "-1.532000",
      modes: "both",
      max_minutes: 45,
      privacy_notice_version: TRAVEL_NOTICE_VERSION,
      updated_at: NOW,
    });
    expect(await t.logged("travel.profile_changed")).toEqual([
      {
        actor_type: "worker",
        actor_id: ann,
        data: { changed: ["postcode", "modes", "maxMinutes"], maxMinutes: 45 },
      },
    ]);
    expect(await myTravel(t.portal(), ann)).toEqual({
      set: true,
      postcode: "ZZ1 1AA",
      modes: "both",
      maxMinutes: 45,
    });

    // Only how they travel and the limit: no look-up.
    const again = recording();
    expect(
      await saveMyTravel(t.portal(again.geocoder), ann, { ...area, modes: "car", maxMinutes: 60 }),
    ).toEqual({ status: "saved" });
    expect(again.asked).toEqual([]);
    expect(await t.row(ann)).toMatchObject({ lat: "53.833000", modes: "car", max_minutes: 60 });
    // Nothing new: nothing logged.
    expect(
      await saveMyTravel(t.portal(again.geocoder), ann, { ...area, modes: "car", maxMinutes: 60 }),
    ).toEqual({ status: "unchanged" });
    // A new postcode: looked up again.
    expect(
      await saveMyTravel(t.portal(), ann, { postcode: "ZZ2 2BB", modes: "car", maxMinutes: 60 }),
    ).toEqual({ status: "saved" });
    expect(await t.row(ann)).toMatchObject({ start_postcode: "ZZ2 2BB", lat: "53.866270" });
    expect((await t.logged("travel.profile_changed")).map((e) => e.data)).toEqual([
      { changed: ["postcode", "modes", "maxMinutes"], maxMinutes: 45 },
      { changed: ["modes", "maxMinutes"], maxMinutes: 60 },
      { changed: ["postcode"], maxMinutes: 60 },
    ]);
    // The postcode and its point never reach the log.
    const log = await t.everything();
    for (const secret of ["ZZ1", "ZZ2", "53.8", "1.53"]) expect(log).not.toContain(secret);
  });

  it("an unknown postcode, a look-up that fails, or a bad answer: nothing saved", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    expect(await saveMyTravel(t.portal(), ann, { ...area, postcode: "ZZ0 0AA" })).toEqual({
      status: "unknown_postcode",
    });
    expect(
      await saveMyTravel(t.portal(recording({ status: "unavailable" }).geocoder), ann, area),
    ).toEqual({ status: "lookup_failed" });
    // The fake, given a real postcode: look-ups aren't switched on, and it says so.
    expect(await saveMyTravel(t.portal(), ann, { ...area, postcode: "LS1 4AP" })).toEqual({
      status: "lookups_off",
    });
    for (const bad of [
      { ...area, postcode: "not one" },
      { ...area, postcode: "" },
      { ...area, modes: "bike" },
      { ...area, maxMinutes: 50 },
      { ...area, maxMinutes: "45" },
      { ...area, extra: true },
      null,
    ]) {
      expect(await saveMyTravel(t.portal(), ann, bad), JSON.stringify(bad)).toEqual({
        status: "invalid",
      });
    }
    expect(await t.row(ann)).toBeUndefined();
    expect(await t.logged("travel.profile_changed")).toEqual([]);
  });

  it("before one is saved: the firm's default limit", async () => {
    const t = await travelFirm({ travel: { default_max_minutes: 60 } });
    const ann = await t.f.worker({ first: "Ann" });
    expect(await myTravel(t.portal(), ann)).toEqual({
      set: false,
      postcode: null,
      modes: "both",
      maxMinutes: 60,
    });
    const plain = await travelFirm();
    expect((await myTravel(plain.portal(), await plain.f.worker()))?.maxMinutes).toBe(45);
  });

  it("removed by the casual (logged); only an active casual's is saved", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    await saveMyTravel(t.portal(), ann, area);
    expect(await removeMyTravel(t.portal(), ann)).toEqual({ status: "removed" });
    expect(await t.row(ann)).toBeUndefined();
    expect(await removeMyTravel(t.portal(), ann)).toEqual({ status: "not_set" });
    expect(await t.logged("travel.profile_removed")).toEqual([
      { actor_type: "worker", actor_id: ann, data: {} },
    ]);
    for (const status of ["inactive", "blocked"] as const) {
      const w = await t.f.worker({ first: status, status });
      const look = recording();
      expect(await saveMyTravel(t.portal(look.geocoder), w, area)).toEqual({
        status: "not_active",
      });
      expect(look.asked).toEqual([]); // no look-up for them at all
      expect(await t.row(w)).toBeUndefined();
    }
  });
});

describe("travel areas switched off for the firm (13.4)", () => {
  it("no Where you work; saving does nothing (no look-up); removing still works; the office sees none", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    expect(await saveMyTravel(t.portal(), ann, area)).toEqual({ status: "saved" });
    const saved = await t.row(ann);
    const office = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    expect((await casualsList(office, "all"))?.travelOn).toBe(true);

    await su.query(
      `update firms set settings = jsonb_set(settings, '{travel,enabled}', 'false') where id = $1`,
      [t.f.firmId],
    );
    expect(await myTravel(t.portal(), ann)).toBeNull();
    const look = recording();
    expect(
      await saveMyTravel(t.portal(look.geocoder), ann, { ...area, postcode: "ZZ2 2BB" }),
    ).toEqual({ status: "off" });
    expect(look.asked).toEqual([]);
    expect(await t.row(ann)).toEqual(saved);
    expect(await t.logged("travel.profile_changed")).toHaveLength(1);
    // The office: no travel area column or card, and nothing of it read.
    const list = await casualsList(office, "all");
    expect(list?.travelOn).toBe(false);
    expect(list?.rows.map((r) => r.travel)).toEqual([null]);
    expect(await workerAccessView(office, ann)).toMatchObject({ travelOn: false, travel: null });
    // Their own data: removing it always works.
    expect(await removeMyTravel(t.portal(), ann)).toEqual({ status: "removed" });
    expect(await t.row(ann)).toBeUndefined();
  });
});

describe("what the office sees", () => {
  it("the district, the limit and how they travel: never the postcode or its point", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    expect((await workerAccessView(ctx, ann))?.travel).toBeNull();
    await saveMyTravel(t.portal(), ann, { postcode: "ZZ10 3BD", modes: "car", maxMinutes: 90 });
    const view = await workerAccessView(ctx, ann);
    expect(view?.travel).toEqual({ district: "ZZ10", maxMinutes: 90, modes: "car" });
    const all = JSON.stringify(view);
    expect(all).not.toContain("3BD");
    expect(all).not.toMatch(/"lat"|"lng"|54\.1/);
  });
});

describe("deleting it", () => {
  it(`goes when the office makes them inactive as "They've left"; any other reason keeps it`, async () => {
    const t = await travelFirm();
    const [ann, ben] = [await t.f.worker({ first: "Ann" }), await t.f.worker({ first: "Ben" })];
    await saveMyTravel(t.portal(), ann, area);
    await saveMyTravel(t.portal(), ben, area);
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    expect(
      await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" }),
    ).toMatchObject({ status: "done" });
    expect(
      await changeWorkerStatus(ctx, ben, { kind: "deactivate", reason: "paused" }),
    ).toMatchObject({ status: "done" });
    expect(await t.row(ann)).toBeUndefined();
    expect(await t.row(ben)).toBeDefined();
    const entries = await t.logged("worker.deactivated");
    expect(entries.find((e) => e.data.workerId === ann)?.data).toMatchObject({
      reason: "left",
      travelAreaRemoved: true,
    });
    expect(entries.find((e) => e.data.workerId === ben)?.data).not.toHaveProperty(
      "travelAreaRemoved",
    );
  });

  it("goes when they're erased, and erasure still leaves only the anonymous row", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    await saveMyTravel(t.portal(), ann, area);
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    expect(await eraseWorker(ctx, ann)).toMatchObject({
      status: "erased",
      counts: { travelArea: 1 },
    });
    expect(await t.row(ann)).toBeUndefined();
    // Saving afterwards is refused: nothing comes back.
    expect(await saveMyTravel(t.portal(), ann, area)).toEqual({ status: "not_active" });
    expect(await t.row(ann)).toBeUndefined();
  });

  // A save whose look-up is still out when the erasure or "They've left" commits: it must not
  // bring the area back. The look-up is held until the other has finished.
  function heldLookUp() {
    let release: () => void = () => undefined;
    const go = new Promise<void>((resolve) => (release = resolve));
    let asked: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => (asked = resolve));
    const geocoder: Geocoder = {
      async locate(postcode) {
        asked();
        await go;
        return fakeGeocoder.locate(postcode);
      },
    };
    return { geocoder, waiting, release };
  }

  it("an erasure while a save is looking up: the area never comes back", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    await saveMyTravel(t.portal(), ann, area);
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    const held = heldLookUp();
    const saving = saveMyTravel(t.portal(held.geocoder), ann, {
      postcode: "ZZ3 3CC",
      modes: "car",
      maxMinutes: 30,
    });
    await held.waiting;
    expect(await eraseWorker(ctx, ann)).toMatchObject({ status: "erased" });
    held.release();
    expect(await saving).toEqual({ status: "not_active" });
    expect(await t.row(ann)).toBeUndefined();
  });

  it(`"They've left" while a save is looking up: the area never comes back`, async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    await saveMyTravel(t.portal(), ann, area);
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    const held = heldLookUp();
    const saving = saveMyTravel(t.portal(held.geocoder), ann, {
      postcode: "ZZ3 3CC",
      modes: "car",
      maxMinutes: 30,
    });
    await held.waiting;
    expect(
      await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" }),
    ).toMatchObject({ status: "done" });
    held.release();
    expect(await saving).toEqual({ status: "not_active" });
    expect(await t.row(ann)).toBeUndefined();
  });

  it("an erasure and a save at once: the area never outlives the erasure", async () => {
    const t = await travelFirm();
    const ann = await t.f.worker({ first: "Ann" });
    await saveMyTravel(t.portal(), ann, area);
    const ctx = { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock };
    const [erased, saved] = await Promise.all([
      eraseWorker(ctx, ann),
      saveMyTravel(t.portal(), ann, { postcode: "ZZ3 3CC", modes: "car", maxMinutes: 30 }),
    ]);
    expect(erased).toMatchObject({ status: "erased" });
    expect(["saved", "not_active"]).toContain(saved.status);
    expect(await t.row(ann)).toBeUndefined();
  });

  it("the erased-worker check is unchanged: workers has no travel columns", async () => {
    const { rows } = await su.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'workers'`,
    );
    const columns = rows.map((r) => r.column_name);
    for (const c of ["start_postcode", "lat", "lng", "modes", "max_minutes"]) {
      expect(columns).not.toContain(c);
    }
    const { rows: check } = await su.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'workers_erased'`,
    );
    expect(check[0]?.def).not.toMatch(/travel|postcode/);
  });
});

describe("each firm's own", () => {
  it("another firm can't read, save, remove or see a casual's travel area", async () => {
    const a = await travelFirm();
    const b = await travelFirm();
    const ann = await a.f.worker({ first: "Ann" });
    await saveMyTravel(a.portal(), ann, area);
    expect((await myTravel(b.portal(), ann))?.set).toBe(false);
    expect(await saveMyTravel(b.portal(), ann, { ...area, maxMinutes: 90 })).toEqual({
      status: "not_active",
    });
    expect(await removeMyTravel(b.portal(), ann)).toEqual({ status: "not_active" });
    const bCtx = { firm: { id: b.f.firmId }, officeUserId: b.admin, run: withFirm, clock };
    expect(await workerAccessView(bCtx, ann)).toBeNull();
    expect(await a.row(ann)).toMatchObject({ max_minutes: 45 });
    // As the app role, inside firm B: no rows of firm A's.
    const seen = await withFirm(b.f.firmId, (tx) =>
      tx.execute<{ n: number }>("select count(*)::int as n from worker_travel"),
    );
    expect(Number(seen.rows[0]?.n)).toBe(0);
  });
});

describe("site locations on Settings", () => {
  async function siteFirm() {
    const t = await travelFirm();
    const { rows } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
      [t.f.firmId],
    );
    return { ...t, siteId: rows[0]?.id ?? "" };
  }
  const siteRow = async (siteId: string) =>
    (
      await su.query<{ postcode: string | null; lat: string | null; lng: string | null }>(
        "select postcode, lat::text, lng::text from sites where id = $1",
        [siteId],
      )
    ).rows[0];

  it("a postcode is looked up and saved with its point; one it can't find saves nothing", async () => {
    const t = await siteFirm();
    const look = recording();
    expect(
      await editSitePostcode(t.office(t.admin, look.geocoder), t.siteId, { postcode: "zz9 9zz" }),
    ).toEqual({ status: "saved" });
    expect(look.asked).toEqual(["ZZ9 9ZZ"]);
    expect(await siteRow(t.siteId)).toEqual({
      postcode: "ZZ9 9ZZ",
      lat: "54.103750",
      lng: "-1.381250",
    });
    for (const [geocoder, status] of [
      [fakeGeocoder, "unknown_postcode"],
      [recording({ status: "unavailable" }).geocoder, "lookup_failed"],
    ] as const) {
      expect(
        await editSitePostcode(t.office(t.admin, geocoder), t.siteId, { postcode: "ZZ0 0AA" }),
      ).toEqual({ status });
    }
    expect((await siteRow(t.siteId))?.postcode).toBe("ZZ9 9ZZ");
    // Cleared: its point goes too.
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "" })).toEqual({
      status: "saved",
    });
    expect(await siteRow(t.siteId)).toEqual({ postcode: null, lat: null, lng: null });
    expect((await t.logged("site.changed")).map((e) => e.data)).toEqual([
      { siteId: t.siteId, fields: ["postcode"] },
      { siteId: t.siteId, fields: ["postcode"] },
    ]);
  });

  it("look-ups off (the fake, a real postcode): the postcode is still saved, without a point", async () => {
    const t = await siteFirm();
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ls1 4ap" })).toEqual({
      status: "saved_unlocated",
    });
    expect(await siteRow(t.siteId)).toEqual({ postcode: "LS1 4AP", lat: null, lng: null });
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "LS1 4AP" })).toEqual({
      status: "lookups_off",
    });
    expect((await t.logged("site.changed")).map((e) => e.data)).toEqual([
      { siteId: t.siteId, fields: ["postcode"] },
    ]);
  });

  it("the same postcode with no point yet: saving it again finds the point", async () => {
    const t = await siteFirm();
    await su.query("update sites set postcode = 'ZZ1 1AA' where id = $1", [t.siteId]);
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ1 1AA" })).toEqual({
      status: "located",
    });
    expect(await siteRow(t.siteId)).toEqual({
      postcode: "ZZ1 1AA",
      lat: "53.833000",
      lng: "-1.532000",
    });
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ1 1AA" })).toEqual({
      status: "unchanged",
    });
    expect((await t.logged("site.changed")).map((e) => e.data)).toEqual([
      { siteId: t.siteId, fields: ["location"] },
    ]);
    expect(await t.everything()).not.toContain("ZZ1");
  });

  it("a site added by a file import has no postcode: Settings says so, and finds it once added", async () => {
    const t = await siteFirm();
    await withFirm(t.f.firmId, (tx) =>
      runImport(tx, {
        kind: "shifts",
        rows: readTable(
          new TextEncoder().encode(
            "Date,Start,End,Site,Role\n07/11/2026,09:00,17:00,Northgate Park,steward",
          ),
        ),
        dryRun: false,
        actorId: t.admin,
        timeZone: "Europe/London",
        now: NOW,
      }),
    );
    const { token } = await withFirm(t.f.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: t.admin, now: NOW }),
    );
    const read = () =>
      officeSettingsPage({ firm: { id: t.f.firmId }, run: withFirm, clock }, token);
    const park = (await read())?.sites.find((s) => s.name === "Northgate Park");
    expect(park).toMatchObject({ postcode: null, located: false });
    expect(park && siteLocationText(park)).toBe(
      "No postcode yet, so distances to this site can't be worked out.",
    );
    expect(
      await editSitePostcode(t.office(t.admin), park?.siteId ?? "", { postcode: "ZZ4 4DD" }),
    ).toEqual({ status: "saved" });
    expect((await read())?.sites.find((s) => s.name === "Northgate Park")).toMatchObject({
      postcode: "ZZ4 4DD",
      located: true,
    });
  });
});
