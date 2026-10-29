import { describe, expect, it } from "vitest";
import {
  ChannelRefusedError,
  NoTextSenderError,
  type MessagingTransport,
} from "@/lib/messaging/transport";
import {
  deliverToWorker,
  NO_CHANNEL,
  NO_TEXT_SENDER,
  emailMessageId,
  sendTextOrEmail,
  sendToWorker,
  type InFirm,
} from "@/lib/notify/send";
import type { PushTarget } from "@/lib/push/subscriptions";
import type { PushSendResult, PushTransport } from "@/lib/push/transport";

// The shared message sender (src/lib/notify/send.ts), used by every sender that messages a casual:
// the worker's channel, a refused WhatsApp goes by text, any other failure is reported, never
// sent again another way; never a text to a worker who replied STOP. Since P2.4 deliverToWorker()
// puts a push first and an email last (docs/messaging-templates.md "How a message reaches a
// casual").

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

// No shifts line (a firm without its own number yet): no `from` on the message. Texts allowed
// (they haven't replied STOP) unless a test says otherwise.
const input = {
  mobile: "+447700900123",
  body: { whatsapp: "Hello", sms: "Hi" },
  from: null,
  smsAllowed: true,
};

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

  it("replied STOP and chose texts: WhatsApp instead, and says so", async () => {
    const { t, tried } = transport({ whatsapp: "ok", sms: "ok" });
    expect(
      await sendToWorker({ transport: t }, { ...input, channel: "sms", smsAllowed: false }),
    ).toEqual({
      ok: true,
      channel: "whatsapp",
      providerMessageId: "id-whatsapp",
      fellBackFrom: "sms",
    });
    expect(tried).toEqual(["whatsapp"]);
  });

  it("replied STOP: a refused WhatsApp is never sent as a text (reported as opted out)", async () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { t, tried } = transport({ whatsapp: "refused", sms: "ok" });
      expect(
        await sendToWorker({ transport: t }, { ...input, channel, smsAllowed: false }),
      ).toEqual({ ok: false, channel: "whatsapp", code: "sms_opted_out" });
      expect(tried).toEqual(["whatsapp"]);
    }
  });

  it("replied STOP: a WhatsApp that goes is just a WhatsApp", async () => {
    const { t, tried } = transport({ whatsapp: "ok", sms: "ok" });
    expect(
      await sendToWorker({ transport: t }, { ...input, channel: "whatsapp", smsAllowed: false }),
    ).toEqual({ ok: true, channel: "whatsapp", providerMessageId: "id-whatsapp" });
    expect(tried).toEqual(["whatsapp"]);
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

  it("from the firm's shifts line when it has one, the fallback too; without one, no `from`", async () => {
    const froms: (string | undefined)[] = [];
    const t: MessagingTransport = {
      name: "fake",
      async send(message) {
        if (message.channel !== "email") froms.push(message.from);
        if (message.channel === "whatsapp") throw new ChannelRefusedError("whatsapp");
        return { providerMessageId: "id" };
      },
    };
    await sendToWorker({ transport: t }, { ...input, channel: "whatsapp", from: "+447700900000" });
    await sendToWorker({ transport: t }, { ...input, channel: "sms" });
    expect(froms).toEqual(["+447700900000", "+447700900000", undefined]);
  });
});

// The phones a worker turned notifications on for, as pushToWorker reads them (in a transaction of
// its own: here a stand-in that hands back the phones, or throws as a failed read would).
const phones = (targets: PushTarget[] | Error): InFirm =>
  (async () => {
    if (targets instanceof Error) throw targets;
    return targets;
  }) as unknown as InFirm;
const phone = (n: number): PushTarget => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  endpoint: `https://push.example.test/${n}`,
  p256dh: "k",
  auth: "a",
});

// Everything tried, in order ("push:<n>", "whatsapp", "sms", "email:<to>"), with how each phone
// and channel behaves.
function everyWay(o: {
  push?: (PushSendResult["status"] | "throws")[];
  whatsapp?: "ok" | "refused" | "fails" | "none";
  sms?: "ok" | "refused" | "fails" | "none";
  email?: "ok" | "fails";
}) {
  const tried: string[] = [];
  const emails: { to: string; subject?: string; body: string }[] = [];
  const transport: MessagingTransport = {
    name: "fake",
    async send(message) {
      if (message.channel === "email") {
        tried.push(`email:${message.to}`);
        emails.push({ to: message.to, subject: message.subject, body: message.body });
        if (o.email === "fails") throw new TypeError("timed out");
        return { providerMessageId: "id-email" };
      }
      tried.push(message.channel);
      const how = message.channel === "sms" ? (o.sms ?? "ok") : (o.whatsapp ?? "ok");
      if (how === "none") throw new NoTextSenderError(message.channel);
      if (how === "refused") throw new ChannelRefusedError(message.channel);
      if (how === "fails") throw new TypeError("timed out");
      return { providerMessageId: `id-${message.channel}` };
    },
  };
  let n = 0;
  const push: PushTransport = {
    name: "fake",
    async send(target) {
      tried.push(`push:${target.endpoint.slice(-1)}`);
      const how = o.push?.[n++] ?? "sent";
      if (how === "throws") throw new TypeError("socket hang up");
      return how === "failed" ? { status: "failed", code: "timeout" } : { status: how };
    },
  };
  return { transport, push, tried, emails };
}

const delivery = {
  workerId: "11111111-1111-4111-8111-111111111111",
  push: { title: "Shift available", body: "Sat 7 Nov 14:00.", url: "/shifts/1" },
  text: { ...input, channel: "whatsapp" as const },
  email: {
    to: "rae@example.test",
    subject: "Shift available: Sat 7 Nov 14:00–22:00",
    body: "Hello",
  },
};
const noTextSender = { whatsapp: "none", sms: "none" } as const;

describe("deliverToWorker: a push, else a WhatsApp or text, else an email (P2.4)", () => {
  it("a phone takes the push: that's the message, and nothing else goes", async () => {
    const w = everyWay({});
    expect(await deliverToWorker(phones([phone(1)]), w, delivery)).toEqual({
      ok: true,
      channel: "push",
      providerMessageId: null,
      push: { pushes: 1, forget: [], failed: [] },
    });
    expect(w.tried).toEqual(["push:1"]);
  });

  it("one of two phones takes it: still only the push", async () => {
    const w = everyWay({ push: ["failed", "sent"] });
    expect(await deliverToWorker(phones([phone(1), phone(2)]), w, delivery)).toMatchObject({
      ok: true,
      channel: "push",
    });
    expect(w.tried).toEqual(["push:1", "push:2"]);
  });

  it("no phones: by their channel, as before", async () => {
    const w = everyWay({});
    expect(await deliverToWorker(phones([]), w, delivery)).toEqual({
      ok: true,
      channel: "whatsapp",
      providerMessageId: "id-whatsapp",
      push: { pushes: 0, forget: [], failed: [] },
    });
    expect(w.tried).toEqual(["whatsapp"]);
  });

  it("a phone that's gone, refused, failed, skipped or threw: the WhatsApp or text goes, and the outcome keeps the phones to forget", async () => {
    const w = everyWay({ push: ["gone", "refused", "failed", "skipped", "throws"] });
    const sent = await deliverToWorker(
      phones([phone(1), phone(2), phone(3), phone(4), phone(5)]),
      w,
      { ...delivery, text: { ...delivery.text, channel: "sms" } },
    );
    expect(sent).toMatchObject({ ok: true, channel: "sms", providerMessageId: "id-sms" });
    expect(sent.push.pushes).toBe(0);
    expect(sent.push.forget).toEqual([
      { target: phone(1), reason: "gone" },
      { target: phone(2), reason: "not_a_push_service" },
    ]);
    expect(sent.push.failed).toHaveLength(2);
    expect(w.tried).toEqual(["push:1", "push:2", "push:3", "push:4", "push:5", "sms"]);
  });

  it("phones that can't be read: nothing pushed, the WhatsApp goes", async () => {
    const w = everyWay({});
    const sent = await deliverToWorker(phones(new TypeError("connection lost")), w, delivery);
    expect(sent).toMatchObject({
      ok: true,
      channel: "whatsapp",
      push: { readFailed: "TypeError" },
    });
    expect(w.tried).toEqual(["whatsapp"]);
  });

  it("no text sender at all: by email, with the subject and the message's own words", async () => {
    const w = everyWay(noTextSender);
    expect(await deliverToWorker(phones([]), w, delivery)).toEqual({
      ok: true,
      channel: "email",
      providerMessageId: "id-email",
      push: { pushes: 0, forget: [], failed: [] },
    });
    expect(w.tried).toEqual(["whatsapp", "email:rae@example.test"]);
    expect(w.emails).toEqual([
      { to: "rae@example.test", subject: "Shift available: Sat 7 Nov 14:00–22:00", body: "Hello" },
    ]);
  });

  it("no text sender and no address for them: not sent, `no_channel`", async () => {
    const w = everyWay(noTextSender);
    expect(await deliverToWorker(phones([]), w, { ...delivery, email: null })).toEqual({
      ok: false,
      channel: null,
      code: NO_CHANNEL,
      push: { pushes: 0, forget: [], failed: [] },
    });
    expect(w.tried).toEqual(["whatsapp"]);
  });

  it("a WhatsApp or text that fails, or might have arrived, is never emailed as well", async () => {
    for (const o of [{ whatsapp: "fails" }, { whatsapp: "refused", sms: "fails" }] as const) {
      const w = everyWay(o);
      const sent = await deliverToWorker(phones([]), w, delivery);
      expect(sent.ok, JSON.stringify(o)).toBe(false);
      expect(
        w.tried.some((t) => t.startsWith("email:")),
        JSON.stringify(o),
      ).toBe(false);
    }
  });

  it("a WhatsApp refused (not on WhatsApp) and no text sender: nothing arrived, so by email", async () => {
    const w = everyWay({ whatsapp: "refused", sms: "none" });
    expect(await deliverToWorker(phones([]), w, delivery)).toMatchObject({
      ok: true,
      channel: "email",
    });
    expect(w.tried).toEqual(["whatsapp", "sms", "email:rae@example.test"]);
  });

  it("replied STOP and the WhatsApp refused: not a text, and not an email either", async () => {
    const w = everyWay({ whatsapp: "refused" });
    expect(
      await deliverToWorker(phones([]), w, {
        ...delivery,
        text: { ...delivery.text, smsAllowed: false },
      }),
    ).toMatchObject({ ok: false, channel: "whatsapp", code: "sms_opted_out" });
    expect(w.tried).toEqual(["whatsapp"]);
  });

  it("an email that fails: reported against the email", async () => {
    const w = everyWay({ ...noTextSender, email: "fails" });
    expect(await deliverToWorker(phones([]), w, delivery)).toMatchObject({
      ok: false,
      channel: "email",
      code: "TypeError",
    });
  });
});

describe("sendTextOrEmail: a message with no push words (the licence messages)", () => {
  it("no push is tried: a WhatsApp or text, else an email, else `no_channel`", async () => {
    const w = everyWay({});
    expect(await sendTextOrEmail(w, delivery)).toEqual({
      ok: true,
      channel: "whatsapp",
      providerMessageId: "id-whatsapp",
    });
    const none = everyWay(noTextSender);
    expect(await sendTextOrEmail(none, delivery)).toEqual({
      ok: true,
      channel: "email",
      providerMessageId: "id-email",
    });
    expect(await sendTextOrEmail(none, { ...delivery, email: null })).toEqual({
      ok: false,
      channel: null,
      code: NO_CHANNEL,
    });
    expect([...w.tried, ...none.tried]).toEqual([
      "whatsapp",
      "whatsapp",
      "email:rae@example.test",
      "whatsapp",
    ]);
  });

  it("sendToWorker says when there's no text sender: nothing was tried, not a failed text", async () => {
    const w = everyWay(noTextSender);
    expect(await sendToWorker(w, delivery.text)).toEqual({
      ok: false,
      channel: "whatsapp",
      code: NO_TEXT_SENDER,
    });
  });
});

describe("emailMessageId: an email's id as the action log keeps it", () => {
  it("the Message-ID's part before the host: the log refuses anything after an @", () => {
    expect(emailMessageId("<31fa7821-b658-dcdf-fa69-f19d03fda925@example.test>")).toBe(
      "31fa7821-b658-dcdf-fa69-f19d03fda925",
    );
    expect(emailMessageId("console-5d0b")).toBe("console-5d0b");
  });

  it("none when that isn't a plain id", () => {
    expect(emailMessageId("<a b@example.test>")).toBeNull();
    expect(emailMessageId("@example.test")).toBeNull();
    expect(emailMessageId("x".repeat(101))).toBeNull();
  });

  it("deliverToWorker logs an email by that id", async () => {
    const w = everyWay(noTextSender);
    const smtp: MessagingTransport = {
      name: "smtp-like",
      async send(message) {
        if (message.channel === "email") return { providerMessageId: "<abc-1@mail.example.test>" };
        return w.transport.send(message);
      },
    };
    expect(
      await deliverToWorker(phones([]), { transport: smtp, push: w.push }, delivery),
    ).toMatchObject({ ok: true, channel: "email", providerMessageId: "abc-1" });
  });
});
