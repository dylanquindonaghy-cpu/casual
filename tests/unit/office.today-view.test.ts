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
  toMarkText,
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
    expect(stoppedText(urgent({ stopped: "hidden" }))).toBe(
      "Offers stopped: it's hidden from casuals.",
    );
    expect(stoppedText(urgent())).toBeNull();
  });

  it("people not marked yet", () => {
    expect(toMarkText(1)).toBe("1 person not marked yet.");
    expect(toMarkText(4)).toBe("4 people not marked yet.");
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
    // A session hidden from casuals (12B.4): marked, but no offers until it's shown; never offered.
    expect(urgentResultText({ status: "marked_hidden" })).toBe(
      "Marked urgent. It's hidden from casuals, so no offers go out while it's hidden.",
    );
    expect(offerResultText({ status: "hidden" }, "Ann Booker")).toBe(
      "This shift is hidden from casuals, so it can't be offered. Show it to casuals first.",
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
    toCheck: [],
    toCheckMore: false,
    fromSheet: [],
    fromSheetMore: false,
    toMark: [],
    toMarkMore: false,
    requests: { total: 0, byType: {} },
    expiring: [],
    unknownMessages: [],
    unknownMore: false,
  };
  const text = (view: Omit<TodayView, "officeUser">) =>
    renderToStaticMarkup(createElement(TodayContent, { view })).replace(/<[^>]+>/g, " ");

  it("says so when each section is empty", () => {
    const page = text(empty);
    for (const line of [
      "No urgent shifts.",
      "No gaps in the next 7 days.",
      "No cancellations in the last 24 hours.",
      "Nothing to mark from the last 7 days.",
      "No requests waiting.",
      "Nothing expires in the next 7 days.",
      "None in the last 7 days.",
    ]) {
      expect(page).toContain(line);
    }
  });

  it("from your rota sheet: shown only when there's something, with the shift and what wasn't done", () => {
    expect(text(empty)).not.toContain("From your rota sheet");
    const page = text({
      ...empty,
      fromSheet: [
        {
          shiftId: "s1",
          role: "track_operative",
          site: "Demo Junction",
          startsAt: new Date("2026-11-07T22:00:00Z"),
          endsAt: new Date("2026-11-08T06:00:00Z"),
          change: {
            fields: ["role"],
            reason: "rules",
            people: [{ name: "Ada Example", codes: ["wrong_role"] }],
          },
          names: [{ name: "Ben Example", codes: ["credential_missing"], dropped: false }],
        },
      ],
    });
    expect(page).toContain("From your rota sheet");
    expect(page).toContain("Your rota sheet asks for these, but the app couldn&#x27;t do them.");
    expect(page).toContain("at Demo Junction");
    expect(page).toContain(
      "Your rota sheet changes its role, but Ada Example (not that role) can&#x27;t work it: not changed here.",
    );
    expect(page).toContain(
      "Ben Example is in your rota sheet but isn&#x27;t booked: a licence or card missing. The next sync tries again.",
    );
  });

  it("messages from numbers we don't know: the number, their words, when; a former worker named", () => {
    const html = text({
      ...empty,
      unknownMessages: [
        {
          messageId: "m1",
          channel: "whatsapp",
          from: "+447700900998",
          text: "Hi, it's Sam, new phone",
          receivedAt: new Date("2026-11-02T09:14:00Z"),
          formerWorker: null,
          formerWorkerActive: false,
        },
        {
          messageId: "m2",
          channel: "whatsapp",
          from: "+447700900997",
          text: null,
          receivedAt: new Date("2026-11-01T18:30:00Z"),
          formerWorker: "Ann Booker",
          formerWorkerActive: false,
        },
        {
          messageId: "m4",
          channel: "voice",
          from: null,
          text: null,
          receivedAt: new Date("2026-11-01T07:00:00Z"),
          formerWorker: null,
          formerWorkerActive: false,
        },
        {
          messageId: "m5",
          channel: "sms",
          from: "+447700900995",
          text: "Who is this?",
          receivedAt: new Date("2026-11-01T06:00:00Z"),
          formerWorker: null,
          formerWorkerActive: false,
        },
        {
          messageId: "m3",
          channel: "whatsapp",
          from: "+447700900996",
          text: `${"x".repeat(300)}HIDDEN`,
          receivedAt: new Date("2026-11-01T08:00:00Z"),
          formerWorker: "Ben Booker",
          formerWorkerActive: true,
        },
      ],
      unknownMore: true,
    });
    const page = html.replace(/&#x27;/g, "'"); // apostrophes arrive HTML-escaped
    expect(page).toContain("Messages from numbers we don't know");
    expect(page).toContain("+44 7700 900998 · 09:14 on Mon 2 Nov");
    expect(page).toContain("“Hi, it's Sam, new phone”");
    expect(page).toContain("+44 7700 900997 (Ann Booker, not active) · 18:30 on Sun 1 Nov");
    expect(page).toContain("(A photo or file, with no text.)");
    expect(page).toContain("Showing the newest 50.");
    // Made active again since: named, not called inactive. A long message shows its start.
    expect(page).toContain("+44 7700 900996 (Ben Booker) · 08:00 on Sun 1 Nov");
    expect(page).toContain(`“${"x".repeat(300)}…”`);
    expect(page).not.toContain("HIDDEN");
    // A voicemail from a withheld number that couldn't be turned into text.
    expect(page).toContain("Number withheld · 07:00 on Sun 1 Nov · Voicemail");
    expect(page).toContain("(A voicemail we couldn't turn into text.)");
    // A text message.
    expect(page).toContain("+44 7700 900995 · 06:00 on Sun 1 Nov · Text");
    // A WhatsApp says nothing more.
    expect(page).not.toMatch(/Mon 2 Nov · (Text|Voicemail)/);
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
      toMark: [
        {
          shiftId: "m",
          role: "steward",
          site: "Acme Demo Racecourse",
          startsAt: new Date("2026-10-31T10:00:00Z"),
          endsAt: new Date("2026-10-31T18:00:00Z"),
          unmarked: 3,
        },
      ],
      requests: { total: 2, byType: { time_change: 1, swap: 1 } },
      expiring: [
        { worker: "Dee Patel", credential: "SIA door supervisor licence", expiresOn: "2026-11-05" },
      ],
    });
    expect(page).toContain("Who worked?");
    expect(page).toContain("Steward at Acme Demo Racecourse");
    expect(page).toContain("Sat 31 Oct, 10:00 to 18:00");
    expect(page).toContain("3 people not marked yet.");
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

  it("says when Who worked? has more than it shows", () => {
    const page = text({ ...empty, toMarkMore: true });
    expect(page).toContain("Showing the first 50.");
    expect(text(empty)).not.toContain("Showing the first 50.");
  });

  it("a sheet's shift has no Mark as filled (it's changed in the sheet)", () => {
    const page = text({ ...empty, gaps: [{ ...shift, isUrgent: false, fromSheet: true }] });
    expect(page).toContain("Offer to someone");
    expect(page).not.toContain("Mark as filled");
  });
});
