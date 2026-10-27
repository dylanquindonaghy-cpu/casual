// The checks and colours behind a firm's brand (src/lib/tenancy/brand.ts), pure and on their own so
// the owner's script (scripts/firm-brand-owner.ts) can use them without the app's database layer.

import { glassGrounds, type Rgb } from "./glass-grounds";

export const DEFAULT_BRAND_COLOUR = "#15171a"; // the app's own ink (src/app/globals.css; Phase 20)

const HEX = /^#[0-9a-fA-F]{6}$/;

// A logo address that's safe to put in an <img>: https only, no user name or password in it, at
// most 500 characters. Anything else: no logo.
export function safeLogoUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    // As stored and shown: percent-encoding can make it longer than what was typed.
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

export const isBrandColour = (raw: unknown): raw is string =>
  typeof raw === "string" && HEX.test(raw);

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The firm's colour (or the default) and black or white text on it, whichever contrasts more:
// for any colour that's at least 4.58:1 (WCAG AA for normal text is 4.5:1). `own`: the firm set a
// colour of its own (then its pages use it for their main action too: src/app/layout.tsx).
export function brandColours(raw: unknown): { background: string; text: string; own: boolean } {
  const own = isBrandColour(raw);
  const background = own ? raw.toLowerCase() : DEFAULT_BRAND_COLOUR;
  const text =
    contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
      ? "#ffffff"
      : "#000000";
  return { background, text, own };
}

// --- The firm's colour on its pages (Phase 18) ---------------------------------------------

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const INK: Rgb = [21, 23, 26]; // the app's ink, #15171a (Phase 20)
// The grounds the firm's colour sits on (Phase 24): every point of the glass and the wash it lies
// on, in each theme (glass-grounds.ts, the same values src/app/globals.css draws).
// (Each once: many points of the glass come out the same.)
const unique = (cs: Rgb[]) => [...new Map(cs.map((c) => [c.join(","), c])).values()];
const LIGHT_GROUNDS: Rgb[] = unique(glassGrounds("light").all);
const DARK_GROUNDS: Rgb[] = unique(glassGrounds("dark").all);
const MIN = 4.5;
// brand-soft in globals.css: the firm's colour at this strength over whatever it lies on.
const TINT = 0.12;
// The main button's shade (Phase 24): its tinted glass runs from the colour at the top to this much
// further from its words' colour at the foot, so the words read at least as well everywhere on it.
const SHADE = 0.18;
// A glass control brightens a little under the pointer and while pressed (globals.css
// `press-glass`: brightness(1.06); btn.primary's hover: 1.05): the main button's words read on
// its colour brightened by this too.
export const BRIGHTEN = 1.06;

const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hexOf = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
// The same contrast as contrastRatio, with numbers in place of #rrggbb text (a palette checks
// hundreds of points of the glass, at each of up to 60 steps; on every page render): each whole
// value's linear light looked up, not worked out again, and each ground's luminance worked out once.
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
// A colour's luminance as the page shows it: clipped and rounded to whole values, as hexOf does.
const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => Math.round(Math.min(255, Math.max(0, v))));
  return 0.2126 * LINEAR[r!]! + 0.7152 * LINEAR[g!]! + 0.0722 * LINEAR[b!]!;
};
const ratioOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const ratio = (a: Rgb, b: Rgb) => ratioOf(lum(a), lum(b));
const LIGHT_LUMS = LIGHT_GROUNDS.map(lum);
const DARK_LUMS = DARK_GROUNDS.map(lum);
const readsOnAll = (x: Rgb, lums: number[]) => {
  const l = lum(x);
  return lums.every((g) => ratioOf(l, g) >= MIN);
};
const mix = (a: Rgb, b: Rgb, k: number): Rgb => a.map((v, i) => v + (b[i]! - v) * k) as Rgb;
// CSS brightness() on the screen's values: each channel times k, clipped (hexOf clips).
const brighten = (c: Rgb, k = BRIGHTEN): Rgb => rgbOf(hexOf(c.map((v) => v * k) as Rgb));

// Whether `x` reads on its own tint over every one of `grounds`, as the page will show them: the
// colour as its #rrggbb, mixed, then rounded to whole values.
const readsOnTint = (x: Rgb, grounds: Rgb[]) => {
  const own = rgbOf(hexOf(x));
  const l = lum(own);
  return grounds.every((g) => ratioOf(l, lum(mix(g, own, TINT))) >= MIN);
};

// Moves `c` towards `target` in 6% steps until `done` holds (at most 60 steps; then the target
// itself, for which every caller's condition holds).
function towards(c: Rgb, target: Rgb, done: (x: Rgb) => boolean): Rgb {
  let x = c;
  for (let i = 0; i < 60 && !done(x); i++) x = mix(x, target, 0.06);
  return done(x) ? x : target;
}

// One theme's set: the main button's fill and its words, the firm's colour as words on the page's
// grounds, and the band (the pass, the firm's initial) with its words, its quieter words (the
// pass's second line: Phase 20) and the words on the gate's white plate on it.
export interface FirmColours {
  fill: string;
  onFill: string;
  shade: string;
  ink: string;
  bar: string;
  onBar: string;
  onBarSoft: string;
  onPlate: string;
}

// The firm's colour for each theme (the design's derivation, made certain): the band is the
// colour darkened until white or ink reads on it at 4.5:1, with whichever reads better, and its
// quieter words that one moved a fifth of the way to the band, back towards it until they read at
// 4.5:1; in light, the button and the words are the colour darkened until it reads on every point
// of the glass and the wash (Phase 24) and on its own tint over them, with white on it (also
// brightened, as under the pointer: it's the main button in both themes); in dark,
// lightened until it reads on every dark point of them and its own tint, with ink on it (or
// white), lightened further if neither reads yet. The button's shade is the colour moved further
// from its words (darker under white, lighter under ink). The gate's white plate takes the band's
// colour as its words when that reads on white. Every pair is at least 4.5:1, for any #rrggbb
// (tests/unit/tenancy.brand.test.ts).
export function firmPalette(hex: string): { light: FirmColours; dark: FirmColours } {
  const b = rgbOf(hex.toLowerCase());
  const bar = towards(b, BLACK, (x) => ratio(WHITE, x) >= MIN || ratio(INK, x) >= MIN);
  const onBar = ratio(WHITE, bar) >= ratio(INK, bar) ? WHITE : INK;
  const onBarSoft = towards(mix(onBar, bar, 0.2), onBar, (x) => ratio(x, bar) >= MIN);
  // The gate's plate is white on any band: its words are the band's colour when that reads on
  // white (as white reads on the band), otherwise ink.
  const onPlate = ratio(WHITE, bar) >= MIN ? bar : INK;
  // The words read on its own pale tint too (brand-soft: 12% of the colour over the card), as
  // on a sign plate and an open Details button.
  // It's the main button in both themes too, with white words, brightened under the pointer.
  const lightInk = towards(
    b,
    BLACK,
    (x) =>
      readsOnAll(x, LIGHT_LUMS) &&
      readsOnTint(x, LIGHT_GROUNDS) &&
      ratio(WHITE, brighten(rgbOf(hexOf(x)))) >= MIN,
  );
  const darkInk = towards(
    b,
    WHITE,
    (x) =>
      readsOnAll(x, DARK_LUMS) &&
      readsOnTint(x, DARK_GROUNDS) &&
      (ratio(INK, x) >= MIN || ratio(WHITE, x) >= MIN),
  );
  const band = {
    bar: hexOf(bar),
    onBar: hexOf(onBar),
    onBarSoft: hexOf(onBarSoft),
    onPlate: hexOf(onPlate),
  };
  const darkOnFill = ratio(INK, darkInk) >= MIN ? INK : WHITE;
  // Away from the words: darker under white words, lighter under ink.
  const shade = (fill: Rgb, words: Rgb) => hexOf(mix(fill, words === WHITE ? BLACK : WHITE, SHADE));
  return {
    light: {
      fill: hexOf(lightInk),
      onFill: "#ffffff",
      shade: shade(lightInk, WHITE),
      ink: hexOf(lightInk),
      ...band,
    },
    dark: {
      fill: hexOf(darkInk),
      onFill: hexOf(darkOnFill),
      shade: shade(darkInk, darkOnFill),
      ink: hexOf(darkInk),
      ...band,
    },
  };
}

// The firm's own colour as the page's --firm-* values (src/app/globals.css picks the theme's
// set), set on <body> by the root layout with data-firm-colour: only for a colour of its own
// (already a checked #rrggbb); otherwise nothing, and the app's own colours stand. Every value is
// a #rrggbb worked out here, never the stored text itself.
export function brandStyle(brand: {
  own: boolean;
  background: string;
}): Record<`--firm-${string}`, string> | undefined {
  if (!brand.own || !isBrandColour(brand.background)) return undefined;
  const { light, dark } = firmPalette(brand.background);
  const style = {
    "--firm-fill": light.fill,
    "--firm-on-fill": light.onFill,
    "--firm-shade": light.shade,
    "--firm-ink": light.ink,
    "--firm-bar": light.bar,
    "--firm-on-bar": light.onBar,
    "--firm-on-bar-soft": light.onBarSoft,
    "--firm-on-plate": light.onPlate,
    "--firm-dark-fill": dark.fill,
    "--firm-dark-on-fill": dark.onFill,
    "--firm-dark-ink": dark.ink,
  };
  return Object.values(style).every(isBrandColour) ? style : undefined;
}
