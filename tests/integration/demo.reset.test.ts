import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_DATABASE_TAG,
  demoReset,
  demoResetRefusal,
  type DemoResetOptions,
} from "@/lib/db/admin/demo-reset";
import { runMigrations } from "@/lib/db/admin/migrate";
import { databaseName, withDatabase } from "@/lib/db/admin/urls";
import { createWithFirm } from "@/lib/db/scoped";
import { isDemoFirm } from "@/lib/demo/firms";
import { NotADemoServer } from "@/lib/demo/guard";
import { isMadeUpEmail } from "@/lib/demo/made-up";
import { seedId } from "@/lib/demo/seed-id";
import { urls } from "../helpers/db";
import { LOOK_ALIKE_EMAILS } from "../helpers/look-alike-emails";

// The demo server's reset (16.2; ADR-025), for real, on a database of its own in the test Postgres:
// it refuses anywhere that isn't a demo server, before anything is dropped; it loads the made-up
// demo afresh, as production (NODE_ENV=production, as on the server); it empties the outbox; and
// the demo database it makes refuses real people itself, by the same rule as the worker's check.

// Its own database, named like every test database (the app's connection check wants "_test").
const NAME = `${databaseName(urls.admin).replace(/_test$/, "")}_demoreset_test`;
const at = (url: string) => withDatabase(url, NAME);
let outbox: string;
const options = (): DemoResetOptions => ({
  demoMode: "on",
  nodeEnv: "production",
  adminUrl: at(urls.admin),
  appUrl: at(urls.app),
  jobsUrl: at(urls.jobs),
  outboxFile: outbox,
  today: new Date("2026-10-20T09:00:00Z"),
});

async function asSuperuser<T>(fn: (c: Client) => Promise<T>, database = NAME): Promise<T> {
  const c = new Client({ connectionString: withDatabase(urls.superuser, database) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const dropIt = () =>
  asSuperuser((c) => c.query(`drop database if exists ${NAME} with (force)`), "postgres");

beforeAll(async () => {
  outbox = join(await mkdtemp(join(tmpdir(), "demo-reset-")), "outbox.jsonl");
  await dropIt();
});
afterAll(dropIt);

describe("the demo reset's refusals, before any connection", () => {
  it("not in demo mode", () => {
    expect(demoResetRefusal({ ...options(), demoMode: undefined })).toMatch(/DEMO_MODE=on/);
  });

  it("any database address that isn't on this server", () => {
    for (const key of ["adminUrl", "appUrl", "jobsUrl"] as const) {
      const elsewhere = { ...options(), [key]: "postgres://u:p@db.example.com:5432/shiftdesk" };
      expect(demoResetRefusal(elsewhere), key).toMatch(/a database on this server/);
    }
    // A socket, as on the demo server, is this server.
    expect(
      demoResetRefusal({
        ...options(),
        appUrl: "postgres://shiftdesk_app:p@localhost/shiftdesk?host=/var/run/postgresql",
      }),
    ).toBeNull();
  });

  it("an owner login without its role switch", () => {
    expect(
      demoResetRefusal({ ...options(), adminUrl: "postgres://postgres:p@localhost/shiftdesk" }),
    ).toMatch(/options=-c role=<owner>/);
  });

  it("refused means nothing happens", async () => {
    await expect(demoReset({ ...options(), demoMode: undefined })).rejects.toThrow(/DEMO_MODE/);
    const exists = await asSuperuser(
      (c) => c.query("select 1 from pg_database where datname = $1", [NAME]),
      "postgres",
    );
    expect(exists.rowCount).toBe(0);
  });
});

describe("the demo reset's refusals, on the database", () => {
  it("a database the reset didn't make (no demo tag) is left as it is", async () => {
    const other = `${databaseName(urls.admin).replace(/_test$/, "")}_demoreset_other_test`;
    await asSuperuser((c) => c.query(`drop database if exists ${other} with (force)`), "postgres");
    await asSuperuser((c) => c.query(`create database ${other}`), "postgres");
    try {
      const elsewhere = {
        ...options(),
        adminUrl: withDatabase(urls.admin, other),
        appUrl: withDatabase(urls.app, other),
        jobsUrl: withDatabase(urls.jobs, other),
      };
      await expect(demoReset(elsewhere)).rejects.toThrow(
        /wasn't made by the demo reset \(it has no demo tag\), so the database is left as it is/,
      );
      const still = await asSuperuser(
        (c) => c.query("select 1 from pg_database where datname = $1", [other]),
        "postgres",
      );
      expect(still.rowCount).toBe(1);
    } finally {
      await asSuperuser(
        (c) => c.query(`drop database if exists ${other} with (force)`),
        "postgres",
      );
    }
  });

  it("a login that isn't the database's superuser (row security would hide the firms from it)", async () => {
    const probe = `demo_reset_probe_${process.pid}`;
    await asSuperuser(
      (c) =>
        c.query(`create role ${probe} login password 'probe-password' nosuperuser nobypassrls`),
      "postgres",
    );
    try {
      const login = new URL(urls.admin);
      login.username = probe;
      login.password = "probe-password";
      const refused = demoReset({ ...options(), adminUrl: withDatabase(login.toString(), NAME) });
      await expect(refused).rejects.toBeInstanceOf(NotADemoServer);
      await expect(refused).rejects.toThrow(/logs in as the database's superuser/);
    } finally {
      await asSuperuser((c) => c.query(`drop role if exists ${probe}`), "postgres");
    }
  });
});

describe("the demo reset, run", () => {
  it("loads the made-up demo afresh, as production, and empties the outbox", async () => {
    await writeFile(outbox, '{"at":"2026-10-19T09:00:00.000Z"}\n');
    const summary = await demoReset(options());
    expect(summary.firms.map((f) => f.slug)).toEqual(["acme", "northline"]);
    expect(await readFile(outbox, "utf8")).toBe("");
    // Tagged as the reset's own, so the next reset may drop it.
    const tag = await asSuperuser(
      (c) =>
        c.query<{ tag: string }>(
          "select shobj_description(oid, 'pg_database') as tag from pg_database where datname = $1",
          [NAME],
        ),
      "postgres",
    );
    expect(tag.rows[0]?.tag).toBe(DEMO_DATABASE_TAG);
    const firms = await asSuperuser((c) => c.query<{ id: string }>("select id::text from firms"));
    expect(firms.rows.map((r) => r.id).sort()).toEqual(
      [seedId("firm/acme"), seedId("firm/northline")].sort(),
    );
    // What a visitor did is gone after the next reset.
    await asSuperuser((c) =>
      c.query("update workers set first_name = 'Changed' where firm_id = $1", [
        seedId("firm/acme"),
      ]),
    );
    await demoReset(options());
    const changed = await asSuperuser((c) =>
      c.query("select 1 from workers where first_name = 'Changed'"),
    );
    expect(changed.rowCount).toBe(0);
  }, 180_000);

  it("its database refuses real people, as the app writes them too; the app can't switch that off; it survives a deploy's migrations", async () => {
    const acme = seedId("firm/acme");
    const app = new Pool({ connectionString: at(urls.app), max: 1 });
    try {
      const withFirm = createWithFirm(app);
      await expect(
        withFirm(acme, (tx) =>
          tx.execute(
            sql`insert into workers (firm_id, first_name, last_name, mobile_e164) values (${acme}, 'Real', 'Person', '+441134960101')`,
          ),
        ),
      ).rejects.toSatisfy((err: unknown) =>
        /demo: only made-up mobile numbers/.test(
          String((err as { cause?: { message?: string } }).cause?.message ?? err),
        ),
      );
      const asApp = new Client({ connectionString: at(urls.app) });
      await asApp.connect();
      try {
        for (const statement of [
          "drop trigger demo_only_made_up_people on workers",
          "alter table workers disable trigger demo_only_made_up_people",
          "drop function demo_only_made_up_people() cascade",
        ]) {
          await expect(asApp.query(statement), statement).rejects.toThrow(
            /must be (the )?owner|permission denied/,
          );
        }
      } finally {
        await asApp.end();
      }
    } finally {
      await app.end();
    }
    // A new image's deploy runs the migrations again (deploy.sh): the rule stays.
    await runMigrations({ adminUrl: at(urls.admin), appUrl: at(urls.app), jobsUrl: at(urls.jobs) });
    const triggers = await asSuperuser((c) =>
      c.query<{ table: string }>(
        "select tgrelid::regclass::text as table from pg_trigger where tgname = 'demo_only_made_up_people' order by 1",
      ),
    );
    expect(triggers.rows.map((r) => r.table)).toEqual(["office_users", "workers"]);
  }, 120_000);

  it("its database refuses real people (here as the superuser), by the worker's own rule", async () => {
    const acme = seedId("firm/acme");
    const insertWorker = (mobile: string | null, email: string | null) =>
      asSuperuser((c) =>
        c.query(
          "insert into workers (firm_id, first_name, last_name, mobile_e164, email) values ($1, 'Try', 'Person', $2, $3)",
          [acme, mobile, email],
        ),
      );
    await expect(insertWorker("+441134960101", null)).rejects.toThrow(
      /demo: only made-up mobile numbers/,
    );
    await expect(insertWorker("+447700900990", LOOK_ALIKE_EMAILS.work)).rejects.toThrow(
      /demo: only made-up email addresses/,
    );
    await expect(insertWorker("+447700900990", "made.up@example.com")).resolves.toBeTruthy();
    await expect(
      asSuperuser((c) =>
        c.query(
          "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Boss', 'admin')",
          [acme, LOOK_ALIKE_EMAILS.sameLetters],
        ),
      ),
    ).rejects.toThrow(/demo: only made-up email addresses/);
    // Changing someone to a real number is refused too.
    await expect(
      asSuperuser((c) =>
        c.query("update workers set mobile_e164 = '+441134960101' where firm_id = $1", [acme]),
      ),
    ).rejects.toThrow(/demo: only made-up mobile numbers/);

    // The database's email rule and src/lib/demo/made-up.ts agree, case by case.
    const cases = [
      "acme.admin@example.com",
      "Payroll@EXAMPLE.ORG",
      "zoe@mail.example.com",
      "office@acme-events.example",
      "x@shifts.test",
      "x@nowhere.invalid",
      "x@localhost",
      "a@.example.com",
      "a@example.com.",
      " a@example.com ",
      "a@b@example.com",
      ...Object.values(LOOK_ALIKE_EMAILS),
      "example.com",
      "@example.com",
      "a@",
    ];
    const sql = await asSuperuser((c) =>
      c.query<{ address: string; ok: boolean }>(
        "select address, demo_made_up_email(address) as ok from unnest($1::text[]) as address",
        [cases],
      ),
    );
    expect(sql.rows.map((r) => [r.address, r.ok])).toEqual(
      cases.map((address) => [address, isMadeUpEmail(address)]),
    );
  }, 60_000);

  it("never drops a database holding a firm that isn't a demo firm", async () => {
    const real = "0f3c2b8e-9a41-4d7e-8b2a-5c6d7e8f9a0b";
    expect(isDemoFirm(real)).toBe(false);
    await asSuperuser((c) =>
      c.query(
        "insert into firms (id, name, slug, sector) values ($1, 'Real Firm', 'realfirm', 'security')",
        [real],
      ),
    );
    const refused = demoReset(options());
    await expect(refused).rejects.toBeInstanceOf(NotADemoServer);
    await expect(refused).rejects.toThrow(/1 firm isn't one of the made-up demo firms/);
    const still = await asSuperuser((c) => c.query("select 1 from firms where id = $1", [real]));
    expect(still.rowCount).toBe(1);
  }, 60_000);
});
