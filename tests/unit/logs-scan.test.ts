import { describe, expect, it } from "vitest";
import { scanLogText, scanReport, withoutConsoleMessages } from "../../scripts/logs-scan";
import { maskText } from "@/lib/log/mask";

// The log scan behind the pre-pilot "log masking verified" check (scripts/logs-scan.ts, run on every
// e2e run's server output by tests/e2e/teardown.ts): its own patterns, broader than the masker's.

describe("the log scan", () => {
  it("finds phone numbers however they're written, and email addresses", () => {
    const text = [
      '{"msg":"sent","to":"+447700900123"}',
      "reply to 07700 900123 failed",
      "from 0044-7700-900123",
      "call +1 415 555 0100",
      "owner ann.booker@example.com logged in",
    ].join("\n");
    expect(scanLogText(text).map((f) => [f.line, f.kind])).toEqual([
      [1, "phone"],
      [2, "phone"],
      [3, "phone"],
      [4, "phone"],
      [5, "email"],
    ]);
  });

  it("finds numbers and emails written the way URLs, forms and people write them", () => {
    const lines = [
      "GET /office/data?q=07700+900871 200 in 12ms",
      "GET /x?mobile=%2B447700900123",
      "to (07700) 900123",
      "to 07700\u00a0900123",
      "path /07700900123/edit",
      "q=ann.booker%40example.com",
    ];
    expect(lines.map((l) => scanLogText(l).map((f) => f.kind))).toEqual([
      ["phone"],
      ["phone"],
      ["phone"],
      ["phone"],
      ["phone"],
      ["email"],
    ]);
  });

  it("leaves decimals, IP addresses and Unix times alone", () => {
    const text = [
      "took 12.3456789012 s",
      "ECONNREFUSED 192.168.100.200:5432",
      "at 1759205473 (1759205473000 ms)",
    ].join("\n");
    expect(scanLogText(text)).toEqual([]);
  });

  it("leaves ids, times, versions and whatever the masker already masked", () => {
    const text = [
      '{"ts":"2026-09-30T04:11:13.123Z","requestId":"0f8fad5b-d9cb-469f-a165-70867728950e"}',
      "providerMessageId SMa1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7 queued",
      "hash 3fa85f6457174562b3fc2c963f66afa6fa85f6457174562b3fc2c963f66afa6",
      "pg-boss@12.35.0 started; GET /shifts/1234 200 in 120ms",
      maskText("to +447700900123 and 07700 900123, owner ann.booker@example.com"),
    ].join("\n");
    expect(scanLogText(text)).toEqual([]);
  });

  it("a firm's own shifts line may be allowed (a business number); any other number still counts", () => {
    const text = "whatsapp to +44*******157 from +447700900000\nfrom 07700 900000 to +447700900111";
    expect(scanLogText(text, { allowNumbers: ["+447700900000"] })).toEqual([
      { line: 2, kind: "phone", masked: "+4*********11" },
    ]);
  });

  it("reports where, never the value itself", () => {
    const report = scanReport("web.log", scanLogText("x\nto +447700900123"));
    expect(report).toBe(
      "web.log: 1 possible phone numbers, emails or login tokens:\n  line 2: phone +4*********23",
    );
    expect(report).not.toContain("447700900123");
    expect(scanReport("worker.log", [])).toBe(
      "worker.log: no phone numbers, email addresses or login tokens.",
    );
  });

  // Audit L52: the masker catches these, so the scan (meant to catch what gets past it) must too.
  it("finds numbers before a full stop, and glued to letters, '_' or '-'", () => {
    const lines = [
      "Invalid number: +447700900123.",
      "call 07700 900123.",
      "Mob07700900123",
      "wa_447700900123",
      "worker-07700900123",
      "p=447700900123.",
      "worker.07700900123 x",
    ];
    expect(lines.map((l) => scanLogText(l).map((f) => f.kind))).toEqual(lines.map(() => ["phone"]));
  });

  it("still leaves decimals and longer numbers alone", () => {
    const text = [
      "took 1.23456789012 s",
      "ratio 12345678901.5",
      "a run of 1234567890123456789 digits",
      "unix 1759205473.123",
    ].join("\n");
    expect(scanLogText(text)).toEqual([]);
  });

  // Audit L53: a working login link, or a session's cookie, in a log is someone's login.
  it("finds login tokens and session cookies, reported masked", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";
    const text = [
      `link https://acme.example/l#${token}`,
      `link https://acme.example/office/l#${token}.`,
      `cookie: __Host-sd_session=${token}`,
      `cookie: __Host-sd_office=${token}`,
      "link https://acme.example/l#short",
    ].join("\n");
    const found = scanLogText(text);
    expect(found.map((f) => [f.line, f.kind])).toEqual([
      [1, "token"],
      [2, "token"],
      [3, "token"],
      [4, "token"],
    ]);
    expect(scanReport("web.log", found)).not.toContain(token);
  });

  it("the console transport's own printed messages can be left out (line numbers kept)", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";
    const id = "console-0f8fad5b-d9cb-469f-a165-70867728950e";
    const log = [
      '{"ts":"2026-10-04T05:00:00.000Z","level":"info","msg":"started"}',
      `[messaging:console] whatsapp to +44*******123 from +447700900000 (${id})`,
      `Here's your link: https://acme.example/l#${token}`,
      "[messaging:console] end of message",
      `leaked https://acme.example/l#${token}`,
      `[messaging:console] email to ***@example.com (${id})`,
      `Your link: https://acme.example/office/l#${token}`,
      '{"ts":"2026-10-04T05:00:01.000Z","level":"info","msg":"next"}',
      "[messaging:console] made up (not the transport's)",
      `consumeLoginLinkAction("x") https://acme.example/l#${token}`,
      "[messaging:console] end of message",
    ].join("\n");
    expect(scanLogText(log).filter((f) => f.kind === "token")).toHaveLength(4);
    // Only a whole message is left out (its exact first line, then its end line). One with no end
    // line, or a line that only starts like one, is checked like the rest.
    expect(scanLogText(withoutConsoleMessages(log)).map((f) => [f.line, f.kind])).toEqual([
      [5, "token"],
      [7, "token"],
      [10, "token"],
    ]);
    expect(withoutConsoleMessages(log).split("\n")).toHaveLength(11);
  });

  it("finds numbers written with dots, doubled spaces or tabs, but not IP addresses or decimals", () => {
    const found = [
      "07700.900.123",
      "+44.7700.900123",
      "07700  900123",
      "07700 - 900 123",
      "07700\t900123",
    ];
    expect(found.map((l) => scanLogText(l).map((f) => f.kind))).toEqual(found.map(() => ["phone"]));
    const left = ["host 192.168.100.200:5432", "took 1234.5678901 ms", "value 12345678901.5"];
    expect(left.flatMap((l) => scanLogText(l))).toEqual([]);
  });

  it("finds glued emails each, and a %-encoded login link", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";
    expect(scanLogText("ann@example.com+bob.smith@example.org").map((f) => f.kind)).toEqual([
      "email",
      "email",
    ]);
    expect(scanLogText(`path a%2Fl%23${token}`).map((f) => f.kind)).toEqual(["token"]);
  });

  // The teardown runs the scan on whole log files: a long line must cost one pass.
  it("scans a 200,000-character line quickly, whatever it holds", () => {
    for (const unit of ["a.", "1-", "a", "@a.", "1 ", "07700 ", "a@b.", "/l#"]) {
      const line = unit.repeat(Math.ceil(200_000 / unit.length));
      const started = performance.now();
      scanLogText(line);
      expect(performance.now() - started, unit).toBeLessThan(750);
    }
  });
});
