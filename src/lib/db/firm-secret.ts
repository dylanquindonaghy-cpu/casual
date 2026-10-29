import type { Pool } from "pg";
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
