import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefractionFilter } from "@/app/glass-refraction";
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
import { GLASS, SATURATE, WASH, type Rgb, type Rgba } from "@/lib/tenancy/glass-grounds";
import { BLOCKS, block, colourTokens, css, parseColour, props } from "../helpers/theme-css";

// Liquid Glass (Phase 24, round 7 of the Design canvas, Dylan: "keep round 7 and build it into the
// app"; docs/ui-design.md "Phase 24: Liquid Glass"), in place of Phase 23's flat look (white cards
// with hairlines, ui.flat.test.ts until now). One look for the office and the casual app: a pastel
// wash fixed behind every page, and on it glass. A section (a card, a list, a table, a row of tabs)
// is frosted (`glass`: it blurs and saturates what's behind it, with a lit rim and a soft drop);
// what floats over the page is the strongest glass (`glass-float`: the office's top bar, menus,
// the drawer, a chart's panel, the casual app's tab bar, Take shift's bar, the sheet), bending
// what's behind it a little in Chrome; the parts inside a section are clear glass that doesn't blur
// again (`glass-tile`, `glass-button`); the one main button is tinted glass in the firm's colour
// (`glass-tint`); the chosen tab or option is a lens of bright glass (`lens`) on a glass track.
// Each value is pinned here, and src/lib/tenancy/glass-grounds.ts holds the same numbers (the
// contrast test, tests/unit/ui.contrast.test.ts, works every word out over them). Where someone
// asks for less transparency or more contrast, every ground is solid and the wash goes; where a
// browser can't blur, every ground is solid too. Depth is the glass's rim and drop, through
// variables, so the dark theme's reach the classes; no other shadow anywhere.

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
  it("the wash: its base and four lights, in light and both darks", () => {
    const lights = ["wash-a", "wash-b", "wash-c", "wash-d"];
    expect(theme().get("canvas")).toBe(written(WASH.light.base));
    const root = props(block(BLOCKS.root));
    expect(lights.map((l) => root.get(l))).toEqual(WASH.light.lights.map(written));
    for (const [name, pattern] of DARKS) {
      const dark = props(block(pattern));
      expect(dark.get("color-canvas"), name).toBe(written(WASH.dark.base));
      expect(
        lights.map((l) => dark.get(l)),
        name,
      ).toEqual(WASH.dark.lights.map(written));
    }
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

  it("a section and what floats blur and saturate it by SATURATE; the bar's edge a little less", () => {
    const root = props(block(BLOCKS.root));
    expect(root.get("glass-filter")).toBe(`blur(24px) saturate(${SATURATE})`);
    expect(root.get("float-filter")).toBe(`blur(18px) saturate(${SATURATE})`);
    expect(root.get("edge-filter")).toBe("blur(10px) saturate(1.6)");
    // The dark blocks keep light's: only the fills change.
    for (const [, pattern] of DARKS) expect(block(pattern)).not.toMatch(/-filter:/);
  });

  it("the wash: four soft lights fixed behind every page, under everything", () => {
    const wash = body("  body::before", "@layer base");
    for (const line of [
      'content: "";',
      "position: fixed;",
      "inset: 0;",
      "z-index: -1;",
      "pointer-events: none;",
    ])
      expect(wash).toContain(line);
    expect(
      [...wash.matchAll(/radial-gradient\([^)]*var\(--(wash-[a-d])\)/g)].map((m) => m[1]),
    ).toEqual(["wash-a", "wash-b", "wash-c", "wash-d"]);
    // The page's own ground is the wash's base (the root layout's <body>), and no shell paints
    // over the wash (the office's frame and the casual app's bar did, until Phase 24).
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
    expect(read("src/app/office/dashboard/board.tsx")).toMatch(
      /<section\s+aria-labelledby="chosen-title"\s+data-chosen=\{s\.shiftId\}\s+className="glass [\s\S]*?<ShiftActions/,
    );
  });

  it("glass-float: what floats, the strongest; in Chrome it bends what's behind, never otherwise", () => {
    const float = body("@utility glass-float");
    expect(float).toContain("background-color: var(--color-panel);");
    expect(float).toContain("-webkit-backdrop-filter: var(--float-filter);");
    expect(float).toContain("box-shadow: var(--float-shadow);");
    expect(float).toMatch(/\.rf & \{\s*backdrop-filter: url\(#lg-refract\) var\(--float-filter\);/);
    expect(float).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\s*\.rf & \{\s*backdrop-filter: none;/,
    );
    // The bending only there.
    expect(css.match(/url\(#lg-refract\)/g)).toHaveLength(1);
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
    expect(tint).toContain("color: var(--color-on-tint);");
    expect(tint).toMatch(
      /box-shadow:\s*var\(--tint-rim\),\s*0 8px 22px color-mix\(in srgb, var\(--color-tint\) 32%, transparent\);/,
    );
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

  it("the bending: one filter in the root layout with a fixed, large region, switched on only in Chromium", () => {
    const svg = renderToStaticMarkup(RefractionFilter());
    expect(svg).toMatch(/^<svg aria-hidden="true" focusable="false"/);
    expect(svg).toContain(
      '<filter id="lg-refract" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="8000" height="8000" color-interpolation-filters="sRGB">',
    );
    for (const part of [
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="11" result="noise"',
      '<feGaussianBlur in="noise" stdDeviation="2" result="soft"',
      '<feDisplacementMap in="SourceGraphic" in2="soft" scale="18" xChannelSelector="R" yChannelSelector="G"',
    ])
      expect(svg).toContain(part);
    const source = read("src/app/glass-refraction.tsx");
    expect(source).toContain('data?.brands?.some((b) => b.brand === "Chromium")');
    expect(source).toContain('document.documentElement.classList.add("rf");');
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/<body[^>]*>\s*<RefractionFilter \/>\s*<GlassRefraction \/>/);
  });

  it("nothing blurs but the glass, a table's sticky headings and the bars' edges", () => {
    // Declarations only (the @supports test below names it too): a section's, what floats' (and
    // its bending, and that switched off), the top bar's edge and the foot's (a shift's Take
    // shift, Phase 24); each with Safari's prefix but the two that only Chrome reads.
    expect(css.match(/^\s+backdrop-filter:/gm)).toHaveLength(6);
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

  it("less transparency or more contrast: every one solid, in light and both darks; no blur, no wash", () => {
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
    const solid = props(block(BLOCKS.solid));
    for (const f of ["glass-filter", "float-filter", "edge-filter"])
      expect(solid.get(f)).toBe("none");
    expect(css).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{[\s\S]*?body::before \{\s*display: none;\s*\}\s*\}/,
    );
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
    for (const v of VARS) {
      expect(root.get(v), v).toBeDefined();
      expect(dark.get(v), v).toBeDefined();
      expect(dark.get(v), v).not.toBe(root.get(v));
      expect(device.get(v), v).toBe(dark.get(v));
      expect(css.match(new RegExp(`^\\s*--${v}:`, "gm")), v).toHaveLength(3);
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
      expect(
        value[1]!.replace(/color-mix\(in srgb, var\(--color-tint\) 32%, transparent\)/, ""),
        value[1],
      ).not.toMatch(/rgb|#[0-9a-f]/i);
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

  it("the pass is one glass card with its warm band (Phase 24); her booked day on the strip a sunk grey", () => {
    const pass = read("src/app/next-pass.tsx");
    expect(pass).toMatch(/className=\{`glass overflow-hidden rounded-3xl \$\{/);
    expect(pass).toMatch(/<div className="glass-band px-5 /);
    expect(pass).not.toMatch(/(?<![\w-])bg-brand-bar(?![\w-])/);
    expect(css).not.toMatch(/--shadow-pass/);
    expect(css).toMatch(
      /@utility glass-band \{\s*background-image: linear-gradient\(135deg, var\(--band-from\), var\(--band-to\)\);\s*\}/,
    );
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
      // The comments that name it, then (Phase 24): the counts' capsule, the account menu, the
      // drawer, you (from 1024px) and the top bar (below 1024px); the rail; the search's capsule
      // and its panel.
      "src/app/glass-refraction.tsx": ["glass-float"],
      "src/app/office/office-frame.tsx": [
        "glass-float",
        "glass-float",
        "glass-float",
        "lg:glass-float",
        "max-lg:glass-float",
      ],
      "src/app/office/office-rail.tsx": ["glass-float"],
      "src/app/office/office-search.tsx": ["glass-float", "glass-float"],
      "src/app/office/events/session-menu.tsx": ["glass-float"], // a session's menu
      "src/app/office/find-worker-form.tsx": ["glass-float"], // Casuals' search, its matches
      "src/app/office/shift-actions.tsx": ["glass-float"], // the "…" menu
      "src/app/office/dashboard/offer-panel.tsx": ["glass-float"], // the offer panel
      // The comment that names it, and "You're booked." over the whole screen.
      "src/app/shifts/open/take-shift-result.tsx": ["glass-float", "glass-float"],
      "src/app/shifts/sheet.tsx": ["glass-float"], // the sheet from the foot
      "src/app/tab-bar.tsx": ["glass-float"], // the casual app's tab bar
    });
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /<header\s+ref=\{bar\}\s+className="@container max-lg:glass-float lg:scroll-edge sticky top-0 /,
    );
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /data-bar-counts=""\s+className="glass-float /,
    );
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /<div className="flex shrink-0 items-center [^"]*lg:glass-float /,
    );
    expect(read("src/app/office/office-rail.tsx")).toMatch(
      /className=\{`glass-float sticky top-3 /,
    );
    expect(read("src/app/office/office-search.tsx")).toMatch(
      /<div className="glass-float flex h-12 [\s\S]*data-search-panel=""[\s\S]*className="glass-float absolute /,
    );
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*glass-float/,
    );
    // The tab bar (Phase 24): a floating capsule 14px above the foot, inside a bar that lets the
    // page take taps around it.
    expect(read("src/app/tab-bar.tsx")).toMatch(
      /className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-\[calc\(0\.875rem\+env\(safe-area-inset-bottom\)\)\]"\s*>\s*<div className="glass-float pointer-events-auto mx-auto grid h-17 max-w-md grid-cols-4 gap-1 rounded-full /,
    );
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

  it("the office's page has no card of its own: its sections are glass on the wash", () => {
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
