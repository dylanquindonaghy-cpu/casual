import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewOutcome } from "@/lib/portal/request-kinds";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";

// One shift's page (docs/screens.md, `/shifts/[id]`), rendered for each state, and the answers
// after "Ask the office to review". The buttons use Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { ReviewResult } = await import("@/app/shifts/[id]/review-form");

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const site = {
  name: "Demo Arena",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Leeds",
  postcode: "LS1 1AA",
};
const summary: ShiftSummary = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  startsAt: new Date("2026-11-07T14:00:00Z"),
  endsAt: new Date("2026-11-07T22:00:00Z"),
  placesLeft: 2,
  site,
};
const render = (page: ShiftPage) =>
  renderToStaticMarkup(createElement(ShiftView, { page, timeZone: TZ, now: NOW }));

describe("ShiftView", () => {
  it("blocked: the reasons in plain English, then an optional note and Ask the office to review", () => {
    const html = render({
      state: "blocked",
      shift: summary,
      reasons: [
        "Your SIA door supervisor licence expired on 3 Oct. Renew it, then send the new number to the office.",
      ],
      review: null,
    });
    const words = text(html);
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor at Demo Arena");
    expect(words).toContain("1 Test Road, Leeds, LS1 1AA");
    expect(words).toContain(
      "You can't take this shift: Your SIA door supervisor licence expired on 3 Oct. Renew it, then send the new number to the office.",
    );
    expect(words).toContain("If you think this is wrong, ask the office to review it.");
    expect(words).toContain("Anything the office should know? (optional)");
    expect(words).toContain("Ask the office to review");
    expect(html).toMatch(/<textarea[^>]*maxLength="500"/);
    expect(words).not.toContain("Take shift");
  });

  it("blocked after asking: when it was asked and its reference, instead of the form", () => {
    const words = text(
      render({
        state: "blocked",
        shift: summary,
        reasons: ["You need a SIA door supervisor licence for this shift."],
        review: { ref: "3F2A9C1B", askedAt: new Date("2026-11-02T08:14:00Z") },
      }),
    );
    expect(words).toContain(
      "You asked the office to review this at 08:14 on Mon 2 Nov. Reference: 3F2A9C1B.",
    );
    expect(words).toContain("You can see it in My requests.");
    expect(words).toContain("See my requests");
    expect(words).not.toContain("Anything the office should know");
  });

  it("open: places left and Take shift", () => {
    const words = text(render({ state: "open", shift: summary }));
    expect(words).toContain("2 places left");
    expect(words).toContain("Take shift");
    expect(text(render({ state: "open", shift: { ...summary, placesLeft: 1 } }))).toContain(
      "1 place left",
    );
  });

  it("held: when it can be taken", () => {
    const words = text(
      render({ state: "held", shift: summary, opensAt: new Date("2026-11-02T09:15:00Z") }),
    );
    expect(words).toContain(
      "Offered first to people with fewer hours that week. You can take it from 09:15.",
    );
    expect(words).not.toContain("Take shift");
  });

  it("booked: the instructions, Ask for a change and Cancel this shift", () => {
    const words = text(
      render({
        state: "booked",
        shift: {
          assignmentId: "22222222-2222-4222-8222-222222222222",
          shiftId: summary.shiftId,
          role: "door_supervisor",
          startsAt: summary.startsAt,
          endsAt: summary.endsAt,
          status: "confirmed",
          instructions: "Meet at gate C.",
          site,
        },
      }),
    );
    expect(words).toContain("You're booked on this shift");
    expect(words).toContain("Meet at gate C.");
    expect(words).toContain("Open in maps");
    expect(words).toContain("Ask for a change");
    expect(words).toContain("Cancel this shift");
  });

  it("filled, started, cancelled and missing: a plain sentence and See open shifts", () => {
    const cases: [ShiftPage, string][] = [
      [{ state: "filled", shift: summary }, "This shift has been filled."],
      [{ state: "started", shift: summary }, "This shift has already started."],
      [{ state: "cancelled", shift: summary }, "This shift was cancelled."],
      [
        { state: "missing" },
        "This shift isn't available. It may have been removed, or the link is wrong.",
      ],
    ];
    for (const [page, sentence] of cases) {
      const words = text(render(page));
      expect(words).toContain(sentence);
      expect(words).toContain("See open shifts");
      expect(words).not.toContain("Take shift");
    }
  });
});

describe("after Ask the office to review", () => {
  const show = (outcome: Exclude<ReviewOutcome, { status: "logged_out" | "invalid" | "error" }>) =>
    text(renderToStaticMarkup(createElement(ReviewResult, { outcome })));

  it("confirms with when, a reference and the firm's sign-off", () => {
    const words = show({
      status: "created",
      ref: "3F2A9C1B",
      sentAt: "09:14 on Mon 2 Nov",
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("We've sent this to the office.");
    expect(words).toContain("They'll look at why you can't take this shift.");
    expect(words).toContain("Sent at 09:14 on Mon 2 Nov.");
    expect(words).toContain("Reference: 3F2A9C1B");
    expect(words).toContain("— Acme Events Shift Team");
    expect(words).toContain("See my requests");
  });

  it("answers every other outcome in plain words", () => {
    expect(show({ status: "already_open", ref: "3F2A9C1B" })).toContain(
      "You've already asked the office to review this shift. Reference: 3F2A9C1B.",
    );
    expect(show({ status: "eligible_now" })).toContain(
      "Good news: this shift isn't blocked any more.",
    );
    expect(show({ status: "already_booked" })).toContain("You're already booked on this shift.");
    expect(show({ status: "not_open" })).toContain("This shift isn't open any more.");
  });
});
