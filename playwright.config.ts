import { existsSync, mkdirSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { databaseName, withDatabase } from "./src/lib/db/admin/urls";

if (existsSync(".env")) process.loadEnvFile(".env");
const ci = !!process.env.CI;

// End-to-end tests run their own web app and worker on port 3100 against their own *_e2e
// database (rebuilt and seeded each run), so they never touch the dev server or dev data.
// Messages go to the console transport's outbox file, where tests pick up login links.
export const PORT = 3100;
export const OUTBOX = ".dev/e2e-outbox.jsonl";
export const E2E_TWILIO_AUTH_TOKEN = "e2e-twilio-auth-token-not-real-0000";
export const CUSTOM_DOMAIN = "shifts.acme-events.test";
// https for that domain, as Caddy gives a firm's own domain in production (tests/e2e/tls-front.ts):
// the browser sends https://shifts.acme-events.test here.
const TLS_FRONT_PORT = 3443;
// Everything the worker and the web app print during the run (their logs), kept so the teardown can
// check no phone number or email got past the log masker (tests/e2e/teardown.ts).
// (.dev/ is gitignored: made here, before the servers' output is written into it. `tee` hides the
// worker's own exit message, e.g. "another e2e run is in progress": it's in .dev/e2e-worker.log.)
export const SERVER_LOGS = [".dev/e2e-worker.log", ".dev/e2e-web.log"] as const;
mkdirSync(".dev", { recursive: true });
const e2e = (url: string | undefined) => {
  if (!url) throw new Error("DATABASE_URL, DATABASE_JOBS_URL and DATABASE_ADMIN_URL must be set");
  return withDatabase(url, `${databaseName(url)}_e2e`);
};
// The servers' settings for a browser-test run on `port`, with its own outbox. Also used by the
// walkthrough's run (playwright.walkthrough.config.ts), which serves a production build.
export const serverEnv = (port: number, outbox: string, opts: { testPages?: boolean } = {}) => ({
  DATABASE_URL: e2e(process.env.DATABASE_URL),
  DATABASE_JOBS_URL: e2e(process.env.DATABASE_JOBS_URL),
  DATABASE_ADMIN_URL: e2e(process.env.DATABASE_ADMIN_URL),
  APP_BASE_DOMAIN: `localhost:${port}`,
  MESSAGING_TRANSPORT: "console",
  CONSOLE_OUTBOX_FILE: outbox,
  // The offline copy of My shifts is off by default in development; the e2e run tests it.
  OFFLINE_COPY: "on",
  // The test-only pages (src/app/e2e/), e.g. one that fails once (tests/e2e/error-page.spec.ts).
  ...(opts.testPages === false ? {} : { E2E_TEST_PAGES: "on" }),
  // Web push: never a real key in e2e (a browser would then ask Google's push service), and the
  // console sender.
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  PUSH_TRANSPORT: "console",
  // Never a real Google Sheet: .env may switch the sheets on for a local try (PLAN.md "Connect the
  // real Google Sheets"), never for a test run.
  SHEETS_TRANSPORT: "none",
  GOOGLE_SERVICE_ACCOUNT_JSON_PATH: "",
  // A made-up key, so the e2e run can post signed Twilio webhooks (tests/e2e/whatsapp.inbound.spec.ts).
  TWILIO_AUTH_TOKEN: E2E_TWILIO_AUTH_TOKEN,
  // Never a real email server: .env may hold a provider's settings for a local try
  // (scripts/invariants.sh checks these lines stay).
  EMAIL_TRANSPORT: "console",
  SMTP_USER: "",
  SMTP_PASS: "",
  // Never the Anthropic API: the e2e worker doesn't run with NODE_ENV=test, so this pin is what
  // keeps AI off if .env switches it on (scripts/invariants.sh checks these lines stay).
  AI_TRANSPORT: "none",
  ANTHROPIC_API_KEY: "",
  // Never postcodes.io or TravelTime: the made-up points for the ZZ postcodes (the e2e servers
  // don't run with NODE_ENV=test, so this pin is what keeps them off).
  TRAVEL_PROVIDER: "fake",
  TRAVELTIME_APP_ID: "",
  TRAVELTIME_API_KEY: "",
  // A made-up planner integration secret (12J.1), never .env's own; not .env.example's either,
  // which a production build (CI's web app) refuses. The planner API answers only with one set
  // (tests/e2e/office.integrations.spec.ts). scripts/invariants.sh checks this line stays.
  INTEGRATIONS_SECRET: "e2e-only-integrations-secret-not-for-any-real-use",
  // Never a real webhook address (12J.2): the e2e worker doesn't run with NODE_ENV=test, so this
  // pin is what keeps the console transport on if .env switches https on.
  WEBHOOK_TRANSPORT: "console",
  // Demo mode off (16.1; ADR-025), whatever .env says: the main run is a real server's. Only the
  // walkthrough's run turns it on (playwright.walkthrough.config.ts). scripts/invariants.sh checks
  // this line stays.
  DEMO_MODE: "",
  DEMO_SITE_PASSWORD: "",
});
const env = serverEnv(PORT, OUTBOX);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // The walkthrough runs on its own, against a fresh database and a production build in demo mode
  // (playwright.walkthrough.config.ts, with demo.spec.ts), and so does the run with no text sender
  // (playwright.no-texts.config.ts, P2.7); `npm run e2e` runs all three.
  testIgnore: ["**/walkthrough.spec.ts", "**/demo.spec.ts", "**/no-texts.spec.ts"],
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  // With E2E_JSON_REPORT (set by scripts/e2e.mjs for scripts/verify.sh) also a JSON report, which
  // scripts/invariants.sh reads: Playwright counts skipped and fixme tests as a pass (audit L62).
  reporter: [
    [ci ? "github" : "list"],
    ...(process.env.E2E_JSON_REPORT
      ? [["json", { outputFile: process.env.E2E_JSON_REPORT }] as const]
      : []),
  ],
  // Builds the pages the tests open first before any test starts (tests/e2e/warmup.ts).
  globalSetup: "./tests/e2e/warmup.ts",
  globalTeardown: "./tests/e2e/teardown.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  // Mobile first: workers use the portal from a phone. The browser (only) maps a made-up domain
  // (.test is reserved: it never resolves on the internet) to this machine's https front for it, so
  // a firm's own domain can be tried, logins included (tests/e2e/custom-domain.spec.ts, which alone
  // accepts the front's self-signed certificate; next.config.ts lets the dev server serve it).
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: [`--host-resolver-rules=MAP ${CUSTOM_DOMAIN} 127.0.0.1:${TLS_FRONT_PORT}`],
        },
      },
    },
  ],
  webServer: [
    {
      // Takes the e2e lock, rebuilds and seeds the *_e2e database, then runs the worker (it sends
      // the login links). If another e2e run holds the lock this one stops without touching it.
      command: `node --import tsx tests/e2e/worker.ts 2>&1 | tee ${SERVER_LOGS[0]}`,
      wait: { stdout: /\[worker\] started/ },
      env,
      timeout: 120_000,
    },
    {
      command: `(${ci ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`}) 2>&1 | tee ${SERVER_LOGS[1]}`,
      url: `http://localhost:${PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // https for the made-up domain, passing requests to the web app above (as Caddy would).
      command: `node --import tsx tests/e2e/tls-front.ts ${CUSTOM_DOMAIN} ${TLS_FRONT_PORT} ${PORT}`,
      wait: { stdout: /\[tls-front\] https for/ },
      timeout: 30_000,
    },
  ],
});
