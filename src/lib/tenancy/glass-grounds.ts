// The glass the words sit on (Phase 24, round 7; docs/ui-design.md "Phase 24"): the wash behind
// every page and the glass laid over it, as numbers, so contrast can be worked out over the glass
// itself rather than over one flat colour. src/app/globals.css draws the same values
// (tests/unit/ui.glass.test.ts reads them back from it and checks they agree); the firm's colours
// (brand-values.ts) and the contrast test (tests/unit/ui.contrast.test.ts) both read the grounds
// from here. Pure, with no imports, so the owner's script can use it too.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type Theme = "light" | "dark";

// The wash: a base colour with four soft lights over it (radial gradients fading to nothing), in
// light blue top left, lavender top right, peach low in the middle and mint bottom left; in dark,
// blue, purple, orange and teal glows on near-black. A light's centre is its colour at full
// strength over the base.
export const WASH: Record<Theme, { base: Rgb; lights: Rgba[] }> = {
  light: {
    base: [238, 241, 248],
    lights: [
      [201, 216, 255, 1],
      [230, 214, 255, 1],
      [255, 226, 201, 1],
      [205, 243, 232, 1],
    ],
  },
  dark: {
    base: [7, 8, 12],
    lights: [
      [37, 99, 235, 0.42],
      [124, 58, 237, 0.34],
      [234, 88, 12, 0.2],
      [13, 148, 136, 0.26],
    ],
  },
};

// The glass, each a translucent fill (a gradient's two ends where it has one):
// - section: a card, a list, a table, a panel (frosted: it blurs what's behind it);
// - float: what floats over the page (the rail, the top bar's capsules, the tab bar, a panel, a
//   menu, the confirmation): the strongest;
// - tile: a part inside a section (a date tile, a chip's ground, a field, an inner card);
// - button: a clear glass button or count;
// - track and lens: a switch or a row of tabs (the track) and its chosen option (the lens).
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
    section: [255, 255, 255, 0.46],
    float: [255, 255, 255, 0.78],
    tile: [
      [255, 255, 255, 0.72],
      [255, 255, 255, 0.44],
    ],
    button: [
      [255, 255, 255, 0.8],
      [255, 255, 255, 0.4],
    ],
    track: [118, 118, 128, 0.12],
    lens: [255, 255, 255, 0.92],
  },
  dark: {
    section: [26, 27, 34, 0.46],
    float: [30, 30, 34, 0.8],
    tile: [
      [255, 255, 255, 0.09],
      [255, 255, 255, 0.04],
    ],
    button: [
      [255, 255, 255, 0.12],
      [255, 255, 255, 0.04],
    ],
    track: [118, 118, 128, 0.18],
    lens: [255, 255, 255, 0.1],
  },
};

// How much a section's and a floating glass's backdrop filter saturates what's behind it
// (globals.css --glass-filter and --float-filter: `saturate(1.8)`).
export const SATURATE = 1.8;

// The CSS saturate() filter as the browser applies it: the Filter Effects matrix on the screen's
// own (sRGB) values, then clipped. Measured in Chromium against known colours: it matches to the
// unit (a model in linear light would be up to 22 out on the dark wash's blue).
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

const half = (a: Rgb, b: Rgb): Rgb => [0, 1, 2].map((i) => Math.round((a[i]! + b[i]!) / 2)) as Rgb;

// The wash's points worth checking: its base, each light's centre, and halfway between every two
// of those (where two lights overlap, a mix can be darker than either: luminance isn't linear).
export function washPoints(theme: Theme): Rgb[] {
  const { base, lights } = WASH[theme];
  const centres = lights.map((l) => over(l, base));
  const points: Rgb[] = [base, ...centres];
  for (let i = 0; i < centres.length; i++) {
    points.push(half(base, centres[i]!));
    for (let j = i + 1; j < centres.length; j++) points.push(half(centres[i]!, centres[j]!));
  }
  return points;
}

// Every ground a word can sit on, by where it is: on the wash itself (a page's headline and its
// line); on a section (which blurs and saturates the wash behind it); inside one (a tile, a clear
// button, both ends of their gradients); on what floats (which saturates the wash too); on a lens
// in a track in a section; on a tile or a button inside what floats (a row in a panel, the top
// bar's buttons); and on a section laid inside what floats (a card in a panel).
export function glassGrounds(theme: Theme): {
  wash: Rgb[];
  section: Rgb[];
  inner: Rgb[];
  float: Rgb[];
  lens: Rgb[];
  all: Rgb[];
} {
  const g = GLASS[theme];
  const wash = washPoints(theme);
  const behind = wash.map((w) => saturate(w));
  const section = [
    ...behind.map((w) => over(g.section, w)),
    ...behind.map((w) => over(g.section, saturate(over(g.float, w)))),
  ];
  const parts = [...g.tile, ...g.button];
  const inner = section.flatMap((s) => parts.map((t) => over(t, s)));
  const float = behind.map((w) => over(g.float, w));
  const lens = [...section, ...float].map((s) => over(g.lens, over(g.track, s)));
  const floatInner = float.flatMap((f) => parts.map((t) => over(t, f)));
  const all = [...wash, ...section, ...inner, ...float, ...lens, ...floatInner];
  return { wash, section, inner: [...inner, ...floatInner], float, lens, all };
}
