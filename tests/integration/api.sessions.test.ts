import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { ApiDeps } from "@/lib/integrations/api";
import { getSessionRequest, putSessionRequest } from "@/lib/integrations/sessions";
import { FIRM_CHANGE_NOTICE_QUEUE } from "@/lib/notices/firm-change";
import { fakePoint, type Geocoder } from "@/lib/travel/geocoder";
import { TRAVEL_ESTIMATES_QUEUE } from "@/lib/travel/estimate-queue";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { answer, apiDeps, apiRequest, plannerKey } from "../helpers/planner-api";

// PUT and GET /api/v1/sessions/{ref} (docs/office-v2.md 5.3.2; 12J.1) on the real database, as the
// app role, through handleApiRequest() as the route calls it. NOW is Monday 2 November 2026,
// 09:00 London (GMT, so London is UTC); sessions are on Saturday 7 November.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let resolveKey: ReturnType<typeof createKeyDirectory>;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(8);
  withFirm = createWithFirm(app);
  resolveKey = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

type Body = Record<string, unknown>;
type Session = Body & { id: string; places: number; status: string };
type Answer = {
  result?: string;
  session?: Session | null;
  casuals_told?: number;
  bookings?: Body[];
  error?: { code: string; message: string; request_id: string; casuals?: unknown };
};

// A firm with an admin and a planner key; its PUTs and GETs at `now` (NOW unless moved on).
async function plannerFirm(o: { localDatabase?: boolean; geocoder?: Geocoder } = {}) {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const key = await plannerKey(su, f.firmId, admin);
  let now = NOW;
  const deps: ApiDeps = apiDeps({
    run: withFirm,
    resolveKey,
    now: () => now,
    ...o,
  });
  const put = async (ref: string, body: unknown, k = key.key) =>
    answer<Answer>(
      await putSessionRequest(
        apiRequest("PUT", `/api/v1/sessions/${ref}`, { key: k, body }),
        ref,
        deps,
      ),
    );
  const get = async (ref: string, k = key.key) =>
    answer<Answer>(
      await getSessionRequest(apiRequest("GET", `/api/v1/sessions/${ref}`, { key: k }), ref, deps),
    );
  const at = (when: Date) => {
    now = when;
  };
  return { f, admin, key, deps, put, get, at };
}

const RACEDAY = {
  event: { ref: "RACEDAY-2026", name: "Raceday" },
  site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
  role: "steward",
  starts_at: "2026-11-07T10:30:00+01:00",
  ends_at: "2026-11-07T18:30:00+01:00",
  places: 6,
  status: "open",
  pay_rate_pence: 1260,
  post: "Gate B",
  meeting_point: "Staff entrance, Gate B",
  uniform: "Black trousers, boots. Hi-vis provided.",
  requirements: ["STEWARD_L2"],
  instructions: "Ask for the steward lead on arrival.",
};

// A plain session: steward, Saturday 08:00 to 16:00 at the arena.
const plain = (o: Body = {}) => ({
  site: { name: "Riverside Arena" },
  role: "steward",
  starts_at: "2026-11-07T08:00:00Z",
  ends_at: "2026-11-07T16:00:00Z",
  places: 2,
  ...o,
});

const eventsOf = async (firmId: string, like = "%") =>
  (
    await su.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      entity_id: string | null;
      data: Body;
    }>(
      `select action, actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by id`,
      [firmId, like],
    )
  ).rows;

const jobsFor = async (queue: string, firmId: string) =>
  (
    await su.query<{ data: Body }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
      [queue, firmId],
    )
  ).rows.map((r) => r.data);

const count = async (sql: string, params: unknown[]) =>
  Number(Object.values((await su.query(sql, params)).rows[0] ?? {})[0] ?? Number.NaN);

// Everything about a session and its bookings that a refused change must leave alone.
const snapshot = async (shiftId: string) => ({
  shift: (
    await su.query(
      `select starts_at, ends_at, site_id, status, headcount, role, pay_rate_pence, post,
              required_credentials, event_id
         from shifts where id = $1`,
      [shiftId],
    )
  ).rows[0],
  bookings: (
    await su.query(
      `select id, slot, worker_id, status, cancel_via from assignments
        where shift_id = $1 order by slot, id`,
      [shiftId],
    )
  ).rows,
});

// A casual booked on a session in a place, straight into the table (as an earlier booking).
async function booked(
  t: Awaited<ReturnType<typeof plannerFirm>>,
  shiftId: string,
  slot: number,
  first = "Ann",
) {
  const worker = await t.f.worker({ first });
  const booking = await t.f.booking(worker, shiftId, "confirmed", slot);
  return { worker, booking };
}

describe("PUT /sessions/{ref}: create, update, unchanged", () => {
  it("creates the session with its event and site (201), logged as the planner's, travel queued", async () => {
    const t = await plannerFirm();
    const created = await t.put("RACEDAY-STW-0710", RACEDAY);
    expect(created.status).toBe(201);
    expect(created.body.result).toBe("created");
    const session = created.body.session;
    expect(session).toEqual({
      id: expect.any(String),
      ref: "RACEDAY-STW-0710",
      source: "api",
      event: { id: expect.any(String), ref: "RACEDAY-2026", name: "Raceday" },
      site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
      role: "steward",
      starts_at: "2026-11-07T09:30:00Z",
      ends_at: "2026-11-07T17:30:00Z",
      status: "open",
      places: 6,
      booked: 0,
      pay_rate_pence: 1260,
      post: "Gate B",
      meeting_point: "Staff entrance, Gate B",
      uniform: "Black trousers, boots. Hi-vis provided.",
      requirements: ["STEWARD_L2"],
      instructions: "Ask for the steward lead on arrival.",
    });
    const id = session?.id ?? "";
    // The site's point from the (fake) look-up; showing and urgent are the office's defaults.
    const point = fakePoint("ZZ9 9ZZ");
    const { rows: site } = await su.query(
      "select lat::float8 as lat, lng::float8 as lng from sites where firm_id = $1 and name = $2",
      [t.f.firmId, "Acme Demo Racecourse"],
    );
    expect(site).toEqual([{ lat: point?.lat, lng: point?.lng }]);
    const { rows: shift } = await su.query(
      "select source, external_ref, showing_to_casuals, is_urgent from shifts where id = $1",
      [id],
    );
    expect(shift).toEqual([
      {
        source: "api",
        external_ref: "RACEDAY-STW-0710",
        showing_to_casuals: true,
        is_urgent: false,
      },
    ]);
    const marks = { by: "firm", via: "api", keyId: t.key.id };
    expect(
      (await eventsOf(t.f.firmId)).filter((e) => e.action !== "credential_pack.applied"),
    ).toEqual([
      {
        action: "site.created",
        actor_type: "system",
        actor_id: null,
        entity_id: expect.any(String),
        data: marks,
      },
      {
        action: "site.changed",
        actor_type: "system",
        actor_id: null,
        entity_id: expect.any(String),
        data: { ...marks, siteId: expect.any(String), fields: ["postcode"] },
      },
      { action: "shift.created", actor_type: "system", actor_id: null, entity_id: id, data: marks },
    ]);
    const travel = await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId);
    expect(travel.some((j) => Array.isArray(j.shiftIds) && j.shiftIds.includes(id))).toBe(true);
  });

  it("the same PUT again is 200 unchanged and logs nothing; a changed field is applied and logged", async () => {
    const t = await plannerFirm();
    const id = (await t.put("RACEDAY-STW-0710", RACEDAY)).body.session?.id;
    const logged = (await eventsOf(t.f.firmId)).length;
    const again = await t.put("RACEDAY-STW-0710", RACEDAY);
    expect(again.status).toBe(200);
    expect(again.body.result).toBe("unchanged");
    expect(again.body.session?.id).toBe(id);
    expect((await eventsOf(t.f.firmId)).length).toBe(logged);
    // Fields left out stay as they are.
    expect((await t.put("RACEDAY-STW-0710", { places: 6 })).body.result).toBe("unchanged");

    const changed = await t.put("RACEDAY-STW-0710", {
      ...RACEDAY,
      places: 8,
      pay_rate_pence: 1300,
      post: null,
      event: { ref: "RACEDAY-2026", name: "Raceday (Saturday)" },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.result).toBe("updated");
    expect(changed.body.session).toMatchObject({
      places: 8,
      pay_rate_pence: 1300,
      post: null,
      event: { ref: "RACEDAY-2026", name: "Raceday (Saturday)" },
    });
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data)).toEqual([
      {
        by: "firm",
        via: "api",
        keyId: t.key.id,
        fields: ["headcount", "payRatePence", "post", "eventName"],
      },
    ]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(1);
  });

  it("without an event the session joins its site and day's automatic event; null puts it back there", async () => {
    const t = await plannerFirm();
    const first = await t.put("S-1", plain());
    expect(first.body.session?.event).toEqual({
      id: expect.any(String),
      ref: null,
      name: "Riverside Arena · Sat 7 Nov",
    });
    const second = await t.put("S-2", plain());
    expect(second.body.session?.event).toEqual(first.body.session?.event);
    const moved = await t.put("S-1", { event: { ref: "GALA", name: "Gala" } });
    expect(moved.body.session?.event).toMatchObject({ ref: "GALA", name: "Gala" });
    const back = await t.put("S-1", { event: null });
    expect(back.body.session?.event).toEqual(first.body.session?.event);
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data.fields)).toEqual([
      ["event"],
      ["event"],
    ]);
  });

  it("an unknown role is 422 unknown_role and creates nothing: no session, site or event", async () => {
    const t = await plannerFirm();
    const refused = await t.put("S-1", {
      ...plain({ role: "Steward Lead" }),
      site: { name: "Brand New Ground", postcode: "ZZ3 3CC" },
      event: { ref: "NEW-EVENT", name: "New" },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe("unknown_role");
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(await count("select count(*) from sites where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(await count("select count(*) from shift_events where firm_id = $1", [t.f.firmId])).toBe(
      0,
    );
    // "Door supervisor" is read as the firm's door_supervisor.
    const ok = await t.put("S-2", plain({ role: "Door supervisor" }));
    expect(ok.status).toBe(201);
    expect(ok.body.session?.role).toBe("door_supervisor");
    // An unknown qualification code: 422 unknown_requirement.
    const req = await t.put("S-3", plain({ requirements: ["NOT_A_CODE"] }));
    expect([req.status, req.body.error?.code]).toEqual([422, "unknown_requirement"]);
  });

  it("a new session needs a role, times and a site, a finish after its start, and a start still ahead", async () => {
    const t = await plannerFirm();
    const missing = await t.put("S-1", { places: 2 });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({
      code: "validation_failed",
      fields: [
        { path: "role", code: "required" },
        { path: "starts_at", code: "required" },
        { path: "ends_at", code: "required" },
        { path: "site", code: "required" },
      ],
    });
    const backwards = await t.put("S-1", plain({ ends_at: "2026-11-07T07:00:00Z" }));
    expect(backwards.body.error).toMatchObject({
      code: "validation_failed",
      fields: [{ path: "ends_at", code: "not_after_start" }],
    });
    const past = await t.put(
      "S-1",
      plain({ starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T16:00:00Z" }),
    );
    expect([past.status, past.body.error?.code]).toEqual([409, "session_started"]);
    // A cancellation of a ref ShiftDesk never had: 200 unchanged, nothing made.
    const cancelled = await t.put(
      "S-1",
      plain({ status: "cancelled", change_reason: "event_cancelled" }),
    );
    expect([cancelled.status, cancelled.body.result, cancelled.body.session]).toEqual([
      200,
      "unchanged",
      null,
    ]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(await count("select count(*) from sites where firm_id = $1", [t.f.firmId])).toBe(0);
  });
});

describe("a site's postcode", () => {
  it("only fills a site that has none: a different one is 409 site_postcode_differs and changes nothing", async () => {
    const t = await plannerFirm();
    await su.query(
      "insert into sites (firm_id, name, postcode) values ($1, 'Old Arena', 'ZZ1 1AA')",
      [t.f.firmId],
    );
    const refused = await t.put("S-1", plain({ site: { name: "Old Arena", postcode: "ZZ2 2BB" } }));
    expect([refused.status, refused.body.error?.code]).toEqual([409, "site_postcode_differs"]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
    const { rows } = await su.query("select postcode from sites where firm_id = $1", [t.f.firmId]);
    expect(rows).toEqual([{ postcode: "ZZ1 1AA" }]);
    // The same postcode, in any spacing, is fine; and so is none.
    expect(
      (await t.put("S-1", plain({ site: { name: "Old Arena", postcode: "zz11aa" } }))).status,
    ).toBe(201);
    expect((await t.put("S-2", plain({ site: { name: "Old Arena" } }))).status).toBe(201);
    expect(await eventsOf(t.f.firmId, "site.%")).toEqual([]);
  });

  it("fills a site with none, with its point, and queues travel estimates for its sessions", async () => {
    const t = await plannerFirm();
    const first = await t.put("S-1", plain());
    expect(first.body.session?.site).toEqual({ name: "Riverside Arena", postcode: null });
    const before = (await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId)).length;
    const filled = await t.put(
      "S-2",
      plain({ site: { name: "Riverside Arena", postcode: "ZZ4 4DD" } }),
    );
    expect(filled.status).toBe(201);
    const { rows } = await su.query(
      "select id::text, postcode, lat::float8 as lat from sites where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { id: expect.any(String), postcode: "ZZ4 4DD", lat: fakePoint("ZZ4 4DD")?.lat },
    ]);
    expect((await eventsOf(t.f.firmId, "site.changed")).map((e) => e.data)).toEqual([
      { by: "firm", via: "api", keyId: t.key.id, siteId: rows[0]?.id, fields: ["postcode"] },
    ]);
    // The first session there gets its estimates now (siteMoved), the new one its own.
    const jobs = (await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId)).slice(before);
    const queued = jobs.flatMap((j) => (Array.isArray(j.shiftIds) ? j.shiftIds : []));
    expect(queued).toEqual(
      expect.arrayContaining([first.body.session?.id, filled.body.session?.id]),
    );
  });

  it("an unknown postcode is 422 and a failed look-up 503, saving nothing; with look-ups off it's saved without a point", async () => {
    const t = await plannerFirm();
    const unknown = await t.put("S-1", plain({ site: { name: "Arena", postcode: "ZZ0 1AA" } }));
    expect([unknown.status, unknown.body.error?.code]).toEqual([422, "unknown_postcode"]);
    const down: Geocoder = { locate: async () => ({ status: "unavailable" }) };
    const t2 = await plannerFirm({ geocoder: down });
    const failed = await t2.put("S-1", plain({ site: { name: "Arena", postcode: "ZZ5 5EE" } }));
    expect([failed.status, failed.body.error?.code]).toEqual([503, "lookup_failed"]);
    for (const firm of [t.f.firmId, t2.f.firmId]) {
      expect(await count("select count(*) from shifts where firm_id = $1", [firm])).toBe(0);
      expect(await count("select count(*) from sites where firm_id = $1", [firm])).toBe(0);
    }
    // The fake look-up can't place a real postcode: look-ups are off, so it's kept without a point.
    const off = await t.put("S-1", plain({ site: { name: "Arena", postcode: "LS1 4AP" } }));
    expect(off.status).toBe(201);
    const { rows } = await su.query("select postcode, lat from sites where firm_id = $1", [
      t.f.firmId,
    ]);
    expect(rows).toEqual([{ postcode: "LS1 4AP", lat: null }]);
  });
});

describe("two PUTs at once", () => {
  it("naming one new event and site, both succeed and share one row each", async () => {
    const t = await plannerFirm();
    const body = {
      ...plain(),
      site: { name: "Twin Ground", postcode: "ZZ6 6FF" },
      event: { ref: "TWIN-EVENT", name: "Twin" },
    };
    const answers = await Promise.all(["A-1", "A-2", "A-3", "A-4"].map((ref) => t.put(ref, body)));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201]);
    expect(await count("select count(*) from sites where firm_id = $1", [t.f.firmId])).toBe(1);
    expect(await count("select count(*) from shift_events where firm_id = $1", [t.f.firmId])).toBe(
      1,
    );
    expect(new Set(answers.map((a) => (a.body.session?.event as { id: string }).id)).size).toBe(1);
    expect(
      await count("select count(*) from events where firm_id = $1 and action = 'site.created'", [
        t.f.firmId,
      ]),
    ).toBe(1);
  });

  it("for one new ref give one session: the second updates the first's", async () => {
    const t = await plannerFirm();
    const answers = await Promise.all([t.put("ONE", plain()), t.put("ONE", plain())]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 201]);
    expect(answers.map((a) => a.body.result).sort()).toEqual(["created", "unchanged"]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(1);
    expect(answers[0]?.body.session?.id).toBe(answers[1]?.body.session?.id);
    expect(
      await count("select count(*) from events where firm_id = $1 and action = 'shift.created'", [
        t.f.firmId,
      ]),
    ).toBe(1);
  });
});

describe("places", () => {
  it("can't go below a booking in the top place (409 places_below_booked, logged for the office); nothing changes", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain({ places: 3 }))).body.session?.id ?? "";
    await booked(t, id, 1, "Ann");
    await booked(t, id, 3, "Cal");
    const before = await snapshot(id);
    const refused = await t.put("S-1", plain({ places: 2 }));
    expect([refused.status, refused.body.error?.code]).toEqual([409, "places_below_booked"]);
    expect(await snapshot(id)).toEqual(before);
    expect(await eventsOf(t.f.firmId, "api.change_refused")).toEqual([
      {
        action: "api.change_refused",
        actor_type: "system",
        actor_id: null,
        entity_id: id,
        data: { by: "firm", via: "api", keyId: t.key.id, shiftId: id, code: "places_below_booked" },
      },
    ]);
    // More places are fine, with bookings.
    const more = await t.put("S-1", plain({ places: 4 }));
    expect([more.status, more.body.session?.places, more.body.session?.status]).toEqual([
      200,
      4,
      "open",
    ]);
  });

  it("without bookings in the top place they go down, the status follows, and no booking sits above the places", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain({ places: 3 }))).body.session?.id ?? "";
    await booked(t, id, 1, "Ann");
    const down = await t.put("S-1", plain({ places: 1 }));
    expect([down.status, down.body.session?.places, down.body.session?.status]).toEqual([
      200,
      1,
      "filled",
    ]);
    const up = await t.put("S-1", plain({ places: 2 }));
    expect(up.body.session?.status).toBe("open");
    expect((await eventsOf(t.f.firmId, "shift.reopened")).map((e) => e.data)).toEqual([
      { by: "firm", via: "api", keyId: t.key.id },
    ]);
    // Nobody booked at all: any number.
    const id2 = (await t.put("S-2", plain({ places: 5 }))).body.session?.id ?? "";
    expect((await t.put("S-2", plain({ places: 1 }))).body.session?.places).toBe(1);
    for (const shiftId of [id, id2]) {
      const above = await count(
        `select count(*) from assignments a join shifts s on s.id = a.shift_id
          where a.shift_id = $1 and a.worker_id is not null
            and a.status = 'confirmed' and a.slot > s.headcount`,
        [shiftId],
      );
      expect(above).toBe(0);
    }
  });

  it("a session the office marked as filled stays closed when the places change", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain({ places: 3 }))).body.session?.id ?? "";
    await su.query("update shifts set status = 'filled' where id = $1", [id]);
    expect((await t.put("S-1", plain({ places: 4 }))).body.session?.status).toBe("filled");
  });
});

describe("a booked session", () => {
  it("can't change its role or requirements (409 session_has_bookings, logged); nothing changes", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    await booked(t, id, 1);
    const before = await snapshot(id);
    for (const change of [{ role: "door_supervisor" }, { requirements: ["FIRST_AID"] }]) {
      const refused = await t.put("S-1", plain(change));
      expect([refused.status, refused.body.error?.code]).toEqual([409, "session_has_bookings"]);
    }
    expect(await snapshot(id)).toEqual(before);
    expect((await eventsOf(t.f.firmId, "api.change_refused")).map((e) => e.data.code)).toEqual([
      "session_has_bookings",
      "session_has_bookings",
    ]);
  });

  it("takes pay, post and instructions; pay is logged as payRatePence (so a later cancellation is exempt)", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    await booked(t, id, 1);
    const changed = await t.put(
      "S-1",
      plain({ pay_rate_pence: 1500, post: "Gate C", instructions: "Bring ID." }),
    );
    expect(changed.status).toBe(200);
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data.fields)).toEqual([
      ["payRatePence", "post", "instructions"],
    ]);
  });

  it("moves with a change_reason and no office user: each casual's notice hours logged and their notice queued", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    const ann = await booked(t, id, 1, "Ann");
    const ben = await booked(t, id, 2, "Ben");
    const later = plain({ starts_at: "2026-11-07T10:00:00Z", ends_at: "2026-11-07T18:00:00Z" });
    const noReason = await t.put("S-1", later);
    expect([noReason.status, noReason.body.error?.code]).toEqual([422, "change_reason_required"]);
    // Logged for the office's Needs attention (casuals are booked), after the rollback.
    expect(
      (await eventsOf(t.f.firmId, "api.change_refused")).map((e) => [e.entity_id, e.data]),
    ).toEqual([
      [
        id,
        { by: "firm", via: "api", keyId: t.key.id, shiftId: id, code: "change_reason_required" },
      ],
    ]);
    const travelBefore = (await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId)).length;
    // The key alone is enough: nobody in the office can act.
    await su.query("update office_users set status = 'disabled' where firm_id = $1", [t.f.firmId]);
    const moved = await t.put("S-1", { ...later, change_reason: "event_changed" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      result: "updated",
      casuals_told: 2,
      session: { starts_at: "2026-11-07T10:00:00Z", ends_at: "2026-11-07T18:00:00Z" },
    });
    const events = await eventsOf(t.f.firmId, "shift.moved");
    expect(
      events.map((e) => [e.actor_type, e.entity_id, e.data.via, e.data.keyId, e.data.noticeHours]),
    ).toEqual([
      ["system", ann.booking, "api", t.key.id, 119],
      ["system", ben.booking, "api", t.key.id, 119],
    ]);
    expect(
      (await jobsFor(FIRM_CHANGE_NOTICE_QUEUE, t.f.firmId)).map((j) => j.assignmentId).sort(),
    ).toEqual([ann.booking, ben.booking].sort());
    expect((await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId)).length).toBeGreaterThan(
      travelBefore,
    );
    // Nothing else changed, so only the move's own shift.changed is logged.
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data.fields)).toEqual([
      ["startsAt", "endsAt"],
    ]);
  });

  it("a move that breaks a casual's rest gap is 409 bookings_block_change, changes nothing, and is logged for the office", async () => {
    const t = await plannerFirm();
    const id =
      (
        await t.put(
          "S-1",
          plain({ starts_at: "2026-11-07T18:00:00Z", ends_at: "2026-11-07T22:00:00Z" }),
        )
      ).body.session?.id ?? "";
    const ann = await booked(t, id, 1, "Ann");
    // Ann works until 06:00 that morning elsewhere: 12 hours' rest now, 4 after the move.
    const night = await t.f.shift({
      startsAt: new Date("2026-11-06T22:00:00Z"),
      hours: 8,
      role: "steward",
    });
    await t.f.booking(ann.worker, night, "confirmed", 1);
    const before = await snapshot(id);
    const refused = await t.put(
      "S-1",
      plain({
        starts_at: "2026-11-07T10:00:00Z",
        ends_at: "2026-11-07T14:00:00Z",
        change_reason: "event_changed",
      }),
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "bookings_block_change",
      casuals: [{ id: ann.worker, codes: ["rest"] }],
    });
    expect(JSON.stringify(refused.body)).not.toContain("Ann");
    expect(await snapshot(id)).toEqual(before);
    expect(await jobsFor(FIRM_CHANGE_NOTICE_QUEUE, t.f.firmId)).toEqual([]);
    // What the office's Needs attention reads (shift.move_refused with via "api").
    expect(await eventsOf(t.f.firmId, "shift.move_refused")).toEqual([
      {
        action: "shift.move_refused",
        actor_type: "system",
        actor_id: null,
        entity_id: id,
        data: {
          by: "firm",
          via: "api",
          keyId: t.key.id,
          reason: "The event's times or place changed",
          workers: [{ workerId: ann.worker, codes: ["rest"] }],
        },
      },
    ]);
  });

  it("is cancelled with a change_reason: cancel_via api, never a strike, each casual told; then it stays cancelled", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    const ann = await booked(t, id, 1, "Ann");
    const ben = await booked(t, id, 2, "Ben");
    const noReason = await t.put("S-1", { status: "cancelled" });
    expect([noReason.status, noReason.body.error?.code]).toEqual([422, "change_reason_required"]);
    const cancelled = await t.put("S-1", { status: "cancelled", change_reason: "event_cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      result: "cancelled",
      casuals_told: 2,
      session: { status: "cancelled" },
    });
    const { rows } = await su.query(
      "select status, cancel_via from assignments where shift_id = $1 and worker_id is not null order by slot",
      [id],
    );
    expect(rows).toEqual([
      { status: "cancelled_firm", cancel_via: "api" },
      { status: "cancelled_firm", cancel_via: "api" },
    ]);
    expect(await count("select count(*) from strikes where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(
      (await eventsOf(t.f.firmId, "shift.cancelled")).map((e) => [
        e.entity_id,
        e.data.strike,
        e.data.via,
      ]),
    ).toEqual([
      [ann.booking, "by_firm", "api"],
      [ben.booking, "by_firm", "api"],
    ]);
    expect(
      (await jobsFor(FIRM_CHANGE_NOTICE_QUEUE, t.f.firmId)).map((j) => j.assignmentId).sort(),
    ).toEqual([ann.booking, ben.booking].sort());
    // Sent again: nothing to do. Anything else: a cancelled session is never reopened.
    const again = await t.put("S-1", { status: "cancelled", change_reason: "event_cancelled" });
    expect([again.status, again.body.result]).toEqual([200, "unchanged"]);
    for (const change of [{ status: "open" }, { places: 5 }]) {
      const refused = await t.put("S-1", change);
      expect([refused.status, refused.body.error?.code]).toEqual([409, "session_cancelled"]);
    }
  });

  it("a cancelling PUT applies nothing else: no new site or event is made, no postcode filled", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    const sites = () => count("select count(*) from sites where firm_id = $1", [t.f.firmId]);
    const events = () =>
      count("select count(*) from shift_events where firm_id = $1", [t.f.firmId]);
    const [sitesBefore, eventsBefore] = [await sites(), await events()];
    const cancelled = await t.put(
      "S-1",
      plain({
        status: "cancelled",
        change_reason: "event_cancelled",
        site: { name: "Riverside Arena", postcode: "ZZ4 4DD" },
        event: { ref: "E-NEW", name: "A New Event" },
        places: 9,
      }),
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      result: "cancelled",
      session: { id, status: "cancelled", places: 2, site: { postcode: null } },
    });
    expect([await sites(), await events()]).toEqual([sitesBefore, eventsBefore]);
    expect(await eventsOf(t.f.firmId, "site.changed")).toEqual([]);
    // A new site's name too: nothing is made for a cancelled session's PUT.
    const again = await t.put(
      "S-1",
      plain({ site: { name: "Somewhere New", postcode: "ZZ5 5EE" } }),
    );
    expect([again.status, again.body.error?.code]).toEqual([409, "session_cancelled"]);
    expect([await sites(), await events()]).toEqual([sitesBefore, eventsBefore]);
  });
});

describe("cancelling through the API", () => {
  it("nothing about the site stops it: another postcode, or look-ups down, and the postcode is never sent out", async () => {
    let lookUps = 0;
    const down: Geocoder = {
      locate: async () => {
        lookUps += 1;
        return { status: "unavailable" };
      },
    };
    const t = await plannerFirm({ geocoder: down });
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    await su.query("update sites set postcode = 'ZZ1 1AA' where firm_id = $1", [t.f.firmId]);
    await booked(t, id, 1, "Ann");
    const cancel = { status: "cancelled", change_reason: "event_cancelled" };
    const cancelled = await t.put(
      "S-1",
      plain({ ...cancel, site: { name: "Riverside Arena", postcode: "ZZ2 2BB" } }),
    );
    expect([cancelled.status, cancelled.body.result, cancelled.body.casuals_told]).toEqual([
      200,
      "cancelled",
      1,
    ]);
    // A ref ShiftDesk never had, at a new site with a postcode: nothing to do, nothing looked up.
    const fresh = await t.put(
      "S-2",
      plain({ ...cancel, site: { name: "New Hall", postcode: "ZZ3 3CC" } }),
    );
    expect([fresh.status, fresh.body.result]).toEqual([200, "unchanged"]);
    expect(lookUps).toBe(0);
    const { rows } = await su.query("select name, postcode from sites where firm_id = $1", [
      t.f.firmId,
    ]);
    expect(rows).toEqual([{ name: "Riverside Arena", postcode: "ZZ1 1AA" }]);
  });

  it("the same cancellation sent again is 200 unchanged whatever else it says, and logs and makes nothing", async () => {
    const t = await plannerFirm();
    await t.put("S-1", plain());
    const cancel = { status: "cancelled", change_reason: "event_cancelled" };
    expect((await t.put("S-1", plain(cancel))).body.result).toBe("cancelled");
    const logged = (await eventsOf(t.f.firmId)).length;
    const sites = await count("select count(*) from sites where firm_id = $1", [t.f.firmId]);
    const events = await count("select count(*) from shift_events where firm_id = $1", [
      t.f.firmId,
    ]);
    const again = await t.put(
      "S-1",
      plain({
        ...cancel,
        change_reason: "weather",
        places: 9,
        site: { name: "Somewhere New" },
        event: { ref: "E-NEW", name: "A New Event" },
      }),
    );
    expect([again.status, again.body.result, again.body.session?.status]).toEqual([
      200,
      "unchanged",
      "cancelled",
    ]);
    expect((await eventsOf(t.f.firmId)).length).toBe(logged);
    expect(await count("select count(*) from sites where firm_id = $1", [t.f.firmId])).toBe(sites);
    expect(await count("select count(*) from shift_events where firm_id = $1", [t.f.firmId])).toBe(
      events,
    );
  });

  it("with no reason it's 422; with casuals booked that's logged for the office's Needs attention, with nobody booked it isn't", async () => {
    const t = await plannerFirm();
    await t.put("S-0", plain());
    const empty = await t.put("S-0", { status: "cancelled" });
    expect([empty.status, empty.body.error?.code]).toEqual([422, "change_reason_required"]);
    expect(await eventsOf(t.f.firmId, "api.change_refused")).toEqual([]);
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    await booked(t, id, 1, "Ann");
    const before = await snapshot(id);
    const refused = await t.put("S-1", { status: "cancelled" });
    expect([refused.status, refused.body.error?.code]).toEqual([422, "change_reason_required"]);
    expect(await snapshot(id)).toEqual(before);
    expect(
      (await eventsOf(t.f.firmId, "api.change_refused")).map((e) => [e.entity_id, e.data]),
    ).toEqual([
      [
        id,
        { by: "firm", via: "api", keyId: t.key.id, shiftId: id, code: "change_reason_required" },
      ],
    ]);
  });
});

describe("a session nobody is booked on", () => {
  it("a new time, role or site is applied: offers still out expire, travel estimates are queued in the same PUT, and a new time or site logs from and to", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    const ann = await t.f.worker({ first: "Ann" });
    const arena = (
      await su.query<{ id: string }>("select site_id::text as id from shifts where id = $1", [id])
    ).rows[0]?.id;
    // An offer still out for the session, as a wave sends it.
    const offerOut = async (wave: number) =>
      (
        await su.query<{ id: string }>(
          `insert into offers (firm_id, shift_id, worker_id, wave, channel)
           values ($1, $2, $3, $4, 'push') returning id::text as id`,
          [t.f.firmId, id, ann, wave],
        )
      ).rows[0]?.id ?? "";
    const responseOf = async (offerId: string) =>
      (
        await su.query<{ response: string | null }>("select response from offers where id = $1", [
          offerId,
        ])
      ).rows[0]?.response;
    const travelJobs = async () =>
      (await jobsFor(TRAVEL_ESTIMATES_QUEUE, t.f.firmId)).filter(
        (j) => Array.isArray(j.shiftIds) && j.shiftIds.includes(id),
      ).length;
    const lastChange = async () => (await eventsOf(t.f.firmId, "shift.changed")).at(-1)?.data;
    const api = { by: "firm", via: "api", keyId: t.key.id };

    const later = { starts_at: "2026-11-07T10:00:00Z", ends_at: "2026-11-07T18:00:00Z" };
    const steps = [
      {
        body: plain(later),
        logged: {
          ...api,
          fields: ["startsAt", "endsAt"],
          from: {
            startsAt: "2026-11-07T08:00:00.000Z",
            endsAt: "2026-11-07T16:00:00.000Z",
            siteId: arena,
          },
          to: {
            startsAt: "2026-11-07T10:00:00.000Z",
            endsAt: "2026-11-07T18:00:00.000Z",
            siteId: arena,
          },
        },
      },
      { body: plain({ ...later, role: "door_supervisor" }), logged: { ...api, fields: ["role"] } },
      {
        body: plain({ ...later, role: "door_supervisor", site: { name: "Other Hall" } }),
        logged: {
          ...api,
          fields: ["siteId"],
          from: {
            startsAt: "2026-11-07T10:00:00.000Z",
            endsAt: "2026-11-07T18:00:00.000Z",
            siteId: arena,
          },
          to: {
            startsAt: "2026-11-07T10:00:00.000Z",
            endsAt: "2026-11-07T18:00:00.000Z",
            siteId: expect.any(String),
          },
        },
      },
    ];
    for (const [i, step] of steps.entries()) {
      const offerId = await offerOut(i + 1);
      const travelBefore = await travelJobs();
      const changed = await t.put("S-1", step.body);
      expect([changed.status, changed.body.result]).toEqual([200, "updated"]);
      expect(changed.body.casuals_told).toBeUndefined();
      expect(await responseOf(offerId)).toBe("expired");
      expect(await travelJobs()).toBe(travelBefore + 1);
      expect(await lastChange()).toEqual(step.logged);
    }
    const final = await t.get("S-1");
    expect(final.body.session).toMatchObject({
      role: "door_supervisor",
      starts_at: "2026-11-07T10:00:00Z",
      site: { name: "Other Hall" },
    });
    // The new site is really another one.
    const { rows } = await su.query<{ moved: boolean }>(
      "select site_id <> $2::uuid as moved from shifts where id = $1",
      [id, arena],
    );
    expect(rows).toEqual([{ moved: true }]);
  });

  it("an unknown role on an update is 422 unknown_role and changes nothing", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain())).body.session?.id ?? "";
    const before = await snapshot(id);
    const refused = await t.put("S-1", plain({ role: "juggler" }));
    expect([refused.status, refused.body.error?.code]).toEqual([422, "unknown_role"]);
    expect(await snapshot(id)).toEqual(before);
  });
});

describe("a session that has started", () => {
  it("is refused any change (409 session_started); the same PUT is still 200", async () => {
    const t = await plannerFirm();
    await t.put("S-1", plain());
    t.at(new Date("2026-11-07T09:00:00Z"));
    const refused = await t.put("S-1", plain({ places: 3 }));
    expect([refused.status, refused.body.error?.code]).toEqual([409, "session_started"]);
    const cancel = await t.put("S-1", { status: "cancelled", change_reason: "weather" });
    expect([cancel.status, cancel.body.error?.code]).toEqual([409, "session_started"]);
    expect((await t.put("S-1", plain())).status).toBe(200);
  });

  it("its site isn't given a postcode by a PUT that's otherwise the same", async () => {
    const t = await plannerFirm();
    await t.put("S-1", plain());
    t.at(new Date("2026-11-07T09:00:00Z"));
    const same = await t.put(
      "S-1",
      plain({ site: { name: "Riverside Arena", postcode: "ZZ4 4DD" } }),
    );
    expect([same.status, same.body.result]).toEqual([200, "unchanged"]);
    const { rows } = await su.query("select postcode from sites where firm_id = $1", [t.f.firmId]);
    expect(rows).toEqual([{ postcode: null }]);
    expect(await eventsOf(t.f.firmId, "site.changed")).toEqual([]);
  });

  it("and a move into the past is refused too", async () => {
    const t = await plannerFirm();
    await t.put("S-1", plain());
    const past = await t.put(
      "S-1",
      plain({ starts_at: "2026-11-02T08:00:00Z", ends_at: "2026-11-02T16:00:00Z" }),
    );
    expect([past.status, past.body.error?.code]).toEqual([409, "session_started"]);
  });
});

describe("GET /sessions/{ref}", () => {
  it("gives the session with every booking, live and cancelled, and nothing personal but names and staff refs", async () => {
    const t = await plannerFirm();
    const id = (await t.put("S-1", plain({ places: 3 }))).body.session?.id ?? "";
    const ann = await booked(t, id, 1, "Ann");
    const ben = await booked(t, id, 2, "Ben");
    await su.query("update workers set external_ref = 'ST-0042' where id = $1", [ann.worker]);
    // Ben cancelled himself, unwell, two days ago.
    await su.query(
      `update assignments set status = 'cancelled_worker', cancelled_at = $2, cancel_reason = 'I''m unwell',
              notice_hours = 100, cancel_via = 'app' where id = $1`,
      [ben.booking, new Date(NOW.getTime() - 48 * HOUR)],
    );
    const got = await t.get("S-1");
    expect(got.status).toBe(200);
    expect(got.body.session).toMatchObject({ id, ref: "S-1", booked: 1 });
    expect(got.body.bookings).toEqual([
      {
        id: ann.booking,
        ref: ann.booking.slice(0, 8).toUpperCase(),
        status: "booked",
        casual: { id: ann.worker, staff_ref: "ST-0042", first_name: "Ann", last_name: "Booker" },
        booked_at: expect.any(String),
        booked_by: "office",
      },
      {
        id: ben.booking,
        ref: ben.booking.slice(0, 8).toUpperCase(),
        status: "cancelled",
        casual: { id: ben.worker, staff_ref: null, first_name: "Ben", last_name: "Booker" },
        booked_at: expect.any(String),
        booked_by: "office",
        cancellation: {
          at: "2026-10-31T09:00:00Z",
          by: "casual",
          via: "app",
          notice_hours: 100,
          reason_code: "casual_own_reason",
          strike: { status: "none", live_strikes: 0 },
        },
      },
    ]);
    const text = JSON.stringify(got.body);
    expect(text).not.toMatch(/unwell|health|\+447700|@example/i);
    const unknown = await t.get("NOT-THERE");
    expect([unknown.status, unknown.body.error?.code]).toEqual([404, "not_found"]);
  });
});

describe("tenancy: the key decides the firm", () => {
  it("the same ref in two firms is two sessions; neither key reaches the other firm's session or bookings", async () => {
    const a = await plannerFirm();
    const b = await plannerFirm();
    const inA = await a.put("SHARED-1", plain());
    const inB = await b.put("SHARED-1", plain());
    expect([inA.status, inB.status]).toEqual([201, 201]);
    expect(inA.body.session?.id).not.toBe(inB.body.session?.id);
    const bBooking = await booked(b, inB.body.session?.id ?? "", 1, "Bea");
    // A's key reads its own session: B's booking never shows.
    const readA = await a.get("SHARED-1");
    expect(readA.body.session?.id).toBe(inA.body.session?.id);
    expect(readA.body.bookings).toEqual([]);
    expect(JSON.stringify(readA.body)).not.toContain(bBooking.worker);
    // A ref only B has looks unknown to A's key.
    await b.put("ONLY-B", plain());
    expect((await a.get("ONLY-B")).status).toBe(404);
    // A's key can't change B's session: its PUT makes A's own.
    const aOwn = await a.put("ONLY-B", plain({ places: 9 }));
    expect(aOwn.status).toBe(201);
    expect((await b.get("ONLY-B")).body.session?.places).toBe(2);
  });

  it("a key revoked after the look-up is refused inside the transaction, and nothing is made", async () => {
    const t = await plannerFirm();
    const deps: ApiDeps = {
      ...t.deps,
      resolveKey: async (hash) => {
        const entry = await resolveKey(hash);
        await su.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
          t.key.id,
          t.admin,
        ]);
        return entry;
      },
    };
    const response = await answer<Answer>(
      await putSessionRequest(
        apiRequest("PUT", "/api/v1/sessions/S-1", { key: t.key.key, body: plain() }),
        "S-1",
        deps,
      ),
    );
    expect([response.status, response.body.error?.code]).toEqual([401, "invalid_key"]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
  });
});

describe("Gate B", () => {
  it("on a live database a PUT is 403 until the firm's agreement is recorded; reads still work", async () => {
    const t = await plannerFirm({ localDatabase: false });
    const refused = await t.put("S-1", plain({ site: { name: "Arena", postcode: "ZZ7 7GG" } }));
    expect([refused.status, refused.body.error?.code]).toEqual([403, "agreement_not_recorded"]);
    const plainRefused = await t.put("S-2", plain());
    expect([plainRefused.status, plainRefused.body.error?.code]).toEqual([
      403,
      "agreement_not_recorded",
    ]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(await count("select count(*) from sites where firm_id = $1", [t.f.firmId])).toBe(0);
    expect((await t.get("S-1")).status).toBe(404);
    await su.query("update firms set agreement_signed_on = '2026-10-01' where id = $1", [
      t.f.firmId,
    ]);
    expect((await t.put("S-1", plain())).status).toBe(201);
  });
});
