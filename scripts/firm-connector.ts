import { parseArgs } from "node:util";
import { connectorWebhookSecret } from "../src/lib/connector/webhook-secret";
import { databaseName } from "../src/lib/db/admin/urls";
import { CONNECTORS, type Connector } from "../src/lib/db/schema";
import { parseConnectorOwnerEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { platformUrl } from "../src/lib/tenancy/portal-url";
import {
  connectConnector,
  showConnector,
  switchOffConnector,
  type ConnectorSource,
} from "./firm-connector-owner";

// Connects, replaces, switches off or shows a firm's connector to its own system (P5.3; PLAN.md P5;
// docs/runbooks.md "A firm's connector"). Owner only: the owner connection (DATABASE_ADMIN_URL).
// The system's API key goes in the secret store first (npm run firm:secret, connector.api_key);
// the webhook address and secret shown here go in the system's own webhook settings.
//
//   npm run -s firm:connector -- --firm acme                     (where it stands)
//   npm run -s firm:connector -- --firm acme --connector demo_portal --base-url https://…
//   npm run -s firm:connector -- --firm acme --connector demo_portal --base-url https://… --replace
//   npm run -s firm:connector -- --firm acme --off
//   npm run -s firm:connector -- --firm acme --webhook-secret    (prints it: keep it off screens)
//
// The worker reads the system only with CONNECTOR_TRANSPORT set to its transport.

const USAGE =
  "Usage: npm run firm:connector -- --firm <slug> [--connector <name> --base-url <https address> [--replace] | --off | --webhook-secret]";

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        connector: { type: "string" },
        "base-url": { type: "string" },
        replace: { type: "boolean", default: false },
        off: { type: "boolean", default: false },
        "webhook-secret": { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const connecting = values.connector !== undefined || values["base-url"] !== undefined;
if (
  !values.firm ||
  (connecting && (values.connector === undefined || values["base-url"] === undefined)) ||
  (values.replace && !connecting) ||
  [connecting, values.off, values["webhook-secret"]].filter(Boolean).length > 1
) {
  console.error(USAGE);
  process.exit(2);
}
const slug = values.firm.trim().toLowerCase();
const env = parseConnectorOwnerEnv(process.env);
const adminUrl = env.DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
const noFirm = () => {
  console.log(`There's no firm with the slug "${slug}" in ${where}.`);
  process.exit(1);
};
const webhookAddress = (sourceId: string) =>
  platformUrl(env.APP_BASE_DOMAIN, `/api/webhooks/connector/${sourceId}`);
const describe = (s: ConnectorSource) =>
  [
    `  ${s.connector} at ${s.baseUrl} (${s.enabled ? "on" : "switched off"})`,
    `  its webhooks to: ${webhookAddress(s.sourceId)}`,
    s.lastSyncedAt
      ? `  last read in full ${s.lastSyncedAt.toISOString()}`
      : "  not read in full yet",
    ...(s.lastErrorCode ? [`  now failing: ${s.lastErrorCode}`] : []),
  ].join("\n");

try {
  if (connecting) {
    const connector = values.connector as string;
    if (!(CONNECTORS as readonly string[]).includes(connector)) {
      console.log(
        `"${connector}" isn't a connector ShiftDesk has. It has: ${CONNECTORS.join(", ")}.`,
      );
      process.exit(1);
    }
    const result = await connectConnector(adminUrl, slug, {
      connector: connector as Connector,
      baseUrl: (values["base-url"] ?? "").trim(),
      replace: values.replace,
    });
    switch (result.status) {
      case "no_firm":
        noFirm();
        break;
      case "connected":
      case "replaced":
      case "unchanged":
        console.log(
          `${result.status === "unchanged" ? "Nothing to change: it's" : result.status === "replaced" ? "Replaced: it's now" : "Connected:"} ${connector} for ${slug}, in ${where}.\n` +
            `Its webhooks go to ${webhookAddress(result.sourceId)}, signed with the secret --webhook-secret prints.\n` +
            (result.status === "replaced"
              ? "Its API key is still the old system's (connector.api_key): set the new one now, with npm run firm:secret."
              : "Its API key: npm run firm:secret, the name connector.api_key."),
        );
        process.exit(0);
        break;
      case "bad_address":
        console.log(
          "That base address isn't one: https, a public name (not an IP address or an internal name), port 443 if any, and a path with no dots for folders.",
        );
        break;
      case "has_connector":
        console.log(
          `${slug} has another connector on. To use this one instead, run the same command with --replace (the old one is switched off, not deleted).`,
        );
        break;
      case "has_sheet":
        console.log(
          `${slug}'s rota is a Google Sheet now. Switch it off first (npm run firm:sheet -- --firm ${slug} --disable).`,
        );
        break;
      case "has_api_key":
        console.log(
          `${slug}'s planner sends its sessions through the API with a live key. A firm has one planner: revoke the key on the office's Integrations page first, or keep the API.`,
        );
        break;
      case "agreement_needed":
        console.log(
          `${slug}'s agreement and DPA aren't recorded as signed in ${where}, so its own system (real staff) can't be connected yet. Record them first: npm run firm:agreement -- --firm ${slug} --signed <the date>.`,
        );
        break;
    }
    process.exit(1);
  }
  if (values.off) {
    const result = await switchOffConnector(adminUrl, slug);
    if (result.status === "no_firm") noFirm();
    console.log(
      result.status === "switched_off"
        ? `Switched off ${slug}'s connector: nothing more is read from it or taken from its webhooks.`
        : `${slug} has no connector on. Nothing was changed.`,
    );
    process.exit(result.status === "switched_off" ? 0 : 1);
  }
  const result = await showConnector(adminUrl, slug);
  if (result.status === "no_firm") noFirm();
  else if (!result.source) {
    console.log(`${slug} has no connector.`);
    process.exit(values["webhook-secret"] ? 1 : 0);
  } else if (values["webhook-secret"]) {
    if (!env.INTEGRATIONS_SECRET) {
      console.error(
        "INTEGRATIONS_SECRET isn't set here, so the webhook secret can't be worked out.",
      );
      process.exit(2);
    }
    console.log(connectorWebhookSecret(env.INTEGRATIONS_SECRET, result.source.sourceId));
  } else {
    console.log(`${slug}'s connector:\n${describe(result.source)}`);
  }
  process.exit(0);
} catch (err) {
  console.error(`Changing the firm's connector failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}
