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
    // Acme's blue reads on the canvas and the card as it is: its button keeps it, with white words.
    expect(brandStyle(brandColours("#1D4ED8"))).toEqual({
      "--firm-fill": "#1d4ed8",
      "--firm-on-fill": "#ffffff",
      "--firm-ink": "#1d4ed8",
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

  // brand-soft, as globals.css mixes it: 12% of the brand over the card.
  const tint = (brand: string, card: string) =>
    `#${[1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(brand.slice(i, i + 2), 16) * 0.12 + parseInt(card.slice(i, i + 2), 16) * 0.88,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;

  it("every firm colour gives readable pairs in both themes, across the whole colour cube", () => {
    const LIGHT = ["#eef0f3", "#ffffff"]; // canvas, card
    const DARK = ["#18191c", "#232529", "#0b0c0e"]; // card, raised, canvas (Phase 20's greys)
    const failing: string[] = [];
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const { light, dark } = firmPalette(hex);
          const pairs: [string, string, string][] = [
            ["light fill", light.onFill, light.fill],
            ["band", light.onBar, light.bar],
            ["band's second line", light.onBarSoft, light.bar],
            // The gate on the pass: a white plate, its words readable on it (Phase 20).
            ["gate plate", light.onPlate, "#ffffff"],
            ["dark fill", dark.onFill, dark.fill],
            // The firm's colour as words on its own pale tint (brand-soft: 12% of it over the
            // card), as on a sign plate and an open Details button.
            ["light words on the tint", light.ink, tint(light.fill, "#ffffff")],
            ["dark words on the tint", dark.ink, tint(dark.fill, "#18191c")],
            ...LIGHT.map((g2): [string, string, string] => ["light words", light.ink, g2]),
            ...DARK.map((g2): [string, string, string] => ["dark words", dark.ink, g2]),
          ];
          for (const [what, a, c] of pairs) {
            if (!(contrastRatio(a, c) >= 4.5))
              failing.push(`${hex} ${what}: ${contrastRatio(a, c).toFixed(2)}`);
          }
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it("the demo firms' colours: as they are in light, lightened for words on dark", () => {
    const acme = firmPalette("#1d4ed8");
    expect(acme.light).toEqual({
      fill: "#1d4ed8",
      onFill: "#ffffff",
      ink: "#1d4ed8",
      bar: "#1d4ed8",
      onBar: "#ffffff",
      onBarSoft: "#d2dcf7",
      onPlate: "#1d4ed8",
    });
    // A pale firm colour: ink on its band, and ink on the gate's white plate (white words
    // wouldn't read on it, nor the yellow on white).
    const yellow = firmPalette("#ffff00").light;
    expect([yellow.bar, yellow.onBar, yellow.onPlate]).toEqual(["#ffff00", "#15171a", "#15171a"]);
    expect(contrastRatio(acme.dark.ink, "#232529")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(acme.dark.fill, "#1d4ed8")).toBeGreaterThan(1); // lighter than the colour
    const northline = firmPalette("#0f766e");
    expect(northline.light.fill).toBe("#0f766e");
    expect(northline.light.bar).toBe("#0f766e");
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
