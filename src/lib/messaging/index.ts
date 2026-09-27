import type { Env } from "../env";
import { createConsoleTransport } from "./console";
import type { MessagingTransport } from "./transport";

export type { MessagingTransport, OutboundMessage, SendResult } from "./transport";

export function getTransport(config: Pick<Env, "MESSAGING_TRANSPORT">): MessagingTransport {
  switch (config.MESSAGING_TRANSPORT) {
    case "console":
      return createConsoleTransport();
  }
}
