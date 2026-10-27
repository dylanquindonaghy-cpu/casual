import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
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
  travelOn: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
  ...o,
});
const NOW = at("2026-11-07T09:00:00Z");
const STRIP = shiftsStrip(NOW, TZ, [], []);
const render = (l: OpenShiftsList, filters = {}, strip = STRIP) =>
  renderToStaticMarkup(
    createElement(OpenShiftsView, { list: l, filters, strip, timeZone: TZ, now: NOW }),
  );

const shift = (o: Partial<OpenShift> & { shiftId: string }): OpenShift => ({
  role: "steward",
  startsAt: at("2026-11-07T14:00:00Z"),
  endsAt: at("2026-11-07T22:00:00Z"),
  placesLeft: 2,
  headcount: 4,
  opensAt: null,
  isUrgent: false,
  site: arena,
  casualEvent: "Riverside Festival",
  payRatePence: 1260,
  post: null,
  requirements: [],
  ...o,
});

// The cards in a section, by its heading's id.
const cardsIn = (html: string, id: string) => {
  const at = html.indexOf(`aria-labelledby="${id}"`);
  if (at < 0) return [];
  const section = html.slice(at, html.indexOf("</section>", at));
  return [...section.matchAll(/<li class="animate-in">(.*?)<\/li>/g)].map((m) => m[1] ?? "");
};

describe("Open shifts page body (Phase 18)", () => {
  it("says so plainly when nothing is open, and what limits the list", () => {
    const words = text(render(list()));
    expect(words).toContain("Open shifts");
    expect(words).toContain(
      "Only shifts your licences and hours allow, up to 45 minutes from home.",
    );
    expect(words).toContain("Nothing open right now. We'll message you when something matches.");
    // No "Back" button: the tab bar under every casual page goes there (Phase 17).
    expect(words).not.toContain("Back to my shifts");
    expect(text(render(list({ area: null })))).toContain(
      "Only shifts your licences and hours allow.",
    );
  });

  it("only promises a message to workers who want open shift messages", () => {
    const words = text(render(list({ offerAlerts: false })));
    expect(words).toContain("Nothing open right now. Check back later.");
    expect(words).not.toContain("We'll message you");
  });

  it("the next 8 days as a strip: booked filled in, urgent and open days counted and linked", () => {
    const strip = shiftsStrip(
      NOW,
      TZ,
      [
        { startsAt: at("2026-11-08T09:00:00Z"), isUrgent: true },
        { startsAt: at("2026-11-10T09:00:00Z"), isUrgent: false },
      ],
      ["2026-11-09"],
    );
    const html = render(list(), {}, strip);
    const section = html.slice(html.indexOf('aria-label="Your next 8 days"'));
    const days = [...section.matchAll(/<li class="min-w-0">(.*?)<\/li>/g)].map((m) => m[1] ?? "");
    expect(days).toHaveLength(8);
    // Phase 20: each day its own card (clear glass since Phase 24). Today first, its day in bold;
    // nothing open: not a link.
    expect(days[0]).toMatch(
      /^<span role="img" aria-label="Sat 7 Nov, today: nothing open" class="[^"]*glass-tile text-ink-muted"><span class="text-xs leading-tight font-semibold">Today<\/span>/,
    );
    expect(days[4]).toMatch(/<span class="text-xs leading-tight ">Wed<\/span>/);
    // An urgent day: a link to that day, pale red, with its count.
    expect(days[1]).toMatch(
      /^<a aria-label="Sun 8 Nov: 1 urgent shift" class="[^"]*bg-urgent-tile text-urgent-ink shadow-lift[^"]*" href="\/shifts\/open\?day=2026-11-08">/,
    );
    expect(days[1]).toMatch(/rounded-md px-1 text-xs font-semibold ">1<\/span>/);
    // Her booked day: in the firm's colour, raised like the pass, with a tick.
    expect(days[2]).toMatch(
      /^<span role="img" aria-label="Mon 9 Nov: you&#x27;re booked" class="[^"]*bg-brand text-on-brand shadow-pass/,
    );
    expect(days[2]).toContain("<svg");
    // An open day: an outlined count.
    expect(days[3]).toMatch(/href="\/shifts\/open\?day=2026-11-10"/);
    expect(days[3]).toMatch(/border-\[1\.5px\] border-line-strong">1<\/span>/);
    expect(text(section)).toContain("You're booked Urgent Open");
    // The day chosen is marked.
    expect(render(list(), { day: "2026-11-08" }, strip)).toMatch(
      /aria-current="true"[^>]*href="\/shifts\/open\?day=2026-11-08"/,
    );
  });

  it("urgent shifts first, under their own heading, then the rest; each a card opening its page", () => {
    const html = render(
      list({
        shifts: [
          shift({ shiftId: "u1", isUrgent: true }),
          shift({ shiftId: "n1" }),
          shift({ shiftId: "n2" }),
        ],
      }),
    );
    expect(text(html)).toContain("Urgent, needed now");
    expect(text(html)).toContain("More shifts you can apply for");
    const urgent = cardsIn(html, "urgent-heading");
    const more = cardsIn(html, "more-heading");
    expect(urgent.map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1])).toEqual(["u1"]);
    expect(more.map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1])).toEqual(["n1", "n2"]);
    // The urgent card's date tile is pale red and says so to a screen reader; the others grey.
    expect(urgent[0]).toContain("bg-urgent-tile text-urgent-ink");
    expect(text(urgent[0] ?? "")).toMatch(/^ ?Sat 7 Nov Urgent\./);
    expect(more[0]).not.toContain("urgent-tile");
    expect(more[0]).toContain("glass-tile text-ink");
    // A card of glass (Phase 24; a hairline card lifted off the page in Phases 17 and 20), no red
    // frame; taking it is on its page.
    expect(more[0]).toMatch(/class="flex items-start gap-3.5 glass rounded-\[22px\] p-4 /);
    expect(more[0]).not.toMatch(/(?<![\w-])(?:border-urgent|shadow-[a-z]+)(?![\w-])/);
    expect(html).not.toContain(">Take shift<");
    // The rest in date order, like the strip, whatever order they came in (nearest first).
    const mixed = render(
      list({
        shifts: [
          shift({
            shiftId: "late",
            startsAt: at("2026-11-10T09:00:00Z"),
            endsAt: at("2026-11-10T17:00:00Z"),
          }),
          shift({
            shiftId: "soon",
            startsAt: at("2026-11-08T09:00:00Z"),
            endsAt: at("2026-11-08T17:00:00Z"),
          }),
          shift({
            shiftId: "u9",
            isUrgent: true,
            startsAt: at("2026-11-11T09:00:00Z"),
            endsAt: at("2026-11-11T17:00:00Z"),
          }),
        ],
      }),
    );
    expect(
      cardsIn(mixed, "more-heading").map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1]),
    ).toEqual(["soon", "late"]);
    expect(
      cardsIn(mixed, "urgent-heading").map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1]),
    ).toEqual(["u9"]);
    // With nothing urgent: one heading.
    const plain = render(list({ shifts: [shift({ shiftId: "n1" })] }));
    expect(text(plain)).toContain("Shifts you can apply for");
    expect(text(plain)).not.toContain("Urgent, needed now");
  });

  it("each card (§4.3; 12H.2): date tile, time, role, event and post, the travel line (both ways), seats, places, pay", () => {
    const html = render(
      list({
        shifts: [
          shift({
            shiftId: "s1",
            role: "door_supervisor",
            payRatePence: 1550,
            post: "Gate A",
            placesLeft: 1,
            headcount: 4,
            requirements: [{ code: "SIA_DS", name: "SIA door supervisor licence" }],
            travel: {
              kind: "estimated",
              straightMetres: 4000,
              arriveBy: at("2026-11-07T13:30:00Z"),
              car: { minutes: 12, metres: 5000 },
              publicTransport: { minutes: 24 },
            },
          }),
        ],
      }),
    );
    const card = cardsIn(html, "more-heading")[0] ?? "";
    expect(text(card)).toContain(
      "Sat 7 Nov 14:00–22:00 £15.50/hour Door supervisor Riverside Festival, Gate A 3.1 miles · 12 min by car · 24 min by public transport 1 place left",
    );
    // Not urgent: "1 place left" plain (red only on urgent shifts: Phase 20).
    expect(card).toContain('<span class="text-base text-ink">1 place left</span>');
    // The travel line shows, both ways (no drive on its own: 12G.3).
    expect(card).toContain('<span class="text-base text-ink-muted" data-travel-line="">');
    // Seats: 3 taken, 1 free.
    expect(card.match(/data-seat="taken"/g)).toHaveLength(3);
    expect(card.match(/data-seat="free"/g)).toHaveLength(1);
    // What it needs is on the shift's page.
    expect(html).not.toContain("data-requirements");
    // A night shift says when it finishes; the event's name falls back to the site's.
    const night = render(
      list({
        shifts: [
          shift({
            shiftId: "n",
            casualEvent: null,
            startsAt: at("2026-11-07T19:00:00Z"),
            endsAt: at("2026-11-08T01:00:00Z"),
          }),
        ],
      }),
    );
    expect(text(night)).toContain(
      "19:00–01:00 £12.60/hour Steward Finishes Sunday morning Demo Arena",
    );
  });

  it("under fair rotation, a held shift says when she can take it", () => {
    const html = render(
      list({ shifts: [shift({ shiftId: "s1", opensAt: at("2026-11-07T09:15:00Z") })] }),
    );
    expect(text(html)).toContain("You can take it from 09:15");
    expect(html).toContain("bg-hivis");
  });

  it("says when the list was cut short, pointing to the filters; the filters right under the strip", () => {
    expect(text(render(list({ truncated: true })))).toContain(
      "These are the first open shifts. Choose a day, site or role to see others.",
    );
    expect(text(render(list()))).not.toContain("These are the first open shifts");
    const html = render(
      list({
        shifts: [shift({ shiftId: "s1" })],
        choices: {
          days: ["2026-11-07", "2026-11-08"],
          sites: [{ id: arena.id, name: arena.name }],
          roles: ["door_supervisor", "steward"],
        },
      }),
    );
    // A plain form, so it works without JavaScript: right under the strip (Phase 20), before the
    // shifts; a day, a site and a role as chips, and its button.
    expect(html).toMatch(
      /aria-label="Your next 8 days"[\s\S]*?<\/section><form aria-label="Choose a day, site or role" class="-mt-2 grid grid-cols-2 gap-2" method="get">/,
    );
    expect(html.indexOf("<form")).toBeLessThan(html.indexOf('id="more-heading"'));
    for (const name of ["day", "site", "role"])
      expect(html).toMatch(new RegExp(`<select name="${name}" class="[^"]*rounded-full[^"]*">`));
    expect(html.match(/<span class="sr-only">(Day|Site|Role)<\/span>/g)).toHaveLength(3);
    expect(html).not.toContain("<details");
    expect(text(html)).toContain("Any day");
    expect(html).toContain('value="2026-11-08"');
    expect(text(html)).toContain("Sun 8 Nov");
    expect(text(html)).toContain("Show shifts");
  });

  it("offers the whole list again when the filters match nothing", () => {
    const words = text(render(list(), { role: "steward" }));
    expect(words).toContain("No open shifts match.");
    expect(words).toContain("Show all open shifts");
    expect(words).not.toContain("Nothing open right now");
    expect(
      render(list(), { role: "steward" }).match(/href="\/shifts\/open"[^>]*>Show all open shifts/g),
    ).toHaveLength(1);
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

  it("too many taps (13.5): how long to wait, as the login page says it", () => {
    expect(show({ status: "rate_limited", retryAfterMinutes: 12 }).trim()).toBe(
      "Too many tries. Try again in 12 minutes.",
    );
    expect(show({ status: "rate_limited", retryAfterMinutes: 1 }).trim()).toBe(
      "Too many tries. Try again in 1 minute.",
    );
  });

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
    // It goes to her shifts, where this one arrives marked "New" (Phase 18).
    const html = renderToStaticMarkup(
      createElement(TakeShiftResult, {
        outcome: {
          status: "booked",
          ref: "3F2A9C1B",
          when: null,
          role: null,
          siteName: null,
          signOff: "Acme Events Shift Team",
        },
        shiftId: "s1",
      }),
    );
    expect(html).toMatch(/href="\/shifts\?new=s1"[^>]*>See my shifts</);
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
      "Someone else took it first. You haven't been booked.",
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
