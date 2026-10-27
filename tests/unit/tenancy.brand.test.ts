import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandBar } from "@/app/brand-bar";
import {
  brandColours,
  brandStyle,
  contrastRatio,
  DEFAULT_BRAND_COLOUR,
  isBrandColour,
  safeLogoUrl,
} from "@/lib/tenancy/brand";
import { firmPalette } from "@/lib/tenancy/brand-values";
import type { Rgb } from "@/lib/tenancy/glass-grounds";
import { grounds, looks, lowest, luminance } from "../helpers/theme-css";

// A firm's brand (src/lib/tenancy/brand.ts, src/app/brand-bar.tsx): only checked values reach the
// page, and the bar's text is readable on any colour.

describe("the logo address", () => {
  it("an https:// address is kept", () => {
    expect(safeLogoUrl("https://www.acme-events.example/logo.png")).toBe(
      "https://www.acme-events.example/logo.png",
    );
  });

  it("anything else is no logo: http, other schemes, a user name or password, too long, not text", () => {
    for (const raw of [
      "http://www.acme-events.example/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//www.acme-events.example/logo.png",
      "https://user:secret@www.acme-events.example/logo.png",
      "https://user@www.acme-events.example/logo.png",
      `https://www.acme-events.example/${"x".repeat(500)}.png`,
      // Short as typed, too long as stored and shown (each "é" becomes %C3%A9).
      `https://www.acme-events.example/${"é".repeat(200)}.png`,
      "not a url",
      "",
      null,
      42,
    ]) {
      expect(safeLogoUrl(raw), String(raw)).toBeNull();
    }
  });
});

describe("the colours", () => {
  it("a #rrggbb colour is kept (lower case); anything else is the default", () => {
    expect(isBrandColour("#1D4ED8")).toBe(true);
    expect(brandColours("#1D4ED8").background).toBe("#1d4ed8");
    for (const raw of [
      "1d4ed8",
      "#1d4ed",
      "#1d4ed8;",
      "red",
      "#1d4ed8; background: url(x)",
      null,
    ]) {
      expect(isBrandColour(raw), String(raw)).toBe(false);
      expect(brandColours(raw).background, String(raw)).toBe(DEFAULT_BRAND_COLOUR);
    }
  });

  it("the text colour is white on dark colours and black on light ones", () => {
    expect(brandColours(null).text).toBe("#ffffff");
    expect(brandColours("#1d4ed8").text).toBe("#ffffff");
    expect(brandColours("#0f766e").text).toBe("#ffffff");
    expect(brandColours("#ffff00").text).toBe("#000000");
  });

  it("sets the page's --firm-* values only for a firm's own checked colour, a set per theme", () => {
    // Acme's blue, a little darker for its words and its main button so they read on every point
    // of the glass (Phase 24), with white on it; the button's shade further from white; its band
    // as it is.
    expect(brandStyle(brandColours("#1D4ED8"))).toEqual({
      "--firm-fill": "#1a45bf",
      "--firm-on-fill": "#ffffff",
      "--firm-shade": "#15399d",
      "--firm-ink": "#1a45bf",
      "--firm-bar": "#1d4ed8",
      "--firm-on-bar": "#ffffff",
      // The pass's second line (Phase 20): white a fifth of the way to the blue, still 4.5:1.
      "--firm-on-bar-soft": "#d2dcf7",
      // The gate's white plate: the band's blue reads on white, so its words are the blue.
      "--firm-on-plate": "#1d4ed8",
      "--firm-dark-fill": expect.stringMatching(/^#[0-9a-f]{6}$/),
      "--firm-dark-on-fill": "#15171a",
      "--firm-dark-ink": expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
    // Yellow is too pale for words or a white-worded button in light: darkened until it reads.
    const yellow = brandStyle(brandColours("#ffff00"));
    expect(yellow?.["--firm-fill"]).not.toBe("#ffff00");
    expect(contrastRatio(yellow!["--firm-fill"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // The default (no colour set, a bad value, or the brand couldn't be read): nothing set.
    expect(brandStyle(brandColours(null))).toBeUndefined();
    expect(brandStyle(brandColours("#1d4ed8; background: url(x)"))).toBeUndefined();
    // Never a value that isn't #rrggbb, whatever the object says.
    expect(brandStyle({ own: true, background: "red; x: url(y)" })).toBeUndefined();
  });

  // Every ground the firm's colour sits on as words, in the looks of its theme, read from
  // src/app/globals.css itself (tests/helpers/theme-css.ts): the glass over every point of the
  // wash, the solid look (less transparency or more contrast) and the one with no blur. Worked out
  // once as luminances, so the whole cube runs quickly.
  const LOOKS = looks();
  const PLACES = [
    "canvas",
    "card",
    "sheet",
    "panel",
    "raised",
    "glass-tile",
    "button-hover",
    "lens",
  ];
  const groundsFor = (dark: boolean) => [
    ...new Set(
      LOOKS.filter((l) => l.name.startsWith("dark") === dark).flatMap((look) =>
        PLACES.flatMap((where) => grounds(look, where).map((g) => luminance(g.colour))),
      ),
    ),
  ];
  const LIGHT_LUM = groundsFor(false);
  const DARK_LUM = groundsFor(true);
  const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  const onAll = (hex: string, lums: number[]) => {
    const l = luminance(rgb(hex));
    return Math.min(...lums.map((g) => (Math.max(l, g) + 0.05) / (Math.min(l, g) + 0.05)));
  };
  // CSS brightness(1.06) on the main button under the pointer and pressed (`press-glass`).
  const bright = (hex: string) =>
    `#${rgb(hex)
      .map((v) =>
        Math.min(255, Math.round(v * 1.06))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;

  it("every firm colour gives readable pairs in every look, across the whole colour cube", () => {
    expect(LIGHT_LUM.length).toBeGreaterThan(100);
    expect(DARK_LUM.length).toBeGreaterThan(100);
    const failing: string[] = [];
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const { light, dark } = firmPalette(hex);
          const pairs: [string, number][] = [
            // The main button, in both themes: white (or ink) words on its colour, its shade, and
            // both brightened under the pointer.
            ...[light.fill, light.shade, bright(light.fill), bright(light.shade)].map(
              (c): [string, number] => ["main button", contrastRatio(light.onFill, c)],
            ),
            ["band", contrastRatio(light.onBar, light.bar)],
            ["band's second line", contrastRatio(light.onBarSoft, light.bar)],
            // The gate on the pass: a white plate, its words readable on it (Phase 20).
            ["gate plate", contrastRatio(light.onPlate, "#ffffff")],
            // A fill in the firm's colour in dark (the booked day), with its words.
            ["dark fill", contrastRatio(dark.onFill, dark.fill)],
            // The firm's colour as words, on every ground of its theme's looks.
            ["light words", onAll(light.ink, LIGHT_LUM)],
            ["dark words", onAll(dark.ink, DARK_LUM)],
          ];
          // And on its own pale tint (brand-soft: 12% of it over what's under it), as on a sign
          // plate and an open Details button.
          for (const look of LOOKS) {
            const set = look.name.startsWith("dark") ? dark : light;
            pairs.push([
              `words on the tint (${look.name})`,
              lowest(look, rgb(set.ink), "brand-soft", rgb(set.fill)),
            ]);
          }
          for (const [what, ratio] of pairs)
            if (!(ratio >= 4.5)) failing.push(`${hex} ${what}: ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it("the demo firms' colours: their bands as they are, their words a little darker in light, lighter for dark", () => {
    const acme = firmPalette("#1d4ed8");
    expect(acme.light).toEqual({
      fill: "#1a45bf",
      onFill: "#ffffff",
      shade: "#15399d",
      ink: "#1a45bf",
      bar: "#1d4ed8",
      onBar: "#ffffff",
      onBarSoft: "#d2dcf7",
      onPlate: "#1d4ed8",
    });
    // The words, as near the colour as reads: one 6% step towards black did it, no more.
    expect(contrastRatio("#1d4ed8", acme.light.fill)).toBeLessThan(1.3);
    // A pale firm colour: ink on its band, and ink on the gate's white plate (white words
    // wouldn't read on it, nor the yellow on white).
    const yellow = firmPalette("#ffff00").light;
    expect([yellow.bar, yellow.onBar, yellow.onPlate]).toEqual(["#ffff00", "#15171a", "#15171a"]);
    expect(onAll(acme.dark.ink, DARK_LUM)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(acme.dark.fill, "#1d4ed8")).toBeGreaterThan(1); // lighter than the colour
    // Northline's teal: its band as it is; darker as words and the button, for its own pale tint
    // over the wash's mint corner.
    const northline = firmPalette("#0f766e");
    expect(northline.light.bar).toBe("#0f766e");
    expect(northline.light.fill).toBe("#0c5c56");
    expect(northline.light.shade).toBe("#0a4c46");
  });

  it("knows a firm's own colour from the default", () => {
    expect(brandColours("#1d4ed8").own).toBe(true);
    expect(brandColours(null).own).toBe(false);
    expect(brandColours("#1d4ed8; background: url(x)").own).toBe(false);
    expect(brandColours("#ffffff").text).toBe("#000000");
    expect(brandColours("#f59e0b").text).toBe("#000000");
  });

  it("the WCAG contrast ratio, as published: black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("any colour at all reads at 4.5:1 or better (WCAG AA), checked across the whole colour cube", () => {
    let worst = 21;
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const { background, text } = brandColours(hex);
          worst = Math.min(worst, contrastRatio(background, text));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the bar", () => {
  const render = (logoUrl: string | null, name = "Acme Events") =>
    renderToStaticMarkup(
      createElement(BrandBar, {
        brand: { name, logoUrl, background: "#1d4ed8", text: "#ffffff", own: true },
      }),
    );

  it("the firm's initial on its colour (from the page's tokens, no style of its own), then its name", () => {
    const html = render(null);
    expect(html).toContain('<span data-testid="brand-name"');
    expect(html).toContain(">Acme Events</span>");
    expect(html).toMatch(
      /<span aria-hidden="true" data-testid="brand-mark" class="[^"]*bg-brand-bar[^"]*text-on-brand-bar[^"]*">A<\/span>/,
    );
    expect(html).not.toContain("style=");
    expect(html).not.toContain("<img");
    expect(render(null, "  northline")).toContain(">N</span>");
  });

  it("the logo instead of the initial: decorative (the name is beside it), and the firm's site isn't told the page", () => {
    const html = render("https://www.acme-events.example/logo.png");
    expect(html).toMatch(/<img[^>]*src="https:\/\/www\.acme-events\.example\/logo\.png"/);
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).toMatch(/<img[^>]*referrerPolicy="no-referrer"/i);
    expect(html).not.toContain('data-testid="brand-mark"');
  });

  it("an Offline plate that only the copy kept for no signal shows", () => {
    expect(render(null)).toMatch(/<span data-offline-only="" class="[^"]*">Offline<\/span>/);
  });
});
