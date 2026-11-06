import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as classes from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { Plate } from "@/app/ui/plate";
import { Slip } from "@/app/ui/slip";
import { payCountWords, profileCountWords, TabBar } from "@/app/tab-bar";

// Phase 28 (28.1; docs/ui-design.md "Phase 28"; docs/screens.md "The casual app, Phase 28"): the
// casual app takes the office's corners, flat colours, chips and headings through the shared parts.
// The new shared classes (`tag`, `slip` with its `disc`, `emptyBox`, `staffChoice`) use the token
// corners only; no class string in src/app/ui uses an arbitrary corner, a gradient or the pass's
// band; the casual app's own sizes stay; PageHeader's "Updated 21:35"; and the tab bar's two new
// counts (Profile's answers and Pay's), with their words.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const UI = readdirSync(join(ROOT, "src/app/ui"))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => `src/app/ui/${f}`);
// Comments are words, not classes.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const CLASSES = classes as unknown as Record<string, string | Record<string, string>>;
const strings = (value: string | Record<string, string>) =>
  typeof value === "string" ? [value] : Object.values(value);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// A corner utility with its variants (`sm:`, `office:`): rounded, rounded-t-row, rounded-[14px].
const RADIUS =
  /(?<![\w[-])(?:[a-z0-9/[\]&=_-]+:)*rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl))?(?:-([a-z0-9]+|\[[^\]]+\]))?(?![\w-])/g;
const TOKEN_CORNERS = new Set(["card", "inner", "row", "full", "none", "mark"]);

describe("the new shared classes (src/app/ui/classes.ts)", () => {
  const NEW = { tag: classes.tag, emptyBox: classes.emptyBox, staffChoice: classes.staffChoice };

  it("finds what it checks: the corner pattern sees arbitrary corners and Tailwind's own", () => {
    const sample = '"rounded-[14px] rounded-2xl sm:rounded-card rounded office:rounded-row"';
    expect([...sample.matchAll(RADIUS)].map((m) => m[1] ?? "")).toEqual([
      "[14px]",
      "2xl",
      "card",
      "",
      "row",
    ]);
  });

  it("tag, slip (and its disc), emptyBox and staffChoice use the token corners only", () => {
    const all = [
      ...Object.values(NEW),
      ...Object.values(classes.slip),
      ...Object.values(classes.disc),
    ];
    for (const cls of all)
      for (const m of cls.matchAll(RADIUS))
        expect(TOKEN_CORNERS.has(m[1] ?? ""), `${cls}: ${m[0]}`).toBe(true);
    expect(classes.tag.split(" ")).toContain("rounded-full");
    expect(classes.slip.base.split(" ")).toContain("rounded-row");
    expect(classes.disc.base.split(" ")).toContain("rounded-full");
    expect(classes.emptyBox.split(" ")).toContain("rounded-row");
    expect(classes.staffChoice.split(" ")).toContain("rounded-row");
  });

  it("a tag: a glass pill of facts, ink words, 28px; never a status's colour", () => {
    expect(classes.tag.split(" ")).toEqual(
      expect.arrayContaining(["glass-button", "min-h-7", "px-3", "py-1", "text-sm", "text-ink"]),
    );
    expect(classes.tag).not.toMatch(/(?<![\w-])(?:bg|text)-(?:urgent|attention|wait|done|quiet)/);
  });

  it("a slip: each status's tint and 1px line, 8px round, ink words; led by the round disc", () => {
    const TONES = ["urgent", "attention", "wait", "done", "quiet"] as const;
    expect(Object.keys(classes.slip)).toEqual(["base", ...TONES]);
    expect(Object.keys(classes.disc)).toEqual(["base", ...TONES]);
    expect(classes.slip.base.split(" ")).toEqual(
      expect.arrayContaining(["rounded-row", "border", "text-ink", "flex", "gap-3"]),
    );
    for (const t of TONES) expect(classes.slip[t]).toBe(`border-${t}-line bg-${t}-soft`);
    expect(classes.disc.base.split(" ")).toEqual(
      expect.arrayContaining(["size-8", "rounded-full", "shrink-0"]),
    );
    // <Slip> puts the two together: the disc first (decorative, the tone's own icon), then the
    // words, which say the status.
    const html = renderToStaticMarkup(
      createElement(
        Slip,
        { tone: "done", title: "Sent", role: "status" },
        "We've told the office.",
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `^<div role="status" data-slip="done" class="${classes.slip.base} ${classes.slip.done}"><span aria-hidden="true" class="${classes.disc.base} ${classes.disc.done}"><svg aria-hidden="true"`,
      ),
    );
    expect(text(html)).toBe("Sent We've told the office.");
    // With no role it's plain words (no live region of its own).
    expect(renderToStaticMarkup(createElement(Slip, { tone: "quiet" }, "No signal."))).toMatch(
      /^<div data-slip="quiet" class="/,
    );
  });

  it("the one empty state: clear glass, 8px round, grey words; no dashed frame", () => {
    expect(classes.emptyBox.split(" ")).toEqual(
      expect.arrayContaining(["glass-tile", "rounded-row", "text-ink-muted", "text-base"]),
    );
    expect(classes.emptyBox).not.toMatch(/(?<![\w-])(?:border-2|border-dashed)(?![\w-])/);
  });

  it("a choice card: 8px glass, 56px; only the chosen one has the 2px ink edge (no shift when chosen)", () => {
    const words = classes.staffChoice.split(" ");
    expect(words).toEqual(
      expect.arrayContaining([
        "glass-tile",
        "rounded-row",
        "min-h-14",
        "border-2",
        "border-transparent",
        "has-checked:border-ink",
        "has-checked:bg-active",
      ]),
    );
    // The ink edge only when chosen: never at rest.
    expect(words).not.toContain("border-ink");
    expect(words).not.toContain("border-line-strong");
  });
});

describe("src/app/ui: no arbitrary corner, no gradient, no band", () => {
  it("no class string in a shared part has an arbitrary corner (rounded-[…]) or Tailwind's own sizes", () => {
    const found = UI.flatMap((file) =>
      [...code(read(file)).matchAll(RADIUS)]
        .filter((m) => !TOKEN_CORNERS.has(m[1] ?? "") || m[0].endsWith("rounded"))
        .map((m) => `${file}: ${m[0]}`),
    );
    expect(found).toEqual([]);
    // The class strings themselves, every one.
    for (const [name, value] of Object.entries(CLASSES))
      for (const cls of strings(value))
        for (const m of cls.matchAll(RADIUS))
          expect(TOKEN_CORNERS.has(m[1] ?? ""), `${name}: ${m[0]}`).toBe(true);
  });

  it("no gradient and no glass band in any shared part", () => {
    const gradient =
      /(?:repeating-)?(?:linear|radial|conic)-gradient|(?<![\w-])bg-(?:linear|radial|conic|gradient)-|(?<![\w-])(?:from|via|to)-[a-z]+-\d|(?<![\w-])glass-band(?![\w-])/;
    const found = UI.filter((file) => gradient.test(code(read(file))));
    expect(found).toEqual([]);
    expect(UI.length).toBeGreaterThanOrEqual(10);
  });

  it("the casual app's own sizes stay: 52px buttons, 56px fields, 18px words in a field", () => {
    for (const cls of Object.values(classes.staffBtn)) expect(cls.split(" ")).toContain("min-h-13");
    expect(classes.staffField.split(" ")).toEqual(
      expect.arrayContaining(["min-h-14", "text-lg", "rounded-row"]),
    );
    expect(classes.staffCard.split(" ")).toEqual(
      expect.arrayContaining(["glass", "rounded-inner"]),
    );
    expect(classes.staffRows.split(" ")).toEqual(
      expect.arrayContaining(["glass", "rounded-inner"]),
    );
    // The section heading 18px semibold; the count beside it the office's pill.
    expect(classes.staffH2).toBe("text-lg font-semibold tracking-heading text-ink");
    expect(classes.staffCount).toBe(classes.count);
    // The opener of a destructive step: dark red words, the office's grey wash under the pointer.
    expect(classes.staffBtn.danger.split(" ")).toEqual(
      expect.arrayContaining(["text-urgent-ink", "hover:bg-button-hover", "min-h-13"]),
    );
    expect(classes.staffBtn.danger.split(" ")).not.toContain("hover:bg-urgent-soft");
    // A tappable row's wash is the rail's; the switch's track has the glass's hairline.
    expect(classes.tapRow.split(" ")).toContain("hover:bg-active");
    expect(classes.switchTrack.split(" ")).toEqual(
      expect.arrayContaining(["glass-track", "glass-rim", "rounded-full"]),
    );
    // A status plate is round.
    const plate = renderToStaticMarkup(Plate({ tone: "brand", children: "New" }));
    expect(plate).toMatch(/class="[^"]*(?<![\w-])rounded-full(?![\w-])/);
    expect(plate).not.toMatch(/class="[^"]*(?<![\w-])rounded (?![\w-])/);
  });

  it("the firm's mark: 36px, 8px round, bold (32px and semibold above the office's login)", () => {
    const bar = read("src/app/brand-bar.tsx");
    expect(bar).toMatch(
      /data-testid="brand-mark"\s+className="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-bold text-on-brand-bar office:size-8 office:font-semibold"/,
    );
  });
});

describe("PageHeader's Updated, as the office's (Phase 28)", () => {
  it("beside the headline on its baseline, shown online only; the office's empty place unchanged", () => {
    const stamped = renderToStaticMarkup(
      createElement(PageHeader, { title: "Hi Zoe", updated: "Updated 21:35" }),
    );
    expect(stamped).toMatch(
      /<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 office:flex-1 office:basis-80"><h1 class="text-title text-balance text-ink">Hi Zoe<\/h1><small data-updated-slot="" data-online-only="" class="text-xs text-ink-faint tabular-nums">Updated 21:35<\/small><\/div>/,
    );
    // Its lines go under the two, on a line of their own.
    const lines = renderToStaticMarkup(
      createElement(PageHeader, { title: "Booked shifts", updated: "Updated 21:35" }, "2 shifts"),
    );
    expect(lines).toContain('</small><div class="mt-2 basis-full">');
    // Without it (every office page, and casual pages that don't pass one): as before.
    const plain = renderToStaticMarkup(createElement(PageHeader, { title: "Shifts" }));
    expect(plain).toContain(
      '<div class="office:flex office:min-w-0 office:flex-1 office:basis-80 office:flex-wrap office:items-baseline office:gap-x-3"><h1 class="text-title text-balance text-ink">Shifts</h1><small data-updated-slot="" class="text-xs text-ink-faint tabular-nums"></small></div>',
    );
  });

  it("the headline is semibold and a little tight in both apps, at each app's size", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(
      /@utility text-title \{[^}]*font-size: var\(--text-3xl\);[^}]*font-weight: 600;\s*letter-spacing: -0\.025em;/,
    );
    // The casual app's 28px headline, the office's 30px.
    expect(css).toMatch(/--text-3xl: 1\.75rem;/);
    expect(css).toMatch(/body:has\(\[data-office\]\) \{[^}]*--text-3xl: 1\.875rem;/);
  });
});

describe("the tab bar's counts (docs/screens.md 'The casual app, Phase 28')", () => {
  const render = (props: Parameters<typeof TabBar>[0]) =>
    renderToStaticMarkup(createElement(TabBar, props));
  const nameOf = (html: string, href: string) =>
    /aria-label="([^"]*)"/.exec(
      new RegExp(`<a [^>]*href="${href}"[^>]*>`).exec(html)?.[0] ?? "",
    )?.[1];

  it("Profile: what needs doing and her new answers, in words; the number is the two added", () => {
    expect(`Profile, ${profileCountWords(1, 1)}`).toBe(
      "Profile, 1 thing needs doing and 1 new answer",
    );
    expect(profileCountWords(2, 3)).toBe("2 things need doing and 3 new answers");
    expect(profileCountWords(1)).toBe("1 thing needs doing");
    expect(profileCountWords(0, 1)).toBe("1 new answer");
    expect(profileCountWords(0, 2)).toBe("2 new answers");
    const both = render({ current: "home", profileCount: 1, answersCount: 1 });
    expect(nameOf(both, "/profile")).toBe("Profile, 1 thing needs doing and 1 new answer");
    // The number is the two added; pale amber while something needs doing.
    expect(both).toMatch(
      /<span aria-hidden="true" data-profile-count="" class="[^"]*bg-hivis[^"]*">2<\/span>/,
    );
    // Answers alone: in the firm's colour, as Messages' replies.
    const answers = render({ current: "home", answersCount: 2 });
    expect(nameOf(answers, "/profile")).toBe("Profile, 2 new answers");
    expect(answers).toMatch(
      /<span aria-hidden="true" data-profile-count="" class="[^"]*glass-tint[^"]*">2<\/span>/,
    );
  });

  it("Pay: payroll's new answers, in the firm's colour, with their words", () => {
    expect(`Pay, ${payCountWords(1)}`).toBe("Pay, 1 new answer from payroll");
    expect(payCountWords(2)).toBe("2 new answers from payroll");
    const pay = render({ current: "pay", payCount: 1 });
    expect(nameOf(pay, "/pay")).toBe("Pay, 1 new answer from payroll");
    expect(pay).toMatch(
      /<span aria-hidden="true" data-pay-count="" class="[^"]*glass-tint[^"]*">1<\/span>/,
    );
    // On the current (ink) tab the count is set off by an edge of the page's own ground.
    expect(pay).toMatch(/data-pay-count="" class="[^"]* outline-2 outline-canvas /);
  });

  it("a zero count shows no number and no words; today's callers (no new counts) don't change", () => {
    const none = render({ current: "home", profileCount: 0, answersCount: 0, payCount: 0 });
    expect(none).not.toMatch(/data-(?:profile|messages|pay)-count/);
    expect(none).not.toMatch(/<a [^>]*aria-label=/);
    // Today's callers pass needs and replies only: Profile's words and Messages' as before.
    const today = render({ current: "home", profileCount: 2, messagesCount: 1 });
    expect(nameOf(today, "/profile")).toBe("Profile, 2 things need doing");
    expect(nameOf(today, "/messages")).toBe("Messages, 1 new reply");
    expect(nameOf(today, "/pay")).toBeUndefined();
    // A count below zero is none.
    expect(render({ current: "home", answersCount: -1 })).not.toContain("data-profile-count");
  });

  it("works without JavaScript and in the mini bar: plain links, every word kept for screen readers", () => {
    const html = render({ current: "profile", profileCount: 1, answersCount: 1, payCount: 2 });
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/",
      "/shifts",
      "/messages",
      "/pay",
      "/profile",
    ]);
    expect(html).not.toMatch(/<button|onclick/i);
    expect(html.match(/\[html\[data-tabs-mini\]_&amp;\]:sr-only/g)).toHaveLength(5);
  });
});
