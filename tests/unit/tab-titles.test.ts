import { describe, expect, it } from "vitest";
import type { ShiftPage } from "@/lib/portal/shift-detail";
import { SHIFT_NOT_AVAILABLE_TITLE, shiftTabTitle } from "@/lib/portal/tab-titles";
import {
  cancellationTabTitle,
  casualTabTitle,
  eventTabTitle,
  sessionTabTitle,
  workerDataTabTitle,
} from "@/lib/office/tab-titles";

// Every page names itself in the browser tab (Phase 37.6, w1-09; docs/screens.md "Browser tab
// titles read"): the formatters for pages whose title is their record's. Pure.

const TZ = "Europe/London";

describe("office detail pages' tab titles", () => {
  it("an event and each of its tabs; an unknown tab is Staffing, as the page shows", () => {
    const words = {
      staffing: "Staffing",
      overview: "Overview",
      interested: "Interested",
      cancellations: "Cancellations",
      history: "History",
    };
    for (const [tab, word] of Object.entries(words)) {
      expect(eventTabTitle("Northern Lights Live", tab)).toBe(`Northern Lights Live · ${word}`);
    }
    expect(eventTabTitle("Northern Lights Live", undefined)).toBe(
      "Northern Lights Live · Staffing",
    );
    expect(eventTabTitle("Northern Lights Live", "nope")).toBe("Northern Lights Live · Staffing");
  });

  it("a session: role and London day, then its event; the day right across the clock change", () => {
    const s = (iso: string, eventName: string | null = "Northern Lights Live") =>
      sessionTabTitle({
        role: "door_supervisor",
        startsAt: new Date(iso),
        timeZone: TZ,
        eventName,
      });
    expect(s("2026-11-12T18:00:00Z")).toBe("Door supervisor, Thu 12 Nov · Northern Lights Live");
    // 23:30 UTC on Sat 24 Oct 2026 is 00:30 BST on Sun 25 Oct (the clocks go back at 02:00 BST).
    expect(s("2026-10-24T23:30:00Z")).toBe("Door supervisor, Sun 25 Oct · Northern Lights Live");
    // 23:30 UTC on Sun 25 Oct is 23:30 GMT the same day.
    expect(s("2026-10-25T23:30:00Z", null)).toBe("Door supervisor, Sun 25 Oct");
    expect(
      sessionTabTitle({
        role: "csas_officer",
        startsAt: new Date("2026-11-14T09:00:00Z"),
        timeZone: TZ,
        eventName: "Match day",
      }),
    ).toBe("CSAS officer, Sat 14 Nov · Match day");
  });

  it("a casual, their data, a cancellation (with and without a casual)", () => {
    expect(casualTabTitle("Aled Adeyemi")).toBe("Aled Adeyemi · Casuals");
    expect(workerDataTabTitle("Aled Adeyemi")).toBe("Aled Adeyemi · Data requests");
    expect(cancellationTabTitle("8CE76FA4", "Ben Carter")).toBe(
      "Cancellation 8CE76FA4 · Ben Carter",
    );
    expect(cancellationTabTitle("8CE76FA4")).toBe("Cancellation 8CE76FA4");
    expect(cancellationTabTitle("8CE76FA4", null)).toBe("Cancellation 8CE76FA4");
  });
});

describe("a casual's shift page's tab title", () => {
  const shift = {
    shiftId: "s1",
    role: "door_supervisor",
    startsAt: new Date("2026-11-14T19:00:00Z"),
  } as unknown as Extract<ShiftPage, { state: "open" }>["shift"];

  it("every state with a shift names its role and day; one she can't see says so", () => {
    const states: ShiftPage["state"][] = [
      "booked",
      "open",
      "held",
      "ask",
      "blocked",
      "filled",
      "started",
      "cancelled",
    ];
    for (const state of states) {
      const page = { state, shift } as unknown as ShiftPage;
      expect(shiftTabTitle(page, TZ), state).toBe("Door supervisor, Sat 14 Nov");
    }
    expect(SHIFT_NOT_AVAILABLE_TITLE).toBe("Shift not available");
    expect(shiftTabTitle({ state: "missing" }, TZ)).toBe("Shift not available");
  });
});
