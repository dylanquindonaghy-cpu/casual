import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { MINUTE, systemClock, type Clock } from "../auth/clock";
import { firms, rosterSources } from "../db/schema";
import { SecretsKeyMissing } from "../db/firm-secret";
import type { WithFirm } from "../db/scoped";
import { appDatabaseIsLocal } from "../db/where";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { loadNameMap } from "../roster/names";
import { SecretUnreadable } from "../secret-store/crypto";
import {
  applyRecord,
  CONNECTOR_API_KEY_SECRET,
  connectorWorkerDeps,
  type ConnectorApplyDeps,
  type RecordOutcome,
  unexpectedCode,
} from "./apply";
import { connectorPullDue, NEAR_WINDOW_MS, type PullKind } from "./cadence";
import { ConnectorFetchError } from "./transport";

// The reconcile pull (P5.4; PLAN.md P5): what a connector's webhooks missed, caught by reading the
// source in full on a schedule (cadence.ts: the next 48 hours' sessions every 15 minutes, everything
// nightly). The jobs:
// - connector-pull-tick: a cron every minute (no firm). Visits each firm; one whose connector is
//   due gets one connector-pull job (a firm-scoped singleton for that minute).
// - connector-pull: one source's pull, a firm task (it reads the source between its transactions):
//   1. its lease, taken in a short transaction of its own (sync_started_at, as the sheet sync's), so
//      two pulls of one source never overlap; the source switched off, or another pull holding it:
//      nothing;
//   2. the key from the secret store and the records from the source, no transaction open;
//   3. each record applied as a webhook's is (apply.ts applyRecord(): the planner's rules, the name
//      map; a connector's new sessions come in hidden from casuals), each in its own short
//      transactions, never holding the source's row (each change takes that row for share);
//      unchanged records change and log nothing, so only changes are logged;
//   4. the outcome saved on the source, fenced on the lease (a pull that lost it saves nothing): a
//      success sets last_near_synced_at (and last_synced_at for a full pull) and clears the error;
//      a failure keeps the times, sets last_error_code, and the next pulls back off (cadence.ts).
// Nothing of a record, the key or the address is logged: counts and codes only.

export const CONNECTOR_PULL_QUEUE = "connector-pull";
export const CONNECTOR_PULL_TICK_QUEUE = "connector-pull-tick";
export const CONNECTOR_PULL_TICK_CRON = "* * * * *";
// A pull holds its lease this long at most; pg-boss gives up on the job a minute before, so a stuck
// pull is never still running when the next takes the lease.
export const PULL_LEASE_MS = 10 * MINUTE;
export const CONNECTOR_PULL_EXPIRE_SECONDS = 9 * 60;
const PULL_SINGLETON_SECONDS = 2_147_483_647; // the key alone decides (as the sheet sync's)

export const connectorPullPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^connector-pull:[0-9]+$/),
  sourceId: z.uuid(),
  kind: z.enum(["near", "full"]),
});
export type ConnectorPullPayload = z.infer<typeof connectorPullPayload>;
export const connectorPullJob = { queue: CONNECTOR_PULL_QUEUE, schema: connectorPullPayload };

export type PullResult =
  | { status: "pulled"; kind: PullKind; counts: Record<string, number> }
  | { status: "failed"; code: string }
  | { status: "busy" } // another pull holds the lease
  | { status: "off" }; // no connector of that id on

export async function runConnectorPull(
  payload: ConnectorPullPayload,
  run: WithFirm,
  deps: ConnectorApplyDeps,
): Promise<PullResult> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const localDatabase = deps.localDatabase ?? appDatabaseIsLocal();
  const { firmId, sourceId, kind } = payload;
  const staleBefore = new Date(now.getTime() - PULL_LEASE_MS);

  const claim = await run(firmId, async (tx) => {
    const [claimed] = await tx
      .update(rosterSources)
      .set({ syncStartedAt: now, lastAttemptedAt: now })
      .where(
        and(
          eq(rosterSources.id, sourceId),
          eq(rosterSources.kind, "connector"),
          eq(rosterSources.enabled, true),
          or(isNull(rosterSources.syncStartedAt), lt(rosterSources.syncStartedAt, staleBefore)),
        ),
      )
      .returning({ connector: rosterSources.connector, baseUrl: rosterSources.baseUrl });
    if (claimed) return claimed;
    const [on] = await tx
      .select({ id: rosterSources.id })
      .from(rosterSources)
      .where(
        and(
          eq(rosterSources.id, sourceId),
          eq(rosterSources.kind, "connector"),
          eq(rosterSources.enabled, true),
        ),
      );
    return on ? ("busy" as const) : ("off" as const);
  });
  if (claim === "busy" || claim === "off") return { status: claim };
  if (!claim.connector || !claim.baseUrl) return { status: "off" };
  const { connector, baseUrl } = claim;

  // The outcome on the source, only while this pull still holds its lease.
  const release = (outcome: { ok: true } | { ok: false; code: string }) =>
    run(firmId, (tx) =>
      tx
        .update(rosterSources)
        .set(
          outcome.ok
            ? {
                syncStartedAt: null,
                lastErrorCode: null,
                lastNearSyncedAt: now,
                ...(kind === "full" ? { lastSyncedAt: now } : {}),
              }
            : { syncStartedAt: null, lastErrorCode: outcome.code },
        )
        .where(and(eq(rosterSources.id, sourceId), eq(rosterSources.syncStartedAt, now))),
    );

  // Gate B before anything is read from the firm's system.
  try {
    await run(firmId, (tx) => requireAgreementForImport(tx, { saving: true, localDatabase }));
  } catch (err) {
    if (!(err instanceof AgreementNotRecorded)) throw err;
    await release({ ok: false, code: "agreement_not_recorded" });
    return { status: "failed", code: "agreement_not_recorded" };
  }

  let sessions: unknown[];
  let staff: unknown[] = [];
  try {
    const apiKey = await deps.readSecret(firmId, CONNECTOR_API_KEY_SECRET);
    if (apiKey === null) {
      await release({ ok: false, code: "no_api_key" });
      return { status: "failed", code: "no_api_key" };
    }
    const base = { connector, baseUrl, apiKey };
    sessions = await deps.transport.list({
      ...base,
      type: "session.changed",
      from: now,
      ...(kind === "near" ? { to: new Date(now.getTime() + NEAR_WINDOW_MS) } : {}),
    });
    if (kind === "full") staff = await deps.transport.list({ ...base, type: "staff.changed" });
  } catch (err) {
    const code =
      err instanceof SecretsKeyMissing
        ? "secrets_off"
        : err instanceof SecretUnreadable
          ? "secret_unreadable"
          : err instanceof ConnectorFetchError
            ? err.code
            : "read_failed";
    logger.warn("connector pull: the source didn't answer", { firmId, sourceId, code });
    await release({ ok: false, code });
    return { status: "failed", code };
  }

  const names = await run(firmId, (tx) => loadNameMap(tx));
  const by = { type: "connector" as const, sourceId };
  const counts: Record<string, number> = {};
  const count = (o: RecordOutcome) => {
    const key = `${o.status}:${o.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  // Staff first, so a session's bookings (P5.5) find their casuals.
  for (const [type, records] of [
    ["staff.changed", staff],
    ["session.changed", sessions],
  ] as const) {
    for (const record of records) {
      const ref = (record as { ref?: unknown } | null)?.ref;
      if (typeof ref !== "string") {
        count({ status: "refused", code: "bad_record" });
        continue;
      }
      let applied;
      try {
        applied = await applyRecord({
          run,
          firmId,
          by,
          type,
          ref,
          record,
          names,
          now,
          geocoder: deps.geocoder,
          localDatabase,
        });
      } catch (err) {
        // One record's unexpected failure doesn't stop the rest: counted, and the next pull tries
        // it again.
        count({ status: "failed", code: unexpectedCode(err) });
        continue;
      }
      count(applied.outcome);
      // Switched off, or a planner key made live, part-way: stop reading into it.
      if (applied.outcome.code === "not_allowed") {
        await release({ ok: false, code: "not_allowed" });
        return { status: "failed", code: "not_allowed" };
      }
    }
  }
  await release({ ok: true });
  logger.info("connector pull", { firmId, sourceId, kind, counts });
  return { status: "pulled", kind, counts };
}

export function createConnectorPullTask(
  deps: () => ConnectorApplyDeps,
): FirmTask<ConnectorPullPayload> {
  return {
    ...connectorPullJob,
    task: (payload, run) => runConnectorPull(payload, run, deps()),
  };
}

export const connectorPullTask = createConnectorPullTask(connectorWorkerDeps);

export interface PullTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One firm's failure never stops the others' pulls.
export async function runConnectorPullTick(deps: PullTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const minute = Math.floor(now.getTime() / 60_000);
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const sent = await deps.run(firmId, async (tx) => {
        const [source] = await tx
          .select({
            id: rosterSources.id,
            lastSyncedAt: rosterSources.lastSyncedAt,
            lastNearSyncedAt: rosterSources.lastNearSyncedAt,
            lastAttemptedAt: rosterSources.lastAttemptedAt,
            lastErrorCode: rosterSources.lastErrorCode,
            timeZone: firms.timezone,
          })
          .from(rosterSources)
          .innerJoin(firms, eq(firms.id, rosterSources.firmId))
          .where(and(eq(rosterSources.kind, "connector"), eq(rosterSources.enabled, true)));
        if (!source) return false;
        const kind = connectorPullDue({
          lastFullAt: source.lastSyncedAt,
          lastNearAt: source.lastNearSyncedAt,
          lastAttemptedAt: source.lastAttemptedAt,
          failing: source.lastErrorCode !== null,
          now,
          timeZone: source.timeZone,
        });
        if (!kind) return false;
        const key = `connector-pull:${minute}`;
        const id = await sendFirmJob(
          tx,
          connectorPullJob,
          { idempotencyKey: key, sourceId: source.id, kind },
          { singletonKey: key, singletonSeconds: PULL_SINGLETON_SECONDS },
        );
        return id !== null;
      });
      if (sent) queued += 1;
    } catch (err) {
      logger.error("connector pull tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
