import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTransport } from "@/lib/messaging";
import { createConsoleTransport } from "@/lib/messaging/console";

describe("console messaging transport", () => {
  it("prints the outbound message and returns a provider id", async () => {
    const lines: string[] = [];
    const transport = createConsoleTransport((line) => lines.push(line));

    const result = await transport.send({
      channel: "whatsapp",
      to: "+447700900123",
      body: "Acme Events Shift Team: your shift is confirmed.",
    });

    expect(result.providerMessageId).toMatch(/^console-[0-9a-f-]{36}$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("whatsapp to +44*******123");
    expect(lines[0]).not.toContain("7700900");
    expect(lines[0]).toContain(result.providerMessageId);
    expect(lines[0]).toContain("Acme Events Shift Team: your shift is confirmed.");
  });

  it("rejects a phone number that is not E.164", async () => {
    const lines: string[] = [];
    const transport = createConsoleTransport((line) => lines.push(line));
    await expect(transport.send({ channel: "sms", to: "07700900123", body: "hi" })).rejects.toThrow(
      /E\.164/,
    );
    expect(lines).toHaveLength(0);
  });

  it("prints an email with its subject, masking the address", async () => {
    const lines: string[] = [];
    const transport = createConsoleTransport((line) => lines.push(line));
    await transport.send({
      channel: "email",
      to: "jo.bloggs@example.com",
      subject: "Your Acme Events office login link",
      body: "Here's your link.",
    });
    expect(lines[0]).toContain("email to ***@example.com");
    expect(lines[0]).toContain("Subject: Your Acme Events office login link");
    expect(lines[0]).not.toContain("jo.bloggs");
  });

  it("refuses an email message to something that isn't an address", async () => {
    const transport = createConsoleTransport(() => undefined);
    await expect(
      transport.send({ channel: "email", to: "not-an-email", subject: "x", body: "x" }),
    ).rejects.toThrow();
  });

  it("is what getTransport returns for MESSAGING_TRANSPORT=console", () => {
    expect(getTransport({ MESSAGING_TRANSPORT: "console", NODE_ENV: "development" }).name).toBe(
      "console",
    );
  });

  it("appends each message to the dev outbox file when one is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outbox-"));
    const file = join(dir, "outbox.jsonl");
    const transport = createConsoleTransport(() => undefined, file);
    const { providerMessageId } = await transport.send({
      channel: "whatsapp",
      to: "+447700900123",
      body: "hi",
    });
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      providerMessageId,
      to: "+447700900123",
      body: "hi",
    });
  });

  it("never writes an outbox file in production", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outbox-"));
    const file = join(dir, "outbox.jsonl");
    const transport = getTransport({
      MESSAGING_TRANSPORT: "console",
      NODE_ENV: "production",
      CONSOLE_OUTBOX_FILE: file,
    });
    await transport.send({ channel: "whatsapp", to: "+447700900123", body: "hi" });
    await expect(readFile(file, "utf8")).rejects.toThrow(/ENOENT/);
  });
});
