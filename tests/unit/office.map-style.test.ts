import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";
import { describe, expect, it } from "vitest";
import { MAP_ATTRIBUTION, ZOOM_IN, ZOOM_OUT } from "@/lib/office/dashboard-map-copy";
import {
  layerFonts,
  MAP_DROPPED_LAYERS,
  MAP_FIT_MAX_ZOOM,
  MAP_FONTS,
  MAP_GLYPH_RANGES,
  MAP_GLYPHS,
  MAP_MAX_ZOOM,
  mapFlavor,
  mapLayers,
  mapStyle,
  type MapLook,
} from "@/lib/office/map-style";
import { contrastRatio } from "@/lib/tenancy/brand-values";
import type { Rgb } from "@/lib/tenancy/glass-grounds";
import { FIXTURE_PLACES, pmtilesFixture } from "../e2e/pmtiles-fixture";

// The dashboard's street map with proper detail (Phase 27.8; Dylan, 2026-11-03, on the mock-up
// https://claude.ai/artifact/6z1cJpFyTZ5V7PtDh8HxKH): its names on, its letter shapes from our own
// server, clearer drawing in both looks with every name readable, and zoom to building level.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const LOOKS: MapLook[] = ["dark", "light"];
const TILES = "/maps/uk.pmtiles";

const rgb = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

// The names the map shows: places, roads, water, islands and house numbers.
const NAMES = [
  "address_label",
  "earth_label_islands",
  "places_country",
  "places_locality",
  "places_region",
  "places_subplace",
  "roads_labels_major",
  "roads_labels_minor",
  "water_label_lakes",
  "water_label_ocean",
  "water_waterway_label",
];

describe("the street map's names (Phase 27.8)", () => {
  it.each(LOOKS)(
    "%s: every place, road, water and house-number name on; no points of interest, shields or one-way arrows",
    (look) => {
      const ids = mapLayers(look).map((l) => l.id);
      expect(MAP_DROPPED_LAYERS).toEqual(["pois", "roads_shields", "roads_oneway"]);
      for (const id of MAP_DROPPED_LAYERS) expect(ids).not.toContain(id);
      // Every one of the flavour's other layers kept, in its order.
      const all = layers("protomaps", namedFlavor(look), { lang: "en" }).map((l) => l.id);
      for (const id of MAP_DROPPED_LAYERS) expect(all).toContain(id);
      expect(ids).toEqual(
        all.filter((id) => !(MAP_DROPPED_LAYERS as readonly string[]).includes(id)),
      );
      // The words on the map are exactly these layers'.
      const symbols = mapLayers(look)
        .filter((l) => l.type === "symbol")
        .map((l) => l.id)
        .sort();
      expect(symbols).toEqual(NAMES);
      // Each still has its words.
      for (const l of mapLayers(look))
        if (l.type === "symbol") expect(l.layout?.["text-field"], l.id).toBeDefined();
    },
  );

  it.each(LOOKS)("%s: no icon anywhere (a town's dot goes), so the style has no sprite", (look) => {
    // The flavour's own: the town dot is its one icon left once the three layers go.
    const flavour = layers("protomaps", namedFlavor(look), { lang: "en" }).filter(
      (l) => !(MAP_DROPPED_LAYERS as readonly string[]).includes(l.id),
    );
    const town = flavour.find((l) => l.id === "places_locality");
    expect(town?.type === "symbol" && town.layout?.["icon-image"]).toBeTruthy();
    for (const l of mapLayers(look)) {
      const props = [
        ...Object.keys((l.layout ?? {}) as object),
        ...Object.keys((l.paint ?? {}) as object),
      ];
      expect(
        props.filter((p) => p.startsWith("icon-")),
        l.id,
      ).toEqual([]);
    }
    const style = mapStyle(TILES, look, MAP_ATTRIBUTION);
    expect(JSON.stringify(style)).not.toContain("icon-image");
    expect("sprite" in style).toBe(false);
  });
});

describe("the street map's letter shapes: from our own server, never another site", () => {
  it.each(LOOKS)("%s: the glyphs and the map file are paths on this server", (look) => {
    const style = mapStyle(TILES, look, MAP_ATTRIBUTION);
    expect(style.glyphs).toBe("/map-glyphs/{fontstack}/{range}.pbf");
    expect(MAP_GLYPHS).toBe(style.glyphs);
    expect(style.glyphs!.startsWith("/") && !style.glyphs!.startsWith("//")).toBe(true);
    expect(Object.keys(style.sources)).toEqual(["protomaps"]);
    expect(style.sources.protomaps).toEqual({
      type: "vector",
      url: "pmtiles:///maps/uk.pmtiles",
      attribution: MAP_ATTRIBUTION,
    });
    // Nothing else in it names a place to fetch from: no address with a host, no "//" but the
    // file's own pmtiles:/// (the credit's link is words the page shows itself, never fetched).
    const source: Record<string, unknown> = { ...style.sources.protomaps };
    delete source.attribution;
    const rest = JSON.stringify({ ...style, sources: { protomaps: source } });
    expect(rest).not.toMatch(/https?:/i);
    expect(rest.replaceAll("pmtiles:///", "")).not.toContain("//");
  });

  it.each(LOOKS)(
    "%s: every typeface a layer uses is one we serve (the Devanagari one swapped for the regular)",
    (look) => {
      const used = new Set(mapLayers(look).flatMap(layerFonts));
      expect([...used].sort()).toEqual([...MAP_FONTS].sort());
      // The flavour asks for one more, for names written in Devanagari: not on our server.
      const flavour = JSON.stringify(layers("protomaps", namedFlavor(look), { lang: "en" }));
      expect(flavour).toContain("Noto Sans Devanagari Regular v1");
      expect(JSON.stringify(mapLayers(look))).not.toContain("Noto Sans Devanagari");
    },
  );

  it("each typeface has all five ranges in public/map-glyphs, with its licence and where it's from", () => {
    expect(MAP_FONTS).toEqual(["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]);
    expect(MAP_GLYPH_RANGES).toEqual(["0-255", "256-511", "512-767", "7680-7935", "8192-8447"]);
    for (const font of MAP_FONTS)
      for (const range of MAP_GLYPH_RANGES) {
        const file = join(process.cwd(), "public/map-glyphs", font, `${range}.pbf`);
        expect(existsSync(file), `${font}/${range}`).toBe(true);
        const data = readFileSync(file);
        expect(statSync(file).size, `${font}/${range}`).toBeGreaterThan(10_000);
        // A glyph file names its own range (protocol buffers: field 1, then the range's text).
        expect(data.includes(Buffer.from(range)), `${font}/${range}`).toBe(true);
      }
    // Nothing else in the folder: the three typefaces, the licence and the README.
    expect(readdirSync(join(process.cwd(), "public/map-glyphs")).sort()).toEqual(
      ["Noto Sans Italic", "Noto Sans Medium", "Noto Sans Regular", "OFL.txt", "README.md"].sort(),
    );
    for (const font of MAP_FONTS)
      expect(readdirSync(join(process.cwd(), "public/map-glyphs", font)).sort()).toEqual(
        MAP_GLYPH_RANGES.map((r) => `${r}.pbf`).sort(),
      );
    const licence = read("public/map-glyphs/OFL.txt");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain("The Noto Project Authors");
    const readme = read("public/map-glyphs/README.md");
    expect(readme).toContain(
      "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    );
    expect(readme).toContain("SIL Open Font License 1.1");
  });
});

describe("the street map's drawing: clearer in both looks, every name readable", () => {
  it("dark: the mock-up's colours", () => {
    expect(mapFlavor("dark")).toMatchObject({
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
      // The flavour's own regions', country's and water's names were too faint to read.
      state_label: "#9a9ba1",
      state_label_halo: "#16171a",
      country_label: "#b4b5ba",
      ocean_label: "#8fb3d9",
    });
  });

  it("light: the same kind of change the other way, kept calm", () => {
    expect(mapFlavor("light")).toMatchObject({
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
    });
  });

  it.each(LOOKS)(
    "%s: roads stand out by importance, water blue, parks green, buildings shown",
    (look) => {
      const f = mapFlavor(look);
      const earth = luminance(f.earth);
      const [minor, major, highway] = [f.minor_a, f.major, f.highway].map(luminance);
      // Dark: each step brighter, main roads brightest. Light: each step darker.
      if (look === "dark")
        expect(earth < minor! && minor! < major! && major! < highway!).toBe(true);
      else expect(earth > minor! && minor! > major! && major! > highway!).toBe(true);
      // And a step clearer than the named flavour's own.
      const plain = namedFlavor(look);
      const gap = (a: string, b: string) => Math.abs(luminance(a) - luminance(b));
      expect(gap(f.highway, f.earth)).toBeGreaterThan(gap(plain.highway, plain.earth));
      const [wr, wg, wb] = rgb(f.water);
      expect(wb > wr && wb >= wg).toBe(true);
      for (const park of [f.park_a, f.park_b]) {
        const [r, g, b] = rgb(park);
        expect(g > r && g > b, park).toBe(true);
      }
      expect(f.buildings).not.toBe(f.earth);
    },
  );

  it.each(LOOKS)("%s: every name at least 4.5:1 on its halo and on the land", (look) => {
    const earth = mapFlavor(look).earth;
    rgb(earth);
    const named = mapLayers(look).filter((l) => l.type === "symbol");
    expect(named.length).toBe(NAMES.length);
    for (const l of named) {
      const paint = (l.paint ?? {}) as Record<string, unknown>;
      const text = paint["text-color"];
      const halo = paint["text-halo-color"];
      expect(typeof text, `${l.id} text-color`).toBe("string");
      expect(typeof halo, `${l.id} text-halo-color`).toBe("string");
      // Each a #rrggbb colour (rgb() throws on anything else), then its contrast.
      rgb(text as string);
      rgb(halo as string);
      expect(
        contrastRatio(text as string, halo as string),
        `${l.id} on its halo`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text as string, earth), `${l.id} on the land`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});

describe("the street map's zoom: + and − buttons, to building level", () => {
  it("zooms to 18 (each building), the view fitted to the venues stops at 13", () => {
    expect(MAP_MAX_ZOOM).toBe(18);
    expect(MAP_FIT_MAX_ZOOM).toBe(13);
    const map = read("src/app/office/dashboard/venue-map.tsx");
    expect(map).toContain("maxZoom: mapStyle.MAP_MAX_ZOOM,");
    expect(map).toContain("maxZoom: mapStyle.MAP_FIT_MAX_ZOOM,");
    // Phase 27.4: the map's buttons are the office's own (the list, the zoom and back to every
    // venue in one column), so MapLibre's NavigationControl is gone; each zoom button is one step
    // of MapLibre's own zoom.
    expect(map).not.toContain("NavigationControl");
    expect(map).not.toContain("addControl(");
    expect(map).toContain("if (by > 0) map.zoomIn({ duration });");
    expect(map).toContain("else map.zoomOut({ duration });");
    // Their names, pinned (the words MapLibre's own buttons had).
    expect([ZOOM_IN, ZOOM_OUT]).toEqual(["Zoom in", "Zoom out"]);
    expect(map).toMatch(
      /aria-label=\{ZOOM_IN\}[\s\S]*?onClick=\{\(\) => !atMax && moves\.current\?\.zoom\(1\)\}/,
    );
    expect(map).toMatch(
      /aria-label=\{ZOOM_OUT\}[\s\S]*?onClick=\{\(\) => !atMin && moves\.current\?\.zoom\(-1\)\}/,
    );
    // Still no turning, still two fingers (or Ctrl + scroll) to move it.
    expect(map).toContain("cooperativeGestures: true");
    expect(map).toContain("dragRotate: false");
    expect(map).toContain("map.touchZoomRotate.disableRotation();");
  });

  it("its buttons in the office's look: 44px each, floating glass, the words' colour, drawn icons", () => {
    const map = read("src/app/office/dashboard/venue-map.tsx");
    const constant = (name: string) => new RegExp(`const ${name} =\\s*"([^"]*)";`).exec(map)?.[1];
    // Each 44px, in the words' colour, on what floats (blurred, the office's own drop: no colour
    // of its own; ui.glass.test.ts), 12px corners.
    const button = constant("MAP_BUTTON")?.split(" ") ?? [];
    expect(button).toEqual(
      expect.arrayContaining(["glass-float", "size-11", "text-ink", "rounded-inner"]),
    );
    expect(constant("ZOOM_GROUP")?.split(" ")).toEqual(
      expect.arrayContaining(["glass-float", "flex-col", "rounded-inner"]),
    );
    const zoom = constant("ZOOM_BUTTON")?.split(" ") ?? [];
    expect(zoom).toEqual(expect.arrayContaining(["size-11", "text-ink"]));
    // The line between the two, and a greyed button at the end of the zoom (it says so).
    expect(map).toContain("className={`${ZOOM_BUTTON} rounded-b-inner border-t border-line`}");
    expect(zoom).toEqual(expect.arrayContaining(["aria-disabled:text-ink-faint"]));
    expect(map).toContain("aria-disabled={atMax || undefined}");
    expect(map).toContain("aria-disabled={atMin || undefined}");
    // The office's one focus ring (globals.css :focus-visible), never taken away, and a focused one
    // over its neighbour.
    expect(`${button.join(" ")} ${zoom.join(" ")}`).not.toMatch(/outline-none|outline-0/);
    expect(zoom).toContain("focus-visible:z-1");
    // The + and − (and the list's lines, the corners) drawn as the office's icons, not pictures.
    expect(map).toContain('<Icon name="plus" />');
    expect(map).toContain('<Icon name="minus" />');
    expect(map).toContain('<Icon name="list" />');
    expect(map).toContain('<Icon name="corners" />');
    expect(map).not.toMatch(/url\(/);
    // MapLibre's own buttons' rules went with them.
    expect(read("src/app/globals.css")).not.toContain("maplibregl-ctrl");
    // Top right, 12px in from the corner, one column 8px apart; the key left of them from 640px:
    // 12px in, the buttons' 44px, 8px apart = 64px.
    expect(map).toContain('className="absolute top-3 right-3 z-10 flex flex-col gap-2"');
    expect(map).toContain('${buttons ? "@min-[40rem]:right-16" : "@min-[40rem]:right-3"}');
  });
});

// The browser tests' map file (tests/e2e/pmtiles-fixture.ts) read back as MapLibre reads it: the
// PMTiles reader, then MapLibre's own vector tile parser. Its one tile holds two town names, so the
// street-map run (tests/e2e/streets.spec.ts) sees MapLibre ask for their letter shapes.
describe("the browser tests' map file", () => {
  it("a PMTiles archive whose one tile has two towns' names, in letters our glyph files cover", async () => {
    const file = pmtilesFixture();
    const archive = new PMTiles({
      getKey: () => "e2e-fixture",
      getBytes: async (offset: number, length: number) => ({
        data: file.slice(offset, offset + length).buffer,
      }),
    });
    const header = await archive.getHeader();
    expect([header.minZoom, header.maxZoom, header.numAddressedTiles]).toEqual([0, 0, 1]);
    const tile = await archive.getZxy(0, 0, 0);
    expect(tile).toBeDefined();
    const vt = new VectorTile(new PbfReader(new Uint8Array(tile!.data)));
    expect(Object.keys(vt.layers)).toEqual(["places"]);
    const places = vt.layers.places!;
    expect(places.length).toBe(FIXTURE_PLACES.length);
    const towns = Array.from({ length: places.length }, (_, i) => places.feature(i));
    expect(towns.map((t) => t.properties)).toEqual(
      FIXTURE_PLACES.map((p) => ({
        kind: "locality",
        name: p.name,
        min_zoom: p.minZoom,
        population_rank: p.populationRank,
      })),
    );
    // Each a point near the demo's venues (Exampleton's made-up district: 53.8°N, 1.55°W).
    for (const [i, t] of towns.entries()) {
      expect(t.type).toBe(1);
      const geo = t.toGeoJSON(0, 0, 0).geometry;
      expect(geo.type).toBe("Point");
      const [lng, lat] = geo.type === "Point" ? geo.coordinates : [];
      expect(Math.abs(lng! - FIXTURE_PLACES[i]!.lng)).toBeLessThan(0.1);
      expect(Math.abs(lat! - FIXTURE_PLACES[i]!.lat)).toBeLessThan(0.1);
    }
    // The town names' layer picks them up ("kind" is "locality"), in Medium for a big town and
    // Regular for the other, every letter in a range we serve, one from the punctuation range.
    const town = mapLayers("dark").find((l) => l.id === "places_locality");
    expect(town?.type === "symbol" && town.filter).toEqual(["==", "kind", "locality"]);
    expect(layerFonts(town!).sort()).toEqual(["Noto Sans Medium", "Noto Sans Regular"]);
    const ranges = new Set(
      FIXTURE_PLACES.flatMap((p) =>
        [...p.name].map((ch) => {
          const start = Math.floor(ch.codePointAt(0)! / 256) * 256;
          return `${start}-${start + 255}`;
        }),
      ),
    );
    expect([...ranges].sort()).toEqual(["0-255", "8192-8447"]);
    for (const r of ranges) expect(MAP_GLYPH_RANGES).toContain(r);
  });
});
