// The connector's read transports by name (src/lib/connector/transport.ts), apart so the settings
// (src/lib/env.ts) can name them without importing any of the connector's code.
export const CONNECTOR_TRANSPORTS = ["none", "fake"] as const;
export type ConnectorTransportName = (typeof CONNECTOR_TRANSPORTS)[number];
