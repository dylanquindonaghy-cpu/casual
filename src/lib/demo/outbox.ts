import { open } from "node:fs/promises";
import { z } from "zod";

// The outbox file the console transport writes in demo mode (src/lib/messaging/console.ts): one
// JSON line per message, its whole body included, and the id of the firm whose job sent it. The
// Demo phone page (16.1; ADR-025) reads its end. A line that isn't a message (cut off, or written
// by something else) is skipped, never shown.

const outboxLine = z.object({
  at: z.iso.datetime(),
  firmId: z.uuid().optional(),
  channel: z.enum(["whatsapp", "sms", "email"]),
  to: z.string().min(1).max(320),
  subject: z.string().max(998).optional(),
  body: z.string().max(100_000),
  attachments: z.array(z.object({ filename: z.string().max(255) })).optional(),
});

export interface OutboxMessage {
  at: Date;
  // The firm whose job sent it; none for a line written outside a job.
  firmId?: string;
  channel: "whatsapp" | "sms" | "email";
  to: string;
  subject?: string;
  body: string;
  attachments: string[];
}

export function parseOutbox(text: string): OutboxMessage[] {
  const messages: OutboxMessage[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const line = outboxLine.safeParse(json);
    if (!line.success) continue;
    messages.push({
      at: new Date(line.data.at),
      ...(line.data.firmId !== undefined ? { firmId: line.data.firmId } : {}),
      channel: line.data.channel,
      to: line.data.to,
      ...(line.data.subject !== undefined ? { subject: line.data.subject } : {}),
      body: line.data.body,
      attachments: (line.data.attachments ?? []).map((a) => a.filename),
    });
  }
  return messages;
}

// The last `maxBytes` of the file (it only grows between the demo's nightly resets), from the
// first whole line; empty when there's no file yet.
export async function readOutboxTail(file: string, maxBytes = 2_000_000): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    await handle.close();
  }
}
