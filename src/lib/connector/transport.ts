import type { Connector } from "../db/schema";
import { demoPortal } from "./demo-portal";
import type { ConnectorTransportName } from "./transport-names";
import type { ConnectorEventType } from "./webhook";

// How the worker reads a record from a connector's source (P5.3). Only two for now: "none" (the
// default: every read fails, so nothing is applied) and "fake", the made-up portal in memory
// (demo-portal.ts) for the tests and a local run. A real system's comes with its connector, once
// its API is known (PLAN.md P5), and is refused under NODE_ENV=test like every real sender. A read
// never runs inside a transaction (job.ts), and a failure is a code only: never the address, the
// key or what came back.

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

export interface ConnectorTransport {
  fetch(request: ConnectorFetch): Promise<FetchedRecord>;
}

const offTransport: ConnectorTransport = {
  fetch: () => Promise.reject(new ConnectorFetchError("off")),
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
};

export function connectorTransport(name: ConnectorTransportName): ConnectorTransport {
  return name === "fake" ? fakeConnectorTransport : offTransport;
}
