"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { MapVenue } from "@/lib/office/dashboard-map";
import {
  FIT_ALL,
  listButton,
  MAP_ATTRIBUTION,
  MAP_BUTTONS,
  MAP_KEY,
  MAP_TABLE,
  MAP_TABLE_HEADS,
  mapCountLine,
  mapFoot,
  pinDays,
  pinLabel,
  unplacedLine,
  ZOOM_IN,
  ZOOM_OUT,
} from "@/lib/office/dashboard-map-copy";
import { boardHref, type BoardView } from "@/lib/office/board-copy";
import {
  cameraPadding,
  isPhoneBox,
  labelOrder,
  layoutPins,
  placeLabels,
  placePins,
  spreadPins,
  venueBounds,
  type LabelSpot,
  type PinBox,
  type Rect,
} from "@/lib/office/venue-map-geo";
import { Icon } from "../../ui/icons";

// The venue map (Phase 26.2; the spec's dash-1 and dash-9, the pre-build audit's aud-7 and aud-8;
// Phase 27.4, "the map you can use": Dylan, 2026-11-04, on docs/mockups/round-8/27.4-map/): a pin
// for each venue with places to fill under the track's filter, its number its places to fill, red
// where a session there is urgent, a dashed ring where every one is hidden from casuals, the venue
// the session card shows ringed in hi-vis. Each pin is a link to the dashboard with that venue's
// soonest session in the card (so it works before the page is ready); once it is, a pin picks that
// session in place (the board: ./board.tsx) and the street map moves to it. Two ways to draw it:
//
// - With a street map (`tiles`: the firm's UK map file, MAP_TILES_URL, on our own server): MapLibre
//   draws the streets from the file (Protomaps' layers with their names: towns, areas, streets,
//   water; their letter shapes from our own server: src/lib/office/map-style.ts, Phase 27.8), the
//   pins are its markers (over the names), it fits the venues, drag moves it and the wheel or a
//   pinch zooms; on a phone it takes two fingers to move (one scrolls the page) and on a laptop
//   Ctrl + scroll zooms (MapLibre's cooperative gestures: aud-7). A picked venue's pin moves the
//   map to it (eased; at once with reduced motion), into the part the card and the open list leave
//   free (that part is MapLibre's own padding: venue-map-geo.ts cameraPadding). "© OpenStreetMap
//   contributors" shows on it.
// - Without one (dev, the tests, before the file is up): the pins placed by their own latitude and
//   longitude (venue-map-geo.ts, Web Mercator), fitted into the box, on its plain glass (no picture
//   behind it since Phase 27.7), and the foot says so. Nothing is placed by guesswork: a venue with
//   no position is listed under the map. Nothing moves when a pin is picked: only the card changes.
//
// The map's buttons, top right, one column, each 44px: the list of sessions to offer (To offer, when
// the person has it on: the board's own column, which then lives here, shut until asked for), and
// with the streets "Zoom in" and "Zoom out" joined, then "Back to every venue". The key sits left of
// them (top left on a phone). On a laptop (from 1024px of page) the session card floats over the
// map's left and the open list over its right, under the key; below that they sit under the map,
// the list under the card. The map is 600px tall where the card floats, 380px below.
//
// Every pin is also a row in To offer (aud-7), so nobody needs the map to act: its list is the
// keyboard's path to every session. On a phone only the chosen pin carries its name (beside it if it
// fits, else under or over it); from 640px every pin's name shows where it fits, and the chosen one's
// always does.
//
// Once the page has measured the map (and whenever it, the card or the list changes size, or the
// street map moves), the pins are laid out in its real pixels (venue-map-geo.ts): clear of the card
// and the open list from 1024px, pushed apart where one would cover another (without a street map:
// with one they stay exactly where the venue is), and each label on whichever side it fits, or left
// off where it fits nowhere (its name is still the pin's link words and in the table). Before that
// (the page as it arrives, or without JavaScript) they're placed by share of the box, right of the
// card.

type Venue = MapVenue & { lat: number; lng: number };

// A plain click (not one opening a new tab or window): the page handles it once it's ready.
const plain = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

function Pin({
  v,
  chosen,
  view,
  label,
  onPick,
}: {
  v: Venue;
  chosen: boolean;
  view: BoardView;
  label: LabelSpot;
  onPick: (v: MapVenue) => void;
}) {
  const ring = v.urgent
    ? "border-urgent-fill bg-urgent-fill text-on-urgent"
    : v.hidden
      ? "border-dashed border-mark-calm bg-panel text-ink-muted"
      : v.places > 0
        ? "border-mark-open bg-panel text-ink"
        : "border-mark-done bg-panel text-ink";
  const side = label.side;
  const around = side === "below" || side === "above";
  const place =
    side === "left"
      ? "top-1/2 right-full mr-1 -translate-y-1/2 text-left"
      : side === "below"
        ? "top-full mt-1 -translate-x-1/2 text-center"
        : side === "above"
          ? "bottom-full mb-1 -translate-x-1/2 text-center"
          : "top-1/2 left-full ml-1 -translate-y-1/2 text-left";
  // Shown: the chosen pin's always (it never takes another pin's taps); the others' from 640px where
  // they fit. Hidden ones keep their width, so the page can measure where each would go.
  const shown =
    side === "none"
      ? "invisible"
      : chosen
        ? "pointer-events-none"
        : "invisible @min-[40rem]:visible";
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
        className={`absolute rounded-row border border-line bg-panel px-2 py-1 text-xs leading-tight whitespace-nowrap text-ink ${place} ${shown}`}
        style={around ? { left: `calc(50% + ${Math.round(label.shift)}px)` } : undefined}
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
      onClick={(e) => {
        if (!plain(e)) return;
        e.preventDefault();
        onPick(v);
      }}
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

// Where an element sits in the map's box, in its pixels; null when it isn't shown or, for the card
// and the list (`floating`), when it sits under the map rather than over it (below 1024px).
function boxIn(map: HTMLElement, el: HTMLElement | null, floating = false): Rect | null {
  if (!el || el.hidden || el.offsetWidth === 0) return null;
  if (floating && getComputedStyle(el).position !== "absolute") return null;
  const m = map.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x0: r.left - m.left, y0: r.top - m.top, x1: r.right - m.left, y1: r.bottom - m.top };
}

// What the page measured: the map's box (with what the card and the open list cover), what else is
// on it (the key, the buttons, the open list), each label's width.
interface Measured {
  box: PinBox;
  avoid: Rect[];
  widths: Record<string, number>;
  phone: boolean;
}

// The street map's moves, once it's drawn.
interface Moves {
  to: (siteId: string) => void; // to a venue: zoomed in to 13 at least, in the free part
  everyVenue: () => void; // back to every venue
  repad: () => void; // the free part changed (the list opened or shut)
  zoom: (by: 1 | -1) => void;
}

// The map's own buttons: glass that floats, 44px, 12px corners.
const MAP_BUTTON =
  "glass-float press-glass flex size-11 items-center justify-center rounded-inner text-ink";
// The two zoom buttons, joined in one piece of that glass: a line between them, each greyed at its
// end of the zoom.
const ZOOM_GROUP = "glass-float flex flex-col rounded-inner";
const ZOOM_BUTTON =
  "press relative flex size-11 items-center justify-center text-ink not-aria-disabled:hover:bg-button-hover not-aria-disabled:active:bg-button-press aria-disabled:cursor-not-allowed aria-disabled:text-ink-faint focus-visible:z-1";

export function VenueMap({
  venues,
  chosenSite,
  view,
  tiles,
  card,
  list = null,
  moveTo = null,
  onPickVenue,
}: {
  venues: MapVenue[];
  chosenSite: string | null;
  view: BoardView;
  tiles: string | null; // the street map's file, or none
  card: ReactNode; // the session card, over the map from 1024px and under it below
  list?: ReactNode | null; // To offer, as a list on the map (none: no list button)
  moveTo?: { siteId: string; seq: number } | null; // a pick's venue: the street map moves there
  onPickVenue: (v: MapVenue) => void; // a pin, picked in place
}) {
  const placed = venues.filter((v): v is Venue => v.lat !== null && v.lng !== null);
  const unplaced = venues.filter((v) => v.lat === null || v.lng === null);
  const box = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const keyBox = useRef<HTMLUListElement>(null);
  const buttonsBox = useRef<HTMLDivElement>(null);
  const moves = useRef<Moves | null>(null);
  const [markers, setMarkers] = useState<Map<string, HTMLElement> | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  // With a street map: where each venue is on screen now (it moves), for its label's side, and the
  // view (on the box as data-zoom and data-center, for the browser tests; the zoom's ends grey its
  // buttons).
  const [projected, setProjected] = useState<{ x: number; y: number }[] | null>(null);
  const [camera, setCamera] = useState<{
    zoom: number;
    center: [number, number];
    min: number;
    max: number;
  } | null>(null);
  const [streets, setStreets] = useState<"none" | "loading" | "shown" | "failed">(
    tiles ? "loading" : "none",
  );
  const [listOpen, setListOpen] = useState(false);
  const onStreets = markers !== null && streets !== "failed";
  const chosen = placed.findIndex((v) => v.siteId === chosenSite);
  const order = labelOrder(placed, chosenSite);

  // The box, what the card and the open list cover, what else is on it and the labels' widths,
  // measured now, whenever the box, the card or the list changes size (the list opening or
  // shutting), and once the streets are on (the zoom buttons are there then).
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const card = boxIn(el, cardBox.current, true);
    const open = boxIn(el, listBox.current, true);
    const widths: Record<string, number> = {};
    // Every label, shown or not (a hidden one keeps its size).
    for (const label of el.querySelectorAll<HTMLElement>("[data-pin-label]"))
      if (label.offsetWidth > 0) widths[label.dataset.pinLabel ?? ""] = label.offsetWidth;
    const width = el.clientWidth;
    setMeasured({
      box: {
        width,
        height: el.clientHeight,
        inset: card ? card.x1 + 12 : 0,
        right: open ? width - open.x0 + 12 : 0,
      },
      avoid: [boxIn(el, keyBox.current), boxIn(el, buttonsBox.current), open].filter(
        (r): r is Rect => r !== null,
      ),
      widths,
      phone: isPhoneBox(width),
    });
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const watch = new ResizeObserver(() => measure());
    for (const part of [el, cardBox.current, listBox.current]) if (part) watch.observe(part);
    return () => watch.disconnect();
    // Measured again once the streets are on: the buttons are there.
  }, [measure, onStreets]);

  // The street map, when the firm has one: MapLibre and the file's reader, loaded only then.
  useEffect(() => {
    if (!tiles || !box.current) return;
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
        // Its web worker from our own route (../map-worker/route.ts): where the bundler leaves it,
        // MapLibre can't find it.
        maplibregl.setWorkerUrl(`/office/map-worker?v=${maplibregl.getVersion()}`);
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        const dark = document.documentElement.dataset.theme !== "light";
        const map = new maplibregl.Map({
          container: el,
          // The streets, water, land and their names, in the office's look (light with the
          // sd-theme cookie's light, else dark), the letter shapes from our own server.
          style: mapStyle.mapStyle(tiles, dark ? "dark" : "light", MAP_ATTRIBUTION),
          maxZoom: mapStyle.MAP_MAX_ZOOM,
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // The part of the map the card and the open list leave free (MapLibre's own padding: a move
        // centres there, a fit keeps every venue inside it).
        const pad = () =>
          cameraPadding(
            { width: el.clientWidth, height: el.clientHeight },
            { card: boxIn(el, cardBox.current, true), list: boxIn(el, listBox.current, true) },
          );
        // Every venue, as far in as the area round them (zoom 13), in the free part.
        // (Not named "fit": scripts/invariants.sh reads that name called as a focused test.)
        const fitVenues = (animate: boolean) => {
          const bounds = venueBounds(placed);
          if (bounds)
            map.fitBounds(bounds, {
              padding: pad(),
              absolutePadding: true,
              maxZoom: mapStyle.MAP_FIT_MAX_ZOOM,
              duration: animate && !still() ? 700 : 0,
            });
        };
        fitVenues(false);
        moves.current = {
          to: (siteId) => {
            const v = placed.find((p) => p.siteId === siteId);
            if (!v) return;
            const at = {
              center: [v.lng, v.lat] as [number, number],
              zoom: Math.max(map.getZoom(), mapStyle.MAP_FIT_MAX_ZOOM),
              padding: pad(),
            };
            if (still()) map.jumpTo(at);
            else map.easeTo({ ...at, duration: 700 });
          },
          everyVenue: () => fitVenues(true),
          repad: () => {
            if (still()) map.jumpTo({ padding: pad() });
            else map.easeTo({ padding: pad(), duration: 300 });
          },
          zoom: (by) => {
            const duration = still() ? 0 : 300;
            if (by > 0) map.zoomIn({ duration });
            else map.zoomOut({ duration });
          },
        };
        const els = new Map<string, HTMLElement>();
        const pins = placed.map((v) => {
          const pin = document.createElement("div");
          els.set(v.siteId, pin);
          // The pin's middle on the venue.
          return new maplibregl.Marker({ element: pin, anchor: "center" })
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
          const c = map.getCenter();
          setCamera({
            zoom: map.getZoom(),
            center: [c.lng, c.lat],
            min: map.getMinZoom(),
            max: map.getMaxZoom(),
          });
        };
        map.on("moveend", project);
        project();
        map.once("load", () => !gone && setStreets("shown"));
        map.on("error", () => !gone && setStreets("failed"));
        setMarkers(els);
        cleanup = () => {
          moves.current = null;
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

  // A pick (a pin, a row of the list): the street map moves to its venue.
  const goTo = useEffectEvent((siteId: string) => {
    if (onStreets) moves.current?.to(siteId);
  });
  useEffect(() => {
    if (moveTo) goTo(moveTo.siteId);
  }, [moveTo]);

  // The list opened or shut: the street map's free part follows it, and once open, the chosen
  // session's row (else the list's top) is brought into view (on a phone, the page scrolls to it).
  const listShown = useEffectEvent((open: boolean) => {
    if (onStreets) moves.current?.repad();
    if (!open) return;
    const row = listBox.current
      ?.querySelector('[aria-current="true"]')
      ?.closest<HTMLElement>("[data-session]");
    (row ?? listBox.current)?.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    listShown(listOpen);
  }, [listOpen]);

  // Without the streets: until the page has measured the map, each pin by share of the part the
  // card leaves (its shape near enough a laptop's); then in its real pixels.
  const shares = placePins(placed, { width: 1000 - 432, height: 600 });
  // Each label's width: on a phone only the chosen pin's (no other shows there).
  const widths = placed.map((v) =>
    !measured || (measured.phone && v.siteId !== chosenSite)
      ? null
      : (measured.widths[v.siteId] ?? null),
  );
  const chosenAt = chosen >= 0 ? chosen : null;
  const laid = measured
    ? layoutPins(placed, measured.box, widths, order, measured.avoid, chosenAt)
    : null;
  // With them: each label's side where its venue is now.
  const streetLabels =
    measured && projected
      ? placeLabels(projected, widths, order, measured.box, measured.avoid, chosenAt)
      : null;
  const total = venues.reduce((n, v) => n + v.places, 0);
  const buttons = list !== null || onStreets;
  const atMax = camera !== null && camera.zoom >= camera.max - 0.001;
  const atMin = camera !== null && camera.zoom <= camera.min + 0.001;

  return (
    <section aria-labelledby="venue-map-title" className="flex min-w-0 flex-col gap-2">
      <h2 id="venue-map-title" className="sr-only">
        Venues with places to fill
      </h2>
      <div className="relative">
        <div
          ref={box}
          data-tour="map"
          data-venue-map={onStreets ? "streets" : "plain"}
          data-zoom={onStreets && camera ? camera.zoom.toFixed(2) : undefined}
          data-center={
            onStreets && camera
              ? `${camera.center[0].toFixed(5)},${camera.center[1].toFixed(5)}`
              : undefined
          }
          className="glass relative h-95 overflow-hidden rounded-inner [--inset:0px] @min-[64rem]:h-150 @min-[64rem]:[--inset:27rem]"
        >
          {!onStreets &&
            placed.map((v, i) => {
              const spot = laid?.[i];
              return (
                <div
                  key={v.siteId}
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${v.siteId === chosenSite ? "z-1" : ""}`}
                  style={
                    spot
                      ? { left: `${Math.round(spot.x)}px`, top: `${Math.round(spot.y)}px` }
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
                    label={
                      spot
                        ? { side: spot.label, shift: spot.shift }
                        : { side: shares[i]!.x > 0.7 ? "left" : "right", shift: 0 }
                    }
                    onPick={onPickVenue}
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
                      label={streetLabels?.[i] ?? { side: "none", shift: 0 }}
                      onPick={onPickVenue}
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
          {/* The key: top left on a phone, clear of the buttons; from 640px top right, left of the
              buttons (12px in from the corner, 44px wide, 8px apart). */}
          <ul
            ref={keyBox}
            role="list"
            aria-label="Key"
            className={`pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-4.75rem)] flex-wrap gap-1 @min-[40rem]:left-auto @min-[40rem]:max-w-none @min-[40rem]:justify-end @min-[40rem]:gap-2 ${buttons ? "@min-[40rem]:right-16" : "@min-[40rem]:right-3"}`}
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
                className="flex items-center gap-2 rounded-full border border-line bg-panel px-2 py-1 text-xs text-ink-muted @min-[40rem]:px-3"
              >
                <span aria-hidden="true" className={`size-3 rounded-full border-2 ${ring}`} />
                {MAP_KEY[k]}
              </li>
            ))}
          </ul>
          {/* The map's buttons, top right, over MapLibre's canvas: the list, then (with the streets)
              the zoom, joined, and back to every venue. */}
          {buttons && (
            <div
              ref={buttonsBox}
              role="group"
              aria-label={MAP_BUTTONS}
              className="absolute top-3 right-3 z-10 flex flex-col gap-2"
            >
              {list !== null && (
                <button
                  type="button"
                  aria-pressed={listOpen}
                  aria-controls="to-offer-list"
                  aria-label={listButton(listOpen)}
                  title={listButton(listOpen)}
                  onClick={() => setListOpen((o) => !o)}
                  className={`${MAP_BUTTON} aria-pressed:bg-accent aria-pressed:text-on-accent`}
                >
                  <Icon name="list" />
                </button>
              )}
              {onStreets && (
                <div className={ZOOM_GROUP}>
                  <button
                    type="button"
                    aria-label={ZOOM_IN}
                    title={ZOOM_IN}
                    aria-disabled={atMax || undefined}
                    onClick={() => !atMax && moves.current?.zoom(1)}
                    className={`${ZOOM_BUTTON} rounded-t-inner`}
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    type="button"
                    aria-label={ZOOM_OUT}
                    title={ZOOM_OUT}
                    aria-disabled={atMin || undefined}
                    onClick={() => !atMin && moves.current?.zoom(-1)}
                    className={`${ZOOM_BUTTON} rounded-b-inner border-t border-line`}
                  >
                    <Icon name="minus" />
                  </button>
                </div>
              )}
              {onStreets && (
                <button
                  type="button"
                  aria-label={FIT_ALL}
                  title={FIT_ALL}
                  onClick={() => moves.current?.everyVenue()}
                  className={MAP_BUTTON}
                >
                  <Icon name="corners" />
                </button>
              )}
            </div>
          )}
        </div>
        {/* The session card: over the map's left from 1024px (as tall as the map less 12px each
            end, scrolling inside only if it must), under it below. */}
        <div
          ref={cardBox}
          data-map-card=""
          className="mt-3 @min-[64rem]:absolute @min-[64rem]:top-3 @min-[64rem]:left-3 @min-[64rem]:mt-0 @min-[64rem]:flex @min-[64rem]:max-h-[calc(100%-1.5rem)] @min-[64rem]:w-101 @min-[64rem]:flex-col"
        >
          {card}
        </div>
        {/* To offer's list: over the map's right from 1024px, under the key and left of the
            buttons, clear of the credit at the foot; under the card below. Shut until asked for. */}
        {list !== null && (
          <div
            ref={listBox}
            id="to-offer-list"
            hidden={!listOpen}
            className="mt-3 @min-[64rem]:absolute @min-[64rem]:top-14 @min-[64rem]:right-16 @min-[64rem]:z-20 @min-[64rem]:mt-0 @min-[64rem]:flex @min-[64rem]:max-h-[calc(100%-6rem)] @min-[64rem]:w-88 @min-[64rem]:flex-col"
          >
            {list}
          </div>
        )}
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-1 text-xs text-ink-faint">
        <span>{mapFoot(onStreets)}</span>
        <span className="tabular-nums">{mapCountLine(venues.length, total, view)}</span>
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
                  <td
                    className={`px-3 py-2 text-right ${v.urgent ? "text-urgent-ink" : "text-ink"}`}
                  >
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
