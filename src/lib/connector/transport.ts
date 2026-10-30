import type { Connector } from "../db/schema";
import { demoPortal } from "./demo-portal";
import type { ConnectorTransportName } from "./transport-names";
import type { ConnectorEventType } from "./webhook";

// How the worker reads a record from a connector's source (P5.3). Only two for now: "none" (the
// default: every read fails, so nothing is applied) and "fake", the made-up portal in memory
// (demo-portal.ts) for the tests and a local run. A real system's comes with its connector, once
// its API is known (PLAN.md P5), and is refused under NODE_ENV=test like every real sender; it
// sets a timeout on every request (a read left hanging would outlive the pull's lease: pull.ts,
// PULL_BUDGET_MS) and answers a timeout as "unreachable". A read never runs inside a transaction
// (job.ts), and a failure is a code only: never the address, the key or what came back.

export { CONNECTOR_TRANSPORTS, type ConnectorTransportName } from "./transport-names";

export type ConnectorFetchCode = "off" | "unreachable" | "unauthorised";

export class ConnectorFetchError extends Error {
  constructor(readonly code: ConnectorFetchCode) {
    super(`the connector's source didn't answer: ${code}`);
    this.name = "ConnectorFetchError";
  }
}

export interface ConnectorFetch {
  connector: Connector;
  baseUrl: string;
  apiKey: string;
  type: ConnectorEventType;
  ref: string;
}

// The record as the source holds it now, or gone (it has no such record any more).
export type FetchedRecord = { status: "found"; record: unknown } | { status: "gone" };

// The reconcile pull's read (P5.4): the sessions starting in [from, to) (no `to`: every one from
// `from` on), or every staff record. At most MAX_LISTED, oldest start first.
export interface ConnectorList {
  connector: Connector;
  baseUrl: string;
  apiKey: string;
  type: ConnectorEventType;
  from?: Date;
  to?: Date;
}
export const MAX_LISTED = 10_000;

export interface ConnectorTransport {
  fetch(request: ConnectorFetch): Promise<FetchedRecord>;
  list(request: ConnectorList): Promise<unknown[]>;
}

const offTransport: ConnectorTransport = {
  fetch: () => Promise.reject(new ConnectorFetchError("off")),
  list: () => Promise.reject(new ConnectorFetchError("off")),
};

const startOf = (record: unknown): number => {
  const at = (record as { starts_at?: unknown } | null)?.starts_at;
  const ms = typeof at === "string" ? Date.parse(at) : Number.NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

export const fakeConnectorTransport: ConnectorTransport = {
  fetch(request) {
    const system = demoPortal.get(request.baseUrl);
    if (!system || system.down) return Promise.reject(new ConnectorFetchError("unreachable"));
    if (system.apiKey !== request.apiKey) {
      return Promise.reject(new ConnectorFetchError("unauthorised"));
    }
    system.reads += 1;
    const records = request.type === "session.changed" ? system.sessions : system.staff;
    const record = records.get(request.ref);
    // A copy, so a test changing its system afterwards can't reach into what was read.
    return Promise.resolve(
      record === undefined
        ? { status: "gone" }
        : { status: "found", record: structuredClone(record) },
    );
  },
  list(request) {
    const system = demoPortal.get(request.baseUrl);
    if (!system || system.down) return Promise.reject(new ConnectorFetchError("unreachable"));
    if (system.apiKey !== request.apiKey) {
      return Promise.reject(new ConnectorFetchError("unauthorised"));
    }
    system.lists += 1;
    if (request.type === "staff.changed") {
      return Promise.resolve(
        [...system.staff.values()].slice(0, MAX_LISTED).map((r) => structuredClone(r)),
      );
    }
    const from = request.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = request.to?.getTime() ?? Number.POSITIVE_INFINITY;
    return Promise.resolve(
      [...system.sessions.values()]
        .filter((r) => startOf(r) >= from && startOf(r) < to)
        .sort((a, b) => startOf(a) - startOf(b))
        .slice(0, MAX_LISTED)
        .map((r) => structuredClone(r)),
    );
  },
};

export function connectorTransport(name: ConnectorTransportName): ConnectorTransport {
  return name === "fake" ? fakeConnectorTransport : offTransport;
}
