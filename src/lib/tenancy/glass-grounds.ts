// The glass the words sit on (round 8: Phase 26 in the office, Phase 27.6 in the casual app;
// docs/ui-design.md "Phase 27.6"): the ground behind every page with its faint street map, and the
// glass laid over it, as numbers, so contrast can be worked out over the glass itself rather than
// over one flat colour. src/app/globals.css draws the same values (tests/unit/ui.glass.test.ts
// reads them back from it and checks they agree); the firm's colours (brand-values.ts) and the
// contrast test (tests/unit/ui.contrast.test.ts) both read the grounds from here. Pure, with no
// imports, so the owner's script can use it too. (Round 7's pastel wash of four coloured lights is
// gone: Phase 27.6.)

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type Theme = "light" | "dark";

// The ground: a flat colour (off-white in light, charcoal in dark) under a faint street map, its
// lines at two strengths (--map-line and --map-road), each a translucent ink (or white) over it.
export const GROUND: Record<Theme, { base: Rgb; lines: [Rgba, Rgba] }> = {
  light: {
    base: [242, 242, 240],
    lines: [
      [16, 24, 40, 0.05],
      [16, 24, 40, 0.07],
    ],
  },
  dark: {
    base: [15, 15, 16],
    lines: [
      [255, 255, 255, 0.06],
      [255, 255, 255, 0.085],
    ],
  },
};

// The glass, each a translucent fill (a gradient's two ends where it has one):
// - section: a card, a list, a table, a panel (frosted: it blurs what's behind it);
// - float: what floats over the page (the tab bar, a sheet, a menu, the confirmation): the
//   strongest;
// - tile: a part inside a section (a date tile, a chip's ground, a field, an inner card);
// - button: a clear glass button or count;
// - track and lens: a switch or a row of tabs (the track) and its chosen option (the lens).
// Round 8's: in light a white section over the off-white and a faint ink tile; in dark (Phase
// 27.1) a 4% white section, what floats 70% charcoal.
export const GLASS: Record<
  Theme,
  {
    section: Rgba;
    float: Rgba;
    tile: [Rgba, Rgba];
    button: [Rgba, Rgba];
    track: Rgba;
    lens: Rgba;
  }
> = {
  light: {
    section: [255, 255, 255, 0.55],
    float: [255, 255, 255, 0.92],
    tile: [
      [16, 24, 40, 0.03],
      [16, 24, 40, 0.03],
    ],
    button: [
      [255, 255, 255, 0.7],
      [255, 255, 255, 0.7],
    ],
    track: [16, 24, 40, 0.06],
    lens: [255, 255, 255, 0.96],
  },
  dark: {
    section: [255, 255, 255, 0.04],
    float: [24, 24, 26, 0.7],
    tile: [
      [255, 255, 255, 0.03],
      [255, 255, 255, 0.03],
    ],
    button: [
      [255, 255, 255, 0.05],
      [255, 255, 255, 0.05],
    ],
    track: [255, 255, 255, 0.06],
    lens: [255, 255, 255, 0.1],
  },
};

// How much a section's and a floating glass's backdrop filter saturates what's behind it
// (globals.css --glass-filter and --float-filter: `saturate(1.15)`). On round 8's greys it changes
// nothing (tests/unit/ui.glass.test.ts checks every ground point), but it's applied as the browser
// does, so a ground with colour in it would be counted right.
export const SATURATE = 1.15;

// The CSS saturate() filter as the browser applies it: the Filter Effects matrix on the screen's
// own (sRGB) values, then clipped. Measured in Chromium against known colours: it matches to the
// unit (a model in linear light would be up to 22 out on a saturated blue).
export function saturate(c: Rgb, s: number = SATURATE): Rgb {
  const [r, g, b] = c;
  const m = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  return m.map((row) =>
    Math.round(Math.min(255, Math.max(0, row[0]! * r + row[1]! * g + row[2]! * b))),
  ) as Rgb;
}

// One translucent colour over an opaque one, rounded to whole values as the screen shows it.
export function over(top: Rgba, under: Rgb): Rgb {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i]! * a + under[i]! * (1 - a))) as Rgb;
}

// The ground's points worth checking: the flat ground itself, and each strength of the street
// map's lines over it (a word or a piece of glass can lie over either).
export function groundPoints(theme: Theme): Rgb[] {
  const { base, lines } = GROUND[theme];
  return [base, ...lines.map((l) => over(l, base))];
}

// Every ground a word can sit on, by where it is: on the ground itself (a page's headline and its
// line); on a section (which blurs and saturates what's behind it); inside one (a tile, a clear
// button, both ends of their gradients); on what floats (which saturates what's behind it too); on
// a lens in a track in a section; on a tile or a button inside what floats (a row in a panel, a
// sheet's buttons); and on a section laid inside what floats (a card in a panel).
export function glassGrounds(theme: Theme): {
  ground: Rgb[];
  section: Rgb[];
  inner: Rgb[];
  float: Rgb[];
  lens: Rgb[];
  all: Rgb[];
} {
  const g = GLASS[theme];
  const ground = groundPoints(theme);
  const behind = ground.map((w) => saturate(w));
  const section = [
    ...behind.map((w) => over(g.section, w)),
    ...behind.map((w) => over(g.section, saturate(over(g.float, w)))),
  ];
  const parts = [...g.tile, ...g.button];
  const inner = section.flatMap((s) => parts.map((t) => over(t, s)));
  const float = behind.map((w) => over(g.float, w));
  const lens = [...section, ...float].map((s) => over(g.lens, over(g.track, s)));
  const floatInner = float.flatMap((f) => parts.map((t) => over(t, f)));
  const all = [...ground, ...section, ...inner, ...float, ...lens, ...floatInner];
  return { ground, section, inner: [...inner, ...floatInner], float, lens, all };
}
