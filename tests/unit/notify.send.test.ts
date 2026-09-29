import { describe, expect, it } from "vitest";
import { ChannelRefusedError, type MessagingTransport } from "@/lib/messaging/transport";
import { sendToWorker } from "@/lib/notify/send";

// The shared message sender (src/lib/notify/send.ts), used by offer waves and shift reminders:
// the worker's channel, a refused WhatsApp goes by text, any other failure is reported, never
// sent again another way.

function transport(behaviour: {
  whatsapp?: "ok" | "refused" | "fails";
  sms?: "ok" | "refused" | "fails";
}) {
  const tried: string[] = [];
  const t: MessagingTransport = {
    name: "fake",
    async send(message) {
      tried.push(message.channel);
      const how = message.channel === "sms" ? behaviour.sms : behaviour.whatsapp;
      if (how === "refused") throw new ChannelRefusedError(message.channel);
      if (how === "fails") throw new TypeError("timed out");
      return { providerMessageId: `id-${message.channel}` };
    },
  };
  return { t, tried };
}

const input = { mobile: "+447700900123", body: { whatsapp: "Hello", sms: "Hi" } };

describe("sendToWorker", () => {
  it("by WhatsApp when that's the channel", async () => {
    const { t, tried } = transport({ whatsapp: "ok" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "whatsapp" })).toEqual({
      ok: true,
      channel: "whatsapp",
      providerMessageId: "id-whatsapp",
    });
    expect(tried).toEqual(["whatsapp"]);
  });

  it("by text when that's the channel (never WhatsApp)", async () => {
    const { t, tried } = transport({ whatsapp: "ok", sms: "ok" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "sms" })).toEqual({
      ok: true,
      channel: "sms",
      providerMessageId: "id-sms",
    });
    expect(tried).toEqual(["sms"]);
  });

  it("a refused WhatsApp goes by text at once, and says so", async () => {
    const { t, tried } = transport({ whatsapp: "refused", sms: "ok" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "whatsapp" })).toEqual({
      ok: true,
      channel: "sms",
      providerMessageId: "id-sms",
      fellBackFrom: "whatsapp",
    });
    expect(tried).toEqual(["whatsapp", "sms"]);
  });

  it("any other WhatsApp failure is reported, not sent again by text", async () => {
    const { t, tried } = transport({ whatsapp: "fails", sms: "ok" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "whatsapp" })).toEqual({
      ok: false,
      channel: "whatsapp",
      code: "TypeError",
    });
    expect(tried).toEqual(["whatsapp"]);
  });

  it("refused WhatsApp and a failed text: reported against the text", async () => {
    const { t } = transport({ whatsapp: "refused", sms: "fails" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "whatsapp" })).toEqual({
      ok: false,
      channel: "sms",
      code: "TypeError",
    });
  });

  it("a refused text has nowhere else to go: reported", async () => {
    const { t, tried } = transport({ sms: "refused" });
    expect(await sendToWorker({ transport: t }, { ...input, channel: "sms" })).toEqual({
      ok: false,
      channel: "sms",
      code: "ChannelRefusedError",
    });
    expect(tried).toEqual(["sms"]);
  });

  it("each channel gets its own text: a text message the SMS version, the fallback too", async () => {
    const bodies: string[] = [];
    const t: MessagingTransport = {
      name: "fake",
      async send(message) {
        if (message.channel !== "email") bodies.push(`${message.channel}:${message.body}`);
        if (message.channel === "whatsapp") throw new ChannelRefusedError("whatsapp");
        return { providerMessageId: "id" };
      },
    };
    await sendToWorker({ transport: t }, { ...input, channel: "sms" });
    await sendToWorker({ transport: t }, { ...input, channel: "whatsapp" });
    expect(bodies).toEqual(["sms:Hi", "whatsapp:Hello", "sms:Hi"]);
  });
});
