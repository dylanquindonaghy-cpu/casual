import { defineConfig, devices } from "@playwright/test";
import { serverEnv } from "./playwright.config";

// The walkthrough's own browser-test run (Phase 10 task 20; tests/e2e/walkthrough.spec.ts follows
// docs/walkthrough.md step by step). `npm run e2e` runs it after the other browser tests.
// - Its own database, rebuilt and seeded at the start (by tests/e2e/worker.ts), so it starts
//   exactly where Dylan starts after `npm run db:reset`: the other tests use up demo state it
//   needs (the urgent dropout, the seeded office logins).
// - A production build of the web app (`next build`, then `next start`), as the server runs it, so
//   a passing run also proves the production build works (audit L16, L88).
// - The office at desktop size (audit L66); the worker's steps on a phone-sized screen.
// - Demo mode (16.1; ADR-025), as a demo server runs it: the web app and the worker both in
//   production, the worker printing every message into the outbox and checking that only the
//   made-up demo firms and people are there (its database holds nothing else), and the whole site
//   behind the demo's password (the browser gives it: `httpCredentials` below). Then, once the
//   walkthrough is done (so it starts exactly where Dylan starts), tests/e2e/demo.spec.ts logs in
//   from the Demo phone and checks the password.
export const WALKTHROUGH_PORT = 3200;
// Made up, for this run only (a demo server's is in its own .env: docs/runbooks.md "A demo server").
export const WALKTHROUGH_SITE_PASSWORD = "walkthrough-e2e-only-demo-password";
export const WALKTHROUGH_OUTBOX = ".dev/walkthrough-outbox.jsonl";
export const WALKTHROUGH_LOGS = [
  ".dev/walkthrough-worker.log",
  ".dev/walkthrough-web.log",
] as const;

const env = {
  // Production's defaults otherwise: the test-only pages are off.
  ...serverEnv(WALKTHROUGH_PORT, WALKTHROUGH_OUTBOX, { testPages: false }),
  // `next start` runs with NODE_ENV=production, which refuses .env.example's secret: one of its own,
  // shared by the web app and the worker.
  SESSION_SECRET: "walkthrough-e2e-only-secret-not-for-any-real-use",
  // Likewise the planner integration secret (12J.1): its own, never .env.example's.
  INTEGRATIONS_SECRET: "walkthrough-e2e-only-integrations-secret-not-real",
  // Demo mode, for the web app and the worker alike (the outbox is serverEnv's). Its password goes
  // to the web app alone, as on a demo server (deploy/docker-compose.demo.yml): below.
  DEMO_MODE: "on",
  // Demo mode sends nothing outside the server: no pushes either (serverEnv's console sender is
  // for development; production refuses it).
  PUSH_TRANSPORT: "none",
  // Both servers run as production, as on a demo server.
  NODE_ENV: "production",
};

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // The JSON report for scripts/invariants.sh, as in playwright.config.ts.
  reporter: [
    [process.env.CI ? "github" : "list"],
    ...(process.env.E2E_JSON_REPORT
      ? [["json", { outputFile: process.env.E2E_JSON_REPORT }] as const]
      : []),
  ],
  globalTeardown: "./tests/e2e/walkthrough-teardown.ts",
  timeout: 15 * 60_000,
  use: {
    baseURL: `http://localhost:${WALKTHROUGH_PORT}`,
    trace: "retain-on-failure",
    // The demo's password, which the browser gives when the site asks (src/lib/demo/gate.ts).
    httpCredentials: { username: "demo", password: WALKTHROUGH_SITE_PASSWORD },
    // A step that can't happen fails in seconds, not at the end of the whole run's time.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  // The walkthrough first, then the Demo phone's own test: Playwright would otherwise run the files
  // in name order, demo.spec.ts first, and the walkthrough would no longer start where Dylan does.
  projects: [
    {
      name: "desktop-chrome",
      testMatch: "**/walkthrough.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "demo",
      testMatch: "**/demo.spec.ts",
      dependencies: ["desktop-chrome"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `node --import tsx tests/e2e/worker.ts 2>&1 | tee ${WALKTHROUGH_LOGS[0]}`,
      wait: { stdout: /\[worker\] started/ },
      env,
      timeout: 120_000,
    },
    {
      command: `(npm run build && npx next start -p ${WALKTHROUGH_PORT}) 2>&1 | tee ${WALKTHROUGH_LOGS[1]}`,
      url: `http://localhost:${WALKTHROUGH_PORT}`,
      // .env's NODE_ENV=development (loaded by playwright.config.ts) would reach the build, which
      // then can't prerender its pages ("non-standard NODE_ENV"): `env` says production.
      env: { ...env, DEMO_SITE_PASSWORD: WALKTHROUGH_SITE_PASSWORD },
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
