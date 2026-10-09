import { describe, expect, it } from "vitest";
import { payImportLines } from "@/lib/office/pay-import-copy";

// "Import pay records" in plain words (src/lib/office/pay-import-copy.ts).

const result = (over: Partial<Parameters<typeof payImportLines>[0] & { status: "done" }> = {}) => ({
  status: "done" as const,
  result: {
    kind: "pay" as const,
    dryRun: true,
    created: 3,
    updated: 1,
    unchanged: 0,
    skipped: 1,
    problems: [{ row: 5, problem: "bad_money" as const }],
  },
  regrouped: 0,
  ...over,
});

describe("pay import words", () => {
  it("a checked file: what it would do, then each problem by row", () => {
    expect(payImportLines(result())).toEqual([
      "This file would add 3 pay lines, change 1, leave 0 as they are and skip 1.",
      "Row 5: an amount isn't money we can read (use 12.50).",
    ]);
  });

  it("an import: what it did, and queries that moved group", () => {
    const done = result({
      result: { ...result().result, dryRun: false, created: 1, problems: [] },
      regrouped: 2,
    });
    expect(payImportLines(done)).toEqual([
      "Imported: 1 pay line added, 1 changed, 0 left as they were, 1 skipped.",
      "2 waiting pay queries moved to the group that matches the new pay lines.",
    ]);
    expect(payImportLines({ ...done, regrouped: 1 })[1]).toBe(
      "1 waiting pay query moved to the group that matches the new pay lines.",
    );
  });

  it("files it can't take, and the rest", () => {
    expect(payImportLines({ status: "file_error", code: "missing_column" })).toEqual([
      "A column the import needs is missing. Check the header row.",
    ]);
    expect(payImportLines({ status: "too_big" })).toEqual([
      "The file is too big for the web (1 MB at most). Split it into smaller files.",
    ]);
    expect(payImportLines({ status: "not_allowed" })).toEqual(["You can't import pay records."]);
    // Gate B on the live server (src/lib/imports/gate-b.ts).
    expect(payImportLines({ status: "agreement_needed" })).toEqual([
      "Nothing was saved: real staff data can be imported once your firm's agreement and data processing agreement with us are signed and recorded. Ask us to record them. You can still check a file.",
    ]);
    expect(payImportLines({ status: "logged_out" })).toEqual([
      "Your session has ended. Log in again.",
    ]);
    expect(payImportLines({ status: "error" })).toEqual(["Something went wrong. Try again."]);
  });
});
