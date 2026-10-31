import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Who asked for it?" on the office's cancel forms (Phase 25.2; docs/screens.md "The firm's model
// on the office's screens"): required, after "Why?"; one booking can be the casual's own ask (by
// name), a whole shift can't. The server refuses a cancellation without an answer before it looks
// at the session, so nothing is cancelled.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {} }),
}));

const { cancelBookingAction, cancelShiftAction } = await import("@/app/office/shifts/actions");
const { CancelBookingForm, CancelShiftForm } =
  await import("@/app/office/shifts/[id]/firm-change-forms");

const SHIFT = "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";
const WORKER = "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";

// The options of the select labelled "Who asked for it?".
const askers = (html: string) => {
  const select = /<span>Who asked for it\?<\/span><select[^>]*>([\s\S]*?)<\/select>/.exec(html);
  return [...(select?.[1] ?? "").matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
};

describe("the cancel forms ask who asked", () => {
  it("one booking: the firm, the client, the casual by name, or not known", () => {
    const html = renderToStaticMarkup(
      createElement(CancelBookingForm, { shiftId: SHIFT, workerId: WORKER, name: "Priya Reid" }),
    );
    expect(html.indexOf("Why?")).toBeLessThan(html.indexOf("Who asked for it?"));
    expect(askers(html)).toEqual([
      "Choose who asked",
      "The firm",
      "The client",
      "Priya Reid",
      "Not known",
    ]);
  });

  it("a whole shift: never one casual's ask", () => {
    const html = renderToStaticMarkup(
      createElement(CancelShiftForm, { shiftId: SHIFT, booked: 2 }),
    );
    expect(askers(html)).toEqual(["Choose who asked", "The firm", "The client", "Not known"]);
  });

  it("the server: no answer, or one it doesn't know, cancels nothing", async () => {
    for (const askedBy of [undefined, "", "agency"]) {
      expect(await cancelShiftAction(SHIFT, "event_cancelled", askedBy)).toEqual({
        status: "no_asker",
      });
      expect(await cancelBookingAction(SHIFT, WORKER, "weather", askedBy)).toEqual({
        status: "no_asker",
      });
    }
    // A whole shift can't be the casual's.
    expect(await cancelShiftAction(SHIFT, "event_cancelled", "casual")).toEqual({
      status: "no_asker",
    });
    // The reason is still asked first.
    expect(await cancelShiftAction(SHIFT, "", "firm")).toEqual({ status: "no_reason" });
  });
});
