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
export const WALKTHROUGH_PORT = 3200;
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
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/walkthrough.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./tests/e2e/walkthrough-teardown.ts",
  timeout: 15 * 60_000,
  use: {
    baseURL: `http://localhost:${WALKTHROUGH_PORT}`,
    trace: "retain-on-failure",
    // A step that can't happen fails in seconds, not at the end of the whole run's time.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } }],
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
      // then can't prerender its pages ("non-standard NODE_ENV"). The worker keeps development:
      // production refuses its console transport.
      env: { ...env, NODE_ENV: "production" },
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
