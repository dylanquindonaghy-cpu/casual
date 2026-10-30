import { workerSecretReader, type ReadFirmSecret } from "../db/firm-secret";
import { isMadeUpEmail, isMadeUpMobile } from "../demo/made-up";
import type { WorkerEnv } from "../env";
import { createConsoleTransport } from "./console";
import { SmtpEmailTransport } from "./smtp";
import { NoTextSenderError, type MessagingTransport } from "./transport";
import {
  createWebexTransport,
  WEBEX_API_KEY_SECRET,
  WEBEX_SENDER_SECRET,
  type WebexCredentials,
} from "./webex";

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
      | "DATABASE_JOBS_URL"
      | "SECRETS_KEY"
    >
  >;

// WhatsApp and texts go by MESSAGING_TRANSPORT; email by EMAIL_TRANSPORT. With both on console
// (development, tests and demo mode) one console transport carries everything, as before. With no
// text sender (none, P2.5), email still goes: by SMTP, or printed on console.
export function getTransport(config: TransportConfig): MessagingTransport {
  const phone = phoneTransport(config);
  // Demo mode prints messages for made-up people only (ADR-025): the worker's check stops it within
  // a minute of a real person getting into a demo firm, and this refuses their messages meanwhile.
  if (config.DEMO_MODE === "on") return madeUpPeopleOnly(phone);
  if (config.EMAIL_TRANSPORT !== "smtp") {
    // On console, one console transport carries both; any other text sender (none, Webex) carries
    // no email, which is printed.
    return config.MESSAGING_TRANSPORT === "console" ? phone : routeEmail(phone, consoleOf(config));
  }
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
      return consoleOf(config);
    case "none":
      return noTextSender;
    case "webex":
      return createWebexTransport({ credentialsFor: webexCredentials(config) });
  }
}

// Each firm's Webex Interact key and sender, from the secret store, through the worker's one
// reader (the jobs role's own connection: src/lib/db/firm-secret.ts). A firm without both: none.
export function webexCredentials(
  config: Pick<TransportConfig, "DATABASE_JOBS_URL" | "SECRETS_KEY">,
  read: ReadFirmSecret | null = null,
): (firmId: string) => Promise<WebexCredentials | null> {
  return async (firmId) => {
    const { DATABASE_JOBS_URL, SECRETS_KEY } = config;
    if (!read && !DATABASE_JOBS_URL) throw new Error("MESSAGING_TRANSPORT=webex needs the worker");
    const reader =
      read ?? workerSecretReader({ DATABASE_JOBS_URL: DATABASE_JOBS_URL ?? "", SECRETS_KEY });
    const [apiKey, sender] = await Promise.all([
      reader(firmId, WEBEX_API_KEY_SECRET),
      reader(firmId, WEBEX_SENDER_SECRET),
    ]);
    return apiKey && sender ? { apiKey, sender } : null;
  };
}

// The outbox file holds full message bodies: never in production, except in demo mode (made-up
// people only; its Demo phone page reads the file: ADR-025).
const consoleOf = (config: TransportConfig) =>
  createConsoleTransport(
    console.log,
    config.NODE_ENV === "production" && config.DEMO_MODE !== "on"
      ? undefined
      : config.CONSOLE_OUTBOX_FILE,
  );

// No text sender at all (MESSAGING_TRANSPORT=none, P2.5): every WhatsApp or text is refused before
// anything is tried, so a casual's message moves on to email (src/lib/notify/send.ts
// deliverToWorker) and is never logged as a failed text.
export const noTextSender: MessagingTransport = {
  name: "none",
  texts: false,
  async send(message) {
    throw new NoTextSenderError(message.channel);
  },
};

// Email to one transport, WhatsApp and texts to the other.
export function routeEmail(
  phone: MessagingTransport,
  email: MessagingTransport,
): MessagingTransport {
  return {
    name: `${phone.name}+${email.name}`,
    ...(phone.texts === false ? { texts: false as const } : {}),
    send: (message) => (message.channel === "email" ? email : phone).send(message),
  };
}

// A message to anyone with a real number or email address is refused, unprinted: in demo mode
// (src/lib/demo/made-up.ts). The refusal names the channel only, never who it was for.
export class NotMadeUpRecipient extends Error {
  constructor(channel: string) {
    super(
      `demo mode prints messages for made-up people only: a ${channel} to someone else refused`,
    );
    this.name = "NotMadeUpRecipient";
  }
}

export function madeUpPeopleOnly(transport: MessagingTransport): MessagingTransport {
  return {
    name: transport.name,
    ...(transport.texts === false ? { texts: false as const } : {}),
    send: async (message) => {
      const madeUp =
        message.channel === "email" ? isMadeUpEmail(message.to) : isMadeUpMobile(message.to);
      if (!madeUp) throw new NotMadeUpRecipient(message.channel);
      return transport.send(message);
    },
  };
}
