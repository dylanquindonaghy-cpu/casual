import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/lib/log";
import {
  SmtpEmailTransport,
  EmailMayHaveArrivedError,
  EmailNotSentError,
  type SmtpConfig,
} from "@/lib/messaging/smtp";
import type { OutboundMessage } from "@/lib/messaging/transport";

// The SMTP sender (src/lib/messaging/smtp.ts) against a fake SMTP server on this machine, never a
// real one: STARTTLS with a certificate made for the test, a login, the message, and every way it
// can fail. The line that matters is DATA: a failure before it (timeouts included) means the
// message can't have arrived (EmailNotSentError, safe to retry); during or after it, it may have
// (EmailMayHaveArrivedError, never sent again). Short timeouts here; the real ones are pinned in
// tests/unit/messaging.smtp.test.ts.

const TIMEOUTS = { connectionTimeout: 2_000, greetingTimeout: 300, socketTimeout: 300 };
// A stall must end within its timeout, plus a margin for a slow runner.
const WITHIN_MS = 2_000;

let key = "";
let cert = "";
let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "smtp-fake-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  key = readFileSync(join(dir, "key.pem"), "utf8");
  cert = readFileSync(join(dir, "cert.pem"), "utf8");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Stall = "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "body";
interface FakeOptions {
  stall?: Stall;
  hangUpBeforeGreeting?: boolean;
  starttls?: boolean;
  authReply?: string;
  rcptReply?: string;
  // A server that answers DATA with 354 even when it refused every recipient (RFC 5321 says to
  // refuse it: 503 or 554). Real ones refuse; nodemailer meets the lenient kind too.
  dataWithoutRecipients?: boolean;
  // How it says go ahead to DATA (some answer 250), whether it offers PIPELINING, and whether its
  // lines end in a bare line feed (nodemailer reads both).
  dataReply?: string;
  pipelining?: boolean;
  bareLf?: boolean;
  bodyReply?: string;
  hangUpAfterBody?: boolean;
}
interface Fake {
  port: number;
  // Each command received (a login shown as "AUTH ***"), and whether it came over TLS.
  commands: { line: string; tls: boolean }[];
  message: string;
  close: () => void;
}

const servers: Fake[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakeServer(options: FakeOptions = {}): Promise<Fake> {
  const fake: Fake = { port: 0, commands: [], message: "", close: () => undefined };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on("error", () => undefined);
    let socket: net.Socket = raw;
    let secure = false;
    let inData = false;
    let recipients = 0; // RCPT TOs accepted in this message
    let buffer = "";
    const end = options.bareLf ? "\n" : "\r\n";
    const reply = (...lines: string[]) => socket.write(lines.map((l) => `${l}${end}`).join(""));
    const stalls = (at: Stall) => options.stall === at;

    const onBytes = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          // The message ends at a line of just "." (RFC 5321 4.1.1.4), the first line included:
          // the line break before it can be DATA's own.
          const empty = buffer.startsWith(".\r\n");
          const end = empty ? 0 : buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          fake.message = buffer.slice(0, end);
          buffer = buffer.slice(empty ? 3 : end + 5);
          recipients = 0;
          inData = false;
          if (stalls("body")) return;
          if (options.hangUpAfterBody) return void socket.destroy();
          reply(options.bodyReply ?? "250 2.0.0 Ok: queued as FAKE1");
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        fake.commands.push({ line: verb === "AUTH" ? "AUTH ***" : line, tls: secure });
        if (verb === "EHLO" || verb === "HELO") {
          if (stalls("ehlo")) return;
          const offers = [
            "fake.example",
            ...(!secure && options.starttls !== false ? ["STARTTLS"] : []),
            "AUTH PLAIN LOGIN",
            // What real providers offer too, so the DATA watch is tested with them.
            ...(options.pipelining === false ? [] : ["PIPELINING"]),
            "SIZE 36700160",
            "8BITMIME",
          ];
          reply(...offers.map((o, i) => `250${i === offers.length - 1 ? " " : "-"}${o}`));
        } else if (verb === "STARTTLS") {
          // A server without TLS: it refuses the upgrade.
          if (options.starttls === false) {
            reply("502 5.5.1 STARTTLS not available");
            continue;
          }
          if (stalls("starttls")) return;
          reply("220 2.0.0 Ready to start TLS");
          raw.removeListener("data", onBytes);
          const upgraded = new tls.TLSSocket(raw, {
            isServer: true,
            key,
            cert,
            minVersion: "TLSv1.2",
          });
          upgraded.on("error", () => undefined);
          upgraded.on("data", onBytes);
          socket = upgraded;
          secure = true;
          return;
        } else if (verb === "AUTH") {
          if (stalls("auth")) return;
          reply(options.authReply ?? "235 2.7.0 Authentication successful");
        } else if (verb === "MAIL") {
          if (stalls("mail")) return;
          reply("250 2.1.0 Ok");
        } else if (verb === "RCPT") {
          if (stalls("rcpt")) return;
          const rcptReply = options.rcptReply ?? "250 2.1.5 Ok";
          if (rcptReply.startsWith("2")) recipients += 1;
          reply(rcptReply);
        } else if (verb === "DATA") {
          if (stalls("data")) return;
          if (recipients === 0 && !options.dataWithoutRecipients) {
            reply("554 5.5.1 Error: no valid recipients");
            continue;
          }
          reply(options.dataReply ?? "354 End data with <CR><LF>.<CR><LF>");
          inData = true;
        } else if (verb === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
          return;
        } else {
          reply("502 5.5.2 Not implemented");
        }
      }
    };
    raw.on("data", onBytes);
    if (options.hangUpBeforeGreeting) return void raw.end();
    if (!stalls("greeting")) reply("220 fake.example ESMTP");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      fake.port = (server.address() as net.AddressInfo).port;
      fake.close = () => {
        for (const s of sockets) s.destroy();
        server.close();
      };
      servers.push(fake);
      resolve(fake);
    });
  });
}

const email: Extract<OutboundMessage, { channel: "email" }> = {
  channel: "email",
  to: "payroll@acme.example",
  subject: "Pay queries for Mon 2 Nov",
  body: "3 new pay queries since the last digest.\n\n— Acme Events Shift Team",
  attachments: [
    { filename: "pay-queries.csv", contentType: "text/csv", content: "Reference\r\nAB12CD34\r\n" },
  ],
};

const configFor = (fake: Fake, login = true): SmtpConfig => ({
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: fake.port,
  SMTP_FROM: "shifts@acme.example",
  ...(login ? { SMTP_USER: "shiftdesk", SMTP_PASS: "made-up-password" } : {}),
});

const quiet = createLogger({ write: () => undefined });

// The error a send ended with, and how long it took.
async function failure(fake: Fake, overrides: { ca?: string } = { ca: cert }) {
  const start = performance.now();
  const transport = new SmtpEmailTransport(configFor(fake), {
    ...TIMEOUTS,
    logger: quiet,
    ...overrides,
  });
  const err = await transport.send(email).then(
    () => null,
    (e: unknown) => e,
  );
  return { err, ms: performance.now() - start };
}

describe("the SMTP sender, against a fake server", () => {
  it("sends over STARTTLS with a login, and returns the message's own Message-ID", async () => {
    const fake = await fakeServer();
    const transport = new SmtpEmailTransport(configFor(fake), { ...TIMEOUTS, ca: cert });
    const { providerMessageId } = await transport.send(email);
    expect(providerMessageId).toMatch(/^<.+@acme\.example>$/);
    expect(fake.message).toContain(`Message-ID: ${providerMessageId}`);
    expect(fake.message).toContain("Subject: Pay queries for Mon 2 Nov");
    expect(fake.message).toContain("Content-Type: text/csv; name=pay-queries.csv");
    expect(fake.message).toMatch(/name=pay-queries\.csv\r\nContent-Transfer-Encoding: base64/);
    expect(fake.message).toContain("Content-Disposition: attachment; filename=pay-queries.csv");
    // Nothing but the greeting's EHLO and STARTTLS before the connection is encrypted.
    expect(fake.commands.filter((c) => !c.tls).map((c) => c.line.split(" ")[0])).toEqual([
      "EHLO",
      "STARTTLS",
    ]);
    // Then QUIT, which isn't waited for: the message was accepted at "250 queued".
    expect(
      fake.commands
        .filter((c) => c.tls)
        .map((c) => c.line.split(/[ :]/)[0])
        .slice(0, 5),
    ).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
    expect(fake.commands.find((c) => c.line.startsWith("RCPT"))?.line).toBe(
      "RCPT TO:<payroll@acme.example>",
    );
  });

  it("without a login set, logs in to nothing", async () => {
    const fake = await fakeServer();
    const transport = new SmtpEmailTransport(configFor(fake, false), { ...TIMEOUTS, ca: cert });
    await transport.send(email);
    expect(fake.commands.map((c) => c.line)).not.toContain("AUTH ***");
  });

  it("a server without STARTTLS gets nothing in plain text: not sent", async () => {
    const fake = await fakeServer({ starttls: false });
    const { err } = await failure(fake);
    expect(err).toBeInstanceOf(EmailNotSentError);
    expect((err as EmailNotSentError).step).toBe("connect");
    // It asked for TLS though the server didn't offer it, then stopped.
    expect(fake.commands.map((c) => c.line.split(" ")[0])).toEqual(["EHLO", "STARTTLS"]);
    expect(fake.commands.map((c) => c.line.split(" ")[0])).not.toContain("AUTH");
    expect(fake.commands.map((c) => c.line.split(" ")[0])).not.toContain("MAIL");
  });

  it("a certificate it can't check: not sent", async () => {
    const fake = await fakeServer();
    const { err } = await failure(fake, {});
    expect(err).toBeInstanceOf(EmailNotSentError);
    expect((err as EmailNotSentError).step).toBe("connect");
    expect(fake.commands.filter((c) => c.tls)).toEqual([]);
  });

  it("a refused login or recipient: not sent, with the reply code and no address", async () => {
    const login = await failure(await fakeServer({ authReply: "535 5.7.8 Authentication failed" }));
    expect(login.err).toBeInstanceOf(EmailNotSentError);
    expect(login.err).toMatchObject({ step: "login", responseCode: 535 });

    const rcpt = await failure(
      await fakeServer({ rcptReply: "550 5.1.1 <payroll@acme.example>: no such user" }),
    );
    expect(rcpt.err).toBeInstanceOf(EmailNotSentError);
    expect(rcpt.err).toMatchObject({ step: "envelope", responseCode: 550 });
    expect(String((rcpt.err as Error).message)).not.toContain("@");
  });

  // With PIPELINING (nodemailer 10.1 on), MAIL FROM, RCPT TO and DATA go out together, before any
  // reply: DATA being written isn't DATA starting. A refused recipient stays not sent whether the
  // server then refuses DATA (as it should) or takes it anyway (nodemailer ends the empty message:
  // it has nobody to go to).
  // nodemailer's other ways (S3 of the 26.3 review): no pipelining, a 250 to DATA, bare line feeds.
  // A refused recipient is never sent, and once the message has gone out it may have arrived.
  it.each([
    ["without PIPELINING", { pipelining: false }],
    ["with DATA answered 250", { dataReply: "250 2.0.0 Go ahead" }],
    ["with replies ending in a bare line feed", { bareLf: true }],
  ] as const)(
    "a server %s: a refused recipient not sent; dropped after the message, may have arrived",
    async (_how, o) => {
      const refused = await failure(
        await fakeServer({ ...o, rcptReply: "550 5.1.1 <payroll@acme.example>: no such user" }),
      );
      expect(refused.err).toBeInstanceOf(EmailNotSentError);
      expect(refused.err).toMatchObject({ step: "envelope", responseCode: 550 });
      const dropped = await failure(await fakeServer({ ...o, hangUpAfterBody: true }));
      expect(dropped.err).toBeInstanceOf(EmailMayHaveArrivedError);
      // And it sends, as usual.
      const fake = await fakeServer(o);
      const transport = new SmtpEmailTransport(configFor(fake), { ...TIMEOUTS, ca: cert });
      await expect(transport.send(email)).resolves.toMatchObject({
        providerMessageId: expect.any(String),
      });
      expect(fake.message).toContain("Subject:");
    },
  );

  it("a refused recipient with the envelope pipelined: not sent, whether DATA is refused or taken", async () => {
    for (const dataWithoutRecipients of [false, true]) {
      const fake = await fakeServer({
        rcptReply: "550 5.1.1 <payroll@acme.example>: no such user",
        dataWithoutRecipients,
      });
      const { err } = await failure(fake);
      expect(err).toBeInstanceOf(EmailNotSentError);
      expect(err).toMatchObject({ step: "envelope", smtpCode: "EENVELOPE", responseCode: 550 });
      // All three were sent (pipelined: before any reply), and nothing of the message itself.
      expect(fake.commands.map((c) => c.line.split(/[ :]/)[0])).toEqual(
        expect.arrayContaining(["MAIL", "RCPT", "DATA"]),
      );
      expect(fake.message).toBe("");
    }
  });

  it("a server that hangs up before its greeting: not sent (connect)", async () => {
    const { err } = await failure(await fakeServer({ hangUpBeforeGreeting: true }));
    expect(err).toBeInstanceOf(EmailNotSentError);
    expect((err as EmailNotSentError).step).toBe("connect");
  });

  it.each([
    ["greeting", "connect"],
    ["ehlo", "connect"],
    ["starttls", "connect"],
    ["auth", "login"],
    ["mail", "envelope"],
    ["rcpt", "envelope"],
  ] as const)(
    "a server that stalls at %s: not sent (%s), within its timeout",
    async (stall, step) => {
      const { err, ms } = await failure(await fakeServer({ stall }));
      expect(err).toBeInstanceOf(EmailNotSentError);
      expect((err as EmailNotSentError).step).toBe(step);
      expect(ms).toBeLessThan(WITHIN_MS);
    },
  );

  it.each(["data", "body"] as const)(
    "a server that stalls at %s: may have arrived, within the socket timeout",
    async (stall) => {
      const { err, ms } = await failure(await fakeServer({ stall }));
      expect(err).toBeInstanceOf(EmailMayHaveArrivedError);
      expect((err as EmailMayHaveArrivedError).smtpCode).toBe("ETIMEDOUT");
      expect(ms).toBeGreaterThanOrEqual(TIMEOUTS.socketTimeout - 50);
      expect(ms).toBeLessThan(WITHIN_MS);
    },
  );

  it("logs what failed and where, never the address or the server's words", async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });
    const fake = await fakeServer({ rcptReply: "550 5.1.1 <payroll@acme.example>: no such user" });
    const transport = new SmtpEmailTransport(configFor(fake), { ...TIMEOUTS, ca: cert, logger });
    await expect(transport.send(email)).rejects.toBeInstanceOf(EmailNotSentError);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      msg: "email not sent: failed at envelope (EENVELOPE)",
      error: "EmailNotSentError",
      step: "envelope",
      smtpCode: "EENVELOPE",
      responseCode: 550,
    });
    expect(lines.join("")).not.toMatch(/@|no such user|made-up-password|shiftdesk"/);
  });

  it("refused after the message, or the line drops after it: may have arrived", async () => {
    const refused = await failure(await fakeServer({ bodyReply: "554 5.6.0 Message rejected" }));
    expect(refused.err).toBeInstanceOf(EmailMayHaveArrivedError);
    expect(refused.err).toMatchObject({ responseCode: 554 });
    const dropped = await failure(await fakeServer({ hangUpAfterBody: true }));
    expect(dropped.err).toBeInstanceOf(EmailMayHaveArrivedError);
  });
});
