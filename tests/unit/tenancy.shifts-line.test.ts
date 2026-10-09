import { describe, expect, it } from "vitest";
import { lineWords, shiftsLineText } from "@/lib/tenancy/shifts-line";

// The shifts line in words (src/lib/tenancy/shifts-line.ts), for the office dashboard.

describe("the shifts line in words", () => {
  it("a UK number spaced as people write it; others as stored", () => {
    expect(lineWords("+447700900000")).toBe("+44 7700 900000");
    expect(lineWords("+15555550123")).toBe("+15555550123"); // a fictional US number
  });

  it("the dashboard's line, with a number or without one", () => {
    expect(shiftsLineText("+447700900000")).toBe(
      "Your shifts line: +44 7700 900000 (WhatsApp, text and calls).",
    );
    expect(shiftsLineText(null)).toBe("No shifts line yet.");
  });
});
