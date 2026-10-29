import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { putPlannerSession } from "@/lib/integrations/sessions";
import { cancelShiftByFirm } from "@/lib/roster/cancel";
import { firmCallerMay, type PlannerCaller } from "@/lib/roster/firm-caller";
import { fakeGeocoder, type Geocoder } from "@/lib/travel/geocoder";
import { connectSheet, disableSheet } from "../../scripts/firm-sheet-owner";
import { bookingFirm, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { plannerKey } from "../helpers/planner-api";

// A connector's source and caller (P5.2; src/lib/roster/firm-caller.ts): a connector changes the
// firm's sessions exactly as the planner's API does (putPlannerSession, the same transaction and
// rules), while its source (roster_sources, kind "connector") is switched on. On the real database,
// as the app role. NOW is Monday 2 November 2026, 09:00 London; sessions are on Saturday 7
// November. A made-up portal's address only.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(6);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

type Body = Record<string, unknown>;
type Answer = {
  result?: string;
  session?: Body & { id: string };
  casuals_told?: number;
  error?: { code: string };
};

const PORTAL = "https://portal.example.test/api";

async function connectorSource(firmId: string, o: { enabled?: boolean } = {}): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into roster_sources (firm_id, kind, enabled, connector, base_url, mapping)
     values ($1, 'connector', $2, 'demo_portal', $3, '{}') returning id::text as id`,
    [firmId, o.enabled ?? true, PORTAL],
  );
  return rows[0]?.id ?? "";
}

// A firm with a connector source on; its connector's PUTs.
async function connectorFirm() {
  const f = await bookingFirm(su, withFirm);
  const sourceId = await connectorSource(f.firmId);
  const put = async (ref: string, json: unknown, by = sourceId) => {
    const r = await putPlannerSession(
      {
        run: withFirm,
        firmId: f.firmId,
        by: { type: "connector", sourceId: by },
        json,
        now: NOW,
        geocoder: fakeGeocoder,
        localDatabase: true,
      },
      ref,
    );
    return { status: r.status, body: r.body as Answer };
  };
  return { f, sourceId, put };
}

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
    await su.query<{ action: string; actor_type: string; entity_id: string | null; data: Body }>(
      `select action, actor_type, entity_id::text, data from events
        where firm_id = $1 and action like $2 and action <> 'credential_pack.applied' order by id`,
      [firmId, like],
    )
  ).rows;

const count = async (sql: string, params: unknown[]) =>
  Number(Object.values((await su.query(sql, params)).rows[0] ?? {})[0] ?? Number.NaN);

const backendPid = async (c: PoolClient) =>
  (await c.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? 0;

// Polls until the check's first row says so (or 5 seconds pass), then gives its last answer.
async function waitFor<T extends { rows: { n: number }[] }>(check: () => Promise<T>): Promise<T> {
  let last = await check();
  for (let i = 0; i < 100 && last.rows[0]?.n !== 1; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await check();
  }
  return last;
}

// How many sessions wait on this one's locks (polled until one does).
const blockedBy = async (pid: number) =>
  (
    await waitFor(() =>
      su.query<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
        [pid],
      ),
    )
  ).rows[0]?.n ?? 0;

async function booked(f: BookingFirm, shiftId: string, slot: number, first: string) {
  const worker = await f.worker({ first });
  return f.booking(worker, shiftId, "confirmed", slot);
}

describe("a connector's sessions are the planner's", () => {
  it("made, changed, moved and cancelled through the planner's rules, each logged with its source", async () => {
    const t = await connectorFirm();
    const marks = { by: "firm", via: "api", sourceId: t.sourceId };

    const created = await t.put("PORTAL-S1", plain());
    expect([created.status, created.body.result]).toEqual([201, "created"]);
    const id = created.body.session?.id ?? "";
    const { rows: shift } = await su.query(
      "select source, external_ref from shifts where id = $1",
      [id],
    );
    expect(shift).toEqual([{ source: "api", external_ref: "PORTAL-S1" }]);
    expect(await eventsOf(t.f.firmId)).toEqual([
      { action: "site.created", actor_type: "system", entity_id: expect.any(String), data: marks },
      { action: "shift.created", actor_type: "system", entity_id: id, data: marks },
    ]);

    // Changed: the same answers as the planner's.
    const more = await t.put("PORTAL-S1", plain({ places: 3 }));
    expect([more.status, more.body.result]).toEqual([200, "updated"]);
    expect((await t.put("PORTAL-S1", plain({ places: 3 }))).body.result).toBe("unchanged");
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data)).toEqual([
      expect.objectContaining({ ...marks, fields: ["headcount"] }),
    ]);

    // Moved with casuals booked: a reason needed, then each casual's notice hours.
    const ann = await booked(t.f, id, 1, "Ann");
    const later = plain({
      places: 3,
      starts_at: "2026-11-07T10:00:00Z",
      ends_at: "2026-11-07T18:00:00Z",
    });
    const noReason = await t.put("PORTAL-S1", later);
    expect([noReason.status, noReason.body.error?.code]).toEqual([422, "change_reason_required"]);
    expect((await eventsOf(t.f.firmId, "api.change_refused")).map((e) => e.data)).toEqual([
      { ...marks, shiftId: id, code: "change_reason_required" },
    ]);
    const moved = await t.put("PORTAL-S1", { ...later, change_reason: "event_changed" });
    expect([moved.status, moved.body.casuals_told]).toEqual([200, 1]);
    expect(
      (await eventsOf(t.f.firmId, "shift.moved")).map((e) => [
        e.actor_type,
        e.entity_id,
        e.data.via,
        e.data.sourceId,
        e.data.noticeHours,
      ]),
    ).toEqual([["system", ann, "api", t.sourceId, 119]]);

    // Cancelled: cancel_via api, never a strike, who asked unknown (the source's own reason).
    const cancelled = await t.put("PORTAL-S1", {
      status: "cancelled",
      change_reason: "event_cancelled",
    });
    expect([cancelled.status, cancelled.body.result]).toEqual([200, "cancelled"]);
    const { rows: bookings } = await su.query(
      "select status, cancel_via, cancel_asked_by from assignments where id = $1",
      [ann],
    );
    expect(bookings).toEqual([
      { status: "cancelled_firm", cancel_via: "api", cancel_asked_by: "unknown" },
    ]);
    expect(await count("select count(*) from strikes where firm_id = $1", [t.f.firmId])).toBe(0);
    expect(
      (await eventsOf(t.f.firmId, "shift.cancelled")).map((e) => [
        e.entity_id,
        e.data.via,
        e.data.sourceId,
      ]),
    ).toEqual([[ann, "api", t.sourceId]]);
    expect(
      (await eventsOf(t.f.firmId, "shift.cancelled_by_firm")).map((e) => e.data.sourceId),
    ).toEqual([t.sourceId]);
  });

  it("reaches only the planner's sessions: the office's own is unknown to it, as another firm's is", async () => {
    const t = await connectorFirm();
    const native = await t.f.shift({});
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        {
          shiftId: native,
          reason: "event_cancelled",
          by: { type: "connector", sourceId: t.sourceId },
        },
        { clock: { now: () => NOW } },
      ),
    ).toEqual({ status: "not_found" });
    // And the office can't cancel a connector's session as a whole: the next record would undo it.
    const id = (await t.put("PORTAL-S2", plain())).body.session?.id ?? "";
    const admin = await t.f.office("admin");
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        { shiftId: id, reason: "event_cancelled", by: { type: "office", id: admin } },
        { clock: { now: () => NOW } },
      ),
    ).toEqual({ status: "planner" });
  });
});

describe("a source switched off", () => {
  it("can change nothing: refused as an invalid key, and nothing is made or cancelled", async () => {
    const t = await connectorFirm();
    const id = (await t.put("PORTAL-S1", plain())).body.session?.id ?? "";
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    for (const json of [
      plain({ places: 5 }),
      { status: "cancelled", change_reason: "event_cancelled" },
    ]) {
      const r = await t.put("PORTAL-S1", json);
      expect([r.status, r.body.error?.code]).toEqual([401, "invalid_key"]);
    }
    expect((await t.put("PORTAL-S9", plain())).status).toBe(401);
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        { shiftId: id, reason: "event_cancelled", by: { type: "connector", sourceId: t.sourceId } },
        { clock: { now: () => NOW } },
      ),
    ).toEqual({ status: "not_allowed" });
    const { rows } = await su.query("select headcount, status from shifts where firm_id = $1", [
      t.f.firmId,
    ]);
    expect(rows).toEqual([{ headcount: 2, status: "open" }]);
  });

  it("nor can a sheet's source, a made-up id or another firm's connector act as one", async () => {
    const t = await connectorFirm();
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    await t.f.sheetSource(null);
    const { rows: sheet } = await su.query<{ id: string }>(
      "select id::text as id from roster_sources where firm_id = $1 and kind = 'sheets'",
      [t.f.firmId],
    );
    const other = await connectorFirm();
    for (const by of [sheet[0]?.id ?? "", randomUUID(), other.sourceId]) {
      const r = await t.put("PORTAL-S1", plain(), by);
      expect([r.status, r.body.error?.code], by).toEqual([401, "invalid_key"]);
    }
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
  });

  it("switched off while a change waits for the source's row: the change sees it off and is refused", async () => {
    const t = await connectorFirm();
    const owner = await su.connect();
    try {
      await owner.query("begin");
      await owner.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
      const pid = await backendPid(owner);
      const pending = t.put("PORTAL-S1", plain());
      // The PUT holds the source's row for share, so it waits for the switch-off to finish.
      expect(await blockedBy(pid)).toBe(1);
      await owner.query("commit");
      const r = await pending;
      expect([r.status, r.body.error?.code]).toEqual([401, "invalid_key"]);
    } finally {
      owner.release();
    }
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
  });

  it("a switch-off waits for a change already under way, and the next change is refused", async () => {
    const t = await connectorFirm();
    const by = { type: "connector" as const, sourceId: t.sourceId };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    // A change under way: it has taken the source's row and is still working.
    const change = withFirm(t.f.firmId, async (tx) => {
      const may = await firmCallerMay(tx, by);
      holding();
      await gate;
      return may;
    });
    await held;
    const off = await su.connect();
    try {
      const switching = off.query("update roster_sources set enabled = false where id = $1", [
        t.sourceId,
      ]);
      // The switch-off is the one waiting.
      const { rows } = await waitFor(async () =>
        su.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where query like 'update roster_sources set enabled = false%'
              and cardinality(pg_blocking_pids(pid)) > 0`,
        ),
      );
      expect(rows).toEqual([{ n: 1 }]);
      release();
      expect(await change).toBe(true);
      await switching;
    } finally {
      off.release();
    }
    const r = await t.put("PORTAL-S1", plain());
    expect([r.status, r.body.error?.code]).toEqual([401, "invalid_key"]);
  });

  it("stands down while the firm has a live planner key: one planner, never two writing the same sessions", async () => {
    const t = await connectorFirm();
    const admin = await t.f.office("admin");
    const key = await plannerKey(su, t.f.firmId, admin);
    const r = await t.put("PORTAL-S1", plain());
    expect([r.status, r.body.error?.code]).toEqual([401, "invalid_key"]);
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
    await su.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
      key.id,
      admin,
    ]);
    expect((await t.put("PORTAL-S1", plain())).status).toBe(201);
  });

  it("a caller that isn't one is refused before anything is read or looked up", async () => {
    const t = await connectorFirm();
    let lookups = 0;
    const geocoder: Geocoder = {
      locate: (postcode) => {
        lookups += 1;
        return fakeGeocoder.locate(postcode);
      },
    };
    const put = (by: unknown, json: unknown) =>
      putPlannerSession(
        { run: withFirm, firmId: t.f.firmId, by: by as PlannerCaller, json, now: NOW, geocoder },
        "PORTAL-S1",
      );
    for (const by of [
      { type: "connector", sourceId: "not-a-uuid" },
      { type: "office", id: randomUUID() },
      { type: "connector" },
    ]) {
      const r = await put(by, plain());
      expect([r.status, (r.body as Answer).error?.code], JSON.stringify(by)).toEqual([
        401,
        "invalid_key",
      ]);
    }
    // Switched off: a new site's postcode is never sent out to be looked up.
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    const r = await put(
      { type: "connector", sourceId: t.sourceId },
      plain({ site: { name: "New Arena", postcode: "ZZ7 7GG" } }),
    );
    expect([r.status, lookups]).toEqual([401, 0]);
  });

  it("Gate B: on a live database a connector saves nothing until the firm's agreement is recorded", async () => {
    const t = await connectorFirm();
    const put = () =>
      putPlannerSession(
        {
          run: withFirm,
          firmId: t.f.firmId,
          by: { type: "connector", sourceId: t.sourceId },
          json: plain(),
          now: NOW,
          geocoder: fakeGeocoder,
          localDatabase: false,
        },
        "PORTAL-S1",
      );
    const refused = await put();
    expect([refused.status, (refused.body as Answer).error?.code]).toEqual([
      403,
      "agreement_not_recorded",
    ]);
    await su.query("update firms set agreement_signed_on = '2026-10-01' where id = $1", [
      t.f.firmId,
    ]);
    expect((await put()).status).toBe(201);
  });
});

describe("the connector source's row", () => {
  const insert = (firmId: string, cols: Record<string, unknown>) => {
    const names = Object.keys(cols);
    return su.query(
      `insert into roster_sources (firm_id, ${names.join(", ")}) values ($1, ${names
        .map((_, i) => `$${i + 2}`)
        .join(", ")})`,
      [firmId, ...Object.values(cols)],
    );
  };
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      return (err as { code?: string; constraint?: string }).constraint ?? "no constraint";
    }
    return "no error";
  };

  it("has which connector and an https base address, and nothing of a sheet's; a sheet the reverse", async () => {
    const f = await bookingFirm(su, withFirm);
    const connector = {
      kind: "connector",
      connector: "demo_portal",
      base_url: PORTAL,
      mapping: "{}",
    };
    for (const [cols, constraint] of [
      [{ ...connector, base_url: null }, "roster_sources_kind_fields"],
      [{ ...connector, connector: null }, "roster_sources_kind_fields"],
      [{ ...connector, spreadsheet_id: "a".repeat(30) }, "roster_sources_kind_fields"],
      [{ ...connector, connector: "some_portal" }, "roster_sources_connector_check"],
      [{ ...connector, base_url: "http://portal.example.test" }, "roster_sources_base_url_format"],
      [
        { ...connector, base_url: "https://user@portal.example.test" },
        "roster_sources_base_url_format",
      ],
      [
        { ...connector, base_url: "https://portal.example.test/api?key=x" },
        "roster_sources_base_url_format",
      ],
      [
        { ...connector, base_url: "https://portal.example.test/a b" },
        "roster_sources_base_url_format",
      ],
      // Never inside: an IP address (however written), a bare or internal name, another port, a
      // dot segment (P5.2's review).
      ...[
        "https://127.0.0.1",
        "https://169.254.169.254/latest",
        "https://2130706433",
        "https://0x7f000001",
        "https://[::1]",
        "https://localhost",
        "https://portal.localhost",
        "https://host.docker.internal",
        "https://printer.local",
        "https://web:3000",
        "https://postgres",
        "https://portal.example.test:8443/v1",
        "https://portal.example.test/v1/../admin",
        `https://portal.example.test/${"a".repeat(290)}`,
      ].map((base_url) => [{ ...connector, base_url }, "roster_sources_base_url_format"] as const),
      [
        { kind: "sheets", spreadsheet_id: "a".repeat(30), base_url: PORTAL, mapping: "{}" },
        "roster_sources_kind_fields",
      ],
      [{ kind: "sheets", mapping: "{}" }, "roster_sources_kind_fields"],
    ] as const) {
      expect(await code(insert(f.firmId, cols)), JSON.stringify(cols)).toBe(constraint);
    }
    expect(await code(insert(f.firmId, connector))).toBe("no error");
    expect(
      await code(
        insert(f.firmId, { ...connector, base_url: "https://portal.example.test:443/v1/x" }),
      ),
    ).toBe("roster_sources_one_enabled_per_firm");
  });

  it("one source on per firm: the sheet command leaves a connector alone and won't switch a sheet on beside it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sourceId = await connectorSource(f.firmId);
    const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
      f.firmId,
    ]);
    const slug = rows[0]?.slug ?? "";
    for (const replace of [false, true]) {
      expect(
        await connectSheet(urls.admin, slug, {
          spreadsheetId: `test_${"b".repeat(30)}`,
          replace,
          localDatabase: true,
        }),
      ).toEqual({ status: "has_connector" });
    }
    expect(await disableSheet(urls.admin, slug)).toEqual({ status: "none" });
    const { rows: sources } = await su.query(
      "select id::text as id, kind, enabled from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(sources).toEqual([{ id: sourceId, kind: "connector", enabled: true }]);
    expect(
      await count("select count(*) from events where firm_id = $1 and action like 'roster.%'", [
        f.firmId,
      ]),
    ).toBe(0);
  });
});
