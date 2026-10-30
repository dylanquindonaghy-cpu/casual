import { defineConfig, devices } from "@playwright/test";
import { serverEnv } from "./playwright.config";

// The browser tests' run with no text sender (P2.7; tests/e2e/no-texts.spec.ts): the web app and
// the worker with MESSAGING_TRANSPORT=none, as production runs until the firm's text system is
// connected, so a casual's login link and pay code go by email once the firm switches
// `login_by_email` on, and the pages say so. `npm run e2e` runs it after the main run (which can't:
// its servers have the console text sender every other test needs).
// - The same *_e2e database, rebuilt and seeded at the start by tests/e2e/worker.ts, as each run.
// - Its own port and outbox, so nothing it reads was sent by the main run.
// - With CI set, the main run's production build (`next start`), else `next dev`.
export const NO_TEXTS_PORT = 3300;
export const NO_TEXTS_OUTBOX = ".dev/no-texts-outbox.jsonl";
export const NO_TEXTS_LOGS = [".dev/no-texts-worker.log", ".dev/no-texts-web.log"] as const;
const ci = !!process.env.CI;

const env = {
  ...serverEnv(NO_TEXTS_PORT, NO_TEXTS_OUTBOX, { testPages: false }),
  // No text sender, for the web app (its words) and the worker (its sends) alike.
  MESSAGING_TRANSPORT: "none",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/no-texts.spec.ts",
  forbidOnly: ci,
  retries: 0,
  workers: 1,
  // The JSON report for scripts/invariants.sh, as in playwright.config.ts.
  reporter: [
    [ci ? "github" : "list"],
    ...(process.env.E2E_JSON_REPORT
      ? [["json", { outputFile: process.env.E2E_JSON_REPORT }] as const]
      : []),
  ],
  globalTeardown: "./tests/e2e/no-texts-teardown.ts",
  // `next dev` builds each page the first time it's opened.
  timeout: 120_000,
  use: { baseURL: `http://localhost:${NO_TEXTS_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: `node --import tsx tests/e2e/worker.ts 2>&1 | tee ${NO_TEXTS_LOGS[0]}`,
      wait: { stdout: /\[worker\] started/ },
      env,
      timeout: 120_000,
    },
    {
      command: `(${ci ? `(test -f .next/BUILD_ID || npm run build) && npx next start -p ${NO_TEXTS_PORT}` : `npx next dev -p ${NO_TEXTS_PORT}`}) 2>&1 | tee ${NO_TEXTS_LOGS[1]}`,
      url: `http://localhost:${NO_TEXTS_PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
