import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SATURATE,
  over,
  saturate,
  washPoints,
  type Rgb,
  type Rgba,
} from "@/lib/tenancy/glass-grounds";

// The looks src/app/globals.css draws (Phase 24, docs/ui-design.md "Phase 24: Liquid Glass"), read
// back as numbers for the look tests (tests/unit/ui.glass.test.ts, ui.contrast.test.ts): each
// block's colour tokens and glass variables, the fallbacks laid over them (less transparency or
// more contrast, and a browser that can't blur: solid), and every ground a word can sit on in each
// look.

export const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// The body of the first block a pattern finds (its first group); a missing block fails the test.
export function block(pattern: RegExp): string {
  const found = css.match(pattern)?.[1];
  if (found === undefined) throw new Error(`no block in globals.css for ${pattern}`);
  return found;
}

// A block's custom properties by name (without the --), each value on one line.
export function props(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/\s+/g, " ").trim(),
    ]),
  );
}
// Only the colour tokens (--color-*), by their utility name.
export function colourTokens(body: string): Map<string, string> {
  return new Map(
    [...props(body)].filter(([k]) => k.startsWith("color-")).map(([k, v]) => [k.slice(6), v]),
  );
}

const REDUCE = String.raw`@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\s*`;
const REDUCE_DEVICE = String.raw`@media \(prefers-reduced-transparency: reduce\) and \(prefers-color-scheme: dark\),\s*\(prefers-contrast: more\) and \(prefers-color-scheme: dark\) \{\s*`;
const NO_BLUR = String.raw`@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*`;
const ROOT = String.raw`:root \{([^}]*)\}`;
const DARK = String.raw`:root\[data-theme="dark"\] \{([^}]*)\}`;
const DEVICE = String.raw`:root:not\(\[data-theme="light"\]\) \{([^}]*)\}`;

// Each block, by what it is. `theme` is the @theme block's tokens (they come before its keyframes,
// the first closing brace); `root` the glass's own variables in light.
export const BLOCKS = {
  theme: /@theme\s*\{([^}]*)\}/,
  root: new RegExp(`^${ROOT}`, "m"),
  dark: new RegExp(`^${DARK}`, "m"),
  deviceDark: new RegExp(String.raw`^@media \(prefers-color-scheme: dark\) \{\s*${DEVICE}`, "m"),
  solid: new RegExp(`${REDUCE}${ROOT}`),
  solidDark: new RegExp(`${REDUCE}:root \\{[^}]*\\}\\s*${DARK}`),
  solidDeviceDark: new RegExp(`${REDUCE_DEVICE}${DEVICE}`),
  clear: new RegExp(`${NO_BLUR}${ROOT}`),
  clearDark: new RegExp(`${NO_BLUR}:root \\{[^}]*\\}\\s*${DARK}`),
  clearDeviceDark: new RegExp(
    `${NO_BLUR}:root \\{[^}]*\\}\\s*:root\\[data-theme="dark"\\] \\{[^}]*\\}\\s*@media \\(prefers-color-scheme: dark\\) \\{\\s*${DEVICE}`,
  ),
} as const;

// A colour as the stylesheet writes it: #rrggbb, or rgb(r g b / a).
export function parseColour(value: string | undefined): Rgba | undefined {
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  return rgb ? (rgb.slice(1).map(Number) as Rgba) : undefined;
}
export const hexOf = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// WCAG 2's relative luminance and contrast ratio.
export function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// CSS brightness() on the screen's values (`press-glass` and btn.primary's hover brighten a glass
// control: brightness(1.06) at most), each channel clipped.
export const BRIGHT = 1.06;
const brighten = (c: Rgb): Rgb => c.map((v) => Math.min(255, Math.round(v * BRIGHT))) as Rgb;
const rgbOnly = (c: Rgba): Rgb => [c[0], c[1], c[2]];

// One look: its colour tokens and glass variables (the theme's, with any fallback laid over them),
// the points of the page behind the glass, and whether the glass's backdrop saturates them.
export interface Look {
  name: string;
  colours: Map<string, Rgba>;
  vars: Map<string, string>;
  wash: Rgb[];
  saturates: boolean;
}

function parsed(tokens: Map<string, string>): Map<string, Rgba> {
  const out = new Map<string, Rgba>();
  for (const [k, v] of tokens) {
    const c = parseColour(v);
    if (c) out.set(k, c);
  }
  return out;
}
const merge = <V>(...maps: Map<string, V>[]) => new Map(maps.flatMap((m) => [...m]));

export function looks(): Look[] {
  const theme = colourTokens(block(BLOCKS.theme));
  const dark = colourTokens(block(BLOCKS.dark));
  const root = props(block(BLOCKS.root));
  const darkVars = props(block(BLOCKS.dark));
  const solid = props(block(BLOCKS.solid));
  const solidDark = props(block(BLOCKS.solidDark));
  const clear = props(block(BLOCKS.clear));
  const clearDark = props(block(BLOCKS.clearDark));
  const tokens = (m: Map<string, string>) =>
    new Map([...m].filter(([k]) => k.startsWith("color-")).map(([k, v]) => [k.slice(6), v]));
  const lightColours = parsed(theme);
  const darkColours = parsed(merge(theme, dark));
  const solidOnly = (m: Map<string, string>) =>
    new Map([...m].filter(([k]) => !k.startsWith("color-")));
  const canvas = (c: Map<string, Rgba>) => rgbOnly(c.get("canvas")!);
  const solidLight = parsed(merge(theme, tokens(solid)));
  const solidDarkColours = parsed(merge(theme, dark, tokens(solid), tokens(solidDark)));
  return [
    {
      name: "light",
      colours: lightColours,
      vars: root,
      wash: washPoints("light"),
      saturates: true,
    },
    {
      name: "dark",
      colours: darkColours,
      vars: merge(root, darkVars),
      wash: washPoints("dark"),
      saturates: true,
    },
    // Less transparency or more contrast: every ground solid, no wash behind them, no blur.
    {
      name: "light, solid",
      colours: solidLight,
      vars: merge(root, solidOnly(solid)),
      wash: [canvas(solidLight)],
      saturates: false,
    },
    {
      name: "dark, solid",
      colours: solidDarkColours,
      vars: merge(root, darkVars, solidOnly(solid), solidOnly(solidDark)),
      wash: [canvas(solidDarkColours)],
      saturates: false,
    },
    // A browser that can't blur: every ground solid too, with the wash still round them.
    {
      name: "light, no blur",
      colours: parsed(merge(theme, tokens(clear))),
      vars: merge(root, solidOnly(clear)),
      wash: washPoints("light"),
      saturates: false,
    },
    {
      name: "dark, no blur",
      colours: parsed(merge(theme, dark, tokens(clear), tokens(clearDark))),
      vars: merge(root, darkVars, solidOnly(clear), solidOnly(clearDark)),
      wash: washPoints("dark"),
      saturates: false,
    },
  ];
}

// The places a word or a control can sit that aren't one token: a tile's and a clear button's
// gradients (`glass-tile`, `glass-button`: the button also under the pointer and pressed), the lens
// (`lens`: the chosen tab or option, on its track), the main button (`glass-tint`, its colour to its
// shade), the firm's pale tint (`brand-soft`), the pass's warm band (`glass-band`, both ends,
// over the section it tops: Phase 24, 24.6), and a booked day on Open shifts' strip (`booked-day`:
// ink at 12%).
export const PLACES = [
  "glass-tile",
  "glass-button",
  "lens",
  "glass-tint",
  "brand-soft",
  "glass-band",
  "booked-day",
] as const;

// A ground as the screen shows it, and whether the control on it is brightened (pressed:
// `press-glass`'s brightness(1.06); the main button under the pointer too). A CSS filter brightens
// the control's own layer, its words and its fill, not the page behind it: so a clear control's
// words are brightened over the same ground (its fill is white, which stays white), and the main
// button's opaque colour is brightened with its words.
export interface Ground {
  colour: Rgb;
  brightened: boolean;
}

// A look's sections and what floats over each point of its wash (worked out once per look).
const BASES = new WeakMap<Look, { section: Rgb[]; float: Rgb[] }>();
function base(look: Look): { section: Rgb[]; float: Rgb[] } {
  const known = BASES.get(look);
  if (known) return known;
  const fill = (name: string) => {
    const c = look.colours.get(name);
    if (!c) throw new Error(`${look.name}: no colour token ${name}`);
    return c;
  };
  const sat = (c: Rgb) => (look.saturates ? saturate(c, SATURATE) : c);
  const float = look.wash.map((w) => over(fill("panel"), sat(w)));
  const section = [
    ...look.wash.map((w) => over(fill("card"), sat(w))),
    ...float.map((f) => over(fill("card"), sat(f))),
  ];
  const found = { section, float };
  BASES.set(look, found);
  return found;
}

// Every ground at `where` (a token, or one of PLACES) in a look: a section (`card`, `sheet`) over
// each point of the wash, saturated by its filter, and over what floats; what floats (`panel`)
// over the wash; the page itself (`canvas`) is the wash; a translucent part inside either takes each
// of those under it; a solid token is itself.
export function grounds(look: Look, where: string, brand?: Rgb): Ground[] {
  const colour = (name: string) => {
    const c = look.colours.get(name);
    if (!c) throw new Error(`${look.name}: no colour token ${name}`);
    return c;
  };
  const glassVar = (name: string) => {
    const c = parseColour(look.vars.get(name));
    if (!c) throw new Error(`${look.name}: no colour in --${name}`);
    return c;
  };
  const { section, float } = base(look);
  const under = [...section, ...float];
  const on = (top: Rgba, below: Rgb[]) => below.map((b) => over(top, b));
  const at = (colours: Rgb[], brightened = false): Ground[] =>
    colours.map((c) => ({ colour: c, brightened }));
  const ends = (below: Rgb[]) =>
    [glassVar("button-top"), glassVar("button-bottom")].flatMap((t) => on(t, below));
  switch (where) {
    case "canvas":
      return at(look.wash);
    case "card":
    case "sheet":
      return at(section);
    case "panel":
      return at(float);
    case "glass-tile":
      return at([glassVar("tile-top"), glassVar("tile-bottom")].flatMap((t) => on(t, under)));
    case "glass-button":
      return [
        ...at(ends(under)),
        ...at(ends(on(colour("button-hover"), under))),
        ...at(ends(on(colour("button-press"), under)), true),
      ];
    case "button-press":
      return at(on(colour("button-press"), under), true);
    case "lens": {
      const lens = [
        ...on(colour("pill"), under),
        ...on(colour("pill"), on(colour("track"), under)),
      ];
      return [...at(lens), ...at(lens, true)];
    }
    case "glass-tint": {
      const fills = [rgbOnly(colour("tint")), rgbOnly(colour("tint-shade"))];
      return [...at(fills), ...at(fills.map(brighten), true)];
    }
    case "brand-soft":
      return at(on([...(brand ?? rgbOnly(colour("brand"))), 0.12], under));
    case "glass-band":
      return at([glassVar("band-from"), glassVar("band-to")].flatMap((t) => on(t, section)));
    case "booked-day":
      return at(on([...rgbOnly(colour("ink")), 0.12], under));
  }
  const c = colour(where);
  return at(c[3] === 1 ? [rgbOnly(c)] : on(c, under));
}

// The lowest contrast of a solid token (or a given colour) over every ground at `where`, brightened
// with its control where that is.
export function lowest(look: Look, fg: string | Rgb, where: string, brand?: Rgb): number {
  const colour = typeof fg === "string" ? look.colours.get(fg) : ([...fg, 1] as Rgba);
  if (!colour) throw new Error(`${look.name}: no colour token ${String(fg)}`);
  if (colour[3] !== 1) throw new Error(`${look.name}: ${String(fg)} isn't solid`);
  const words = rgbOnly(colour);
  return Math.min(
    ...grounds(look, where, brand).map((g) =>
      contrast(g.brightened ? brighten(words) : words, g.colour),
    ),
  );
}
