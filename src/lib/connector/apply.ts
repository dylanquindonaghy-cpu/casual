import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { appDatabaseIsLocal } from "../db/where";
import { firmSecretReader, SecretsKeyMissing, type ReadFirmSecret } from "../db/firm-secret";
import { connectorEvents, rosterSources, type ConnectorEventStatus } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import { putPlannerSession } from "../integrations/sessions";
import type { FirmTask, JobAttempt } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { firmCallerMay } from "../roster/firm-caller";
import { loadNameMap } from "../roster/names";
import {
  upsertWorker,
  WorkerEmailInvalid,
  WorkerIdentityChange,
  WorkerNameMismatch,
} from "../roster/workers";
import { SecretUnreadable, secretsKey } from "../secret-store/crypto";
import type { Geocoder } from "../travel/geocoder";
import { sessionBody, staffWorker } from "./demo-portal";
import {
  CONNECTOR_EVENT_QUEUE,
  CONNECTOR_RETRY_LIMIT,
  connectorEventPayload,
  type ConnectorEventPayload,
} from "./job";
import { ConnectorFetchError, connectorTransport, type ConnectorTransport } from "./transport";

// The `connector-event` job (P5.3): what a connector's source said changed, read from the source
// itself and applied. In order:
// 1. A short transaction reads the event and its source. Done already (a retry after a crash
//    that came after the outcome was saved): nothing. The source switched off: ignored.
// 2. The source's API key from the secret store (connector.api_key), then the record from the
//    source's API, with no transaction open. Never from the webhook's body, which named only what
//    changed. A failed read throws and pg-boss tries again (CONNECTOR_RETRY_LIMIT, about an hour);
//    the last try saves it as failed and completes, and the reconcile pull catches up (P5.4).
// 3. Applied as the planner's own change: a session through putPlannerSession() with the
//    connector as its caller (every rule, Gate B, the logging and the refusals the planner's PUT
//    has), a staff record through upsertWorker() in a transaction that first checks Gate B and
//    that the source is still on. Names go through the firm's name map (demo-portal.ts).
// 4. The outcome saved on the event: applied (the API's result: created, updated, unchanged,
//    cancelled; a worker's added, updated, linked, unchanged), refused (the API's refusal or the
//    record's problem), ignored (gone from the source, a name the map skips, the source off when
//    read, or not_allowed: switched off since, or the firm's planner API key is live) or
//    failed (the last try's read, or no key to read it with). At least once: a crash before the
//    outcome is saved applies the record again, which changes nothing the second time.
// The key is kept no longer than the read; no record, key or address is logged.

export const CONNECTOR_API_KEY_SECRET = "connector.api_key";

export interface ConnectorApplyDeps {
  transport: ConnectorTransport;
  readSecret: ReadFirmSecret;
  clock?: Clock;
  geocoder?: Geocoder;
  localDatabase?: boolean; // Gate B (appDatabaseIsLocal() when left out)
  logger?: Logger;
}

export type ConnectorApplyResult =
  | { status: ConnectorEventStatus; code: string }
  | { status: "done" } // already handled
  | { status: "gone" }; // no such event in this firm

const isLastTry = (attempt: JobAttempt) =>
  attempt.retryCount >= (attempt.retryLimit ?? CONNECTOR_RETRY_LIMIT);

// The result codes the planner API answers with, and the error code of a refusal.
function apiOutcome(result: { status: number; body: unknown }): {
  status: ConnectorEventStatus;
  code: string;
} {
  const body = (result.body ?? {}) as { result?: unknown; error?: { code?: unknown } };
  if (result.status < 300) {
    return { status: "applied", code: typeof body.result === "string" ? body.result : "applied" };
  }
  const code = typeof body.error?.code === "string" ? body.error.code : `http_${result.status}`;
  // The planner API's word for a caller that may not change sessions now: the source switched off
  // since it was read, or the firm's planner API key is live (one planner: firm-caller.ts).
  if (code === "invalid_key") return { status: "ignored", code: "not_allowed" };
  return { status: "refused", code };
}

async function finish(
  tx: FirmTx,
  eventId: string,
  outcome: { status: ConnectorEventStatus; code: string },
  now: Date,
): Promise<void> {
  await tx
    .update(connectorEvents)
    .set({ status: outcome.status, outcomeCode: outcome.code, processedAt: now })
    .where(and(eq(connectorEvents.id, eventId), eq(connectorEvents.status, "queued")));
}

export async function applyConnectorEvent(
  payload: ConnectorEventPayload,
  run: WithFirm,
  deps: ConnectorApplyDeps,
  attempt: JobAttempt,
): Promise<ConnectorApplyResult> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const localDatabase = deps.localDatabase ?? appDatabaseIsLocal();
  const { firmId, eventId } = payload;
  const done = (outcome: { status: ConnectorEventStatus; code: string }) =>
    run(firmId, (tx) => finish(tx, eventId, outcome, now)).then(() => outcome);

  const found = await run(firmId, async (tx) => {
    const [row] = await tx
      .select({
        status: connectorEvents.status,
        sourceId: connectorEvents.sourceId,
        type: connectorEvents.type,
        ref: connectorEvents.ref,
        kind: rosterSources.kind,
        enabled: rosterSources.enabled,
        connector: rosterSources.connector,
        baseUrl: rosterSources.baseUrl,
      })
      .from(connectorEvents)
      .innerJoin(
        rosterSources,
        and(
          eq(rosterSources.firmId, connectorEvents.firmId),
          eq(rosterSources.id, connectorEvents.sourceId),
        ),
      )
      .where(eq(connectorEvents.id, eventId));
    return row;
  });
  if (!found) return { status: "gone" };
  if (found.status !== "queued") return { status: "done" };
  if (found.kind !== "connector" || !found.enabled || !found.connector || !found.baseUrl) {
    return done({ status: "ignored", code: "source_off" });
  }
  const by = { type: "connector" as const, sourceId: found.sourceId };

  // The key, then the record: no transaction open.
  let fetched;
  try {
    const apiKey = await deps.readSecret(firmId, CONNECTOR_API_KEY_SECRET);
    if (apiKey === null) return done({ status: "failed", code: "no_api_key" });
    fetched = await deps.transport.fetch({
      connector: found.connector,
      baseUrl: found.baseUrl,
      apiKey,
      type: found.type,
      ref: found.ref,
    });
  } catch (err) {
    if (err instanceof SecretsKeyMissing) return done({ status: "failed", code: "secrets_off" });
    if (err instanceof SecretUnreadable) {
      return done({ status: "failed", code: "secret_unreadable" });
    }
    const code = err instanceof ConnectorFetchError ? err.code : "read_failed";
    logger.warn("connector: the source didn't answer", {
      firmId,
      sourceId: found.sourceId,
      code,
      retryCount: attempt.retryCount,
    });
    if (!isLastTry(attempt))
      throw err instanceof ConnectorFetchError ? err : new ConnectorFetchError("unreachable");
    return done({ status: "failed", code });
  }
  if (fetched.status === "gone") return done({ status: "ignored", code: "gone" });
  const record = fetched.record;
  if ((record as { ref?: unknown } | null)?.ref !== found.ref) {
    return done({ status: "refused", code: "ref_mismatch" });
  }
  const names = await run(firmId, (tx) => loadNameMap(tx));

  if (found.type === "session.changed") {
    const mapped = sessionBody(record, names);
    if (mapped.status === "skipped") return done({ status: "ignored", code: "skipped_name" });
    if (mapped.status === "unreadable") return done({ status: "refused", code: mapped.code });
    const result = await putPlannerSession(
      { run, firmId, by, json: mapped.value, now, geocoder: deps.geocoder, localDatabase },
      found.ref,
    );
    // A postcode look-up that's down: tried again, as a failed read is.
    if (result.status >= 500 && !isLastTry(attempt)) {
      throw new ConnectorFetchError("unreachable");
    }
    return done(apiOutcome(result));
  }

  const mapped = staffWorker(record, names);
  if (mapped.status === "skipped") return done({ status: "ignored", code: "skipped_name" });
  if (mapped.status === "unreadable") return done({ status: "refused", code: mapped.code });
  const person = mapped.value;
  try {
    return await run(firmId, async (tx) => {
      await requireAgreementForImport(tx, { saving: true, localDatabase });
      // The source first, then the worker (the planner's lock order).
      if (!(await firmCallerMay(tx, by))) {
        const outcome = { status: "ignored" as const, code: "not_allowed" };
        await finish(tx, eventId, outcome, now);
        return outcome;
      }
      const { outcome: upserted } = await upsertWorker(tx, person, {
        source: "api",
        actor: { type: "system" },
        now,
      });
      const outcome = { status: "applied" as const, code: upserted };
      await finish(tx, eventId, outcome, now);
      return outcome;
    });
  } catch (err) {
    if (err instanceof AgreementNotRecorded) {
      return done({ status: "refused", code: "agreement_not_recorded" });
    }
    if (err instanceof WorkerNameMismatch)
      return done({ status: "refused", code: "name_mismatch" });
    if (err instanceof WorkerIdentityChange) {
      return done({ status: "refused", code: "identity_change" });
    }
    if (err instanceof WorkerEmailInvalid) return done({ status: "refused", code: "bad_email" });
    throw err;
  }
}

export function createConnectorEventTask(
  deps: () => ConnectorApplyDeps,
): FirmTask<ConnectorEventPayload> {
  return {
    queue: CONNECTOR_EVENT_QUEUE,
    schema: connectorEventPayload,
    task: (payload, run, attempt) => applyConnectorEvent(payload, run, deps(), attempt),
  };
}

// The worker's: its CONNECTOR_TRANSPORT, and the secret store through its own jobs-role
// connection with SECRETS_KEY (made once, on first use).
let readSecret: ReadFirmSecret | undefined;
const workerDeps = (): ConnectorApplyDeps => {
  const env = workerEnv();
  readSecret ??= firmSecretReader(
    env.DATABASE_JOBS_URL,
    env.SECRETS_KEY ? secretsKey(env.SECRETS_KEY) : null,
  );
  return { transport: connectorTransport(env.CONNECTOR_TRANSPORT), readSecret };
};
export const connectorEventTask = createConnectorEventTask(workerDeps);
