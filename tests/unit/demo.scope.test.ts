import { describe, expect, it, vi } from "vitest";
import { seedId } from "@/lib/demo/seed-id";
import { onlyDemoFirms } from "@/lib/demo/scope";
import { madeUpPeopleOnly, NotMadeUpRecipient, getTransport } from "@/lib/messaging";
import type { MessagingTransport } from "@/lib/messaging";
import { LOOK_ALIKE_EMAILS } from "../helpers/look-alike-emails";

// In demo mode the app knows the made-up demo firms alone (16.1; ADR-025): the look-ups that turn
// a request into a firm find no other (src/lib/demo/scope.ts; the real ones:
// tests/integration/demo.scope.test.ts). And it prints messages for made-up people only.

const ACME = seedId("firm/acme");
const REAL = "0f3c2b8e-9a41-4d7e-8b2a-5c6d7e8f9a0b";
const entry = (id: string) => ({ id, slug: "x", name: "X" });

describe("a look-up in demo mode", () => {
  const lookUp = (found: { id: string } | null, mode: string | undefined) =>
    onlyDemoFirms(
      async (slug: string) => (slug === "acme" ? found : null),
      (f) => f.id,
      () => mode,
    )("acme");

  it("finds a demo firm; any other firm is not found", async () => {
    expect(await lookUp(entry(ACME), "on")).toEqual(entry(ACME));
    expect(await lookUp(entry(REAL), "on")).toBeNull();
    expect(await lookUp(null, "on")).toBeNull();
  });

  it("without demo mode, finds every firm as before", async () => {
    expect(await lookUp(entry(REAL), undefined)).toEqual(entry(REAL));
    expect(await lookUp(entry(ACME), undefined)).toEqual(entry(ACME));
  });

  it("a planner key: by the firm it belongs to", async () => {
    const keys = (firmId: string) =>
      onlyDemoFirms(
        async (hash: Buffer) => (hash.length > 0 ? { firmId, keyId: "k1" } : null),
        (k) => k.firmId,
        () => "on",
      )(Buffer.from("x"));
    expect(await keys(ACME)).toEqual({ firmId: ACME, keyId: "k1" });
    expect(await keys(REAL)).toBeNull();
  });
});

describe("messages in demo mode", () => {
  const sent = vi.fn();
  const inner: MessagingTransport = {
    name: "console",
    send: async (message) => {
      sent(message.to);
      return { providerMessageId: "m1" };
    },
  };
  const demo = madeUpPeopleOnly(inner);

  it("go to made-up people: a drama-range number, an example.com address", async () => {
    await demo.send({ channel: "sms", to: "+447700900150", body: "a" });
    await demo.send({ channel: "whatsapp", to: "+447700900151", body: "b" });
    await demo.send({ channel: "email", to: "acme.payroll@example.com", subject: "s", body: "c" });
    expect(sent.mock.calls).toEqual([
      ["+447700900150"],
      ["+447700900151"],
      ["acme.payroll@example.com"],
    ]);
  });

  it("to anyone else are refused, unprinted, without saying who they were for", async () => {
    sent.mockClear();
    const refusal = demo.send({ channel: "sms", to: "+441134960123", body: "a" });
    await expect(refusal).rejects.toBeInstanceOf(NotMadeUpRecipient);
    await expect(refusal).rejects.toThrow(/a sms to someone else refused/);
    await expect(
      demo.send({ channel: "email", to: LOOK_ALIKE_EMAILS.work, subject: "s", body: "b" }),
    ).rejects.toThrow(NotMadeUpRecipient);
    const said = await demo
      .send({ channel: "email", to: LOOK_ALIKE_EMAILS.work, subject: "s", body: "b" })
      .catch((err: unknown) => String(err));
    expect(said).not.toContain(LOOK_ALIKE_EMAILS.work);
    expect(sent).not.toHaveBeenCalled();
  });

  it("getTransport refuses them only in demo mode", async () => {
    const print = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const base = { MESSAGING_TRANSPORT: "console" as const, NODE_ENV: "test" as const };
      await expect(
        getTransport({ ...base, DEMO_MODE: "on" }).send({
          channel: "sms",
          to: "+441134960123",
          body: "a",
        }),
      ).rejects.toThrow(NotMadeUpRecipient);
      await expect(
        getTransport(base).send({ channel: "sms", to: "+441134960123", body: "a" }),
      ).resolves.toHaveProperty("providerMessageId");
    } finally {
      print.mockRestore();
    }
  });
});
