import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// The secret store's sealing (P5.1; ADR-026; the table: firm_secrets). AES-256-GCM under
// SECRETS_KEY (32 random bytes, base64: the worker's and the owner command's settings only, never
// the web app's or the database's), with the firm's id and the secret's name as additional data,
// so a sealed value moved to another firm or name fails to open. A new 12-byte nonce for every
// value. Pure, but for the random nonce.

export const SECRET_NAME = /^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*){0,3}$/;
export const SECRET_NAME_MAX = 64;
export const SECRET_MAX_BYTES = 4096;
export const isSecretName = (name: string) =>
  name.length <= SECRET_NAME_MAX && SECRET_NAME.test(name);

export interface SecretsKey {
  key: Buffer; // 32 bytes
  id: string; // the first 12 hex of its sha256: which key sealed a value, never the key itself
}

export interface Sealed {
  ciphertext: Buffer; // the encrypted value, its 16-byte tag after it
  nonce: Buffer;
  keyId: string;
}

// The key from its base64 text, or null for one that isn't 32 bytes.
export function secretsKey(base64: string): SecretsKey | null {
  const text = base64.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return null;
  const key = Buffer.from(text, "base64");
  if (key.length !== 32) return null;
  return { key, id: createHash("sha256").update(key).digest("hex").slice(0, 12) };
}

const boundTo = (firmId: string, name: string) => Buffer.from(`${firmId}\u0000${name}`, "utf8");

export function sealSecret(
  key: SecretsKey,
  where: { firmId: string; name: string },
  value: string,
): Sealed {
  const plain = Buffer.from(value, "utf8");
  if (plain.length === 0 || plain.length > SECRET_MAX_BYTES) {
    throw new Error(`a secret is 1 to ${SECRET_MAX_BYTES} bytes`);
  }
  if (!isSecretName(where.name)) throw new Error("not a secret's name");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(boundTo(where.firmId, where.name));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyId: key.id };
}

// Why a sealed value didn't open: sealed under another key (SECRETS_KEY changed), or it doesn't
// open under this firm and name (moved, changed, or not ours). Never the value or the key.
export class SecretUnreadable extends Error {
  constructor(readonly code: "other_key" | "does_not_open") {
    super(`the secret can't be read (${code})`);
    this.name = "SecretUnreadable";
  }
}

export function openSecret(
  key: SecretsKey,
  where: { firmId: string; name: string },
  sealed: Sealed,
): string {
  if (sealed.keyId !== key.id) throw new SecretUnreadable("other_key");
  if (sealed.nonce.length !== 12 || sealed.ciphertext.length < 17) {
    throw new SecretUnreadable("does_not_open");
  }
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - 16);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, sealed.nonce);
    decipher.setAAD(boundTo(where.firmId, where.name));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretUnreadable("does_not_open");
  }
}
