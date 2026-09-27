import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { fromDrizzle, PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { withFirm, type FirmTx } from "@/lib/db/scoped";
import {
  defineFirmJob,
  firmJobEnvelope,
  firmScoped,
  runFirmJob,
  sendFirmJob,
} from "@/lib/jobs/firm-job";
import { createBoss } from "@/worker/boss";
import { registerFirmJob } from "@/worker/jobs";
import { firmQueue } from "@/worker/jobs/queues";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { inFirm, pgError, Rollback } from "../helpers/rls-probe";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Firm jobs: a zod envelope with firmId, handlers inside withFirm, and a database policy that
// stops the web queueing a job for any firm but its own.

const QUEUE = "test-firm-echo";

// Reports which firm it ran in and whether that firm can see the given worker.
const echo = defineFirmJob({
  queue: QUEUE,
  schema: firmJobEnvelope.extend({ workerId: z.uuid() }),
  handler: async (payload, tx) => {
    const firm = await tx.execute<{ firm: string }>(sql`select app_current_firm_id() as firm`);
    const found = await tx.execute(sql`select 1 from workers where id = ${payload.workerId}`);
    return { firm: firm.rows[0]?.firm, found: found.rows.length === 1 };
  },
});

let su: Pool;
let app: Pool;
let A: Tenant;
let B: Tenant;
let boss: PgBoss;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool(1);
  A = await createTenant(su);
  B = await createTenant(su);
  boss = createBoss(urls.jobs);
  await boss.start();
  await boss.createQueue(QUEUE, firmQueue(QUEUE).options);
});
afterAll(async () => {
  await boss.stop({ graceful: false });
  await Promise.all([su.end(), app.end()]);
});

const jobData = async (id: string | null) => {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    "select data from pgboss.job where id = $1",
    [id],
  );
  return rows[0]?.data;
};

describe("running firm jobs", () => {
  it("runs the handler inside the payload's firm, so RLS scopes what it sees", async () => {
    const own = await runFirmJob(echo, {
      id: "j1",
      data: { firmId: A.firmId, idempotencyKey: "k1", workerId: A.workerId },
    });
    expect(own).toEqual({ id: "j1", status: "completed", output: { firm: A.firmId, found: true } });
    const other = await runFirmJob(echo, {
      id: "j2",
      data: { firmId: A.firmId, idempotencyKey: "k2", workerId: B.workerId },
    });
    expect(other.output).toEqual({ firm: A.firmId, found: false });
  });

  it("a bad payload dead-letters only its own job in a batch", async () => {
    const results = await Promise.all(
      [
        { firmId: A.firmId, idempotencyKey: "a", workerId: A.workerId },
        { idempotencyKey: "no-firm", workerId: A.workerId },
        { firmId: B.firmId, idempotencyKey: "b", workerId: B.workerId },
      ].map((data, i) => runFirmJob(echo, { id: `b${i}`, data })),
    );
    expect(results.map((r) => r.status)).toEqual(["completed", "deadletter", "completed"]);
    expect(results[1]?.output).toEqual({
      error: "invalid_payload",
      issues: [{ path: "firmId", code: "invalid_type" }],
    });
  });

  it("a failing handler keeps only a safe error code, never the error's details", async () => {
    const leaky = defineFirmJob({
      queue: QUEUE,
      schema: firmJobEnvelope,
      handler: async () => {
        throw Object.assign(new Error("duplicate key +447700900123"), {
          code: "23505",
          detail: "Key (firm_id, mobile_e164)=(..., +447700900123) already exists.",
        });
      },
    });
    const result = await runFirmJob(leaky, {
      id: "f1",
      data: { firmId: A.firmId, idempotencyKey: "f" },
    });
    expect(result).toEqual({
      id: "f1",
      status: "failed",
      output: { error: "handler_failed", code: "23505" },
    });
    expect(JSON.stringify(result)).not.toContain("7700900");
  });
});

describe("queueing firm jobs", () => {
  it("queues inside the current firm's transaction, with firmId taken from it", async () => {
    const id = await withFirm(A.firmId, (tx) =>
      sendFirmJob(tx, echo, { idempotencyKey: "q1", workerId: A.workerId }),
    );
    expect(await jobData(id)).toEqual({
      firmId: A.firmId,
      idempotencyKey: "q1",
      workerId: A.workerId,
    });
  });

  it("ignores a firmId smuggled in by the caller", async () => {
    const smuggled = { idempotencyKey: "q2", workerId: A.workerId, firmId: B.firmId };
    const id = await withFirm(A.firmId, (tx) => sendFirmJob(tx, echo, smuggled));
    expect((await jobData(id))?.firmId).toBe(A.firmId);
  });

  it("one firm's throttle key never swallows another firm's job (control: same firm does)", async () => {
    const opts = { singletonKey: "same-key", singletonSeconds: 300 };
    const send = (t: Tenant, key: string) =>
      withFirm(t.firmId, (tx) =>
        sendFirmJob(tx, echo, { idempotencyKey: key, workerId: t.workerId }, opts),
      );
    const a1 = await send(A, "d1");
    const a2 = await send(A, "d2"); // same firm, same key, same window: pg-boss drops it
    const b1 = await send(B, "d3"); // other firm, same key: must still be queued
    expect(a1).toBeTruthy();
    expect(a2).toBeNull();
    expect(b1).toBeTruthy();
  });

  it("prefixes every dedupe and group key with the firm, and refuses a caller's job id", () => {
    expect(firmScoped(A.firmId, { singletonKey: "k" })?.singletonKey).toBe(`${A.firmId}:k`);
    expect(firmScoped(A.firmId, { singletonSeconds: 60 })?.singletonKey).toBe(`${A.firmId}:`);
    expect(firmScoped(A.firmId, { group: { id: "g" } })?.group?.id).toBe(`${A.firmId}:g`);
    expect(firmScoped(A.firmId, { priority: 1 })).toEqual({ priority: 1 });
    const withId = { id: crypto.randomUUID() } as Parameters<typeof firmScoped>[1];
    expect(() => firmScoped(A.firmId, withId)).toThrow(/job id/);
  });

  it("refuses an idempotency key that isn't ids and separators", async () => {
    await expect(
      withFirm(A.firmId, (tx) =>
        sendFirmJob(tx, echo, { idempotencyKey: "call +447700900123", workerId: A.workerId }),
      ),
    ).rejects.toThrow(/idempotencyKey/);
  });

  it("must be called inside withFirm", async () => {
    await expect(
      sendFirmJob({} as FirmTx, echo, { idempotencyKey: "q3", workerId: A.workerId }),
    ).rejects.toThrow(/inside withFirm/);
  });

  it("a job queued in a rolled-back transaction never exists", async () => {
    let id: string | null = null;
    await expect(
      withFirm(A.firmId, async (tx) => {
        id = await sendFirmJob(tx, echo, { idempotencyKey: "q4", workerId: A.workerId });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(id).not.toBeNull();
    expect(await jobData(id)).toBeUndefined();
  });

  it.each([
    [
      "another firm's job",
      QUEUE,
      () => ({ firmId: B.firmId, idempotencyKey: "x", workerId: B.workerId }),
    ],
    ["a job with no firm", QUEUE, () => ({ idempotencyKey: "x" })],
    ["a job on pg-boss's internal queue", "__pgboss__send-it", () => ({ firmId: A.firmId })],
  ])("the database refuses %s from the app role", async (_label, queue, data) => {
    const err = await pgError(
      withFirm(A.firmId, (tx) => {
        const raw = new PgBoss({
          db: fromDrizzle(tx, sql),
          createSchema: false,
          migrate: false,
          supervise: false,
          schedule: false,
        });
        return raw.send(queue, data());
      }),
    );
    expect(err).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/row-level security/),
    });
  });

  it.each([
    ["read queued jobs", "select data from pgboss.job_common limit 1"],
    ["change a queued job", "update pgboss.job_common set data = '{}'"],
    ["delete queued jobs", "delete from pgboss.job_common"],
    [
      "add a schedule",
      "insert into pgboss.schedule (name, key, cron, timezone) values ('x', 'x', '* * * * *', 'UTC')",
    ],
  ])("the app role can't %s", async (_label, statement) => {
    const err = await pgError(inFirm(app, A.firmId, (c) => c.query(statement)));
    expect(err).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/),
    });
  });
});

describe("through the worker", () => {
  it("a job queued by the web is run by the worker inside the same firm", async () => {
    await registerFirmJob(boss, echo);
    const id = await withFirm(B.firmId, (tx) =>
      sendFirmJob(tx, echo, { idempotencyKey: "w1", workerId: B.workerId }),
    );
    expect(id).toBeTruthy();
    const deadline = Date.now() + 15_000;
    let state = "";
    let output: unknown;
    while (Date.now() < deadline) {
      const job = await boss.getJobById(QUEUE, id as string);
      state = job?.state ?? "";
      output = job?.output;
      if (["completed", "failed"].includes(state)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(state).toBe("completed");
    expect(output).toEqual({ firm: B.firmId, found: true });
  });
});
