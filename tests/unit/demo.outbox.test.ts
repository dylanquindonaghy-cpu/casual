import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOutbox, readOutboxTail } from "@/lib/demo/outbox";
import { getTransport } from "@/lib/messaging";

// The outbox the Demo phone reads (16.1; ADR-025): written by the console transport, read back
// line by line, anything that isn't a message skipped.

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe("reading the outbox", () => {
  it("reads texts and emails, attachments by name only", () => {
    const text = [
      line({ at: "2026-10-20T09:00:00.000Z", channel: "sms", to: "+447700900122", body: "a" }),
      line({
        at: "2026-10-20T09:01:00.000Z",
        channel: "email",
        to: "acme.payroll@example.com",
        subject: "Pay queries",
        body: "b",
        attachments: [{ filename: "queries.csv", contentType: "text/csv", content: "eA==" }],
      }),
    ].join("\n");
    const messages = parseOutbox(text);
    expect(messages).toEqual([
      {
        at: new Date("2026-10-20T09:00:00.000Z"),
        channel: "sms",
        to: "+447700900122",
        body: "a",
        attachments: [],
      },
      {
        at: new Date("2026-10-20T09:01:00.000Z"),
        channel: "email",
        to: "acme.payroll@example.com",
        subject: "Pay queries",
        body: "b",
        attachments: ["queries.csv"],
      },
    ]);
  });

  it("keeps the firm whose job sent it; a line with a firm that isn't an id is skipped", () => {
    const firmId = "5d1b4c1e-2f3a-4b5c-8d6e-7f8091a2b3c4";
    const text = [
      line({
        at: "2026-10-20T09:00:00.000Z",
        channel: "sms",
        to: "+447700900122",
        body: "a",
        firmId,
      }),
      line({ at: "2026-10-20T09:01:00.000Z", channel: "sms", to: "+447700900122", body: "b" }),
      line({
        at: "2026-10-20T09:02:00.000Z",
        channel: "sms",
        to: "+447700900122",
        body: "c",
        firmId: "acme",
      }),
    ].join("\n");
    expect(parseOutbox(text).map((m) => [m.body, m.firmId])).toEqual([
      ["a", firmId],
      ["b", undefined],
    ]);
  });

  it("skips what isn't a message: a cut-off line, junk, a wrong channel, no date", () => {
    const text = [
      '{"at":"2026-10-20T09:00:00.000Z","channel":"sms","to":"+44770',
      "not json",
      line({ at: "2026-10-20T09:00:00.000Z", channel: "fax", to: "x", body: "a" }),
      line({ channel: "sms", to: "+447700900122", body: "a" }),
      "",
      line({
        at: "2026-10-20T09:02:00.000Z",
        channel: "whatsapp",
        to: "+447700900122",
        body: "ok",
      }),
    ].join("\n");
    expect(parseOutbox(text).map((m) => m.body)).toEqual(["ok"]);
  });

  it("reads the file's end, from its first whole line; no file yet is no messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "demo-outbox-"));
    expect(await readOutboxTail(join(dir, "missing.jsonl"))).toBe("");
    const file = join(dir, "outbox.jsonl");
    const lines = Array.from({ length: 50 }, (_, i) =>
      line({ at: "2026-10-20T09:00:00.000Z", channel: "sms", to: "+447700900122", body: `m${i}` }),
    );
    await writeFile(file, `${lines.join("\n")}\n`);
    expect(parseOutbox(await readOutboxTail(file))).toHaveLength(50);
    const tail = await readOutboxTail(file, 500);
    expect(tail.startsWith("{")).toBe(true);
    const bodies = parseOutbox(tail).map((m) => m.body);
    expect(bodies.at(-1)).toBe("m49");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.length).toBeLessThan(50);
  });
});

describe("the console transport's outbox in production", () => {
  it("is written in demo mode (its Demo phone reads it), and still never without it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "demo-outbox-"));
    const file = join(dir, "outbox.jsonl");
    const without = getTransport({
      MESSAGING_TRANSPORT: "console",
      NODE_ENV: "production",
      CONSOLE_OUTBOX_FILE: file,
    });
    await without.send({ channel: "sms", to: "+447700900123", body: "not kept" });
    expect(await readOutboxTail(file)).toBe("");
    const demo = getTransport({
      MESSAGING_TRANSPORT: "console",
      NODE_ENV: "production",
      DEMO_MODE: "on",
      CONSOLE_OUTBOX_FILE: file,
    });
    await demo.send({ channel: "sms", to: "+447700900123", body: "kept" });
    expect(parseOutbox(await readOutboxTail(file)).map((m) => m.body)).toEqual(["kept"]);
  });
});
