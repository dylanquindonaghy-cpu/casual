import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Plate } from "@/app/ui/plate";
import { Seats, SEATS_MAX } from "@/app/ui/seats";
import { DateTile, SignPlate } from "@/app/ui/sign";

// Phase 18's shared parts (src/app/ui/sign.tsx, plate.tsx; docs/ui-design.md "Phase 18") and its
// motion (src/app/globals.css): the date tile, the sign plate, the seats and the status plate as
// the screens use them; every animation from the design's spec (150, 200 or 250ms, one easing,
// CSS only), each one the app uses defined, and a 150ms fade in their place for anyone whose
// device asks for less motion.

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

describe("the date tile", () => {
  it("a small raised card: the weekday, the day in sign figures, the month; one image for screen readers, or none", () => {
    const named = html(
      createElement(DateTile, {
        dow: "Sat",
        day: "24",
        month: "Oct",
        size: "lg",
        label: "Saturday 24 October",
      }),
    );
    expect(named).toMatch(/^<span role="img" aria-label="Saturday 24 October" class="/);
    // Phase 20: on the raised grey, not an ink band.
    expect(named).toMatch(/^<span[^>]*class="[^"]*\bbg-raised text-ink\b/);
    expect(named).toContain('<span class="block font-medium text-sm">Sat</span>');
    // The large tile's day is 30px, in the sign font.
    expect(named).toMatch(/<span class="block font-sign leading-tight text-3xl">24<\/span>/);
    expect(named).toContain('<span class="block text-xs text-ink-muted">Oct</span>');
    // Without a label it sits beside words that say the date: hidden from screen readers.
    const plain = html(createElement(DateTile, { dow: "Thu", day: "22" }));
    expect(plain).toMatch(/^<span aria-hidden="true" class="/);
    expect(plain).toContain("text-2xl");
    expect(plain).not.toContain("Oct");
    // Urgent: the whole tile pale red, with the urgent words.
    const urgent = html(
      createElement(DateTile, { dow: "Thu", day: "22", month: "Oct", urgent: true }),
    );
    expect(urgent).toContain("bg-urgent-tile text-urgent-ink");
    expect(urgent).toContain('<span class="block text-xs text-urgent-ink">Oct</span>');
    expect(urgent).not.toContain("bg-raised");
  });
});

// The plates are hook-free, so they're called directly (their children are a required prop).
describe("the sign plate and the status plate", () => {
  it("a gate as a plate in the firm's pale tint, two sizes (Phase 20)", () => {
    const md = html(SignPlate({ children: "Gate 2" }));
    expect(md).toContain("bg-brand-soft font-semibold text-brand-ink min-h-8 px-2.5 text-base");
    expect(md).toContain(">Gate 2</span>");
    expect(html(SignPlate({ size: "sm", children: "Gate 2" }))).toContain("min-h-6 px-2 text-sm");
  });

  it("a status plate's colours by its role, its words always there", () => {
    const tones = {
      urgent: "bg-urgent-fill text-on-urgent",
      hivis: "bg-hivis text-on-hivis",
      done: "bg-done-fill text-on-done",
      waiting: "bg-raised text-ink-muted",
      brand: "bg-brand text-on-brand",
    } as const;
    for (const [tone, classes] of Object.entries(tones)) {
      const plate = html(Plate({ tone: tone as keyof typeof tones, children: "2 urgent" }));
      expect(plate).toContain(classes);
      expect(plate).toContain(">2 urgent</span>");
    }
  });
});

describe("the seats", () => {
  const seats = (o: Parameters<typeof Seats>[0]) => html(createElement(Seats, o));
  const count = (h: string, kind: "taken" | "free") =>
    (h.match(new RegExp(`data-seat="${kind}"`, "g")) ?? []).length;

  it("one square per place: taken filled, the rest free; hidden from screen readers", () => {
    const h = seats({ taken: 3, total: 4 });
    expect(h).toMatch(/^<span aria-hidden="true" data-seats=""/);
    expect([count(h, "taken"), count(h, "free")]).toEqual([3, 1]);
    // Taken in ink; free ones outlined in the muted grey, or the urgent red (Phase 20).
    // In the office (the events board), round and 4px apart (Phase 21).
    expect(h).toMatch(
      /^<span aria-hidden="true" data-seats="" class="flex flex-wrap gap-\[3px\] office:gap-1 /,
    );
    expect(h).toContain(
      'data-seat="taken" class="size-3 rounded-[3px] office:rounded-full bg-ink"',
    );
    expect(h).toContain(
      'data-seat="free" class="size-3 rounded-[3px] office:rounded-full border-[1.5px] border-ink-muted"',
    );
    expect(seats({ taken: 1, total: 2, urgent: true, size: "md" })).toContain(
      'data-seat="free" class="size-5 rounded-[5px] office:rounded-full border-[1.5px] border-urgent"',
    );
  });

  it("never more taken than places, never fewer than none; nothing for no places or too many", () => {
    const over = seats({ taken: 9, total: 4 });
    expect([count(over, "taken"), count(over, "free")]).toEqual([4, 0]);
    const under = seats({ taken: -2, total: 3 });
    expect([count(under, "taken"), count(under, "free")]).toEqual([0, 3]);
    expect(seats({ taken: 0, total: 0 })).toBe("");
    expect(seats({ taken: 1, total: SEATS_MAX })).not.toBe("");
    expect(seats({ taken: 1, total: SEATS_MAX + 1 })).toBe("");
  });
});

describe("motion (the design's spec)", () => {
  const tokens = [...css.matchAll(/--animate-([a-z-]+):\s*([^;]+);/g)].map((m) => ({
    name: m[1] ?? "",
    value: (m[2] ?? "").trim(),
  }));

  // Phase 22 (the office's round 2) adds a menu growing out of its button (`pop`, 200ms) and three
  // that aren't a 150-250ms movement: the ring that fades round the section a dashboard card jumped
  // to (`landed`, 1s: only its outline changes), and, while a page is on its way, a skeleton's slow
  // fade (`wait`) and "Offer"'s spinner (`turn`, linear), which loop until it arrives.
  const LONGER: Record<string, { duration: string; easing: string }> = {
    landed: { duration: "1s", easing: "var(--ease-sd)" },
    wait: { duration: "1.4s", easing: "var(--ease-sd)" },
    turn: { duration: "800ms", easing: "linear" },
  };

  it("each animation: a keyframes of its own, 150, 200 or 250ms, the one easing", () => {
    expect(tokens.map((t) => t.name).sort()).toEqual(
      [
        "bar",
        "fade",
        "in",
        "move",
        "open",
        "open-late",
        "sheet",
        "toast",
        "pop",
        "landed",
        "wait",
        "turn",
      ].sort(),
    );
    for (const t of tokens) {
      const [keyframes, duration] = t.value.split(/\s+/);
      expect(css, `${t.name}'s keyframes`).toContain(`@keyframes ${keyframes} {`);
      const longer = LONGER[t.name];
      expect(longer ? [longer.duration] : ["150ms", "200ms", "250ms"], t.name).toContain(duration);
      expect(t.value, t.name).toContain(longer?.easing ?? "var(--ease-sd)");
      // Only what waits for a page loops.
      if (t.value.includes("infinite")) expect(["wait", "turn"], t.name).toContain(t.name);
    }
    // Two easings in the whole stylesheet: the one for everything, and the spring a press returns
    // on (and the office menu's pill slides on: Phase 22).
    expect(css.match(/cubic-bezier\(/g)).toHaveLength(2);
    expect(css).toContain("--ease-sd: cubic-bezier(0.2, 0.8, 0.2, 1);");
    expect(css).toContain("--ease-spring: cubic-bezier(0.34, 1.45, 0.64, 1);");
  });

  it("every animation the app uses is one of them; no animation library (CSS only)", () => {
    const used = new Set(
      files(join(ROOT, "src/app")).flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/\banimate-([a-z-]+)/g)].map((m) => m[1] ?? ""),
      ),
    );
    expect(used.size).toBeGreaterThan(0);
    const defined = new Set(tokens.map((t) => t.name));
    for (const name of used) expect(defined, `animate-${name}`).toContain(name);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const lib of ["framer-motion", "motion", "gsap", "react-spring", "@react-spring/web"]) {
      expect(deps).not.toContain(lib);
    }
  });

  it("with reduced motion: every animation becomes a 150ms fade, and transitions stop", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(
      /\[class\*="animate-"\] \{\s*animation: sd-fade 150ms var\(--ease-sd\) both !important;\s*\}/,
    );
    expect(block).toMatch(/\* \{\s*transition-duration: 0ms !important;\s*\}/);
    // The fade itself only changes opacity: nothing moves.
    const fade = /@keyframes sd-fade \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";
    expect(fade).toContain("opacity");
    expect(fade).not.toMatch(/transform|translate/);
  });
});
