import { describe, expect, it } from "vitest";
import { hoursToStart, insideUrgentWindow, urgentWindowHours } from "@/lib/rules/urgent";

// When a reopened place is urgent (src/lib/rules/urgent.ts).

const NOW = new Date("2026-11-02T09:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("insideUrgentWindow", () => {
  it("is true from just after now up to exactly the window", () => {
    expect(insideUrgentWindow(inHours(0.01), NOW, 24)).toBe(true);
    expect(insideUrgentWindow(inHours(24), NOW, 24)).toBe(true);
    expect(insideUrgentWindow(inHours(24.01), NOW, 24)).toBe(false);
    expect(insideUrgentWindow(inHours(10), NOW, 12)).toBe(true);
    expect(insideUrgentWindow(inHours(13), NOW, 12)).toBe(false);
  });

  it("is never true once the shift has started, or with a window of 0", () => {
    expect(insideUrgentWindow(NOW, NOW, 24)).toBe(false);
    expect(insideUrgentWindow(inHours(-1), NOW, 24)).toBe(false);
    expect(insideUrgentWindow(inHours(1), NOW, 0)).toBe(false);
  });
});

describe("urgentWindowHours", () => {
  it("reads the firm's setting, defaulting to 24", () => {
    expect(urgentWindowHours({})).toBe(24);
    expect(urgentWindowHours({ urgent_window_hours: 12 })).toBe(12);
    expect(urgentWindowHours({ urgent_window_hours: 0 })).toBe(0);
  });

  it("falls back to 24 for a value that makes no sense (a cancellation must never fail)", () => {
    for (const bad of ["soon", -1, 200, null]) {
      expect(urgentWindowHours({ urgent_window_hours: bad })).toBe(24);
    }
  });
});

describe("hoursToStart", () => {
  it("is to 2 decimals", () => {
    expect(hoursToStart(inHours(10), NOW)).toBe(10);
    expect(hoursToStart(new Date(NOW.getTime() + 37 * 60_000), NOW)).toBe(0.62);
  });
});
