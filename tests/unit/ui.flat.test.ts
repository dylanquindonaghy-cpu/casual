import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  btn,
  card,
  field,
  loginCard,
  officeLoginCard,
  rows,
  staffCard,
  staffRows,
  table,
} from "@/app/ui/classes";

// Depth (Phase 20; docs/ui-design.md "Depth"), in place of Phase 17's flat look: the page, cards
// lifted off it, then the pass and what floats over the page. Five depth tokens in
// src/app/globals.css and no other shadow anywhere: no Tailwind shadow size, no shadow written
// into a class, no box-shadow in a component. Each file's use is pinned here, so a new one is a
// choice. Phase 21: the office has one depth token of its own (`soft`: its white cards and what
// floats over its page) and uses no other. Phase 22 (the office's round 2, Dylan: "no depth to any
// of the individual sections"): four more of its own, each a layer: `raise` (a button, a row, a
// tile raised off a card), `float` (what floats over the page), `sheet` (the page set into the
// window) and `tint` (the dashboard's colour cards); grooves take the casual app's `sunk`. Phase 23
// (round 3, Dylan: "it needs to be modern"): the office is flat. Nothing in it has depth at rest
// (no card, row, button, field, groove or page), and one soft overlay (`float`) sits only under
// what floats over its page: the account menu and the drawer, the "…" menus, the toast, a chart's
// tooltip and its panel. Its white surfaces have a 1px hairline instead. Office controls (buttons,
// fields, the Menu button) have a 1px border; the casual app's keep 1.5px, for thumbs.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
const SOURCE = files("src").filter((f) => /\.(tsx?|css)$/.test(f));

// A shadow utility in a class (shadow, shadow-sm, md:shadow-lg, inset-shadow-…, shadow-[…],
// drop-shadow-…), or a box-shadow in CSS. shadow-none takes one away, so it's allowed.
const SHADOW =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:drop-|inset-)?shadow(?:-(?!none(?![\w-]))[\w[\]#/.()%,-]+)?(?![\w-])|box-shadow/g;
// The same, to test one string (a global pattern remembers where it stopped).
const ONE_SHADOW = new RegExp(SHADOW.source);
// The five depth tokens, and the office's one (Phase 23), as utilities (with any variant before
// them).
const DEPTH = /^(?:[a-z0-9-]+:)*(?:shadow-(?:lift|panel|pass|bar|float)|inset-shadow-sunk)$/;
const USES: Record<string, string[]> = {
  "src/app/home-view.tsx": ["shadow-lift"], // the For you tiles
  "src/app/my-shifts-view.tsx": ["shadow-lift"], // the switch's current half
  // The pass; its three buttons; an open Details set in.
  "src/app/next-pass.tsx": ["group-open:inset-shadow-sunk", "shadow-lift", "shadow-pass"],
  // The office (Phase 23): only what floats over its page. A chart's panel (a side panel from
  // 1024px, a sheet from the foot on a phone) and its tooltip.
  "src/app/office/dashboard/chart-panel.tsx": ["shadow-float"],
  "src/app/office/dashboard/charts.tsx": ["shadow-float"],
  "src/app/office/events/session-menu.tsx": ["shadow-float"], // a session's menu, over the list
  "src/app/office/office-frame.tsx": ["shadow-float", "shadow-float"], // the account menu; the drawer
  "src/app/office/shift-actions.tsx": ["shadow-float"], // the "…" menu
  "src/app/office/urgent-places.tsx": ["shadow-float"], // an answer floating at the foot (the toast)
  "src/app/shifts/[id]/shift-view.tsx": ["shadow-bar", "shadow-lift"], // Take shift's bar
  "src/app/shifts/booked-view.tsx": ["shadow-lift"],
  "src/app/shifts/cancel-shift.tsx": [
    "has-checked:inset-shadow-sunk",
    "shadow-lift",
    "shadow-lift",
  ],
  "src/app/shifts/open/open-shift-card.tsx": ["shadow-lift"],
  // The strip's days, and her booked day.
  "src/app/shifts/open/open-shifts-view.tsx": [
    "shadow-lift",
    "shadow-lift",
    "shadow-lift",
    "shadow-pass",
  ],
  "src/app/shifts/shift-parts.tsx": ["inset-shadow-sunk", "shadow-lift"],
  "src/app/tab-bar.tsx": ["shadow-bar"],
  // The casual app's switch track (`switchTrack`); none of the office's strings (Phase 23).
  "src/app/ui/classes.ts": ["inset-shadow-sunk"],
};

describe("depth: the five tokens, and no other shadow", () => {
  it("finds a shadow when there is one", () => {
    const sample = 'className="rounded-xl shadow-sm" "md:shadow-lg" "shadow" "drop-shadow-md"';
    expect(sample.match(SHADOW)).toEqual(["shadow-sm", "md:shadow-lg", "shadow", "drop-shadow-md"]);
    expect("no shadows here, shadow-none".match(SHADOW)).toBeNull();
    expect("lg:shadow-lift inset-shadow-sunk shadow-pass".match(SHADOW)).toEqual([
      "lg:shadow-lift",
      "inset-shadow-sunk",
      "shadow-pass",
    ]);
    expect(DEPTH.test("shadow-md")).toBe(false);
    expect(DEPTH.test("has-checked:inset-shadow-sunk")).toBe(true);
  });

  it("only the depth tokens, each where it's pinned, anywhere in src/", () => {
    const found = Object.fromEntries(
      SOURCE.map((file) => [file, (read(file).match(SHADOW) ?? []).sort()] as const).filter(
        ([, m]) => m.length > 0,
      ),
    );
    expect(found).toEqual(USES);
    for (const [file, uses] of Object.entries(found))
      for (const use of uses) expect(DEPTH.test(use), `${file}: ${use}`).toBe(true);
  });

  it("the tokens: defined once in light and again in both dark blocks, nowhere else", () => {
    const css = read("src/app/globals.css");
    const defs = (token: string) => css.match(new RegExp(`^\\s*--${token}:\\s[^;]+;$`, "gm"));
    // A long value wraps onto the lines under its name. The office's overlay is `--overlay`
    // (Phase 23), the value `shadow-float` takes.
    for (const token of [
      "shadow-lift",
      "shadow-panel",
      "shadow-pass",
      "shadow-bar",
      "inset-shadow-sunk",
      "overlay",
    ])
      expect(defs(token), token).toHaveLength(3);
    // Round 2's layers (Phase 22) are gone: nothing in the office has depth at rest.
    for (const token of ["shadow-soft", "shadow-raise", "shadow-sheet", "shadow-tint"])
      expect(defs(token), token).toBeNull();
    expect(css).not.toMatch(/box-shadow/);
  });

  // Tailwind writes a depth token's value into its class when it builds, so a value redefined in
  // the dark blocks never reaches the class (dark drew light's until Phase 23): `float` takes a
  // variable, and only the variable changes with the theme.
  it("the office's one overlay: a soft fall and a hairline ring, darker in dark (Phase 23)", () => {
    const css = read("src/app/globals.css");
    expect(css.match(/^\s*--shadow-float:\s[^;]+;$/gm)).toEqual([
      "  --shadow-float: var(--overlay);",
    ]);
    const values = [...css.matchAll(/^\s*--overlay:\s([^;]+);$/gm)].map((m) => m[1]!);
    expect(values).toEqual([
      "0 16px 40px -16px rgb(16 24 40 / 0.22), 0 0 0 1px rgb(16 24 40 / 0.06)",
      "0 16px 40px -16px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.08)",
      "0 16px 40px -16px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.08)",
    ]);
    // In the @theme block, then the cookie's dark block, then the device's.
    const at = (text: string) => css.indexOf(text);
    expect(at("--overlay: 0 16px 40px -16px rgb(16 24 40")).toBeLessThan(
      at(':root[data-theme="dark"] {'),
    );
    expect(css.slice(at(':root[data-theme="dark"] {'))).toMatch(
      /^:root\[data-theme="dark"\] \{[^}]*--overlay: 0 16px 40px -16px rgb\(0 0 0 \/ 0\.7\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{[^}]*--overlay: 0 16px 40px -16px rgb\(0 0 0 \/ 0\.7\)/,
    );
    // No lit edge (round 2's white inset line) anywhere.
    expect(css).not.toMatch(/inset 0 1px 0 rgb\(255 255 255/);
  });

  it("what floats over the office's page takes `float` (Phase 22; `soft` in 21, the panel's before)", () => {
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*shadow-float/,
    );
    expect(read("src/app/office/events/session-menu.tsx")).toMatch(
      /className="absolute [^"]*shadow-float/,
    );
    expect(read("src/app/office/shift-actions.tsx")).toMatch(
      /className="absolute [^"]*shadow-float/,
    );
  });

  it("the office flat (Phase 23): buttons and fields with no depth, the page a white card", () => {
    // The office's buttons dip when pressed and carry no depth; nor do its fields.
    const office = /const office =\s+"([^"]+)";/.exec(read("src/app/ui/classes.ts"))?.[1] ?? "";
    expect(office.split(" ")).toContain("press");
    expect(office).not.toMatch(ONE_SHADOW);
    for (const [name, cls] of Object.entries(btn))
      expect(cls, `btn.${name}`).not.toMatch(ONE_SHADOW);
    expect(field).not.toMatch(ONE_SHADOW);
    // The page card (`#main > div`): white, a 1px hairline, 28px round from 1024px (22px on a
    // phone), with no depth and no grain. (The frame's comments left out: they name the page's
    // id too.)
    const frame = read("src/app/office/office-frame.tsx").replace(/^\s*\/\/.*$/gm, "");
    const pageCard = /id="main"[\s\S]*?<div className="([^"]+)">/.exec(frame)?.[1] ?? "";
    const words = pageCard.split(" ");
    expect(words, pageCard).toEqual(
      expect.arrayContaining([
        "bg-card",
        "border",
        "border-line",
        "rounded-inner",
        "lg:rounded-card",
      ]),
    );
    expect(words.filter((w) => /^(?:[a-z0-9-]+:)*rounded-/.test(w)).sort(), pageCard).toEqual([
      "lg:rounded-card",
      "rounded-inner",
    ]);
    expect(pageCard).not.toMatch(ONE_SHADOW);
    expect(pageCard).not.toMatch(/(?<![\w-])grain/);
  });

  it("the pass alone (and the booked day on the strip) takes the pass token", () => {
    expect(read("src/app/next-pass.tsx")).toMatch(
      /className=\{`[^`]*rounded-3xl bg-brand-bar[^`]*shadow-pass/,
    );
    expect(read("src/app/shifts/open/open-shifts-view.tsx")).toMatch(
      /booked: "bg-brand text-on-brand shadow-pass"/,
    );
  });
});

describe("cards: one hairline", () => {
  it("the casual app's cards and list cards, and the login card: a 1px border in the line colour", () => {
    for (const [name, classes] of Object.entries({
      staffCard,
      staffRows,
      loginCard,
    })) {
      const words = classes.split(" ").map((c) => c.replace(/^sm:/, ""));
      expect(words, name).toContain("border");
      expect(words, name).toContain("border-line");
      expect(classes, name).not.toMatch(/(?<![\w-])border-(?:2|4|ink)(?![\w-])/);
    }
  });

  // Phase 23 (round 3): the office's white cards inside its white page card have a hairline of
  // their own, 22px round, and no depth (round 2's ring was a depth token; a border or a depth,
  // never both).
  it("the office's card, list card and table: a 1px hairline, 22px round, and no depth", () => {
    for (const [name, classes] of Object.entries({ card, rows, tableWrap: table.wrap })) {
      const words = classes.split(" ");
      expect(words, name).toContain("border");
      expect(words, name).toContain("border-line");
      expect(words, name).toContain("rounded-inner");
      expect(classes, name).not.toMatch(ONE_SHADOW);
    }
    // The office's login card, from 640px: the same hairline, no depth.
    expect(officeLoginCard.split(" ")).toEqual(
      expect.arrayContaining(["sm:border", "sm:border-line", "sm:bg-card", "sm:rounded-card"]),
    );
    expect(officeLoginCard).not.toMatch(ONE_SHADOW);
  });

  it("no card anywhere keeps the old heavy dark frame", () => {
    const heavy = SOURCE.filter((file) =>
      /(?<![\w-])border-2 border-ink(?![\w-])/.test(read(file)),
    );
    expect(heavy).toEqual([]);
  });
});

describe("office controls: a 1px border", () => {
  it("every office button and field", () => {
    for (const [name, classes] of Object.entries({ ...btn, field })) {
      expect(classes.split(" "), name).not.toContain("border-2");
    }
  });

  it("the office frame (its Menu button and account menu)", () => {
    expect(read("src/app/office/office-frame.tsx")).not.toMatch(/(?<![\w-])border-2(?![\w-])/);
  });
});
