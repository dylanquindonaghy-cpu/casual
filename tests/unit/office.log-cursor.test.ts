import { describe, expect, it } from "vitest";
import { decodeLogCursor, encodeLogCursor } from "@/lib/office/log-cursor";

// The action log's "Older" cursor (audit L44): the event id, encrypted and bound to the firm.

const SECRET = "s".repeat(32);
const FIRM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("the action log's cursor", () => {
  it("reads back as the event id, for the same firm and secret", () => {
    for (const id of [1, 999_998, 1_000_003, Number.MAX_SAFE_INTEGER]) {
      const cursor = encodeLogCursor(id, FIRM, SECRET);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]{48}$/);
      expect(decodeLogCursor(cursor, FIRM, SECRET)).toBe(id);
    }
    // The number itself never shows (a long one can't turn up in random letters by chance).
    expect(encodeLogCursor(1_000_003_456, FIRM, SECRET)).not.toContain("1000003456");
  });

  it("the same id twice gives two different cursors (nothing to compare)", () => {
    expect(encodeLogCursor(42, FIRM, SECRET)).not.toBe(encodeLogCursor(42, FIRM, SECRET));
  });

  it("another firm's, another secret's, an altered one, or anything else: null", () => {
    const cursor = encodeLogCursor(42, FIRM, SECRET);
    expect(decodeLogCursor(cursor, OTHER, SECRET)).toBeNull();
    expect(decodeLogCursor(cursor, FIRM, "t".repeat(32))).toBeNull();
    for (let i = 0; i < cursor.length; i++) {
      const altered = cursor.slice(0, i) + (cursor[i] === "A" ? "B" : "A") + cursor.slice(i + 1);
      expect(decodeLogCursor(altered, FIRM, SECRET), `changed at ${i}`).toBeNull();
    }
    for (const junk of ["", "42", "1000003", "x".repeat(48), `${cursor}A`, cursor.slice(1)]) {
      expect(decodeLogCursor(junk, FIRM, SECRET), junk).toBeNull();
    }
  });
});
