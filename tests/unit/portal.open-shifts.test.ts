import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import { chip, countPill, emptyBox, tag } from "@/app/ui/classes";
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
    const html = render(list());
    const words = text(html);
    expect(words).toContain("Open shifts");
    // What she sees, and her travel area (Phase 27.2: one name for it).
    expect(words).toContain("Shifts you can take, inside your travel area (up to 45 minutes).");
    expect(words).toContain("Nothing open right now. We'll message you when something matches.");
    // No "Back" button: the tab bar under every casual page goes there (Phase 17).
    expect(words).not.toContain("Back to my shifts");
    expect(text(render(list({ area: null })))).toContain("Shifts you can take.");
    expect(text(render(list({ area: null })))).not.toContain("travel area (up to");
    // How many there are, over the list.
    expect(html).toContain('<p class="text-lg text-ink-muted">0 shifts</p>');
    // Phase 28 (28.8): the one empty state (no dashed frame) in its section, which keeps its frame
    // and heading but shows no count.
    expect(cardsIn(html, "more-heading")).toEqual([]);
    expect(html).toContain(
      `<section aria-labelledby="more-heading" class="glass flex flex-col gap-2 rounded-inner p-3"><div class="flex items-center gap-3 px-1 pt-1"><h2 id="more-heading" class="text-lg font-semibold tracking-heading text-ink">Shifts you can take</h2></div><p class="${emptyBox}">Nothing open right now. We&#x27;ll message you when something matches.</p></section>`,
    );
    expect(html).not.toContain("border-dashed");
    // No day has anything on it, so no strip (a day with nothing has no tile).
    expect(html).not.toContain("Your next 8 days");
  });

  it("only promises a message to workers who want open shift messages", () => {
    const words = text(render(list({ offerAlerts: false })));
    expect(words).toContain("Nothing open right now. Check back later.");
    expect(words).not.toContain("We'll message you");
  });

  it("never promises a message to a casual nothing can reach, even with her alerts on (as Home, 28.7)", () => {
    // Her alerts are on, but no phone, text or email reaches her (reach-me's "unreachable"): Home
    // tells her "We can't reach you about shifts", so this page mustn't say we'll message her.
    const view = (l: OpenShiftsList, canReach: boolean, filters = {}) =>
      text(
        renderToStaticMarkup(
          createElement(OpenShiftsView, {
            list: l,
            filters,
            strip: STRIP,
            timeZone: TZ,
            now: NOW,
            canReach,
          }),
        ),
      );
    const nothing = view(list(), false);
    expect(nothing).toContain("Nothing open right now. Check back later.");
    expect(nothing).not.toContain("We'll message you");
    // Only urgent shifts open: the line under them too.
    const urgentOnly = list({ shifts: [shift({ shiftId: "u1", isUrgent: true })] });
    const cut = view(urgentOnly, false);
    expect(cut).toContain("Nothing else open right now. Check back later.");
    expect(cut).not.toContain("We'll message you");
    // A filter matching nothing makes no promise either way.
    expect(view(list(), false, { role: "steward" })).toContain("No open shifts match.");
    // Something reaches her: the promise stays.
    expect(view(list(), true)).toContain(
      "Nothing open right now. We'll message you when something matches.",
    );
    expect(view(urgentOnly, true)).toContain(
      "Nothing else open right now. We'll message you when a shift comes up.",
    );
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
    const days = [...section.matchAll(/<li class="shrink-0">(.*?)<\/li>/g)].map((m) => m[1] ?? "");
    // Phase 28 (28.8): a tile only for a day with something on it (today and the other empty days
    // have none), 48px wide and 8px round, 8px apart in a row that scrolls sideways inside itself
    // (rule 11's 44px targets: the review measured round 7's at 39.5px).
    expect(days).toHaveLength(3);
    expect(section).not.toContain("nothing open");
    expect(section).toMatch(
      /^aria-label="Your next 8 days"><ul role="list" class="scrollbar-none fade-x -mx-1 flex gap-2 overflow-x-auto p-1">/,
    );
    for (const day of days)
      expect(day).toMatch(/^<[a-z]+ [^>]*class="flex h-17 w-12 [^"]*rounded-row /);
    expect(section).not.toMatch(/rounded-\[/);
    // An urgent day: a link to that day, its count in red.
    expect(days[0]).toMatch(
      /^<a aria-label="Sun 8 Nov: 1 urgent shift" class="[^"]*glass-tile text-ink press-glass[^"]*" href="\/shifts\/open\?day=2026-11-08"><span class="text-sm leading-tight ">Sun<\/span>/,
    );
    expect(days[0]).toMatch(
      /<span class="text-sm leading-none tabular-nums font-semibold text-urgent-ink">1<\/span><\/a>$/,
    );
    // Her booked day: a sunk grey, with a tick.
    expect(days[1]).toMatch(
      /^<span role="img" aria-label="Mon 9 Nov: you&#x27;re booked" class="[^"]*bg-ink\/12 text-ink inset-ring inset-ring-white\/30">/,
    );
    expect(days[1]).toContain("<svg");
    // An open day: its count, in grey.
    expect(days[2]).toMatch(/href="\/shifts\/open\?day=2026-11-10"/);
    expect(days[2]).toMatch(/tabular-nums text-ink-muted">1<\/span><\/a>$/);
    // Its key in words, so a day's colour never says it alone; each number is a count of that
    // day's shifts, so the key names the colour, never a sample "1" (Phase 27.2).
    const key = text(section.slice(section.indexOf("</ul>")));
    expect(key).toContain(
      "Red number : urgent shifts that day Grey number: open shifts that day You're booked",
    );
    expect(key).not.toMatch(/\b1 (Urgent|Open)\b/);
    expect(section).toContain('<span class="font-semibold text-urgent-ink">Red number</span>');
    // The key names only the marks on screen (28.8): open days only, only the grey number.
    const openOnly = render(
      list(),
      {},
      shiftsStrip(NOW, TZ, [{ startsAt: at("2026-11-10T09:00:00Z"), isUrgent: false }], []),
    );
    const openKey = text(openOnly.slice(openOnly.indexOf("</ul>"), openOnly.indexOf("</section>")));
    expect(openKey.trim()).toBe("Grey number: open shifts that day");
    // Today, when it has a shift: "Today", set tight to fit its 48px tile.
    const today = render(
      list(),
      {},
      shiftsStrip(NOW, TZ, [{ startsAt: at("2026-11-07T14:00:00Z"), isUrgent: false }], []),
    );
    expect(today).toContain('<span class="text-sm leading-tight tracking-tight">Today</span>');
    // The day chosen is in ink.
    const chosen = render(list(), { day: "2026-11-08" }, strip);
    expect(chosen).toMatch(
      /<a aria-label="Sun 8 Nov: 1 urgent shift" aria-current="true" class="[^"]*bg-ink text-on-ink [^"]*" href="\/shifts\/open\?day=2026-11-08">/,
    );
    expect(chosen).toMatch(/tabular-nums font-semibold">1<\/span>/);
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
    expect(text(html)).toContain("More shifts you can take");
    const urgent = cardsIn(html, "urgent-heading");
    const more = cardsIn(html, "more-heading");
    expect(urgent.map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1])).toEqual(["u1"]);
    expect(more.map((c) => /href="\/shifts\/([a-z0-9]+)"/.exec(c)?.[1])).toEqual(["n1", "n2"]);
    // The urgent card's date tile is pale red and says so to a screen reader; the others grey.
    expect(urgent[0]).toContain("bg-urgent-tile text-urgent-ink");
    expect(text(urgent[0] ?? "")).toMatch(/^ ?Sat 7 Nov Urgent\./);
    expect(more[0]).not.toContain("urgent-tile");
    expect(more[0]).toContain("glass-button text-ink");
    // Phase 28 (28.8): grouped as the office's event card is. Each list one glass section, 12px
    // round, its heading and count inside (the urgent one led by the office's red leaf); each shift
    // a clear glass tile 8px round, the whole tile its link (Phase 24's 22px card of glass, and the
    // hairline cards of Phases 17 and 20, before it), no red frame; taking it is on its page.
    expect(more[0]).toMatch(
      /<a class="group press glass-tile flex items-start gap-4 rounded-row p-4 hover:bg-active /,
    );
    for (const [id, title, n] of [
      ["urgent-heading", "Urgent, needed now", "1 shift"],
      ["more-heading", "More shifts you can take", "2 shifts"],
    ] as const) {
      expect(html).toContain(
        `<section aria-labelledby="${id}" class="glass flex flex-col gap-2 rounded-inner p-3">`,
      );
      expect(html).toContain(
        `<h2 id="${id}" class="text-lg font-semibold tracking-heading text-ink">${title}</h2><span aria-hidden="true" class="${countPill}">${n.split(" ")[0]}</span><span class="sr-only">${n}</span>`,
      );
    }
    const urgentHead = html.slice(html.indexOf('aria-labelledby="urgent-heading"'));
    expect(urgentHead).toMatch(
      /^aria-labelledby="urgent-heading" class="[^"]*"><div class="flex items-center gap-3 px-1 pt-1"><svg aria-hidden="true"[^>]*width="18" height="18"[^>]*class="shrink-0 text-mark-urgent"><path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15z"/,
    );
    expect(html).not.toContain("size-2.5 rounded-full bg-urgent");
    expect(html.slice(html.indexOf('aria-labelledby="more-heading"'))).not.toContain(
      "text-mark-urgent",
    );
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
    expect(text(plain)).toContain("Shifts you can take");
    expect(text(plain)).not.toContain("Urgent, needed now");
  });

  it("each card (§4.3; 12H.2; round 7): date tile, time, role, event and post, the travel line (both ways), places, pay, a round arrow", () => {
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
      "Sat 7 Nov 14:00–22:00 £15.50/hour Door supervisor Riverside Festival, Demo Arena, Gate A 3.1 miles · 12 min by car · 24 min by public transport 1 place left",
    );
    // Not urgent: "1 place left" as a tag, a glass pill in ink (28.8; the urgent chip only on
    // urgent shifts).
    expect(card).toContain(`<span class="${tag}">1 place left</span>`);
    // The travel line shows after a car, both ways (no drive on its own: 12G.3).
    expect(card).toMatch(
      /<span class="mt-1 flex items-start gap-2 text-base text-ink-muted" data-travel-line=""><svg[^>]*><path d="M5 11l1\.5-4/,
    );
    // The seats are on its page (round 7): here, the places left and a round arrow to open it.
    expect(card).not.toContain("data-seat");
    expect(card).toMatch(
      /1 place left<\/span><span aria-hidden="true" class="glass-button flex size-10 shrink-0 items-center justify-center rounded-full [^"]*"><svg[^>]*><path d="M5 12h14M13 6l6 6-6 6"/,
    );
    const urgentCard =
      cardsIn(
        render(list({ shifts: [shift({ shiftId: "u1", isUrgent: true })] })),
        "urgent-heading",
      )[0] ?? "";
    expect(urgentCard).toContain(`<span class="${chip.base} ${chip.urgent}">2 places left</span>`);
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
      "19:00–01:00 £12.60/hour Steward Demo Arena · finishes Sunday morning",
    );
    // A site named like its event is named once.
    const same = render(list({ shifts: [shift({ shiftId: "e", casualEvent: "Demo Arena" })] }));
    expect(text(same)).toContain("Steward Demo Arena 2 places left");
    expect(text(same)).not.toContain("Demo Arena, Demo Arena");
  });

  // Phase 27.2 (C3): a session with no pay rate says so where the rate would be. Phase 28 (28.8;
  // the review's major 2): "Pay not given yet", as the card has no way to ask; it opens the shift's
  // page, where "Ask the office about the pay" is.
  it("a session with no pay rate: 'Pay not given yet' across from the time", () => {
    const card =
      cardsIn(
        render(list({ shifts: [shift({ shiftId: "p0", payRatePence: null })] })),
        "more-heading",
      )[0] ?? "";
    expect(text(card)).toContain("14:00–22:00 Pay not given yet Steward");
    expect(card).toContain(
      '<span class="text-right text-base text-ink-muted">Pay not given yet</span>',
    );
    expect(card).toContain('href="/shifts/p0"');
    expect(text(card)).not.toContain("/hour");
    const paid = cardsIn(render(list({ shifts: [shift({ shiftId: "p1" })] })), "more-heading")[0];
    expect(text(paid ?? "")).toContain("£12.60/hour");
    expect(paid).not.toContain("not given");
  });

  // Phase 28 (28.8; the review's note 12): while the travel time isn't worked out, one sentence
  // (src/lib/travel/line-copy.ts), not "(straight line)" and "not known" reading as values.
  it("a shift whose travel time isn't worked out yet: one sentence", () => {
    const card =
      cardsIn(
        render(
          list({
            shifts: [shift({ shiftId: "t0", travel: { kind: "straight", straightMetres: 3200 } })],
          }),
        ),
        "more-heading",
      )[0] ?? "";
    expect(text(card)).toContain("About 2 miles away. Travel time isn't worked out yet.");
    expect(card).not.toContain("straight line");
    expect(card).not.toContain("not known");
  });

  // Phase 28 (28.8): only urgent shifts open, the rest's section keeps its frame and heading, with
  // the one empty state in it.
  it("only urgent shifts open: 'Nothing else open right now' in the one empty state", () => {
    const urgentOnly = [shift({ shiftId: "u1", isUrgent: true })];
    const html = render(list({ shifts: urgentOnly }));
    expect(cardsIn(html, "urgent-heading")).toHaveLength(1);
    expect(html).toContain(
      `<h2 id="more-heading" class="text-lg font-semibold tracking-heading text-ink">More shifts you can take</h2></div><p class="${emptyBox}">Nothing else open right now. We&#x27;ll message you when a shift comes up.</p></section>`,
    );
    expect(text(render(list({ offerAlerts: false, shifts: urgentOnly })))).toContain(
      "Nothing else open right now. Check back later.",
    );
    expect(html).not.toContain("border-dashed");
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
      "These are the first open shifts. Tap Site and role to choose a day, site or role and see others.",
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
      {},
      // Its day on the strip (28.8: a day with nothing has no tile, and no tiles, no strip).
      shiftsStrip(NOW, TZ, [{ startsAt: at("2026-11-07T14:00:00Z"), isUrgent: false }], []),
    );
    // Round 7 (Phase 24): right under the strip, how many shifts and "Site and role", which opens
    // a plain form (a <details> whose summary is the button, the form shown while it's open: no
    // JavaScript needed), before the shifts; a day, a site and a role as chips, and its button.
    expect(html).toMatch(
      /aria-label="Your next 8 days"[\s\S]*?<\/section><div data-filters-box="" class="mt-3 flex flex-col gap-3"><div class="flex min-h-13 items-center justify-between gap-3"><p class="text-lg text-ink-muted">1 shift<\/p><details data-filters=""><summary aria-controls="shift-filters" class="[^"]*glass-button[^"]*\[\[open\]&gt;&amp;\]:lens"><svg[^>]*><path d="M4 7h16M7 12h10M10 17h4"><\/path><\/svg>Site and role<\/summary><\/details><\/div><form id="shift-filters" aria-label="Choose a day, site or role" class="hidden grid-cols-2 gap-2 \[\[data-filters-box\]:has\(\[data-filters\]\[open\]\)_&amp;\]:grid" method="get">/,
    );
    // Open already when a site or role is chosen, so she sees what's chosen.
    expect(
      render(
        list({
          ...list(),
          shifts: [shift({ shiftId: "s1" })],
          choices: {
            days: ["2026-11-07", "2026-11-08"],
            sites: [{ id: arena.id, name: arena.name }],
            roles: ["door_supervisor", "steward"],
          },
        }),
        { role: "steward" },
      ),
    ).toContain('<details data-filters="" open="">');
    expect(html.indexOf("<form")).toBeLessThan(html.indexOf('id="more-heading"'));
    for (const name of ["day", "site", "role"])
      expect(html).toMatch(new RegExp(`<select name="${name}" class="[^"]*rounded-full[^"]*">`));
    expect(html.match(/<span class="sr-only">(Day|Site|Role)<\/span>/g)).toHaveLength(3);
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(text(html)).toContain("Any day");
    expect(html).toContain('value="2026-11-08"');
    expect(text(html)).toContain("Sun 8 Nov");
    expect(text(html)).toContain("Show shifts");
  });

  it("offers the whole list again when the filters match nothing", () => {
    const words = text(render(list(), { role: "steward" }));
    expect(words).toContain("No open shifts match.");
    expect(render(list(), { role: "steward" })).toContain(
      `<p class="${emptyBox}">No open shifts match.</p>`,
    );
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

  // The office chose who works it while she looked (Phase 26.6, ses-6): say so, and ask instead.
  it("the office chooses now: ask for it instead", () => {
    expect(show({ status: "ask_first" }).trim()).toBe(
      "The office now chooses who works this one. Ask for it instead.",
    );
  });

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
