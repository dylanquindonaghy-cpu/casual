import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { databaseName, withDatabase } from "./src/lib/db/admin/urls";

if (existsSync(".env")) process.loadEnvFile(".env");
const ci = !!process.env.CI;

// End-to-end tests run their own web app and worker on port 3100 against their own *_e2e
// database (rebuilt and seeded each run), so they never touch the dev server or dev data.
// Messages go to the console transport's outbox file, where tests pick up login links.
const PORT = 3100;
export const OUTBOX = ".dev/e2e-outbox.jsonl";
export const E2E_TWILIO_AUTH_TOKEN = "e2e-twilio-auth-token-not-real-0000";
const e2e = (url: string | undefined) => {
  if (!url) throw new Error("DATABASE_URL, DATABASE_JOBS_URL and DATABASE_ADMIN_URL must be set");
  return withDatabase(url, `${databaseName(url)}_e2e`);
};
const env = {
  DATABASE_URL: e2e(process.env.DATABASE_URL),
  DATABASE_JOBS_URL: e2e(process.env.DATABASE_JOBS_URL),
  DATABASE_ADMIN_URL: e2e(process.env.DATABASE_ADMIN_URL),
  APP_BASE_DOMAIN: `localhost:${PORT}`,
  MESSAGING_TRANSPORT: "console",
  CONSOLE_OUTBOX_FILE: OUTBOX,
  // The offline copy of My shifts is off by default in development; the e2e run tests it.
  OFFLINE_COPY: "on",
  // Web push: never a real key in e2e (a browser would then ask Google's push service), and the
  // console sender.
  VAPID_PUBLIC_KEY: "",
  PUSH_TRANSPORT: "console",
  // A made-up key, so the e2e run can post signed Twilio webhooks (tests/e2e/whatsapp.inbound.spec.ts).
  TWILIO_AUTH_TOKEN: E2E_TWILIO_AUTH_TOKEN,
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  reporter: ci ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  // Mobile first: workers use the portal from a phone.
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      // Takes the e2e lock, rebuilds and seeds the *_e2e database, then runs the worker (it sends
      // the login links). If another e2e run holds the lock this one stops without touching it.
      command: "node --import tsx tests/e2e/worker.ts",
      wait: { stdout: /\[worker\] started/ },
      env,
      timeout: 120_000,
    },
    {
      command: ci ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
