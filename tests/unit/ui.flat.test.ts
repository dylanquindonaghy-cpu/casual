import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { btn, card, field, loginCard, rows, table } from "@/app/ui/classes";

// Depth (Phase 20; docs/ui-design.md "Depth"), in place of Phase 17's flat look: the page, cards
// lifted off it, then the pass and what floats over the page. Five depth tokens in
// src/app/globals.css and no other shadow anywhere: no Tailwind shadow size, no shadow written
// into a class, no box-shadow in a component. Each file's use is pinned here, so a new one is a
// choice. Office controls (buttons, fields, the Menu button) have a 1px border; the casual app's
// keep 1.5px, for thumbs.

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
// The five depth tokens, as utilities (with any variant before them).
const DEPTH = /^(?:[a-z0-9-]+:)*(?:shadow-(?:lift|panel|pass|bar)|inset-shadow-sunk)$/;
const USES: Record<string, string[]> = {
  "src/app/home-view.tsx": ["shadow-lift"], // the For you tiles
  "src/app/my-shifts-view.tsx": ["shadow-lift"], // the switch's current half
  // The pass; its three buttons; an open Details set in.
  "src/app/next-pass.tsx": ["group-open:inset-shadow-sunk", "shadow-lift", "shadow-pass"],
  "src/app/office/dashboard-view.tsx": ["shadow-lift", "shadow-lift", "shadow-panel"],
  // The board (a panel), its current filter, the filters' track.
  "src/app/office/events/page.tsx": ["inset-shadow-sunk", "shadow-lift", "shadow-panel"],
  "src/app/office/events/session-menu.tsx": ["shadow-panel"], // a session's menu, over the list
  "src/app/office/events/sessions-table.tsx": ["inset-shadow-sunk"], // the opened row, set in
  "src/app/office/needs-items.tsx": ["shadow-lift"], // each item on its panel
  // The page's sheet on the frame (from 1024px); the account menu (a popover).
  "src/app/office/office-frame.tsx": ["lg:shadow-lift", "shadow-panel"],
  "src/app/office/office-nav.tsx": ["shadow-lift", "shadow-lift"], // the firm, the current link
  "src/app/office/shift-actions.tsx": ["shadow-panel"], // an urgent place's "…" menu
  // An urgent place's row on the dashboard, and its answer floating at the foot of the screen.
  "src/app/office/urgent-places.tsx": ["shadow-lift", "shadow-panel"],
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
  "src/app/ui/classes.ts": ["inset-shadow-sunk"], // the switch's track
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
    for (const token of [
      "shadow-lift",
      "shadow-panel",
      "shadow-pass",
      "shadow-bar",
      "inset-shadow-sunk",
    ]) {
      expect(css.match(new RegExp(`^\\s*--${token}: [^;]+;$`, "gm")), token).toHaveLength(3);
    }
    expect(css).not.toMatch(/box-shadow/);
  });

  it("what floats over the page takes the panel token", () => {
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*shadow-panel/,
    );
    expect(read("src/app/office/events/session-menu.tsx")).toMatch(
      /className="absolute [^"]*shadow-panel/,
    );
    expect(read("src/app/office/shift-actions.tsx")).toMatch(
      /className="absolute [^"]*shadow-panel/,
    );
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
  it("every shared card, list card, table and the login card: a 1px border in the line colour", () => {
    for (const [name, classes] of Object.entries({
      card,
      rows,
      tableWrap: table.wrap,
      loginCard,
    })) {
      const words = classes.split(" ").map((c) => c.replace(/^sm:/, ""));
      expect(words, name).toContain("border");
      expect(words, name).toContain("border-line");
      expect(classes, name).not.toMatch(/(?<![\w-])border-(?:2|4|ink)(?![\w-])/);
    }
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
