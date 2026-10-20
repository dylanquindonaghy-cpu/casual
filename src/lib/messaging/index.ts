import type { WorkerEnv } from "../env";
import { createConsoleTransport } from "./console";
import { SmtpEmailTransport } from "./smtp";
import type { MessagingTransport } from "./transport";

export type { MessagingTransport, OutboundMessage, SendResult } from "./transport";

type TransportConfig = Pick<WorkerEnv, "MESSAGING_TRANSPORT" | "NODE_ENV"> &
  Partial<
    Pick<
      WorkerEnv,
      | "EMAIL_TRANSPORT"
      | "SMTP_HOST"
      | "SMTP_PORT"
      | "SMTP_USER"
      | "SMTP_PASS"
      | "SMTP_FROM"
      | "CONSOLE_OUTBOX_FILE"
      | "DEMO_MODE"
    >
  >;

// WhatsApp and texts go by MESSAGING_TRANSPORT; email by EMAIL_TRANSPORT. With both on console
// (development and tests) one console transport carries everything, as before.
export function getTransport(config: TransportConfig): MessagingTransport {
  const phone = phoneTransport(config);
  if (config.EMAIL_TRANSPORT !== "smtp") return phone;
  const { SMTP_HOST, SMTP_FROM } = config;
  // The settings check refuses smtp without these (src/lib/env.ts); never send without them.
  if (!SMTP_HOST || !SMTP_FROM)
    throw new Error("EMAIL_TRANSPORT=smtp needs SMTP_HOST and SMTP_FROM");
  const email = new SmtpEmailTransport({
    SMTP_HOST,
    SMTP_FROM,
    SMTP_PORT: config.SMTP_PORT ?? 587,
    SMTP_USER: config.SMTP_USER,
    SMTP_PASS: config.SMTP_PASS,
  });
  return routeEmail(phone, email);
}

function phoneTransport(config: TransportConfig): MessagingTransport {
  switch (config.MESSAGING_TRANSPORT) {
    case "console":
      // The outbox file holds full message bodies: never in production, except in demo mode
      // (made-up people only; its Demo phone page reads the file: ADR-025).
      return createConsoleTransport(
        console.log,
        config.NODE_ENV === "production" && config.DEMO_MODE !== "on"
          ? undefined
          : config.CONSOLE_OUTBOX_FILE,
      );
  }
}

// Email to one transport, WhatsApp and texts to the other.
export function routeEmail(
  phone: MessagingTransport,
  email: MessagingTransport,
): MessagingTransport {
  return {
    name: `${phone.name}+${email.name}`,
    send: (message) => (message.channel === "email" ? email : phone).send(message),
  };
}
