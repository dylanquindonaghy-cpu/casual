import { resolveFirmByLine } from "@/lib/db/directory";
import { appEnv } from "@/lib/env";
import { receiveSms } from "@/lib/inbound/receive";
import { handleTwilioSms } from "@/lib/inbound/webhook";
import { platformUrl } from "@/lib/tenancy/portal-url";

// Twilio's SMS webhook (docs/api-and-jobs.md): signature checked, one row stored and one job
// queued, 200 at once. On the platform address, like the WhatsApp one: the firm is the one whose
// shifts line was texted. The work is in src/lib/inbound/webhook.ts; STOP and START in the job
// (src/lib/inbound/opt-out.ts).
const PATH = "/api/webhooks/twilio/sms";

export async function POST(request: Request): Promise<Response> {
  const env = appEnv();
  return handleTwilioSms(request, {
    authToken: env.TWILIO_AUTH_TOKEN,
    webhookUrl: platformUrl(env.APP_BASE_DOMAIN, PATH),
    resolveFirmByLine,
    receive: (firmId, message) => receiveSms(firmId, message),
  });
}
