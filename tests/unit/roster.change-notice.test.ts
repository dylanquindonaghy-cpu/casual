import { describe, expect, it } from "vitest";
import { changeNoticeHours, noticeHours } from "@/lib/roster/notice";

// Notice for a move or a shortening (src/lib/roster/notice.ts, audit M6): from the earlier of the
// old and new start, so a shift moved earlier records the warning the worker really had.

const at = (iso: string) => new Date(iso);
const changed = at("2026-11-02T09:00:00Z"); // Monday 09:00

describe("notice for a move or a shortening", () => {
  it("a move earlier counts from the new start: the warning they had of it", () => {
    // Saturday 08:00 moved to Tuesday 08:00 on Monday 09:00: 23 hours, not the 119 to Saturday.
    expect(changeNoticeHours(at("2026-11-07T08:00:00Z"), at("2026-11-03T08:00:00Z"), changed)).toBe(
      23,
    );
  });

  it("a move later, or a shortening that keeps the start, counts from the old start", () => {
    expect(changeNoticeHours(at("2026-11-07T08:00:00Z"), at("2026-11-07T10:00:00Z"), changed)).toBe(
      119,
    );
    expect(changeNoticeHours(at("2026-11-07T08:00:00Z"), at("2026-11-07T08:00:00Z"), changed)).toBe(
      119,
    );
  });

  it("is the cancellation rule on the earlier start (the same rounding, negative after it)", () => {
    const old = at("2026-11-02T08:00:00Z");
    expect(changeNoticeHours(old, at("2026-11-02T12:00:00Z"), changed)).toBe(
      noticeHours(old, changed),
    );
    expect(changeNoticeHours(old, at("2026-11-02T12:00:00Z"), changed)).toBe(-1);
  });
});
