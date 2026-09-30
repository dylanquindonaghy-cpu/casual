import { describe, expect, it } from "vitest";
import { scanLogText, scanReport } from "../../scripts/logs-scan";
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
      "web.log: 1 possible phone numbers or emails:\n  line 2: phone +4*********23",
    );
    expect(report).not.toContain("447700900123");
    expect(scanReport("worker.log", [])).toBe("worker.log: no phone numbers or email addresses.");
  });
});
