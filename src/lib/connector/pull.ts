import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { MINUTE, systemClock, type Clock } from "../auth/clock";
import { connectorEvents, firms, rosterSources, type Connector } from "../db/schema";
import { SecretsKeyMissing } from "../db/firm-secret";
import type { FirmTx, WithFirm } from "../db/scoped";
import { appDatabaseIsLocal } from "../db/where";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { firmCallerMay } from "../roster/firm-caller";
import { loadNameMap } from "../roster/names";
import { SecretUnreadable } from "../secret-store/crypto";
import {
  applyRecord,
  CONNECTOR_API_KEY_SECRET,
  connectorWorkerDeps,
  type ConnectorApplyDeps,
  latest,
  type RecordOutcome,
  unexpectedCode,
} from "./apply";
import { connectorPullDue, NEAR_WINDOW_MS, type PullKind } from "./cadence";
import { ConnectorFetchError } from "./transport";

// The reconcile pull (P5.4; PLAN.md P5): what a connector's webhooks missed, caught by reading the
// source in full on a schedule (cadence.ts: the next 48 hours' sessions every 15 minutes, everything
// nightly). The jobs:
// - connector-pull-tick: a cron every minute (no firm). Visits each firm; one whose connector is
//   due, and not being pulled now (its lease held), gets one connector-pull job (a firm-scoped
//   singleton for that minute).
// - connector-pull: one source's pull, a firm task (it reads the source between its transactions):
//   1. its lease, taken in a short transaction of its own (sync_started_at, as the sheet sync's), so
//      two pulls of one source don't run at once (one that outlives its lease is stopped first: the
//      budget below); the source switched off, or another pull holding it: nothing;
//   2. Gate B, and the firm's planner still this connector (no planner key live), before any read;
//   3. the key from the secret store and the records from the source, no transaction open;
//   4. each record applied as a webhook's is (apply.ts applyRecord(): the planner's rules, the name
//      map; a connector's new sessions come in hidden from casuals), each at its own time and in
//      its own short transactions, never holding the source's row (each change takes that row for
//      share); unchanged records change and log nothing, so only changes are logged. A record a
//      webhook's event is newer than, or about to apply, is skipped (eventNewer). Past
//      PULL_BUDGET_MS the rest wait for the next pull;
//   5. the outcome saved on the source, fenced on the lease (a pull that lost it saves nothing): a
//      success sets last_near_synced_at (and last_synced_at for a full pull) and clears the error;
//      a failure (every record failing too) keeps the times, sets last_error_code, and the next
//      pulls back off (cadence.ts). Anything unexpected lets the lease go with its code saved, then
//      fails the job (never retried: the next tick queues the next pull).
// Nothing of a record, the key or the address is logged: counts and codes only.

export const CONNECTOR_PULL_QUEUE = "connector-pull";
export const CONNECTOR_PULL_TICK_QUEUE = "connector-pull-tick";
export const CONNECTOR_PULL_TICK_CRON = "* * * * *";
// A pull holds its lease this long at most; pg-boss gives up on the job a minute before, so a stuck
// pull is never still running when the next takes the lease.
export const PULL_LEASE_MS = 10 * MINUTE;
export const CONNECTOR_PULL_EXPIRE_SECONDS = 9 * 60;
// A pull stops applying records this long after taking its lease (the rest wait for the next), so
// one still working is inside its job's expiry and its lease, never beside the next pull. Each read
// of the source is bounded by the transport's own timeout (transport.ts).
export const PULL_BUDGET_MS = 8 * MINUTE;
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

// How a pull ended, saved on the source: read and applied; or not, with why. A full pull whose
// staff list failed still applies the sessions it read (sessionsRead): its near time moves on, the
// error is saved and the next pull reads the staff again.
type Outcome = { ok: true } | { ok: false; code: string; sessionsRead?: boolean };

type RecordType = "staff.changed" | "session.changed";

// A listed record a webhook's event about it is newer than, or about to apply: skipped, so the
// pull never puts back what the event's own read of the source brought in. The event still
// queued: its job reads the record later. Made or applied since this pull read the source: the
// source changed after this read, or the event read it after.
async function eventNewer(
  tx: FirmTx,
  sourceId: string,
  type: RecordType,
  ref: string,
  readAt: Date,
): Promise<boolean> {
  const [hit] = await tx
    .select({ id: connectorEvents.id })
    .from(connectorEvents)
    .where(
      and(
        eq(connectorEvents.sourceId, sourceId),
        eq(connectorEvents.type, type),
        eq(connectorEvents.ref, ref),
        or(
          eq(connectorEvents.status, "queued"),
          gte(connectorEvents.createdAt, readAt),
          gte(connectorEvents.processedAt, readAt),
        ),
      ),
    )
    .limit(1);
  return hit !== undefined;
}

function readFailureCode(err: unknown): string {
  return err instanceof SecretsKeyMissing
    ? "secrets_off"
    : err instanceof SecretUnreadable
      ? "secret_unreadable"
      : err instanceof ConnectorFetchError
        ? err.code
        : "read_failed";
}

// The key from the secret store, then the records from the source, no transaction open. A full
// pull's staff list failing leaves the sessions read (staffFailure).
async function readSource(
  deps: ConnectorApplyDeps,
  a: {
    firmId: string;
    sourceId: string;
    kind: PullKind;
    connector: Connector;
    baseUrl: string;
    now: Date;
    logger: Logger;
  },
): Promise<
  { sessions: unknown[]; staff: unknown[]; staffFailure: string | null } | { code: string }
> {
  const { firmId, sourceId } = a;
  try {
    const apiKey = await deps.readSecret(firmId, CONNECTOR_API_KEY_SECRET);
    if (apiKey === null) return { code: "no_api_key" };
    const base = { connector: a.connector, baseUrl: a.baseUrl, apiKey };
    const sessions = await deps.transport.list({
      ...base,
      type: "session.changed",
      from: a.now,
      ...(a.kind === "near" ? { to: new Date(a.now.getTime() + NEAR_WINDOW_MS) } : {}),
    });
    if (a.kind === "near") return { sessions, staff: [], staffFailure: null };
    try {
      const staff = await deps.transport.list({ ...base, type: "staff.changed" });
      return { sessions, staff, staffFailure: null };
    } catch (err) {
      const code = readFailureCode(err);
      a.logger.warn("connector pull: the source didn't list its staff", { firmId, sourceId, code });
      return { sessions, staff: [], staffFailure: code };
    }
  } catch (err) {
    const code = readFailureCode(err);
    a.logger.warn("connector pull: the source didn't answer", { firmId, sourceId, code });
    return { code };
  }
}

export async function runConnectorPull(
  payload: ConnectorPullPayload,
  run: WithFirm,
  deps: ConnectorApplyDeps,
): Promise<PullResult> {
  const clock = deps.clock ?? systemClock;
  // The lease's time: the source's times are saved as this (the source was read after it).
  const now = clock.now();
  const logger = deps.logger ?? log;
  const localDatabase = deps.localDatabase ?? appDatabaseIsLocal();
  const { firmId, sourceId, kind } = payload;
  const staleBefore = new Date(now.getTime() - PULL_LEASE_MS);

  const claim = await run(firmId, async (tx) => {
    // When it was last read, before this pull: the bookings' evidence (bookings.ts).
    const [before] = await tx
      .select({ full: rosterSources.lastSyncedAt, near: rosterSources.lastNearSyncedAt })
      .from(rosterSources)
      .where(eq(rosterSources.id, sourceId));
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
    if (claimed)
      return { ...claimed, lastReadAt: latest(before?.full ?? null, before?.near ?? null) };
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

  // The outcome on the source, only while this pull still holds its lease.
  const release = (outcome: Outcome) =>
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
            : {
                syncStartedAt: null,
                lastErrorCode: outcome.code,
                ...(outcome.sessionsRead ? { lastNearSyncedAt: now } : {}),
              },
        )
        .where(and(eq(rosterSources.id, sourceId), eq(rosterSources.syncStartedAt, now))),
    );
  const failed = async (code: string): Promise<PullResult> => {
    await release({ ok: false, code });
    return { status: "failed", code };
  };

  try {
    // A connector's row always has both (roster_sources_kind_fields): the lease let go regardless.
    if (!claim.connector || !claim.baseUrl) {
      await release({ ok: false, code: "off" });
      return { status: "off" };
    }
    const { connector, baseUrl, lastReadAt } = claim;
    const by = { type: "connector" as const, sourceId };

    // Gate B, and the firm's planner still this connector (no planner key made live), before
    // anything is read from the firm's system.
    try {
      await run(firmId, (tx) => requireAgreementForImport(tx, { saving: true, localDatabase }));
    } catch (err) {
      if (!(err instanceof AgreementNotRecorded)) throw err;
      return await failed("agreement_not_recorded");
    }
    if (!(await run(firmId, (tx) => firmCallerMay(tx, by)))) return await failed("not_allowed");

    const read = await readSource(deps, {
      firmId,
      sourceId,
      kind,
      connector,
      baseUrl,
      now,
      logger,
    });
    if ("code" in read) return await failed(read.code);
    const { sessions, staff, staffFailure } = read;

    const names = await run(firmId, (tx) => loadNameMap(tx));
    const counts: Record<string, number> = {};
    let total = 0;
    let failures = 0;
    const count = (o: RecordOutcome) => {
      const key = `${o.status}:${o.code}`;
      counts[key] = (counts[key] ?? 0) + 1;
      total += 1;
      if (o.status === "failed") failures += 1;
    };
    // Staff first, so a session's bookings (P5.5) find their casuals.
    for (const [type, records] of [
      ["staff.changed", staff],
      ["session.changed", sessions],
    ] as const) {
      for (const record of records) {
        // Each record at its own time; past the budget, the rest wait for the next pull.
        const at = clock.now();
        if (at.getTime() - now.getTime() >= PULL_BUDGET_MS) {
          logger.warn("connector pull: out of time", { firmId, sourceId, kind, counts });
          return await failed("out_of_time");
        }
        const ref = (record as { ref?: unknown } | null)?.ref;
        if (typeof ref !== "string") {
          count({ status: "refused", code: "bad_record" });
          continue;
        }
        let applied;
        try {
          if (await run(firmId, (tx) => eventNewer(tx, sourceId, type, ref, now))) {
            count({ status: "ignored", code: "event_newer" });
            continue;
          }
          applied = await applyRecord({
            run,
            firmId,
            by,
            type,
            ref,
            record,
            names,
            now: at,
            geocoder: deps.geocoder,
            localDatabase,
            lastReadAt,
          });
        } catch (err) {
          // One record's unexpected failure doesn't stop the rest: counted, and the next pull tries
          // it again.
          count({ status: "failed", code: unexpectedCode(err) });
          continue;
        }
        count(applied.outcome);
        // Switched off, or a planner key made live, part-way: stop reading into it.
        if (applied.outcome.code === "not_allowed") return await failed("not_allowed");
      }
    }
    logger.info("connector pull", { firmId, sourceId, kind, counts });
    // Every record failing is the pull failing (the database, or a fault of ours): saved and
    // alerted on as a source that doesn't answer is, its times kept.
    if (total > 0 && failures === total) return await failed("records_failed");
    if (staffFailure) {
      await release({ ok: false, code: staffFailure, sessionsRead: true });
      return { status: "failed", code: staffFailure };
    }
    await release({ ok: true });
    return { status: "pulled", kind, counts };
  } catch (err) {
    // Anything unexpected after the lease was taken: the lease let go and the error saved (the next
    // pull backs off), then the job fails as any job's fault does.
    const code = unexpectedCode(err);
    logger.error("connector pull failed", { firmId, sourceId, code });
    await release({ ok: false, code }).catch(() => undefined);
    throw err;
  }
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
            syncStartedAt: rosterSources.syncStartedAt,
            timeZone: firms.timezone,
          })
          .from(rosterSources)
          .innerJoin(firms, eq(firms.id, rosterSources.firmId))
          .where(and(eq(rosterSources.kind, "connector"), eq(rosterSources.enabled, true)));
        if (!source) return false;
        // A pull still holding its lease: none queued beside it (it would only find it busy).
        if (
          source.syncStartedAt &&
          now.getTime() - source.syncStartedAt.getTime() < PULL_LEASE_MS
        ) {
          return false;
        }
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
