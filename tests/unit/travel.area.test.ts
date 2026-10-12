import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { AREA_PROMPT, furtherText, TRAVEL_PATH } from "@/lib/portal/travel-copy";
import { areaVerdict, type WayEstimate } from "@/lib/travel/area";
import type { TravelFacts } from "@/lib/travel/line-copy";
import type { TravelMode } from "@/lib/travel/modes";

// The travel area's rule and its words on the casual's pages (12G.3; docs/office-v2.md 4.3, 5.4;
// D2, Rules 14). The database's own copy of the rule is held to this one in
// tests/integration/travel.filter.test.ts.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { OpenShiftsView } = await import("@/app/shifts/open/open-shifts-view");
const { UrgentView } = await import("@/app/urgent/urgent-view");
const { BookedView } = await import("@/app/shifts/booked-view");

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const way = (minutes: number | null): WayEstimate => ({ minutes });
const verdict = (modes: TravelMode, car: WayEstimate, pt: WayEstimate, maxMinutes = 45) =>
  areaVerdict({ modes, maxMinutes }, { located: true }, { car, public_transport: pt });

describe("areaVerdict: in, out or unknown", () => {
  it("in when any way she chose is within her limit: car 40, public transport 50, limit 45", () => {
    expect(verdict("both", way(40), way(50))).toBe("in");
    expect(verdict("car", way(40), way(50))).toBe("in");
    expect(verdict("public_transport", way(40), way(50))).toBe("out");
  });

  it("the limit itself is within; a minute over isn't", () => {
    expect(verdict("car", way(45), undefined)).toBe("in");
    expect(verdict("car", way(46), undefined)).toBe("out");
  });

  it("beyond the 90-minute ceiling (or no public transport in time) is out", () => {
    expect(verdict("car", way(null), way(10))).toBe("out");
    expect(verdict("public_transport", way(10), way(null))).toBe("out");
    expect(verdict("both", way(null), way(null))).toBe("out");
  });

  it("a way she didn't choose never counts, either way", () => {
    expect(verdict("car", way(80), way(5))).toBe("out");
    expect(verdict("public_transport", way(5), way(80))).toBe("out");
  });

  it("unknown (shown and offered) while a way she chose isn't worked out yet", () => {
    expect(verdict("car", undefined, way(5))).toBe("unknown");
    expect(verdict("both", way(80), undefined)).toBe("unknown");
    expect(verdict("both", undefined, undefined)).toBe("unknown");
    // ... but one way already within is enough.
    expect(verdict("both", way(20), undefined)).toBe("in");
  });

  it("a site with no location is unknown; no travel area is no area", () => {
    expect(
      areaVerdict(
        { modes: "car", maxMinutes: 45 },
        { located: false },
        { car: way(80), public_transport: way(80) },
      ),
    ).toBe("unknown");
    expect(areaVerdict(null, { located: true }, { car: way(80), public_transport: way(80) })).toBe(
      "no_area",
    );
  });
});

describe("the 'further than you travel' words", () => {
  it("counts shifts, and urgent shifts on the urgent board", () => {
    expect(furtherText({ count: 1, atLeast: false })).toBe(
      "1 more shift is further than you travel.",
    );
    expect(furtherText({ count: 2, atLeast: false })).toBe(
      "2 more shifts are further than you travel.",
    );
    expect(furtherText({ count: 50, atLeast: true })).toBe(
      "At least 50 more shifts are further than you travel.",
    );
    expect(furtherText({ count: 1, atLeast: true })).toBe(
      "At least 1 more shift is further than you travel.",
    );
    expect(furtherText({ count: 3, atLeast: false }, true)).toBe(
      "3 more urgent shifts are further than you travel.",
    );
  });
});

const estimated: TravelFacts = {
  kind: "estimated",
  straightMetres: 9000,
  arriveBy: new Date("2026-11-07T07:30:00Z"),
  car: { minutes: 18, metres: 11587 },
  publicTransport: { minutes: 41 },
};
const shift = (o: Partial<OpenShift> = {}): OpenShift => ({
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  startsAt: new Date("2026-11-07T08:00:00Z"),
  endsAt: new Date("2026-11-07T16:00:00Z"),
  placesLeft: 1,
  opensAt: null,
  isUrgent: false,
  site: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Demo Arena",
    addressLine1: null,
    addressLine2: null,
    town: "Exampleton",
    postcode: "ZZ1 1AA",
  },
  travel: estimated,
  ...o,
});
const list = (o: Partial<OpenShiftsList> = {}): OpenShiftsList => ({
  shifts: [shift()],
  truncated: false,
  offerAlerts: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
  ...o,
});
const open = (l: OpenShiftsList) =>
  renderToStaticMarkup(
    createElement(OpenShiftsView, { list: l, filters: {}, timeZone: TZ, now: NOW }),
  );
const urgent = (l: OpenShiftsList) =>
  renderToStaticMarkup(createElement(UrgentView, { list: l, timeZone: TZ, now: NOW }));

describe("Open shifts and the urgent board", () => {
  it("every card has the travel line after the places left: both times, whatever she chose", () => {
    for (const html of [open(list()), urgent(list({ shifts: [shift({ isUrgent: true })] }))]) {
      expect(text(html)).toContain(
        "1 place left 7.2 miles · 18 min by car · 41 min by public transport Take shift",
      );
    }
  });

  it("an unknown distance is shown and labelled, never hidden", () => {
    const words = text(open(list({ shifts: [shift({ travel: { kind: "unknown" } })] })));
    expect(words).toContain("1 place left Distance not known yet");
  });

  it("no travel area: the prompt, linking to Where you work, and no 'further' line", () => {
    for (const html of [
      open(list({ area: null })),
      urgent(list({ area: null, shifts: [shift({ isUrgent: true })] })),
    ]) {
      expect(text(html)).toContain(`${AREA_PROMPT} Add your home area`);
      expect(html).toContain(`href="${TRAVEL_PATH}"`);
      expect(text(html)).not.toContain("further than you travel");
    }
    expect(text(open(list()))).not.toContain(AREA_PROMPT);
  });

  it("'N more shifts are further than you travel. Change how far', under the list", () => {
    const words = text(open(list({ further: { count: 2, atLeast: false } })));
    expect(words).toContain("2 more shifts are further than you travel. Change how far");
    expect(open(list({ further: { count: 2, atLeast: false } }))).toContain(
      `href="${TRAVEL_PATH}"`,
    );
    expect(text(urgent(list({ further: { count: 1, atLeast: false } })))).toContain(
      "1 more urgent shift is further than you travel. Change how far",
    );
    // None further: no line.
    expect(text(open(list()))).not.toContain("further than you travel");
  });
});

describe("Booked (My shifts' upcoming)", () => {
  const booked = (o: Partial<MyShift> = {}): MyShift => ({
    assignmentId: "33333333-3333-4333-8333-333333333333",
    shiftId: "11111111-1111-4111-8111-111111111111",
    role: "door_supervisor",
    startsAt: new Date("2026-11-07T08:00:00Z"),
    endsAt: new Date("2026-11-07T16:00:00Z"),
    status: "confirmed",
    instructions: null,
    site: shift().site,
    travel: estimated,
    ...o,
  });
  const render = (shifts: MyShift[]) =>
    text(
      renderToStaticMarkup(
        createElement(BookedView, {
          timeZone: TZ,
          now: NOW,
          view: "upcoming",
          shifts,
        }),
      ),
    );

  it("the next shift and each row coming up carry the travel line", () => {
    const words = render([
      booked(),
      booked({
        assignmentId: "44444444-4444-4444-8444-444444444444",
        travel: { kind: "straight", straightMetres: 12000 },
      }),
    ]);
    expect(words).toContain(
      "Door supervisor 7.2 miles · 18 min by car · 41 min by public transport Demo Arena",
    );
    expect(words).toContain(
      "Door supervisor at Demo Arena about 7 miles (straight line) · Travel time not known yet",
    );
  });
});
