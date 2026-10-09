import { sql } from "drizzle-orm";
import { messages } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { queueInboundMessage } from "./job";

// Storing a WhatsApp or a text the firm's shifts line received (golden rule 3): one `messages` row,
// keyed by Twilio's MessageSid within the firm (Twilio may send the same webhook more than once: a
// repeat stores nothing and queues nothing), and one inbound-message job, in the same transaction.
// The reply is the job's (src/lib/inbound/reply.ts), so the webhook answers fast.

export interface InboundWhatsApp {
  messageSid: string;
  from: string; // E.164, "whatsapp:" taken off
  to: string; // the firm's shifts line, E.164
  body: string | null;
}

export interface InboundSms extends InboundWhatsApp {
  // Twilio's OptOutType when its own opt-out handling acted on the text (STOP or START).
  twilioOptOut: "stop" | "start" | null;
}

export function receiveWhatsApp(
  firmId: string,
  message: InboundWhatsApp,
  deps: { run?: WithFirm } = {},
): Promise<{ stored: boolean }> {
  return receive(firmId, { ...message, channel: "whatsapp", twilioOptOut: null }, deps);
}

export function receiveSms(
  firmId: string,
  message: InboundSms,
  deps: { run?: WithFirm } = {},
): Promise<{ stored: boolean }> {
  return receive(firmId, { ...message, channel: "sms" }, deps);
}

async function receive(
  firmId: string,
  message: InboundSms & { channel: "whatsapp" | "sms" },
  deps: { run?: WithFirm },
): Promise<{ stored: boolean }> {
  return (deps.run ?? withFirm)(firmId, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "in",
        channel: message.channel,
        providerMessageId: message.messageSid,
        fromE164: message.from,
        toE164: message.to,
        body: message.body,
        twilioOptOut: message.twilioOptOut,
      })
      .onConflictDoNothing({ target: [messages.firmId, messages.providerMessageId] })
      .returning({ id: messages.id });
    if (!row) return { stored: false };
    await queueInboundMessage(tx, row.id);
    return { stored: true };
  });
}
