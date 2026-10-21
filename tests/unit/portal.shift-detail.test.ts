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
    expect(words).toContain("Sat 7 Nov 14:00–22:00");
    // The heading is the role (Phase 18: on the card, under the time); then the event, the site
    // and its address (12H.2).
    expect(html).toMatch(/<h1 id="shift-heading"[^>]*>Door supervisor<\/h1>/);
    expect(words).toContain("Gate A Riverside Festival Demo Arena 1 Test Road, Leeds, LS1 1AA");
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

  it("open: places as seats, Take shift in the bar and the strike note with the firm's notice", () => {
    const html = render({ state: "open", shift: summary, facts });
    const words = text(html);
    expect(words).toContain("Places 2 of 4 places left");
    expect(html.match(/data-seat="taken"/g)).toHaveLength(2);
    expect(html.match(/data-seat="free"/g)).toHaveLength(2);
    // The bar that stays at the bottom of the screen, above the tab bar.
    const bar = html.slice(html.indexOf("data-action-bar"));
    expect(bar).toMatch(
      /^data-action-bar="" class="sticky bottom-\[calc\(4\.75rem\+env\(safe-area-inset-bottom\)\)\]/,
    );
    expect(text(bar)).toContain(
      "Take shift Cancelling less than 48 hours before the start gives you a strike.",
    );
    const firmOf24 = text(
      render({
        state: "open",
        shift: { ...summary, placesLeft: 1 },
        facts: { ...facts, noticeHours: 24 },
      }),
    );
    expect(firmOf24).toContain("Places 1 of 4 places left");
    expect(firmOf24).toContain(
      "Cancelling less than 24 hours before the start gives you a strike.",
    );
  });
  it("open, in full (§4.4; Phase 18): the shift as a card, then getting there, places, what it needs, report to, bring and wear, pay", () => {
    const html = render({ state: "open", shift: summary, facts });
    const words = text(html);
    // Back to the list, then the card: urgent on a red band, the date tile, time and role.
    expect(html).toMatch(/<a class="[^"]*" href="\/shifts\/open">.*All open shifts<\/a>/);
    expect(html).toMatch(
      /<section aria-labelledby="shift-heading" class="[^"]*rounded-2xl[^"]*shadow-pass">/,
    );
    expect(words).toContain("Urgent, needed now Sat 7 Nov 14:00–22:00 Door supervisor");
    expect(html).toContain('role="img" aria-label="Saturday 7 November"');
    expect(words).toContain(
      "Getting there, from your home area 3.1 miles · 12 min by car · 24 min by public transport 12 min by car 24 min by public transport 3.1 mi away Open in maps",
    );
    expect(words).toContain(
      "You need SIA door supervisor licence You have it, valid until 3 Mar 2027 CSAS accreditation Missing: ask the office.",
    );
    // Each requirement a tag in its status's colours: green when she has it, red when not.
    expect(html).toMatch(
      /<li data-requirement="SIA_DS"[^>]*><span class="[^"]*bg-done-soft text-done-ink"/,
    );
    expect(html).toMatch(
      /<li data-requirement="CSAS"[^>]*><span class="[^"]*bg-urgent-soft text-urgent-ink"/,
    );
    expect(words).toContain("Report to Staff entrance on Mill Lane");
    expect(words).toContain("Bring and wear Black trousers and your hi-vis");
    expect(words).toContain("Pay £15.50 an hour, about £124.00");
    const order = [
      "Getting there",
      "Places",
      "You need",
      "Report to",
      "Bring and wear",
      "Pay",
      "Take shift",
    ];
    const at = order.map((w) => words.indexOf(w));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Not urgent: no band, an ink tile.
    const calm = render({ state: "open", shift: summary, facts: { ...facts, isUrgent: false } });
    expect(text(calm)).not.toContain("Urgent, needed now");
    expect(calm).not.toContain("border-urgent-fill");
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

  it("held: when it can be taken, over a dashed button that can't be tapped yet", () => {
    const html = render({
      state: "held",
      shift: summary,
      facts,
      opensAt: new Date("2026-11-02T09:15:00Z"),
    });
    const words = text(html);
    expect(words).toContain(
      "Offered first to people with fewer hours that week. You can take it from 09:15.",
    );
    expect(html).toMatch(
      /<button type="button" disabled="" class="[^"]*border-dashed">Take shift from 09:15<\/button>/,
    );
    // "Check again" reloads the page (the help page says to tap it then).
    expect(html).toMatch(/<a class="[^"]*" href="\/shifts\/[0-9a-f-]+">Check again<\/a>/);
  });
  it("booked: the instructions, Ask for a change and Can't make it?", () => {
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
    expect(words).toContain("3.1 miles · 12 min by car · 24 min by public transport");
    expect(words).not.toContain("Places");
    expect(words).toContain("Meet at gate C.");
    expect(words).toContain("Open in maps");
    expect(words).toContain("Ask for a change");
    // Phase 18: "Can't make it?" opens the sheet that cancels it; the way back is to her shifts.
    expect(words).toContain("Can't make it?");
    expect(words).toContain("Your shifts");
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

describe("ShiftView with travel areas switched off for the firm (13.4)", () => {
  it("Getting there has only the maps button; with no site, no Getting there at all", () => {
    const off: ShiftFacts = { ...facts };
    delete off.travel;
    const words = text(render({ state: "open", shift: summary, facts: off }));
    expect(words).toContain("Getting there Open in maps");
    expect(words).not.toMatch(/From your home area|miles|min by car|Distance not known/);
    const noSite = text(render({ state: "open", shift: { ...summary, site: null }, facts: off }));
    expect(noSite).not.toContain("Getting there");
  });
});
