"use client";

import { useEffect } from "react";

// Round 7's floating glass bends what's behind it as well as blurring it (globals.css
// `glass-float`): an SVG displacement in front of the blur. Only Chromium draws an SVG filter in a
// backdrop filter; Safari and Firefox would drop the whole effect, frost included. So the bending
// is switched on (.rf on <html>) only where the browser says it is Chromium, after the page loads;
// everywhere else, and before then, the glass is frosted without it.
type Brands = { brands?: { brand: string }[] };

export function GlassRefraction() {
  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: Brands }).userAgentData;
    if (data?.brands?.some((b) => b.brand === "Chromium")) {
      document.documentElement.classList.add("rf");
    }
  }, []);
  return null;
}

// The filter itself: fine noise, softened, displacing what's behind the glass by up to 9px. Its
// region is fixed and large (it would otherwise be measured from the wrong corner and miss most
// of a bar, dropping the blur with it).
export function RefractionFilter() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
    >
      <filter
        id="lg-refract"
        filterUnits="userSpaceOnUse"
        x="-2000"
        y="-2000"
        width="8000"
        height="8000"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008 0.012"
          numOctaves={2}
          seed={11}
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation={2} result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale={18}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
