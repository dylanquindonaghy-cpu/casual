import { describe, expect, it } from "vitest";
import {
  csvCell,
  INITIATOR_WORDS,
  KIND_WORDS,
  shortNoticeThreshold,
} from "@/lib/office/notice-report";

// The notice report's pieces that need no database (src/lib/office/notice-report.ts).

describe("the notice report", () => {
  it("CSV cells: quoted when needed, and never run as a spreadsheet formula", () => {
    expect(csvCell("Ann Booker")).toBe("Ann Booker");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    for (const risky of ["=1+1", "+44", "-x", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"]) {
      expect(csvCell(risky).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    // A plain number can't be a formula: a negative notice stays a number.
    expect(csvCell("-2.50")).toBe("-2.50");
    expect(csvCell(-2)).toBe("-2");
  });

  it("the firm's threshold: a number of hours from 1 to 720, or the 48-hour placeholder", () => {
    expect(shortNoticeThreshold({})).toEqual({ hours: 48, source: "default" });
    expect(shortNoticeThreshold({ short_notice_threshold_hours: 24 })).toEqual({
      hours: 24,
      source: "setting",
    });
    expect(shortNoticeThreshold({ short_notice_threshold_hours: 720 })).toMatchObject({
      source: "setting",
    });
    for (const bad of [0, 721, -5, "48", null]) {
      expect(shortNoticeThreshold({ short_notice_threshold_hours: bad })).toEqual({
        hours: 48,
        source: "invalid",
      });
    }
  });

  it("plain words for what happened and who started it", () => {
    expect(Object.values(KIND_WORDS)).toEqual([
      "Offered",
      "Booked",
      "Moved",
      "Shortened",
      "Cancelled",
    ]);
    expect(INITIATOR_WORDS).toEqual({
      worker: "The worker",
      office: "The office",
      rota_sheet: "The rota sheet",
      offer_wave: "An offer wave",
      firm: "The firm",
    });
  });
});
