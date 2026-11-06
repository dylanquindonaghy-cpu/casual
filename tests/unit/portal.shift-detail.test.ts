import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewOutcome } from "@/lib/portal/request-kinds";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import { REASONS } from "@/lib/rules/reasons";
import { travelLineText } from "@/lib/travel/line-copy";
import { btn, chip, staffBtn, tag } from "@/app/ui/classes";

// One shift's page (docs/screens.md, `/shifts/[id]`), rendered for each state, and the answers
// after "Ask the office to review". The buttons use Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { ReviewResult } = await import("@/app/shifts/[id]/review-form");

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
// Words as React writes them into HTML (an apostrophe is &#x27;), for matching an exact element.
const asHtml = (words: string) =>
  words
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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
      chip: "SIA door supervisor licence",
      status: { status: "valid", expiresOn: "2027-03-03", renewing: false },
      uploadable: true,
    },
    {
      code: "CSAS",
      name: "CSAS accreditation",
      chip: "CSAS accreditation",
      status: { status: "missing", expiresOn: null, renewing: false },
      uploadable: false,
    },
  ],
  noticeHours: 48,
  strikesOn: true,
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
        "Your SIA door supervisor licence expired on 3 Oct. Once you've renewed it, tell the office under Messages.",
      ],
      review: null,
    });
    const words = text(html);
    expect(words).toContain("Sat 7 Nov 14:00–22:00");
    // The heading is the role (under the time); then, in the card, where: the event and the site,
    // its address (12H.2), the post on a glass plate (round 7).
    expect(html).toMatch(/<h1 id="shift-heading"[^>]*>Door supervisor<\/h1>/);
    expect(words).toContain("Riverside Festival · Demo Arena 1 Test Road, Leeds, LS1 1AA Gate A");
    // Phase 28.5: the gate plate is clear glass (`glass-button`), 8px round.
    expect(html).toMatch(/<span class="glass-button shrink-0 rounded-row [^"]*">Gate A<\/span>/);
    expect(words).toContain(
      "You can't take this shift: Your SIA door supervisor licence expired on 3 Oct. Once you've renewed it, tell the office under Messages.",
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
    // Round 7 (Phase 24): Take shift floats at the foot of the screen (a shift's page has no tab
    // bar) over a soft frosted strip, no line, no shadow; the strike note under it.
    const bar = html.slice(html.indexOf("data-action-bar"));
    expect(bar).toMatch(
      /^data-action-bar="" class="foot-edge sticky bottom-0 z-10 -mx-4 mt-5 -mb-6 px-4 pt-3 pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\] /,
    );
    expect(bar.slice(0, bar.indexOf(">"))).not.toMatch(/(?<![\w-])(?:shadow-|glass-float)/);
    expect(bar.slice(0, bar.indexOf(">"))).not.toContain("border-t");
    expect(text(bar)).toContain(
      "Take shift Cancelling less than 48 hours before the start gives you a strike. A strike is a record, not a fine. It never comes off your pay.",
    );
    expect(bar).toMatch(
      /<\/button><p class="mt-2 text-center text-base text-ink-muted">Cancelling less than 48 hours/,
    );
    expect(readFileSync("src/app/shifts/[id]/page.tsx", "utf8")).not.toMatch(/TabBar/);
    const firmOf24 = text(
      render({
        state: "open",
        shift: { ...summary, placesLeft: 1 },
        facts: { ...facts, noticeHours: 24 },
      }),
    );
    expect(firmOf24).toContain("Places 1 of 4 places left");
    expect(firmOf24).toContain(
      "Cancelling less than 24 hours before the start gives you a strike. A strike is a record, not a fine. It never comes off your pay.",
    );
  });
  it("open, in full (§4.4; Phases 18, 20 and 24): its own bar back, the urgent band, the time by its tile, then a card each: getting there, places, what it needs, report to, bring and wear, pay", () => {
    const html = render({ state: "open", shift: summary, facts });
    const words = text(html);
    // Round 7: its own bar at the top with the way back (the firm's bar hides while it's here),
    // sticky once the page runs, frosting when scrolled; a glass card topped by the urgent band
    // (red, white words); the date tile (pale red), the time, the day and how long, the role, its
    // chips; then a glass card for each fact.
    expect(html).toMatch(
      /^<div data-own-bar="" class="scroll-edge relative z-20 -mx-4 -mt-6 mb-2 flex items-center justify-between gap-3 px-4 pt-1 sm:-mx-6 sm:px-6 \[html\[data-js\]_&amp;\]:sticky \[html\[data-js\]_&amp;\]:top-0"><a class="[^"]*" href="\/shifts\/open"><svg[\s\S]*?<\/svg>Open shifts<\/a><\/div>/,
    );
    // Phase 28.5: the card is a section's 12px round, opened by the urgent slip (28.1's: a pale red
    // tint, a 1px red edge, the urgent disc) in place of the solid red band.
    expect(html).toMatch(
      /<section aria-labelledby="shift-heading" class="glass animate-open rounded-inner"><div class="flex flex-col gap-4 p-4"><div data-slip="urgent" class="flex items-start gap-3 rounded-row border px-4 py-3 text-base text-ink border-urgent-line bg-urgent-soft"><span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-full bg-urgent-tile text-urgent-ink"><svg[\s\S]*?<\/svg><\/span><div class="[^"]*"><p class="font-semibold">Urgent, needed now<\/p><\/div><\/div>/,
    );
    expect(html).not.toContain("bg-urgent-fill");
    // No chips of what it needs under the role (the review's note 13): "You need" lists them.
    expect(words).toContain(
      "Urgent, needed now Sat 7 Nov 14:00–22:00 Saturday 7 November · 8 hours Door supervisor Riverside Festival · Demo Arena",
    );
    expect(html).not.toContain("data-requirements");
    expect(words).not.toContain("Needs:");
    // The day in words under the time, so the tile is only seen.
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*bg-urgent-tile text-urgent-ink"><span class="block font-medium text-sm">Sat<\/span>/,
    );
    expect(html).not.toContain('role="img" aria-label="Saturday 7 November"');
    expect(html).toMatch(
      /<p class="font-sign text-3xl whitespace-nowrap text-ink">14:00–22:00<\/p>/,
    );
    // No "Urgent" chip under the red band (Phase 27.2): the band says it.
    expect(html).not.toMatch(
      /<span class="glass-tile rounded-\[10px\] px-2\.5 py-1 text-base font-medium text-urgent-ink">Urgent<\/span>/,
    );
    const cards = [
      ...html.matchAll(
        /<section aria-labelledby="([a-z-]+)-heading" class="glass flex flex-col gap-3 rounded-inner p-4"><h2 id="\1-heading" class="text-lg font-semibold text-ink">([^<]+)<\/h2>/g,
      ),
    ].map((m) => m[2]);
    expect(cards).toEqual([
      "Getting there, from your travel area",
      "Places",
      "You need",
      "Report to",
      "Bring and wear",
      "Pay",
    ]);
    expect(words).toContain(
      "Getting there, from your travel area 3.1 miles · 12 min by car · 24 min by public transport 3.1 miles away 12 min by car 24 min by public transport Directions",
    );
    expect(html).toMatch(
      /<svg[^>]*><path d="M9 4\.5 3\.5 6\.5v13l5\.5-2 6 2 5\.5-2v-13l-5\.5 2zM9 4\.5v13M15 6\.5v13"><\/path><\/svg>Directions<\/a>/,
    );
    // Phase 28.5: one only the office can sort ends with "Message the office", a link to Messages
    // about this shift (28.2's contract), 44px tall.
    expect(words).toContain(
      "You need SIA door supervisor licence You have it, valid until 3 Mar 2027 CSAS accreditation Missing. Message the office",
    );
    expect(html).toContain(
      `<a aria-label="Message the office about your CSAS accreditation" class="${btn.link}" href="/messages?shift=${summary.shiftId}&amp;about=other">Message the office</a>`,
    );
    // Each requirement with a mark in its status's colours: green when she has it, red when not.
    expect(html).toMatch(
      /<li data-requirement="SIA_DS"[^>]*><span class="[^"]*"><span aria-hidden="true" class="[^"]*bg-done-tile text-done-ink"/,
    );
    expect(html).toMatch(
      /<li data-requirement="CSAS"[^>]*><span class="[^"]*"><span aria-hidden="true" class="[^"]*bg-urgent-tile text-urgent-ink"/,
    );
    expect(words).toContain("Report to Staff entrance on Mill Lane");
    expect(words).toContain("Bring and wear Black trousers and your hi-vis");
    expect(words).toContain("Pay £15.50 an hour, about £124.00 before tax");
    const order = [
      "Door supervisor",
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
    // Not urgent: no band, a clear glass tile (Phase 24; grey before; the office's `glass-button`
    // since Phase 28), the places left plain.
    const calm = render({ state: "open", shift: summary, facts: { ...facts, isUrgent: false } });
    expect(text(calm)).not.toContain("Urgent, needed now");
    expect(calm).toMatch(
      /<span aria-hidden="true" class="[^"]*glass-button text-ink"><span class="block font-medium text-sm">Sat<\/span>/,
    );
    expect(calm).not.toContain(">Urgent</span>");
    // The places as big seats (round 7, 30px; round since Phase 28, as the office's), the free ones
    // red when urgent; their words on a tag (28.1's), the urgent chip's pale red when urgent (28.5).
    expect(calm).toContain(`<span data-places-left="" class="${tag}">2 of 4 places left</span>`);
    expect(html).toContain(
      `<span data-places-left="" class="${chip.base} ${chip.urgent}">2 of 4 places left</span>`,
    );
    expect(
      html.match(
        /data-seat="free" class="size-7\.5 rounded-full border-\[1\.5px\] border-urgent"/g,
      ),
    ).toHaveLength(2);
    expect(
      calm.match(
        /data-seat="free" class="size-7\.5 rounded-full border-\[1\.5px\] border-ink-muted"/g,
      ),
    ).toHaveLength(2);
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
    expect(words).toContain("Directions");
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
    expect(words).toContain("Getting there Directions");
    expect(words).not.toMatch(/from your travel area|miles|min by car|Distance not known/);
    const noSite = text(render({ state: "open", shift: { ...summary, site: null }, facts: off }));
    expect(noSite).not.toContain("Getting there");
  });
});

// Phase 27.2 (C2, C3): the pay estimate is before tax, and a session with no rate still has a Pay
// card, saying to ask the office.
describe("ShiftView: pay", () => {
  it("the estimate says before tax", () => {
    const html = render({ state: "open", shift: summary, facts });
    expect(text(html)).toContain(
      "Pay £15.50 an hour, about £124.00 before tax £15.50 an hour About £124.00 before tax for the 8 hours",
    );
  });

  // Phase 28.5 (the review's major 2): "Ask the office" was plain text with no way to ask.
  it("no rate set: Not given yet, and Ask the office about the pay, a link to Messages about it", () => {
    const html = render({ state: "open", shift: summary, facts: { ...facts, payRatePence: null } });
    const pay = html.slice(html.indexOf('<h2 id="pay-heading"'));
    expect(pay).toMatch(
      /^<h2 id="pay-heading" class="text-lg font-semibold text-ink">Pay<\/h2><p class="text-lg text-ink">Not given yet\.<\/p><a class="[^"]*min-h-13[^"]*" href="([^"]+)"><svg[\s\S]*?<\/svg>Ask the office about the pay<\/a><\/section>/,
    );
    expect(pay).toContain(`href="/messages?shift=${summary.shiftId}&amp;about=pay"`);
    expect(text(html)).not.toContain("an hour");
  });
});

// Phase 28.5 (docs/screens.md "The casual app, Phase 28" 28.5): the firm in the page's own bar,
// the travel line until the times are known, the strike note inside the notice, the blocked
// reasons that send her to the office, and her booking's links and change marker.
describe("ShiftView, Phase 28.5", () => {
  const firm = { name: "Acme Events", logoUrl: null };
  const booking = (o: { status?: "confirmed" | "completed" } = {}) => ({
    assignmentId: "22222222-2222-4222-8222-222222222222",
    shiftId: summary.shiftId,
    role: "door_supervisor",
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    status: o.status ?? ("confirmed" as const),
    instructions: "Meet at gate C.",
    site,
  });
  const at = (page: ShiftPage, now: Date) =>
    renderToStaticMarkup(createElement(ShiftView, { page, timeZone: TZ, now, firm }));
  const HOUR = 3_600_000;

  it("the page's own bar names the firm beside the way back: its mark and its name", () => {
    const html = at({ state: "open", shift: summary, facts }, NOW);
    expect(html).toMatch(
      /^<div data-own-bar=""[^>]*><a class="[^"]*" href="\/shifts\/open"><svg[\s\S]*?<\/svg>Open shifts<\/a><span data-firm="" [^>]*><span aria-hidden="true" class="[^"]*rounded-row bg-brand-bar[^"]*">A<\/span><span class="[^"]*">Acme Events<\/span><\/span><\/div>/,
    );
    const logo = renderToStaticMarkup(
      createElement(ShiftView, {
        page: { state: "missing" },
        timeZone: TZ,
        now: NOW,
        firm: { name: "Acme Events", logoUrl: "https://acme.example/logo.png" },
      }),
    );
    expect(logo).toMatch(/<img src="https:\/\/acme\.example\/logo\.png" alt=""/);
    expect(text(logo)).toContain("Acme Events");
  });

  it("travel not worked out yet: one sentence from the travel line in place of the figure tiles", () => {
    const straight = { kind: "straight", straightMetres: 3200 } as const;
    const html = at({ state: "open", shift: summary, facts: { ...facts, travel: straight } }, NOW);
    expect(html).toContain(
      `<p data-travel-line="" class="text-lg text-ink">${asHtml(travelLineText(straight, TZ))}</p>`,
    );
    const gettingThere = html.slice(
      html.indexOf('id="getting-there-heading"'),
      html.indexOf('id="places-heading"'),
    );
    expect(gettingThere).not.toMatch(/grid-cols-|font-sign/);
    const unknown = at(
      { state: "open", shift: summary, facts: { ...facts, travel: { kind: "unknown" } } },
      NOW,
    );
    expect(text(unknown)).toContain(travelLineText({ kind: "unknown" }, TZ));
  });

  it("inside the firm's notice, the strike note names the hours; strikes off, no note", () => {
    const soon = new Date(summary.startsAt.getTime() - 37.5 * HOUR);
    const bar = (html: string) => text(html.slice(html.indexOf("data-action-bar")));
    expect(bar(at({ state: "open", shift: summary, facts }, soon))).toContain(
      "Take shift This shift starts in 37 hours. If you cancel it, you'll get a strike.",
    );
    const off = bar(
      at({ state: "open", shift: summary, facts: { ...facts, strikesOn: false } }, soon),
    );
    expect(off).toContain("Take shift");
    expect(off).not.toMatch(/strike/i);
  });

  it("blocked: the reasons keep the rules' words; Message the office only where one sends her there", () => {
    const office = at(
      {
        state: "blocked",
        shift: summary,
        facts,
        reasons: [REASONS.blocked_site(), REASONS.weekly_hours()],
        codes: ["blocked_site", "weekly_hours"],
        review: null,
      },
      NOW,
    );
    expect(text(office)).toContain(
      "You can't take this shift: This site isn't available to you. Contact the office. This would take you over your weekly hours limit. Message the office",
    );
    expect(office).toMatch(
      new RegExp(
        `<a class="[^"]*min-h-13[^"]*" href="/messages\\?shift=${summary.shiftId}&amp;about=other"><svg[\\s\\S]*?</svg>Message the office</a>`,
      ),
    );
    const hours = at(
      {
        state: "blocked",
        shift: summary,
        facts: { ...facts, requirements: [] },
        reasons: [REASONS.weekly_hours()],
        codes: ["weekly_hours"],
        review: null,
      },
      NOW,
    );
    expect(text(hours)).not.toContain("Message the office");
  });

  it("booked, days off: Add to my calendar (a download), no Running late?", () => {
    const html = at({ state: "booked", shift: booking(), facts }, NOW);
    expect(html).toContain(
      `<a href="/shifts/${summary.shiftId}/calendar" download="" class="${staffBtn.secondary}"><svg`,
    );
    expect(text(html)).toContain("Add to my calendar");
    expect(text(html)).not.toContain("Running late?");
    expect(text(html)).not.toContain("The times changed");
    expect(text(html)).not.toContain("Changed since you booked");
  });

  it("booked, starting within 3 hours: Running late? (about=late); under way: Message the office (about=started)", () => {
    const soon = at(
      { state: "booked", shift: booking(), facts },
      new Date(summary.startsAt.getTime() - 2 * HOUR),
    );
    expect(soon).toContain(`href="/messages?shift=${summary.shiftId}&amp;about=late"`);
    expect(soon).not.toContain("about=started");
    // Under the shift's card, before Getting there.
    const words = text(soon);
    expect(words.indexOf("Running late?")).toBeGreaterThan(
      words.indexOf("You're booked on this shift"),
    );
    expect(words.indexOf("Running late?")).toBeLessThan(words.indexOf("Getting there"));
    const under = at(
      { state: "booked", shift: booking(), facts },
      new Date(summary.startsAt.getTime() + HOUR),
    );
    expect(under).toContain(`href="/messages?shift=${summary.shiftId}&amp;about=late"`);
    expect(under).toContain(`href="/messages?shift=${summary.shiftId}&amp;about=started"`);
    expect(text(under)).toContain("Message the office");
    expect(text(under)).not.toMatch(/contact the office/i);
    // Marked worked by the office: nothing to say on the day.
    const marked = at(
      { state: "booked", shift: booking({ status: "completed" }), facts },
      new Date(summary.startsAt.getTime() + HOUR),
    );
    expect(text(marked)).not.toContain("Running late?");
    expect(marked).not.toContain("/calendar");
  });

  it("booked and ended with no rate: the pay link is payroll's pay query, never Messages (golden rule 9)", () => {
    const html = at(
      { state: "booked", shift: booking(), facts: { ...facts, payRatePence: null } },
      new Date(summary.endsAt.getTime() + HOUR),
    );
    expect(html).toContain(`href="/pay/query?shift=${summary.shiftId}"`);
    expect(text(html)).toContain("Pay Not given yet. Raise a pay query");
    expect(html).not.toContain("about=pay");
    expect(html).not.toContain("/calendar");
    expect(text(html)).not.toContain("Running late?");
  });

  it("booked: what changed since she booked on an amber slip, and the times changed above the calendar", () => {
    const html = at(
      {
        state: "booked",
        shift: booking(),
        facts,
        changes: { fields: ["instructions", "meetingPoint"], at: new Date("2026-11-03T14:05:00Z") },
        timesChanged: true,
      },
      NOW,
    );
    expect(html).toMatch(
      /<div role="note" data-slip="attention" class="[^"]*border-attention-line bg-attention-soft"><span[\s\S]*?<\/span><div class="[^"]*"><p data-changed-since="">Changed since you booked: instructions and meeting point \(Tue 3 Nov, 14:05\)<\/p>/,
    );
    expect(text(html)).toContain(
      "The times changed. Add it to your calendar again. Add to my calendar",
    );
  });
});
