import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appEnvSchema } from "@/lib/env";
import {
  dayShort,
  FIT_ALL,
  lengthAndPay,
  listButton,
  MAP_BUTTONS,
  mapCountLine,
  mapFoot,
  offerButton,
  pinDays,
  pinLabel,
  STEP_BEFORE,
  STEP_NEXT,
  stepPosition,
  stepperText,
  takersWarning,
  unplacedLine,
  updateWhen,
  ZOOM_IN,
  ZOOM_OUT,
} from "@/lib/office/dashboard-map-copy";
import {
  cameraPadding,
  isPhoneBox,
  keepClear,
  labelOrder,
  labelSides,
  layoutPins,
  mercatorY,
  PIN,
  placeLabels,
  placePins,
  spreadPins,
  stepperAt,
  stepTo,
  venueBounds,
  venueSessions,
  type Rect,
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

// Phase 27.4, "the map you can use" (Dylan, 2026-11-04, on docs/mockups/round-8/27.4-map/).
describe("the chosen pin's name, on a phone and a laptop (Phase 27.4)", () => {
  // A phone's map (390px page): 358 by 380. Its key top left, its list button top right.
  const phone = { width: 358, height: 380, inset: 0 };
  const key: Rect = { x0: 12, y0: 12, x1: 200, y1: 40 };
  const buttons: Rect = { x0: 302, y0: 12, x1: 346, y1: 56 };
  const over = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  // Where a label sits, from its side and its shift (the page's own geometry: 4px off the 44px pin,
  // 40px tall).
  const half = PIN.target / 2 + PIN.labelGap;
  const rectOf = (
    s: { x: number; y: number },
    w: number,
    l: { side: string; shift: number },
  ): Rect => {
    const h = PIN.labelHeight;
    if (l.side === "right")
      return { x0: s.x + half, y0: s.y - h / 2, x1: s.x + half + w, y1: s.y + h / 2 };
    if (l.side === "left")
      return { x0: s.x - half - w, y0: s.y - h / 2, x1: s.x - half, y1: s.y + h / 2 };
    const x0 = s.x - w / 2 + l.shift;
    const y0 = l.side === "below" ? s.y + half : s.y - half - h;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };
  const inside = (r: Rect, box: { width: number; height: number; inset: number }) =>
    r.x0 >= box.inset + PIN.edge &&
    r.x1 <= box.width - PIN.edge &&
    r.y0 >= PIN.edge &&
    r.y1 <= box.height - PIN.edge;

  it("a phone's map is under 640px of page", () => {
    expect(isPhoneBox(358)).toBe(true);
    expect(isPhoneBox(639)).toBe(true);
    expect(isPhoneBox(640)).toBe(false);
    expect(isPhoneBox(1172)).toBe(false);
  });

  it("only the chosen pin's name, beside it where it fits", () => {
    const spots = [
      { x: 120, y: 200 },
      { x: 250, y: 260 },
    ];
    // The other pins have no width on a phone: no name.
    const out = placeLabels(spots, [150, null], [0, 1], phone, [key, buttons], 0);
    expect(out).toEqual([
      { side: "right", shift: 0 },
      { side: "none", shift: 0 },
    ]);
  });

  it("too long for either side: under it, centred; near the edge, moved in; at the foot, over it", () => {
    const under = placeLabels([{ x: 180, y: 200 }], [220], [0], phone, [key, buttons], 0)[0]!;
    expect(under).toEqual({ side: "below", shift: 0 });
    // Near the right edge, with a pin on its left: under it, moved left to stay inside.
    const spots = [
      { x: 340, y: 200 },
      { x: 290, y: 200 },
    ];
    const moved = placeLabels(spots, [120, null], [0, 1], phone, [key, buttons], 0)[0]!;
    expect(moved.side).toBe("below");
    expect(moved.shift).toBe(-46);
    expect(inside(rectOf(spots[0]!, 120, moved), phone)).toBe(true);
    // At the map's foot, too long for either side: over it.
    const foot = { x: 180, y: 360 };
    const up = placeLabels([foot], [300], [0], phone, [key, buttons], 0)[0]!;
    expect(up.side).toBe("above");
    expect(inside(rectOf(foot, 300, up), phone)).toBe(true);
  });

  it("kept clear of the map's buttons and key", () => {
    // A pin right under the buttons: beside it would cover them (or leave the map), over it would
    // leave it, so under it, moved left of them.
    const s = { x: 330, y: 30 };
    const l = placeLabels([s], [160], [0], phone, [key, buttons], 0)[0]!;
    expect(l.side).toBe("below");
    const r = rectOf(s, 160, l);
    expect(over(r, buttons)).toBe(false);
    expect(over(r, key)).toBe(false);
    expect(inside(r, phone)).toBe(true);
    // A pin under the key: its name clear of it too.
    const k = { x: 60, y: 30 };
    const kl = placeLabels([k], [180], [0], phone, [key, buttons], 0)[0]!;
    expect(over(rectOf(k, 180, kl), key)).toBe(false);
    expect(inside(rectOf(k, 180, kl), phone)).toBe(true);
  });

  it("always shows, even where every side covers another pin (and never takes its taps: board.tsx)", () => {
    const s = { x: 180, y: 190 };
    const around = [
      { x: 180, y: 140 },
      { x: 180, y: 240 },
      { x: 120, y: 190 },
      { x: 240, y: 190 },
      { x: 130, y: 240 },
      { x: 230, y: 240 },
      { x: 130, y: 140 },
      { x: 230, y: 140 },
    ];
    const out = placeLabels(
      [s, ...around],
      [200, ...around.map(() => null)],
      [0],
      phone,
      [key, buttons],
      0,
    );
    expect(out[0]!.side).not.toBe("none");
    expect(inside(rectOf(s, 200, out[0]!), phone)).toBe(true);
    // Not the chosen one: left off, as before.
    const other = placeLabels([s, ...around], [200, ...around.map(() => null)], [0], phone, [
      key,
      buttons,
    ]);
    expect(other[0]!.side).toBe("none");
  });

  it("no pin under the key or the map's buttons: each moved the shortest way clear", () => {
    const target = (p: { x: number; y: number }): Rect => ({
      x0: p.x - PIN.target / 2,
      y0: p.y - PIN.target / 2,
      x1: p.x + PIN.target / 2,
      y1: p.y + PIN.target / 2,
    });
    // Two under the buttons: one moved left of them (30px, shorter than 38px down), one under them
    // (48px, shorter than 50px left; right of them is off the map); one under the key (moved under
    // it); one clear (where it was).
    const out = keepClear(
      [
        { x: 310, y: 40 },
        { x: 330, y: 30 },
        { x: 100, y: 30 },
        { x: 180, y: 200 },
      ],
      [key, buttons],
      phone,
    );
    expect(out).toEqual([
      { x: buttons.x0 - PIN.target / 2, y: 40 },
      { x: 330, y: buttons.y1 + PIN.target / 2 },
      { x: 100, y: key.y1 + PIN.target / 2 },
      { x: 180, y: 200 },
    ]);
    // The whole layout keeps every pin clear of them, whatever the venues.
    const corners = [
      { lat: 54.1, lng: -1.2 }, // north east: the buttons' corner
      { lat: 54.1, lng: -1.9 }, // north west: the key's
      { lat: 53.7, lng: -1.5 },
    ];
    for (const p of layoutPins(corners, phone, [null, null, null], [0, 1, 2], [key, buttons])) {
      expect(over(target(p), key)).toBe(false);
      expect(over(target(p), buttons)).toBe(false);
    }
  });

  it("on a laptop the others are as before (beside their pin, or none) and the chosen one's always shows", () => {
    const laptop = { width: 1170, height: 600, inset: 428 };
    // Squeezed between the card and the edge, too long for either side: none, unless it's chosen.
    expect(labelSides([{ x: 460, y: 200 }], [700], [0], laptop)).toEqual(["none"]);
    const chosen = placeLabels([{ x: 460, y: 200 }], [700], [0], laptop, [], 0)[0]!;
    expect(chosen.side).toBe("below");
    // Moved right of the card (it covers the left 428px), inside the map.
    expect(inside(rectOf({ x: 460, y: 200 }, 700, chosen), laptop)).toBe(true);
    // The open list covers the right (`right`): no name under it, no pin either.
    const open = { ...laptop, right: 420 };
    expect(labelSides([{ x: 700, y: 200 }], [180], [0], open)).toEqual(["left"]);
    for (const p of spreadPins([{ x: 1000, y: 300 }], open))
      expect(p.x).toBeLessThanOrEqual(open.width - open.right - PIN.disc / 2);
    const leeds = { lat: 53.8, lng: -1.55 };
    const york = { lat: 53.96, lng: -1.08 };
    for (const p of layoutPins([leeds, york], open, [150, 150], [0, 1])) {
      expect(p.x).toBeGreaterThanOrEqual(open.inset + PIN.disc / 2);
      expect(p.x).toBeLessThanOrEqual(open.width - open.right - PIN.disc / 2);
    }
  });

  it("a chosen pin among others slides its name clear of them, not over them (CI, Mon 9 Nov)", () => {
    // At the map's foot (no room under it), a pin on each side and one right over it: beside it
    // and centred over it each cover a pin. Sliding over-and-right is clear.
    const laptop = { width: 1170, height: 528, inset: 428 };
    const s = { x: 700, y: 500 };
    const others = [
      { x: 640, y: 500 },
      { x: 760, y: 500 },
      { x: 700, y: 450 },
    ];
    const spots = [s, ...others];
    const w = 120;
    const out = placeLabels(spots, [w, null, null, null], [0], laptop, [], 0)[0]!;
    const r = rectOf(s, w, out);
    expect(out.side).toBe("above");
    expect(inside(r, laptop)).toBe(true);
    for (const o of others) {
      const disc: Rect = {
        x0: o.x - PIN.disc / 2,
        y0: o.y - PIN.disc / 2,
        x1: o.x + PIN.disc / 2,
        y1: o.y + PIN.disc / 2,
      };
      const over = r.x0 < disc.x1 && disc.x0 < r.x1 && r.y0 < disc.y1 && disc.y0 < r.y1;
      expect(over, JSON.stringify({ o, r })).toBe(false);
    }
  });
});

describe("moving the street map: the free part the card and the list leave (Phase 27.4)", () => {
  it("on a laptop: right of the card, left of the buttons or the open list, under the key, over the credit", () => {
    const box = { width: 1172, height: 600 };
    const card: Rect = { x0: 12, y0: 12, x1: 416, y1: 540 };
    expect(cameraPadding(box, { card, list: null })).toEqual({
      top: 70,
      bottom: 50,
      left: 456,
      right: 90,
    });
    // The list open (352px wide, 64px in from the right): 30px left of it.
    const list: Rect = { x0: 756, y0: 56, x1: 1108, y1: 560 };
    expect(cameraPadding(box, { card, list })).toEqual({
      top: 70,
      bottom: 50,
      left: 456,
      right: 446,
    });
  });

  it("a narrower map keeps a fifth of itself free, the two sides in proportion", () => {
    const box = { width: 1024, height: 600 };
    const card: Rect = { x0: 12, y0: 12, x1: 416, y1: 540 };
    const list: Rect = { x0: 608, y0: 56, x1: 960, y1: 560 };
    const p = cameraPadding(box, { card, list });
    expect(box.width - p.left - p.right).toBeGreaterThanOrEqual(box.width / 5 - 1);
    expect(p.left / p.right).toBeCloseTo(456 / 446, 1);
    // A tiny one: at least 80px free each way.
    const tiny = cameraPadding({ width: 120, height: 100 }, { card: null, list: null });
    expect(120 - tiny.left - tiny.right).toBeGreaterThanOrEqual(79);
    expect(100 - tiny.top - tiny.bottom).toBeGreaterThanOrEqual(79);
  });

  it("on a phone (the card under the map): clear of the key at the top and the buttons on the right", () => {
    expect(cameraPadding({ width: 358, height: 380 }, { card: null, list: null })).toEqual({
      top: 56,
      bottom: 36,
      left: 36,
      right: 70,
    });
  });
});

describe("a venue's sessions, and the card's \"1 of 2\" (Phase 27.4)", () => {
  // In the view's order, soonest first: two venues and a session with none.
  const a1 = { shiftId: "a1", siteId: "A" };
  const b1 = { shiftId: "b1", siteId: "B" };
  const a2 = { shiftId: "a2", siteId: "A" };
  const a3 = { shiftId: "a3", siteId: "A" };
  const n1 = { shiftId: "n1", siteId: null };
  const all = [a1, b1, a2, a3, n1];

  it("a venue's sessions in the view's order; none for no venue", () => {
    expect(venueSessions(all, "A")).toEqual([a1, a2, a3]);
    expect(venueSessions(all, "B")).toEqual([b1]);
    expect(venueSessions(all, null)).toEqual([]);
    // A pin picks its venue's first: the soonest.
    expect(venueSessions(all, "A")[0]).toBe(a1);
  });

  it("where the chosen one is among them; no row for one alone, no venue, or one the view doesn't hold", () => {
    expect(stepperAt(all, a1)).toEqual({ index: 0, count: 3 });
    expect(stepperAt(all, a2)).toEqual({ index: 1, count: 3 });
    expect(stepperAt(all, a3)).toEqual({ index: 2, count: 3 });
    expect(stepperAt(all, b1)).toBeNull();
    expect(stepperAt(all, n1)).toBeNull();
    expect(stepperAt(all, { shiftId: "elsewhere", siteId: "A" })).toBeNull();
    expect(stepperAt(all, null)).toBeNull();
  });

  it("one step before or after; never round from an end to the other", () => {
    expect(stepTo(all, a1, 1)).toBe(a2);
    expect(stepTo(all, a2, 1)).toBe(a3);
    expect(stepTo(all, a2, -1)).toBe(a1);
    expect(stepTo(all, a1, -1)).toBeNull();
    expect(stepTo(all, a3, 1)).toBeNull();
    expect(stepTo(all, b1, 1)).toBeNull();
    expect(stepTo(all, { shiftId: "elsewhere", siteId: "A" }, 1)).toBeNull();
  });

  it("its words, and the map's buttons'", () => {
    expect(stepperText("Acme Demo Arena", 0, 2)).toBe("Acme Demo Arena · 1 of 2");
    expect(stepPosition(1, 2)).toBe("2 of 2");
    expect([STEP_BEFORE, STEP_NEXT]).toEqual(["The session before", "The next session"]);
    expect(listButton(false)).toBe("Show the sessions to offer");
    expect(listButton(true)).toBe("Hide the sessions to offer");
    expect([ZOOM_IN, ZOOM_OUT, FIT_ALL]).toEqual(["Zoom in", "Zoom out", "Back to every venue"]);
    expect(MAP_BUTTONS).toBe("Map buttons");
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
    // Its style from the street map's own module (Phase 27.8: names on, letter shapes from our own
    // server; tests/unit/office.map-style.test.ts), loaded with MapLibre, never on its own.
    expect(map).toContain('import("@/lib/office/map-style")');
    expect(map).toContain(
      'style: mapStyle.mapStyle(tiles, dark ? "dark" : "light", MAP_ATTRIBUTION),',
    );
    expect(map).not.toContain('l.type !== "symbol"');
    // Its web worker from our own route (where the bundler leaves it, MapLibre can't find it).
    expect(map).toContain(
      "maplibregl.setWorkerUrl(`/office/map-worker?v=${maplibregl.getVersion()}`)",
    );
    // The street map's key, credit and buttons over MapLibre's canvas (it's added after them). The
    // key top left on a phone (Phase 27.4: it was hidden there), top right from 640px.
    expect(map).toMatch(
      /className="absolute right-2 bottom-2 z-10 [^"]*">\s*© OpenStreetMap contributors/,
    );
    expect(map).toMatch(
      /aria-label="Key"\s+className=\{`pointer-events-none absolute top-3 left-3 z-10 flex [^`]*@min-\[40rem\]:left-auto /,
    );
    expect(map).toMatch(
      /aria-label=\{MAP_BUTTONS\}\s+className="absolute top-3 right-3 z-10 flex flex-col gap-2"/,
    );
    // No static import of the map libraries anywhere (they'd load on every office page), nor of
    // the style's module (it brings Protomaps' layers with it).
    expect(map).not.toMatch(/^import [^;]*from "(?:maplibre-gl|pmtiles|@protomaps\/basemaps)";/m);
    expect(map).not.toMatch(/^import [^;]*from "@\/lib\/office\/map-style";/m);
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
