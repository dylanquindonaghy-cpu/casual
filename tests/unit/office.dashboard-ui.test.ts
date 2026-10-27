import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The dashboard and the office's top bar as the browser gets them, for what WCAG asks of content
// that shows on hover or focus and of focus itself (the Phase 23 review, findings 12 to 16, and
// the second review; Phase 24's dashboard): the places chart's tips take the pointer, with a
// bridge over the gap to their bar, and Escape puts them away (tests/e2e/office.dashboard.spec.ts
// moves onto one and presses Escape); the sticky top bar never hides what the keyboard moves to
// (the office's scroll padding, in place of each heading's own margin); and the light or dark
// switch's words take the pointer too, with their own bridge. tests/unit/office.board.test.ts
// checks the whole page.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { PlacesChart } = await import("@/app/office/dashboard/places-chart");
const { ThemeButton } = await import("@/app/office/theme-button");

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the places chart's tips (WCAG 1.4.13: hoverable, persistent, dismissible)", () => {
  const days = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(2 + i).padStart(2, "0")}`,
    toOffer: i === 3 ? 2 : 0,
    offered: i === 3 ? 1 : 0,
  }));
  const html = renderToStaticMarkup(createElement(PlacesChart, { days, today: "2026-11-02" }));
  const tips = [...html.matchAll(/<span data-bar-tip="" class="([^"]*)">([^<]*)<\/span>/g)];

  it("one per day, its numbers in words, shown under a fine pointer over its day", () => {
    expect(tips.map((t) => t[2])).toHaveLength(14);
    expect(tips[3]?.[2]).toBe("Thu 5: 2 to offer, 1 offered");
    for (const [, cls] of tips) {
      expect(cls).toMatch(/(?<![\w:-])hidden(?![\w-])/);
      expect(cls).toContain("pointer-fine:group-hover/bar:block");
    }
    // Each sits in its day's column (the hover's group), so the pointer can move onto it.
    expect(html.match(/<div data-day="[^"]+" class="group\/bar relative/g)).toHaveLength(14);
  });

  it("takes the pointer, with a bridge over the 8px between it and its day", () => {
    for (const [, cls] of tips) {
      expect(cls).not.toMatch(/pointer-events-none/);
      expect(cls).toContain("bottom-full");
      expect(cls).toContain("mb-2");
      expect(cls).toContain("before:absolute before:inset-x-0 before:top-full before:h-2");
    }
  });

  it("Escape puts it away until the pointer moves to another day (data-away on the chart's plot)", () => {
    for (const [, cls] of tips) expect(cls).toContain("in-data-[away]:hidden!");
    expect(html).toMatch(/<div aria-hidden="true" class="mt-4 grid min-h-44 /);
    const tips_ = read("src/app/office/dashboard/hover-tips.tsx");
    expect(tips_).toContain('if (e.key !== "Escape") return;');
    expect(tips_).toContain('data-away={away === null ? undefined : ""}');
    expect(tips_).toContain("onPointerLeave={() => setAway(null)}");
  });
});

describe("the office's sticky top bar never hides what the keyboard moves to (WCAG 2.4.11)", () => {
  const css = read("src/app/globals.css");

  it("the page scrolls a focused control or a link's place 80px under the window's top", () => {
    expect(css).toContain('html:has([data-shell="office"]) {\n  scroll-padding-top: 5rem;\n}');
    expect(css.match(/scroll-padding/g)).toHaveLength(1);
    // 80px: the bar's height and a 12px step. Below 1024px the bar is 56px; from there (Phase 24)
    // it's its 48px capsules with 12px above them and 8px below: 68px.
    const frame = read("src/app/office/office-frame.tsx");
    const search = read("src/app/office/office-search.tsx");
    const bar = /<header\s+ref=\{bar\}\s+className="([^"]*)"/.exec(frame)?.[1] ?? "";
    expect(bar).toMatch(/(?<![\w-])sticky top-0(?![\w-])/);
    const px = (re: RegExp, s: string) => Number(re.exec(s)?.[1]) * 4;
    const phone = px(/(?<![\w:-])min-h-(\d+)(?![\w-])/, bar);
    // The capsules: the search 48px tall; the counts' and your pills 40px in 4px of capsule.
    expect(search).toContain('className="glass-float flex h-12 ');
    expect(frame).toContain("press-glass flex h-10 items-center");
    expect(frame).toMatch(/lg:glass-float lg:gap-1 lg:rounded-full lg:p-1/);
    const wide =
      px(/(?<![\w-])lg:pt-(\d+)(?![\w-])/, bar) + 48 + px(/(?<![\w-])lg:pb-(\d+)(?![\w-])/, bar);
    const padding = Number(/scroll-padding-top: (\d+)rem;/.exec(css)?.[1]) * 16;
    expect([phone, wide, padding]).toEqual([56, 68, 80]);
    expect(padding).toBe(Math.max(phone, wide) + 12);
    // The shell the rule looks for.
    expect(frame).toMatch(/<div\s+data-shell="office"/);
  });

  it("so no office heading or section adds its own margin on top (a link would land twice as low)", () => {
    for (const file of [
      "src/app/office/dashboard-view.tsx",
      "src/app/office/dashboard/board.tsx",
      "src/app/office/dashboard/places-chart.tsx",
      "src/app/office/shifts/[id]/page.tsx",
      "src/app/office/guide/guide-view.tsx",
      "src/app/office/casuals/[id]/upload-checks.tsx",
    ])
      expect(read(file), file).not.toMatch(/scroll-mt-/);
    // The places they land on are still there.
    expect(read("src/app/office/shifts/[id]/page.tsx")).toContain(
      '<h2 id="assign" className={h2}>',
    );
    expect(read("src/app/office/casuals/[id]/upload-checks.tsx")).toContain(
      '<section className={card} aria-labelledby="uploads-heading" id="uploads">',
    );
    // Outside the office's shell: the help page's contents, and the notice report's table, which
    // scrolls inside itself, keep theirs.
    expect(read("src/app/help/help-view.tsx")).toContain("scroll-mt-4");
    expect(read("src/app/office/reports/notice/page.tsx")).toContain("scroll-pt-12");
  });
});

describe("the top bar's light or dark switch: its words (WCAG 1.4.13: they can be hovered)", () => {
  it("show under the pointer over the button or the words, with an 8px bridge between them", () => {
    const html = renderToStaticMarkup(
      createElement(ThemeButton, { initial: "light", look: "square" }),
    );
    expect(html).toMatch(
      /^<span class="group\/tip relative flex shrink-0"><button type="button" aria-label="Switch to dark mode" disabled="" class="peer press-glass max-lg:glass-button inline-flex size-11 [^"]*">.*?<\/button><span aria-hidden="true" data-theme-tip="" class="([^"]*)">Switch to dark mode<\/span><\/span>$/,
    );
    const tip = /data-theme-tip="" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(tip).toBe(
      "absolute top-full right-0 z-30 mt-2 hidden animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-x-0 before:-top-2 before:h-2 peer-focus-visible:block pointer-fine:group-hover/tip:block",
    );
    // It takes the pointer; the bridge fills the 8px gap (mt-2) above it exactly.
    expect(tip).not.toMatch(/pointer-events-none/);
    expect(tip).not.toMatch(/peer-hover/);
    // The account menu's row keeps its words beside the icon: nothing to hover.
    const row = renderToStaticMarkup(createElement(ThemeButton, { initial: "dark" }));
    expect(row).toMatch(/^<button type="button" disabled="" class="press flex min-h-11 [^"]*">/);
    expect(row).toContain("Switch to light mode</button>");
    expect(row).not.toContain("data-theme-tip");
  });
});
