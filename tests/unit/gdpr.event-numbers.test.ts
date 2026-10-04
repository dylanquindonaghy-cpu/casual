import { describe, expect, it } from "vitest";
import { renumberEvents } from "@/lib/gdpr/event-numbers";

// Exports number their own events (the reviews of Phase 10 task 19): the shared counter's numbers
// never reach a firm's file, and data pointing at another event points at its new number.

describe("an export's event numbers", () => {
  it("1, 2, 3… in the order they happened, whatever order the rows come in", () => {
    const rows = [
      { id: 1_000_009, action: "c", data: {} },
      { id: 1_000_002, action: "a", data: {} },
      { id: 1_000_005, action: "b", data: {} },
    ];
    expect(renumberEvents(rows).map((r) => [r.id, r.action])).toEqual([
      [3, "c"],
      [1, "a"],
      [2, "b"],
    ]);
  });

  it("an event pointing at another gets its new number; one pointing outside the file loses it", () => {
    const rows = [
      { id: "1000002", data: { by: "firm" } },
      { id: "1000005", data: { changeEventId: 1_000_002, workerId: "w1" } },
      { id: "1000007", data: { assignedEventId: 999_999, status: "sending" } },
    ];
    expect(renumberEvents(rows).map((r) => r.data)).toEqual([
      { by: "firm" },
      { changeEventId: 1, workerId: "w1" },
      { status: "sending" },
    ]);
  });

  it("nothing in, nothing out", () => {
    expect(renumberEvents([])).toEqual([]);
  });
});
