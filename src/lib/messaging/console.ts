import { randomUUID } from "node:crypto";
import { outboundMessageSchema, type MessagingTransport, type OutboundMessage } from "./transport";

type Print = (line: string) => void;

// Keeps the country code and last 3 digits: +447700900123 -> +44*******123.
export function maskPhone(e164: string): string {
  return e164.slice(0, 3) + "*".repeat(Math.max(0, e164.length - 6)) + e164.slice(-3);
}

// Dev and test transport: prints the message instead of sending it. Never reaches Twilio.
export function createConsoleTransport(print: Print = console.log): MessagingTransport {
  return {
    name: "console",
    async send(message: OutboundMessage) {
      const msg = outboundMessageSchema.parse(message);
      const providerMessageId = `console-${randomUUID()}`;
      print(
        `[messaging:console] ${msg.channel} to ${maskPhone(msg.to)} (${providerMessageId})\n${msg.body}`,
      );
      return { providerMessageId };
    },
  };
}
