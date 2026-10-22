import localFont from "next/font/local";

// The office's faces (Phase 21; docs/ui-design.md "The office's system"), self-hosted like the
// app's own (src/app/fonts.ts): next/font serves the files from the app's own address, read from
// the fonts' npm packages (SIL Open Font License 1.1) at build time, so nothing is fetched from
// Google. Geist for everything you read in the office, a variable font with its own fixed-width
// digits; Geist Mono for the dashboard's big numbers (`font-stat`). Each in latin, and latin-ext
// for names such as Łukasz (fetched only for a page that uses one). Declared here, in the office's
// layout, so only office pages fetch them ahead: the casual app never uses them. globals.css puts
// them on [data-office] and under `font-stat`, with the system's after them. As in fonts.ts, the
// latin faces have no metric-matched fallback (it would cover "Ł" before the latin-ext face) and
// next/font wants every value written out in place.

export const geist = localFont({
  src: "../../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
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
  src: "../../../node_modules/@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2",
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

export const geistMono = localFont({
  src: "../../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-geist-mono",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const geistMonoExt = localFont({
  src: "../../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-geist-mono-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

// The four variables, for the office's [data-office] wrapper (src/app/office/layout.tsx).
export const officeFontVariables = [geist, geistExt, geistMono, geistMonoExt]
  .map((f) => f.variable)
  .join(" ");
