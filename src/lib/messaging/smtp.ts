import MailComposer from "nodemailer/lib/mail-composer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import type { WorkerEnv } from "../env";
import { log, type Logger } from "../log";
import { outboundMessageSchema, type MessagingTransport, type OutboundMessage } from "./transport";

// Email through any provider's SMTP server (docs/office-v2.md 5.8; ADR-021), with EMAIL_TRANSPORT=
// smtp. It carries every office email: login links, escalations, the credential list, the payroll
// digest and the strike evidence. WhatsApp and texts never come here (getTransport()). Real sending
// waits for "Connect an email provider (SMTP)" (PLAN.md Parking lot); tests never reach a real
// server (the settings refuse smtp under NODE_ENV=test).

type EmailMessage = Extract<OutboundMessage, { channel: "email" }>;
export type SmtpConfig = Pick<WorkerEnv, "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS"> & {
  SMTP_HOST: string;
  SMTP_FROM: string;
};

// Where the conversation had got to. Up to RCPT TO the server holds nothing; from the DATA
// command on, it may have the message.
export type SmtpStep = "connect" | "login" | "envelope" | "data";

// Failed before the server accepted the message (connecting, EHLO, STARTTLS, AUTH, MAIL FROM or
// RCPT TO, timeouts included): it can't have arrived, so it's safe to send again. The message never
// holds an address or the server's words: the step, nodemailer's code and the reply code only.
export class EmailNotSentError extends Error {
  constructor(
    readonly step: Exclude<SmtpStep, "data">,
    readonly smtpCode?: string,
    readonly responseCode?: number,
  ) {
    super(`email not sent: failed at ${step}${smtpCode ? ` (${smtpCode})` : ""}`);
    this.name = "EmailNotSentError";
  }
}

// Failed during or after DATA: the server may have the message, so it's never sent again (the
// claim-then-send rule every sender follows).
export class EmailMayHaveArrivedError extends Error {
  readonly step = "data";
  constructor(
    readonly smtpCode?: string,
    readonly responseCode?: number,
  ) {
    super(`email may have arrived: failed during or after DATA${smtpCode ? ` (${smtpCode})` : ""}`);
    this.name = "EmailMayHaveArrivedError";
  }
}

// Set here, not left to nodemailer's defaults (2 minutes to connect and 10 minutes of silence:
// long enough for one hung server to hold up the login-link and evidence queues).
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
};

// The connection's settings. 465 is TLS from the first byte; any other port (587, or 2525 where a
// provider offers it) must upgrade with STARTTLS, so plain text is never possible. TLS 1.2 or
// later, with the server's certificate checked. No logger or debug output: nodemailer's includes
// the login exchange.
export function smtpConnectionOptions(config: SmtpConfig): SMTPConnection.Options {
  const implicitTls = config.SMTP_PORT === 465;
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: implicitTls,
    requireTLS: !implicitTls,
    ignoreTLS: false,
    opportunisticTLS: false,
    ...SMTP_TIMEOUTS,
    logger: false,
    debug: false,
    transactionLog: false,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  };
}

// The message as nodemailer builds it: from, to, the Reply-To when there is one, subject, the plain-text body and the files, each
// file base64-encoded (so the size limits in transport.ts hold once encoded: nodemailer would pick
// quoted-printable for some text, which can triple non-ASCII bytes). No file or web address is
// ever read in (only the bytes given here).
export function smtpMailOptions(from: string, message: EmailMessage) {
  return {
    from,
    to: message.to,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    text: message.body,
    attachments: (message.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: typeof a.content === "string" ? a.content : Buffer.from(a.content),
      ...(a.encoding ? { encoding: a.encoding } : {}),
      contentTransferEncoding: "base64" as const,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

// Only for tests against a local fake server: its certificate, shorter timeouts, a logger to read.
export interface SmtpTestOverrides {
  ca?: string;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  logger?: Logger;
}

const LOOPBACK = ["127.0.0.1", "::1", "localhost"];

export class SmtpEmailTransport implements MessagingTransport {
  readonly name = "smtp";
  private readonly logger: Logger;
  private readonly testOverrides: Omit<SmtpTestOverrides, "logger">;

  constructor(
    private readonly config: SmtpConfig,
    overrides: SmtpTestOverrides = {},
  ) {
    const { logger = log.child({ transport: "smtp" }), ...testOverrides } = overrides;
    this.logger = logger;
    this.testOverrides = testOverrides;
  }

  async send(message: OutboundMessage) {
    const msg = outboundMessageSchema.parse(message);
    if (msg.channel !== "email") throw new Error("the SMTP sender carries email only");
    // Tests never reach a real server: the settings refuse smtp under NODE_ENV=test, and a test
    // that builds this sender itself may only point it at this machine.
    if (process.env.NODE_ENV === "test" && !LOOPBACK.includes(this.config.SMTP_HOST)) {
      throw new Error("tests never send real email: only a server on this machine");
    }
    const mail = new MailComposer(smtpMailOptions(this.config.SMTP_FROM, msg)).compile();
    const base = smtpConnectionOptions(this.config);
    const { ca, ...timeouts } = this.testOverrides;
    const connection = new SMTPConnection({
      ...base,
      ...timeouts,
      tls: { ...base.tls, ...(ca ? { ca } : {}) },
    });

    let step: SmtpStep = "connect";
    // nodemailer reports a failure on its "error" event (and to the step in flight): one listener
    // for the whole conversation, so nothing is left unhandled.
    const failed = new Promise<never>((_, reject) => connection.on("error", reject));
    failed.catch(() => undefined);
    const run = <T>(start: (done: (err?: Error | null, value?: T) => void) => void) =>
      Promise.race([
        new Promise<T>((resolve, reject) =>
          start((err, value) => (err ? reject(err) : resolve(value as T))),
        ),
        failed,
      ]);

    try {
      await run<void>((done) => connection.connect((err) => done(err)));
      step = "login";
      const { SMTP_USER: user, SMTP_PASS: pass } = this.config;
      if (user && pass) await run<boolean>((done) => connection.login({ user, pass }, done));
      step = "envelope";
      watchForData(connection, () => {
        step = "data";
      });
      await run((done) => connection.send(mail.getEnvelope(), mail.createReadStream(), done));
      connection.quit();
      return { providerMessageId: mail.messageId() };
    } catch (err) {
      connection.close();
      const error = sendError(err, step);
      // What failed and where (docs/runbooks.md "Email not arriving"): never the address or the
      // server's words.
      this.logger.warn(error.message, {
        error: error.name,
        step,
        smtpCode: error.smtpCode,
        responseCode: error.responseCode,
      });
      throw error;
    }
  }
}

// nodemailer labels every timeout, socket error and dropped connection "CONN", whatever step the
// conversation had reached, so its label can't say whether DATA had started. The step is tracked
// here instead: by the time send() starts, the connection's socket is final (TLS done, logged in),
// and the DATA command is written to it as a line of its own (alone, or after other commands if
// they're ever sent together). If the socket can't be watched, the whole send counts as DATA (may
// have arrived), never the other way round. A false match only ever errs the same, safe way.
const DATA_LINE = /(^|\r\n)DATA\r\n/;
function watchForData(connection: SMTPConnection, onData: () => void) {
  const socket = connection._socket;
  if (!socket) {
    onData();
    return;
  }
  const write = socket.write.bind(socket) as (...args: unknown[]) => boolean;
  socket.write = ((chunk: unknown, ...rest: unknown[]) => {
    if ((typeof chunk === "string" || Buffer.isBuffer(chunk)) && DATA_LINE.test(chunk.toString())) {
      onData();
    }
    return write(chunk, ...rest);
  }) as typeof socket.write;
}

function sendError(err: unknown, step: SmtpStep): EmailNotSentError | EmailMayHaveArrivedError {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown };
  const smtpCode =
    typeof e.code === "string" && /^[A-Z0-9]{1,20}$/.test(e.code) ? e.code : undefined;
  const responseCode = typeof e.responseCode === "number" ? e.responseCode : undefined;
  return step === "data"
    ? new EmailMayHaveArrivedError(smtpCode, responseCode)
    : new EmailNotSentError(step, smtpCode, responseCode);
}
