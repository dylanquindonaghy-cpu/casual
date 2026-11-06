import { defineConfig, devices } from "@playwright/test";
import { serverEnv } from "./playwright.config";

// The browser tests' street-map run (Phase 26.2; the claims-auditor's round 1;
// tests/e2e/streets.spec.ts): the office dashboard with the firm's street map switched on, as a
// firm with its map file has it (MAP_TILES_URL, a path on our own server). Every other run pins it
// off. The browser is answered that path with a tiny map file made in the test
// (tests/e2e/pmtiles-fixture.ts), as Caddy serves the real one: no outside map host is ever asked.
// `npm run e2e` runs it after the run with no text sender.
// - The same *_e2e database, rebuilt and seeded at the start by tests/e2e/worker.ts, as each run.
// - Its own port and outbox.
// - With CI set, the main run's production build (`next start`), else `next dev`.
// - Chromium draws MapLibre's WebGL in software (SwiftShader), as on CI's machines with no GPU.
export const STREETS_PORT = 3500;
export const STREETS_OUTBOX = ".dev/streets-outbox.jsonl";
export const STREETS_LOGS = [".dev/streets-worker.log", ".dev/streets-web.log"] as const;
export const STREETS_FILE = "/maps/e2e-streets.pmtiles";
const ci = !!process.env.CI;

const env = {
  ...serverEnv(STREETS_PORT, STREETS_OUTBOX, { testPages: false }),
  // The firm's street map on (only here): a path on this server.
  MAP_TILES_URL: STREETS_FILE,
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/streets.spec.ts",
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
  globalTeardown: "./tests/e2e/streets-teardown.ts",
  // `next dev` builds each page the first time it's opened.
  timeout: 120_000,
  // en-GB (Phase 28): dates read dd/mm/yyyy, as in the other runs.
  use: { baseURL: `http://localhost:${STREETS_PORT}`, trace: "retain-on-failure", locale: "en-GB" },
  projects: [
    {
      name: "laptop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
      },
    },
  ],
  webServer: [
    {
      command: `node --import tsx tests/e2e/worker.ts 2>&1 | tee ${STREETS_LOGS[0]}`,
      wait: { stdout: /\[worker\] started/ },
      env,
      timeout: 120_000,
    },
    {
      command: `(${ci ? `(test -f .next/BUILD_ID || npm run build) && npx next start -p ${STREETS_PORT}` : `npx next dev -p ${STREETS_PORT}`}) 2>&1 | tee ${STREETS_LOGS[1]}`,
      url: `http://localhost:${STREETS_PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
