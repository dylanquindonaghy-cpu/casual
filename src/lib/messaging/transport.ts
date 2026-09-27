import { z } from "zod";

export const channelSchema = z.enum(["whatsapp", "sms"]);
export type Channel = z.infer<typeof channelSchema>;

export const outboundMessageSchema = z.object({
  channel: channelSchema,
  to: z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +447700900123"),
  body: z.string().min(1).max(1600),
});
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

export interface SendResult {
  providerMessageId: string;
}

export interface MessagingTransport {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
