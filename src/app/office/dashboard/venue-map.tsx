"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MapVenue } from "@/lib/office/dashboard-map";
import {
  MAP_ATTRIBUTION,
  MAP_KEY,
  MAP_TABLE,
  MAP_TABLE_HEADS,
  mapFoot,
  pinDays,
  pinLabel,
  unplacedLine,
} from "@/lib/office/dashboard-map-copy";
import { boardHref, type BoardView } from "@/lib/office/board-copy";
import {
  labelOrder,
  labelSides,
  layoutPins,
  placePins,
  spreadPins,
  venueBounds,
  type LabelSide,
  type PinBox,
  type Rect,
} from "@/lib/office/venue-map-geo";
import { Icon } from "../../ui/icons";

// The venue map (Phase 26.2; the spec's dash-1 and dash-9, the pre-build audit's aud-7 and aud-8):
// a pin for each venue with places to fill under the track's filter, its number its places to fill,
// red where a session there is urgent, a dashed ring where every one is hidden from casuals, the
// venue the session card shows ringed in hi-vis. Each pin is a link to the dashboard with that
// venue's soonest session in the card (so it works before the page is ready). Two ways to draw it:
//
// - With a street map (`tiles`: the firm's UK map file, MAP_TILES_URL, on our own server): MapLibre
//   draws the streets from the file (Protomaps' layers, no labels: the pins carry the names), the
//   pins are its markers, it fits the venues, drag moves it and the wheel or a pinch zooms; on a
//   phone it takes two fingers to move (one scrolls the page) and on a laptop Ctrl + scroll zooms
//   (MapLibre's cooperative gestures: aud-7). "© OpenStreetMap contributors" shows on it.
// - Without one (dev, the tests, before the file is up): the pins placed by their own latitude and
//   longitude (venue-map-geo.ts, Web Mercator), fitted into the box, on the office's own faint
//   street pattern, and the foot says so. Nothing is placed by guesswork: a venue with no position
//   is listed under the map.
//
// Every pin is also a row in To offer (aud-7), so nobody needs the map to act. On a phone the map
// is 300px tall and the pins have no labels (their names are in their links' words).
//
// Once the page has measured the map (and whenever it changes size, or the street map moves), the
// pins are laid out in its real pixels (venue-map-geo.ts): clear of the session card from 1024px,
// pushed apart where one would cover another (without a street map: with one they stay exactly
// where the venue is), and each label on whichever side it fits, or left off where it fits on
// neither (its name is still the pin's link words and in the table). Before that (the page as it
// arrives, or without JavaScript) they're placed by share of the box, right of the card.

type Venue = MapVenue & { lat: number; lng: number };

function Pin({
  v,
  chosen,
  view,
  label,
}: {
  v: Venue;
  chosen: boolean;
  view: BoardView;
  label: LabelSide;
}) {
  const ring = v.urgent
    ? "border-urgent-fill bg-urgent-fill text-on-urgent"
    : v.hidden
      ? "border-dashed border-mark-calm bg-panel text-ink-muted"
      : v.places > 0
        ? "border-mark-open bg-panel text-ink"
        : "border-mark-done bg-panel text-ink";
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums ${ring} ${chosen ? "outline-4 outline-offset-2 outline-accent/40" : ""}`}
      >
        {v.places}
      </span>
      <span
        aria-hidden="true"
        data-pin-label={v.siteId}
        className={`absolute top-1/2 -translate-y-1/2 rounded-row border border-line bg-panel px-2 py-1 text-left text-xs leading-tight whitespace-nowrap text-ink ${label === "left" ? "right-full mr-1" : "left-full ml-1"} ${label === "none" ? "hidden" : "hidden @min-[40rem]:block"}`}
      >
        {v.name}
        <small className="block text-xs text-ink-faint">{pinDays(v)}</small>
      </span>
    </>
  );
  // The disc at the middle of a 44px target; the label beside it is part of the link too.
  const className =
    "pointer-events-auto press relative flex size-11 items-center justify-center rounded-full focus-visible:outline-2";
  const words = pinLabel(v);
  return v.firstShiftId ? (
    <Link
      href={boardHref(view, v.firstShiftId)}
      scroll={false}
      aria-label={words}
      aria-current={chosen ? "true" : undefined}
      data-venue={v.siteId}
      className={className}
    >
      {body}
    </Link>
  ) : (
    <span role="img" aria-label={words} data-venue={v.siteId} className={className}>
      {body}
    </span>
  );
}

// What the page measured: the map's box, the part the card covers, the key, each label's width.
interface Measured {
  box: PinBox;
  avoid: Rect[];
  widths: (number | null)[];
}

export function VenueMap({
  venues,
  chosenSite,
  view,
  tiles,
  card,
}: {
  venues: MapVenue[];
  chosenSite: string | null;
  view: BoardView;
  tiles: string | null; // the street map's file, or none
  card: ReactNode; // the session card, over the map from 1024px and under it below
}) {
  const placed = venues.filter((v): v is Venue => v.lat !== null && v.lng !== null);
  const unplaced = venues.filter((v) => v.lat === null || v.lng === null);
  const box = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const keyBox = useRef<HTMLUListElement>(null);
  const [markers, setMarkers] = useState<Map<string, HTMLElement> | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  // With a street map: where each venue is on screen now (it moves), for its label's side.
  const [projected, setProjected] = useState<{ x: number; y: number }[] | null>(null);
  const widths = useRef(new Map<string, number>());
  const order = labelOrder(placed, chosenSite);

  // The box, the card's part of it and the labels, measured now and whenever the box changes size.
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const card = cardBox.current;
    const inset =
      card && getComputedStyle(card).position === "absolute"
        ? card.offsetLeft + card.offsetWidth + 12
        : 0;
    for (const label of el.querySelectorAll<HTMLElement>("[data-pin-label]")) {
      // A label left off (display: none) keeps the width it had; on a phone every one is 0.
      if (label.offsetWidth > 0)
        widths.current.set(label.dataset.pinLabel ?? "", label.offsetWidth);
    }
    const phone = getComputedStyle(keyBox.current ?? el).display === "none";
    const key = keyBox.current;
    setMeasured({
      box: { width: el.clientWidth, height: el.clientHeight, inset },
      avoid:
        key && !phone
          ? [
              {
                x0: key.offsetLeft,
                y0: key.offsetTop,
                x1: key.offsetLeft + key.offsetWidth,
                y1: key.offsetTop + key.offsetHeight,
              },
            ]
          : [],
      widths: placed.map((v) => (phone ? null : (widths.current.get(v.siteId) ?? null))),
    });
    // The venues are the page's; a new set comes with a new page (the key on the board).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const watch = new ResizeObserver(() => measure());
    watch.observe(el);
    return () => watch.disconnect();
  }, [measure]);
  const [streets, setStreets] = useState<"none" | "loading" | "shown" | "failed">(
    tiles ? "loading" : "none",
  );

  // The street map, when the firm has one: MapLibre and the file's reader, loaded only then.
  useEffect(() => {
    if (!tiles || !box.current) return;
    let gone = false;
    let cleanup = () => {};
    void (async () => {
      try {
        const [maplibregl, { Protocol }, basemaps] = await Promise.all([
          import("maplibre-gl"),
          import("pmtiles"),
          import("@protomaps/basemaps"),
        ]);
        if (gone || !box.current) return;
        // Its web worker from our own route (../map-worker/route.ts): where the bundler leaves it,
        // MapLibre can't find it.
        maplibregl.setWorkerUrl(`/office/map-worker?v=${maplibregl.getVersion()}`);
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        const dark = document.documentElement.dataset.theme !== "light";
        const map = new maplibregl.Map({
          container: box.current,
          style: {
            version: 8,
            sources: {
              protomaps: {
                type: "vector",
                url: `pmtiles://${tiles}`,
                attribution: MAP_ATTRIBUTION,
              },
            },
            // The streets, water and land, no words: the pins carry the names.
            layers: basemaps
              .layers("protomaps", basemaps.namedFlavor(dark ? "dark" : "light"), { lang: "en" })
              .filter((l) => l.type !== "symbol"),
          },
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        const bounds = venueBounds(placed);
        // Fitted to the part of the map the card leaves.
        const card = cardBox.current;
        const left =
          card && getComputedStyle(card).position === "absolute"
            ? card.offsetLeft + card.offsetWidth + 12
            : 0;
        if (bounds)
          map.fitBounds(bounds, {
            padding: { top: 64, right: 64, bottom: 64, left: left + 64 },
            maxZoom: 13,
            duration: 0,
          });
        const els = new Map<string, HTMLElement>();
        const pins = placed.map((v) => {
          const el = document.createElement("div");
          els.set(v.siteId, el);
          // The pin's middle on the venue.
          return new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([v.lng, v.lat])
            .addTo(map);
        });
        // After every move or zoom: where each venue is on screen; pins that would cover each
        // other nudged apart (as without a street map; never pulled in from off the edge); and
        // each label's side from there.
        const project = () => {
          if (gone) return;
          const at = placed.map((v) => map.project([v.lng, v.lat]));
          const spread = spreadPins(
            at.map((p) => ({ x: p.x, y: p.y })),
            { width: 0, height: 0, inset: 0 },
            false,
          );
          pins.forEach((m, i) => m.setOffset([spread[i]!.x - at[i]!.x, spread[i]!.y - at[i]!.y]));
          setProjected(spread);
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
    // The venues placed are the page's; a new set comes with a new page (the key on the board).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles]);

  const onStreets = markers !== null && streets !== "failed";
  // Without the streets: until the page has measured the map, each pin by share of the part the
  // card leaves (its shape near enough a laptop's); then in its real pixels.
  const shares = placePins(placed, { width: 1000 - 432, height: 528 });
  const laid = measured
    ? layoutPins(placed, measured.box, measured.widths, order, measured.avoid)
    : null;
  // With them: each label's side where its venue is now.
  const streetSides =
    measured && projected
      ? labelSides(projected, measured.widths, order, measured.box, measured.avoid)
      : null;
  const total = venues.reduce((n, v) => n + v.places, 0);

  return (
    <section aria-labelledby="venue-map-title" className="flex min-w-0 flex-col gap-2">
      <h2 id="venue-map-title" className="sr-only">
        Venues with places to fill
      </h2>
      <div className="relative">
        <div
          ref={box}
          data-venue-map={onStreets ? "streets" : "plain"}
          className="glass relative h-75 overflow-hidden rounded-inner [--inset:0px] @min-[64rem]:h-132 @min-[64rem]:[--inset:27rem]"
        >
          {!onStreets &&
            placed.map((v, i) => {
              const at = laid?.[i];
              return (
                <div
                  key={v.siteId}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  style={
                    at
                      ? { left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` }
                      : {
                          // Rounded: the browser keeps a few places of a percentage, and the page
                          // must arrive as it's drawn.
                          left: `calc(var(--inset) + (100% - var(--inset)) * ${shares[i]!.x.toFixed(4)})`,
                          top: `${(shares[i]!.y * 100).toFixed(2)}%`,
                        }
                  }
                >
                  <Pin
                    v={v}
                    chosen={v.siteId === chosenSite}
                    view={view}
                    label={at ? at.label : shares[i]!.x > 0.7 ? "left" : "right"}
                  />
                </div>
              );
            })}
          {onStreets &&
            placed.map((v, i) => {
              const el = markers!.get(v.siteId);
              return el
                ? createPortal(
                    <Pin
                      v={v}
                      chosen={v.siteId === chosenSite}
                      view={view}
                      label={streetSides?.[i] ?? "none"}
                    />,
                    el,
                    v.siteId,
                  )
                : null;
            })}
          {placed.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-ink-muted">
              {total === 0
                ? "No places to fill here."
                : "None of these venues has a postcode yet, so none is on the map."}
            </p>
          )}
          {onStreets && (
            // Over MapLibre's canvas (it adds the canvas after this, so would paint over it).
            <p className="absolute right-2 bottom-2 z-10 rounded-row bg-panel px-2 py-1 text-xs text-ink-muted">
              © OpenStreetMap contributors
            </p>
          )}
          {/* The key, top right (from 640px: the pins' words say it on a phone). */}
          <ul
            ref={keyBox}
            role="list"
            aria-label="Key"
            className="pointer-events-none absolute top-3 right-3 z-10 hidden flex-wrap justify-end gap-2 @min-[40rem]:flex"
          >
            {(
              [
                ["urgent", "border-urgent-fill bg-urgent-fill"],
                ["open", "border-mark-open bg-panel"],
                ["hidden", "border-dashed border-mark-calm bg-panel"],
                // The full venues' green ring, while Show full venues puts them on the map.
                ...(view.full ? ([["full", "border-mark-done bg-panel"]] as const) : []),
              ] as const
            ).map(([k, ring]) => (
              <li
                key={k}
                className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink-muted"
              >
                <span aria-hidden="true" className={`size-3 rounded-full border-2 ${ring}`} />
                {MAP_KEY[k]}
              </li>
            ))}
          </ul>
        </div>
        {/* The session card: over the map from 1024px, under it below. */}
        <div
          ref={cardBox}
          className="mt-3 @min-[64rem]:absolute @min-[64rem]:top-3 @min-[64rem]:left-3 @min-[64rem]:mt-0 @min-[64rem]:w-101"
        >
          {card}
        </div>
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-1 text-xs text-ink-faint">
        <span>{mapFoot(onStreets)}</span>
        <span className="tabular-nums">
          {venues.length === 1 ? "1 venue" : `${venues.length} venues`} ·{" "}
          {total === 1 ? "1 place to fill" : `${total} places to fill`}
        </span>
      </p>
      {unplaced.length > 0 && (
        <p className="px-1 text-xs text-ink-muted">{unplacedLine(unplaced)}</p>
      )}
      {/* The same figures as a table, every venue (placed or not), each a link like its pin. */}
      {venues.length > 0 && (
        <details className="group px-1">
          <summary className="press inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-row text-sm text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            {MAP_TABLE}
            <Icon
              name="chevron"
              size={16}
              className="rotate-90 transition-transform duration-150 ease-sd group-open:-rotate-90 motion-reduce:transition-none"
            />
          </summary>
          <table className="mt-1 w-full text-left text-sm tabular-nums">
            <caption className="sr-only">Venues with places to fill</caption>
            <thead className="text-xs text-ink-faint">
              <tr className="border-b border-line">
                {MAP_TABLE_HEADS.map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`py-2 font-medium ${i === 1 ? "px-3 text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {venues.map((v) => (
                <tr key={v.siteId}>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {v.firstShiftId ? (
                      <Link
                        href={boardHref(view, v.firstShiftId)}
                        scroll={false}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {v.name}
                      </Link>
                    ) : (
                      <span className="text-ink">{v.name}</span>
                    )}
                    {v.town && (
                      <span className="block text-xs font-normal text-ink-faint">{v.town}</span>
                    )}
                  </th>
                  <td className={`px-3 py-2 text-right ${v.urgent ? "text-urgent-ink" : "text-ink"}`}>
                    {v.places}
                    {v.urgent && " · urgent"}
                  </td>
                  <td className="py-2 text-ink-muted">{pinDays(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
