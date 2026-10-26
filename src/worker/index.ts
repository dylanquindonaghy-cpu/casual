import { listFirmIds } from "../lib/db/directory";
import { chooseDbProfile, withFirm } from "../lib/db/scoped";
import { isDemoFirm } from "../lib/demo/firms";
import { assertDemoServer, watchDemoServer, type DemoServerChecks } from "../lib/demo/guard";
import { realPeopleIn } from "../lib/demo/people";
import { workerEnv } from "../lib/env";
import { onlyRunJobsFor } from "../lib/jobs/firm-job";
import { log } from "../lib/log";
import { routeConsoleThroughMasking } from "../lib/log/console";
import { alertTransport } from "../lib/ops/alerts";
import { sheetsClientFrom } from "../lib/roster/sheets/transport";
import { createBoss } from "./boss";
import { startHeartbeat } from "./heartbeat";
import { registerJobs } from "./jobs";

routeConsoleThroughMasking();
// The worker's share of the database and its longer limits (P4.2; ADR-027), before its first query.
chooseDbProfile("worker");
// Log through the masker, then crash as Node would by default (the process manager restarts it).
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { error: reason });
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  log.error("uncaught exception", { error: err });
  process.exit(1);
});

const env = workerEnv();
const boss = createBoss(env.DATABASE_JOBS_URL);
// Google Sheets: none (the default) until a Google account exists (PLAN.md Parking lot, "Connect
// the real Google Sheets"); then the real client, its key file read here, once.
const sheets = sheetsClientFrom(env);

async function shutdown(signal: string): Promise<void> {
  log.info("worker stopping", { signal });
  await boss.stop({ graceful: true });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Demo mode (ADR-025) prints messages instead of sending them: only ever with the made-up demo
// firms and their made-up people alone (src/lib/demo/guard.ts). Checked before any job starts,
// then every minute; a firm that isn't a demo firm, or a real person in one, stops the worker (its
// container then can't start again until they're gone). And a job for any other firm is refused
// before it runs, even between two checks.
if (env.DEMO_MODE === "on") {
  const checks: DemoServerChecks = {
    listFirmIds,
    realPeople: (firmId) => withFirm(firmId, realPeopleIn),
  };
  await assertDemoServer(checks);
  onlyRunJobsFor(isDemoFirm);
  watchDemoServer(checks, {
    stop: (err) => {
      log.error("demo mode stopped the worker", { error: err });
      process.exit(1);
    },
    missed: (err) => log.warn("demo mode's check didn't run", { error: err }),
  });
  log.info("demo mode: every message is printed to the outbox, none is sent");
}

await boss.start();
await registerJobs(boss, {
  sheets,
  alerts: alertTransport(env.ALERTS_TRANSPORT),
  ...(env.HEALTH_CHECK_URL ? { healthCheckUrl: env.HEALTH_CHECK_URL } : {}),
});
// Its container's health check reads this (deploy/docker-compose.yml).
if (env.WORKER_HEARTBEAT_FILE) startHeartbeat(env.WORKER_HEARTBEAT_FILE);
// Plain line kept for humans and for Playwright's readiness check.
console.log("[worker] started, listening for jobs");
log.info("worker started");
