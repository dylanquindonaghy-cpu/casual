import { env } from "../lib/env";
import { createBoss } from "./boss";
import { registerJobs } from "./jobs";

const boss = createBoss(env().DATABASE_URL);

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, stopping`);
  await boss.stop({ graceful: true });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await boss.start();
await registerJobs(boss);
console.log("[worker] started, listening for jobs");
