import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CancelShiftResult } from "@/app/shifts/cancel-shift-result";
import {
  CANCEL_REASONS,
  cancelReason,
  noticeText,
  OTHER_REASON,
  type CancelShiftOutcome,
} from "@/lib/portal/cancel-shift";

// "Cancel this shift" (docs/screens.md copy rules): the reason stored, the notice wording, and the
// confirmation the worker sees, rendered to HTML.

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const show = (outcome: Exclude<CancelShiftOutcome, { status: "logged_out" | "invalid_reason" }>) =>
  text(renderToStaticMarkup(createElement(CancelShiftResult, { outcome })));

describe("the reason stored", () => {
  it("is a quick reason as it reads, or 'Something else' with the worker's note", () => {
    expect(CANCEL_REASONS).toEqual(["I'm unwell", "Travel problem", "Family or caring"]);
    expect(cancelReason("I'm unwell", "")).toBe("I'm unwell");
    expect(cancelReason("Travel problem", "ignored")).toBe("Travel problem");
    expect(cancelReason(OTHER_REASON, "  Car broke down  ")).toBe("Something else: Car broke down");
  });

  it("refuses no reason, a made-up one, or 'Something else' without a note (or an essay)", () => {
    expect(cancelReason("", "")).toBeNull();
    expect(cancelReason("I fancy a day off", "")).toBeNull();
    expect(cancelReason(OTHER_REASON, "   ")).toBeNull();
    expect(cancelReason(OTHER_REASON, "x".repeat(201))).toBeNull();
    expect(cancelReason(OTHER_REASON, "x".repeat(200))).not.toBeNull();
  });
});

describe("the notice wording", () => {
  it("says hours under two days, days from two days, never more than was given", () => {
    expect(noticeText(0.5)).toBe("less than an hour's notice");
    expect(noticeText(-2)).toBe("less than an hour's notice");
    expect(noticeText(1)).toBe("1 hour's notice");
    expect(noticeText(1.99)).toBe("1 hour's notice");
    expect(noticeText(47.9)).toBe("47 hours' notice");
    expect(noticeText(48)).toBe("2 days' notice");
    expect(noticeText(71.5)).toBe("2 days' notice");
    expect(noticeText(168)).toBe("7 days' notice");
  });
});

describe("the confirmation", () => {
  it("records what, when, the notice, a reference and the firm's sign-off", () => {
    const words = show({
      status: "cancelled",
      ref: "3F2A9C1B",
      noticeHours: 50,
      recordedAt: "09:14 on Thu 5 Nov",
      when: "Sat 7 Nov, 14:00 to 22:00",
      role: "Door supervisor",
      siteName: "Demo Arena",
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("We've recorded your cancellation.");
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor at Demo Arena");
    expect(words).toContain("You gave 2 days' notice.");
    expect(words).toContain("Recorded at 09:14 on Thu 5 Nov.");
    expect(words).toContain("Reference: 3F2A9C1B");
    expect(words).toContain("— Acme Events Shift Team");
  });

  it("still confirms, with the reference, if the shift's details couldn't be read", () => {
    const words = show({
      status: "cancelled",
      ref: "3F2A9C1B",
      noticeHours: 5,
      recordedAt: "09:14 on Thu 5 Nov",
      when: null,
      role: null,
      siteName: null,
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("We've recorded your cancellation.");
    expect(words).toContain("You gave 5 hours' notice.");
    expect(words).not.toContain("null");
  });

  it("answers the other outcomes in plain words", () => {
    expect(show({ status: "started" })).toContain(
      "This shift has already started. Contact the office.",
    );
    expect(show({ status: "not_booked" })).toContain(
      "You're not booked on this shift any more. If you've just cancelled it, it's recorded.",
    );
    expect(show({ status: "error" })).toContain("Something went wrong. Try again.");
  });
});
