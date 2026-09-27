import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "@/lib/db/admin/seed";
import { seedId } from "@/lib/db/admin/seed-data";
import { resolveFirmBySlug } from "@/lib/db/directory";
import { withFirm } from "@/lib/db/scoped";
import { superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The demo seed (docs/testing.md): Acme Events and Northline Rail Labour, fake data only.

const ACME = seedId("firm/acme");
const NORTHLINE = seedId("firm/northline");
const run = () => seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });

let su: Pool;
let other: Tenant;

async function snapshot() {
  const { rows } = await su.query<{ table: string; ids: string[] }>(
    `select 'workers' as table, array_agg(id::text order by id) as ids from workers where firm_id = any($1)
     union all select 'credentials', array_agg(id::text order by id) from credentials where firm_id = any($1)
     union all select 'sites', array_agg(id::text order by id) from sites where firm_id = any($1)
     union all select 'office_users', array_agg(id::text order by id) from office_users where firm_id = any($1)`,
    [[ACME, NORTHLINE]],
  );
  return rows;
}

beforeAll(async () => {
  su = superuserPool();
  other = await createTenant(su); // a firm the seed must never touch
  await run();
});
afterAll(async () => {
  await su.end();
});

describe("the demo seed", () => {
  it("running it again changes nothing: same ids, same counts, other firms untouched", async () => {
    const before = await snapshot();
    const otherBefore = await su.query(
      "select count(*)::int as n from workers where firm_id = $1",
      [other.firmId],
    );
    const summary = await run();
    expect(await snapshot()).toEqual(before);
    expect(summary.firms.map((f) => [f.slug, f.workers, f.sites])).toEqual([
      ["acme", 60, 3],
      ["northline", 30, 2],
    ]);
    const otherAfter = await su.query("select count(*)::int as n from workers where firm_id = $1", [
      other.firmId,
    ]);
    expect(otherAfter.rows).toEqual(otherBefore.rows);
  });

  it("Acme Events: 60 workers (5 with an expired SIA licence, 3 applied), 3 sites, 3 office roles", async () => {
    const { rows } = await su.query(
      `select
         (select count(*)::int from workers where firm_id = $1) as workers,
         (select count(*)::int from sites where firm_id = $1) as sites,
         (select array_agg(role order by role) from office_users where firm_id = $1) as roles,
         (select count(distinct worker_id)::int from credentials where firm_id = $1
            and type like 'SIA%' and status = 'expired' and expires_on < current_date) as expired_sia,
         (select count(distinct worker_id)::int from credentials where firm_id = $1
            and type like 'SIA%' and status = 'applied' and expires_on is null) as applied_sia`,
      [ACME],
    );
    expect(rows[0]).toEqual({
      workers: 60,
      sites: 3,
      roles: ["admin", "payroll", "resourcer"],
      expired_sia: 5,
      applied_sia: 3,
    });
  });

  it("Northline Rail Labour: 30 workers, each with PTS, Sentinel and a drugs and alcohol test", async () => {
    const { rows } = await su.query(
      `select count(*)::int as workers,
              count(*) filter (where (select array_agg(c.type::text order by c.type) from credentials c
                                       where c.worker_id = w.id) = array['PTS', 'RAIL_DA', 'SENTINEL'])::int as fully_ticketed
         from workers w where w.firm_id = $1`,
      [NORTHLINE],
    );
    expect(rows[0]).toEqual({ workers: 30, fully_ticketed: 30 });
  });

  it("is fake data only: drama-range numbers, example.com emails, TEST- credential numbers", async () => {
    const { rows } = await su.query(
      `select
         (select count(*)::int from workers where firm_id = any($1) and mobile_e164 !~ '^[+]447700900[0-9]{3}$') as real_phones,
         (select count(*)::int from workers where firm_id = any($1) and email is not null and email !~ '@example[.]com$') as worker_emails,
         (select count(*)::int from office_users where firm_id = any($1) and email !~ '@example[.]com$') as office_emails,
         (select count(*)::int from credentials where firm_id = any($1) and number is not null and number !~ '^TEST-') as real_numbers`,
      [[ACME, NORTHLINE]],
    );
    expect(rows[0]).toEqual({
      real_phones: 0,
      worker_emails: 0,
      office_emails: 0,
      real_numbers: 0,
    });
  });

  it("each firm's data is visible only inside that firm, with its own sign-off", async () => {
    const acme = await withFirm(ACME, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workers`),
    );
    const northline = await withFirm(NORTHLINE, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workers`),
    );
    expect([acme.rows[0]?.n, northline.rows[0]?.n]).toEqual([60, 30]);
    expect((await resolveFirmBySlug("acme"))?.signOff).toBe("Acme Events Shift Team");
    expect((await resolveFirmBySlug("northline"))?.signOff).toBe(
      "Northline Rail Labour Shift Team",
    );
  });

  it.each([
    ["NODE_ENV=production", "production", "postgres://x:y@localhost:5432/shiftdesk", /production/],
    [
      "a remote host",
      "development",
      "postgres://x:y@db.example.com:5432/shiftdesk",
      /this machine/,
    ],
    [
      "a remote host hidden in ?host= (pg connects there, not to localhost)",
      "development",
      "postgres://x:y@localhost:5432/shiftdesk?host=db.example.com",
      /this machine/,
    ],
    [
      "a remote host after a local one in repeated ?host= (pg uses the last)",
      "development",
      "postgres://x:y@localhost:5432/shiftdesk?host=localhost&host=db.example.com",
      /this machine/,
    ],
  ])("refuses %s before connecting", async (_label, nodeEnv, url, message) => {
    await expect(seed({ adminUrl: url, appUrl: url, nodeEnv })).rejects.toThrow(message);
  });

  it("uses invented places and no repeated names", async () => {
    const { rows } = await su.query<{ names: number; people: number; sites: string[] }>(
      `select count(distinct (w.first_name, w.last_name))::int as names, count(*)::int as people,
              (select array_agg(s.name order by s.name) from sites s where s.firm_id = w.firm_id) as sites
         from workers w where w.firm_id = any($1) group by w.firm_id order by w.firm_id`,
      [[ACME, NORTHLINE]],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.names).toBe(r.people);
      expect(r.sites.every((name) => name.includes(" Demo "))).toBe(true);
    }
  });

  it("puts a seeded worker back as seeded when run again", async () => {
    const id = seedId("acme/worker/0");
    await su.query("update workers set status = 'blocked' where id = $1", [id]);
    await run();
    const { rows } = await su.query("select status from workers where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "active" });
  });
});
