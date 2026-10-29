import { describe, expect, it } from "vitest";
import { getTransport, noTextSender } from "@/lib/messaging";
import { NoTextSenderError } from "@/lib/messaging/transport";

// MESSAGING_TRANSPORT=none (P2.5): no text sender at all, so the worker can run in production
// before the firm's text system is connected. Every WhatsApp or text is refused before anything is
// tried (NoTextSenderError: src/lib/notify/send.ts moves on to email); email still goes.

describe("no text sender (MESSAGING_TRANSPORT=none)", () => {
  it("refuses every WhatsApp and text, saying there's no sender (nothing was tried)", async () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      await expect(
        noTextSender.send({ channel, to: "+447700900123", body: "Hello" }),
      ).rejects.toBeInstanceOf(NoTextSenderError);
    }
  });

  it("is what getTransport gives for WhatsApp and texts; email still prints on console", async () => {
    const transport = getTransport({ MESSAGING_TRANSPORT: "none", NODE_ENV: "development" });
    await expect(
      transport.send({ channel: "whatsapp", to: "+447700900123", body: "Hello" }),
    ).rejects.toBeInstanceOf(NoTextSenderError);
    const sent = await transport.send({
      channel: "email",
      to: "rae@example.test",
      subject: "Shift available",
      body: "Hello",
    });
    expect(sent.providerMessageId).toMatch(/^console-/);
  });

  it("with SMTP, email goes to the email provider and texts still have no sender", () => {
    expect(
      getTransport({
        MESSAGING_TRANSPORT: "none",
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "smtp",
        SMTP_HOST: "smtp.example.test",
        SMTP_FROM: "shifts@example.test",
      }).name,
    ).toBe("none+smtp");
  });
});
