import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { authThrottle, firms, magicLinks, otpCodes, requests, sessions } from "../db/schema";
import { activeFirmId, type FirmTx, type WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { addDays, localDateOf } from "../time/zoned";
import { REQUEST_FREE_TEXT_KEYS } from "./free-text";

// The retention purge (docs/compliance.md "Retention defaults"; docs/api-and-jobs.md
// `retention-purge`). A tick at 03:30 London queues one retention-purge job per firm per local
// date (a second tick the same day queues nothing new; one firm's failure never stops the
// others). The job, in one transaction inside the firm, deletes what has been kept long enough:
// - shifts-line messages (texts, WhatsApps, voicemail text) more than 90 days old, and any reply
//   to one: app_purge_old_messages(), run as the table owner because the app role may not delete
//   messages, with the 90 days fixed in the database so no caller can shorten it;
// - the words typed into a request (payload.note, and payload.swapWith: a colleague's name) more
//   than 90 days old (the request itself stays: it's evidence);
// - login rate-limit counters a day after their window started (the longest window is a day);
// - login links and one-time codes 7 days after they expired, and sessions (their codes go with
//   them) 30 days after they expired or were revoked (docs/data-model.md "Retention"): none can
//   work again.
// Then one retention.purged event with how many of each, every run (so the log shows it ran).
// Running it again deletes nothing more. Events, requests, offers and bookings (the notice
// report's evidence, 12 months in the compliance table) aren't purged yet: events are append-only
// and no policy lets anyone delete them (parked for the 2027 rules).

export const RETENTION_PURGE_QUEUE = "retention-purge";
export const RETENTION_PURGE_TICK_QUEUE = "retention-purge-tick";
// 03:30: after the nightly figures (00:30), before anyone is up.
export const RETENTION_PURGE_CRON = "30 3 * * *";
export const RETENTION_PURGE_TZ = "Europe/London";

// How long each kind is kept. MESSAGE_DAYS is written into app_purge_old_messages() (migration
// 0026) as well: tests/integration/gdpr.retention.test.ts checks both.
export const RETENTION = {
  messageDays: 90,
  requestNoteDays: 90,
  throttleDays: 1, // after the window started: the longest window is a day, so it has ended
  linkAndCodeDays: 7, // after they expired
  sessionDays: 30, // after they expired or were revoked
} as const;

const KEY_PREFIX = "retention-purge:";
const DAY_SECONDS = 24 * 60 * 60;
const DAY_MS = DAY_SECONDS * 1000;

export const retentionPurgePayload = firmJobEnvelope.extend({
  idempotencyKey: z
    .string()
    .regex(/^retention-purge:\d{4}-\d{2}-\d{2}$/)
    .refine((key) => {
      const date = key.slice(KEY_PREFIX.length);
      return addDays(date, 0) === date;
    }, "a real calendar date"),
});
export type RetentionPurgePayload = z.infer<typeof retentionPurgePayload>;
const job = { queue: RETENTION_PURGE_QUEUE, schema: retentionPurgePayload };

export interface PurgeCounts {
  messages: number;
  requestNotes: number;
  throttle: number;
  loginLinks: number;
  sessions: number;
  codes: number;
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export async function purgeExpired(tx: FirmTx, now: Date): Promise<PurgeCounts> {
  const { rows } = await tx.execute<{ n: number }>(sql`select app_purge_old_messages() as n`);
  const linkCutoff = daysBefore(now, RETENTION.linkAndCodeDays);
  const sessionCutoff = daysBefore(now, RETENTION.sessionDays);
  const count = async (rows: Promise<{ id: string }[]>) => (await rows).length;
  const typed = sql.raw(`array[${REQUEST_FREE_TEXT_KEYS.map((k) => `'${k}'`).join(", ")}]`);
  const counts: PurgeCounts = {
    messages: Number(rows[0]?.n ?? 0),
    requestNotes: await count(
      tx
        .update(requests)
        .set({ payload: sql`${requests.payload} - ${typed}::text[]` })
        .where(
          and(
            lt(requests.createdAt, daysBefore(now, RETENTION.requestNoteDays)),
            sql`${requests.payload} ?| ${typed}::text[]`,
          ),
        )
        .returning({ id: requests.id }),
    ),
    throttle: await count(
      tx
        .delete(authThrottle)
        .where(lt(authThrottle.windowStart, daysBefore(now, RETENTION.throttleDays)))
        .returning({ id: authThrottle.id }),
    ),
    loginLinks: await count(
      tx
        .delete(magicLinks)
        .where(lt(magicLinks.expiresAt, linkCutoff))
        .returning({ id: magicLinks.id }),
    ),
    // Codes first, so a code counts here whether or not its session goes too.
    codes: await count(
      tx.delete(otpCodes).where(lt(otpCodes.expiresAt, linkCutoff)).returning({ id: otpCodes.id }),
    ),
    sessions: await count(
      tx
        .delete(sessions)
        .where(
          or(
            lt(sessions.expiresAt, sessionCutoff),
            and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionCutoff)),
          ),
        )
        .returning({ id: sessions.id }),
    ),
  };
  await recordEvent(tx, {
    actorType: "system",
    action: "retention.purged",
    entityType: "firm",
    entityId: activeFirmId(),
    data: { ...counts },
  });
  return counts;
}

export function retentionPurgeTask(clock: () => Clock): FirmTask<RetentionPurgePayload> {
  return {
    ...job,
    task: (payload, run) => run(payload.firmId, (tx) => purgeExpired(tx, clock().now())),
  };
}
export const retentionPurgeFirmTask = retentionPurgeTask(() => systemClock);

export interface RetentionTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One purge per firm per local date.
export async function runRetentionPurgeTick(deps: RetentionTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const id = await deps.run(firmId, async (tx) => {
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, firmId));
        if (!firm) return null;
        const key = `${KEY_PREFIX}${localDateOf(now, firm.timezone)}`;
        return sendFirmJob(
          tx,
          job,
          { idempotencyKey: key },
          { singletonKey: key, singletonSeconds: DAY_SECONDS },
        );
      });
      if (id !== null) queued += 1;
    } catch (err) {
      logger.error("retention purge tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
