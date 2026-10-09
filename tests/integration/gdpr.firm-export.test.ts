import { getTableName } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { exportFirmData, FIRM_EXPORT_EXCLUDED, firmExportTables } from "@/lib/gdpr/firm-export";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant, EXPECTED_TABLES, type Tenant } from "../helpers/tenant-rows";

// The firm's own download (docs/compliance.md "Firms can export their data any time"): every firm
// table, only this firm's rows, no login secrets.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
});

afterAll(async () => {
  await app.end();
  await su.end();
});

const NOW = new Date("2026-11-02T09:00:00Z");
const ctx = (t: Tenant, officeUserId = t.officeUserId) => ({
  firm: { id: t.firmId, slug: t.slug },
  officeUserId,
  run: withFirm,
  clock: { now: () => NOW },
});

describe("the firm's data export", () => {
  it("every firm table is exported or left out on purpose (a new table must choose)", () => {
    const exported = firmExportTables().map((t) => getTableName(t));
    expect([...exported, ...Object.keys(FIRM_EXPORT_EXCLUDED), "firms"].sort()).toEqual(
      [...EXPECTED_TABLES].sort(),
    );
    expect(exported).not.toContain("firms");
  });

  it("holds every row of this firm's tables, nobody else's, and no login secrets", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    const result = await exportFirmData(ctx(t));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.fileName).toBe(`${t.slug}-data-2026-11-02.json`);
    const data = JSON.parse(result.body) as {
      exportedAt: string;
      firm: Record<string, unknown>;
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(data.exportedAt).toBe(NOW.toISOString());
    expect(data.firm).toMatchObject({ id: t.firmId, slug: t.slug });
    for (const [table, rows] of Object.entries(data.tables)) {
      const { rows: inDb } = await su.query<{ id: string }>(
        // The export's own log row is written after the file is made.
        `select id::text from ${table} where firm_id = $1
           ${table === "events" ? "and action <> 'firm.data_exported'" : ""}`,
        [t.firmId],
      );
      if (table === "events") {
        // Numbered within the file (1, 2, 3… as they happened), never by the counter every firm
        // shares (the reviews of Phase 10 task 19): the same events, by what each says.
        const { rows: logged } = await su.query<{ action: string; entity: string | null }>(
          `select action, entity_id::text as entity from events
            where firm_id = $1 and action <> 'firm.data_exported' order by id`,
          [t.firmId],
        );
        const byNumber = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
        expect(byNumber.map((r) => r.id)).toEqual(logged.map((_, i) => i + 1));
        expect(byNumber.map((r) => [r.action, r.entityId])).toEqual(
          logged.map((e) => [e.action, e.entity]),
        );
        continue;
      }
      expect(rows.map((r) => String(r.id)).sort(), table).toEqual(inDb.map((r) => r.id).sort());
      expect(rows.length, table).toBeGreaterThan(0);
      for (const row of rows) expect(Object.keys(row), table).not.toContain("firmId");
    }
    // Every column, a worker's included.
    expect(data.tables.workers?.find((w) => w.id === t.workerId)).toMatchObject({
      firstName: "Test",
      lastName: "Worker",
    });
    // Nobody else's rows: none of the other firm's ids appear anywhere.
    // (Event ids are small numbers, so only the uuids are searched for.)
    for (const [table, id] of Object.entries(other.rows)) {
      if (table !== "events") expect(result.body, table).not.toContain(id);
    }
    for (const secret of ["tokenHash", "codeHash", "p256dh", "bucket", "test-auth"]) {
      expect(result.body).not.toContain(secret);
    }
    // A casual's travel area: the district only, never the postcode or its point (12G.1).
    expect(data.tables.worker_travel).toEqual([
      expect.objectContaining({ district: "ZZ1", modes: "both", maxMinutes: 45 }),
    ]);
    for (const row of data.tables.worker_travel ?? []) {
      expect(row).not.toHaveProperty("startPostcode");
      expect(row).not.toHaveProperty("lat");
      expect(row).not.toHaveProperty("lng");
    }
    expect(result.body).not.toContain("ZZ1 1AA");
    expect(result.body).not.toContain("53.83");
    const events = await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'firm.data_exported'`,
      [t.firmId],
    );
    expect(events.rows).toEqual([
      {
        actor_type: "office",
        actor_id: t.officeUserId,
        entity_id: t.firmId,
        data: { tables: Object.keys(data.tables).length, rows: result.rows },
      },
    ]);
  });

  it("admins only", async () => {
    const t = await createTenant(su);
    const { rows } = await su.query<{ id: string }>(
      `insert into office_users (firm_id, email, name, role)
       values ($1, $2, 'Res Ourcer', 'resourcer') returning id::text as id`,
      [t.firmId, `res.${t.slug}@example.com`],
    );
    expect(await exportFirmData(ctx(t, rows[0]?.id ?? ""))).toEqual({ status: "not_allowed" });
    await su.query("update office_users set status = 'disabled' where id = $1", [t.officeUserId]);
    expect(await exportFirmData(ctx(t))).toEqual({ status: "not_allowed" });
  });
});
