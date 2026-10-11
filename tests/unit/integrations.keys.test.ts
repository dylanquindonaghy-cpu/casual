import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  apiKeyHash,
  apiKeyHint,
  bearerKey,
  KEY_LABEL_MAX,
  looksLikeApiKey,
  MAX_LIVE_KEYS,
  newApiKey,
} from "@/lib/integrations/keys";
import { scanLogText } from "../../scripts/logs-scan";

// The planner's API keys (12J.1; docs/office-v2.md 5.3.2): `shiftdesk_` and 43 random base64url
// characters, stored only as the sha256 of the whole key and its last 4 characters.

// 43 characters after the prefix, every kind a key can hold (letters, digits, "_" and "-").
const SHAPED = `${API_KEY_PREFIX}${"Kq7_Zx-Mv".repeat(4)}Pw3Ln_8`;

describe("a new key", () => {
  it("is shiftdesk_ and 43 base64url characters (32 random bytes), different every time", () => {
    expect(API_KEY_PREFIX).toBe("shiftdesk_");
    const keys = Array.from({ length: 50 }, () => newApiKey());
    for (const key of keys) {
      expect(key).toMatch(/^shiftdesk_[A-Za-z0-9_-]{43}$/);
      expect(key).toHaveLength(53);
      expect(Buffer.from(key.slice(API_KEY_PREFIX.length), "base64url")).toHaveLength(32);
      expect(looksLikeApiKey(key)).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is what the servers' log scan looks for (the e2e teardown's check)", () => {
    const key = newApiKey();
    expect(scanLogText(`leaked ${key}`).filter((f) => f.kind === "key")).toHaveLength(1);
  });

  it("keeps the limits the database and the page share", () => {
    expect(MAX_LIVE_KEYS).toBe(10);
    expect(KEY_LABEL_MAX).toBe(60); // api_keys_label_length: 1 to 60 characters
  });
});

describe("looksLikeApiKey: the shape check before any look-up", () => {
  it("takes exactly the prefix and 43 base64url characters", () => {
    expect(SHAPED).toHaveLength(53);
    expect(looksLikeApiKey(SHAPED)).toBe(true);
    // The prefix's own characters are base64url too: only the shape is checked here.
    expect(looksLikeApiKey(`${API_KEY_PREFIX}${API_KEY_PREFIX}${"a".repeat(33)}`)).toBe(true);
  });

  it.each([
    ["nothing", ""],
    ["the prefix alone", API_KEY_PREFIX],
    ["one character short", SHAPED.slice(0, -1)],
    ["one character long", `${SHAPED}a`],
    ["a login token with no prefix", SHAPED.slice(API_KEY_PREFIX.length)],
    ["the prefix in capitals", SHAPED.replace("shiftdesk_", "SHIFTDESK_")],
    ["a dash for the prefix's underscore", SHAPED.replace("shiftdesk_", "shiftdesk-")],
    ["another prefix", `sd_live_${SHAPED.slice(API_KEY_PREFIX.length)}`],
    ["standard base64's +", `${SHAPED.slice(0, -1)}+`],
    ["standard base64's /", `${SHAPED.slice(0, -1)}/`],
    ["base64 padding", `${SHAPED.slice(0, -1)}=`],
    ["a space inside", `${SHAPED.slice(0, 30)} ${SHAPED.slice(31)}`],
    ["a space before", ` ${SHAPED}`],
    ["a space after", `${SHAPED} `],
    ["a line break after", `${SHAPED}\n`],
    ["a letter that only looks Latin", `${SHAPED.slice(0, -1)}а`],
    ["a Bearer header's whole value", `Bearer ${SHAPED}`],
  ])("refuses %s", (_label, value) => {
    expect(looksLikeApiKey(value)).toBe(false);
  });
});

describe("apiKeyHash and apiKeyHint: what's stored", () => {
  it("the hash is the sha256 of the whole key, prefix included: 32 bytes", () => {
    const key = newApiKey();
    const hash = apiKeyHash(key);
    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash("sha256").update(key, "utf8").digest())).toBe(true);
    const randomPart = key.slice(API_KEY_PREFIX.length);
    expect(hash.equals(createHash("sha256").update(randomPart, "utf8").digest())).toBe(false);
    expect(apiKeyHash(key).equals(hash)).toBe(true);
    expect(apiKeyHash(newApiKey()).equals(hash)).toBe(false);
  });

  it("the hint is the key's last 4 characters, in the shape the table allows", () => {
    expect(apiKeyHint(SHAPED)).toBe("Ln_8");
    for (let i = 0; i < 50; i += 1) {
      const key = newApiKey();
      expect(apiKeyHint(key)).toBe(key.slice(-4));
      expect(apiKeyHint(key)).toMatch(/^[A-Za-z0-9_-]{4}$/); // api_keys_hint_format
    }
  });
});

describe("bearerKey: the key from the Authorization header", () => {
  it("takes the value after Bearer and its spaces", () => {
    expect(bearerKey(`Bearer ${SHAPED}`)).toBe(SHAPED);
    expect(bearerKey(`Bearer   ${SHAPED}`)).toBe(SHAPED);
    expect(bearerKey(`Bearer ${SHAPED}  `)).toBe(SHAPED);
    // Any single word: the shape check comes next, before any look-up.
    expect(bearerKey("Bearer not-a-key")).toBe("not-a-key");
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["Bearer alone", "Bearer"],
    ["Bearer and a space", "Bearer "],
    ["two words", `Bearer ${SHAPED} extra`],
    ["a tab for the space", `Bearer\t${SHAPED}`],
    ["no space", `Bearer${SHAPED}`],
    ["a space before Bearer", ` Bearer ${SHAPED}`],
    ["another scheme", `Basic ${Buffer.from(`user:${SHAPED}`).toString("base64")}`],
    ["the key alone", SHAPED],
    ["a line break inside", `Bearer\n${SHAPED}`],
  ])("gives nothing for %s", (_label, header) => {
    expect(bearerKey(header)).toBeNull();
  });
});
