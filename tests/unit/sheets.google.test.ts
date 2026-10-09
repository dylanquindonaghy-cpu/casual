import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetsError } from "@/lib/roster/sheets/client";
import {
  googleSheetsClient,
  loadServiceAccountKey,
  serviceAccountJwt,
  SHEETS_API,
  SHEETS_SCOPE,
} from "@/lib/roster/sheets/google";

// The real Google Sheets client, with the network replaced: every request goes to a fake fetch,
// and the service account's key is generated here and thrown away. Nothing reaches Google.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  client_email: "shiftdesk-sync@example-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEF";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tokenReply = () =>
  json({ access_token: "ya29.test-token", expires_in: 3600, token_type: "Bearer" });

describe("serviceAccountJwt", () => {
  it("is an RS256 JWT for the Sheets scope, valid one hour, signed by the account's key", () => {
    const now = new Date("2026-11-07T09:00:00Z");
    const jwt = serviceAccountJwt(key, now);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h ?? "", "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const iat = Math.floor(now.getTime() / 1000);
    expect(JSON.parse(Buffer.from(c ?? "", "base64url").toString())).toEqual({
      iss: key.client_email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URI,
      iat,
      exp: iat + 3600,
    });
    expect(
      verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s ?? "", "base64url")),
    ).toBe(true);
  });
});

describe("googleSheetsClient", () => {
  it("gets a token once, then reads ranges in one request as formatted text", async () => {
    const { fn, calls } = fakeFetch((call) =>
      call.url === TOKEN_URI
        ? tokenReply()
        : json({
            valueRanges: [
              {
                values: [
                  ["Staff ID", "Needed"],
                  ["N001", 2],
                ],
              },
              {},
            ],
          }),
    );
    const client = googleSheetsClient({ key, fetch: fn });
    const result = await client.batchGet(SHEET, ["'Staff'", "'Shift list'!A:A"]);
    expect(result).toEqual([
      [
        ["Staff ID", "Needed"],
        ["N001", "2"],
      ],
      [],
    ]);
    await client.batchGet(SHEET, ["'Staff'"]).catch(() => undefined);

    const [tokenCall, readCall] = calls;
    expect(tokenCall?.init.method).toBe("POST");
    const form = new URLSearchParams(String(tokenCall?.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    const url = new URL(readCall?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${SHEETS_API}/${SHEET}/values:batchGet`);
    expect(url.searchParams.getAll("ranges")).toEqual(["'Staff'", "'Shift list'!A:A"]);
    expect(url.searchParams.get("valueRenderOption")).toBe("FORMATTED_VALUE");
    expect(new Headers(readCall?.init.headers).get("authorization")).toBe("Bearer ya29.test-token");
    // The second read reused the cached token: no second token request.
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(1);
  });

  it("reads the spreadsheet's locale in one small request (its properties only)", async () => {
    const { fn, calls } = fakeFetch((call) =>
      call.url === TOKEN_URI ? tokenReply() : json({ properties: { locale: "en_US" } }),
    );
    const client = googleSheetsClient({ key, fetch: fn });
    expect(await client.locale(SHEET)).toBe("en_US");
    expect(calls).toHaveLength(2);
    const url = new URL(calls[1]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${SHEETS_API}/${SHEET}`);
    expect(url.searchParams.get("fields")).toBe("properties.locale");
    expect(calls[1]?.init.method).toBe("GET");
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer ya29.test-token");
  });

  it("a locale reply it can't read, or a refused one, has a code", async () => {
    const odd = fakeFetch((call) => (call.url === TOKEN_URI ? tokenReply() : json({ sheets: [] })));
    await expect(googleSheetsClient({ key, fetch: odd.fn }).locale(SHEET)).rejects.toMatchObject({
      code: "sheets_bad_response",
    });
    const hidden = fakeFetch((call) => (call.url === TOKEN_URI ? tokenReply() : json({}, 403)));
    await expect(googleSheetsClient({ key, fetch: hidden.fn }).locale(SHEET)).rejects.toMatchObject(
      { code: "sheet_not_shared" },
    );
  });

  it("writes every cell in one request, as RAW text (never a formula)", async () => {
    const { fn, calls } = fakeFetch((call) => (call.url === TOKEN_URI ? tokenReply() : json({})));
    const client = googleSheetsClient({ key, fetch: fn });
    await client.batchUpdate(SHEET, [
      { range: "'Shifts'!J2", value: "N001, N002" },
      { range: "'Shifts'!J9", value: '=HYPERLINK("x")' },
    ]);
    const write = calls[1];
    expect(write?.url).toBe(`${SHEETS_API}/${SHEET}/values:batchUpdate`);
    expect(write?.init.method).toBe("POST");
    expect(JSON.parse(String(write?.init.body))).toEqual({
      valueInputOption: "RAW",
      data: [
        { range: "'Shifts'!J2", values: [["N001, N002"]] },
        { range: "'Shifts'!J9", values: [['=HYPERLINK("x")']] },
      ],
    });
  });

  it("refreshes the token a minute before it expires", async () => {
    let now = new Date("2026-11-07T09:00:00Z").getTime();
    const { fn, calls } = fakeFetch((call) =>
      call.url === TOKEN_URI ? tokenReply() : json({ valueRanges: [{}] }),
    );
    const client = googleSheetsClient({ key, fetch: fn, clock: { now: () => new Date(now) } });
    await client.batchGet(SHEET, ["'Staff'"]);
    now += 58 * 60_000;
    await client.batchGet(SHEET, ["'Staff'"]);
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(1);
    now += 2 * 60_000; // 60 minutes in: inside the last minute
    await client.batchGet(SHEET, ["'Staff'"]);
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(2);
  });

  it.each([
    [403, "sheet_not_shared"],
    [404, "sheet_not_found"],
    [429, "sheets_rate_limited"],
    [401, "sheets_auth_failed"],
    [500, "sheets_unavailable"],
    [503, "sheets_unavailable"],
    // A tab that isn't there, or a file that isn't a Google Sheet: the firm's to fix.
    [400, "sheet_unreadable"],
  ])("a %i from Sheets is the code %s, never Google's message", async (status, code) => {
    const { fn } = fakeFetch((call) =>
      call.url === TOKEN_URI
        ? tokenReply()
        : json({ error: { message: "Cell B7 holds 07700 900123" } }, status),
    );
    const err = await googleSheetsClient({ key, fetch: fn })
      .batchGet(SHEET, ["'Staff'"])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetsError);
    expect(err).toMatchObject({ code });
    expect(String((err as Error).message)).not.toContain("07700");
  });

  it("a refused token, a network failure or an unreadable reply each have a code", async () => {
    const refused = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    await expect(
      googleSheetsClient({ key, fetch: refused.fn }).batchGet(SHEET, ["'A'"]),
    ).rejects.toMatchObject({
      code: "sheets_auth_failed",
    });
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      googleSheetsClient({ key, fetch: down.fn }).batchGet(SHEET, ["'A'"]),
    ).rejects.toMatchObject({
      code: "sheets_unavailable",
    });
    const odd = fakeFetch((call) =>
      call.url === TOKEN_URI ? tokenReply() : json({ valueRanges: [] }),
    );
    await expect(
      googleSheetsClient({ key, fetch: odd.fn }).batchGet(SHEET, ["'A'"]),
    ).rejects.toMatchObject({
      code: "sheets_bad_response",
    });
  });

  it("drops a token the API refused, so the next call gets a new one", async () => {
    let reads = 0;
    const { fn, calls } = fakeFetch((call) => {
      if (call.url === TOKEN_URI) return tokenReply();
      reads += 1;
      return reads === 1 ? json({}, 401) : json({ valueRanges: [{}] });
    });
    const client = googleSheetsClient({ key, fetch: fn });
    await expect(client.batchGet(SHEET, ["'A'"])).rejects.toMatchObject({
      code: "sheets_auth_failed",
    });
    await client.batchGet(SHEET, ["'A'"]);
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(2);
  });
});

describe("loadServiceAccountKey", () => {
  const dir = mkdtempSync(join(tmpdir(), "shiftdesk-key-"));

  it("reads a key file", () => {
    const path = join(dir, "good.json");
    writeFileSync(path, JSON.stringify({ ...key, type: "service_account" }));
    expect(loadServiceAccountKey(path)).toMatchObject({
      client_email: key.client_email,
      token_uri: TOKEN_URI,
    });
  });

  it("never quotes the file in its errors", () => {
    const broken = join(dir, "broken.json");
    writeFileSync(broken, `{"private_key": "-----BEGIN PRIVATE KEY-----SECRETSECRET`);
    expect(() => loadServiceAccountKey(broken)).toThrow(/can't read a JSON key file/);
    try {
      loadServiceAccountKey(broken);
    } catch (err) {
      expect(String(err)).not.toContain("SECRET");
    }
    const wrong = join(dir, "wrong.json");
    writeFileSync(wrong, JSON.stringify({ private_key: "SECRETSECRET" }));
    expect(() => loadServiceAccountKey(wrong)).toThrow(/not a service account key file/);
    expect(() => loadServiceAccountKey(join(dir, "missing.json"))).toThrow(/can't read/);
  });
});
