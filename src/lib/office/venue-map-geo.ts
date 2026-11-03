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
// A pin is a 44px tap target with a 36px disc at its centre; its label (the venue's name and days,
// from 640px) sits 4px off its right or left edge, 40px tall. Measured in pixels from the box's
// top left. The session card covers the box's left from 1024px: `inset` is the width it takes, so no
// pin or label goes under it.

export const PIN = { disc: 36, target: 44, gap: 6, labelGap: 4, labelHeight: 40, edge: 4 } as const;

export type LabelSide = "right" | "left" | "none";
export interface PinSpot {
  x: number; // the pin's centre, px from the box's left
  y: number; // px from its top
  label: LabelSide;
}
export interface PinBox {
  width: number;
  height: number;
  inset: number; // px on the left the card covers (0 below 1024px)
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
  const keep = (p: { x: number; y: number }) => {
    if (!clamp) return;
    p.x = Math.min(Math.max(p.x, box.inset + r), Math.max(box.inset + r, box.width - r));
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

// Which side each pin's label goes, or none: the most important first (`order`: indexes, first
// first), each on its side with more room first, then the other, only where it fits inside the box,
// clear of the card, of every disc, of the labels already placed and of anything else on the map
// (`avoid`: the key). A label that fits nowhere is left off; its venue's name is still in the pin's
// link words and in the table under the map. `widths`: each label's width in px (0 or null: none,
// as on a phone).
export function labelSides(
  spots: { x: number; y: number }[],
  widths: (number | null)[],
  order: number[],
  box: PinBox,
  avoid: Rect[] = [],
): LabelSide[] {
  const sides: LabelSide[] = spots.map(() => "none");
  const half = PIN.target / 2 + PIN.labelGap;
  const discs: Rect[] = spots.map((s) => ({
    x0: s.x - PIN.disc / 2,
    y0: s.y - PIN.disc / 2,
    x1: s.x + PIN.disc / 2,
    y1: s.y + PIN.disc / 2,
  }));
  const taken: Rect[] = [...avoid];
  for (const i of order) {
    const s = spots[i];
    const w = widths[i];
    if (!s || !w) continue;
    const y0 = s.y - PIN.labelHeight / 2;
    const rect = (side: "right" | "left"): Rect =>
      side === "right"
        ? { x0: s.x + half, y0, x1: s.x + half + w, y1: y0 + PIN.labelHeight }
        : { x0: s.x - half - w, y0, x1: s.x - half, y1: y0 + PIN.labelHeight };
    const fits = (r: Rect) =>
      r.x0 >= box.inset + PIN.edge &&
      r.x1 <= box.width - PIN.edge &&
      r.y0 >= PIN.edge &&
      r.y1 <= box.height - PIN.edge &&
      discs.every((d, k) => k === i || !overlaps(r, d, 2)) &&
      taken.every((t) => !overlaps(r, t, 4));
    const roomRight = box.width - s.x;
    const roomLeft = s.x - box.inset;
    const tries: ("right" | "left")[] =
      roomRight >= roomLeft ? ["right", "left"] : ["left", "right"];
    const side = tries.find((t) => fits(rect(t)));
    if (side) {
      sides[i] = side;
      taken.push(rect(side));
    }
  }
  return sides;
}

// The whole layout without a street map: the venues placed in the part of the box the card leaves
// (placePins: their real positions, the shape kept), spread so no disc covers another, then labels.
export function layoutPins(
  points: { lat: number; lng: number }[],
  box: PinBox,
  widths: (number | null)[],
  order: number[],
  avoid: Rect[] = [],
): PinSpot[] {
  const free = { width: Math.max(1, box.width - box.inset), height: box.height };
  const spots = spreadPins(
    placePins(points, free).map((p) => ({ x: box.inset + p.x * free.width, y: p.y * free.height })),
    box,
  );
  const sides = labelSides(spots, widths, order, box, avoid);
  return spots.map((s, i) => ({ ...s, label: sides[i]! }));
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
