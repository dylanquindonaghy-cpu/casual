import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "@/lib/env";
import { getTransport, routeEmail } from "@/lib/messaging";
import {
  SmtpEmailTransport,
  EmailMayHaveArrivedError,
  EmailNotSentError,
  smtpConnectionOptions,
  smtpMailOptions,
  type SmtpConfig,
} from "@/lib/messaging/smtp";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PDF_BYTES,
  outboundMessageSchema,
  type MessagingTransport,
  type OutboundMessage,
} from "@/lib/messaging/transport";

// Email over SMTP (docs/office-v2.md 5.8; PLAN.md 12X.2), without any network: the connection's
// settings, the message as nodemailer builds it (its JSON transport), the routing, and the
// settings check. tests/unit/messaging.smtp-server.test.ts talks to a fake server on this machine.

const config: SmtpConfig = {
  SMTP_HOST: "smtp.mail.example",
  SMTP_PORT: 587,
  SMTP_USER: "shiftdesk",
  SMTP_PASS: "made-up-password",
  SMTP_FROM: "shifts@acme.example",
};

describe("the connection's settings", () => {
  it("587 (and any port but 465) must upgrade with STARTTLS; 465 is TLS from the first byte", () => {
    const common = {
      host: "smtp.mail.example",
      ignoreTLS: false,
      opportunisticTLS: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      logger: false,
      debug: false,
      transactionLog: false,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    };
    expect(smtpConnectionOptions(config)).toEqual({
      ...common,
      port: 587,
      secure: false,
      requireTLS: true,
    });
    expect(smtpConnectionOptions({ ...config, SMTP_PORT: 2525 })).toEqual({
      ...common,
      port: 2525,
      secure: false,
      requireTLS: true,
    });
    expect(smtpConnectionOptions({ ...config, SMTP_PORT: 465 })).toEqual({
      ...common,
      port: 465,
      secure: true,
      requireTLS: false,
    });
  });

  it("never logs: no logger, no debug output, no transaction log (they'd show the login)", () => {
    for (const port of [25, 465, 587, 2525]) {
      const options = smtpConnectionOptions({ ...config, SMTP_PORT: port });
      expect([options.logger, options.debug, options.transactionLog]).toEqual([
        false,
        false,
        false,
      ]);
      // Plain text is never possible: TLS from the start, or STARTTLS required.
      expect(options.secure || options.requireTLS).toBe(true);
    }
  });
});

const csv = "﻿Reference,Worker\r\nAB12CD34,Zoë Booker\r\n";
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const email: Extract<OutboundMessage, { channel: "email" }> = {
  channel: "email",
  to: "payroll@acme.example",
  subject: "Pay queries for Mon 2 Nov",
  body: "3 new pay queries since the last digest.\n\n— Acme Events Shift Team",
  attachments: [
    { filename: "pay-queries-2026-11-02.csv", contentType: "text/csv", content: csv },
    { filename: "cancellation.pdf", contentType: "application/pdf", content: pdf },
  ],
};

describe("the message, as nodemailer builds it", () => {
  it("from, to, subject, the plain-text body, a CSV and a PDF; no file or web address read in", async () => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    const info = await json.sendMail(smtpMailOptions(config.SMTP_FROM, email));
    const sent = JSON.parse(String(info.message)) as {
      from: { address: string };
      to: { address: string }[];
      subject: string;
      text: string;
      html?: string;
      attachments: { filename: string; contentType: string; content: string; encoding?: string }[];
      disableFileAccess: boolean;
      disableUrlAccess: boolean;
    };
    expect(sent.from.address).toBe("shifts@acme.example");
    expect(sent.to.map((t) => t.address)).toEqual(["payroll@acme.example"]);
    expect(sent.subject).toBe("Pay queries for Mon 2 Nov");
    expect(sent.text).toBe(email.body);
    expect(sent.html).toBeUndefined();
    expect(info.envelope).toEqual({ from: "shifts@acme.example", to: ["payroll@acme.example"] });
    const [list, record] = sent.attachments;
    expect(list).toMatchObject({ filename: "pay-queries-2026-11-02.csv", contentType: "text/csv" });
    expect(list?.content).toBe(csv);
    expect(record).toMatchObject({
      filename: "cancellation.pdf",
      contentType: "application/pdf",
      encoding: "base64",
    });
    expect(Buffer.from(record?.content ?? "", "base64")).toEqual(Buffer.from(pdf));
    expect([sent.disableFileAccess, sent.disableUrlAccess]).toEqual([true, true]);
  });

  it("base64 content goes as base64", async () => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    const base64 = Buffer.from(pdf).toString("base64");
    const info = await json.sendMail(
      smtpMailOptions(config.SMTP_FROM, {
        ...email,
        attachments: [
          {
            filename: "a.pdf",
            contentType: "application/pdf",
            content: base64,
            encoding: "base64",
          },
        ],
      }),
    );
    const [file] = (JSON.parse(String(info.message)) as { attachments: { content: string }[] })
      .attachments;
    expect(Buffer.from(file?.content ?? "", "base64")).toEqual(Buffer.from(pdf));
  });
});

describe("attachments", () => {
  const parse = (attachments: unknown[]) =>
    outboundMessageSchema.safeParse({ ...email, attachments }).success;

  it("a CSV as text, bytes or base64; a PDF as bytes or base64, never as text", () => {
    const b64 = Buffer.from(pdf).toString("base64");
    expect(parse([{ filename: "a.csv", contentType: "text/csv", content: "a,b" }])).toBe(true);
    expect(
      parse([{ filename: "a.csv", contentType: "text/csv", content: Buffer.from("a,b") }]),
    ).toBe(true);
    expect(
      parse([
        { filename: "a.pdf", contentType: "application/pdf", content: b64, encoding: "base64" },
      ]),
    ).toBe(true);
    expect(
      parse([{ filename: "a.pdf", contentType: "application/pdf", content: "%PDF-1.7" }]),
    ).toBe(false);
    expect(
      parse([
        {
          filename: "a.pdf",
          contentType: "application/pdf",
          content: "not base64!",
          encoding: "base64",
        },
      ]),
    ).toBe(false);
    expect(
      parse([
        { filename: "a.pdf", contentType: "application/pdf", content: pdf, encoding: "base64" },
      ]),
    ).toBe(false);
    expect(parse([{ filename: "a.html", contentType: "text/html", content: "<p>" }])).toBe(false);
    expect(
      parse([{ filename: "a.pdf", contentType: "application/pdf", content: new Uint8Array() }]),
    ).toBe(false);
  });

  it("a limit per type, at most 3, at most 7,000,000 bytes together (decoded)", () => {
    const bytes = (n: number) => new Uint8Array(n);
    const pdfOf = (n: number) => ({
      filename: "a.pdf",
      contentType: "application/pdf",
      content: bytes(n),
    });
    const csvOf = (n: number) => ({
      filename: "a.csv",
      contentType: "text/csv",
      content: bytes(n),
    });
    expect(parse([pdfOf(MAX_PDF_BYTES)])).toBe(true);
    expect(parse([pdfOf(MAX_PDF_BYTES + 1)])).toBe(false);
    expect(parse([csvOf(MAX_ATTACHMENT_BYTES)])).toBe(true);
    expect(parse([csvOf(MAX_ATTACHMENT_BYTES + 1)])).toBe(false);
    // As base64: the size counted is the decoded size.
    const b64 = Buffer.from(bytes(MAX_PDF_BYTES + 3)).toString("base64");
    expect(
      parse([
        { filename: "a.pdf", contentType: "application/pdf", content: b64, encoding: "base64" },
      ]),
    ).toBe(false);
    expect(parse([pdfOf(10), pdfOf(10), pdfOf(10)])).toBe(true);
    expect(parse([pdfOf(10), pdfOf(10), pdfOf(10), pdfOf(10)])).toBe(false);
    expect(parse([pdfOf(3_500_000), pdfOf(3_500_000)])).toBe(true);
    expect(parse([pdfOf(3_500_000), pdfOf(3_500_001)])).toBe(false);
    expect(parse([csvOf(5_000_000), pdfOf(2_000_001)])).toBe(false);
  });
});

describe("routing", () => {
  const recorder = (name: string) => {
    const sent: OutboundMessage[] = [];
    const transport: MessagingTransport = {
      name,
      async send(message) {
        sent.push(message);
        return { providerMessageId: `${name}-1` };
      },
    };
    return { sent, transport };
  };

  it("email to the SMTP sender; WhatsApp and texts to the phone transport, as before", async () => {
    const phone = recorder("console");
    const smtp = recorder("smtp");
    const routed = routeEmail(phone.transport, smtp.transport);
    await routed.send(email);
    await routed.send({ channel: "whatsapp", to: "+447700900123", body: "Hi" });
    await routed.send({ channel: "sms", to: "+447700900123", body: "Hi" });
    expect(smtp.sent.map((m) => m.channel)).toEqual(["email"]);
    expect(phone.sent.map((m) => m.channel)).toEqual(["whatsapp", "sms"]);
  });

  it("getTransport: console for everything unless EMAIL_TRANSPORT=smtp", () => {
    const base = { MESSAGING_TRANSPORT: "console" as const, NODE_ENV: "development" as const };
    expect(getTransport(base).name).toBe("console");
    expect(getTransport({ ...base, EMAIL_TRANSPORT: "console" }).name).toBe("console");
    expect(getTransport({ ...base, EMAIL_TRANSPORT: "smtp", ...config }).name).toBe("console+smtp");
    expect(() => getTransport({ ...base, EMAIL_TRANSPORT: "smtp", SMTP_PORT: 587 })).toThrow(
      /SMTP_HOST and SMTP_FROM/,
    );
  });

  it("under tests, the SMTP sender refuses any server but this machine's", async () => {
    await expect(new SmtpEmailTransport(config).send(email)).rejects.toThrow(
      "tests never send real email: only a server on this machine",
    );
  });

  it("the SMTP sender refuses anything but email, before it connects anywhere", async () => {
    const smtpOnly = new SmtpEmailTransport(config);
    await expect(
      smtpOnly.send({ channel: "sms", to: "+447700900123", body: "Hi" }),
    ).rejects.toThrow("the SMTP sender carries email only");
  });
});

describe("the errors", () => {
  it("say what failed and never hold an address or the server's words", () => {
    const notSent = new EmailNotSentError("envelope", "EENVELOPE", 550);
    expect(notSent.name).toBe("EmailNotSentError");
    expect(notSent.message).toBe("email not sent: failed at envelope (EENVELOPE)");
    const mayHave = new EmailMayHaveArrivedError("ETIMEDOUT");
    expect(mayHave.name).toBe("EmailMayHaveArrivedError");
    expect(mayHave.message).toBe("email may have arrived: failed during or after DATA (ETIMEDOUT)");
    expect(`${notSent.message}${mayHave.message}`).not.toContain("@");
  });
});

describe("the settings (worker only)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-made-up-session-secret-0123456789abcd",
    APP_BASE_DOMAIN: "localhost:3000",
    NODE_ENV: "development",
  };
  const smtp = {
    EMAIL_TRANSPORT: "smtp",
    SMTP_HOST: "smtp.mail.example",
    SMTP_FROM: "shifts@acme.example",
  };
  const refusal = (source: Record<string, string>) => {
    try {
      parseWorkerEnv({ ...base, ...source });
      return "accepted";
    } catch (err) {
      return String((err as Error).message);
    }
  };

  it("console by default, port 587 by default, an empty value means not set", () => {
    const env = parseWorkerEnv({
      ...base,
      EMAIL_TRANSPORT: "",
      SMTP_PORT: "",
      SMTP_USER: "",
      SMTP_PASS: "",
    });
    expect([env.EMAIL_TRANSPORT, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASS]).toEqual([
      "console",
      587,
      undefined,
      undefined,
    ]);
    expect(parseWorkerEnv({ ...base, ...smtp, SMTP_PORT: "465" }).SMTP_PORT).toBe(465);
  });

  it("smtp without a host or a sender is refused", () => {
    expect(refusal({ EMAIL_TRANSPORT: "smtp" })).toMatch(/needs SMTP_HOST and SMTP_FROM/);
    expect(refusal({ ...smtp, SMTP_HOST: "" })).toMatch(/needs SMTP_HOST and SMTP_FROM/);
    expect(refusal({ ...smtp, SMTP_FROM: "" })).toMatch(/needs SMTP_HOST and SMTP_FROM/);
    expect(refusal(smtp)).toBe("accepted");
  });

  it("console is refused in production; smtp is refused under NODE_ENV=test", () => {
    expect(refusal({ NODE_ENV: "production", EMAIL_TRANSPORT: "console" })).toMatch(
      /console email is not allowed when NODE_ENV=production/,
    );
    expect(refusal({ NODE_ENV: "production" })).toMatch(/console email is not allowed/);
    expect(refusal({ ...smtp, NODE_ENV: "test" })).toMatch(/smtp is refused when NODE_ENV=test/);
  });

  it("a login is a user and a password together; the port and host are checked", () => {
    expect(refusal({ ...smtp, SMTP_USER: "shiftdesk" })).toMatch(/go together/);
    expect(refusal({ ...smtp, SMTP_PASS: "x" })).toMatch(/go together/);
    expect(refusal({ ...smtp, SMTP_USER: "shiftdesk", SMTP_PASS: "x" })).toBe("accepted");
    expect(refusal({ ...smtp, SMTP_PORT: "0" })).not.toBe("accepted");
    expect(refusal({ ...smtp, SMTP_PORT: "70000" })).not.toBe("accepted");
    expect(refusal({ ...smtp, SMTP_HOST: "smtp.mail.example:587" })).not.toBe("accepted");
    expect(refusal({ ...smtp, SMTP_FROM: "not an address" })).not.toBe("accepted");
  });

  it("the tests themselves run with console email and no password (tests/setup/env.ts)", () => {
    expect(process.env.EMAIL_TRANSPORT).toBe("console");
    expect(process.env.SMTP_PASS).toBe("");
  });
});

describe("the boundary", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it("only src/lib/messaging/smtp.ts imports nodemailer (the web app sends no email)", () => {
    const importers = files(join(process.cwd(), "src"))
      .filter((path) =>
        /from "nodemailer(\/[^"]*)?"|require\("nodemailer/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(process.cwd(), path));
    expect(importers).toEqual(["src/lib/messaging/smtp.ts"]);
  });
});
