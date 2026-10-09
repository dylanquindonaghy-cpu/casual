// `npm run e2e`: the browser tests (playwright.config.ts), then, if they pass, the walkthrough's own
// run on a production build (playwright.walkthrough.config.ts; Phase 10 task 20). With arguments
// (`npm run e2e -- tests/e2e/login.worker.spec.ts`, or `-g "a test's name"`), only the main run gets
// them, as before; the walkthrough alone is `npm run e2e:walkthrough`.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const playwright = (extra) =>
  spawnSync("npx", ["playwright", "test", ...extra], { stdio: "inherit" }).status ?? 1;

const main = playwright(args);
if (main !== 0 || args.length > 0) process.exit(main);
process.exit(playwright(["-c", "playwright.walkthrough.config.ts"]));
