import { Pool as PgPool, type Pool } from "pg";
import { log } from "../log";
import { isSecretName, openSecret, type SecretsKey } from "../secret-store/crypto";

// A firm's secret, for the worker (P5.1; ADR-026): read through app_read_firm_secret() (migration
// 0054) on the worker's own jobs-role connection (DATABASE_JOBS_URL: the web app has none), then
// opened with SECRETS_KEY. Null when the firm has no secret of that name. Never logged; the caller
// keeps it no longer than the call it's for, and never puts it in a job's payload.

export async function readFirmSecret(
  jobs: Pool,
  key: SecretsKey,
  where: { firmId: string; name: string },
): Promise<string | null> {
  if (!isSecretName(where.name)) throw new Error("not a secret's name");
  const { rows } = await jobs.query<{ ciphertext: Buffer; nonce: Buffer; key_id: string }>(
    "select ciphertext, nonce, key_id from app_read_firm_secret($1, $2)",
    [where.firmId, where.name],
  );
  const row = rows[0];
  if (!row) return null;
  return openSecret(key, where, {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    keyId: row.key_id,
  });
}

// What a job asks for a firm's secret by (the worker builds it: firmSecretReader).
export type ReadFirmSecret = (firmId: string, name: string) => Promise<string | null>;

// The worker has no SECRETS_KEY: no secret can be opened.
export class SecretsKeyMissing extends Error {
  constructor() {
    super("SECRETS_KEY isn't set: no firm's secret can be read");
    this.name = "SecretsKeyMissing";
  }
}

// The worker's reader: its own small jobs-role pool, made on first use (one connection: a secret
// is read once per job, briefly). With no key, every read is refused (SecretsKeyMissing).
export function firmSecretReader(jobsUrl: string, key: SecretsKey | null): ReadFirmSecret {
  let pool: Pool | undefined;
  return async (firmId, name) => {
    if (!key) throw new SecretsKeyMissing();
    if (!pool) {
      pool = new PgPool({
        connectionString: jobsUrl,
        max: 1,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      // As the app's pool (src/lib/db/pool.ts): a connection dropping, idle or lent out (the
      // database restarting, say), must not crash the worker; the read in hand fails as usual.
      pool.on("error", (err) => log.error("secret store pool error", { error: err }));
      pool.on("connect", (client) =>
        client.on("error", (err) => log.error("secret store connection error", { error: err })),
      );
    }
    return readFirmSecret(pool, key, { firmId, name });
  };
}
