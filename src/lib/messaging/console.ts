import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { maskPhone, maskText } from "../log/mask";
import { outboundMessageSchema, type MessagingTransport, type OutboundMessage } from "./transport";

type Print = (line: string) => void;

// Dev and test transport: prints the message instead of sending it. Never reaches Twilio.
// With an outbox file (CONSOLE_OUTBOX_FILE, dev and e2e only) it also appends each message as a
// JSON line, so an end-to-end test can open the link a worker would have received. That file
// holds real message bodies (links and attachments included): it lives in the gitignored .dev/
// folder. An attachment is printed as its name and size only (the payroll list holds names and
// what workers wrote).
export function createConsoleTransport(
  print: Print = console.log,
  outboxFile?: string,
): MessagingTransport {
  return {
    name: "console",
    async send(message: OutboundMessage) {
      const msg = outboundMessageSchema.parse(message);
      const providerMessageId = `console-${randomUUID()}`;
      const to = msg.channel === "email" ? maskText(msg.to) : maskPhone(msg.to);
      // The firm's shifts line is a business number, not personal data: shown whole.
      const from = msg.channel !== "email" && msg.from ? ` from ${msg.from}` : "";
      const subject = msg.channel === "email" ? `Subject: ${msg.subject}\n` : "";
      const files =
        msg.channel === "email"
          ? (msg.attachments ?? []).map(
              (a) => `\nAttached: ${a.filename} (${Buffer.byteLength(a.content)} bytes)`,
            )
          : [];
      print(
        `[messaging:console] ${msg.channel} to ${to}${from} (${providerMessageId})\n${subject}${msg.body}${files.join("")}`,
      );
      if (outboxFile) {
        await mkdir(dirname(outboxFile), { recursive: true });
        const line = { at: new Date().toISOString(), providerMessageId, ...msg };
        await appendFile(outboxFile, `${JSON.stringify(line)}\n`);
      }
      return { providerMessageId };
    },
  };
}
