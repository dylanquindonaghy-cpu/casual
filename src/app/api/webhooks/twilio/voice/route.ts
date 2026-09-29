import { resolveFirmByLine } from "@/lib/db/directory";
import { requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { appEnv } from "@/lib/env";
import { handleTwilioVoice } from "@/lib/inbound/voice";
import { platformUrl } from "@/lib/tenancy/portal-url";

// Twilio's voice webhook for the shifts line (call-to-text: docs/api-and-jobs.md). The work is in
// src/lib/inbound/voice.ts. The caller's link goes through the login page's own request, keyed by
// the caller's number (a phone call has no IP address of its own to throttle).
const BASE = "/api/webhooks/twilio/voice";

export async function POST(request: Request): Promise<Response> {
  const env = appEnv();
  return handleTwilioVoice(request, {
    authToken: env.TWILIO_AUTH_TOKEN,
    voiceUrl: platformUrl(env.APP_BASE_DOMAIN, BASE),
    transcriptionUrl: platformUrl(env.APP_BASE_DOMAIN, `${BASE}/transcription`),
    doneUrl: platformUrl(env.APP_BASE_DOMAIN, `${BASE}/done`),
    resolveFirmByLine,
    requestLink: (firm, mobile) =>
      requestWorkerLoginLink({ firm: { id: firm.id }, clientIp: `call:${mobile}` }, mobile),
  });
}
