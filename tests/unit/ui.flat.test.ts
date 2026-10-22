import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { btn, card, field, loginCard, rows, staffCard, staffRows, table } from "@/app/ui/classes";

// Depth (Phase 20; docs/ui-design.md "Depth"), in place of Phase 17's flat look: the page, cards
// lifted off it, then the pass and what floats over the page. Five depth tokens in
// src/app/globals.css and no other shadow anywhere: no Tailwind shadow size, no shadow written
// into a class, no box-shadow in a component. Each file's use is pinned here, so a new one is a
// choice. Phase 21: the office has one depth token of its own (`soft`: its white cards and what
// floats over its page) and uses no other. Office controls (buttons, fields, the Menu button) have
// a 1px border; the casual app's keep 1.5px, for thumbs.

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
// The five depth tokens, and the office's one (Phase 21), as utilities (with any variant before
// them).
const DEPTH = /^(?:[a-z0-9-]+:)*(?:shadow-(?:lift|panel|pass|bar|soft)|inset-shadow-sunk)$/;
const USES: Record<string, string[]> = {
  "src/app/home-view.tsx": ["shadow-lift"], // the For you tiles
  "src/app/my-shifts-view.tsx": ["shadow-lift"], // the switch's current half
  // The pass; its three buttons; an open Details set in.
  "src/app/next-pass.tsx": ["group-open:inset-shadow-sunk", "shadow-lift", "shadow-pass"],
  // A count card under the pointer, the empty urgent list, this week's card.
  "src/app/office/dashboard-view.tsx": ["hover:shadow-soft", "shadow-soft", "shadow-soft"],
  // The board, its current filter.
  "src/app/office/events/page.tsx": ["shadow-soft", "shadow-soft"],
  "src/app/office/events/session-menu.tsx": ["shadow-soft"], // a session's menu, over the list
  // You and the moon/sun button at the menu's foot (from 1024px); the account menu (a popover).
  "src/app/office/office-frame.tsx": ["lg:shadow-soft", "shadow-soft"],
  // The skeletons' white cards, as the page's.
  "src/app/office/office-skeleton.tsx": ["shadow-soft", "shadow-soft", "shadow-soft"],
  "src/app/office/shift-actions.tsx": ["shadow-soft"], // an urgent place's "…" menu
  "src/app/office/theme-button.tsx": ["shadow-soft"], // its words beside it
  // The urgent places' list on the dashboard, and an answer floating at the foot of the screen.
  "src/app/office/urgent-places.tsx": ["shadow-soft", "shadow-soft"],
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
  // The switch's track; the office's card, list card and table.
  "src/app/ui/classes.ts": ["inset-shadow-sunk", "shadow-soft", "shadow-soft", "shadow-soft"],
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
      "shadow-soft",
    ]) {
      expect(css.match(new RegExp(`^\\s*--${token}: [^;]+;$`, "gm")), token).toHaveLength(3);
    }
    expect(css).not.toMatch(/box-shadow/);
  });

  it("what floats over the office's page takes its one token (Phase 21; the panel's until then)", () => {
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*shadow-soft/,
    );
    expect(read("src/app/office/events/session-menu.tsx")).toMatch(
      /className="absolute [^"]*shadow-soft/,
    );
    expect(read("src/app/office/shift-actions.tsx")).toMatch(
      /className="absolute [^"]*shadow-soft/,
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

  // Phase 21: the office's white cards take its one depth token, whose ring is their hairline (a
  // border or a shadow, never both).
  it("the office's card, list card and table: the soft token, and no border of their own", () => {
    for (const [name, classes] of Object.entries({ card, rows, tableWrap: table.wrap })) {
      const words = classes.split(" ");
      expect(words, name).toContain("shadow-soft");
      expect(words, name).toContain("rounded-card");
      expect(words, name).not.toContain("border");
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
