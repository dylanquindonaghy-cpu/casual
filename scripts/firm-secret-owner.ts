import { Client } from "pg";
import { sealSecret, SECRET_NAME, type SecretsKey } from "../src/lib/secrets/crypto";

// A firm's secrets (P5.1, `npm run firm:secret`, scripts/firm-secret.ts; ADR-026): sealed here with
// SECRETS_KEY (src/lib/secrets/crypto.ts) and written as the owner, the only one with rights on
// firm_secrets; RLS is forced for the owner too, so each change runs with the firm set for its
// transaction only. The listing gives names and dates, never a value. Each change is logged
// `firm.settings_changed` {keys: ["secret.<name>"], change: "added" | "replaced" | "removed"}:
// never the value, its length or its sealed form.

export interface SecretRow {
  name: string;
  updatedAt: Date;
  keyId: string;
}

export type SetSecretResult =
  | { status: "added" | "replaced"; name: string }
  | { status: "removed"; name: string }
  | { status: "not_there" }
  | { status: "no_firm" }
  | { status: "bad_name" };

async function withOwnerFirm<T>(
  adminUrl: string,
  slug: string,
  fn: (owner: Client, firmId: string) => Promise<T>,
): Promise<T | "no_firm"> {
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [slug],
    );
    const firmId = rows[0]?.id;
    if (!firmId) return "no_firm";
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      const result = await fn(owner, firmId);
      await owner.query("commit");
      return result;
    } catch (err) {
      await owner.query("rollback").catch(() => undefined);
      throw err;
    }
  } finally {
    await owner.end();
  }
}

const log = (owner: Client, firmId: string, name: string, change: string) =>
  owner.query(
    `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
     values ($1, 'system', 'firm.settings_changed', 'firm', $1, $2)`,
    [firmId, JSON.stringify({ keys: [`secret.${name}`], change })],
  );

export async function listSecrets(
  adminUrl: string,
  slug: string,
): Promise<{ status: "ok"; rows: SecretRow[] } | { status: "no_firm" }> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{ name: string; updated_at: Date; key_id: string }>(
      "select name, updated_at, key_id from firm_secrets where firm_id = $1 order by name",
      [firmId],
    );
    return rows.map((r) => ({ name: r.name, updatedAt: r.updated_at, keyId: r.key_id }));
  });
  return result === "no_firm" ? { status: "no_firm" } : { status: "ok", rows: result };
}

// Sets (adds or replaces) one secret, sealed under `key`; the value is never stored or logged as it is.
export async function setSecret(
  adminUrl: string,
  slug: string,
  key: SecretsKey,
  name: string,
  value: string,
): Promise<SetSecretResult> {
  if (!SECRET_NAME.test(name) || name.length > 64) return { status: "bad_name" };
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const sealed = sealSecret(key, { firmId, name }, value);
    const { rows } = await owner.query<{ added: boolean }>(
      `insert into firm_secrets (firm_id, name, ciphertext, nonce, key_id)
       values ($1, $2, $3, $4, $5)
       on conflict (firm_id, name) do update
         set ciphertext = excluded.ciphertext, nonce = excluded.nonce, key_id = excluded.key_id,
             updated_at = now()
       returning (xmax = 0) as added`,
      [firmId, name, sealed.ciphertext, sealed.nonce, sealed.keyId],
    );
    const status = rows[0]?.added ? ("added" as const) : ("replaced" as const);
    await log(owner, firmId, name, status);
    return { status, name };
  });
  return result === "no_firm" ? { status: "no_firm" } : result;
}

export async function removeSecret(
  adminUrl: string,
  slug: string,
  name: string,
): Promise<SetSecretResult> {
  if (!SECRET_NAME.test(name) || name.length > 64) return { status: "bad_name" };
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rowCount } = await owner.query(
      "delete from firm_secrets where firm_id = $1 and name = $2",
      [firmId, name],
    );
    if (!rowCount) return { status: "not_there" as const };
    await log(owner, firmId, name, "removed");
    return { status: "removed" as const, name };
  });
  return result === "no_firm" ? { status: "no_firm" } : result;
}
