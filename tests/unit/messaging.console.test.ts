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

  it("is what getTransport returns for MESSAGING_TRANSPORT=console", () => {
    expect(getTransport({ MESSAGING_TRANSPORT: "console" }).name).toBe("console");
  });
});
