import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createKeyDirectory, resolveApiKey } from "@/lib/db/directory";
import { apiKeyHash, apiKeyHint, newApiKey } from "@/lib/integrations/keys";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The planner's API keys (12J.1; S11; ADR-022): the third look-up allowed before a firm is known,
// app_api_key_lookup(hash), beside the host's and the shifts line's; and what the app's login may
// do to api_keys (read, add, and change only last_used_at, revoked_at and revoked_by). On the real
// database, as the app role; keys are added as the superuser.

let su: Pool;
let app: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool(2);
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// A new key for the firm, made by its office user, as the page would store it: its hash and hint.
async function addKey(
  t: Tenant,
  opts: { revoked?: boolean } = {},
): Promise<{ key: string; id: string; hash: Buffer }> {
  const key = newApiKey();
  const hash = apiKeyHash(key);
  const { rows } = await su.query<{ id: string }>(
    `insert into api_keys (firm_id, label, token_hash, hint, created_by, revoked_by, revoked_at)
     values ($1, 'Planner', $2, $3, $4, $5, $6) returning id::text as id`,
    [
      t.firmId,
      hash,
      apiKeyHint(key),
      t.officeUserId,
      opts.revoked ? t.officeUserId : null,
      opts.revoked ? new Date() : null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("api key insert returned no id");
  return { key, id, hash };
}

describe("app_api_key_lookup()", () => {
  it("runs as its owner with a pinned search_path, only the app role may call it, ids only", async () => {
    const { rows } = await su.query<{
      definer: boolean;
      config: string[];
      acl: string[];
      result: string;
    }>(
      `select prosecdef as definer, proconfig as config, proacl::text[] as acl,
              pg_get_function_result(oid) as result
         from pg_proc where oid = 'app_api_key_lookup(bytea)'::regprocedure`,
    );
    const fn = rows[0];
    expect(fn?.definer).toBe(true);
    expect(fn?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(fn?.result).toBe("TABLE(firm_id uuid, key_id uuid)");
    // No "=X/..." entry: PUBLIC can't execute it; the jobs role can't either.
    expect(fn?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
    expect(fn?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
    expect(fn?.acl.some((entry) => entry.startsWith("shiftdesk_jobs="))).toBe(false);
  });

  it("the jobs role is refused if it tries", async () => {
    const { hash } = await addKey(A);
    const jobs = new Pool({ connectionString: urls.jobs, max: 1 });
    try {
      expect(
        await pgError(jobs.query("select * from app_api_key_lookup($1)", [hash])),
      ).toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied/) });
    } finally {
      await jobs.end();
    }
  });

  it("gives a live key's firm id and key id, and nothing else, with no firm set", async () => {
    const { hash, id } = await addKey(A);
    const result = await inFirm(app, null, (c) =>
      c.query("select * from app_api_key_lookup($1)", [hash]),
    );
    expect(result.fields.map((f) => f.name)).toEqual(["firm_id", "key_id"]);
    expect(result.rows).toEqual([{ firm_id: A.firmId, key_id: id }]);
  });

  it("gives no row for a revoked key, an unknown hash or another length", async () => {
    const revoked = await addKey(A, { revoked: true });
    const live = await addKey(A);
    for (const hash of [revoked.hash, apiKeyHash(newApiKey()), live.hash.subarray(0, 31)]) {
      const { rowCount } = await inFirm(app, null, (c) =>
        c.query("select * from app_api_key_lookup($1)", [hash]),
      );
      expect(rowCount).toBe(0);
    }
  });
});

describe("resolveApiKey: the key decides the firm", () => {
  it("finds each firm's live key, and nothing for a revoked or unknown one", async () => {
    const byKey = createKeyDirectory(app);
    const a = await addKey(A);
    const b = await addKey(B);
    const revoked = await addKey(B, { revoked: true });
    expect(await byKey(apiKeyHash(a.key))).toEqual({ firmId: A.firmId, keyId: a.id });
    expect(await byKey(apiKeyHash(b.key))).toEqual({ firmId: B.firmId, keyId: b.id });
    expect(await byKey(apiKeyHash(revoked.key))).toBeNull();
    expect(await byKey(apiKeyHash(newApiKey()))).toBeNull();
    // The default directory, on the app's own pool, says the same.
    expect(await resolveApiKey(apiKeyHash(a.key))).toEqual({ firmId: A.firmId, keyId: a.id });
    expect(await resolveApiKey(apiKeyHash(revoked.key))).toBeNull();
  });

  it("a key revoked by the app is refused from then on", async () => {
    const byKey = createKeyDirectory(app);
    const k = await addKey(A);
    expect(await byKey(k.hash)).toEqual({ firmId: A.firmId, keyId: k.id });
    await inFirm(
      app,
      A.firmId,
      (c) =>
        c.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
          k.id,
          A.officeUserId,
        ]),
      { commit: true },
    );
    expect(await byKey(k.hash)).toBeNull();
  });

  it("anything but a 32-byte hash is nobody, without asking the database", async () => {
    const pool = appRolePool(1);
    try {
      const query = vi.spyOn(pool, "query");
      const connect = vi.spyOn(pool, "connect");
      const byKey = createKeyDirectory(pool);
      const k = await addKey(A);
      for (const hash of [
        Buffer.alloc(0),
        k.hash.subarray(0, 31),
        Buffer.concat([k.hash, Buffer.from([0])]),
        Buffer.from(k.key, "utf8"), // the key itself, not its hash
      ]) {
        expect(await byKey(hash)).toBeNull();
        expect(await resolveApiKey(hash)).toBeNull();
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      // The control: a 32-byte hash does ask.
      expect(await byKey(k.hash)).toEqual({ firmId: A.firmId, keyId: k.id });
      expect(query).toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });
});

describe("what the app's login may do to api_keys", () => {
  it.each([
    [
      "the key's hash",
      "update api_keys set token_hash = $2 where id = $1",
      () => apiKeyHash(newApiKey()),
    ],
    ["the key's label", "update api_keys set label = $2 where id = $1", () => "Renamed"],
    ["the key's hint", "update api_keys set hint = $2 where id = $1", () => "abcd"],
    ["who made it", "update api_keys set created_by = $2 where id = $1", () => A.officeUserId],
    ["its firm", "update api_keys set firm_id = $2 where id = $1", () => A.firmId],
  ])("can't change %s (permission denied)", async (_label, statement, value) => {
    const k = await addKey(A);
    const err = await pgError(inFirm(app, A.firmId, (c) => c.query(statement, [k.id, value()])));
    expect(err).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/),
    });
  });

  it("can't delete a key, even its own firm's (its id is the actor on every change it made)", async () => {
    const k = await addKey(A);
    const err = await pgError(
      inFirm(app, A.firmId, (c) => c.query("delete from api_keys where id = $1", [k.id])),
    );
    expect(err).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/),
    });
  });

  it("can mark a key used, and revoke it (who and when, together)", async () => {
    const k = await addKey(A);
    await inFirm(app, A.firmId, async (c) => {
      const used = await c.query("update api_keys set last_used_at = now() where id = $1", [k.id]);
      expect(used.rowCount).toBe(1);
      const revoked = await c.query(
        "update api_keys set revoked_at = now(), revoked_by = $2 where id = $1",
        [k.id, A.officeUserId],
      );
      expect(revoked.rowCount).toBe(1);
    });
    // Never one without the other.
    const err = await pgError(
      inFirm(app, A.firmId, (c) =>
        c.query("update api_keys set revoked_at = now() where id = $1", [k.id]),
      ),
    );
    expect(err).toMatchObject({
      code: "23514",
      message: expect.stringMatching(/revoked_together/),
    });
  });

  it("can't bring a revoked key back, or change who revoked it or when (migration 0046)", async () => {
    const k = await addKey(A, { revoked: true });
    const { rows: others } = await su.query<{ id: string }>(
      `insert into office_users (firm_id, email, name, role)
       values ($1, 'revoker.other@example.com', 'Other Admin', 'admin') returning id::text as id`,
      [A.firmId],
    );
    const other = others[0]?.id ?? "";
    for (const [statement, values] of [
      ["update api_keys set revoked_at = null, revoked_by = null where id = $1", [k.id]],
      ["update api_keys set revoked_at = now() + interval '1 day' where id = $1", [k.id]],
      ["update api_keys set revoked_by = $2 where id = $1", [k.id, other]],
    ] as const) {
      const err = await pgError(inFirm(app, A.firmId, (c) => c.query(statement, [...values])));
      expect(err).toMatchObject({
        code: "23514",
        message: "an API key's revocation is final",
      });
    }
    // Not even the owner (the trigger binds every role).
    expect(
      await pgError(
        su.query("update api_keys set revoked_at = null, revoked_by = null where id = $1", [k.id]),
      ),
    ).toEqual({ code: "23514", message: "an API key's revocation is final" });
    const { rows } = await su.query<{ live: boolean }>(
      "select revoked_at is null as live from api_keys where id = $1",
      [k.id],
    );
    expect(rows).toEqual([{ live: false }]);
    expect(await createKeyDirectory(app)(k.hash)).toBeNull();
  });

  it("can add a key for its own firm, never with another firm's hash (one key, one firm)", async () => {
    const theirs = await addKey(B);
    const add = (hash: Buffer) =>
      inFirm(app, A.firmId, (c) =>
        c.query(
          `insert into api_keys (firm_id, label, token_hash, hint, created_by)
           values ($1, 'Planner', $2, 'abcd', $3)`,
          [A.firmId, hash, A.officeUserId],
        ),
      );
    expect((await add(apiKeyHash(newApiKey()))).rowCount).toBe(1);
    expect(await pgError(add(theirs.hash))).toMatchObject({
      code: "23505",
      message: expect.stringMatching(/api_keys_token_hash_unique/),
    });
  });
});

describe("one firm's keys are invisible to another", () => {
  it("firm B can't read or change firm A's key; firm A can read it; with no firm set, nobody can", async () => {
    const k = await addKey(A);
    const read = (firmId: string | null) =>
      inFirm(app, firmId, (c) =>
        c
          .query("select id, token_hash, label from api_keys where id = $1", [k.id])
          .then((r) => r.rowCount),
      );
    expect(await read(A.firmId)).toBe(1);
    expect(await read(B.firmId)).toBe(0);
    expect(await read(null)).toBe(0);
    const touch = (firmId: string) =>
      inFirm(app, firmId, (c) =>
        c
          .query(
            "update api_keys set last_used_at = now(), revoked_at = now(), revoked_by = $2 where id = $1",
            [k.id, B.officeUserId],
          )
          .then((r) => r.rowCount),
      );
    expect(await touch(B.firmId)).toBe(0);
    const all = await inFirm(app, B.firmId, (c) =>
      c.query<{ firm_id: string }>("select firm_id::text as firm_id from api_keys"),
    );
    expect(all.rows.every((r) => r.firm_id === B.firmId)).toBe(true);
    // Still live, and still firm A's.
    expect(await createKeyDirectory(app)(k.hash)).toEqual({ firmId: A.firmId, keyId: k.id });
  });
});
