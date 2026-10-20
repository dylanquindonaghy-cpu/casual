import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { btn, card, field, loginCard, rows, table } from "@/app/ui/classes";

// Phase 17's flat look (PLAN.md 17.1; docs/ui-design.md): nothing on a page has a shadow at rest.
// Only the two layers that float over the page keep one, so they read as above it: the office's
// account menu (a popover) and an event session's menu. Office controls (buttons, fields, the
// Menu button) have a 1px border; the casual app's keep 2px, for thumbs.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
const SOURCE = files("src").filter((f) => /\.(tsx?|css)$/.test(f));

// A shadow utility in a class (shadow, shadow-sm, md:shadow-lg, shadow-[…], drop-shadow-…), or
// a box-shadow in CSS. shadow-none takes one away, so it's allowed.
const SHADOW =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:drop-)?shadow(?:-(?!none(?![\w-]))[\w[\]#/.()%,-]+)?(?![\w-])|box-shadow/g;
const FLOATING: Record<string, number> = {
  "src/app/office/office-frame.tsx": 1, // the account menu (popover)
  "src/app/office/events/session-menu.tsx": 1, // a session's menu (absolute, over the list)
};

describe("flat: no shadows at rest", () => {
  it("finds a shadow when there is one", () => {
    const sample = 'className="rounded-xl shadow-sm" "md:shadow-lg" "shadow" "drop-shadow-md"';
    expect(sample.match(SHADOW)).toEqual(["shadow-sm", "md:shadow-lg", "shadow", "drop-shadow-md"]);
    expect("no shadows here, shadow-none".match(SHADOW)).toBeNull();
  });

  it("only the two floating menus have one, anywhere in src/", () => {
    const counts = Object.fromEntries(
      SOURCE.map((file) => [file, read(file).match(SHADOW)?.length ?? 0] as const).filter(
        ([, n]) => n > 0,
      ),
    );
    expect(counts).toEqual(FLOATING);
  });

  it("each of those sits over the page", () => {
    expect(read("src/app/office/office-frame.tsx")).toMatch(
      /popover="auto"\s+className="[^"]*shadow-sm/,
    );
    expect(read("src/app/office/events/session-menu.tsx")).toMatch(
      /className="absolute [^"]*shadow-md/,
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
