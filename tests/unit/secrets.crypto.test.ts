import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { parseWorkerEnv, webEnvRefusal } from "@/lib/env";
import {
  openSecret,
  sealSecret,
  SecretUnreadable,
  secretsKey,
  type SecretsKey,
} from "@/lib/secrets/crypto";

// The secret store's sealing (P5.1; src/lib/secrets/crypto.ts): AES-256-GCM under SECRETS_KEY,
// bound to its firm and name. Made-up keys and values only.

const keyOf = (): SecretsKey => {
  const key = secretsKey(randomBytes(32).toString("base64"));
  if (!key) throw new Error("no key");
  return key;
};
const FIRM = "11111111-1111-4111-8111-111111111111";
const OTHER_FIRM = "22222222-2222-4222-8222-222222222222";
const at = { firmId: FIRM, name: "portal.api_key" };

describe("the secret store's key", () => {
  it("is 32 bytes in base64; anything else isn't a key", () => {
    const key = keyOf();
    expect(key.key).toHaveLength(32);
    expect(key.id).toMatch(/^[0-9a-f]{12}$/);
    for (const bad of [
      "",
      "short",
      randomBytes(16).toString("base64"),
      randomBytes(48).toString("base64"),
      randomBytes(32).toString("hex"),
      `${randomBytes(32).toString("base64")}x`,
    ]) {
      expect(secretsKey(bad), bad).toBeNull();
    }
  });

  it("the worker's settings take a key, and refuse one that isn't", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
      DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
      SESSION_SECRET: "x".repeat(40),
      APP_BASE_DOMAIN: "localhost:3000",
    };
    const good = randomBytes(32).toString("base64");
    expect(parseWorkerEnv({ ...base, SECRETS_KEY: good }).SECRETS_KEY).toBe(good);
    expect(parseWorkerEnv({ ...base, SECRETS_KEY: "" }).SECRETS_KEY).toBeUndefined();
    expect(() => parseWorkerEnv({ ...base, SECRETS_KEY: "not-a-key" })).toThrow(/SECRETS_KEY/);
  });
});

describe("the web app never has the key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses it on a real address; a local run, where one .env serves both, may have it", () => {
    const key = randomBytes(32).toString("base64");
    const live = { NODE_ENV: "production", APP_BASE_DOMAIN: "shifts.example.co.uk" };
    expect(webEnvRefusal({ ...live, SECRETS_KEY: key })).toMatch(/SECRETS_KEY/);
    expect(webEnvRefusal({ ...live, SECRETS_KEY: "" })).toBeNull();
    expect(webEnvRefusal(live)).toBeNull();
    for (const local of ["localhost", "localhost:3200"]) {
      expect(webEnvRefusal({ ...live, APP_BASE_DOMAIN: local, SECRETS_KEY: key })).toBeNull();
    }
    expect(webEnvRefusal({ ...live, NODE_ENV: "development", SECRETS_KEY: key })).toBeNull();
  });

  it("the web app's start-up stops with it (src/instrumentation.ts)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_DOMAIN", "shifts.example.co.uk");
    vi.stubEnv("SECRETS_KEY", randomBytes(32).toString("base64"));
    await expect(register()).rejects.toThrow(/SECRETS_KEY/);
  });
});

describe("sealing and opening", () => {
  it("opens to the same value, and every seal is different (a new nonce)", () => {
    const key = keyOf();
    const one = sealSecret(key, at, "portal-key-0123456789");
    const two = sealSecret(key, at, "portal-key-0123456789");
    expect(openSecret(key, at, one)).toBe("portal-key-0123456789");
    expect(one.nonce.equals(two.nonce)).toBe(false);
    expect(one.ciphertext.equals(two.ciphertext)).toBe(false);
    expect(one.ciphertext.includes(Buffer.from("portal-key"))).toBe(false);
    expect(one.keyId).toBe(key.id);
    // Words and symbols come back as they went.
    expect(openSecret(key, at, sealSecret(key, at, "pässwörd £ ✓"))).toBe("pässwörd £ ✓");
  });

  it("never opens for another firm or name, under another key, or once changed", () => {
    const key = keyOf();
    const sealed = sealSecret(key, at, "portal-key-0123456789");
    const fails = (fn: () => unknown, code: SecretUnreadable["code"]) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(SecretUnreadable);
        expect((err as SecretUnreadable).code).toBe(code);
        // The error never says the value.
        expect(String(err)).not.toContain("portal-key");
        return;
      }
      throw new Error("it opened");
    };
    fails(() => openSecret(key, { ...at, firmId: OTHER_FIRM }, sealed), "does_not_open");
    fails(() => openSecret(key, { ...at, name: "portal.webhook_secret" }, sealed), "does_not_open");
    fails(() => openSecret(keyOf(), at, sealed), "other_key");
    // Another key passed off as this one (its id copied): still never opens.
    const other = { ...keyOf(), id: key.id };
    fails(() => openSecret(other, at, sealed), "does_not_open");
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    fails(() => openSecret(key, at, { ...sealed, ciphertext: flipped }), "does_not_open");
    fails(() => openSecret(key, at, { ...sealed, nonce: randomBytes(12) }), "does_not_open");
    fails(() => openSecret(key, at, { ...sealed, ciphertext: Buffer.alloc(10) }), "does_not_open");
  });

  it("refuses an empty value, one over 4 kB, or a name that isn't one", () => {
    const key = keyOf();
    expect(() => sealSecret(key, at, "")).toThrow();
    expect(() => sealSecret(key, at, "x".repeat(4097))).toThrow();
    expect(sealSecret(key, at, "x".repeat(4096)).ciphertext).toHaveLength(4096 + 16);
    for (const name of ["Portal.key", "portal..key", "1portal", "portal key", "a.b.c.d.e"]) {
      expect(() => sealSecret(key, { ...at, name }, "v"), name).toThrow();
    }
  });
});
