// The tour engine's pure parts (Phase 33; src/app/tour/tour.tsx draws it): a step, where its tip
// goes beside the highlighted element, and the state kept while a tour moves between pages. Shared
// by the office's tour (33.2) and the casuals' (33.3), which only bring their own steps, anchors
// and entry points. Browser-safe.

export interface TourStep {
  // The `data-tour` value on the real element the step points at. A step whose element isn't on
  // the page (no map, say) is passed over rather than pointing at nothing.
  anchor: string;
  title: string;
  body: string;
  // The page the step is on (pathname). Another page than the one open: the tour goes there and
  // carries on. Unset: whichever page is open.
  path?: string;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placed {
  left: number;
  top: number;
  width: number;
  side: "right" | "left" | "below" | "above" | "over";
}

// The gap between the highlight and the tip, the room kept from the window's edges, and the
// spotlight's padding round the element.
export const TIP_GAP = 16;
export const EDGE = 16;
export const SPOT_PAD = 6;
export const TIP_WIDTH = 340;
// Below this width (a phone) the tip spans the window and sits above or below the element.
export const NARROW = 640;

// Where the tip goes: beside the element (right, else left) on a wide window, flipping to stay on
// screen; under or over it when there's no room at the side, and always on a phone; over the
// element's foot when it fills the window. Never off screen.
export function placeTip(
  anchor: Rect,
  tip: { width?: number; height: number },
  view: { width: number; height: number },
): Placed {
  const narrow = view.width < NARROW;
  const width = Math.min(
    narrow ? view.width - EDGE * 2 : (tip.width ?? TIP_WIDTH),
    view.width - EDGE * 2,
  );
  const h = tip.height;
  const pad = SPOT_PAD;
  const clampX = (x: number) => Math.max(EDGE, Math.min(view.width - width - EDGE, x));
  const clampY = (y: number) => Math.max(EDGE, Math.min(view.height - h - EDGE, y));
  if (!narrow) {
    const right = anchor.left + anchor.width + pad + TIP_GAP;
    if (right + width <= view.width - EDGE)
      return { left: right, top: clampY(anchor.top), width, side: "right" };
    const left = anchor.left - pad - TIP_GAP - width;
    if (left >= EDGE) return { left, top: clampY(anchor.top), width, side: "left" };
  }
  const x = clampX(anchor.left + anchor.width / 2 - width / 2);
  const below = anchor.top + anchor.height + pad + TIP_GAP;
  if (below + h <= view.height - EDGE) return { left: x, top: below, width, side: "below" };
  const above = anchor.top - pad - TIP_GAP - h;
  if (above >= EDGE) return { left: x, top: above, width, side: "above" };
  return { left: x, top: clampY(view.height - h - EDGE), width, side: "over" };
}

// The next step to show from `from` going `dir` (1 forward, -1 back) among those whose anchor is
// on the page (`present`), or null when none is left that way.
export function nextShown(
  count: number,
  from: number,
  dir: 1 | -1,
  present: (index: number) => boolean,
): number | null {
  for (let i = from; i >= 0 && i < count; i += dir) if (present(i)) return i;
  return null;
}

// While a tour is open its place is kept in the tab's session storage under this key, so a step on
// another page carries on there (and a reload carries on where it was). Cleared when it ends.
export const TOUR_STORE = "sd-tour";
// "Not now" for a tour (its id after the prefix), kept against this login's key in local storage.
export const TOUR_LATER_PREFIX = "sd-tour-later:";

// Logging out on this device (src/lib/portal/logout-client.ts): every tour's "Not now" and a
// walkthrough under way are forgotten, so the next person here starts afresh. Storage switched
// off: nothing to forget.
export function forgetTourLater(local: Storage, session: Storage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < local.length; i += 1) {
      const k = local.key(i);
      if (k?.startsWith(TOUR_LATER_PREFIX)) keys.push(k);
    }
    for (const k of keys) local.removeItem(k);
    session.removeItem(TOUR_STORE);
  } catch {
    // storage off
  }
}
export interface TourPlace {
  id: string; // the tour's ("office", "casual")
  step: number;
}

export function readTourPlace(raw: string | null): TourPlace | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      v &&
      typeof v === "object" &&
      typeof (v as TourPlace).id === "string" &&
      Number.isInteger((v as TourPlace).step) &&
      (v as TourPlace).step >= 0
    )
      return { id: (v as TourPlace).id, step: (v as TourPlace).step };
  } catch {
    // not ours
  }
  return null;
}
