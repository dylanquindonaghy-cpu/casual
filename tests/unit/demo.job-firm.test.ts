import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FirmTx, WithFirm } from "@/lib/db/scoped";
import { isDemoFirm } from "@/lib/demo/firms";
import { parseOutbox, readOutboxTail } from "@/lib/demo/outbox";
import { seedId } from "@/lib/demo/seed-id";
import {
  defineFirmJob,
  firmJobEnvelope,
  onlyRunJobsFor,
  runFirmJob,
  runFirmTask,
  type FirmTask,
} from "@/lib/jobs/firm-job";
import { createLogger } from "@/lib/log";
import { createConsoleTransport } from "@/lib/messaging/console";
import { jobFirmId } from "@/lib/tenancy/job-firm";

// Each job runs inside its firm (16.1; ADR-025): what it sends is stamped with that firm in the
// outbox, which is how each firm's Demo phone shows its own messages alone, even to a number two
// firms share. And in demo mode the worker refuses any other firm's job before it runs.

const ACME = seedId("firm/acme");
const NORTHLINE = seedId("firm/northline");
const REAL = "0f3c2b8e-9a41-4d7e-8b2a-5c6d7e8f9a0b";
const quiet = createLogger({ write: () => undefined });
// No database: the job's withFirm just runs its function.
const run: WithFirm = (_firmId, fn) => fn({} as FirmTx);

async function outboxFile() {
  return join(await mkdtemp(join(tmpdir(), "job-firm-")), "outbox.jsonl");
}

const job = (firmId: string, n = 1) => ({
  id: `job-${firmId}-${n}`,
  data: { firmId, idempotencyKey: `k-${n}` },
});

afterEach(() => onlyRunJobsFor(null));

describe("what a job sends", () => {
  it("is stamped with the job's firm, task or job alike; one number, two firms, two stamps", async () => {
    const file = await outboxFile();
    const transport = createConsoleTransport(() => undefined, file);
    const texts: FirmTask<{ firmId: string; idempotencyKey: string }> = {
      queue: "test-demo-texts",
      schema: firmJobEnvelope,
      task: async () => {
        await transport.send({ channel: "sms", to: "+447700900150", body: "from a task" });
      },
    };
    const emails = defineFirmJob({
      queue: "test-demo-emails",
      schema: firmJobEnvelope,
      handler: async () => {
        await transport.send({
          channel: "email",
          to: "acme.payroll@example.com",
          subject: "Pay queries",
          body: "from a job",
        });
      },
    });
    expect((await runFirmTask(texts, job(ACME), run, quiet)).status).toBe("completed");
    expect((await runFirmTask(texts, job(NORTHLINE), run, quiet)).status).toBe("completed");
    expect((await runFirmJob(emails, job(ACME, 2), run, quiet)).status).toBe("completed");
    // Outside any job (nothing sends there): no firm.
    await transport.send({ channel: "sms", to: "+447700900150", body: "outside" });

    const lines = parseOutbox(await readOutboxTail(file));
    expect(lines.map((m) => [m.body, m.firmId])).toEqual([
      ["from a task", ACME],
      ["from a task", NORTHLINE],
      ["from a job", ACME],
      ["outside", undefined],
    ]);
    expect(jobFirmId()).toBeUndefined();
  });

  it("the stamp is the job's own firm even when two jobs run at once", async () => {
    const seen: [string, string | undefined][] = [];
    const slow: FirmTask<{ firmId: string; idempotencyKey: string }> = {
      queue: "test-demo-slow",
      schema: firmJobEnvelope,
      task: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, payload.firmId === ACME ? 20 : 1));
        seen.push([payload.firmId, jobFirmId()]);
      },
    };
    await Promise.all([
      runFirmTask(slow, job(ACME), run, quiet),
      runFirmTask(slow, job(NORTHLINE), run, quiet),
    ]);
    expect(seen).toEqual([
      [NORTHLINE, NORTHLINE],
      [ACME, ACME],
    ]);
  });
});

describe("in demo mode, another firm's job", () => {
  it("fails without running, while the demo firms' run as usual", async () => {
    onlyRunJobsFor(isDemoFirm);
    const ran = vi.fn();
    const task: FirmTask<{ firmId: string; idempotencyKey: string }> = {
      queue: "test-demo-only",
      schema: firmJobEnvelope,
      task: async (payload) => {
        ran(payload.firmId);
      },
    };
    const refused = await runFirmTask(task, job(REAL), run, quiet);
    expect(refused).toEqual({
      id: `job-${REAL}-1`,
      status: "failed",
      output: { error: "firm_not_allowed" },
    });
    const handler = vi.fn();
    const plain = defineFirmJob({ queue: "test-demo-only-job", schema: firmJobEnvelope, handler });
    expect((await runFirmJob(plain, job(REAL), run, quiet)).status).toBe("failed");
    expect(handler).not.toHaveBeenCalled();
    expect((await runFirmTask(task, job(ACME), run, quiet)).status).toBe("completed");
    expect(ran.mock.calls).toEqual([[ACME]]);
  });

  it("runs as usual without demo mode (no restriction set)", async () => {
    const handler = vi.fn();
    const plain = defineFirmJob({ queue: "test-any-firm", schema: firmJobEnvelope, handler });
    expect((await runFirmJob(plain, job(REAL), run, quiet)).status).toBe("completed");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
