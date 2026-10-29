import { z } from "zod";
import { jobFirmId } from "../tenancy/job-firm";
import {
  ChannelRefusedError,
  outboundMessageSchema,
  type MessagingTransport,
  type OutboundMessage,
  type SendResult,
} from "./transport";

// Texts through the firm's own Webex Interact account (Phase 15; PLAN.md Phase 15: AXLR8, the
// pilot firm's CRM, texts through it; confirmed by Dylan 2026-10-26). Built and switched off: it
// sends only with MESSAGING_TRANSPORT=webex, which the settings refuse under NODE_ENV=test, and only
// for a firm whose key is in the secret store (`npm run firm:secret`: WEBEX_API_KEY_SECRET, and its
// sender name or number, WEBEX_SENDER_SECRET); a firm without one gets nothing sent. Not yet tried
// against the real service (that waits for the firm's account).
//
// From Webex Interact's public reference (docs.webexinteract.com/reference/sms-api, read
// 2026-10-29): POST https://api.webexinteract.com/v1/sms with the access token in X-AUTH-KEY and a
// JSON body {message_body, from, to: [{phone: [E.164 numbers]}]}; 200 answers {request_id, messages:
// [{transaction_id, to, status, code}], errors: [...]} (a number it refused is in `errors`), 400
// {errors: [{code, message, field?}]} (10005 insufficient balance, 10006 a request it won't take).
//
// - Which firm: the job's (src/lib/tenancy/job-firm.ts: every firm job runs inside its firm), so no
//   sender has to pass it; a send outside a firm job is refused.
// - Texts only. A WhatsApp is refused as a channel it won't carry (ChannelRefusedError), so a casual
//   who chose WhatsApp gets the text instead (src/lib/notify/send.ts); email never comes here.
// - Every request has a timeout; a failure is a code only (WebexSendError: its name, which is what
//   the send's log entry records), never the number, the text or the key.

export const WEBEX_SMS_URL = "https://api.webexinteract.com/v1/sms";
export const WEBEX_API_KEY_SECRET = "webex.api_key";
export const WEBEX_SENDER_SECRET = "webex.sender";
export const WEBEX_TIMEOUT_MS = 10_000;

export type WebexFailure =
  | "no_firm" // sent outside a firm's job
  | "no_key" // the firm has no Webex key (or sender) in the secret store
  | "unauthorised" // the key was refused (401, 403)
  | "refused" // the number or the text refused (a 400, or the number in `errors`)
  | "no_balance" // 10005
  | "rate_limited" // 429
  | "unavailable" // 5xx, a timeout, or no answer
  | "bad_answer"; // an answer that isn't Webex Interact's

export class WebexSendError extends Error {
  constructor(readonly failure: WebexFailure) {
    super(`the text wasn't sent through Webex Interact: ${failure}`);
    // The send's log entry records an error's name (errorCode): this one says what went wrong.
    this.name = `webex_${failure}`;
  }
}

export interface WebexCredentials {
  apiKey: string;
  sender: string; // a sender name or long number set up in Webex Interact
}

export interface WebexDeps {
  credentialsFor: (firmId: string) => Promise<WebexCredentials | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const accepted = z.object({
  request_id: z.string().optional(),
  messages: z
    .array(z.object({ transaction_id: z.string().nullable().optional(), status: z.string() }))
    .default([]),
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional() })).default([]),
});
const refusedBody = z.object({
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional() })).min(1),
});

async function post(
  creds: WebexCredentials,
  to: string,
  body: string,
  deps: WebexDeps,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(WEBEX_SMS_URL, {
      method: "POST",
      headers: { "X-AUTH-KEY": creds.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ message_body: body, from: creds.sender, to: [{ phone: [to] }] }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? WEBEX_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new WebexSendError("unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new WebexSendError("unauthorised");
  if (response.status === 429) throw new WebexSendError("rate_limited");
  if (response.status >= 500) throw new WebexSendError("unavailable");
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new WebexSendError("bad_answer");
  }
  if (response.status === 400) {
    const parsed = refusedBody.safeParse(json);
    if (!parsed.success) throw new WebexSendError("bad_answer");
    const balance = parsed.data.errors.some((e) => String(e.code) === "10005");
    throw new WebexSendError(balance ? "no_balance" : "refused");
  }
  if (response.status !== 200) throw new WebexSendError("bad_answer");
  const parsed = accepted.safeParse(json);
  if (!parsed.success) throw new WebexSendError("bad_answer");
  const queued = parsed.data.messages.find((m) => m.transaction_id);
  if (queued?.transaction_id) return { providerMessageId: `webex-${queued.transaction_id}` };
  throw new WebexSendError(parsed.data.errors.length > 0 ? "refused" : "bad_answer");
}

export function createWebexTransport(deps: WebexDeps): MessagingTransport {
  return {
    name: "webex",
    async send(message: OutboundMessage): Promise<SendResult> {
      const msg = outboundMessageSchema.parse(message);
      if (msg.channel === "whatsapp") throw new ChannelRefusedError("whatsapp");
      if (msg.channel === "email") throw new Error("email never goes through Webex Interact");
      const firmId = jobFirmId();
      if (!firmId) throw new WebexSendError("no_firm");
      const creds = await deps.credentialsFor(firmId);
      if (!creds) throw new WebexSendError("no_key");
      return post(creds, msg.to, msg.body, deps);
    },
  };
}
