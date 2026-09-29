import { resolveFirmByLine } from "@/lib/db/directory";
import { appEnv } from "@/lib/env";
import { receiveWhatsApp } from "@/lib/inbound/receive";
import { handleTwilioWhatsApp } from "@/lib/inbound/webhook";
import { platformUrl } from "@/lib/tenancy/portal-url";

// Twilio's WhatsApp webhook (docs/api-and-jobs.md): signature checked, one row stored and one job
// queued, 200 at once. Configured on the platform address, not a firm's: the firm is the one whose
// shifts line the message was sent to. The work is in src/lib/inbound/webhook.ts.
const PATH = "/api/webhooks/twilio/whatsapp";

export async function POST(request: Request): Promise<Response> {
  const env = appEnv();
  return handleTwilioWhatsApp(request, {
    authToken: env.TWILIO_AUTH_TOKEN,
    webhookUrl: platformUrl(env.APP_BASE_DOMAIN, PATH),
    resolveFirmByLine,
    receive: (firmId, message) => receiveWhatsApp(firmId, message),
  });
}
