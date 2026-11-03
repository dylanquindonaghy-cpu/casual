import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appEnvSchema } from "@/lib/env";
import {
  dayShort,
  lengthAndPay,
  mapCountLine,
  mapFoot,
  offerButton,
  pinDays,
  pinLabel,
  takersWarning,
  unplacedLine,
  updateWhen,
} from "@/lib/office/dashboard-map-copy";
import {
  labelOrder,
  labelSides,
  layoutPins,
  mercatorY,
  PIN,
  placePins,
  spreadPins,
  venueBounds,
} from "@/lib/office/venue-map-geo";

// Round 8's venue map (Phase 26.2; the spec's dash-1, the pre-build audit's aud-7 and aud-8): where
// a pin goes without a street map, what it says, the card's words, and the street map's setting.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("placing the pins without a street map", () => {
  const box = { width: 1000, height: 528 };

  it("north is up and east is right, the set fitted inside the margin, its shape kept", () => {
    const leeds = { lat: 53.8, lng: -1.55 };
    const york = { lat: 53.96, lng: -1.08 };
    const harrogate = { lat: 53.99, lng: -1.54 };
    const [l, y, h] = placePins([leeds, york, harrogate], box);
    // York is east of Leeds; Harrogate north of it.
    expect(y!.x).toBeGreaterThan(l!.x);
    expect(h!.y).toBeLessThan(l!.y);
    // Inside the 12% margin, and the direction that limits the fit fills it (the box is wide, so
    // here north to south).
    for (const p of [l!, y!, h!]) {
      expect(p.x).toBeGreaterThanOrEqual(0.12 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(0.88 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(0.12 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(0.88 + 1e-9);
    }
    const spanX = Math.max(l!.x, y!.x, h!.x) - Math.min(l!.x, y!.x, h!.x);
    const spanY = Math.max(l!.y, y!.y, h!.y) - Math.min(l!.y, y!.y, h!.y);
    expect(Math.max(spanX, spanY)).toBeCloseTo(0.76, 6);
    expect(spanY).toBeCloseTo(0.76, 6);
    // One scale both ways: the east-west and north-south gaps keep their ratio on the screen.
    const dx = (y!.x - l!.x) * box.width;
    const dy = (l!.y - h!.y) * box.height;
    const rad = (d: number) => (d * Math.PI) / 180;
    const ratio =
      (rad(york.lng) - rad(leeds.lng)) / (mercatorY(harrogate.lat) - mercatorY(leeds.lat));
    expect(dx / dy).toBeCloseTo(ratio, 6);
  });

  it("one venue, or several at one spot, sit in the middle; none, nothing", () => {
    expect(placePins([{ lat: 53.8, lng: -1.55 }], box)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(
      placePins(
        [
          { lat: 53.8, lng: -1.55 },
          { lat: 53.8, lng: -1.55 },
        ],
        box,
      ),
    ).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(placePins([], box)).toEqual([]);
  });

  it("the street map's view: the venues' bounds, west, south, east, north", () => {
    expect(
      venueBounds([
        { lat: 53.8, lng: -1.55 },
        { lat: 53.96, lng: -1.08 },
      ]),
    ).toEqual([-1.55, 53.8, -1.08, 53.96]);
    expect(venueBounds([])).toBeNull();
  });
});

describe("laying the pins out in the map's real box", () => {
  const laptop = { width: 1170, height: 528, inset: 428 };
  const phone = { width: 358, height: 300, inset: 0 };
  const apart = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("pins that would cover each other are pushed apart, inside the box and clear of the card", () => {
    // Two venues a street apart, and two at one spot.
    const out = spreadPins(
      [
        { x: 800, y: 200 },
        { x: 805, y: 210 },
        { x: 600, y: 400 },
        { x: 600, y: 400 },
      ],
      laptop,
    );
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(apart(out[i]!, out[j]!)).toBeGreaterThanOrEqual(PIN.disc + PIN.gap - 0.5);
    // The pair a street apart stays side by side, the same way round.
    expect(out[1]!.x).toBeGreaterThan(out[0]!.x);
    // Never under the card, never off the box.
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(laptop.inset + PIN.disc / 2);
      expect(p.x).toBeLessThanOrEqual(laptop.width - PIN.disc / 2);
      expect(p.y).toBeGreaterThanOrEqual(PIN.disc / 2);
      expect(p.y).toBeLessThanOrEqual(laptop.height - PIN.disc / 2);
    }
    // On a street map (no clamping): a pin off the edge stays off it, still pushed off its neighbour.
    const free = spreadPins(
      [
        { x: -50, y: 900 },
        { x: -50, y: 900 },
      ],
      laptop,
      false,
    );
    expect(free.every((p) => p.x < 0 && p.y > laptop.height)).toBe(true);
    expect(apart(free[0]!, free[1]!)).toBeGreaterThanOrEqual(PIN.disc + PIN.gap - 0.5);
    // Pins already apart don't move; and it comes out the same every time.
    expect(
      spreadPins(
        [
          { x: 600, y: 100 },
          { x: 900, y: 400 },
        ],
        laptop,
      ),
    ).toEqual([
      { x: 600, y: 100 },
      { x: 900, y: 400 },
    ]);
    expect(
      spreadPins(
        [
          { x: 600, y: 400 },
          { x: 600, y: 400 },
        ],
        laptop,
      ),
    ).toEqual(
      spreadPins(
        [
          { x: 600, y: 400 },
          { x: 600, y: 400 },
        ],
        laptop,
      ),
    );
  });

  it("each label on the side it fits, the most important first; none where it fits on neither", () => {
    // Two pins one above the other, close, with more room on their right: the first's label takes
    // the right, the second's can't
    // (it would cover the first's), so it goes left.
    const spots = [
      { x: 700, y: 200 },
      { x: 700, y: 236 },
    ];
    expect(labelSides(spots, [180, 180], [0, 1], laptop)).toEqual(["right", "left"]);
    // Their order decides who gets the right.
    expect(labelSides(spots, [180, 180], [1, 0], laptop)).toEqual(["left", "right"]);
    // Near the right edge: left first.
    expect(labelSides([{ x: 1100, y: 200 }], [180], [0], laptop)).toEqual(["left"]);
    // Squeezed between the card and the edge, it fits on neither: left off.
    expect(labelSides([{ x: 460, y: 200 }], [700], [0], laptop)).toEqual(["none"]);
    // Never over the key (top right).
    const key = { x0: 880, y0: 12, x1: 1158, y1: 40 };
    expect(labelSides([{ x: 900, y: 30 }], [180], [0], laptop, [key])).toEqual(["left"]);
    // No widths (a phone, where the labels don't show): none.
    expect(labelSides(spots, [null, null], [0, 1], phone)).toEqual(["none", "none"]);
  });

  it("the whole layout: right of the card on a laptop, the full width on a phone; no disc on another", () => {
    const leeds = { lat: 53.8, lng: -1.55 };
    const york = { lat: 53.96, lng: -1.08 };
    const next = { lat: 53.8001, lng: -1.5501 }; // next door to Leeds
    for (const box of [laptop, phone]) {
      const out = layoutPins([leeds, york, next], box, [150, 150, 150], [0, 1, 2]);
      expect(out.map((p) => p.x).every((x) => x >= box.inset + PIN.disc / 2)).toBe(true);
      expect(apart(out[0]!, out[2]!)).toBeGreaterThanOrEqual(PIN.disc + PIN.gap - 0.5);
      // York still east of Leeds.
      expect(out[1]!.x).toBeGreaterThan(out[0]!.x);
    }
  });

  it("which labels matter most: the card's venue, then urgent, then the most places", () => {
    expect(
      labelOrder(
        [
          { siteId: "a", urgent: false, places: 2 },
          { siteId: "b", urgent: true, places: 1 },
          { siteId: "c", urgent: false, places: 9 },
          { siteId: "d", urgent: false, places: 1 },
        ],
        "d",
      ),
    ).toEqual([3, 1, 2, 0]);
  });
});

describe("the map's words", () => {
  const arena = {
    name: "Acme Demo Arena",
    places: 10,
    urgent: true,
    hidden: false,
    days: ["2026-11-03", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"],
  };

  it("a pin: its days, and what it says to a screen reader", () => {
    expect(dayShort("2026-11-03")).toBe("Tue 3");
    expect(pinDays(arena)).toBe("Tue 3, Sat 7, Sun 8 and 2 more");
    expect(pinLabel(arena)).toBe(
      "Acme Demo Arena: 10 places to fill, urgent, Tue 3, Sat 7, Sun 8 and 2 more",
    );
    const hidden = {
      ...arena,
      name: "Hillside Demo Square",
      places: 1,
      urgent: false,
      hidden: true,
      days: ["2026-11-22"],
    };
    expect(pinDays(hidden)).toBe("Sun 22 · hidden");
    expect(pinLabel(hidden)).toBe(
      "Hillside Demo Square: 1 place to fill, hidden from casuals, Sun 22",
    );
    const full = { ...arena, places: 0, days: [] };
    expect(pinDays(full)).toBe("All places filled");
    expect(pinLabel(full)).toBe("Acme Demo Arena: all places filled");
  });

  it("under the map: how to use it, or how it's placed without streets; who isn't on it", () => {
    expect(mapFoot(false)).toBe(
      "Placed by each venue's postcode · a pin's number is its places to fill",
    );
    expect(mapFoot(true)).toBe(
      "Drag to move · Ctrl + scroll to zoom (two fingers on a phone) · a pin's number is its places to fill",
    );
    expect(
      unplacedLine([
        { name: "Hillside Demo Square", places: 4 },
        { name: "Acme Hall", places: 1 },
      ]),
    ).toBe(
      "Not on the map (no postcode yet): Hillside Demo Square, 4 places to fill; Acme Hall, 1 place to fill.",
    );
  });

  it("the card: its length and pay, who can take it, and its main button", () => {
    const from = new Date("2026-11-04T19:00:00Z");
    expect(lengthAndPay(from, new Date("2026-11-05T01:00:00Z"), 1500)).toBe("6 h · £15.00/h");
    expect(lengthAndPay(from, new Date("2026-11-05T02:30:00Z"), null)).toBe("7.5 h");
    expect(takersWarning(null)).toBeNull();
    expect(takersWarning({ count: 0, only: null })).toBe("Nobody can be offered it right now.");
    expect(takersWarning({ count: 3, only: null })).toBeNull();
    const zoe = { count: 1, only: { workerId: "w", name: "Zoe Adeyemi", hoursThisWeek: 1 } };
    expect(takersWarning(zoe)).toBe("Only Zoe Adeyemi can take it: 1 hour booked that week.");
    expect(offerButton(zoe)).toBe("Offer to Zoe");
    expect(offerButton({ count: 2, only: null })).toBe("Offer to someone");
    expect(offerButton(null)).toBe("Offer to someone");
  });

  it("an update's time: today's alone, earlier ones with their day (London)", () => {
    const now = new Date("2026-11-02T14:00:00Z");
    expect(updateWhen(new Date("2026-11-02T09:06:00Z"), now, "Europe/London")).toBe("09:06");
    expect(updateWhen(new Date("2026-11-01T08:00:00Z"), now, "Europe/London")).toBe("Sun 08:00");
  });
});

describe("the street map's file (MAP_TILES_URL)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:p@localhost:5432/shiftdesk",
    SESSION_SECRET: "x".repeat(40),
    APP_BASE_DOMAIN: "localhost:3000",
  };
  const parse = (env: Record<string, string>) => appEnvSchema.safeParse({ ...base, ...env });

  it("a path on this server, ending .pmtiles, never another host; never in tests", () => {
    const ok = (v: string) => parse({ NODE_ENV: "development", MAP_TILES_URL: v }).success;
    expect(ok("/maps/uk.pmtiles")).toBe(true);
    expect(ok("/maps/uk-2026.pmtiles")).toBe(true);
    // Never another host (aud-8: our own server): not https, not "//" or "/\\" (a browser reads
    // both as another host).
    expect(ok("https://maps.example.host/uk.pmtiles")).toBe(false);
    expect(ok("http://maps.example.host/uk.pmtiles")).toBe(false);
    expect(ok("//maps.example.host/uk.pmtiles")).toBe(false);
    expect(ok("/\\maps.example.host/uk.pmtiles")).toBe(false);
    expect(ok("/maps/uk.mbtiles")).toBe(false);
    expect(ok("/maps/uk.pmtiles?v=1")).toBe(false);
    expect(ok("javascript:alert(1).pmtiles")).toBe(false);
    // Empty is unset (the plain ground).
    expect(parse({ NODE_ENV: "development", MAP_TILES_URL: "" }).success).toBe(true);
    // A test run refuses one.
    const test = parse({ NODE_ENV: "test", MAP_TILES_URL: "/maps/uk.pmtiles" });
    expect(test.success).toBe(false);
    expect(JSON.stringify(test.error?.issues)).toContain("tests never fetch a street map");
  });

  it("the tests' own settings keep it unset, and the map loads MapLibre only when there's one", () => {
    expect(read("tests/setup/env.ts")).toContain('process.env.MAP_TILES_URL = "";');
    expect(read("playwright.config.ts")).toMatch(/\n {2}MAP_TILES_URL: "",\n/);
    const map = read("src/app/office/dashboard/venue-map.tsx");
    expect(map).toMatch(/if \(!tiles \|\| !box\.current\) return;/);
    expect(map).toContain('import("maplibre-gl")');
    expect(map).toContain("cooperativeGestures: true");
    expect(map).toContain('.filter((l) => l.type !== "symbol")');
    // Its web worker from our own route (where the bundler leaves it, MapLibre can't find it).
    expect(map).toContain(
      "maplibregl.setWorkerUrl(`/office/map-worker?v=${maplibregl.getVersion()}`)",
    );
    // The street map's key and credit over MapLibre's canvas (it's added after them).
    expect(map).toMatch(
      /className="absolute right-2 bottom-2 z-10 [^"]*">\s*© OpenStreetMap contributors/,
    );
    expect(map).toMatch(
      /aria-label="Key"\s+className="pointer-events-none absolute top-3 right-3 z-10 /,
    );
    // No static import of the map libraries anywhere (they'd load on every office page).
    expect(map).not.toMatch(/^import [^;]*from "(?:maplibre-gl|pmtiles|@protomaps\/basemaps)";/m);
  });
});

describe("MapLibre's web worker (/office/map-worker)", () => {
  it("is the installed package's own worker file, as JavaScript, cached for a day", async () => {
    const { GET } = await import("@/app/office/map-worker/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await res.arrayBuffer());
    expect(
      body.equals(
        readFileSync(join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")),
      ),
    ).toBe(true);
  });
});

// The launch review's O4: the map holds this pay week and next (the top bar counts every place to
// fill), so its count says which days it covers, under each tab and a chosen day.
describe("the map's count", () => {
  it("its venues and places, and the days they cover", () => {
    expect(mapCountLine(6, 29, { show: "all" })).toBe(
      "6 venues · 29 places to fill this week and next",
    );
    expect(mapCountLine(1, 1, { show: "urgent" })).toBe(
      "1 venue · 1 urgent place to fill this week and next",
    );
    expect(mapCountLine(2, 5, { show: "urgent" })).toBe(
      "2 venues · 5 urgent places to fill this week and next",
    );
    expect(mapCountLine(1, 2, { show: "urgent", day: "2026-11-03" })).toBe(
      "1 venue · 2 urgent places to fill on Tue 3 Nov",
    );
    expect(mapCountLine(3, 11, { show: "this-week" })).toBe(
      "3 venues · 11 places to fill this week",
    );
    expect(mapCountLine(2, 4, { show: "next-week" })).toBe("2 venues · 4 places to fill next week");
    expect(mapCountLine(2, 4, { show: "all", day: "2026-11-03" })).toBe(
      "2 venues · 4 places to fill on Tue 3 Nov",
    );
    expect(mapCountLine(0, 0, { show: "all", day: null })).toBe(
      "0 venues · 0 places to fill this week and next",
    );
  });
});
