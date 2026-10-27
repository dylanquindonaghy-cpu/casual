import localFont from "next/font/local";

// One face for everything (Phase 24, round 7; docs/ui-design.md "Phase 24"), in the office and the
// casual app: Geist, self-hosted. next/font serves the files from the app's own address, read from
// the font's npm package (@fontsource-variable/geist, SIL Open Font License 1.1) at build time, so
// nothing is fetched from Google while building or running.
//
// Geist for words, headlines, times and counts (its digits are fixed-width with `tabular-nums`,
// which globals.css sets on <body>), as a variable font (100 to 900; the app uses 400, 500 and
// 600). In two subsets: latin, and latin-ext for names such as Łukasz or Ștefan (the browser
// downloads it only for a page that uses one). globals.css puts it under Tailwind's `font-sans`,
// `font-sign`, `text-title` and `font-stat`, with the system's fonts after it. The latin face has
// no metric-matched fallback of its own: next/font's would cover every character, so a name's "Ł"
// would come from it before the latin-ext face. The latin-ext face's fallback (the same design's
// metrics) stands in for both while they load. next/font wants every value written out in place,
// so the range is repeated. The consts' names become the families' names (the browser tests look
// for "geist").

export const geist = localFont({
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-geist",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const geistExt = localFont({
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-geist-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

// The two variables, for <html>'s class (the root layout and the whole-page error screen).
export const fontVariables = [geist, geistExt].map((f) => f.variable).join(" ");
