import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import type { TakeShiftOutcome } from "@/lib/portal/take-shift";

// Open shifts (docs/screens.md, `/shifts/open`): the page body and the answers after "Take shift",
// rendered to HTML. The "Take shift" button uses Next's router, which only exists inside a running
// app, so a stand-in router is given here (the button's server call isn't made in these tests).
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { OpenShiftsView } = await import("@/app/shifts/open/open-shifts-view");
const { TakeShiftResult } = await import("@/app/shifts/open/take-shift-result");

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const arena = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo Arena",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Leeds",
  postcode: "LS1 1AA",
};
const list = (o: Partial<OpenShiftsList> = {}): OpenShiftsList => ({
  shifts: [],
  truncated: false,
  offerAlerts: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
  ...o,
});
const NOW = at("2026-11-07T09:00:00Z");
const render = (l: OpenShiftsList, filters = {}) =>
  renderToStaticMarkup(createElement(OpenShiftsView, { list: l, filters, timeZone: TZ, now: NOW }));

describe("Open shifts page body", () => {
  it("says so plainly when nothing is open", () => {
    const words = text(render(list()));
    expect(words).toContain("Open shifts");
    expect(words).toContain("Nothing open right now. We'll message you when something matches.");
    expect(words).toContain("Back to my shifts");
  });

  it("only promises a message to workers who want open shift messages", () => {
    const words = text(render(list({ offerAlerts: false })));
    expect(words).toContain("Nothing open right now. Check back later.");
    expect(words).not.toContain("We'll message you");
  });

  it("each row (§4.3; 12H.2): role · event linking to its page, site, when · £/hour · post, chips, places, travel", () => {
    const words = text(
      render(
        list({
          shifts: [
            {
              shiftId: "s1",
              role: "door_supervisor",
              startsAt: at("2026-11-07T14:00:00Z"),
              endsAt: at("2026-11-07T22:00:00Z"),
              placesLeft: 2,
              opensAt: null,
              isUrgent: false,
              site: arena,
              casualEvent: "Riverside Festival",
              payRatePence: 1550,
              post: "Gate A",
              requirements: [
                { code: "SIA_DS", name: "SIA door supervisor licence" },
                { code: "CSAS", name: "CSAS accreditation" },
              ],
              travel: {
                kind: "estimated",
                straightMetres: 4000,
                arriveBy: at("2026-11-07T13:30:00Z"),
                car: { minutes: 12, metres: 5000 },
                publicTransport: { minutes: 24 },
              },
            },
          ],
        }),
      ),
    );
    expect(words).toContain(
      "Door supervisor · Riverside Festival Demo Arena Sat 7 Nov, 14:00 to 22:00 · £15.50/hour · Gate A Needs: SIA DS , CSAS 2 places left 3.1 miles · 12 min by car · 24 min by public transport Take shift",
    );
    const html = render(list({ shifts: [] }));
    expect(html).not.toContain("data-requirements");
  });

  it("links each row's role · event to the shift's page", () => {
    const html = render(
      list({
        shifts: [
          {
            shiftId: "s1",
            role: "steward",
            startsAt: at("2026-11-07T14:00:00Z"),
            endsAt: at("2026-11-07T22:00:00Z"),
            placesLeft: 1,
            opensAt: null,
            isUrgent: false,
            site: null,
            casualEvent: null,
            travel: { kind: "unknown" },
          },
        ],
      }),
    );
    expect(html).toMatch(/<a [^>]*href="\/shifts\/s1"[^>]*>Steward<\/a>/);
  });

  it("shows each shift with its time, role, site, places left and a Take shift button", () => {
    const html = render(
      list({
        shifts: [
          {
            shiftId: "s1",
            role: "door_supervisor",
            startsAt: at("2026-11-07T14:00:00Z"),
            endsAt: at("2026-11-07T22:00:00Z"),
            placesLeft: 1,
            opensAt: null,
            travel: { kind: "unknown" },
            isUrgent: false,
            site: arena,
          },
          {
            shiftId: "s2",
            role: "steward",
            startsAt: at("2026-11-08T09:00:00Z"),
            endsAt: at("2026-11-08T17:00:00Z"),
            placesLeft: 3,
            opensAt: null,
            travel: { kind: "unknown" },
            isUrgent: false,
            site: null,
          },
        ],
        choices: {
          days: ["2026-11-07", "2026-11-08"],
          sites: [{ id: arena.id, name: arena.name }],
          roles: ["door_supervisor", "steward"],
        },
      }),
    );
    const words = text(html);
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor");
    expect(words).toContain("Demo Arena");
    // The address is on the shift's page, not the row (§4.3; 12H.2).
    expect(words).not.toContain("1 Test Road");
    expect(words).toContain("1 place left");
    expect(words).toContain("3 places left");
    expect(html.match(/>Take shift</g)).toHaveLength(2);
    // Filters: a plain form, so they work without JavaScript.
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(words).toContain("Any day");
    expect(html).toContain('value="2026-11-08"');
    expect(words).toContain("Sun 8 Nov");
    expect(words).toContain("Show shifts");
  });

  it("under fair rotation, shows a held shift with the time it opens instead of Take shift", () => {
    const html = render(
      list({
        shifts: [
          {
            shiftId: "s1",
            role: "door_supervisor",
            startsAt: at("2026-11-07T14:00:00Z"),
            endsAt: at("2026-11-07T22:00:00Z"),
            placesLeft: 1,
            opensAt: at("2026-11-07T09:15:00Z"),
            travel: { kind: "unknown" },
            isUrgent: false,
            site: null,
          },
        ],
      }),
    );
    expect(text(html)).toContain(
      "Offered first to people with fewer hours that week. You can take it from 09:15.",
    );
    expect(html).not.toContain(">Take shift<");
  });

  it("says when the list was cut short, pointing to the filters", () => {
    expect(text(render(list({ truncated: true })))).toContain(
      "These are the first open shifts. Choose a day, site or role to see others.",
    );
    expect(text(render(list()))).not.toContain("These are the first open shifts");
  });

  it("offers the whole list again when the filters match nothing", () => {
    const words = text(render(list(), { role: "steward" }));
    expect(words).toContain("No open shifts match.");
    expect(words).toContain("Show all open shifts");
    expect(words).not.toContain("Nothing open right now");
  });
});

describe("after Take shift", () => {
  it("links a refusal to the shift's page, to ask the office to review", () => {
    const html = renderToStaticMarkup(
      createElement(TakeShiftResult, {
        outcome: { status: "not_eligible", reasons: ["Your SIA licence expired on 3 Oct."] },
        reviewHref: "/shifts/11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(text(html)).toContain("Ask the office to review");
    expect(html).toContain('href="/shifts/11111111-1111-4111-8111-111111111111"');
  });

  const show = (outcome: Exclude<TakeShiftOutcome, { status: "logged_out" }>) =>
    text(renderToStaticMarkup(createElement(TakeShiftResult, { outcome })));

  it("confirms a booking with what, when, a reference and the firm's sign-off", () => {
    const words = show({
      status: "booked",
      ref: "3F2A9C1B",
      when: "Sat 7 Nov, 14:00 to 22:00",
      role: "Door supervisor",
      siteName: "Demo Arena",
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("You're booked.");
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor at Demo Arena");
    expect(words).toContain("Reference: 3F2A9C1B");
    expect(words).toContain("— Acme Events Shift Team");
    expect(words).toContain("See my shifts");
  });

  it("still confirms the booking, with its reference, if its details couldn't be read", () => {
    const words = show({
      status: "booked",
      ref: "3F2A9C1B",
      when: null,
      role: null,
      siteName: null,
      signOff: "Acme Events Shift Team",
    });
    expect(words).toContain("You're booked.");
    expect(words).toContain("Reference: 3F2A9C1B");
    expect(words).not.toContain("null");
  });

  it("answers every other outcome in plain words", () => {
    expect(show({ status: "filled" })).toContain(
      "Just filled. Someone else took this shift a moment ago.",
    );
    expect(show({ status: "already_assigned" })).toContain("You're already booked on this shift.");
    expect(show({ status: "gone" })).toContain("This shift isn't open any more.");
    const refused = show({
      status: "not_eligible",
      reasons: ["You're already booked at 10:00 that day."],
    });
    expect(refused).toContain("You can't take this shift:");
    expect(refused).toContain("You're already booked at 10:00 that day.");
    expect(refused).toContain("If you think this is wrong, ask the office to review it.");
    // Without the shift's page to go to, no link.
    expect(refused).not.toContain("Ask the office to review");
    expect(show({ status: "not_yet", opensAt: "14:15" })).toContain(
      "This shift is offered first to people with fewer hours that week. You can take it from 14:15.",
    );
    expect(show({ status: "try_again" })).toContain(
      "We can't confirm this shift right now. Try again in a few minutes.",
    );
    expect(show({ status: "error" })).toContain("Something went wrong. Try again.");
  });
});
