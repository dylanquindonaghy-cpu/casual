import { workerEnv } from "../lib/env";
import { log } from "../lib/log";
import { routeConsoleThroughMasking } from "../lib/log/console";
import { createBoss } from "./boss";
import { registerJobs } from "./jobs";

routeConsoleThroughMasking();
// Log through the masker, then crash as Node would by default (the process manager restarts it).
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { error: reason });
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  log.error("uncaught exception", { error: err });
  process.exit(1);
});

const boss = createBoss(workerEnv().DATABASE_JOBS_URL);

async function shutdown(signal: string): Promise<void> {
  log.info("worker stopping", { signal });
  await boss.stop({ graceful: true });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await boss.start();
await registerJobs(boss);
// Plain line kept for humans and for Playwright's readiness check.
console.log("[worker] started, listening for jobs");
log.info("worker started");
