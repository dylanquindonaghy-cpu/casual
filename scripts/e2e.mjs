// `npm run e2e`: the browser tests (playwright.config.ts), then, if they pass, the run with no text
// sender (playwright.no-texts.config.ts; P2.7), then the walkthrough's own run on a production build
// (playwright.walkthrough.config.ts; Phase 10 task 20). With arguments (`npm run e2e --
// tests/e2e/login.worker.spec.ts`, or `-g "a test's name"`), only the main run gets them, as
// before; the others alone are `npm run e2e:no-texts` and `npm run e2e:walkthrough`.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// With E2E_JSON_DIR (scripts/verify.sh sets it), each run also writes its results as JSON there,
// e2e-main.json, e2e-no-texts.json and e2e-walkthrough.json, for scripts/invariants.sh to check for
// skipped tests.

const args = process.argv.slice(2);
const report = (name) =>
  process.env.E2E_JSON_DIR ? { E2E_JSON_REPORT: join(process.env.E2E_JSON_DIR, name) } : {};
const playwright = (extra, name) =>
  spawnSync("npx", ["playwright", "test", ...extra], {
    stdio: "inherit",
    env: { ...process.env, ...report(name) },
  }).status ?? 1;

const main = playwright(args, "e2e-main.json");
if (main !== 0 || args.length > 0) process.exit(main);
const noTexts = playwright(["-c", "playwright.no-texts.config.ts"], "e2e-no-texts.json");
if (noTexts !== 0) process.exit(noTexts);
process.exit(playwright(["-c", "playwright.walkthrough.config.ts"], "e2e-walkthrough.json"));
