import { appEnv } from "@/lib/env";
import { handleTwilioVoiceDone } from "@/lib/inbound/voice";
import { platformUrl } from "@/lib/tenancy/portal-url";

// Where Twilio goes after a voicemail is recorded: a goodbye (src/lib/inbound/voice.ts).
export async function POST(request: Request): Promise<Response> {
  const env = appEnv();
  return handleTwilioVoiceDone(request, {
    authToken: env.TWILIO_AUTH_TOKEN,
    webhookUrl: platformUrl(env.APP_BASE_DOMAIN, "/api/webhooks/twilio/voice/done"),
  });
}
