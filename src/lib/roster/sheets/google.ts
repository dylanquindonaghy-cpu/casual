import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { systemClock, type Clock } from "../../auth/clock";
import { SheetsError, type SheetsClient, type SheetWrite } from "./client";

// The real Google Sheets client, as our service account (docs/architecture.md, Roster plugs:
// each firm shares its sheet with the service account's email). The key file's path comes from
// the worker's environment (GOOGLE_SERVICE_ACCOUNT_JSON_PATH), never the database or the repo.
// Not wired into the worker yet: see SHEETS_TRANSPORT in src/lib/env.ts.
//
// Auth is Google's service-account flow: a JWT signed RS256 with the account's private key is
// exchanged for a one-hour access token, cached until a minute before it expires. `fetch` is
// injected, so tests exercise every request without touching the network. Errors carry a code
// only: Google's messages and response bodies can quote cell contents.

export const serviceAccountKeySchema = z.object({
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccountKey = z.input<typeof serviceAccountKeySchema>;

// Reads the service account's key file. Errors never quote the file (JSON.parse's message can
// include a slice of its text, i.e. of the private key).
export function loadServiceAccountKey(path: string): ServiceAccountKey {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_PATH: can't read a JSON key file there");
  }
  const key = serviceAccountKeySchema.safeParse(raw);
  if (!key.success) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_PATH: not a service account key file");
  }
  return key.data;
}

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const batchGetResponse = z.object({
  valueRanges: z
    .array(
      z.object({
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).optional(),
      }),
    )
    .default([]),
});

export interface GoogleSheetsOptions {
  key: ServiceAccountKey;
  fetch?: typeof fetch;
  clock?: Clock;
  timeoutMs?: number;
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function serviceAccountJwt(key: ServiceAccountKey, now: Date): string {
  const k = serviceAccountKeySchema.parse(key);
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: k.client_email,
      scope: SHEETS_SCOPE,
      aud: k.token_uri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(k.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

function codeForStatus(status: number): SheetsError["code"] {
  if (status === 403) return "sheet_not_shared";
  if (status === 404) return "sheet_not_found";
  if (status === 429) return "sheets_rate_limited";
  if (status === 401) return "sheets_auth_failed";
  if (status >= 500) return "sheets_unavailable";
  return "sheets_bad_response";
}

export function googleSheetsClient(options: GoogleSheetsOptions): SheetsClient {
  const key = serviceAccountKeySchema.parse(options.key);
  const doFetch = options.fetch ?? fetch;
  const clock = options.clock ?? systemClock;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let cached: { token: string; expiresAt: number } | undefined;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new SheetsError("sheets_unavailable");
    }
  }

  async function token(): Promise<string> {
    const now = clock.now().getTime();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const response = await send(key.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountJwt(key, new Date(now)),
      }).toString(),
    });
    if (!response.ok) {
      throw new SheetsError(response.status >= 500 ? "sheets_unavailable" : "sheets_auth_failed");
    }
    const body = tokenResponse.safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SheetsError("sheets_bad_response");
    cached = { token: body.data.access_token, expiresAt: now + body.data.expires_in * 1000 };
    return cached.token;
  }

  async function call(url: string, init: RequestInit): Promise<unknown> {
    const response = await send(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await token()}` },
    });
    if (response.status === 401) cached = undefined; // the next call gets a fresh token
    if (!response.ok) throw new SheetsError(codeForStatus(response.status));
    return response.json().catch(() => {
      throw new SheetsError("sheets_bad_response");
    });
  }

  const sheetUrl = (spreadsheetId: string, action: string) =>
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:${action}`;

  return {
    async batchGet(spreadsheetId, ranges) {
      const query = new URLSearchParams({
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
      });
      for (const range of ranges) query.append("ranges", range);
      const body = batchGetResponse.safeParse(
        await call(`${sheetUrl(spreadsheetId, "batchGet")}?${query.toString()}`, {
          method: "GET",
        }),
      );
      if (!body.success || body.data.valueRanges.length !== ranges.length) {
        throw new SheetsError("sheets_bad_response");
      }
      return body.data.valueRanges.map((r) => (r.values ?? []).map((row) => row.map(String)));
    },

    async batchUpdate(spreadsheetId, writes: SheetWrite[]) {
      await call(sheetUrl(spreadsheetId, "batchUpdate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // RAW: stored as typed, never parsed as a formula (a staff id like "=HYPERLINK(...)"
          // stays text).
          valueInputOption: "RAW",
          data: writes.map((w) => ({ range: w.range, values: [[w.value]] })),
        }),
      });
    },
  };
}
