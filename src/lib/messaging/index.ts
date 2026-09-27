import type { WorkerEnv } from "../env";
import { createConsoleTransport } from "./console";
import type { MessagingTransport } from "./transport";

export type { MessagingTransport, OutboundMessage, SendResult } from "./transport";

export function getTransport(
  config: Pick<WorkerEnv, "MESSAGING_TRANSPORT" | "NODE_ENV"> & { CONSOLE_OUTBOX_FILE?: string },
): MessagingTransport {
  switch (config.MESSAGING_TRANSPORT) {
    case "console":
      // The outbox file holds full message bodies: never in production.
      return createConsoleTransport(
        console.log,
        config.NODE_ENV === "production" ? undefined : config.CONSOLE_OUTBOX_FILE,
      );
  }
}
