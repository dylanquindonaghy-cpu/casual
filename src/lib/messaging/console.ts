import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { maskPhone, maskText } from "../log/mask";
import { jobFirmId } from "../tenancy/job-firm";
import {
  attachmentBytes,
  outboundMessageSchema,
  type MessagingTransport,
  type OutboundMessage,
} from "./transport";

type Print = (line: string) => void;

// Each printed message starts with CONSOLE_PRINT_START and ends with its own line,
// CONSOLE_PRINT_END. The print shows the whole body, login links included: in development that's
// how you get your link, and production refuses this transport except on a demo server, whose
// people are all made up (DEMO_MODE=on; ADR-025). The end line lets the e2e log check
// (tests/e2e/teardown.ts, scripts/logs-scan.ts) leave these deliberate prints out when it looks
// for login tokens anywhere else.
export const CONSOLE_PRINT_START = "[messaging:console] ";
export const CONSOLE_PRINT_END = "[messaging:console] end of message";

// Dev, test and demo transport: prints the message instead of sending it. Never reaches Twilio.
// With an outbox file (CONSOLE_OUTBOX_FILE: dev, e2e and demo mode only) it also appends each
// message as a JSON line, so an end-to-end test can open the link a worker would have received,
// and a demo server's Demo phone page can show it. Each line names the firm whose job sent it
// (src/lib/tenancy/job-firm.ts; none outside a job). That file holds real message bodies (links
// and attachments included): it lives in the gitignored .dev/ folder. An attachment is printed as
// its name and size only (the payroll list holds names and what workers wrote).
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
              (a) => `\nAttached: ${a.filename} (${attachmentBytes(a)} bytes)`,
            )
          : [];
      print(
        `${CONSOLE_PRINT_START}${msg.channel} to ${to}${from} (${providerMessageId})\n${subject}${msg.body}${files.join("")}\n${CONSOLE_PRINT_END}`,
      );
      if (outboxFile) {
        await mkdir(dirname(outboxFile), { recursive: true });
        // Bytes are kept as base64, so the line stays JSON.
        const saved =
          msg.channel === "email" && msg.attachments
            ? {
                ...msg,
                attachments: msg.attachments.map((a) =>
                  typeof a.content === "string"
                    ? a
                    : {
                        ...a,
                        content: Buffer.from(a.content).toString("base64"),
                        encoding: "base64",
                      },
                ),
              }
            : msg;
        const firmId = jobFirmId();
        const line = {
          at: new Date().toISOString(),
          providerMessageId,
          ...saved,
          ...(firmId ? { firmId } : {}),
        };
        await appendFile(outboxFile, `${JSON.stringify(line)}\n`);
      }
      return { providerMessageId };
    },
  };
}
