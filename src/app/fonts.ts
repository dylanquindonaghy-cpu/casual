import localFont from "next/font/local";

// Two faces, each with one job (Phase 20; docs/ui-design.md "Type"), self-hosted: next/font serves
// the files from the app's own address, read from the fonts' npm packages (SIL Open Font License
// 1.1) at build time, so nothing is fetched from Google while building or running.
//
// Instrument Sans for everything you read: words, and the "sign" figures (a shift's time and date,
// a gate, a count) in its semibold with its own fixed-width digits, as a variable font (400 to
// 700). Instrument Serif, at one weight, for the greetings only ("Hi Zoe", "Evening, Acme
// Events."). Each in two subsets: latin, and latin-ext for names such as Łukasz or Ștefan (the
// browser downloads it only for a page that uses one). globals.css puts them under Tailwind's
// `font-sans`, `font-sign` and `font-greet`, with the system's fonts after them. The latin faces
// have no metric-matched fallback of their own: next/font's would cover every character, so a
// name's "Ł" would come from it before the latin-ext face. The latin-ext faces' fallbacks (the same
// designs' metrics) stand in for both while they load. next/font wants every value written out in
// place, so the two ranges are repeated.

export const instrumentSans = localFont({
  src: "../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-instrument",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const instrumentSansExt = localFont({
  src: "../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-ext-wght-normal.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-instrument-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

export const instrumentSerif = localFont({
  src: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-instrument-serif",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const instrumentSerifExt = localFont({
  src: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-instrument-serif-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

// The four variables, for <html>'s class (the root layout and the whole-page error screen).
export const fontVariables = [
  instrumentSans,
  instrumentSansExt,
  instrumentSerif,
  instrumentSerifExt,
]
  .map((f) => f.variable)
  .join(" ");
