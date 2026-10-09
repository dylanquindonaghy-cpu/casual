import type { SheetsClient } from "./client";
import { googleSheetsClient, loadServiceAccountKey } from "./google";

// The worker's Sheets client, from its environment (SHEETS_TRANSPORT in src/lib/env.ts):
// "none" gives no client, so the sync's tick is never scheduled (src/worker/jobs/index.ts);
// "google" reads the service account's key file once, at start. A file that can't be read stops
// the worker with a plain error that never quotes the file (loadServiceAccountKey).

export function sheetsClientFrom(env: {
  SHEETS_TRANSPORT: "none" | "google";
  GOOGLE_SERVICE_ACCOUNT_JSON_PATH?: string | undefined;
}): SheetsClient | undefined {
  if (env.SHEETS_TRANSPORT === "none") return undefined;
  const path = env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!path) throw new Error("SHEETS_TRANSPORT=google needs GOOGLE_SERVICE_ACCOUNT_JSON_PATH");
  return googleSheetsClient({ key: loadServiceAccountKey(path) });
}
