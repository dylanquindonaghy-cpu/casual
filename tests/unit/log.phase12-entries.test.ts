import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { DETAIL_FIELDS } from "@/lib/office/shift-editor";

// Phase 12's new log entries pass the same check recordEvent() uses (it refuses anything the log
// masker would change; docs/office-v2.md 6.1). Added to as each task adds entries.

describe("shift.changed for a session's details (12B.1)", () => {
  const names = Object.values(DETAIL_FIELDS);

  it("passes the log check for every new field, one at a time and together", () => {
    for (const field of names) {
      expect(passesLogCheck({ by: "firm", fields: [field] })).toBe(true);
    }
    expect(passesLogCheck({ by: "firm", fields: names })).toBe(true);
    // With the editor's own fields alongside, as one entry can hold both.
    expect(passesLogCheck({ by: "firm", fields: ["role", "instructions", ...names] })).toBe(true);
  });

  it('names the requirements "requirements": never a name holding "credential"', () => {
    expect(names).toContain("requirements");
    for (const field of names) expect(field.toLowerCase()).not.toContain("credential");
  });

  it("would be refused with the column's own name as a key (why the editor maps names)", () => {
    expect(passesLogCheck({ by: "firm", requiredCredentials: ["FIRST_AID"] })).toBe(false);
  });
});
