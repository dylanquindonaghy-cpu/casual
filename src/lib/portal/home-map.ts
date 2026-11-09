import { addDays, localDateOf, mondayOf } from "../time/zoned";
import type { OpenShift } from "./open-shifts";

// Home's street map (Phase 32, 32.2; docs/screens.md "## Phase 32"): a pin for the venue of her
// next shift and one for each venue with shifts open to her, as the office's dashboard has one for
// each venue with places to fill. The open pins come from the very list "Open to you" counts (the
// page's openShiftsFor(): the rules decide, never this file), and only their venues' points are
// read here: by id, inside her firm (withFirm), so another firm's venue can never be on her map.
// Her next shift's venue is read by its session, inside her firm too. A venue with no point (no
// postcode looked up yet) has no pin. The tabs (All, Urgent, This week, Next week) only filter
// these pins: each pin carries its shifts' tags, and the counts are worked out here. Pure and
// browser-safe (the map is a client component); the loader is ./home-map-places.ts.

export type MapWeek = "this" | "next" | "later";
export type MapTab = "all" | "urgent" | "this" | "next";
export const MAP_TABS: readonly MapTab[] = ["all", "urgent", "this", "next"];

// One shift on a pin: urgent or not, and which week (the firm's Monday to Sunday) it starts in.
export interface MapShift {
  urgent: boolean;
  week: MapWeek;
  day: string; // yyyy-mm-dd, the firm's calendar
}

export interface HomeMapPin {
  key: string;
  siteId: string;
  name: string;
  lat: number;
  lng: number;
  mine: boolean; // her next shift's venue
  shifts: MapShift[];
  href: string; // her shift: Booked; a venue's open shifts: Open shifts at that venue
}

export interface HomeMap {
  pins: HomeMapPin[];
  counts: Record<MapTab, number>;
}

export interface MapPlace {
  siteId: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

// Which week a day is in, counted from today's.
export function weekOf(day: string, today: string): MapWeek {
  const monday = mondayOf(today);
  if (day < addDays(monday, 7)) return "this";
  if (day < addDays(monday, 14)) return "next";
  return "later";
}

// Whether a shift shows under a tab.
export const inTab = (s: MapShift, tab: MapTab): boolean =>
  tab === "all" ? true : tab === "urgent" ? s.urgent : s.week === tab;

// How many of a pin's shifts show under a tab (0: the pin is hidden there).
export const pinCount = (pin: HomeMapPin, tab: MapTab): number =>
  pin.shifts.filter((s) => inTab(s, tab)).length;

const placed = (p: MapPlace | undefined): p is MapPlace & { lat: number; lng: number } =>
  !!p && p.lat !== null && p.lng !== null;

export function homeMap(o: {
  next: { shiftId: string; startsAt: Date } | null;
  nextPlace: MapPlace | null;
  open: readonly OpenShift[];
  places: ReadonlyMap<string, MapPlace>;
  now: Date;
  timeZone: string;
  // The page's own urgent count (my-home.ts urgentCount: the Urgent pill's and the card's), so the
  // Urgent tab never says another number; left out (the older fixtures), the list's own.
  urgent?: number;
}): HomeMap {
  const today = localDateOf(o.now, o.timeZone);
  const tag = (startsAt: Date, urgent: boolean): MapShift => {
    const day = localDateOf(startsAt, o.timeZone);
    return { urgent, week: weekOf(day, today), day };
  };
  const pins: HomeMapPin[] = [];
  const all: MapShift[] = [];
  if (o.next) {
    const mine = tag(o.next.startsAt, false);
    all.push(mine);
    if (placed(o.nextPlace ?? undefined))
      pins.push({
        key: `mine-${o.nextPlace!.siteId}`,
        siteId: o.nextPlace!.siteId,
        name: o.nextPlace!.name,
        lat: o.nextPlace!.lat!,
        lng: o.nextPlace!.lng!,
        mine: true,
        shifts: [mine],
        href: "/shifts",
      });
  }
  const bySite = new Map<string, HomeMapPin>();
  for (const s of o.open) {
    const t = tag(s.startsAt, s.isUrgent);
    all.push(t);
    const place = s.site ? o.places.get(s.site.id) : undefined;
    if (!placed(place)) continue;
    let pin = bySite.get(place.siteId);
    if (!pin) {
      pin = {
        key: `open-${place.siteId}`,
        siteId: place.siteId,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        mine: false,
        shifts: [],
        href: `/shifts/open?site=${encodeURIComponent(place.siteId)}`,
      };
      bySite.set(place.siteId, pin);
    }
    pin.shifts.push(t);
  }
  // Urgent venues first, then the most shifts, then by name (the office's map's order).
  const open = [...bySite.values()].sort(
    (a, b) =>
      Number(b.shifts.some((s) => s.urgent)) - Number(a.shifts.some((s) => s.urgent)) ||
      b.shifts.length - a.shifts.length ||
      a.name.localeCompare(b.name),
  );
  pins.push(...open);
  const counts = Object.fromEntries(
    MAP_TABS.map((t) => [t, all.filter((s) => inTab(s, t)).length]),
  ) as Record<MapTab, number>;
  if (o.urgent !== undefined) counts.urgent = o.urgent;
  return { pins, counts };
}

// A shift she can take this minute: not held by fair rotation (opensAt still to come) and not one
// she can only ask for (`ask`: the office chooses). The rules' own fields; nothing decided here.
export const takeableNow = (s: OpenShift, now: Date): boolean =>
  (s.opensAt === null || s.opensAt.getTime() <= now.getTime()) && (s.ask ?? null) === null;

// With nothing booked, the card's suggestion: of the shifts she can take now (takeableNow), the
// nearest where her travel area gives a distance (`by: "distance"`), else the soonest (`by:
// "time"`); null with none she can take now.
export function nearestOpen(
  open: readonly OpenShift[],
  now: Date,
): { shift: OpenShift; by: "distance" | "time" } | null {
  const takeable = open.filter((s) => takeableNow(s, now));
  const metres = (s: OpenShift) =>
    s.travel && s.travel.kind !== "unknown" ? s.travel.straightMetres : null;
  const measured = takeable.filter((s) => metres(s) !== null);
  if (measured.length > 0) {
    const shift = measured.reduce((a, s) => (metres(s)! < metres(a)! ? s : a));
    return { shift, by: "distance" };
  }
  const shift = takeable.reduce<OpenShift | null>(
    (a, s) => (a === null || s.startsAt.getTime() < a.startsAt.getTime() ? s : a),
    null,
  );
  return shift ? { shift, by: "time" } : null;
}
