import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barPills, barRole, TODO_HREF } from "@/lib/portal/casual-bar";
import { cardTiles, countPills, type QualRow } from "@/lib/portal/home-board";
import {
  homeMap,
  inTab,
  nearestOpen,
  pinCount,
  weekOf,
  type MapPlace,
} from "@/lib/portal/home-map";
import {
  emptyOnMap,
  mapDaysText,
  nearestText,
  payDayText,
  pinWords,
} from "@/lib/portal/home-map-copy";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { barInitials, bellNumber, bellWords } from "@/lib/portal/top-bar-copy";

// Phase 32 (docs/screens.md "## Phase 32"): Home's map, its tabs and card, and the top bar's
// words. Pure: the pins come from the page's own lists (her next shift and "Open to you"), each
// venue's point read inside her firm (src/lib/portal/home-map-places.ts; its isolation is the
// integration test's).

const TZ = "Europe/London";
const NOW = new Date("2026-11-09T12:00:00Z"); // Monday 9 November
const at = (iso: string) => new Date(iso);

const open = (o: Partial<OpenShift> & { shiftId: string; siteId: string | null }): OpenShift => ({
  role: "steward",
  startsAt: at("2026-11-12T14:00:00Z"),
  endsAt: at("2026-11-12T22:00:00Z"),
  placesLeft: 1,
  opensAt: null,
  isUrgent: false,
  ...o,
  site: o.siteId
    ? {
        id: o.siteId,
        name: `Site ${o.siteId}`,
        addressLine1: null,
        addressLine2: null,
        town: null,
        postcode: null,
      }
    : null,
});

const place = (siteId: string, lat: number | null = 53.8, lng: number | null = -1.5): MapPlace => ({
  siteId,
  name: `Venue ${siteId}`,
  lat,
  lng,
});

describe("Home's map: pins from her next shift and the shifts open to her", () => {
  const shifts = [
    open({ shiftId: "s1", siteId: "a", isUrgent: true, startsAt: at("2026-11-11T09:00:00Z") }),
    open({ shiftId: "s2", siteId: "a", startsAt: at("2026-11-16T09:00:00Z") }),
    open({ shiftId: "s3", siteId: "b", startsAt: at("2026-11-17T09:00:00Z") }),
    // Three weeks on: in All only.
    open({ shiftId: "s4", siteId: "b", startsAt: at("2026-11-30T09:00:00Z") }),
    // A venue with no point yet, and a shift with no venue: no pin, but counted.
    open({ shiftId: "s5", siteId: "c", startsAt: at("2026-11-10T09:00:00Z") }),
    open({ shiftId: "s6", siteId: null, startsAt: at("2026-11-10T09:00:00Z") }),
  ];
  const places = new Map([
    ["a", place("a", 53.8, -1.55)],
    ["b", place("b", 53.82, -1.5)],
    ["c", place("c", null, null)],
  ]);
  const map = homeMap({
    next: { shiftId: "mine", startsAt: at("2026-11-12T14:00:00Z") },
    nextPlace: place("m", 53.79, -1.52),
    open: shifts,
    places,
    now: NOW,
    timeZone: TZ,
  });

  it("one pin for her shift's venue first, then one per venue with a point, urgent first", () => {
    expect(map.pins.map((p) => [p.siteId, p.mine, p.shifts.length])).toEqual([
      ["m", true, 1],
      ["a", false, 2],
      ["b", false, 2],
    ]);
    expect(map.pins[0]!.href).toBe("/shifts");
    expect(map.pins[1]!.href).toBe("/shifts/open?site=a");
  });

  it("the tabs' counts: every shift (hers too), the urgent ones, this week's and next week's", () => {
    expect(map.counts).toEqual({ all: 7, urgent: 1, this: 4, next: 2 });
    const a = map.pins[1]!;
    expect(pinCount(a, "all")).toBe(2);
    expect(pinCount(a, "urgent")).toBe(1);
    expect(pinCount(a, "this")).toBe(1);
    expect(pinCount(a, "next")).toBe(1);
    expect(pinCount(map.pins[2]!, "this")).toBe(0);
    expect(inTab({ urgent: false, week: "later", day: "2026-11-30" }, "all")).toBe(true);
  });

  it("weeks run Monday to Sunday on the firm's calendar", () => {
    expect(weekOf("2026-11-15", "2026-11-09")).toBe("this");
    expect(weekOf("2026-11-16", "2026-11-09")).toBe("next");
    expect(weekOf("2026-11-23", "2026-11-09")).toBe("later");
    expect(weekOf("2026-11-16", "2026-11-15")).toBe("next");
  });

  it("no next shift and no places: no pins, still the counts", () => {
    const none = homeMap({
      next: null,
      nextPlace: null,
      open: shifts,
      places: new Map(),
      now: NOW,
      timeZone: TZ,
    });
    expect(none.pins).toEqual([]);
    expect(none.counts.all).toBe(6);
  });

  it("each pin's name and label in words", () => {
    expect(mapDaysText(["2026-11-16", "2026-11-11", "2026-11-11"])).toBe("Wed 11, Mon 16");
    expect(mapDaysText(["2026-11-11", "2026-11-16", "2026-11-17", "2026-11-18"])).toBe(
      "Wed 11, Mon 16 and 2 more",
    );
    expect(
      pinWords({
        mine: true,
        name: "Riverside Demo Park",
        count: 1,
        urgent: 0,
        days: ["2026-11-12"],
      }),
    ).toBe("Your shift: Riverside Demo Park, Thu 12");
    expect(
      pinWords({
        mine: false,
        name: "Northgate Demo Common",
        count: 2,
        urgent: 1,
        days: ["2026-11-17"],
      }),
    ).toBe("Northgate Demo Common: 2 shifts you can take, 1 urgent, Tue 17");
    expect(pinWords({ mine: false, name: "X", count: 1, urgent: 0, days: ["2026-11-17"] })).toBe(
      "X: 1 shift you can take, Tue 17",
    );
  });
});

describe("nothing booked: the nearest shift she can take", () => {
  it("by her travel area's distance where there is one, else the soonest", () => {
    const far = open({
      shiftId: "far",
      siteId: "a",
      startsAt: at("2026-11-10T09:00:00Z"),
      travel: { kind: "straight", straightMetres: 9000 },
    });
    const near = open({
      shiftId: "near",
      siteId: "b",
      startsAt: at("2026-11-20T09:00:00Z"),
      travel: { kind: "straight", straightMetres: 2000 },
    });
    expect(nearestOpen([far, near])).toEqual({ shift: near, by: "distance" });
    const soon = open({ shiftId: "soon", siteId: "a", startsAt: at("2026-11-10T09:00:00Z") });
    const later = open({ shiftId: "later", siteId: "a", startsAt: at("2026-11-20T09:00:00Z") });
    expect(nearestOpen([later, soon])).toEqual({ shift: soon, by: "time" });
    expect(nearestOpen([])).toBeNull();
    expect(nearestText("distance", { dow: "Tue", day: "17", month: "Nov" })).toBe(
      "Nearest: Tue 17 Nov",
    );
    expect(nearestText("time", { dow: "Tue", day: "17", month: "Nov" })).toBe(
      "Soonest: Tue 17 Nov",
    );
    expect(emptyOnMap(1)).toBe("1 shift you can take is on the map.");
    expect(emptyOnMap(4)).toBe("4 shifts you can take are on the map.");
    expect(payDayText("2026-11-20")).toBe("Pay day Fri 20 Nov");
  });
});

describe("the card's tiles", () => {
  const row = (title: string, tone: QualRow["pill"]["tone"], words: string): QualRow => ({
    key: title,
    kind: "qualification",
    title,
    pill: { words, tone },
    bar: null,
    line: null,
    action: null,
    href: "/profile",
    offline: null,
    lineOnlineOnly: false,
  });
  it("how many are in date, the worst other as a badge; shifts she can take with the urgent ones", () => {
    const tiles = cardTiles(
      [
        row("Staff photo", "attention", "20 days left"),
        row("SIA", "done", "Valid · 420 days"),
        row("Right to work", "quiet", "Not recorded"),
      ],
      11,
      3,
    );
    expect(tiles).toEqual({
      quals: {
        valid: 1,
        all: 3,
        badge: { words: "Staff photo: 20 days left", tone: "attention" },
      },
      canTake: { count: 11, urgent: 3 },
    });
    expect(cardTiles([row("SIA", "done", "Valid")], 0, 0).quals.badge).toBeNull();
  });
});

describe("the top bar's words", () => {
  it("the bell: the office's answers to her requests, with how many she hasn't seen", () => {
    expect(bellWords(0)).toBe("Answers from the office");
    expect(bellWords(1)).toBe("Answers from the office, 1 new");
    expect(bellWords(2)).toBe("Answers from the office, 2 new");
    expect(bellNumber(120)).toBe("99+");
    expect(barInitials("Zoe", "Adeyemi")).toBe("ZA");
    expect(barInitials("", "")).toBe("?");
  });
  it("her role in words, and the pills Home has, To do to Home's Do this", () => {
    expect(barRole(["door_supervisor", "steward"])).toBe("Door supervisor");
    expect(barRole([])).toBeNull();
    const pills = barPills(countPills({ booked: 1, open: 11, urgent: 3, todo: 1, messages: 0 }));
    expect(pills.map((p) => [p.label, p.count, p.href])).toEqual([
      ["Booked", 1, "/shifts"],
      ["Open to you", 11, "/shifts/open"],
      ["Urgent", 3, "/urgent"],
      ["To do", 1, TODO_HREF],
      ["Messages", 0, "/messages"],
    ]);
    expect(TODO_HREF).toBe("/#do-this-heading");
  });
});

describe("where the map's points come from", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("by id from the page's own lists, inside her firm, never a second eligibility list", () => {
    const loader = read("src/lib/portal/home-map-places.ts");
    expect(loader).toContain("const run = ctx.run ?? withFirm;");
    expect(loader).toMatch(/where v\.firm_id = \$\{ctx\.firm\.id\}::uuid and v\.id in \(/);
    expect(loader).toMatch(/where s\.firm_id = \$\{ctx\.firm\.id\}::uuid and s\.id = /);
    expect(loader).not.toMatch(/openShiftsFor|eligib|rules\//);
    const page = read("src/app/page.tsx");
    expect(page).toMatch(/loadMapPlaces\(\{ firm \}, upcoming\[0\] \?\? null, open\.shifts\)/);
    expect(page).toMatch(/open: open\.shifts,/);
  });
});
