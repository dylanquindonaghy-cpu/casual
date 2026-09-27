import { z } from "zod";

export const channelSchema = z.enum(["whatsapp", "sms", "email"]);
export type Channel = z.infer<typeof channelSchema>;

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +447700900123");

// Messages to a phone (workers) or an email address (office users, login links by email).
export const outboundMessageSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("whatsapp"), to: e164, body: z.string().min(1).max(1600) }),
  z.object({ channel: z.literal("sms"), to: e164, body: z.string().min(1).max(1600) }),
  z.object({
    channel: z.literal("email"),
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(20_000),
  }),
]);
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

export interface SendResult {
  providerMessageId: string;
}

export interface MessagingTransport {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
