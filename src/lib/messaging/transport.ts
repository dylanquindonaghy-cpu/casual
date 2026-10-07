import { z } from "zod";

export const channelSchema = z.enum(["whatsapp", "sms", "email"]);
export type Channel = z.infer<typeof channelSchema>;

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +447700900123");

// A file sent with an email: a CSV (the payroll digest's list) or a PDF. Its content is text (a
// CSV only, as UTF-8), bytes, or base64 text (`encoding: "base64"`). Limits are in bytes once
// decoded: a CSV at most 6,000,000, a PDF at most 5,000,000, at most 3 files and 7,000,000 in all,
// so the whole message stays within providers' size caps once encoded (base64 adds a third: three
// 6 MB lists would be too big). docs/office-v2.md 5.8.
export const MAX_ATTACHMENT_BYTES = 6_000_000; // a CSV
export const MAX_PDF_BYTES = 5_000_000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 7_000_000;
const MAX_BYTES = { "text/csv": MAX_ATTACHMENT_BYTES, "application/pdf": MAX_PDF_BYTES } as const;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const attachmentSchema = z
  .object({
    filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    contentType: z.enum(["text/csv", "application/pdf"]),
    content: z.union([z.string().min(1), z.instanceof(Uint8Array)]),
    encoding: z.literal("base64").optional(),
  })
  .superRefine((a, ctx) => {
    if (typeof a.content === "string") {
      if (a.encoding === "base64") {
        if (a.content.length % 4 !== 0 || !BASE64.test(a.content)) {
          ctx.addIssue({ code: "custom", path: ["content"], message: "not base64" });
          return;
        }
      } else if (a.contentType !== "text/csv") {
        ctx.addIssue({ code: "custom", path: ["content"], message: "only a CSV can be text" });
        return;
      }
    } else if (a.encoding) {
      ctx.addIssue({ code: "custom", path: ["encoding"], message: "bytes have no encoding" });
      return;
    }
    // A text's bytes are at least its characters: a long one is refused before it's encoded.
    const tooLong =
      typeof a.content === "string" && !a.encoding && a.content.length > MAX_BYTES[a.contentType];
    const size = tooLong ? Infinity : attachmentBytes(a);
    if (size === 0 || size > MAX_BYTES[a.contentType]) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "empty or too big" });
    }
  });
export type Attachment = z.infer<typeof attachmentSchema>;

// The file's size in bytes, once decoded.
export function attachmentBytes(a: Pick<Attachment, "content" | "encoding">): number {
  if (typeof a.content !== "string") return a.content.byteLength;
  if (a.encoding !== "base64") return new TextEncoder().encode(a.content).length;
  const padding = a.content.endsWith("==") ? 2 : a.content.endsWith("=") ? 1 : 0;
  return (a.content.length / 4) * 3 - padding;
}

// Messages to a phone (workers) or an email address (office users, login links by email). A
// WhatsApp or text goes from the firm's own number (its shifts line, `from`) when it has one; the
// real sender decides what a message without one does (PLAN.md Parking lot, "Connect Twilio").
export const outboundMessageSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("whatsapp"),
    to: e164,
    from: e164.optional(),
    body: z.string().min(1).max(1600),
  }),
  z.object({
    channel: z.literal("sms"),
    to: e164,
    from: e164.optional(),
    body: z.string().min(1).max(1600),
  }),
  z.object({
    channel: z.literal("email"),
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(20_000),
    attachments: z
      .array(attachmentSchema)
      .max(MAX_ATTACHMENTS)
      .refine(
        (files) =>
          files.reduce((sum, a) => sum + attachmentBytes(a), 0) <= MAX_ATTACHMENTS_TOTAL_BYTES,
        "the files are too big together",
      )
      .optional(),
  }),
]);
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

export interface SendResult {
  providerMessageId: string;
}

// The provider won't carry this message on this channel (e.g. the number isn't on WhatsApp): the
// only error a sender may answer by trying another channel. Anything else (a timeout, an outage)
// might already have been delivered, so it's never "fallen back" from.
export class ChannelRefusedError extends Error {
  constructor(readonly channel: Channel) {
    super(`the provider refused the ${channel} message`);
    this.name = "ChannelRefusedError";
  }
}

export interface MessagingTransport {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
