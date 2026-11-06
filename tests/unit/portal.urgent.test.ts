import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { chip, countPill, emptyBox, staffBtn } from "@/app/ui/classes";

// The urgent board (docs/screens.md, `/urgent`), the "Urgent" label on Open shifts and Home's
// urgent shifts (12H.1; Phase 18: For you's row), rendered to HTML. Each card opens the shift's
// page, where she takes it (tests/unit/portal.shift-detail.test.ts).
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { UrgentView } = await import("@/app/urgent/urgent-view");
const { OpenShiftsView } = await import("@/app/shifts/open/open-shifts-view");
const { HomeView } = await import("@/app/home-view");

const TZ = "Europe/London";
const NOW = new Date("2026-11-07T06:00:00Z");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const shift = (o: Partial<OpenShift> = {}): OpenShift => ({
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  startsAt: new Date("2026-11-07T08:00:00Z"),
  endsAt: new Date("2026-11-07T16:00:00Z"),
  placesLeft: 1,
  opensAt: null,
  travel: { kind: "unknown" },
  isUrgent: true,
  site: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Acme Demo Arena",
    addressLine1: null,
    addressLine2: null,
    town: "Exampleton",
    postcode: "ZZ1 1AA",
  },
  ...o,
});
const list = (shifts: OpenShift[]): OpenShiftsList => ({
  shifts,
  truncated: false,
  offerAlerts: true,
  travelOn: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
});
const urgent = (l: OpenShiftsList) =>
  renderToStaticMarkup(createElement(UrgentView, { list: l, timeZone: TZ, now: NOW }));

describe("the urgent board", () => {
  it("lists the urgent shifts as cards, each labelled Urgent and opening the shift's page to take it", () => {
    const html = urgent(list([shift()]));
    const words = text(html);
    expect(words).toContain("Urgent shifts");
    expect(words).toContain("Shifts starting soon that need someone now.");
    // The card (Phases 18, 20 and 24): the date tile, "Urgent." read out, the time, the role, then
    // where; the date tile pale red. With no pay rate set, "Pay not given yet" where the rate would
    // be (Phase 27.2; 28.8's words: her page has "Ask the office about the pay").
    expect(words).toContain(
      "Sat 7 Nov Urgent. 08:00–16:00 Pay not given yet Door supervisor Acme Demo Arena",
    );
    expect(words).not.toContain("ask the office");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-urgent-tile text-urgent-ink">/);
    // Phase 28 (28.8): the places left on the urgent chip (an urgent shift's fact).
    expect(html).toContain(`<span class="${chip.base} ${chip.urgent}">1 place left</span>`);
    expect(html).toContain('<span class="sr-only">Urgent. </span>');
    expect(words).toContain("1 place left");
    expect(html).toMatch(/<a class="[^"]*" href="\/shifts\/11111111-1111-4111-8111-111111111111">/);
    // Grouped as the office's event card (28.8): one glass section, 12px round, its heading led by
    // the office's 18px red leaf with the count inside; each shift a clear glass tile 8px round.
    expect(html).toMatch(
      /<section aria-labelledby="urgent-heading" class="glass flex flex-col gap-2 rounded-inner p-3"><div class="flex items-center gap-3 px-1 pt-1"><svg aria-hidden="true"[^>]*width="18" height="18"[^>]*class="shrink-0 text-mark-urgent"><path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15z"/,
    );
    expect(html).toContain(
      `<h2 id="urgent-heading" class="text-lg font-semibold tracking-heading text-ink">Urgent, needed now</h2><span aria-hidden="true" class="${countPill}">1</span><span class="sr-only">1 shift</span>`,
    );
    expect(html).toMatch(
      /<li class="animate-in"><a class="group press glass-tile flex items-start gap-4 rounded-row p-4 /,
    );
    // The only list items on the page are the shifts (the browser tests count them).
    expect(html.match(/<li/g)).toHaveLength(1);
    // Back to her shifts: the Shifts tab (/shifts), not Home (28.8; the review's major 3).
    expect(html).toContain(
      `<a class="${staffBtn.secondary} mt-8" href="/shifts">Back to my shifts</a>`,
    );
  });

  it("says so plainly when there are none, with a way to open shifts", () => {
    const html = urgent(list([]));
    // 28.8: the casual's words ("urgent shifts", never the office's "gaps") in the one empty state,
    // with one name for the way to Open shifts.
    expect(text(html)).toContain("No urgent shifts right now.");
    expect(text(html)).not.toContain("gaps");
    expect(html).toContain(
      `<div class="${emptyBox}"><p>No urgent shifts right now.</p><a class="${staffBtn.primary}" href="/shifts/open">See open shifts</a></div>`,
    );
    expect(text(html)).not.toContain("See all open shifts");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("<section");
    expect(text(html)).not.toContain("Take shift");
    expect(html).toContain('href="/shifts">Back to my shifts</a>');
  });

  it("a held urgent shift says when it opens; its page has 'Check again'", () => {
    const html = urgent(list([shift({ opensAt: new Date("2026-11-07T06:15:00Z") })]));
    expect(text(html)).toContain("You can take it from 06:15");
    expect(html).toContain('href="/shifts/11111111-1111-4111-8111-111111111111"');
  });
});

describe("Open shifts", () => {
  it("labels an urgent shift, and only that one", () => {
    const html = renderToStaticMarkup(
      createElement(OpenShiftsView, {
        list: list([
          shift(),
          shift({ shiftId: "33333333-3333-4333-8333-333333333333", isUrgent: false }),
        ]),
        filters: {},
        strip: [],
        timeZone: TZ,
        now: NOW,
      }),
    );
    // Under "Urgent, needed now", the urgent one, labelled; under the rest, the other, not.
    const urgentPart = html.slice(
      html.indexOf('id="urgent-heading"'),
      html.indexOf('id="more-heading"'),
    );
    const rest = html.slice(html.indexOf('id="more-heading"'));
    expect(text(urgentPart)).toContain("Urgent, needed now");
    expect(urgentPart.match(/<span class="sr-only">Urgent\. <\/span>/g)).toHaveLength(1);
    expect(urgentPart).toContain('href="/shifts/11111111-1111-4111-8111-111111111111"');
    expect(rest).toContain('href="/shifts/33333333-3333-4333-8333-333333333333"');
    expect(rest).not.toContain("Urgent");
  });
});

describe("Home", () => {
  const home = (shifts: OpenShift[]) =>
    text(
      renderToStaticMarkup(
        createElement(HomeView, {
          firmName: "Acme Events",
          pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
          firstName: "Sam",
          lastName: "Udo",
          timeZone: TZ,
          now: NOW,
          next: null,
          needs: [],
          photo: { status: "up_to_date", current: null, waiting: null },
          open: list(shifts),
        }),
      ),
    );

  it("shows the urgent shifts the worker could take as one row, in plain words, to the urgent board", () => {
    const shifts = [shift(), shift({ shiftId: "33333333-3333-4333-8333-333333333333" })];
    const words = home(shifts);
    // A row under "Shifts you can take" (Phase 24), its tile the soonest one's day: near you, as
    // her travel area chose them.
    expect(words).toContain("Shifts you can take Sat 7 2 urgent shifts near you Sat 7 Nov");
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firmName: "Acme Events",
        pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
        firstName: "Sam",
        lastName: "Udo",
        timeZone: TZ,
        now: NOW,
        next: null,
        needs: [],
        photo: { status: "up_to_date", current: null, waiting: null },
        open: list(shifts),
      }),
    );
    expect(html).toMatch(
      /<li data-online-only="" data-for-you="urgent"><a class="[^"]*" href="\/urgent">/,
    );
  });

  it("says nothing about urgent shifts when there are none", () => {
    expect(home([])).not.toContain("Urgent");
    expect(home([shift({ isUrgent: false })])).not.toContain("Urgent");
  });
});
