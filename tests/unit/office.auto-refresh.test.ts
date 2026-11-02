import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFRESH_SECONDS, answerClock, refreshDue } from "@/app/office/auto-refresh";
import { updatedWords } from "@/app/office/office-frame";

// Office pages keep themselves up to date (Phase 26, the pre-build audit's aud-2): every 30 seconds
// while the tab is in view, and when you come back to it after 30 seconds or more; the top bar says
// when ("Updated 10:42", London time).

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("when an office page asks for its figures again", () => {
  const at = Date.UTC(2026, 10, 2, 10, 0, 0);

  it("every 30 seconds, and only while the tab is in view", () => {
    expect(REFRESH_SECONDS).toBe(30);
    expect(refreshDue(at, at + 29_999, true)).toBe(false);
    expect(refreshDue(at, at + 30_000, true)).toBe(true);
    expect(refreshDue(at, at + 600_000, true)).toBe(true);
    // A hidden tab never asks, however long it's been.
    expect(refreshDue(at, at + 600_000, false)).toBe(false);
    // Another interval can be given (the demo phone's few seconds).
    expect(refreshDue(at, at + 5_000, true, 5)).toBe(true);
  });

  it("the answer's time: none until the page has one; each new one tells whoever's listening", () => {
    const clock = answerClock();
    expect(clock.get()).toBeNull();
    let heard = 0;
    const stop = clock.subscribe(() => heard++);
    clock.set(1000);
    expect(clock.get()).toBe(1000);
    clock.set(31_000);
    expect([clock.get(), heard]).toEqual([31_000, 2]);
    stop();
    clock.set(61_000);
    expect([clock.get(), heard]).toEqual([61_000, 2]);
  });

  it("the hook: checked every 5 seconds, on coming back to the tab, one ask at a time", () => {
    const hook = read("src/app/office/auto-refresh.ts");
    expect(hook).toMatch(/^"use client";/);
    expect(hook).toContain("setInterval(ask, Math.min(5, seconds) * 1000)");
    expect(hook).toContain('document.addEventListener("visibilitychange", ask)');
    expect(hook).toContain('document.removeEventListener("visibilitychange", ask)');
    expect(hook).toContain("clearInterval(timer)");
    expect(hook).toContain("start(() => router.refresh())");
    expect(hook).toMatch(/if \(asked\.current\) return;/);
    // The time is read through the store, never set as state inside an effect.
    expect(hook).toContain("useSyncExternalStore(clock.subscribe, clock.get, () => null)");
    expect(hook).not.toMatch(/setUpdated|useState<Date/);
    // The frame uses it for every office page, with the page's address (a new page is fresh).
    const frame = read("src/app/office/office-frame.tsx");
    expect(frame).toContain("const updated = useAutoRefresh(pathname);");
  });
});

describe('the top bar\'s "Updated"', () => {
  it("London time, hours and minutes, in GMT and in BST", () => {
    expect(updatedWords(new Date("2026-11-02T10:42:15Z"))).toBe("Updated 10:42");
    expect(updatedWords(new Date("2026-07-01T09:05:00Z"))).toBe("Updated 10:05");
    expect(updatedWords(new Date("2026-11-02T23:59:59Z"))).toBe("Updated 23:59");
  });
});
