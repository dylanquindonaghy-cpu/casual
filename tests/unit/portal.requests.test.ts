import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RequestForm } from "@/app/requests/new/request-form";
import { RequestResult } from "@/app/requests/request-result";
import { RequestsList } from "@/app/requests/requests-list";
import {
  requestPayload,
  STATUS_WORDS,
  type CreateRequestOutcome,
} from "@/lib/portal/request-kinds";

// Worker requests (docs/screens.md, `/requests`, `/requests/new`): the payload check, and the
// pages rendered to HTML. The form uses Next's router, which only exists inside a running app, so a
// stand-in router is given (its server call isn't made here: the integration tests cover it).
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("the request payload check", () => {
  it("takes a time change with a start, a finish and an optional note", () => {
    expect(requestPayload("time_change", { start: "15:00", end: "23:00", note: " late " })).toEqual(
      {
        start: "15:00",
        end: "23:00",
        note: "late",
      },
    );
    expect(requestPayload("time_change", { start: "22:00", end: "06:00" })).toEqual({
      start: "22:00",
      end: "06:00",
      note: "",
    });
  });

  it("refuses times that aren't times, or the same start and finish", () => {
    expect(requestPayload("time_change", { start: "", end: "23:00" })).toBeNull();
    expect(requestPayload("time_change", { start: "24:00", end: "23:00" })).toBeNull();
    expect(requestPayload("time_change", { start: "9:30", end: "17:00" })).toBeNull();
    expect(requestPayload("time_change", { start: "15:00", end: "15:00" })).toBeNull();
  });

  it("takes a swap with an optional name and note, within their lengths", () => {
    expect(requestPayload("swap", { swapWith: "Jo", note: "" })).toEqual({
      swapWith: "Jo",
      note: "",
    });
    expect(requestPayload("swap", {})).toEqual({ swapWith: "", note: "" });
    expect(requestPayload("swap", { swapWith: "x".repeat(101) })).toBeNull();
    expect(requestPayload("swap", { note: "x".repeat(501) })).toBeNull();
  });

  it("puts every status into plain words, escalated reading as still waiting", () => {
    expect(STATUS_WORDS).toEqual({
      open: "Waiting for the office",
      escalated: "Waiting for the office",
      approved: "Approved",
      declined: "Declined",
      auto_resolved: "Sorted",
    });
  });
});

describe("the answers after Send request", () => {
  const show = (outcome: Exclude<CreateRequestOutcome, { status: "logged_out" }>) =>
    text(renderToStaticMarkup(createElement(RequestResult, { outcome })));

  it("confirms with what, which shift, a reference and the sign-off", () => {
    const words = show({
      status: "created",
      ref: "3F2A9C1B",
      kind: "time_change",
      when: "Sat 7 Nov, 14:00 to 22:00",
      asked: "15:00 to 23:00",
      sentAt: "09:14 on Mon 2 Nov",
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("Request sent.");
    expect(words).toContain("Time change for Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("You asked for 15:00 to 23:00.");
    expect(words).toContain("Sent at 09:14 on Mon 2 Nov.");
    expect(words).toContain("Reference: 3F2A9C1B");
    expect(words).toContain("The office will reply. You'll see the answer in My requests.");
    expect(words).toContain("— Acme Events Shift Team");
    expect(words).toContain("See my requests");
  });

  it("answers the others in plain words", () => {
    expect(show({ status: "already_open", ref: "3F2A9C1B", kind: "swap" })).toContain(
      "You've already asked about this shift. Reference: 3F2A9C1B.",
    );
    expect(show({ status: "not_yours" })).toContain(
      "You can only ask about your own shifts that haven't started.",
    );
    expect(show({ status: "invalid" })).toContain("Check the form and try again.");
    expect(show({ status: "error" })).toContain("Something went wrong. Try again.");
  });
});

describe("My requests and New request", () => {
  it("lists each request with its shift, status, the office's note, day sent and reference", () => {
    const html = renderToStaticMarkup(
      createElement(RequestsList, {
        timeZone: "Europe/London",
        requests: [
          {
            ref: "3F2A9C1B",
            type: "time_change",
            status: "escalated",
            note: null,
            createdAt: new Date("2026-11-02T10:00:00Z"),
            shift: {
              when: "Sat 7 Nov, 14:00 to 22:00",
              role: "Door supervisor",
              siteName: "Demo Arena",
            },
          },
          {
            ref: "AB12CD34",
            type: "swap",
            status: "declined",
            note: "We need you at the arena that day.",
            createdAt: new Date("2026-11-01T10:00:00Z"),
            shift: null,
          },
        ],
      }),
    );
    const words = text(html);
    expect(words).toContain("My requests");
    expect(words).toContain("New request");
    expect(words).toContain("Time change: Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor at Demo Arena");
    expect(words).toContain("Waiting for the office");
    expect(words).toContain("Sent Mon 2 Nov · Reference 3F2A9C1B");
    expect(words).toContain("Declined");
    expect(words).toContain("The office says: We need you at the arena that day.");
    expect(words.match(/The office says/g)).toHaveLength(1);
    expect(html).toContain('href="/requests/new"');
  });

  it("says so plainly when there are none", () => {
    const words = text(
      renderToStaticMarkup(
        createElement(RequestsList, { timeZone: "Europe/London", requests: [] }),
      ),
    );
    expect(words).toContain("No requests yet.");
  });

  it("the form starts with the shift, the two kinds and Send request", () => {
    const html = renderToStaticMarkup(
      createElement(RequestForm, {
        shifts: [
          { shiftId: "s1", label: "Sat 7 Nov, 14:00 to 22:00, Door supervisor at Demo Arena" },
          { shiftId: "s2", label: "Sun 8 Nov, 09:00 to 17:00, Steward" },
        ],
        preselected: "s2",
      }),
    );
    const words = text(html);
    expect(words).toContain("Which shift?");
    expect(html).toMatch(/<option value="s2" selected="">/);
    expect(words).toContain("Change the times");
    expect(words).toContain("Swap with someone");
    expect(words).toContain("Send request");
  });
});
