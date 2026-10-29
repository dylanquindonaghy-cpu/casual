import { randomUUID } from "node:crypto";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { putPlannerSession } from "@/lib/integrations/sessions";
import { cancelShiftByFirm } from "@/lib/roster/cancel";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import { connectSheet, disableSheet } from "../../scripts/firm-sheet-owner";
import { bookingFirm, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";

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
    const owner = new Client({ connectionString: urls.superuser });
    await owner.connect();
    try {
      await owner.query("begin");
      await owner.query("select id from roster_sources where id = $1 for update", [t.sourceId]);
      const pending = t.put("PORTAL-S1", plain());
      // The PUT is waiting on the row the owner holds.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await owner.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
      await owner.query("commit");
      const r = await pending;
      expect([r.status, r.body.error?.code]).toEqual([401, "invalid_key"]);
    } finally {
      await owner.end();
    }
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
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
        insert(f.firmId, { ...connector, base_url: "https://portal.example.test:8443/v1/x" }),
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
