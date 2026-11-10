"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  MAP_CREDIT,
  MAP_EMPTY,
  MAP_KEY,
  MAP_KEY_LABEL,
  MAP_TITLE,
  mapDaysText,
  pinWords,
  TAB_WORDS,
  TABS_LABEL,
} from "@/lib/portal/home-map-copy";
import { inTab, MAP_TABS, pinCount, type HomeMapPin, type MapTab } from "@/lib/portal/home-map";
import {
  cameraPadding,
  placeLabels,
  placePins,
  spreadPins,
  venueBounds,
  type LabelSpot,
  type Rect,
} from "@/lib/office/venue-map-geo";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";

// Home's street map (Phase 32, 32.2; docs/screens.md "## Phase 32"; Dylan's approved mock-up), as
// the office dashboard's (src/app/office/dashboard/venue-map.tsx): the office's own map, drawn the
// same two ways from the same parts. With the firm's street map (`tiles`, MAP_TILES_URL) MapLibre
// draws the streets from that file in the office's style (src/lib/office/map-style.ts, its web
// worker from /office/map-worker, the letter shapes from our own server) and the pins are its
// markers; without one (dev, the tests) the pins are placed by their own latitude and longitude on
// the plain map (src/lib/office/venue-map-geo.ts: the office's projection, its spreading and its
// label placement). A pin for her next shift's venue (solid ink, a pin in it) and one for each venue
// with shifts open to her (its number how many, red where one is urgent, else the office's amber
// ring), each a link: hers to Booked, a venue's to Open shifts at that venue. The card (her next
// shift, or nothing booked) floats over it: over its left from 1024px, over its foot on a phone;
// the pins keep clear of it. The tabs above it (All, Urgent, This week, Next week, each with its
// count, lime on the chosen one) only filter the pins. The key names the three kinds of pin.
//
// Nothing here is in the copy kept for no signal: the tabs and the map are online only (hidden in
// it by globals.css), and the pins are drawn only once the page runs and isn't that copy, so the
// card shows there alone. Every pin is a named link (its venue, how many, the days), and the same
// shifts are on Open shifts and Booked, so nobody needs the map. Reduced motion: no easing.

const PHONE_MAP = 600; // the map's height on a phone (px): room above the card for the pins
const WIDE_MAP = 520; // from 1024px

interface Measured {
  width: number;
  height: number;
  free: Rect; // the part of the map the card leaves free
  card: Rect | null;
  key: Rect | null;
}

const rectIn = (box: HTMLElement, el: HTMLElement | null): Rect | null => {
  if (!el || el.offsetWidth === 0) return null;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x0: r.left - b.left, y0: r.top - b.top, x1: r.right - b.left, y1: r.bottom - b.top };
};

// (The disc is 36px at the middle of its 44px target, as the office map's: venue-map-geo.ts PIN.)
// A label's width before it's drawn: about 8.5px a letter at 14px, and its padding.
// On a phone her pin's label is "Your shift" and its day alone (the mock-up's): the venue's name is
// in the card under it and in the pin's own name.
const labelWidth = (p: HomeMapPin, days: string, wide: boolean) =>
  Math.round(
    Math.max(
      p.mine ? MAP_KEY.mine.length : p.name.length,
      (p.mine && wide ? `${p.name} · ${days}` : days).length,
    ) *
      8.5 +
      28,
  );

function Pin({
  pin,
  tab,
  label,
  showLabel,
  wide,
}: {
  pin: HomeMapPin;
  tab: MapTab;
  label: LabelSpot;
  showLabel: boolean;
  wide: boolean; // a map 640px wide or more: her pin's label names the venue too
}) {
  const shown = pin.shifts.filter((s) => inTab(s, tab));
  const count = shown.length;
  const urgent = shown.filter((s) => s.urgent).length;
  const days = mapDaysText(shown.map((s) => s.day));
  const ring = pin.mine
    ? "border-ink bg-ink text-on-ink"
    : urgent > 0
      ? "border-urgent-fill bg-urgent-fill text-on-urgent"
      : "border-mark-open bg-panel text-ink";
  const side = label.side;
  const place =
    side === "left"
      ? "top-1/2 right-full mr-1 -translate-y-1/2 text-left"
      : side === "below"
        ? "top-full mt-1 -translate-x-1/2 text-center"
        : side === "above"
          ? "bottom-full mb-1 -translate-x-1/2 text-center"
          : "top-1/2 left-full ml-1 -translate-y-1/2 text-left";
  const around = side === "below" || side === "above";
  return (
    <Link
      href={pin.href}
      aria-label={pinWords({
        mine: pin.mine,
        name: pin.name,
        count,
        urgent,
        days: shown.map((s) => s.day),
      })}
      data-map-pin={pin.mine ? "mine" : urgent > 0 ? "urgent" : "open"}
      data-site={pin.siteId}
      className="pointer-events-auto press relative flex size-11 items-center justify-center rounded-full focus-visible:outline-2"
    >
      <span
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border-[3px] text-sm font-bold tabular-nums ${ring} ${pin.mine ? "outline-4 outline-offset-1 outline-ink/20" : ""}`}
      >
        {pin.mine ? <Icon name="pin" size={18} /> : count}
      </span>
      {showLabel && side !== "none" && (
        <span
          aria-hidden="true"
          data-pin-label=""
          className={`glass-float absolute rounded-row px-2.5 py-1.5 text-sm leading-tight whitespace-nowrap text-ink ${place}`}
          style={around ? { left: `calc(50% + ${Math.round(label.shift)}px)` } : undefined}
        >
          {pin.mine ? MAP_KEY.mine : pin.name}
          <small className="block text-xs text-ink-muted">
            {pin.mine && wide ? `${pin.name} · ${days}` : days}
          </small>
        </span>
      )}
    </Link>
  );
}

export function HomeMapView({
  pins,
  counts,
  tiles,
  card,
}: {
  pins: HomeMapPin[];
  counts: Record<MapTab, number>;
  tiles: string | null; // the firm's street map (MAP_TILES_URL), or none: the plain map
  card: ReactNode; // her next shift, or nothing booked
}) {
  const hydrated = useHydrated();
  const [tab, setTab] = useState<MapTab>("all");
  const [kept, setKept] = useState(true); // the copy kept for no signal (until checked)
  const box = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const keyBox = useRef<HTMLUListElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [markers, setMarkers] = useState<Map<string, HTMLElement> | null>(null);
  const [projected, setProjected] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [streets, setStreets] = useState<"none" | "loading" | "shown" | "failed">(
    tiles ? "loading" : "none",
  );
  const onStreets = markers !== null && streets !== "failed";
  const visible = pins.filter((p) => pinCount(p, tab) > 0);

  // Is this the copy kept for no signal? Then no pins and no street map, ever.
  useEffect(() => {
    // Read from the page as it arrived: not a render to keep in step.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKept(document.querySelector("[data-offline-notice]:not([hidden])") !== null);
  }, []);

  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const card = rectIn(el, cardBox.current);
    const key = rectIn(el, keyBox.current);
    // The card over the map's left (a laptop) or over its foot (a phone).
    const left = card !== null && card.x1 - card.x0 < width * 0.6;
    const free: Rect = !card
      ? { x0: 0, y0: 0, x1: width, y1: height }
      : left
        ? { x0: card.x1 + 12, y0: 0, x1: width, y1: height }
        : { x0: 0, y0: 0, x1: width, y1: Math.max(96, card.y0 - 8) };
    setMeasured({ width, height, free, card, key });
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || kept) return;
    measure();
    const watch = new ResizeObserver(() => measure());
    for (const part of [el, cardBox.current]) if (part) watch.observe(part);
    return () => watch.disconnect();
  }, [measure, kept]);

  // The street map, when the firm has one (as the office's: loaded only then).
  useEffect(() => {
    if (!tiles || kept || !box.current) return;
    let gone = false;
    let cleanup = () => {};
    void (async () => {
      try {
        const [maplibregl, { Protocol }, mapStyle] = await Promise.all([
          import("maplibre-gl"),
          import("pmtiles"),
          import("@/lib/office/map-style"),
        ]);
        if (gone || !box.current) return;
        const el = box.current;
        maplibregl.setWorkerUrl(`/office/map-worker?v=${maplibregl.getVersion()}`);
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        const dark = document.documentElement.dataset.theme
          ? document.documentElement.dataset.theme !== "light"
          : window.matchMedia("(prefers-color-scheme: dark)").matches;
        const map = new maplibregl.Map({
          container: el,
          style: mapStyle.mapStyle(tiles, dark ? "dark" : "light", MAP_CREDIT),
          maxZoom: mapStyle.MAP_MAX_ZOOM,
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        const card = rectIn(el, cardBox.current);
        const left = card !== null && card.x1 - card.x0 < el.clientWidth * 0.6;
        const pad = cameraPadding(
          { width: el.clientWidth, height: el.clientHeight },
          {
            card: left ? card : null,
            list: null,
          },
        );
        if (!left && card) pad.bottom = Math.max(pad.bottom, el.clientHeight - card.y0 + 24);
        const bounds = venueBounds(pins);
        if (bounds)
          map.fitBounds(bounds, {
            padding: pad,
            maxZoom: mapStyle.MAP_FIT_MAX_ZOOM,
            duration: 0,
          });
        const els = new Map<string, HTMLElement>();
        const placedMarkers = pins.map((p) => {
          const pin = document.createElement("div");
          els.set(p.key, pin);
          return new maplibregl.Marker({ element: pin, anchor: "center" })
            .setLngLat([p.lng, p.lat])
            .addTo(map);
        });
        const project = () => {
          if (gone) return;
          const at = pins.map((p) => map.project([p.lng, p.lat]));
          const spread = spreadPins(
            at.map((p) => ({ x: p.x, y: p.y })),
            { width: 0, height: 0, inset: 0 },
            false,
          );
          placedMarkers.forEach((m, i) =>
            m.setOffset([spread[i]!.x - at[i]!.x, spread[i]!.y - at[i]!.y]),
          );
          setProjected(new Map(pins.map((p, i) => [p.key, spread[i]!])));
        };
        map.on("moveend", project);
        project();
        map.once("load", () => !gone && setStreets("shown"));
        map.on("error", () => !gone && setStreets("failed"));
        setMarkers(els);
        cleanup = () => {
          map.remove();
          maplibregl.removeProtocol("pmtiles");
        };
      } catch {
        if (!gone) setStreets("failed");
      }
    })();
    return () => {
      gone = true;
      cleanup();
    };
    // The pins are the page's; a new set comes with a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, kept]);

  // Where each shown pin goes, and its label's side.
  const layout = (() => {
    if (!measured) return null;
    const f = measured.free;
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    const spots = onStreets
      ? visible.map((p) => projected?.get(p.key) ?? { x: -100, y: -100 })
      : spreadPins(
          placePins(visible, { width: w, height: h }, 0.14).map((s) => ({
            x: f.x0 + s.x * w,
            y: f.y0 + s.y * h,
          })),
          { width: f.x1, height: f.y1, inset: f.x0 },
        );
    const wide = measured.width >= 640;
    const widths = visible.map((p) =>
      p.mine || wide ? labelWidth(p, mapDaysText(p.shifts.map((s) => s.day)), wide) : null,
    );
    const mine = visible.findIndex((p) => p.mine);
    const order = [
      ...(mine >= 0 ? [mine] : []),
      ...visible.map((_, i) => i).filter((i) => i !== mine),
    ];
    const avoid = [measured.key, measured.card].filter((r): r is Rect => r !== null);
    const labels = placeLabels(
      spots,
      widths,
      order,
      { width: measured.width, height: measured.height, inset: 0 },
      avoid,
      mine >= 0 ? mine : null,
    );
    return { spots, labels };
  })();

  const ready = hydrated && !kept && measured !== null;
  const wideLabels = (measured?.width ?? 0) >= 640;
  return (
    <div data-home-map-zone="" className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={TABS_LABEL}
        data-online-only=""
        data-map-tabs=""
        className="scrollbar-none -mx-1 flex overflow-x-auto px-1"
      >
        <div className="glass-track glass-rim inline-flex shrink-0 gap-1 rounded-full p-1">
          {/* Urgent only while there are urgent shifts she can take: Home says nothing about
              urgent shifts when there are none. */}
          {MAP_TABS.filter((t) => t !== "urgent" || counts.urgent > 0).map((t) => {
            const on = t === tab;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                data-map-tab={t}
                disabled={!hydrated}
                onClick={() => setTab(t)}
                className={`press-glass inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-base whitespace-nowrap disabled:cursor-default ${
                  on ? "lens font-semibold text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {TAB_WORDS[t]}{" "}
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-sm font-semibold tabular-nums ${
                    on ? "bg-tint text-on-tint" : "glass-button text-ink"
                  }`}
                >
                  {counts[t]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid">
        <div
          ref={box}
          role="region"
          aria-label={MAP_TITLE}
          data-online-only=""
          data-home-map={onStreets ? "streets" : "plain"}
          style={{
            ["--map-h" as string]: `${PHONE_MAP}px`,
            ["--map-h-wide" as string]: `${WIDE_MAP}px`,
          }}
          className="glass relative col-start-1 row-start-1 min-h-[var(--map-h)] overflow-hidden rounded-inner lg:min-h-[var(--map-h-wide)]"
        >
          {ready &&
            !onStreets &&
            layout &&
            visible.map((p, i) => (
              <div
                key={p.key}
                className="pointer-events-none absolute z-1 -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${Math.round(layout.spots[i]!.x)}px`,
                  top: `${Math.round(layout.spots[i]!.y)}px`,
                }}
              >
                <Pin
                  pin={p}
                  tab={tab}
                  label={layout.labels[i]!}
                  showLabel={p.mine || wideLabels}
                  wide={wideLabels}
                />
              </div>
            ))}
          {ready &&
            onStreets &&
            layout &&
            pins.map((p) => {
              const el = markers?.get(p.key);
              const i = visible.indexOf(p);
              return el
                ? createPortal(
                    i >= 0 ? (
                      <Pin
                        pin={p}
                        tab={tab}
                        label={layout.labels[i]!}
                        showLabel={p.mine || wideLabels}
                        wide={wideLabels}
                      />
                    ) : null,
                    el,
                    p.key,
                  )
                : null;
            })}
          {pins.length === 0 && (
            <p className="absolute inset-x-0 top-0 p-6 text-center text-base text-ink-muted">
              {MAP_EMPTY}
            </p>
          )}
          {onStreets && (
            <p className="absolute right-2 bottom-2 z-10 rounded-row bg-panel px-2 py-1 text-xs text-ink-muted">
              {MAP_CREDIT}
            </p>
          )}
          <ul
            ref={keyBox}
            role="list"
            aria-label={MAP_KEY_LABEL}
            className="pointer-events-none absolute top-3 right-3 z-10 hidden flex-wrap justify-end gap-2 sm:flex"
          >
            {(
              [
                ["mine", "bg-ink"],
                ["open", "border-[3px] border-mark-open"],
                ["urgent", "bg-urgent-fill"],
              ] as const
            )
              // Each kind of pin the map has, and only those.
              .filter(([k]) =>
                pins.some((p) =>
                  k === "mine"
                    ? p.mine
                    : k === "urgent"
                      ? p.shifts.some((s) => s.urgent)
                      : !p.mine && p.shifts.some((s) => !s.urgent),
                ),
              )
              .map(([k, dot]) => (
                <li
                  key={k}
                  className="glass-float flex h-9 items-center gap-2 rounded-full px-3 text-sm text-ink"
                >
                  <span aria-hidden="true" className={`size-3 rounded-full ${dot}`} />
                  {MAP_KEY[k]}
                </li>
              ))}
          </ul>
        </div>
        {/* The card: over the map's foot on a phone, over its left from 1024px (12px in). Its own
            size; where it's taller than the map, the map grows with it. */}
        <div
          ref={cardBox}
          data-map-card-slot=""
          className="relative z-10 col-start-1 row-start-1 m-2.5 self-end lg:m-3 lg:w-101 lg:self-start"
        >
          {card}
        </div>
      </div>
    </div>
  );
}
