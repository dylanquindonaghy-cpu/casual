import { resolveFirmByLine } from "@/lib/db/directory";
import { appEnv } from "@/lib/env";
import { handleTwilioTranscription } from "@/lib/inbound/voice";
import { platformUrl } from "@/lib/tenancy/portal-url";

// Twilio's transcription callback: a voicemail's text, which becomes a request for the office
// (src/lib/inbound/voice.ts, then src/lib/inbound/reply.ts).
export async function POST(request: Request): Promise<Response> {
  const env = appEnv();
  return handleTwilioTranscription(request, {
    authToken: env.TWILIO_AUTH_TOKEN,
    webhookUrl: platformUrl(env.APP_BASE_DOMAIN, "/api/webhooks/twilio/voice/transcription"),
    resolveFirmByLine,
  });
}
