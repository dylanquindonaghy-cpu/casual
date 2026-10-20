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

  it("sets the page's brand colours only for a firm's own checked colour", () => {
    expect(brandStyle(brandColours("#1D4ED8"))).toEqual({
      "--color-brand": "#1d4ed8",
      "--color-on-brand": "#ffffff",
    });
    expect(brandStyle(brandColours("#ffff00"))).toEqual({
      "--color-brand": "#ffff00",
      "--color-on-brand": "#000000",
    });
    // The default (no colour set, a bad value, or the brand couldn't be read): nothing set.
    expect(brandStyle(brandColours(null))).toBeUndefined();
    expect(brandStyle(brandColours("#1d4ed8; background: url(x)"))).toBeUndefined();
    // Never a value that isn't #rrggbb, whatever the object says.
    expect(
      brandStyle({ own: true, background: "red; x: url(y)", text: "#ffffff" }),
    ).toBeUndefined();
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
  const render = (logoUrl: string | null) =>
    renderToStaticMarkup(
      createElement(BrandBar, {
        brand: { name: "Acme Events", logoUrl, background: "#1d4ed8", text: "#ffffff", own: true },
      }),
    );

  it("the name on the firm's colour, with the readable text colour", () => {
    const html = render(null);
    expect(html).toContain("Acme Events");
    expect(html).toContain("background-color:#1d4ed8");
    expect(html).toContain("color:#ffffff");
    expect(html).not.toContain("<img");
  });

  it("the logo: decorative (the name is beside it), and the firm's site isn't told the page", () => {
    const html = render("https://www.acme-events.example/logo.png");
    expect(html).toMatch(/<img[^>]*src="https:\/\/www\.acme-events\.example\/logo\.png"/);
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).toMatch(/<img[^>]*referrerPolicy="no-referrer"/i);
  });
});
