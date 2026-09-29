import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TodayView, UrgentShift } from "@/lib/office/today";
import {
  closeResultText,
  offerResultText,
  placesText,
  requestsText,
  stoppedText,
  urgentResultText,
  waveText,
} from "@/lib/office/today-copy";

// The office's Today view: its words (src/lib/office/today-copy.ts) and the rendered page
// (src/app/office/today-view.tsx), from made-up data.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
}));

const shift = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  site: "Acme Demo Arena",
  startsAt: new Date("2026-11-07T06:00:00Z"),
  endsAt: new Date("2026-11-07T14:00:00Z"),
  headcount: 1,
  placesLeft: 1,
  isUrgent: true,
  fromSheet: false,
};
const urgent = (o: Partial<UrgentShift> = {}): UrgentShift => ({
  ...shift,
  wave: 2,
  offered: 4,
  byOffice: 0,
  accepted: 0,
  failed: 0,
  stopped: null,
  escalated: false,
  ...o,
});

describe("the words", () => {
  it("places free", () => {
    expect(placesText(1, 1)).toBe("1 place free");
    expect(placesText(2, 3)).toBe("2 of 3 places free");
  });

  it("wave status", () => {
    expect(waveText(urgent())).toBe("Wave 2 · 4 offered · 0 accepted");
    expect(waveText(urgent({ byOffice: 1, failed: 2 }))).toBe(
      "Wave 2 · 4 offered · 0 accepted · 1 by the office · 2 couldn't be sent",
    );
    expect(waveText(urgent({ wave: null, offered: 1, byOffice: 1 }))).toBe(
      "1 offered · 0 accepted · 1 by the office",
    );
    expect(waveText(urgent({ wave: null, offered: 0 }))).toBe("No offers sent yet.");
    expect(stoppedText(urgent({ stopped: "no_candidates" }))).toBe(
      "Offers stopped: nobody else can take it.",
    );
    expect(stoppedText(urgent())).toBeNull();
  });

  it("requests", () => {
    expect(requestsText({ total: 0, byType: {} })).toBe("No requests waiting.");
    expect(requestsText({ total: 3, byType: { time_change: 2, swap: 1 } })).toBe(
      "3 requests waiting: 2 time changes, 1 swap.",
    );
    // The same order however the kinds arrive.
    expect(requestsText({ total: 3, byType: { swap: 1, time_change: 2 } })).toBe(
      "3 requests waiting: 2 time changes, 1 swap.",
    );
    expect(requestsText({ total: 1, byType: { review: 1 } })).toBe(
      "1 request waiting: 1 review of a refused shift.",
    );
  });

  it("each quick action says what happened", () => {
    expect(urgentResultText({ status: "marked" })).toBe("Marked urgent. Offers are going out.");
    expect(urgentResultText({ status: "not_allowed" })).toBe("You can't change shifts.");
    expect(closeResultText({ status: "closed", placesLeft: 1 })).toBe(
      "Marked as filled. Nobody else will be offered it.",
    );
    expect(closeResultText({ status: "sheet" })).toBe(
      "This shift comes from your Google Sheet. Change it there.",
    );
    expect(offerResultText({ status: "queued" }, "Ann Booker")).toBe(
      "Offer on its way to Ann Booker.",
    );
    expect(offerResultText({ status: "not_candidate" }, "Ann Booker")).toBe(
      "Ann Booker can't be offered this shift now.",
    );
    expect(offerResultText({ status: "logged_out" }, "Ann Booker")).toBe(
      "Your session has ended. Log in again.",
    );
  });
});

describe("the page", async () => {
  const { TodayContent } = await import("@/app/office/today-view");
  const empty: Omit<TodayView, "officeUser"> = {
    timeZone: "Europe/London",
    urgent: [],
    gaps: [],
    gapsMore: false,
    cancellations: [],
    requests: { total: 0, byType: {} },
    expiring: [],
  };
  const text = (view: Omit<TodayView, "officeUser">) =>
    renderToStaticMarkup(createElement(TodayContent, { view })).replace(/<[^>]+>/g, " ");

  it("says so when each section is empty", () => {
    const page = text(empty);
    for (const line of [
      "No urgent shifts.",
      "No gaps in the next 7 days.",
      "No cancellations in the last 24 hours.",
      "No requests waiting.",
      "Nothing expires in the next 7 days.",
    ]) {
      expect(page).toContain(line);
    }
  });

  it("shows each item with its facts and quick actions", () => {
    const page = text({
      ...empty,
      urgent: [urgent({ stopped: "no_candidates", escalated: true })],
      gaps: [{ ...shift, shiftId: "g", isUrgent: false, headcount: 3, placesLeft: 2, site: null }],
      cancellations: [
        {
          assignmentId: "c",
          worker: "Ben Carter",
          shiftId: "s",
          role: "steward",
          site: "Acme Demo Arena",
          startsAt: new Date("2026-11-07T08:00:00Z"),
          endsAt: new Date("2026-11-07T16:00:00Z"),
          cancelledAt: new Date("2026-11-07T06:00:00Z"),
          noticeHours: 2,
          byFirm: false,
          reason: "I'm unwell",
        },
      ],
      requests: { total: 2, byType: { time_change: 1, swap: 1 } },
      expiring: [
        { worker: "Dee Patel", credential: "SIA door supervisor licence", expiresOn: "2026-11-05" },
      ],
    });
    expect(page).toContain("Door supervisor at Acme Demo Arena");
    expect(page).toContain("Sat 7 Nov, 06:00 to 14:00");
    expect(page).toContain("Wave 2 · 4 offered · 0 accepted");
    expect(page).toContain("Offers stopped: nobody else can take it.");
    expect(page).toContain("The office was emailed about it.");
    expect(page).toContain("Not urgent");
    expect(page).toContain("2 of 3 places free");
    expect(page).toContain("Mark urgent");
    expect(page).toContain("Offer to someone");
    expect(page).toContain("Mark as filled");
    expect(page).toContain("Ben Carter cancelled");
    expect(page).toContain("2 hours&#x27; notice");
    expect(page).toContain("Recorded at 06:00 on Sat 7 Nov.");
    expect(page).toContain("Reason: I&#x27;m unwell");
    expect(page).toContain("2 requests waiting: 1 time change, 1 swap.");
    expect(page).toContain("Dee Patel: SIA door supervisor licence, expires Thu 5 Nov");
  });

  it("a sheet's shift has no Mark as filled (it's changed in the sheet)", () => {
    const page = text({ ...empty, gaps: [{ ...shift, isUrgent: false, fromSheet: true }] });
    expect(page).toContain("Offer to someone");
    expect(page).not.toContain("Mark as filled");
  });
});
