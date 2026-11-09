// Where the venue map puts each pin (Phase 26.2, dash-1): pure, so the tests check it. Without a
// street map (no MAP_TILES_URL: dev, the tests, a firm before its map file is up) the pins are
// placed by their own latitude and longitude, in Web Mercator (the street map's own projection, so
// a pin is where it will be once the streets show), the whole set fitted into the map's box with a
// margin and its shape kept (a degree of longitude isn't a degree of latitude). One venue alone, or
// several at one spot, sit in the middle.

export interface Placed {
  x: number; // 0 to 1, from the left
  y: number; // 0 to 1, from the top
}

const rad = (deg: number) => (deg * Math.PI) / 180;
// Web Mercator's y for a latitude (north is up: larger is further north).
export const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

export function placePins(
  points: { lat: number; lng: number }[],
  box: { width: number; height: number },
  margin = 0.12,
): Placed[] {
  if (points.length === 0) return [];
  const xs = points.map((p) => rad(p.lng));
  const ys = points.map((p) => mercatorY(p.lat));
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const inner = { w: box.width * (1 - 2 * margin), h: box.height * (1 - 2 * margin) };
  // One scale for both directions (the map's shape kept), the smaller of the two that fit.
  const scale = Math.min(
    spanX > 0 ? inner.w / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? inner.h / spanY : Number.POSITIVE_INFINITY,
  );
  const s = Number.isFinite(scale) ? scale : 0;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return points.map((_, i) => ({
    x: (box.width / 2 + (xs[i]! - midX) * s) / box.width,
    y: (box.height / 2 - (ys[i]! - midY) * s) / box.height,
  }));
}

// The map's view for a set of venues once the streets show: their bounds (west, south, east,
// north), or null for none.
export function venueBounds(
  points: { lat: number; lng: number }[],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

// --- Laying the pins out in the map's real box (once the page has measured it) ---------------------
//
// A pin is a 44px tap target with a 36px disc at its centre; its label (the venue's name and days)
// sits 4px off its right or left edge, 40px tall (the chosen pin's can also sit 4px under or over
// it, moved sideways to stay inside the map: Phase 27.4). Measured in pixels from the box's top
// left. The session card covers the box's left from 1024px: `inset` is the width it takes, so no
// pin or label goes under it; the list of sessions to offer, open, covers its right (`right`).

export const PIN = { disc: 36, target: 44, gap: 6, labelGap: 4, labelHeight: 40, edge: 4 } as const;

// Below 640px of page the map is a phone's (Phase 27.4: only the chosen pin's name shows there).
// The map's box is the page's width, so its own width says which.
export const PHONE_MAX = 640;
export const isPhoneBox = (width: number) => width < PHONE_MAX;

export type LabelSide = "right" | "left" | "below" | "above" | "none";
export interface PinSpot {
  x: number; // the pin's centre, px from the box's left
  y: number; // px from its top
  label: LabelSide;
  shift: number; // px a label under or over its pin is moved sideways (0 beside it)
}
export interface PinBox {
  width: number;
  height: number;
  inset: number; // px on the left the card covers (0 below 1024px)
  right?: number; // px on the right the open list covers (0 when shut, and below 1024px)
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

// Pins closer than a disc and a gap pushed apart, evenly, along the line between them (straight
// on top of each other: apart in a fixed direction for each, so it always comes out the same),
// each kept inside the box and clear of the card (`clamp`; on a street map, which can be moved,
// a pin off the edge stays off it). Venues a few streets apart stay a few streets apart once they
// no longer cover each other.
export function spreadPins(
  spots: { x: number; y: number }[],
  box: PinBox,
  clamp = true,
): { x: number; y: number }[] {
  const out = spots.map((s) => ({ ...s }));
  const min = PIN.disc + PIN.gap;
  const r = PIN.disc / 2 + PIN.edge;
  const right = box.right ?? 0;
  const keep = (p: { x: number; y: number }) => {
    if (!clamp) return;
    p.x = Math.min(Math.max(p.x, box.inset + r), Math.max(box.inset + r, box.width - right - r));
    p.y = Math.min(Math.max(p.y, r), Math.max(r, box.height - r));
  };
  out.forEach(keep);
  for (let round = 0; round < 80; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min - 0.01) continue;
        const angle = (j * 2.399963) % (2 * Math.PI); // the golden angle: a different way for each
        const [ux, uy] = d > 0.01 ? [dx / d, dy / d] : [Math.cos(angle), Math.sin(angle)];
        const push = (min - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        keep(a);
        keep(b);
        moved = true;
      }
    if (!moved) break;
  }
  return out;
}

export interface LabelSpot {
  side: LabelSide;
  shift: number; // px moved sideways, under or over the pin (0 beside it)
}

// Where each pin's label goes, or none: the most important first (`order`: indexes, first first),
// each on its side with more room first, then the other, only where it fits inside the box, clear
// of the card (and the open list), of every disc, of the labels already placed and of anything else
// on the map (`avoid`: the key and the map's buttons). A label that fits nowhere is left off; its
// venue's name is still in the pin's link words and in the table under the map. `widths`: each
// label's width in px (0 or null: none, as for every pin but the chosen one on a phone).
//
// The chosen pin's (`chosen`: its index; Phase 27.4) always shows: beside it if it fits, else under
// or over it, moved sideways to stay inside the map and clear of its buttons and key; failing all
// of that, wherever it's inside the map and clear of the key and buttons, else just inside the map.
export function placeLabels(
  spots: { x: number; y: number }[],
  widths: (number | null)[],
  order: number[],
  box: PinBox,
  avoid: Rect[] = [],
  chosen: number | null = null,
): LabelSpot[] {
  const out: LabelSpot[] = spots.map(() => ({ side: "none", shift: 0 }));
  const half = PIN.target / 2 + PIN.labelGap;
  const lo = box.inset + PIN.edge;
  const hi = box.width - (box.right ?? 0) - PIN.edge;
  const discs: Rect[] = spots.map((s) => ({
    x0: s.x - PIN.disc / 2,
    y0: s.y - PIN.disc / 2,
    x1: s.x + PIN.disc / 2,
    y1: s.y + PIN.disc / 2,
  }));
  const taken: Rect[] = [...avoid];
  const inside = (r: Rect) =>
    r.x0 >= lo && r.x1 <= hi && r.y0 >= PIN.edge && r.y1 <= box.height - PIN.edge;
  const clear = (r: Rect, of: Rect[]) => of.every((t) => !overlaps(r, t, 4));
  for (const i of order) {
    const s = spots[i];
    const w = widths[i];
    if (!s || !w) continue;
    const y0 = s.y - PIN.labelHeight / 2;
    const beside = (side: "right" | "left"): Rect =>
      side === "right"
        ? { x0: s.x + half, y0, x1: s.x + half + w, y1: y0 + PIN.labelHeight }
        : { x0: s.x - half - w, y0, x1: s.x - half, y1: y0 + PIN.labelHeight };
    const fits = (r: Rect) =>
      inside(r) && discs.every((d, k) => k === i || !overlaps(r, d, 2)) && clear(r, taken);
    const roomRight = box.width - (box.right ?? 0) - s.x;
    const roomLeft = s.x - box.inset;
    const sides: ("right" | "left")[] =
      roomRight >= roomLeft ? ["right", "left"] : ["left", "right"];
    const put = (side: LabelSide, r: Rect, shift = 0) => {
      out[i] = { side, shift };
      taken.push(r);
    };
    const side = sides.find((t) => fits(beside(t)));
    if (side) {
      put(side, beside(side));
      continue;
    }
    if (i !== chosen) continue;
    // Under or over it: centred on the pin, moved sideways to stay inside the map, or to clear
    // something on the map (the buttons, the key) by sitting just left or right of it.
    const left = s.x - w / 2; // the label's left edge, centred
    const within = Math.max(lo - left, Math.min(0, hi - (left + w)));
    // Besides the buttons and the key, it can slide clear of the pins next to it: just left or
    // right of each other disc, or along in steps. Without those, a chosen pin with neighbours on
    // every side (CI's run on Mon 9 Nov: Acme Demo Arena low on the map among four others) found
    // no clear spot and its name fell over the other pins.
    const step = PIN.disc / 2;
    const sweep = Array.from({ length: Math.ceil(w / step) * 2 + 1 }, (_, n) =>
      Math.round((n - Math.ceil(w / step)) * step),
    );
    const shifts = [
      ...new Set([
        within,
        ...avoid.flatMap((a) => [a.x0 - PIN.edge - (left + w), a.x1 + PIN.edge - left]),
        ...discs.flatMap((d, k) =>
          k === i ? [] : [d.x0 - PIN.edge - (left + w), d.x1 + PIN.edge - left],
        ),
        ...sweep.map((sh) => within + sh),
      ]),
    ];
    const around = (where: "below" | "above", shift: number): Rect => {
      const top = where === "below" ? s.y + half : s.y - half - PIN.labelHeight;
      return { x0: left + shift, y0: top, x1: left + shift + w, y1: top + PIN.labelHeight };
    };
    const tries: [LabelSide, Rect, number][] = (["below", "above"] as const).flatMap((where) =>
      shifts.map((sh) => [where, around(where, sh), sh] as [LabelSide, Rect, number]),
    );
    const all: [LabelSide, Rect, number][] = [
      ...sides.map((t) => [t, beside(t), 0] as [LabelSide, Rect, number]),
      ...tries,
    ];
    const best =
      tries.find(([, r]) => fits(r)) ??
      all.find(([, r]) => inside(r) && clear(r, avoid)) ??
      all.find(([, r]) => inside(r)) ??
      tries[0]!;
    put(...best);
  }
  return out;
}

// Each pin's label side alone (as placeLabels).
export function labelSides(
  spots: { x: number; y: number }[],
  widths: (number | null)[],
  order: number[],
  box: PinBox,
  avoid: Rect[] = [],
  chosen: number | null = null,
): LabelSide[] {
  return placeLabels(spots, widths, order, box, avoid, chosen).map((l) => l.side);
}

// Pins out from under what's on the map (`avoid`: the key, the map's buttons; Phase 27.4, when the
// key came onto a phone's map and the list's button onto every one): each pin's whole 44px target
// moved the shortest way clear of it (left, right or under it), inside the box. A pin clear already
// stays where it is.
export function keepClear(
  spots: { x: number; y: number }[],
  avoid: Rect[],
  box: PinBox,
): { x: number; y: number }[] {
  const r = PIN.target / 2;
  const hi = box.width - (box.right ?? 0);
  return spots.map((p) => {
    let { x, y } = p;
    for (const a of avoid) {
      if (x + r <= a.x0 || x - r >= a.x1 || y + r <= a.y0 || y - r >= a.y1) continue;
      const best = [
        { x: a.x0 - r, y, d: x - (a.x0 - r) },
        { x: a.x1 + r, y, d: a.x1 + r - x },
        { x, y: a.y1 + r, d: a.y1 + r - y },
      ]
        .filter((m) => m.x - r >= box.inset && m.x + r <= hi && m.y + r <= box.height)
        .sort((m, n) => m.d - n.d)[0];
      if (best) ({ x, y } = best);
    }
    return { x, y };
  });
}

// The whole layout without a street map: the venues placed in the part of the box the card (and
// the open list) leave (placePins: their real positions, the shape kept), spread so no disc covers
// another and moved out from under what's on the map, then labels.
export function layoutPins(
  points: { lat: number; lng: number }[],
  box: PinBox,
  widths: (number | null)[],
  order: number[],
  avoid: Rect[] = [],
  chosen: number | null = null,
): PinSpot[] {
  const free = {
    width: Math.max(1, box.width - box.inset - (box.right ?? 0)),
    height: box.height,
  };
  const placed = placePins(points, free).map((p) => ({
    x: box.inset + p.x * free.width,
    y: p.y * free.height,
  }));
  const spots = keepClear(
    spreadPins(keepClear(spreadPins(placed, box), avoid, box), box),
    avoid,
    box,
  );
  const labels = placeLabels(spots, widths, order, box, avoid, chosen);
  return spots.map((s, i) => ({ ...s, label: labels[i]!.side, shift: labels[i]!.shift }));
}

// --- Moving the street map (Phase 27.4) -------------------------------------------------------------

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// The part of the street map the floating card (and the open list) leave free, as MapLibre's own
// padding: a move to a venue centres it there and a fit keeps every venue inside it. `card` and
// `list` are their boxes in the map's pixels while they float on it (from 1024px of page; null
// below, where they sit under the map). On a laptop: 40px right of the card, 30px left of the
// list (or 90px in from the right, clear of the map's buttons), 70px from the top (under the key)
// and 50px from the foot (over the credit). On a phone: clear of the key (top) and the buttons
// (right). Never more than the map: at least a fifth of it (and 80px) is left free each way.
export function cameraPadding(
  box: { width: number; height: number },
  cover: { card: Rect | null; list: Rect | null },
): Padding {
  const wanted: Padding = cover.card
    ? {
        top: 70,
        bottom: 50,
        left: cover.card.x1 + 40,
        right: cover.list ? box.width - cover.list.x0 + 30 : 90,
      }
    : { top: 56, bottom: 36, left: 36, right: 70 };
  const keep = (a: number, b: number, size: number): [number, number] => {
    const most = Math.max(0, size - Math.max(80, size / 5));
    const k = a + b > most && a + b > 0 ? most / (a + b) : 1;
    return [Math.round(a * k), Math.round(b * k)];
  };
  const [left, right] = keep(wanted.left, wanted.right, box.width);
  const [top, bottom] = keep(wanted.top, wanted.bottom, box.height);
  return { top, right, bottom, left };
}

// --- A venue's sessions, and the card's "1 of 2" (Phase 27.4) ---------------------------------------

type Located = { shiftId: string; siteId: string | null };

// A venue's sessions in the view's order (the board's list, soonest first). None for no venue.
export function venueSessions<T extends Located>(all: readonly T[], siteId: string | null): T[] {
  return siteId === null ? [] : all.filter((s) => s.siteId === siteId);
}

// Where the chosen session is among its venue's (0 first) and how many there are: the card's
// stepper, or null for none (its venue has one session in the view, or it isn't in the view's list).
export function stepperAt(
  all: readonly Located[],
  chosen: Located | null,
): { index: number; count: number } | null {
  if (!chosen) return null;
  const list = venueSessions(all, chosen.siteId);
  const index = list.findIndex((s) => s.shiftId === chosen.shiftId);
  return list.length > 1 && index >= 0 ? { index, count: list.length } : null;
}

// The session one step before (-1) or after (1) the chosen one at its venue, or null at either end:
// it never wraps round (its button is off there).
export function stepTo<T extends Located>(
  all: readonly T[],
  chosen: Located,
  step: -1 | 1,
): T | null {
  const list = venueSessions(all, chosen.siteId);
  const index = list.findIndex((s) => s.shiftId === chosen.shiftId);
  return index < 0 ? null : (list[index + step] ?? null);
}

// Which labels matter most: the venue the card shows, then urgent ones, then the most places to
// fill, then as listed.
export function labelOrder(
  venues: { siteId: string; urgent: boolean; places: number }[],
  chosen: string | null,
): number[] {
  return venues
    .map((v, i) => ({ v, i }))
    .sort(
      (a, b) =>
        Number(b.v.siteId === chosen) - Number(a.v.siteId === chosen) ||
        Number(b.v.urgent) - Number(a.v.urgent) ||
        b.v.places - a.v.places ||
        a.i - b.i,
    )
    .map((x) => x.i);
}
