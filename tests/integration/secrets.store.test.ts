import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secretsKey, SecretUnreadable, type SecretsKey } from "@/lib/secret-store/crypto";
import { readFirmSecret } from "@/lib/db/firm-secret";
import { listSecrets, removeSecret, setSecret } from "../../scripts/firm-secret-owner";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";

// The secret store (P5.1; ADR-026): a firm's own credentials, sealed under SECRETS_KEY by the owner
// command and opened only by the worker, which reads them through app_read_firm_secret() on a
// jobs-role connection. On the real database: the app role (the web app's, and the worker's firm
// work) has no rights on the table and can't call the function; the jobs role can call the
// function but not read the table; a secret never opens for another firm or under another key.
// Made-up values only.

let su: Pool;
let app: Pool;
let jobs: Pool;
const ADMIN = urls.admin;

const newKey = (): SecretsKey => {
  const key = secretsKey(randomBytes(32).toString("base64"));
  if (!key) throw new Error("no key");
  return key;
};

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  jobs = new Pool({ connectionString: urls.jobs, max: 2 });
});
afterAll(async () => {
  await Promise.all([su.end(), app.end(), jobs.end()]);
});

async function newFirm() {
  const slug = uniqueSlug("sc");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'security') returning id::text as id",
    [`Secrets Test ${slug}`, slug],
  );
  return { firmId: rows[0]?.id ?? "", slug };
}

const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return "no error";
};

describe("the owner's command", () => {
  it("adds, replaces and removes a firm's secret, logged by name only; the listing shows no value", async () => {
    const f = await newFirm();
    const key = newKey();
    expect(await setSecret(ADMIN, f.slug, key, "portal.api_key", "made-up-key-0001")).toEqual({
      status: "added",
      name: "portal.api_key",
    });
    expect(await setSecret(ADMIN, f.slug, key, "portal.api_key", "made-up-key-0002")).toEqual({
      status: "replaced",
      name: "portal.api_key",
    });
    expect(await readFirmSecret(jobs, key, { firmId: f.firmId, name: "portal.api_key" })).toBe(
      "made-up-key-0002",
    );
    const listed = await listSecrets(ADMIN, f.slug);
    expect(listed).toMatchObject({
      status: "ok",
      rows: [{ name: "portal.api_key", keyId: key.id }],
    });
    expect(JSON.stringify(listed)).not.toContain("made-up-key");
    // Stored sealed: the value isn't in the row.
    const { rows: stored } = await su.query<{ ciphertext: Buffer }>(
      "select ciphertext from firm_secrets where firm_id = $1",
      [f.firmId],
    );
    expect(stored[0]?.ciphertext.includes(Buffer.from("made-up-key"))).toBe(false);
    expect(await removeSecret(ADMIN, f.slug, "portal.api_key")).toEqual({
      status: "removed",
      name: "portal.api_key",
    });
    expect(await removeSecret(ADMIN, f.slug, "portal.api_key")).toEqual({ status: "not_there" });
    expect(
      await readFirmSecret(jobs, key, { firmId: f.firmId, name: "portal.api_key" }),
    ).toBeNull();
    const { rows: events } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'firm.settings_changed' order by id",
      [f.firmId],
    );
    expect(events.map((e) => e.data)).toEqual([
      { keys: ["secret.portal.api_key"], change: "added" },
      { keys: ["secret.portal.api_key"], change: "replaced" },
      { keys: ["secret.portal.api_key"], change: "removed" },
    ]);
    expect(JSON.stringify(events)).not.toContain("made-up-key");
    expect(await setSecret(ADMIN, f.slug, key, "Not A Name", "x")).toEqual({ status: "bad_name" });
    expect(await setSecret(ADMIN, "no-such-firm", key, "portal.api_key", "x")).toEqual({
      status: "no_firm",
    });
  });
});

describe("who can read a secret", () => {
  it("never the app role: no rights on the table, and it can't call the read", async () => {
    const f = await newFirm();
    await setSecret(ADMIN, f.slug, newKey(), "portal.api_key", "made-up-key-0003");
    const inFirm = async (sql: string, values: unknown[] = []) => {
      const c = await app.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.current_firm_id', $1, true)", [f.firmId]);
        return await c.query(sql, values);
      } finally {
        await c.query("rollback").catch(() => undefined);
        c.release();
      }
    };
    for (const sql of [
      "select * from firm_secrets",
      "insert into firm_secrets (firm_id, name, ciphertext, nonce, key_id) values (app_current_firm_id(), 'x', '\\x00', '\\x00', 'aaaaaaaaaaaa')",
      "delete from firm_secrets",
    ]) {
      expect(await pgCode(inFirm(sql)), sql).toBe("42501"); // permission denied
    }
    expect(
      await pgCode(inFirm("select * from app_read_firm_secret($1, 'portal.api_key')", [f.firmId])),
    ).toBe("42501");
  });

  it("the jobs role only through the function: never the table itself", async () => {
    const f = await newFirm();
    const key = newKey();
    await setSecret(ADMIN, f.slug, key, "portal.webhook_secret", "made-up-hook-0004");
    expect(await pgCode(jobs.query("select * from firm_secrets"))).toBe("42501");
    expect(
      await readFirmSecret(jobs, key, { firmId: f.firmId, name: "portal.webhook_secret" }),
    ).toBe("made-up-hook-0004");
  });

  it("one firm's secret never opens as another's, nor under another key", async () => {
    const a = await newFirm();
    const b = await newFirm();
    const key = newKey();
    await setSecret(ADMIN, a.slug, key, "portal.api_key", "made-up-key-a");
    await setSecret(ADMIN, b.slug, key, "portal.api_key", "made-up-key-b");
    expect(await readFirmSecret(jobs, key, { firmId: a.firmId, name: "portal.api_key" })).toBe(
      "made-up-key-a",
    );
    // B's sealed value copied onto A's row (as a database breach might): it doesn't open as A's.
    await su.query(
      `update firm_secrets a set ciphertext = b.ciphertext, nonce = b.nonce
         from firm_secrets b
        where a.firm_id = $1 and b.firm_id = $2 and a.name = b.name`,
      [a.firmId, b.firmId],
    );
    await expect(
      readFirmSecret(jobs, key, { firmId: a.firmId, name: "portal.api_key" }),
    ).rejects.toMatchObject({ code: "does_not_open" });
    // Another SECRETS_KEY: refused, never a wrong value.
    await expect(
      readFirmSecret(jobs, newKey(), { firmId: b.firmId, name: "portal.api_key" }),
    ).rejects.toBeInstanceOf(SecretUnreadable);
  });
});
