import { describe, expect, it } from "vitest";
import { automaticEventKey, automaticEventName, EVENT_NAME_MAX } from "@/lib/roster/shift-events";
import { localDateOf } from "@/lib/time/zoned";

// Automatic events' names and keys (src/lib/roster/shift-events.ts; migration 0035 makes the same,
// tests/integration/db.event-backfill.test.ts).

describe("an automatic event's name", () => {
  it("is the site and the day, as in the spec", () => {
    expect(automaticEventName("Acme Demo Arena", "2026-10-10")).toBe(
      "Acme Demo Arena · Sat 10 Oct",
    );
  });

  it("is the day alone with no site", () => {
    expect(automaticEventName(null, "2026-10-10")).toBe("Sat 10 Oct");
  });

  it("cuts a long site name so the whole name fits, keeping the date", () => {
    const site = "a".repeat(250);
    const name = automaticEventName(site, "2026-09-09"); // "Wed 9 Sep"
    expect([...name].length).toBeLessThanOrEqual(EVENT_NAME_MAX);
    expect(name.endsWith(" · Wed 9 Sep")).toBe(true);
    // The longest day label ("Wed 10 Sep") still fits exactly.
    expect([...automaticEventName(site, "2026-09-30")].length).toBeLessThanOrEqual(EVENT_NAME_MAX);
    expect([...automaticEventName(site, "2026-12-10")]).toHaveLength(EVENT_NAME_MAX); // Thu 10 Dec
  });

  it("counts characters, not UTF-16 units, as Postgres's left() does", () => {
    const site = "é".repeat(100) + "🏟".repeat(100); // 200 characters, 300 UTF-16 units
    const name = automaticEventName(site, "2026-12-10");
    expect([...name]).toHaveLength(EVENT_NAME_MAX);
    expect(name.endsWith(" · Thu 10 Dec")).toBe(true);
  });
});

describe("an automatic event's key", () => {
  it("is the site id (or none) and the day", () => {
    expect(automaticEventKey("0b8f8d2e-1d1a-4c1e-9f4a-0a0a0a0a0a0a", "2026-10-10")).toBe(
      "auto:0b8f8d2e-1d1a-4c1e-9f4a-0a0a0a0a0a0a:2026-10-10",
    );
    expect(automaticEventKey(null, "2026-10-10")).toBe("auto:none:2026-10-10");
  });

  it("uses the firm-local day of the start: a night shift stays on the day it starts", () => {
    const tz = "Europe/London";
    expect(localDateOf(new Date("2026-10-10T22:00:00Z"), tz)).toBe("2026-10-10"); // 23:00 BST
    expect(localDateOf(new Date("2026-10-10T23:30:00Z"), tz)).toBe("2026-10-11"); // 00:30 BST
    // The clocks go back on Sunday 25 October 2026: 00:30 GMT is still the 25th.
    expect(localDateOf(new Date("2026-10-25T00:30:00Z"), tz)).toBe("2026-10-25");
    expect(localDateOf(new Date("2026-10-24T23:30:00Z"), tz)).toBe("2026-10-25"); // 00:30 BST
  });
});
