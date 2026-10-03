import { PgBoss } from "pg-boss";
import { log as rootLog, type Logger } from "../lib/log";
import { redact } from "../lib/log/mask";

// The worker's pg-boss, connected as the jobs role (DATABASE_JOBS_URL). The schema is installed
// and upgraded only by `npm run db:migrate` (migrate: false here), so a worker started against a
// database that hasn't been migrated fails fast instead of changing it.
//
// The supervisor (one pass across all the workers, whichever claims it) is what retries a job whose
// heartbeat stopped: a worker killed mid-batch. pg-boss looks once a minute by default, so a killed
// worker's jobs could wait the 30-second heartbeat plus up to two minutes. Every 15 seconds instead,
// they're back within about a minute (tests/integration/jobs.crash.test.ts). Each pass is a few
// small indexed queries on a job table that keeps one day of finished jobs.
export const SUPERVISE_SECONDS = 15;

export function createBoss(connectionString: string, logger: Logger = rootLog): PgBoss {
  const boss = new PgBoss({
    connectionString,
    createSchema: false,
    migrate: false,
    max: 5,
    superviseIntervalSeconds: SUPERVISE_SECONDS,
    monitorIntervalSeconds: SUPERVISE_SECONDS,
  });
  boss.on("error", createPgBossErrorLogger(logger));
  // A warning's data can include SQL and parameter values: log the message only.
  boss.on("warning", (warning) => logger.warn("pg-boss warning", { message: warning.message }));
  return boss;
}

// pg-boss emits plain objects whose `detail` can hold a whole job row (payload, phone numbers).
// Only these fields are ever logged, plus the masked message.
const SAFE_FIELDS = [
  "code",
  "severity",
  "routine",
  "constraint",
  "schema",
  "table",
  "queue",
  "worker",
];

export function pgBossErrorFields(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { message: redact(String(err)) };
  const source = err as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of SAFE_FIELDS) {
    if (typeof source[key] === "string") picked[key] = source[key];
  }
  if (typeof source.message === "string") picked.message = source.message;
  return redact(picked) as Record<string, unknown>;
}

// The same error re-fires on every poll while it lasts: log it once a minute, with a count.
export function createPgBossErrorLogger(
  logger: Logger,
  options: { windowMs?: number; now?: () => number } = {},
): (err: unknown) => void {
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const lastLogged = new Map<string, number>();
  const suppressed = new Map<string, number>();
  return (err) => {
    const fields = pgBossErrorFields(err);
    const key = `${String(fields.code)}|${String(fields.message)}`;
    const t = now();
    // Forget errors that stopped recurring, so the maps can't grow without bound.
    if (lastLogged.size > 100) {
      for (const [k, at] of lastLogged) {
        if (t - at >= windowMs) {
          lastLogged.delete(k);
          suppressed.delete(k);
        }
      }
    }
    const last = lastLogged.get(key);
    if (last !== undefined && t - last < windowMs) {
      suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
      return;
    }
    lastLogged.set(key, t);
    const repeats = suppressed.get(key) ?? 0;
    suppressed.delete(key);
    logger.error("pg-boss error", repeats > 0 ? { ...fields, suppressedRepeats: repeats } : fields);
  };
}
