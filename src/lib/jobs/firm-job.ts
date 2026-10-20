import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type JobResult, type SendOptions } from "pg-boss";
import { z } from "zod";
import { activeFirmId, withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { log, type Logger } from "../log";
import { runAsFirm } from "../tenancy/job-firm";

// Firm jobs: every payload extends this envelope, and every handler runs inside
// withFirm(payload.firmId), so RLS scopes all of its work to that firm.
//
// Payloads and handler outputs carry ids only. The jobs role owns the pgboss tables and isn't
// firm-restricted there (job_common's RLS binds only the app role), so never put a phone number,
// email, name, token or code in either. Tokens and codes are generated inside the job.

export const firmJobEnvelope = z.object({
  firmId: z.uuid(),
  // Lets a handler notice it has already done this work when pg-boss retries it. Ids and
  // separators only, so no free text (and no personal data) can ride along.
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
});
export type FirmJobEnvelope = z.infer<typeof firmJobEnvelope>;

export interface FirmJob<P extends FirmJobEnvelope> {
  queue: string;
  // Build with firmJobEnvelope.extend({...}).
  schema: z.ZodType<P>;
  handler: (payload: P, tx: FirmTx) => Promise<unknown>;
}

export function defineFirmJob<P extends FirmJobEnvelope>(job: FirmJob<P>): FirmJob<P> {
  return job;
}

// A firm job that needs several transactions, e.g. with network calls between them (holding a
// transaction open across a call to Google would hold its locks too). The handler gets withFirm
// bound to the payload's firm: asking for any other firm throws.
export interface FirmTask<P extends FirmJobEnvelope> {
  queue: string;
  schema: z.ZodType<P>;
  task: (payload: P, run: WithFirm, attempt: JobAttempt) => Promise<unknown>;
}

// Which try this is: pg-boss's retry count (0 on the first), and the queue's retry limit when the
// worker asked for it (`includeMetadata`; null otherwise). A task that must act on its last try
// (the planner's webhook logs webhook.failed and completes) reads both.
export interface JobAttempt {
  retryCount: number;
  retryLimit: number | null;
}

export type FirmSendOptions = Omit<SendOptions, "db" | "id">;

// Queues a firm job inside the current withFirm transaction, so it commits or rolls back with
// the state change that caused it. firmId always comes from the transaction, never the caller,
// and the database policy on pgboss.job_common rejects any other firm (see admin/jobs.ts).
export async function sendFirmJob<P extends FirmJobEnvelope>(
  tx: FirmTx,
  job: Pick<FirmJob<P>, "queue" | "schema">,
  payload: Omit<P, "firmId">,
  options?: FirmSendOptions,
): Promise<string | null> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("sendFirmJob must be called inside withFirm");
  const data = job.schema.parse({ ...payload, firmId });
  // A producer-only boss over this transaction: no pool, no timers, no schema changes.
  const boss = new PgBoss({
    db: fromDrizzle(tx, sql),
    createSchema: false,
    migrate: false,
    supervise: false,
    schedule: false,
  });
  return boss.send(job.queue, data, firmScoped(firmId, options));
}

// pg-boss dedupes and groups by key across the whole queue, whatever the firm. Prefix every key
// with the firm, so one firm's singleton, throttle or group can never swallow another firm's job.
// A caller-chosen job id is refused for the same reason (ids are unique per queue).
export function firmScoped(firmId: string, options?: FirmSendOptions): FirmSendOptions | undefined {
  if (!options) return undefined;
  if ("id" in options) throw new Error("sendFirmJob doesn't accept a job id");
  const scoped: FirmSendOptions = { ...options };
  if (
    options.singletonKey !== undefined ||
    options.singletonSeconds !== undefined ||
    options.singletonNextSlot
  ) {
    scoped.singletonKey = `${firmId}:${options.singletonKey ?? ""}`;
  }
  if (options.group) scoped.group = { ...options.group, id: `${firmId}:${options.group.id}` };
  return scoped;
}

// Runs one job. A bad payload dead-letters only that job (not the whole batch), and nothing
// from an error is kept except a safe code: pg-boss stores job output, and a raw pg error's
// detail can contain a whole row, phone number included.
export async function runFirmJob<P extends FirmJobEnvelope>(
  job: FirmJob<P>,
  input: { id: string; data: unknown },
  run: WithFirm = withFirm,
  logger: Logger = log,
): Promise<JobResult> {
  return runValidated(job, input, logger, (payload) =>
    run(payload.firmId, (tx) => job.handler(payload, tx)),
  );
}

// The same for a FirmTask: validated payload, one result per job, codes only on failure. The try
// number (and the retry limit, from a queue registered with `includeMetadata`) is passed on.
export async function runFirmTask<P extends FirmJobEnvelope>(
  task: FirmTask<P>,
  input: { id: string; data: unknown; retryCount?: number; retryLimit?: number },
  run: WithFirm = withFirm,
  logger: Logger = log,
): Promise<JobResult> {
  const attempt: JobAttempt = {
    retryCount: input.retryCount ?? 0,
    retryLimit: input.retryLimit ?? null,
  };
  return runValidated(task, input, logger, (payload) => {
    const bound: WithFirm = (firmId, fn) => {
      if (firmId !== payload.firmId) throw new Error("a firm task may only use its own firm");
      return run(firmId, fn);
    };
    return task.task(payload, bound, attempt);
  });
}

// Demo mode (16.1; ADR-025): the worker runs jobs for the made-up demo firms only. Set once, before
// the first job (src/worker/index.ts); a job for any other firm then fails without running, so
// nothing is printed instead of sent for a real firm even in the minute before the worker's own
// check stops it (src/lib/demo/guard.ts). Unset (null): every firm's jobs run.
let firmAllowed: ((firmId: string) => boolean) | null = null;
export function onlyRunJobsFor(allowed: ((firmId: string) => boolean) | null): void {
  firmAllowed = allowed;
}

async function runValidated<P extends FirmJobEnvelope>(
  job: { queue: string; schema: z.ZodType<P> },
  input: { id: string; data: unknown },
  logger: Logger,
  work: (payload: P) => Promise<unknown>,
): Promise<JobResult> {
  const jobLog = logger.child({ queue: job.queue, jobId: input.id });
  const parsed = job.schema.safeParse(input.data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
    jobLog.error("job payload invalid", { issues });
    return { id: input.id, status: "deadletter", output: { error: "invalid_payload", issues } };
  }
  const payload = parsed.data;
  if (firmAllowed && !firmAllowed(payload.firmId)) {
    jobLog.error("job refused: this worker runs jobs for the demo firms only", {
      firmId: payload.firmId,
    });
    return { id: input.id, status: "failed", output: { error: "firm_not_allowed" } };
  }
  try {
    // Inside its firm's context: what it sends is stamped with this firm (src/lib/tenancy/job-firm.ts).
    const output = await runAsFirm(payload.firmId, () => work(payload));
    return { id: input.id, status: "completed", output: output ?? null };
  } catch (err) {
    const code = errorCode(err);
    jobLog.error("job failed", { firmId: payload.firmId, code, error: err });
    return { id: input.id, status: "failed", output: { error: "handler_failed", code } };
  }
}

// The Postgres SQLSTATE (drizzle wraps driver errors in `cause`), else the error's class name.
export function errorCode(err: unknown): string {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return err instanceof Error ? err.name : "unknown";
}
