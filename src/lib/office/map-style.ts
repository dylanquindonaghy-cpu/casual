import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { MapOptions } from "maplibre-gl";

// The dashboard's street map's style (Phase 27.8; Dylan, 2026-11-03: "proper map: yes", "the extra
// detail too it needs to be proper", on the mock-up https://claude.ai/artifact/6z1cJpFyTZ5V7PtDh8HxKH):
// Protomaps' layers (`@protomaps/basemaps`) over the firm's own UK map file, with
//
// - the names on: places (country, region, town, area), roads (major and minor), water, islands and
//   house numbers; not the points of interest, the road-number shields or the one-way arrows
//   (MAP_DROPPED_LAYERS), and no icons at all (a town's dot is its only one: it goes), so the style
//   needs no sprite;
// - its letter shapes from our own server (public/map-glyphs/, MAP_GLYPHS): Noto Sans in three
//   weights, five ranges each (Latin, Latin Extended A and B, Welsh's letters, punctuation such as
//   ’ and –); a name in another script still shows, drawn by the browser (MapLibre draws a range it
//   can't load itself), and never fetched from another site;
// - clearer drawing in both looks (MAP_COLOURS over the named flavour): in dark, roads a step
//   brighter (main roads brightest), blue water, green parks and building outlines; in light the
//   same the other way, roads a step darker; every name readable on its halo and on the land
//   (4.5:1: tests/unit/office.map-style.test.ts).
//
// Pure: the venue map (src/app/office/dashboard/venue-map.tsx) loads it with MapLibre, only when the
// firm has a map file. These colours are the map's own (MapLibre paints its canvas from the style,
// not from CSS), so they live here and not in src/app/globals.css's tokens.

export type MapLook = "dark" | "light";
type Style = Exclude<MapOptions["style"], string | undefined>;
type Layer = ReturnType<typeof layers>[number];

// Close enough to see each building (with a zoom-15 file the data is real to 15 and stays sharp
// beyond); the view fitted to the venues stops at 13, the whole area round them.
export const MAP_MAX_ZOOM = 18;
export const MAP_FIT_MAX_ZOOM = 13;

// The letter shapes, from this server's public/map-glyphs/ (its README says where they're from).
export const MAP_GLYPHS = "/map-glyphs/{fontstack}/{range}.pbf";
export const MAP_FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"] as const;
export const MAP_GLYPH_RANGES = ["0-255", "256-511", "512-767", "7680-7935", "8192-8447"] as const;
export const MAP_DROPPED_LAYERS = ["pois", "roads_shields", "roads_oneway"] as const;

// The named flavours' colours this map changes (the mock-up's dark values; light the same kind of
// change the other way, kept calm).
export const MAP_COLOURS: Record<MapLook, Partial<Flavor>> = {
  dark: {
    background: "#16171a",
    earth: "#1a1b1e",
    water: "#1f3347",
    park_a: "#1d2b22",
    park_b: "#203126",
    wood_a: "#1e2a22",
    wood_b: "#1e2a22",
    buildings: "#2b2c31",
    industrial: "#202125",
    school: "#22222a",
    hospital: "#2a2224",
    other: "#45464c",
    minor_service: "#45464c",
    minor_a: "#55565d",
    minor_b: "#4b4c52",
    link: "#5f6067",
    major: "#6e6f76",
    highway: "#8a8b92",
    bridges_minor: "#55565d",
    bridges_major: "#6e6f76",
    bridges_highway: "#8a8b92",
    tunnel_minor: "#3a3b40",
    tunnel_major: "#45464c",
    tunnel_highway: "#55565d",
    railway: "#5b5d66",
    boundaries: "#6b7384",
    roads_label_minor: "#a1a2a8",
    roads_label_minor_halo: "#16171a",
    roads_label_major: "#c4c5ca",
    roads_label_major_halo: "#16171a",
    subplace_label: "#a9aab0",
    subplace_label_halo: "#16171a",
    city_label: "#e4e4e7",
    city_label_halo: "#16171a",
    address_label: "#8b8c92",
    address_label_halo: "#16171a",
    // The flavour's own are too faint to read (under 4.5:1): the regions' and the country's names,
    // and the water's (on the water).
    state_label: "#9a9ba1",
    state_label_halo: "#16171a",
    country_label: "#b4b5ba",
    ocean_label: "#8fb3d9",
  },
  light: {
    background: "#e9e8e4",
    earth: "#f1f0ec",
    water: "#a8cbe6",
    park_a: "#dceadb",
    park_b: "#cde5cb",
    wood_a: "#d9e7d6",
    wood_b: "#cfe2cb",
    scrub_a: "#dbe8d6",
    scrub_b: "#d3e5cf",
    buildings: "#cbc8c1",
    industrial: "#e5e5e8",
    school: "#eeeae2",
    hospital: "#f1e5e5",
    other: "#d9dadd",
    minor_service: "#d9dadd",
    minor_a: "#cfd0d4",
    minor_b: "#d4d5d9",
    link: "#c6c8cc",
    major: "#bcbec3",
    highway: "#a7aab0",
    minor_service_casing: "#e4e3df",
    minor_casing: "#e4e3df",
    link_casing: "#e4e3df",
    major_casing_early: "#e4e3df",
    major_casing_late: "#e4e3df",
    highway_casing_early: "#e4e3df",
    highway_casing_late: "#e4e3df",
    bridges_minor: "#cfd0d4",
    bridges_major: "#bcbec3",
    bridges_highway: "#a7aab0",
    tunnel_minor: "#e0e1e4",
    tunnel_major: "#d6d7db",
    tunnel_highway: "#c9cbcf",
    railway: "#a2a5ac",
    boundaries: "#9aa1ae",
    roads_label_minor: "#5d5f66",
    roads_label_minor_halo: "#f6f5f2",
    roads_label_major: "#45474e",
    roads_label_major_halo: "#f6f5f2",
    subplace_label: "#56585f",
    subplace_label_halo: "#f6f5f2",
    city_label: "#1d1e22",
    city_label_halo: "#f6f5f2",
    address_label: "#64666d",
    address_label_halo: "#f6f5f2",
    state_label: "#5a5c63",
    state_label_halo: "#f6f5f2",
    country_label: "#4b4d54",
    ocean_label: "#25507a",
  },
};

export function mapFlavor(look: MapLook): Flavor {
  return { ...namedFlavor(look), ...MAP_COLOURS[look] };
}

// A layer's typefaces: its text-font's, and those its name's sections ask for (the flavour's
// "format" expressions). A typeface list is the strings in a ["literal", [...]] or a plain list of
// names; a typeface's name always has a space in it, an expression's operator never does.
const isNameList = (v: unknown[]): v is string[] =>
  v.length > 0 && v.every((s) => typeof s === "string" && s.includes(" "));

function fontsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (isNameList(value)) return value;
  if (value[0] === "literal" && Array.isArray(value[1]))
    return value[1].filter((s): s is string => typeof s === "string");
  return value.flatMap(fontsIn);
}

function eachFontValue(value: unknown, found: (fonts: unknown) => void): void {
  if (Array.isArray(value)) for (const v of value) eachFontValue(v, found);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (k === "text-font") found(v);
      else eachFontValue(v, found);
    }
}

export function layerFonts(layer: Layer): string[] {
  if (layer.type !== "symbol") return [];
  const fonts = new Set<string>();
  eachFontValue(layer.layout, (v) => fontsIn(v).forEach((f) => fonts.add(f)));
  return [...fonts];
}

// Any typeface we don't serve (the flavour asks for a Devanagari one for names in that script) is
// swapped for the regular one: the browser then draws those letters itself.
const hosted = (name: string) =>
  (MAP_FONTS as readonly string[]).includes(name) ? name : MAP_FONTS[0];

function hostFonts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (isNameList(value)) return value.map(hosted);
  if (value[0] === "literal" && Array.isArray(value[1]))
    return ["literal", value[1].map((s: unknown) => (typeof s === "string" ? hosted(s) : s))];
  return value.map(hostFonts);
}

function withHostedFonts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withHostedFonts);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "text-font" ? hostFonts(v) : withHostedFonts(v),
      ]),
    );
  return value;
}

const noIcons = <T extends object | undefined>(props: T): T =>
  props && (Object.fromEntries(Object.entries(props).filter(([k]) => !k.startsWith("icon-"))) as T);

// The layers as this map draws them: the flavour's, less the three dropped, with no icons and only
// the typefaces we serve.
export function mapLayers(look: MapLook): Layer[] {
  return layers("protomaps", mapFlavor(look), { lang: "en" })
    .filter((l) => !(MAP_DROPPED_LAYERS as readonly string[]).includes(l.id))
    .map((l) =>
      l.type === "symbol"
        ? {
            ...l,
            layout: withHostedFonts(noIcons(l.layout)) as typeof l.layout,
            paint: noIcons(l.paint),
          }
        : l,
    );
}

// The whole style: the firm's file (a path on this server, MAP_TILES_URL), the letter shapes from
// this server, no sprite. `attribution` is the credit's words (shown by the page itself).
export function mapStyle(tiles: string, look: MapLook, attribution: string): Style {
  return {
    version: 8,
    glyphs: MAP_GLYPHS,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${tiles}`, attribution },
    },
    layers: mapLayers(look),
  };
}
