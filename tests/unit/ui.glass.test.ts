import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  btn,
  card,
  chip,
  countNeeds,
  countWaiting,
  field,
  loginCard,
  officeLoginCard,
  rows,
  staffBtn,
  staffCard,
  staffRows,
  switchTrack,
  tab,
  tabCurrent,
  table,
  tabs,
} from "@/app/ui/classes";
import {
  GLASS,
  GROUND,
  SATURATE,
  groundPoints,
  saturate,
  type Rgb,
  type Rgba,
} from "@/lib/tenancy/glass-grounds";
import { BLOCKS, block, colourTokens, css, parseColour, props } from "../helpers/theme-css";

// The glass (Phase 24's parts, docs/ui-design.md "Phase 24: Liquid Glass"), in round 8's look:
// the office's since Phase 26, the casual app's since Phase 27.6 (Dylan, 2026-11-03: "casual round
// 8: yes, firm's colour, follow the phone"; docs/ui-design.md "Phase 27.6"). Behind every page a
// plain colour (Phase 27.7: round 8's street pattern is gone, as round 7's pastel wash of four
// lights went before it), and on it glass, translucent and sharp. A section (a card, a list, a table, a row of tabs) is frosted (`glass`: it
// blurs what's behind it a little, with one even hairline and no drop at rest); what floats over
// the page is the strongest glass (`glass-float`: the office's top bar on a phone, menus, the
// drawer, the casual app's tab bar, the sheet), and nothing bends what's behind it (round 7's
// refraction is gone); the parts inside a section are clear glass that doesn't blur again
// (`glass-tile`, `glass-button`); the one main button is tinted glass in the firm's colour
// (`glass-tint`; hi-vis in the office), with no glow; the chosen tab or option is a lens
// (`lens`) on a glass track. Each value is pinned here, and src/lib/tenancy/glass-grounds.ts holds
// the same numbers (the contrast test, tests/unit/ui.contrast.test.ts, works every word out over
// them). Where someone asks for less transparency or more contrast, every ground is solid with no
// blur; where a browser can't blur, every ground is solid too. Depth is the glass's
// hairline (and only what floats has a drop), through variables, so the dark theme's reach the
// classes; no other shadow anywhere.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
const CODE = files("src").filter((f) => /\.tsx?$/.test(f));

// How the stylesheet writes a colour: #rrggbb when solid, else rgb(r g b / a).
const written = (c: Rgb | Rgba) =>
  c.length === 3
    ? `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
    : `rgb(${c[0]} ${c[1]} ${c[2]} / ${c[3]})`;

// A rule or a utility's body with whatever it nests, by the text that opens it (the first after
// `after`, when that's given).
function body(opening: string, after = ""): string {
  const at = css.indexOf(`${opening} {`, after ? css.indexOf(after) : 0);
  expect(at, `no ${opening} in globals.css`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`${opening} never closes`);
}

// Every use of a class in the app's code, per file (with any variant before it).
function uses(pattern: RegExp): Record<string, string[]> {
  return Object.fromEntries(
    CODE.map((file) => [file, (read(file).match(pattern) ?? []).sort()] as const).filter(
      ([, m]) => m.length > 0,
    ),
  );
}

const theme = () => colourTokens(block(BLOCKS.theme));
const DARKS = [
  ["the cookie's dark", BLOCKS.dark],
  ["the device's dark", BLOCKS.deviceDark],
] as const;

describe("the glass's numbers: globals.css draws glass-grounds.ts's", () => {
  // Phase 27.6: the casual app's ground is round 8's, as the office's (round 7's wash and its four
  // lights are gone). Phase 27.7 (Dylan, 2026-11-03: "Yes plain colour"): a plain colour, with no
  // street pattern over it (its two strengths of line, --map-line and --map-road, are gone).
  it("the ground: one plain colour, in light and both darks, with no lines over it", () => {
    const lines = ["map-line", "map-road"];
    expect(GROUND).toEqual({ light: [242, 242, 240], dark: [15, 15, 16] });
    expect(theme().get("canvas")).toBe(written(GROUND.light));
    expect(written(GROUND.light)).toBe("#f2f2f0");
    expect(written(GROUND.dark)).toBe("#0f0f10");
    const root = props(block(BLOCKS.root));
    expect(lines.filter((l) => root.has(l))).toEqual([]);
    for (const [name, pattern] of DARKS) {
      const dark = props(block(pattern));
      expect(dark.get("color-canvas"), name).toBe(written(GROUND.dark));
      expect(
        lines.filter((l) => dark.has(l)),
        name,
      ).toEqual([]);
    }
    // And the office's are the same colours, with no lines either.
    for (const [theme8, pattern] of [
      ["light", BLOCKS.officeLight],
      ["dark", BLOCKS.officeDark],
    ] as const) {
      const office = props(block(pattern));
      expect(office.get("color-canvas"), theme8).toBe(written(GROUND[theme8]));
      expect(
        lines.filter((l) => office.has(l)),
        theme8,
      ).toEqual([]);
    }
    // No street lines anywhere in the stylesheet, set or read.
    expect(css).not.toMatch(/--map-(?:line|road)\b/);
    // The ground's one point is the colour itself.
    for (const t of ["light", "dark"] as const) expect(groundPoints(t)).toEqual([GROUND[t]]);
    // No wash anywhere: none of its lights, none of its gradients.
    expect(css).not.toMatch(/--wash-|radial-gradient/);
    // The glass's saturate() leaves round 8's grey ground as it is (so the contrast test needn't
    // saturate it).
    for (const t of ["light", "dark"] as const)
      for (const point of groundPoints(t)) expect(saturate(point), `${t}: ${point}`).toEqual(point);
  });

  it("the glass: a section, what floats, a tile's and a button's two ends, the track and the lens", () => {
    const expected = (t: "light" | "dark") => ({
      "color-card": written(GLASS[t].section),
      "color-sheet": written(GLASS[t].section),
      "color-panel": written(GLASS[t].float),
      "color-track": written(GLASS[t].track),
      "color-pill": written(GLASS[t].lens),
      "tile-top": written(GLASS[t].tile[0]),
      "tile-bottom": written(GLASS[t].tile[1]),
      "button-top": written(GLASS[t].button[0]),
      "button-bottom": written(GLASS[t].button[1]),
    });
    const pick = (m: Map<string, string>, keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, m.get(k)]));
    const keys = Object.keys(expected("light"));
    const light = new Map([...props(block(BLOCKS.theme)), ...props(block(BLOCKS.root))]);
    expect(pick(light, keys)).toEqual(expected("light"));
    for (const [name, pattern] of DARKS)
      expect(pick(props(block(pattern)), keys), name).toEqual(expected("dark"));
  });

  // Round 8 (Phase 27.6, as the office's): a light blur, saturated SATURATE times; in dark a
  // section's blur is lighter still (Phase 27.1's 3px), what floats and the bar's edge as light's.
  it("a section and what floats blur a little and saturate it by SATURATE; the bar's edge only blurs", () => {
    const root = props(block(BLOCKS.root));
    expect(root.get("glass-filter")).toBe(`blur(6px) saturate(${SATURATE})`);
    expect(root.get("float-filter")).toBe(`blur(12px) saturate(${SATURATE})`);
    expect(root.get("edge-filter")).toBe("blur(8px)");
    for (const [name, pattern] of DARKS) {
      const dark = props(block(pattern));
      expect(dark.get("glass-filter"), name).toBe(`blur(3px) saturate(${SATURATE})`);
      expect(dark.get("float-filter"), name).toBe(`blur(12px) saturate(${SATURATE})`);
      expect(dark.get("edge-filter"), name).toBe("blur(8px)");
    }
    // Nothing blurs as round 7's glass did (24px, saturated 1.8 times).
    expect(css).not.toMatch(/blur\(24px\)|blur\(18px\)|saturate\(1\.[68]\)/);
  });

  // Phase 27.7 (Dylan, 2026-11-03: "make the background a colour not random lines as the map isn't
  // being used like that", "Yes plain colour"): behind every page, office and casual, the plain
  // ground and nothing drawn over it. Round 8's street map (Phase 26; the casual app's since Phase
  // 27.6: body::before, its lines in --map-road through a mask of src/app/office-streets.svg) is
  // gone, picture and all, as round 7's wash went before it.
  it("behind every page a plain colour: nothing drawn over the ground, no pattern, no mask", () => {
    // No ::before (or ::after) on <body>, the office's or anyone's: nothing drawn behind the page.
    expect(css).not.toMatch(/body(?:\[[^\]]*\]|:[a-z-]+\([^)]*\))*::?(?:before|after)/);
    // No picture of streets left, nor any url() for the page to draw.
    expect(existsSync(join(ROOT, "src/app/office-streets.svg"))).toBe(false);
    expect(css).not.toMatch(/office-streets|url\(/);
    // No mask over a page's ground: the only masks are the fades at a scrolling edge (ui.office-
    // system.test.ts pins each one).
    expect(css).not.toMatch(/(?:^|\s)(?:-webkit-)?mask:/);
    // <html> has no background of its own: <body>'s ground goes to the canvas and fills the window.
    expect(css).not.toMatch(/(?:^|\n)\s*html[^{]*\{[^}]*background/);
    // The page's own ground is the plain colour (the root layout's <body>), and no shell paints
    // over it (the office's frame and the casual app's bar did, until Phase 24).
    expect(read("src/app/layout.tsx")).toMatch(/<body[\s\S]*?className="bg-canvas /);
    expect(Object.keys(uses(/(?<![\w-])(?:[a-z0-9-]+:)*bg-canvas(?![\w-])/g))).toEqual([
      "src/app/global-error.tsx",
      "src/app/layout.tsx",
    ]);
  });
});

describe("the glass's parts (globals.css utilities)", () => {
  it("glass: a section, its fill, the frost, its rim and drop; an edge where colours are forced", () => {
    const glass = body("@utility glass");
    expect(glass).toContain("background-color: var(--color-card);");
    expect(glass).toContain("-webkit-backdrop-filter: var(--glass-filter);");
    expect(glass).toContain("  backdrop-filter: var(--glass-filter);");
    expect(glass).toContain("box-shadow: var(--glass-rim), var(--glass-drop);");
    expect(glass).toMatch(/@media \(forced-colors: active\) \{\s*border: 1px solid CanvasText;/);
    // A section is a layer of its own (the frost makes it one): one with a "…" menu open comes
    // forward, or the sections after it would cover the menu and take its clicks (the dashboard's
    // detail card, Phase 24, the urgent places' cards until then: tests/e2e/office.dashboard.spec.ts
    // clicks "Not urgent" in its menu).
    expect(glass).toMatch(/&:has\(details\[open\]\) \{\s*z-index: 10;\s*\}/);
    // Round 8 (Phase 26.2): the dashboard's session card floats over the map (glass-float, the
    // only drop on the dashboard), and comes forward the same way while its "…" menu is open.
    expect(read("src/app/office/dashboard/board.tsx")).toMatch(
      /<section\s+aria-labelledby="chosen-title"\s+data-chosen=\{s\.shiftId\}\s+className="glass-float relative [^"]*has-\[details\[open\]\]:z-10"[\s\S]*?<ShiftActions/,
    );
  });

  // Phase 27.6: round 8's glass is sharp everywhere: nothing bends what's behind what floats (round
  // 7's refraction, an SVG filter switched on in Chromium, is gone from the casual app too).
  it("glass-float: what floats, the strongest, frosted and never bent", () => {
    const float = body("@utility glass-float");
    expect(float).toContain("background-color: var(--color-panel);");
    expect(float).toContain("-webkit-backdrop-filter: var(--float-filter);");
    expect(float).toContain("  backdrop-filter: var(--float-filter);");
    expect(float).toContain("box-shadow: var(--float-shadow);");
    expect(float).not.toMatch(/url\(|\.rf\b/);
    // No bending anywhere: no filter by reference, no .rf switch.
    expect(css).not.toMatch(/url\(#|lg-refract|\.rf\b/);
  });

  it("the clear parts, the main button, the track and the lens", () => {
    expect(body("@utility glass-tile")).toMatch(
      /background-color: transparent;\s*background-image: linear-gradient\(180deg, var\(--tile-top\), var\(--tile-bottom\)\);\s*box-shadow: var\(--glass-rim\);/,
    );
    expect(body("@utility glass-button")).toMatch(
      /background-color: transparent;\s*background-image: linear-gradient\(180deg, var\(--button-top\), var\(--button-bottom\)\);\s*box-shadow: var\(--button-rim\), var\(--glass-drop-sm\);/,
    );
    const tint = body("@utility glass-tint");
    expect(tint).toContain(
      "background-image: linear-gradient(180deg, var(--color-tint), var(--color-tint-shade));",
    );
    // One flat colour since Phase 28 (28.1): the shade is the tint itself in every block that
    // sets it (the casual app's light and darks, the firm's own colour, the office's hi-vis).
    for (const block of css.matchAll(
      /--color-tint: ([^;]+);\s*--color-on-tint: [^;]+;\s*--color-tint-shade: ([^;]+);/g,
    ))
      expect(block[2], block[0]).toBe(block[1]);
    expect(css.match(/--color-tint-shade:/g)?.length).toBe(
      css.match(/--color-tint: [^;]+;\s*--color-on-tint: [^;]+;\s*--color-tint-shade:/g)?.length,
    );
    expect(tint).toContain("color: var(--color-on-tint);");
    // Its edge and no glow (round 8: the office's since Phase 26, the casual app's since 27.6;
    // round 7's soft drop in its own colour is gone).
    expect(tint).toMatch(/box-shadow: var\(--tint-rim\);/);
    expect(css).not.toMatch(/--tint-glow|color-mix\(in srgb, var\(--color-tint\)/);
    expect(body("@utility glass-rim")).toMatch(
      /^@utility glass-rim \{\s*box-shadow: var\(--glass-rim\);/,
    );
    // A status's chip and its coloured counts carry the rim over their tinted glass.
    expect(chip.base.split(" ")).toContain("glass-rim");
    for (const c of [countNeeds, countWaiting]) expect(c.split(" ")).toContain("glass-rim");
    expect(body("@utility glass-track")).toContain("background-color: var(--color-track);");
    expect(body("@utility lens")).toMatch(
      /background-color: var\(--color-pill\);\s*box-shadow: var\(--lens-shadow\);/,
    );
  });

  // Forced colours (Windows high contrast) drop the fills and shadows: every glass part that has
  // an edge to show gets the system's own line instead.
  it("forced colours: every glass part with an edge draws the system's line", () => {
    for (const [part, colour] of [
      ["@utility glass", "CanvasText"],
      ["@utility glass-float", "CanvasText"],
      ["@utility glass-button", "ButtonText"],
      ["@utility glass-tint", "ButtonText"],
      ["@utility glass-rim", "CanvasText"],
    ] as const)
      expect(body(part), part).toMatch(
        new RegExp(
          String.raw`@media \(forced-colors: active\) \{\s*border: 1px solid ${colour};\s*\}`,
        ),
      );
    expect(css.match(/@media \(forced-colors: active\)/g)).toHaveLength(5);
  });

  // Phase 27.6 (round 8's glass is sharp): round 7's bending is gone, not just unused: no
  // refraction filter in the root layout, no component that puts .rf on <html>, nothing in the
  // app's code that names either.
  it("no bending: no refraction filter, no .rf switch, anywhere", () => {
    expect(existsSync(join(ROOT, "src/app/glass-refraction.tsx"))).toBe(false);
    const layout = read("src/app/layout.tsx");
    expect(layout).not.toMatch(/Refraction|<svg|<filter/);
    expect(layout).toMatch(/<body[^>]*>\s*\{demo && <DemoBar \/>\}/);
    const named = CODE.filter((file) =>
      /lg-refract|feDisplacementMap|classList\.add\(["']rf["']\)|GlassRefraction/.test(read(file)),
    );
    expect(named).toEqual([]);
    expect(css).not.toMatch(/lg-refract|\.rf\b/);
  });

  it("nothing blurs but the glass, a table's sticky headings and the bars' edges", () => {
    // Declarations only (the @supports test below names it too): a section's, what floats', the top
    // bar's edge and the foot's (a shift's Take shift, Phase 24); each with Safari's prefix (round
    // 7's bending, Chrome's alone, and the rules switching it off are gone: Phase 27.6).
    expect(css.match(/^\s+backdrop-filter:/gm)).toHaveLength(4);
    expect(css.match(/^\s+-webkit-backdrop-filter:/gm)).toHaveLength(4);
    expect(body("@utility foot-edge")).toMatch(
      /-webkit-backdrop-filter: var\(--edge-filter\);\s+backdrop-filter: var\(--edge-filter\);/,
    );
    expect(
      uses(/(?<![\w-])(?:[a-z0-9-]+:)*backdrop-(?:blur|filter|saturate)[\w-]*(?![\w-])/g),
    ).toEqual({
      "src/app/ui/classes.ts": ["backdrop-blur-md"], // table.th
    });
  });
});

describe("the fallbacks", () => {
  // The see-through tokens a word can sit on (the decorative lines and the charts' grid aside):
  // the glass, and the statuses' tinted glass (a chip, a notice, a tile, a coloured count).
  const DECORATIVE = ["line", "mark-grid", "mark-base"];
  const TRANSLUCENT = [
    "card",
    "sheet",
    "panel",
    "raised",
    "track",
    "pill",
    "active",
    "count",
    "button",
    "button-line",
    "button-hover",
    "button-press",
    "urgent-soft",
    "urgent-tile",
    "attention-soft",
    "hivis",
    "wait-tile",
    "wait-soft",
    "done-soft",
    "done-tile",
    "quiet-soft",
  ];

  it("these, and only these, are see-through", () => {
    const seeThrough = [...theme()]
      .filter(([, v]) => (parseColour(v)?.[3] ?? 1) < 1)
      .map(([k]) => k)
      .filter((k) => !DECORATIVE.includes(k));
    expect(seeThrough).toEqual(TRANSLUCENT);
  });

  it("less transparency or more contrast: every one solid, in light and both darks; no blur, the same plain ground", () => {
    for (const [name, pattern] of [
      ["light", BLOCKS.solid],
      ["the cookie's dark", BLOCKS.solidDark],
      ["the device's dark", BLOCKS.solidDeviceDark],
    ] as const) {
      const solid = props(block(pattern));
      for (const t of TRANSLUCENT)
        expect(solid.get(`color-${t}`), `${name}: ${t}`).toMatch(/^#[0-9a-f]{6}$/);
      for (const v of ["tile-top", "tile-bottom", "button-top", "button-bottom", "edge-fill"])
        expect(solid.get(v), `${name}: --${v}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    // No blur in light or either dark (the dark blocks set their own 3px blur, so their fallbacks
    // switch it off again: Phase 27.6).
    for (const pattern of [BLOCKS.solid, BLOCKS.solidDark, BLOCKS.solidDeviceDark]) {
      const solid = props(block(pattern));
      for (const f of ["glass-filter", "float-filter", "edge-filter"])
        expect(solid.get(f), `${pattern}: ${f}`).toBe("none");
    }
    // The ground stays the plain colour (no fallback changes it), and there's nothing behind the
    // page for a fallback to hide (Phase 27.7: the street pattern and the rule hiding it are gone).
    for (const pattern of [
      BLOCKS.solid,
      BLOCKS.solidDark,
      BLOCKS.solidDeviceDark,
      BLOCKS.officeSolidDark,
      BLOCKS.officeSolidLight,
    ])
      expect(props(block(pattern)).has("color-canvas"), String(pattern)).toBe(false);
    expect(css).not.toMatch(/::before \{\s*display: none;/);
    // The device's dark blocks agree with the cookie's.
    expect(Object.fromEntries(props(block(BLOCKS.solidDeviceDark)))).toEqual(
      Object.fromEntries(props(block(BLOCKS.solidDark))),
    );
  });

  it("a browser that can't blur: every surface solid too, the same values, in light and both darks", () => {
    for (const [name, clear, solid] of [
      ["light", BLOCKS.clear, BLOCKS.solid],
      ["the cookie's dark", BLOCKS.clearDark, BLOCKS.solidDark],
      ["the device's dark", BLOCKS.clearDeviceDark, BLOCKS.solidDeviceDark],
    ] as const) {
      const values = Object.fromEntries(props(block(clear)));
      expect(values, name).toEqual(Object.fromEntries(props(block(solid))));
      for (const t of TRANSLUCENT)
        expect(values[`color-${t}`], `${name}: ${t}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("depth: a glass's rim and drop, through variables, and no other shadow", () => {
  // A shadow utility in a class (shadow, shadow-sm, md:shadow-lg, inset-shadow-…, shadow-[…],
  // drop-shadow-…), or a box-shadow in CSS. shadow-none takes one away, so it's allowed.
  const SHADOW =
    /(?<![\w-])(?:[a-z0-9-]+:)*(?:drop-|inset-)?shadow(?:-(?!none(?![\w-]))[\w[\]#/.()%,-]+)?(?![\w-])|box-shadow/g;
  const ONE_SHADOW = new RegExp(SHADOW.source);
  const DEPTH = /^(?:[a-z0-9-]+:)*(?:shadow-(?:lift|panel|bar|float)|inset-shadow-sunk)$/;

  it("finds a shadow when there is one", () => {
    const sample = 'className="rounded-xl shadow-sm" "md:shadow-lg" "shadow" "drop-shadow-md"';
    expect(sample.match(SHADOW)).toEqual(["shadow-sm", "md:shadow-lg", "shadow", "drop-shadow-md"]);
    expect("no shadows here, shadow-none".match(SHADOW)).toBeNull();
    expect(DEPTH.test("shadow-md")).toBe(false);
    expect(DEPTH.test("group-open:inset-shadow-sunk")).toBe(true);
  });

  // Tailwind writes a depth token's value into its class when it builds, so a value the dark
  // blocks redefined would never reach it: each token is a variable, set per theme.
  it("the depth tokens: each once, in @theme, a variable", () => {
    const defs = [...css.matchAll(/^\s*--((?:inset-)?shadow-[a-z]+):\s([^;]+);$/gm)].map(
      (m) => `${m[1]}: ${m[2]}`,
    );
    expect(defs).toEqual([
      "shadow-lift: var(--glass-drop-sm)",
      "shadow-panel: var(--glass-drop)",
      "shadow-bar: var(--float-shadow)",
      "shadow-float: var(--float-shadow)",
      "inset-shadow-sunk: var(--glass-sunk)",
    ]);
    // Phase 23's overlay variable and round 2's layers are gone.
    expect(css).not.toMatch(/--overlay:/);
  });

  it("their values: in light, and again in both dark blocks, the two darks the same", () => {
    const VARS = [
      "glass-rim",
      "glass-drop",
      "glass-drop-sm",
      "glass-sunk",
      "float-shadow",
      "button-rim",
      "tint-rim",
      "lens-shadow",
    ];
    const root = props(block(BLOCKS.root));
    const dark = props(block(BLOCKS.dark));
    const device = props(block(BLOCKS.deviceDark));
    // No drop at rest in any look (round 8: the office's since Phase 26, the casual app's since
    // 27.6); every other value a theme's own.
    const NO_DROP = ["glass-drop", "glass-drop-sm"];
    for (const v of VARS) {
      expect(root.get(v), v).toBeDefined();
      expect(dark.get(v), v).toBeDefined();
      if (NO_DROP.includes(v)) {
        expect([root.get(v), dark.get(v)], v).toEqual(["0 0 #0000", "0 0 #0000"]);
      } else expect(dark.get(v), v).not.toBe(root.get(v));
      expect(device.get(v), v).toBe(dark.get(v));
      // Light, the cookie's dark and the device's dark; and round 8's office, dark and light
      // (Phase 26): flat, an even hairline where there's one, no drop at rest.
      expect(css.match(new RegExp(`^\\s*--${v}:`, "gm")), v).toHaveLength(5);
      for (const office of [BLOCKS.officeDark, BLOCKS.officeLight])
        expect(props(block(office)).get(v), `office ${v}`).toBeDefined();
    }
  });

  it("box-shadow only in the glass's own parts and the file button, each from a variable", () => {
    const owners = [
      "@utility glass",
      "@utility glass-float",
      "@utility glass-tile",
      "@utility glass-button",
      "@utility glass-tint",
      "@utility glass-rim",
      "@utility lens",
      '  input[type="file"]::file-selector-button',
    ];
    const inOwners = owners.map((o) => body(o).match(/box-shadow:/g)?.length ?? 0);
    expect(inOwners).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(css.match(/box-shadow/g)).toHaveLength(owners.length);
    for (const value of css.matchAll(/box-shadow:\s*([^;]+);/g))
      expect(value[1], value[1]).not.toMatch(/rgb|#[0-9a-f]|color-mix/i);
  });

  const USES: Record<string, string[]> = {
    // The pass's open Details, set in (the pass itself is glass since Phase 24).
    "src/app/next-pass.tsx": ["group-open:inset-shadow-sunk"],
    // A switch's knob.
    "src/app/office/events/showing-switch.tsx": ["shadow-lift"],
    // "You're booked.": its tick.
    "src/app/shifts/open/take-shift-result.tsx": ["shadow-lift"],
  };

  it("only the depth tokens, each where it's pinned, anywhere in the app's code", () => {
    const found = uses(SHADOW);
    expect(found).toEqual(USES);
    for (const [file, list] of Object.entries(found))
      for (const use of list) expect(DEPTH.test(use), `${file}: ${use}`).toBe(true);
  });

  it("the pass is one glass section, its band gone (Phase 24; plain since 27.6; gone since 28.7); her booked day on the strip a sunk grey", () => {
    const pass = read("src/app/next-pass.tsx");
    expect(pass).toMatch(/className=\{`glass rounded-inner px-4 py-4 \$\{/);
    expect(pass).not.toMatch(/(?<![\w-])glass-band(?![\w-])/);
    expect(pass).not.toMatch(/(?<![\w-])bg-brand-bar(?![\w-])/);
    expect(css).not.toMatch(/--shadow-pass/);
    expect(css).toMatch(
      /@utility glass-band \{\s*background-image: linear-gradient\(135deg, var\(--band-from\), var\(--band-to\)\);\s*\}/,
    );
    // Flat since Phase 28 (28.1): the band's two ends are one value in every block that sets them
    // (light, both darks, the office's two, and every solid and no-blur fallback), as the tiles'
    // and the buttons' are, so no gradient shows.
    const bands = [...css.matchAll(/--band-from: ([^;]+);\s*--band-to: ([^;]+);/g)];
    expect(bands.length).toBe(css.match(/--band-from:/g)?.length);
    expect(bands.length).toBeGreaterThanOrEqual(15);
    for (const [, from, to] of bands) expect(to).toBe(from);
    expect(read("src/app/shifts/open/open-shifts-view.tsx")).toMatch(
      /booked: "bg-ink\/12 text-ink inset-ring inset-ring-white\/30"/,
    );
  });

  it("no button, field or glass part carries a shadow class of its own", () => {
    for (const [name, cls] of Object.entries({ ...btn, ...staffBtn, field, card, rows, staffCard }))
      expect(cls, name).not.toMatch(ONE_SHADOW);
  });
});

describe("where the glass goes", () => {
  it("sections are glass: the cards, lists, tables and tabs; the login cards from 640px", () => {
    for (const [name, cls] of Object.entries({
      card,
      rows,
      staffCard,
      staffRows,
      tableWrap: table.wrap,
      tabs,
    })) {
      const words = cls.split(" ");
      expect(words, name).toContain("glass");
      // Its lit rim is its edge: no hairline, no white fill under it.
      expect(cls, name).not.toMatch(/(?<![\w-])(?:border|border-line|bg-card|bg-sheet)(?![\w-])/);
    }
    for (const [name, cls] of Object.entries({ loginCard, officeLoginCard })) {
      expect(cls.split(" "), name).toEqual(expect.arrayContaining(["sm:glass", "sm:rounded-card"]));
      expect(cls, name).not.toMatch(/(?<![\w-])sm:(?:border|bg-card)(?![\w-])/);
    }
  });

  it("what floats is glass-float, each where it's pinned", () => {
    expect(uses(/(?<![\w-])(?:[a-z0-9-]+:)*glass-float(?![\w-])/g)).toEqual({
      // The top bar below 1024px, the account menu and the drawer; the search's panel. Round 8
      // (Phase 26): the rail is section glass, the counts chips, the search a flat pill and you no
      // capsule: nothing floats there at rest.
      // The dashboard's Filter menu and its date choice (Phase 26.3), and its session card over the
      // map (its error, its "nothing to fill" and itself: round 8, Phase 26.2), and To offer as
      // the list on the map (Phase 27.4).
      "src/app/office/dashboard-view.tsx": ["glass-float", "glass-float"],
      "src/app/office/dashboard/board.tsx": [
        "glass-float",
        "glass-float",
        "glass-float",
        "glass-float",
      ],
      // The map's own buttons over the streets (Phase 27.4): each one, and the zoom's pair joined.
      "src/app/office/dashboard/venue-map.tsx": ["glass-float", "glass-float"],
      "src/app/office/office-frame.tsx": ["glass-float", "glass-float", "max-lg:glass-float"],
      "src/app/office/office-search.tsx": ["glass-float"],
      "src/app/office/events/session-menu.tsx": ["glass-float"], // a session's menu
      "src/app/office/find-worker-form.tsx": ["glass-float"], // Casuals' search, its matches
      "src/app/office/shift-actions.tsx": ["glass-float"], // the "…" menu
      // Casuals (Phase 26.7): a row's "…" menu, and the sort's menu.
      "src/app/office/casuals/follow-up.tsx": ["glass-float"],
      "src/app/office/casuals/page.tsx": ["glass-float"],
      // A session's page (Phase 26.6): a row's "…" menu, the session's own, and its slide-in panel.
      "src/app/office/shifts/[id]/casual-actions.tsx": ["glass-float"],
      "src/app/office/shifts/[id]/page.tsx": ["glass-float"],
      "src/app/office/shifts/[id]/session-panel.tsx": ["glass-float"],
      "src/app/office/dashboard/offer-panel.tsx": ["glass-float"], // the offer panel
      "src/app/office/customise-panel.tsx": ["glass-float"], // Customise's panel (Phase 26.3)
      "src/app/office/updates-bell.tsx": ["glass-float"], // a cancellation's pop-up (Phase 26.4)
      // The comment that names it, and "You're booked." over the whole screen.
      "src/app/shifts/open/take-shift-result.tsx": ["glass-float", "glass-float"],
      "src/app/shifts/sheet.tsx": ["glass-float"], // the sheet from the foot
      "src/app/tab-bar.tsx": ["glass-float"], // the casual app's tab bar
      // Phase 32 (32.2, the approved mock-up): Home's map, as the office's: the pins' names and
      // the key over it; and the card over it (the comment that names it, her next shift, and
      // nothing booked), raised glass as the office's session card.
      "src/app/home/home-map.tsx": ["glass-float", "glass-float"],
      "src/app/next-pass.tsx": ["glass-float", "glass-float", "glass-float"],
      // The first-login tours (Phase 33): the walkthrough's tip, and the welcome window.
      "src/app/tour/tour.tsx": ["glass-float"],
      "src/app/tour/welcome.tsx": ["glass-float"],
    });
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /<header\s+ref=\{bar\}\s+className="@container max-lg:glass-float lg:scroll-edge sticky top-0 /,
    );
    expect(read("src/app/office/office-rail.tsx")).toMatch(/className=\{`glass sticky top-3 /);
    expect(read("src/app/office/office-search.tsx")).toMatch(
      /<div className="glass-button flex h-11 [\s\S]*data-search-panel=""[\s\S]*className="glass-float absolute /,
    );
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*glass-float/,
    );
    // The tab bar (Phase 24; Phase 28 as the office rail on its side): a floating capsule 12px
    // round, 12px from the screen's edges and over the foot (and the phone's safe area), inside a
    // bar that lets the page take taps around it.
    // (Phase 32, 32.1: the firm's mark, shown from 1024px, comes before the capsule, over the
    // rail's.)
    expect(read("src/app/tab-bar.tsx")).toMatch(
      /className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]"\s*>\s*\{firm && \([\s\S]*?data-rail-mark=""[\s\S]*?\)\}\s*<div className="glass-float pointer-events-auto mx-auto grid h-17 max-w-md grid-cols-5 gap-1 rounded-card /,
    );
    // Its current tab's icon in a round button of solid ink (the rail's lit item, Phase 32), never
    // a lens.
    expect(read("src/app/tab-bar.tsx")).toMatch(/\? "bg-ink text-on-ink"/);
  });

  it("the buttons: the main one tinted glass in the firm's colour, the others clear; each swells under a press", () => {
    for (const [name, cls] of Object.entries({
      primary: btn.primary,
      staffPrimary: staffBtn.primary,
    })) {
      expect(cls.split(" "), name).toEqual(expect.arrayContaining(["glass-tint", "press-glass"]));
      expect(cls, name).not.toMatch(/(?<![\w-])bg-(?:brand|accent)(?![\w-])/);
    }
    for (const [name, cls] of Object.entries({
      secondary: btn.secondary,
      danger: btn.danger,
      staffSecondary: staffBtn.secondary,
    }))
      expect(cls.split(" "), name).toEqual(expect.arrayContaining(["glass-button", "press-glass"]));
    // The final destructive click stays a solid red fill, with white words.
    for (const cls of [btn.dangerSolid, staffBtn.dangerSolid])
      expect(cls.split(" ")).toEqual(expect.arrayContaining(["bg-urgent-fill", "text-on-urgent"]));
    // Glass swells under a press (press-glass); cards, rows and words-only actions dip (press).
    const swell = body("@utility press-glass");
    expect(swell).toMatch(
      /&:active:not\(:disabled, \[aria-disabled="true"\]\) \{\s*scale: 1\.04;\s*filter: brightness\(1\.06\);/,
    );
    expect(btn.text.split(" ")).toContain("press");
    // Nor any main button painted another colour in the office (Phase 23's sky).
    expect(
      uses(/(?<![\w-])office:(?:[a-z-]+:)*(?:bg|border|text)-(?:accent|on-accent)[\w-]*/g),
    ).toEqual({});
    // Never both on one thing: they'd fight over its size under a press.
    const both = CODE.flatMap((file) =>
      [...read(file).matchAll(/"[^"\n]*"|`[^`]*`/g)]
        .map((m) => m[0])
        .filter(
          (l) => /(?<![\w:-])press(?![\w-])/.test(l) && /(?<![\w-])press-glass(?![\w-])/.test(l),
        )
        .map((l) => `${file}: ${l}`),
    );
    expect(both).toEqual([]);
  });

  it("the chosen tab or option is the lens, on a glass track", () => {
    expect(tabCurrent.split(" ")).toContain("lens");
    expect(tab.split(" ")).not.toContain("lens");
    expect(switchTrack.split(" ")).toContain("glass-track");
    expect(read("src/app/my-shifts-view.tsx")).toMatch(/"lens font-semibold text-ink"/);
  });

  // Phase 24 (24.4): the events board and its open seats went with the event cards, so no solid
  // card fill is left anywhere.
  it("no white boxes left: no solid card fill anywhere", () => {
    expect(uses(/(?<![\w-])(?:[a-z0-9-]+:)*bg-(?:card|sheet)(?![\w-])/g)).toEqual({});
  });

  it("the office's page has no card of its own: its sections are glass on the plain ground", () => {
    const frame = read("src/app/office/office-frame.tsx").replace(/^\s*\{?\/[/*].*$/gm, "");
    const page = /id="main"[\s\S]*?<div className="([^"]+)">/.exec(frame)?.[1];
    expect(page).toBe("flex-1");
  });

  it("no card anywhere keeps the old heavy dark frame", () => {
    const heavy = CODE.filter((file) => /(?<![\w-])border-2 border-ink(?![\w-])/.test(read(file)));
    expect(heavy).toEqual([]);
  });

  it("office controls: no 2px border on a button, a field or the frame", () => {
    for (const [name, classes] of Object.entries({ ...btn, field }))
      expect(classes.split(" "), name).not.toContain("border-2");
    expect(read("src/app/office/office-frame.tsx")).not.toMatch(/(?<![\w-])border-2(?![\w-])/);
  });
});
