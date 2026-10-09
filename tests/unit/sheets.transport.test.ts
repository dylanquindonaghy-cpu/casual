import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SHEETS_ERROR_CODES } from "@/lib/roster/sheets/client";
import { syncErrorWords } from "@/lib/roster/sheets/error-words";
import { sheetsClientFrom } from "@/lib/roster/sheets/transport";

// The worker's Sheets client from its environment (audit M3: the sync could never be switched
// on). The key is generated here and thrown away; nothing reaches Google (building a client makes
// no request).

const dir = mkdtempSync(join(tmpdir(), "shiftdesk-sheets-"));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = join(dir, "key.json");
writeFileSync(
  keyFile,
  JSON.stringify({
    type: "service_account",
    client_email: "shiftdesk-sync@example-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("sheetsClientFrom", () => {
  it("none: no client, so the sync's tick is never scheduled", () => {
    expect(sheetsClientFrom({ SHEETS_TRANSPORT: "none" })).toBeUndefined();
    // A key lying about isn't used unless google is asked for.
    expect(
      sheetsClientFrom({ SHEETS_TRANSPORT: "none", GOOGLE_SERVICE_ACCOUNT_JSON_PATH: keyFile }),
    ).toBeUndefined();
  });

  it("google: the real client, from the key file", () => {
    const client = sheetsClientFrom({
      SHEETS_TRANSPORT: "google",
      GOOGLE_SERVICE_ACCOUNT_JSON_PATH: keyFile,
    });
    expect(client).toBeDefined();
    expect(typeof client?.locale).toBe("function");
    expect(typeof client?.batchGet).toBe("function");
    expect(typeof client?.batchUpdate).toBe("function");
  });

  it("google with no key, or one it can't read: a plain error that never quotes the file", () => {
    expect(() => sheetsClientFrom({ SHEETS_TRANSPORT: "google" })).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON_PATH/,
    );
    const broken = join(dir, "broken.json");
    writeFileSync(broken, `{"private_key": "-----BEGIN PRIVATE KEY-----SECRETSECRET`);
    let message = "";
    try {
      sheetsClientFrom({ SHEETS_TRANSPORT: "google", GOOGLE_SERVICE_ACCOUNT_JSON_PATH: broken });
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/can't read a JSON key file/);
    expect(message).not.toContain("SECRET");
    expect(() =>
      sheetsClientFrom({
        SHEETS_TRANSPORT: "google",
        GOOGLE_SERVICE_ACCOUNT_JSON_PATH: join(dir, "missing.json"),
      }),
    ).toThrow(/can't read/);
  });
});

describe("syncErrorWords", () => {
  // Every code a failed sync can store (sync.ts: Google's, the layout's, the locale, the mapping,
  // our own) has words of its own.
  const codes = [
    ...SHEETS_ERROR_CODES,
    "missing_column",
    "duplicate_column",
    "sheet_locale_not_uk",
    "bad_mapping",
    "sync_error",
  ];
  it.each(codes)("%s", (code) => {
    expect(syncErrorWords(code)).not.toMatch(/don't have words/);
  });

  it("a code it doesn't know (even one named like an object's own property) gets the fallback", () => {
    for (const code of ["constructor", "__proto__", "to_string", "something_new"]) {
      expect(syncErrorWords(code)).toBe("an error we don't have words for yet");
    }
  });

  it("the locale says how to fix it", () => {
    expect(syncErrorWords("sheet_locale_not_uk")).toContain(
      "File, Settings, Locale: United Kingdom",
    );
  });
});
