import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  BarsBody,
  ChartCard,
  ColumnsBody,
  Dot,
  Mark,
  OffersBody,
  Panel,
  TimelineBody,
} from "@/lib/office/dashboard-charts";

// The dashboard's charts and the office's top bar as the browser gets them, for what WCAG asks of
// content that shows on hover or focus and of focus itself (the Phase 23 review, findings 12 to
// 16, and the second review): a chart's tooltip takes the pointer, with a bridge over the gap on
// the side facing its mark, sits beside a row of bars so it never covers the next row, and passes
// a click on it to what's under it (tests/e2e/office.dashboard.spec.ts moves onto it, presses
// Escape, goes from one row to the next and clicks); a link in the panel to a
// place on this page lands focus on that place, a heading focus can be put on; a licence's name
// near the end of the 8 weeks sits to the left of its dot, so it never runs past the card; the
// sticky top bar never hides what the keyboard moves to (the office's scroll padding, in place of
// each heading's own margin); and the light or dark switch's words take the pointer too, with
// their own bridge. tests/unit/office.dashboard.test.ts checks the whole page.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { DashboardCharts, NAME_FLIP_PCT, tipBeside, tipSpot } =
  await import("@/app/office/dashboard/charts");
const { PanelView, placeOnPage } = await import("@/app/office/dashboard/chart-panel");
const { ThemeButton } = await import("@/app/office/theme-button");
const { CHART_IDS, CHART_TITLES } = await import("@/lib/office/dashboard-charts");

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const panel: Panel = {
  title: "Sat 24 Oct: 2 places to fill",
  sub: null,
  error: null,
  groups: [],
  foot: [],
};
const mark = (key: string, value: string, label: string): Mark => ({
  key,
  aria: `${value} ${label}`,
  tip: { value, label },
  panel,
});
const card = (id: string, title: string, body: ChartCard["body"]): ChartCard => ({
  id,
  title,
  wide: false,
  error: false,
  take: "One sentence from the data.",
  empty: null,
  legend: [],
  body,
  tables: [],
  hint: null,
  swipe: null,
  notes: [],
});
const columns: ColumnsBody = {
  kind: "columns",
  max: 4,
  ticks: [2, 4],
  end: false,
  columns: [
    {
      key: "2026-10-24",
      top: "Sat",
      bottom: "24",
      now: false,
      dim: false,
      segments: [{ tone: "open", value: 2 }],
      total: 2,
      full: false,
      mark: mark(`${CHART_IDS.places}:2026-10-24`, "2 places to fill.", "Sat 24 Oct."),
    },
  ],
};
const dot = (key: string, x: number, lane: number, name: string | null): Dot => ({
  key,
  x,
  lane,
  tone: name ? "urgent" : "calm",
  big: name !== null,
  name,
  mark: mark(`${CHART_IDS.licences}:${key}`, "Runs out Fri 18 Dec.", `${name ?? "Sam Taylor"}.`),
});
const timeline = (dots: Dot[]): TimelineBody => ({ kind: "timeline", lanes: 2, ticks: [], dots });
const words = { section: "This couldn't load.", count: "Couldn't load" };
const charts = (cards: ChartCard[]) =>
  renderToStaticMarkup(createElement(DashboardCharts, { charts: cards, words }));

describe("a chart's tooltip (WCAG 1.4.13: it can be hovered)", () => {
  it("takes the pointer, with an 8px bridge on the side facing its mark", () => {
    const html = charts([card(CHART_IDS.places, CHART_TITLES.places, columns)]);
    const tip = /<div role="tooltip" hidden="" class="([^"]*)"><\/div>/.exec(html)?.[1];
    expect(tip).toBe(
      "fixed top-0 left-0 z-50 w-max max-w-64 animate-pop rounded-row bg-ink px-3 py-2 text-sm text-on-ink shadow-float before:absolute before:inset-0 data-[side=above]:before:-bottom-2 data-[side=below]:before:-top-2 data-[side=left]:before:-right-2 data-[side=right]:before:-left-2",
    );
    expect(tip).not.toMatch(/pointer-events-none/);
    // The bridge: the tooltip's own box, and 8px (-2: 0.5rem) more on the side facing its mark,
    // for each of the four sides tipSpot and tipBeside give, and on no other side.
    const bridge = (tip ?? "").split(" ").filter((c) => c.includes("before:"));
    expect(bridge).toEqual([
      "before:absolute",
      "before:inset-0",
      "data-[side=above]:before:-bottom-2",
      "data-[side=below]:before:-top-2",
      "data-[side=left]:before:-right-2",
      "data-[side=right]:before:-left-2",
    ]);
    // The mark it belongs to: a button named by the tooltip's words.
    expect(html).toContain(
      '<button type="button" data-col="2026-10-24" aria-label="2 places to fill. Sat 24 Oct." aria-haspopup="dialog"',
    );
  });

  it("a click on it goes on to what's under it, and a press on it leaves focus where it is", () => {
    // The browser's half: tests/e2e/office.dashboard.spec.ts clicks on a row's tooltip and checks
    // it's gone and the click reached what's under it. Here, the handler's steps in order: out of
    // the way first, so what's under the pointer is found, then the click with the same keys.
    const src = read("src/app/office/dashboard/charts.tsx");
    const passOn = /const passOn = [\s\S]*?\n {2}};\n/.exec(src)?.[0] ?? "";
    const steps = [
      "e.currentTarget.hidden = true;",
      "hide();",
      "document.elementFromPoint(e.clientX, e.clientY)?.dispatchEvent(",
      'new window.MouseEvent("click", {',
    ];
    const at = steps.map((s) => passOn.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const key of ["ctrlKey", "shiftKey", "altKey", "metaKey", "clientX", "clientY", "button"])
      expect(passOn).toContain(`${key}: e.${key},`);
    expect(src).toContain("onMouseDown={(e) => e.preventDefault()}\n        onClick={passOn}");
  });

  it("sits 8px over its mark (the bridge's height), or 8px under it with no room above", () => {
    const box = { width: 120, height: 50 };
    // Room above: centred over it, 8px clear; the bridge hangs from its foot.
    const over = { left: 600, top: 300, bottom: 348, width: 24 };
    expect(tipSpot(over, box, 1280)).toEqual({ left: 552, top: 242, side: "above" });
    expect(over.top - (242 + box.height)).toBe(8);
    // No room above (within 8px of the window's top): under it, 8px clear; the bridge sits on its
    // head.
    const high = { left: 600, top: 40, bottom: 88, width: 24 };
    expect(tipSpot(high, box, 1280)).toEqual({ left: 552, top: 96, side: "below" });
    expect(96 - high.bottom).toBe(8);
    // Never within 8px of the window's sides, and still over some of its mark.
    expect(tipSpot({ left: 0, top: 300, bottom: 348, width: 24 }, box, 1280).left).toBe(8);
    expect(tipSpot({ left: 1260, top: 300, bottom: 348, width: 20 }, box, 1280).left).toBe(1152);
    expect(1152 + box.width).toBeGreaterThan(1260);
  });

  // A row of bars spans its card and the next row is 4px away: over or under it, the tooltip
  // would sit on the next row and catch the pointer and the click meant for it.
  describe("beside a row of bars, never over the row above or below", () => {
    const box = { width: 256, height: 60 };
    const view = { width: 1280, height: 800 };
    // A row 48px tall in the left half of the charts at 1280px.
    const row = { left: 372, right: 760, top: 400, height: 48 };
    const clear = (r: typeof row, at: { left: number }) =>
      at.left >= r.right ? at.left - r.right : r.left - (at.left + box.width);

    it("to its right, 8px clear (the bridge's width), level with its middle", () => {
      const at = tipBeside(row, box, view);
      expect(at).toEqual({ left: 768, top: 394, side: "right" });
      expect(clear(row, at)).toBe(8);
      expect(at.top + box.height / 2).toBe(row.top + row.height / 2);
      // So none of it is over the rows above or below (each spans the same width).
      expect(at.left).toBeGreaterThan(row.right);
      // Whole pixels.
      expect(tipBeside({ ...row, right: 760.4, top: 400.3 }, box, view)).toEqual(at);
    });

    it("to its left when there's no room on the right (the right half), the bridge on its right", () => {
      // The last place it fits on the right: its right edge 8px in from the window's.
      const fits = { ...row, right: view.width - 8 - box.width - 8 };
      expect(tipBeside(fits, box, view)).toEqual({ left: 1016, top: 394, side: "right" });
      expect(1016 + box.width).toBe(view.width - 8);
      // A pixel further and it flips to the left, 8px clear.
      const flips = { ...row, right: fits.right + 1 };
      expect(tipBeside(flips, box, view)).toEqual({ left: 108, top: 394, side: "left" });
      expect(clear(flips, { left: 108 })).toBe(8);
      // A row in the right half at 1280px.
      const right = { left: 820, right: 1208, top: 400, height: 48 };
      const at = tipBeside(right, box, view);
      expect(at).toEqual({ left: 556, top: 394, side: "left" });
      expect(clear(right, at)).toBe(8);
      expect(at.left + box.width).toBeLessThan(right.left);
    });

    it("never within 8px of the window's edges", () => {
      // A row at the window's top or foot: as near its middle as the window allows.
      expect(tipBeside({ ...row, top: 0 }, box, view).top).toBe(8);
      expect(tipBeside({ ...row, top: -30 }, box, view).top).toBe(8);
      expect(tipBeside({ ...row, top: 780 }, box, view).top).toBe(view.height - 8 - box.height);
      // No room on either side (a narrow window, the row nearly as wide): on the side with more
      // room, 8px in from that edge.
      const narrow = { width: 768, height: 800 };
      expect(tipBeside({ ...row, left: 40, right: 744 }, box, narrow)).toEqual({
        left: 8,
        top: 394,
        side: "left",
      });
      expect(tipBeside({ ...row, left: 24, right: 728 }, box, narrow)).toEqual({
        left: 768 - 8 - box.width,
        top: 394,
        side: "right",
      });
      // A window narrower than the tooltip: still 8px in from its left edge.
      expect(tipBeside({ ...row, left: 10, right: 230 }, box, { width: 240, height: 800 })).toEqual(
        { left: 8, top: 394, side: "right" },
      );
    });

    it("a row of bars says so (data-tip), and only a row: columns, dots and the offers' key don't", () => {
      const tip = (key: string) => mark(key, "3 places to fill.", "Riverside Fair.");
      const bar = (key: string) => ({
        key,
        name: `Event ${key}`,
        sub: null,
        hidden: false,
        segments: [{ tone: "open" as const, value: 3 }],
        total: 3,
        mark: tip(`${CHART_IDS.events}:${key}`),
      });
      const bars: BarsBody = { kind: "bars", max: 4, rows: [bar("e1"), bar("e2")] };
      const offers: OffersBody = {
        kind: "offers",
        total: 4,
        aria: "4 offers this week.",
        keys: [
          { key: "yes", tone: "done", label: "Said yes", n: 2, pct: 50, mark: tip("offers:yes") },
          { key: "waiting", tone: "wait", label: "Waiting", n: 2, pct: 50, mark: tip("offers:w") },
          { key: "closed", tone: "calm", label: "Said no or closed", n: 0, pct: 0, mark: null },
        ],
        waiting: { kind: "bars", max: 4, rows: [bar("s1")] },
        waitingMore: null,
      };
      const html = charts([
        card(CHART_IDS.places, CHART_TITLES.places, columns),
        card(CHART_IDS.events, CHART_TITLES.events, bars),
        card(CHART_IDS.offers, CHART_TITLES.offers, offers),
        card(CHART_IDS.licences, CHART_TITLES.licences, timeline([dot("c1", 10, 0, "Ben")])),
      ]);
      const marks = [...html.matchAll(/<button type="button"[^>]*aria-haspopup="dialog"[^>]*>/g)];
      // A day, two events, two of the offers' key, a session still waiting, a licence.
      expect(marks).toHaveLength(7);
      // Each row's own: the two events, then the session still waiting (after the offers' key).
      expect(marks.map((m) => m[0].includes(' data-tip="beside"'))).toEqual([
        false,
        true,
        true,
        false,
        false,
        true,
        false,
      ]);
      expect(html.match(/data-tip=/g)).toHaveLength(3);
    });
  });
});

describe("a link in the panel to a place on this page (WCAG 2.4.3: focus goes with it)", () => {
  it("knows a place on this page from a page", () => {
    expect(placeOnPage("#waited-chart")).toBe("waited-chart");
    expect(placeOnPage("#urgent-places")).toBe("urgent-places");
    expect(placeOnPage("/office/pay-queries")).toBeNull();
    expect(placeOnPage("/office/needs-attention#to-mark")).toBeNull();
    expect(placeOnPage("#")).toBeNull();
    expect(placeOnPage(null)).toBeNull();
  });

  it("'See how long things have waited' goes to the waited chart's heading, which focus can be put on", () => {
    const go = renderToStaticMarkup(
      createElement(PanelView, {
        panel: {
          ...panel,
          foot: [{ label: "See how long things have waited", href: `#${CHART_IDS.waited}` }],
        },
      }),
    );
    const href = /<a href="([^"]*)"[^>]*>See how long things have waited<\/a>/.exec(go)?.[1];
    expect(href).toBe("#waited-chart");
    const place = placeOnPage(href ?? null);
    const html = charts([
      card(CHART_IDS.places, CHART_TITLES.places, columns),
      card(CHART_IDS.waited, CHART_TITLES.waited, columns),
    ]);
    // Each chart's heading: where a link lands, and focus with it (out of the Tab order).
    const headings = [...html.matchAll(/<h2 id="([^"]+)" tabindex="-1" class="([^"]*)">/g)];
    expect(headings.map((m) => m[1])).toEqual(["places-chart", "waited-chart"]);
    expect(headings.map((m) => m[1])).toContain(place);
    for (const m of headings) expect(m[2]).not.toMatch(/scroll-mt/);
    expect(html.match(/<h2\b/g)).toHaveLength(2);
    // The urgent places' heading too (tests/unit/office.dashboard.test.ts renders the page).
    expect(read("src/app/office/dashboard-view.tsx")).toContain(
      '<h2 id="urgent-places" tabIndex={-1} className="text-lg font-bold tracking-heading text-ink">',
    );
  });
});

describe("a licence's name on the 8 weeks (it never runs past the card)", () => {
  // The name beside a booked dot (from 640px), by what it says.
  const nameOf = (html: string, name: string) =>
    new RegExp(`<span aria-hidden="true" style="([^"]*)" class="([^"]*)">${name}</span>`).exec(
      html,
    );

  it("to the right of its dot early on; to its left past 60% along", () => {
    expect(NAME_FLIP_PCT).toBe(60);
    const html = charts([
      card(
        CHART_IDS.licences,
        CHART_TITLES.licences,
        timeline([
          dot("c1", 10, 0, "Ben Example"),
          dot("c2", 60, 1, "Omar Price"),
          dot("c3", 61, 0, "Zoe Example"),
          dot("c4", 98, 1, "Priya Shah"),
          dot("c5", 99, 0, null),
        ]),
      ),
    ]);
    const NAME = "absolute hidden %s translate-y-1/2 text-sm font-bold whitespace-nowrap";
    const right = `pointer-events-none ${NAME.replace("%s", "translate-x-4")} text-ink sm:block`;
    const left = `pointer-events-none ${NAME.replace("%s", "-translate-x-4")} text-ink sm:block`;
    // At x=10: from the dot's centre, 16px on, to the right.
    expect(nameOf(html, "Ben Example")?.slice(1)).toEqual(["left:10%;bottom:56px", right]);
    // At 60% exactly it still fits to the right.
    expect(nameOf(html, "Omar Price")?.slice(1)).toEqual(["left:60%;bottom:86px", right]);
    // Past 60%: its right edge 16px before the dot's centre, so it reads leftwards.
    expect(nameOf(html, "Zoe Example")?.slice(1)).toEqual(["right:39%;bottom:56px", left]);
    // At x=98, near the end of the 8 weeks: on the left.
    expect(nameOf(html, "Priya Shah")?.slice(1)).toEqual(["right:2%;bottom:86px", left]);
    // A dot with no booking after it runs out has no name.
    expect(html.match(/whitespace-nowrap text-ink sm:block/g)).toHaveLength(4);
  });
});

describe("the office's sticky top bar never hides what the keyboard moves to (WCAG 2.4.11)", () => {
  const css = read("src/app/globals.css");

  it("the page scrolls a focused control or a link's place 80px under the window's top", () => {
    expect(css).toContain('html:has([data-shell="office"]) {\n  scroll-padding-top: 5rem;\n}');
    expect(css.match(/scroll-padding/g)).toHaveLength(1);
    // 80px: the bar's height (56px, 64px from 1024px) and a 16px step.
    const frame = read("src/app/office/office-frame.tsx");
    const bar = /<header className="sticky top-0 [^"]*">/.exec(frame)?.[0] ?? "";
    expect(bar).toMatch(/(?<![\w-])min-h-14(?![\w-])/);
    const tallest = Number(/(?<![\w-])lg:min-h-(\d+)(?![\w-])/.exec(bar)?.[1]) * 4;
    const padding = Number(/scroll-padding-top: (\d+)rem;/.exec(css)?.[1]) * 16;
    expect([tallest, padding]).toEqual([64, 80]);
    expect(padding).toBe(tallest + 16);
    // The shell the rule looks for.
    expect(frame).toContain('<div data-shell="office"');
  });

  it("so no office heading or section adds its own margin on top (a link would land twice as low)", () => {
    for (const file of [
      "src/app/office/dashboard-view.tsx",
      "src/app/office/dashboard/charts.tsx",
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
      /^<span class="group\/tip relative flex shrink-0"><button type="button" aria-label="Switch to dark mode" disabled="" class="peer press inline-flex size-11 [^"]*">.*?<\/button><span aria-hidden="true" data-theme-tip="" class="([^"]*)">Switch to dark mode<\/span><\/span>$/,
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
