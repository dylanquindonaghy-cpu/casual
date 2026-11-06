import { describe, expect, it } from "vitest";
import { shiftsStrip, stripKey, stripTiles } from "@/lib/portal/shifts-strip";

// Open shifts' day strip in Phase 28 (28.8; docs/screens.md "The casual app, Phase 28"): a day with
// nothing on it has no tile, and the key under the strip names only the marks the tiles show. Pure,
// with made-up shifts (the strip's own days and words: tests/unit/ui.redesign-copy.test.ts).

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-21T15:00:00Z"); // Wed 21 Oct, 16:00 BST

describe("the strip's tiles", () => {
  it("only the days she's booked or can take a shift on, in date order", () => {
    const strip = shiftsStrip(
      NOW,
      TZ,
      [
        { startsAt: at("2026-10-22T07:00:00Z"), isUrgent: true },
        { startsAt: at("2026-10-25T10:00:00Z"), isUrgent: false },
        { startsAt: at("2026-10-30T10:00:00Z"), isUrgent: true }, // past the 8 days
      ],
      ["2026-10-24"],
    );
    expect(stripTiles(strip).map((d) => [d.dow, d.day, d.kind])).toEqual([
      ["Thu", "22", "urgent"],
      ["Sat", "24", "booked"],
      ["Sun", "25", "open"],
    ]);
  });

  it("nothing in the next 8 days: no tiles at all", () => {
    expect(stripTiles(shiftsStrip(NOW, TZ, [], []))).toEqual([]);
  });

  it("today keeps its word when it has a shift", () => {
    const tiles = stripTiles(
      shiftsStrip(NOW, TZ, [{ startsAt: at("2026-10-21T18:00:00Z"), isUrgent: false }], []),
    );
    expect(tiles.map((d) => [d.dow, d.label])).toEqual([
      ["Today", "Wed 21 Oct, today: 1 open shift"],
    ]);
  });
});

describe("the strip's key", () => {
  const days = (open: { startsAt: Date; isUrgent: boolean }[], booked: string[] = []) =>
    stripTiles(shiftsStrip(NOW, TZ, open, booked));

  it("lists only the marks present, always in the order urgent, open, booked", () => {
    const urgent = { startsAt: at("2026-10-22T07:00:00Z"), isUrgent: true };
    const open = { startsAt: at("2026-10-23T07:00:00Z"), isUrgent: false };
    expect(stripKey(days([urgent, open], ["2026-10-24"]))).toEqual(["urgent", "open", "booked"]);
    expect(stripKey(days([open], ["2026-10-24"]))).toEqual(["open", "booked"]);
    expect(stripKey(days([open]))).toEqual(["open"]);
    expect(stripKey(days([urgent]))).toEqual(["urgent"]);
    expect(stripKey(days([], ["2026-10-24"]))).toEqual(["booked"]);
    expect(stripKey(days([]))).toEqual([]);
  });

  it("a booked day hides that day's open shifts, so their mark isn't listed", () => {
    // Booked wins the day (she has that day): its open shift isn't a mark on screen.
    const sameDay = { startsAt: at("2026-10-24T10:00:00Z"), isUrgent: true };
    expect(stripKey(days([sameDay], ["2026-10-24"]))).toEqual(["booked"]);
  });

  it("never names the empty days' kind", () => {
    expect(stripKey(shiftsStrip(NOW, TZ, [], []))).toEqual([]);
  });
});
