import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";

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
    // The card (Phases 18 and 20): the date tile, "Urgent." read out, the time, the role, then
    // where; the date tile pale red, the places left red.
    expect(words).toContain("Sat 7 Nov Urgent. 08:00–16:00 Door supervisor Acme Demo Arena");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-urgent-tile text-urgent-ink">/);
    expect(html).toMatch(
      /<span class="text-base font-semibold text-urgent-ink">1 place left<\/span>/,
    );
    expect(html).toContain('<span class="sr-only">Urgent. </span>');
    expect(words).toContain("1 place left");
    expect(html).toMatch(/<a class="[^"]*" href="\/shifts\/11111111-1111-4111-8111-111111111111">/);
    expect(words).toContain("Back to my shifts");
  });

  it("says so plainly when there are none, with a way to all open shifts", () => {
    const html = urgent(list([]));
    expect(text(html)).toContain("No urgent gaps right now.");
    expect(text(html)).toContain("See all open shifts");
    expect(html).toContain('href="/shifts/open"');
    expect(text(html)).not.toContain("Take shift");
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
          payDay: "2026-11-13",
          firstName: "Sam",
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
    // A tile (Phase 20): near you, as her home area chose them.
    expect(words).toContain("For you Urgent near you 2 shifts Sat 7 Nov");
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firmName: "Acme Events",
        payDay: "2026-11-13",
        firstName: "Sam",
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
