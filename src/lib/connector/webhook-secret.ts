import { createHmac } from "node:crypto";
import { SIGNING_SECRET_PREFIX } from "../integrations/secrets";

// The secret a connector's source signs its webhooks with (P5.3; PLAN.md P5): one we issue, the
// Standard Webhooks form (`whsec_` and the key's base64), derived from INTEGRATIONS_SECRET and the
// source's id like the planner's own webhook secret (src/lib/integrations/secrets.ts), and never
// stored. So the web route checks a signature before it reads anything, without the secret store
// (which the web app can't read: P5.1). The firm pastes it into its system's webhook settings
// (npm run firm:connector shows it). To renew one: switch the source off and connect a new one
// (a new id, a new secret); rotating INTEGRATIONS_SECRET renews every source's at once.

export function connectorWebhookKey(secret: string, sourceId: string): Buffer {
  return createHmac("sha256", secret)
    .update(`connector-webhook|${sourceId.toLowerCase()}`)
    .digest();
}

export const connectorWebhookSecret = (secret: string, sourceId: string): string =>
  `${SIGNING_SECRET_PREFIX}${connectorWebhookKey(secret, sourceId).toString("base64")}`;
