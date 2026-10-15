import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewOutcome } from "@/lib/portal/request-kinds";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";

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
// The page in full (12H.2): a session of a named event, 3.1 miles away, needing an SIA door
// supervisor licence she holds and CSAS she hasn't got.
const facts: ShiftFacts = {
  eventName: "Riverside Festival",
  payRatePence: 1550,
  post: "Gate A",
  meetingPoint: "Staff entrance on Mill Lane",
  uniform: "Black trousers and your hi-vis",
  isUrgent: true,
  headcount: 4,
  travel: {
    kind: "estimated",
    straightMetres: 4000,
    arriveBy: new Date("2026-11-07T13:30:00Z"),
    car: { minutes: 12, metres: 5000 },
    publicTransport: { minutes: 24 },
  },
  requirements: [
    {
      code: "SIA_DS",
      name: "SIA door supervisor licence",
      chip: "SIA DS",
      status: { status: "valid", expiresOn: "2027-03-03", renewing: false },
      uploadable: true,
    },
    {
      code: "CSAS",
      name: "CSAS accreditation",
      chip: "CSAS",
      status: { status: "missing", expiresOn: null, renewing: false },
      uploadable: false,
    },
  ],
  noticeHours: 48,
  lastDay: "2026-11-07",
};
const render = (page: ShiftPage) =>
  renderToStaticMarkup(createElement(ShiftView, { page, timeZone: TZ, now: NOW }));

describe("ShiftView", () => {
  it("blocked: the reasons in plain English, then an optional note and Ask the office to review", () => {
    const html = render({
      state: "blocked",
      shift: summary,
      facts,
      reasons: [
        "Your SIA door supervisor licence expired on 3 Oct. Renew it, then send the new number to the office.",
      ],
      review: null,
    });
    const words = text(html);
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    // The title is the role; then the place (site · event) and its address (12H.2).
    expect(html).toMatch(/<h1[^>]*>Door supervisor<\/h1>/);
    expect(words).toContain("Demo Arena · Riverside Festival");
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
        facts,
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

  it("open: places left, Take shift and the strike note with the firm's notice", () => {
    const words = text(render({ state: "open", shift: summary, facts }));
    expect(words).toContain("Places 2 of 4 left");
    expect(words).toContain("Take shift");
    expect(words).toContain("Cancelling less than 48 hours before the start gives you a strike.");
    const firmOf24 = text(
      render({
        state: "open",
        shift: { ...summary, placesLeft: 1 },
        facts: { ...facts, noticeHours: 24 },
      }),
    );
    expect(firmOf24).toContain("Places 1 of 4 left");
    expect(firmOf24).toContain(
      "Cancelling less than 24 hours before the start gives you a strike.",
    );
  });

  it("open, in full (§4.4): chips, the facts, Getting there and What it needs, in that order", () => {
    const html = render({ state: "open", shift: summary, facts });
    const words = text(html);
    // Chips: Urgent, then what it needs.
    expect(words).toMatch(/Urgent Needs: SIA DS , CSAS/);
    expect(words).toContain("When Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Pay £15.50 an hour, about £124.00");
    expect(words).toContain("Meet Staff entrance on Mill Lane");
    expect(words).toContain("Post Gate A");
    expect(words).toContain("Uniform Black trousers and your hi-vis");
    expect(words).toContain(
      "Getting there From your home area 3.1 miles away About 12 min by car About 24 min by public transport Open in maps",
    );
    expect(words).toContain(
      "What it needs SIA door supervisor licence You have it, valid until 3 Mar 2027 CSAS accreditation Missing: ask the office.",
    );
    const order = ["Places 2 of 4 left", "Getting there", "What it needs", "Take shift"];
    const at = order.map((w) => words.indexOf(w));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("What it needs: an upload link where she can send it herself", () => {
    const html = render({
      state: "open",
      shift: summary,
      facts: {
        ...facts,
        requirements: [
          {
            ...facts.requirements[1]!,
            code: "FIRST_AID",
            name: "first aid at work certificate",
            chip: "First aid",
            uploadable: true,
          },
        ],
      },
    });
    expect(text(html)).toContain("First aid at work certificate Missing: upload it");
    const link = /<a [^>]*href="\/profile\/upload\/FIRST_AID"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain('aria-label="Upload your first aid at work certificate"');
  });

  it("held: when it can be taken", () => {
    const words = text(
      render({ state: "held", shift: summary, facts, opensAt: new Date("2026-11-02T09:15:00Z") }),
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
        facts,
      }),
    );
    expect(words).toContain("You're booked on this shift");
    // Getting there too: every shift page she can open shows how far it is (12H.2).
    expect(words).toContain("3.1 miles away About 12 min by car About 24 min by public transport");
    expect(words).not.toContain("Places");
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
