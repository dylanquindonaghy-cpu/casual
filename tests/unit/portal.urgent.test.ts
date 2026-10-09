import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";

// The urgent board (docs/screens.md, `/urgent`), the "Urgent" label on Open shifts and the
// banner on My shifts, rendered to HTML. The "Take shift" button needs a stand-in router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { UrgentView } = await import("@/app/urgent/urgent-view");
const { OpenShiftsView } = await import("@/app/shifts/open/open-shifts-view");
const { MyShiftsView } = await import("@/app/my-shifts-view");

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
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
});
const urgent = (l: OpenShiftsList) =>
  renderToStaticMarkup(createElement(UrgentView, { list: l, timeZone: TZ, now: NOW }));

describe("the urgent board", () => {
  it("lists the urgent shifts with an Urgent label and Take shift", () => {
    const words = text(urgent(list([shift()])));
    expect(words).toContain("Urgent shifts");
    expect(words).toContain("Shifts starting soon that need someone now.");
    expect(words).toContain("Urgent Sat 7 Nov, 08:00 to 16:00 Door supervisor Acme Demo Arena");
    expect(words).toContain("1 place left");
    expect(words).toContain("Take shift");
    expect(words).toContain("Back to my shifts");
  });

  it("says so plainly when there are none, with a way to all open shifts", () => {
    const html = urgent(list([]));
    expect(text(html)).toContain("No urgent gaps right now.");
    expect(text(html)).toContain("See all open shifts");
    expect(html).toContain('href="/shifts/open"');
    expect(text(html)).not.toContain("Take shift");
  });

  it("a held urgent shift says when it opens, and 'Check again' stays on this board", () => {
    const html = urgent(list([shift({ opensAt: new Date("2026-11-07T06:15:00Z") })]));
    expect(text(html)).toContain("You can take it from 06:15.");
    expect(html).toContain('href="/urgent"');
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
        timeZone: TZ,
        now: NOW,
      }),
    );
    expect(text(html).match(/Urgent/g)).toHaveLength(1);
  });
});

describe("My shifts", () => {
  const home = (urgentCount?: number) =>
    text(
      renderToStaticMarkup(
        createElement(MyShiftsView, {
          firstName: "Sam",
          voice: { name: "Acme Events", signOff: "Acme Events Shift Team" },
          timeZone: TZ,
          now: NOW,
          view: "upcoming",
          shifts: [],
          notices: [],
          urgentCount,
        }),
      ),
    );

  it("shows the urgent shifts the worker could take, in plain words", () => {
    expect(home(1)).toContain("1 urgent shift needs someone See urgent shifts");
    expect(home(3)).toContain("3 urgent shifts need someone See urgent shifts");
  });

  it("says nothing when there are none", () => {
    for (const none of [0, undefined]) expect(home(none)).not.toContain("urgent");
  });
});
