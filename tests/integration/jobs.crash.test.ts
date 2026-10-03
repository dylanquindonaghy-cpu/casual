import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoss, SUPERVISE_SECONDS } from "@/worker/boss";
import { ensureQueues, FIRM_HEARTBEAT_SECONDS, firmQueue } from "@/worker/jobs/queues";
import { superuserPool } from "../helpers/db";
import { testUrls } from "../setup/test-db";

// Audit finding L55: the worker fetches up to 5 jobs at a time and marks them all active. If the
// process is killed mid-batch, the jobs it holds used to wait for pg-boss's 15-minute expiry before
// anyone retried them. Firm queues now carry a heartbeat (src/worker/jobs/queues.ts), so a killed
// worker's jobs go back to be retried within about a minute: the 30-second heartbeat, then the
// supervisor's next look (every SUPERVISE_SECONDS, src/worker/boss.ts). Here a real worker process
// takes a batch from a firm-style queue and is killed with SIGKILL, and the supervisor is another
// worker built exactly as production builds it (createBoss), so the bound is production's own.

const urls = testUrls();
let su: Pool;
let supervisor: PgBoss;
let child: ChildProcess | null = null;
const queue = `crash-test-${randomUUID().slice(0, 8)}`;
const older = `older-queue-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  su = superuserPool();
  // Another worker (in production, the restarted one), with production's settings.
  supervisor = createBoss(urls.jobs);
  await supervisor.start();
});
afterAll(async () => {
  child?.kill("SIGKILL");
  await supervisor.deleteQueue(queue);
  await supervisor.deleteQueue(older);
  await supervisor.stop({ graceful: false });
  await su.end();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function states(): Promise<string[]> {
  const { rows } = await su.query<{ state: string }>(
    "select state from pgboss.job where name = $1 order by created_on",
    [queue],
  );
  return rows.map((r) => r.state);
}

describe("a worker killed mid-batch", () => {
  it("leaves no job stranded for 15 minutes: they're retried within about a minute", async () => {
    const spec = firmQueue(queue);
    expect(spec.options?.heartbeatSeconds).toBe(FIRM_HEARTBEAT_SECONDS);
    await supervisor.createQueue(queue, spec.options);
    const firmId = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      await supervisor.send(queue, { firmId, idempotencyKey: `crash:${i}` });
    }

    // A real worker process takes the batch (all 3 active), its task never finishing.
    child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/crash-worker.ts", queue], {
      env: { ...process.env, DATABASE_JOBS_URL: urls.jobs },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const deadline = Date.now() + 30_000;
    while ((await states()).filter((s) => s === "active").length < 3) {
      if (Date.now() > deadline)
        throw new Error(`the worker never took the batch: ${await states()}`);
      await sleep(200);
    }

    // The crash: no graceful stop, no chance to fail its jobs.
    const killedAt = Date.now();
    child.kill("SIGKILL");
    child = null;

    // Back in the queue, to be retried: the heartbeat runs out, then the supervisor's next look
    // (allowing for one missed pass, as its claim and its timer can drift apart by a moment).
    const bound = (FIRM_HEARTBEAT_SECONDS + 2 * SUPERVISE_SECONDS + 5) * 1000;
    expect(bound).toBeLessThanOrEqual(65_000);
    for (;;) {
      const now = await states();
      if (now.every((s) => s !== "active")) {
        expect(now.every((s) => s === "retry" || s === "created")).toBe(true);
        break;
      }
      if (Date.now() - killedAt > bound) throw new Error(`still active after ${bound} ms: ${now}`);
      await sleep(500);
    }
    expect(Date.now() - killedAt).toBeLessThan(bound);
  }, 120_000);
});

describe("a queue made before the heartbeat existed", () => {
  it("gets it, and the rest of today's options, when the worker next starts (ensureQueues)", async () => {
    // As an existing database had it: the firm policy and retention, no heartbeat.
    await supervisor.createQueue(older, { policy: "standard", deleteAfterSeconds: 7 * 86_400 });
    expect((await supervisor.getQueue(older))?.heartbeatSeconds ?? null).toBeNull();
    await ensureQueues(supervisor, [firmQueue(older)]);
    expect(await supervisor.getQueue(older)).toMatchObject({
      policy: "standard",
      heartbeatSeconds: FIRM_HEARTBEAT_SECONDS,
      deleteAfterSeconds: 24 * 60 * 60,
    });
  });
});
