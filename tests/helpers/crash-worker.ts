import { createBoss } from "../../src/worker/boss";
import { registerFirmTask } from "../../src/worker/jobs";
import { firmJobEnvelope } from "../../src/lib/jobs/firm-job";

// A worker process for tests/integration/jobs.crash.test.ts: it works one test queue exactly as the
// real worker works a firm queue (registerFirmTask: batches of 5, run one after another), with a task
// that never finishes. The test kills this process with SIGKILL while it holds a batch: a crash.
const [queue] = process.argv.slice(2);
const url = process.env.DATABASE_JOBS_URL;
if (!queue || !url) throw new Error("usage: crash-worker <queue> (DATABASE_JOBS_URL set)");

const boss = createBoss(url);
await boss.start();
await registerFirmTask(boss, {
  queue,
  schema: firmJobEnvelope,
  task: () => new Promise<never>(() => undefined),
});
process.stdout.write("ready\n");
