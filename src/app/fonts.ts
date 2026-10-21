import localFont from "next/font/local";

// Two faces, each with one job (Phase 18; docs/ui-design.md "Type"), self-hosted: next/font serves
// the files from the app's own address, read from the fonts' npm packages (SIL Open Font License
// 1.1) at build time, so nothing is fetched from Google while building or running.
//
// Public Sans for words (built for public services: open shapes that read at a glance, in
// sunlight, at every size), as a variable font. Barlow Condensed, bold, for the "sign" figures:
// a shift's time and date, a gate or post, a count (drawn from road signs, so they read like the
// venue's own). Each in two subsets: latin, and latin-ext for names such as Łukasz or Ștefan (the
// browser downloads it only for a page that uses one). globals.css puts them under Tailwind's
// `font-sans` and `font-sign`, with the system's font after them. The latin faces have no
// metric-matched fallback of their own: next/font's would cover every character, so a name's "Ł"
// would come from it before the latin-ext face. The latin-ext faces' fallbacks (the same designs'
// metrics) stand in for both while they load.

export const publicSans = localFont({
  src: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-public",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const publicSansExt = localFont({
  src: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-public-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

export const barlowCondensed = localFont({
  src: "../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-barlow",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const barlowCondensedExt = localFont({
  src: "../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-ext-700-normal.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-barlow-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

// The four variables, for <html>'s class (the root layout and the whole-page error screen).
export const fontVariables = [publicSans, publicSansExt, barlowCondensed, barlowCondensedExt]
  .map((f) => f.variable)
  .join(" ");
