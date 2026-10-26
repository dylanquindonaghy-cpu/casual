import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDatabase } from "@/lib/db/admin/urls";
import { activeFirmId, createWithFirm, withFirm } from "@/lib/db/scoped";
import { ownerPool, superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// How the scoped client sets the firm: per transaction, never per connection.

let su: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool();
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

const settingAndPid = (client: { query: Pool["query"] }) =>
  client
    .query<{ pid: number; setting: string | null; firm: string | null }>(
      `select pg_backend_pid() as pid, current_setting('app.current_firm_id', true) as setting,
              app_current_firm_id() as firm`,
    )
    .then((r) => r.rows[0]);

describe("withFirm", () => {
  it("runs on the *_test database as shiftdesk_app with the firm set", async () => {
    const row = await withFirm(A.firmId, async (tx) => {
      const r = await tx.execute<{ db: string; user: string; firm: string }>(
        sql`select current_database() as db, current_user as user, app_current_firm_id() as firm`,
      );
      return r.rows[0];
    });
    expect(row).toEqual({ db: urls.name, user: "shiftdesk_app", firm: A.firmId });
  });

  it("the firm setting ends with the transaction, on the very same pooled connection", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      const scoped = createWithFirm(pool);
      const inside = await scoped(A.firmId, async (tx) => {
        const r = await tx.execute<{ pid: number; firm: string }>(
          sql`select pg_backend_pid() as pid, app_current_firm_id() as firm`,
        );
        return r.rows[0];
      });
      expect(inside?.firm).toBe(A.firmId);

      const client = await pool.connect();
      try {
        const after = await settingAndPid(client);
        expect(after?.pid).toBe(inside?.pid); // same backend, so the check means something
        expect(after?.setting).toBe(""); // '' after a local setting ends, hence nullif()
        expect(after?.firm).toBeNull();
        const visible = await client.query<{ n: number }>("select count(*)::int as n from workers");
        expect(visible.rows[0]?.n).toBe(0);
      } finally {
        client.release();
      }

      // Canary: a session-level set_config (is_local = false) DOES leak into the next checkout,
      // so the assertions above would catch withFirm using it.
      const leaky = await pool.connect();
      await leaky.query("select set_config('app.current_firm_id', $1, false)", [A.firmId]);
      leaky.release();
      const next = await pool.connect();
      try {
        expect((await settingAndPid(next))?.firm).toBe(A.firmId);
        await next.query("select set_config('app.current_firm_id', '', false)");
      } finally {
        next.release();
      }
    } finally {
      await pool.end();
    }
  });

  it("two firms at the same moment each see only their own rows", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 2 });
    try {
      const scoped = createWithFirm(pool);
      let arrived = 0;
      let release: () => void = () => undefined;
      const bothInside = new Promise<void>((resolve) => (release = resolve));
      const look = (firmId: string) =>
        scoped(firmId, async (tx) => {
          arrived += 1;
          if (arrived === 2) release();
          await bothInside; // both transactions are open, each with its own firm set
          const r = await tx.execute<{ firm_id: string }>(
            sql`select distinct firm_id from workers`,
          );
          return { rows: r.rows.map((x) => x.firm_id), active: activeFirmId() };
        });
      const [a, b] = await Promise.all([look(A.firmId), look(B.firmId)]);
      expect(a).toEqual({ rows: [A.firmId], active: A.firmId });
      expect(b).toEqual({ rows: [B.firmId], active: B.firmId });
    } finally {
      await pool.end();
    }
  });

  it("an error inside rolls back everything written in it", async () => {
    const entityId = crypto.randomUUID();
    await expect(
      withFirm(A.firmId, async (tx) => {
        await tx.execute(
          sql`insert into events (firm_id, actor_type, action, entity_type, entity_id)
              values (${A.firmId}, 'system', 'test.rollback', 'test', ${entityId})`,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const truth = await su.query("select 1 from events where entity_id = $1", [entityId]);
    expect(truth.rowCount).toBe(0);
  });

  it("refuses to nest (a nested firm would leak into the outer transaction)", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      const scoped = createWithFirm(pool);
      // With one connection a nested call would otherwise wait forever for the pool.
      await expect(scoped(A.firmId, () => scoped(B.firmId, async () => "inner"))).rejects.toThrow(
        /cannot be nested/,
      );
    } finally {
      await pool.end();
    }
  }, 5_000);

  it("rejects an invalid firm id before opening a connection", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      await expect(createWithFirm(pool)("not-a-uuid", async () => 1)).rejects.toThrow(/UUID/i);
      expect(pool.totalCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("activeFirmId is only set inside withFirm", async () => {
    expect(activeFirmId()).toBeUndefined();
    expect(await withFirm(B.firmId, async () => activeFirmId())).toBe(B.firmId);
    expect(activeFirmId()).toBeUndefined();
  });
});

describe("the connection check", () => {
  it.each([
    ["the superuser", () => superuserPool(1), /connected as shiftdesk.*superuser/],
    ["the table owner", () => ownerPool(1), /owns tables in public/],
  ])("refuses to run as %s, which RLS would not restrict", async (_label, makePool, message) => {
    const pool = makePool();
    try {
      await expect(createWithFirm(pool)(A.firmId, async () => 1)).rejects.toThrow(message);
    } finally {
      await pool.end();
    }
  });

  it("refuses a database that isn't *_test while tests run", async () => {
    const pool = new Pool({ connectionString: withDatabase(urls.app, "postgres"), max: 1 });
    try {
      await expect(createWithFirm(pool)(A.firmId, async () => 1)).rejects.toThrow(
        /tests must use a \*_test database, not postgres/,
      );
    } finally {
      await pool.end();
    }
  });
});

// The time limits (P4.2; ADR-027): set by withFirm per transaction, like the firm.
describe("withFirm's time limits", () => {
  const code = (err: unknown) =>
    (err as { code?: string; cause?: { code?: string } }).cause?.code ??
    (err as { code?: string }).code;
  const settings = (client: { query: Pool["query"] }) =>
    client
      .query<{ pid: number; statement: string; idle: string }>(
        `select pg_backend_pid() as pid, current_setting('statement_timeout') as statement,
                current_setting('idle_in_transaction_session_timeout') as idle`,
      )
      .then((r) => r.rows[0]);

  it("are set inside the transaction and gone after it, on the very same pooled connection", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      const limited = createWithFirm(pool, {
        limits: { statementMs: 1234, idleInTransactionMs: 5678 },
      });
      const inside = await limited(A.firmId, async (tx) => {
        const { rows } = await tx.execute<{ pid: number; statement: string; idle: string }>(
          sql`select pg_backend_pid() as pid, current_setting('statement_timeout') as statement,
                     current_setting('idle_in_transaction_session_timeout') as idle`,
        );
        return rows[0];
      });
      expect(inside).toMatchObject({ statement: "1234ms", idle: "5678ms" });
      const after = await settings(pool);
      expect(after?.pid).toBe(inside?.pid);
      expect(after).toMatchObject({ statement: "0", idle: "0" });
    } finally {
      await pool.end();
    }
  });

  it("a statement that runs too long fails (57014), and the next transaction works", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      const limited = createWithFirm(pool, {
        limits: { statementMs: 200, idleInTransactionMs: 0 },
      });
      const slow = limited(A.firmId, (tx) => tx.execute(sql`select pg_sleep(2)`));
      await expect(slow).rejects.toSatisfy((err: unknown) => code(err) === "57014");
      expect(
        await limited(A.firmId, async (tx) => (await tx.execute(sql`select 1 as one`)).rows),
      ).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it("a transaction left idle too long is ended, and the pool carries on", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    // The ended connection's own error, on the idle pool and on the client lent out, as appPool()
    // logs both (else Node treats it as unhandled).
    pool.on("error", () => undefined);
    pool.on("connect", (client) => client.on("error", () => undefined));
    try {
      const limited = createWithFirm(pool, {
        limits: { statementMs: 0, idleInTransactionMs: 200 },
      });
      const idle = limited(A.firmId, async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await tx.execute(sql`select 1`);
      });
      // Postgres ends the connection (25P03), so the transaction's next statement finds it gone.
      await expect(idle).rejects.toSatisfy((err: unknown) =>
        /connection error and is not queryable|terminating connection/i.test(
          String((err as { cause?: { message?: string } }).cause?.message ?? err),
        ),
      );
      expect(
        await limited(A.firmId, async (tx) => (await tx.execute(sql`select 1 as one`)).rows),
      ).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it("a full pool fails the wait instead of hanging, and counts it", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1, connectionTimeoutMillis: 300 });
    try {
      const waits = { slow: 0, timedOut: 0 };
      const counted = createWithFirm(pool, { waits });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered: () => void = () => undefined;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const holding = counted(A.firmId, async () => {
        entered();
        await gate;
      });
      await inside;
      const started = Date.now();
      await expect(counted(A.firmId, async () => 1)).rejects.toThrow(
        /timeout exceeded when trying to connect/,
      );
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(waits).toEqual({ slow: 0, timedOut: 1 });
      release();
      await holding;
    } finally {
      await pool.end();
    }
  });

  it("a wait of a second or more for a connection is counted as slow", async () => {
    const pool = new Pool({ connectionString: urls.app, max: 1 });
    try {
      const waits = { slow: 0, timedOut: 0 };
      const counted = createWithFirm(pool, { waits });
      let entered: () => void = () => undefined;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const holding = counted(A.firmId, async () => {
        entered();
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      });
      await inside;
      expect(await counted(A.firmId, async () => "after the wait")).toBe("after the wait");
      await holding;
      expect(waits).toEqual({ slow: 1, timedOut: 0 });
    } finally {
      await pool.end();
    }
  });
});
