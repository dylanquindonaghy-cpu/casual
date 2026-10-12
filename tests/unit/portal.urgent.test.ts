import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";

// The urgent board (docs/screens.md, `/urgent`), the "Urgent" label on Open shifts and Home's
// urgent shifts (12H.1), rendered to HTML. The "Take shift" button needs a stand-in router.
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
    // §4.3's order (12H.2): the label, role · event, site, then date and time.
    expect(words).toContain("Urgent Door supervisor Acme Demo Arena Sat 7 Nov, 08:00 to 16:00");
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

describe("Home", () => {
  const home = (shifts: OpenShift[]) =>
    text(
      renderToStaticMarkup(
        createElement(HomeView, {
          firstName: "Sam",
          voice: { name: "Acme Events", signOff: "Acme Events Shift Team" },
          timeZone: TZ,
          now: NOW,
          next: null,
          needs: [],
          photo: { status: "up_to_date", current: null, waiting: null },
          open: list(shifts),
        }),
      ),
    );

  it("shows the urgent shifts the worker could take, in plain words, then the urgent board", () => {
    const words = home([shift(), shift({ shiftId: "33333333-3333-4333-8333-333333333333" })]);
    expect(words).toContain("Urgent: needed now, and you can take them");
    expect(words).toContain("Urgent Door supervisor Acme Demo Arena Sat 7 Nov, 08:00 to 16:00");
    expect(words.match(/1 place left/g)).toHaveLength(2);
    expect(words).toContain("See urgent shifts");
  });

  it("says nothing about urgent shifts when there are none", () => {
    expect(home([])).not.toContain("Urgent");
    expect(home([shift({ isUrgent: false })])).not.toContain("Urgent");
  });
});
