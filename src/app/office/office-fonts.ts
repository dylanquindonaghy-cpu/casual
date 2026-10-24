import localFont from "next/font/local";

// The office's face (Phase 23, round 3; docs/ui-design.md "Phase 23"), self-hosted like the app's
// own (src/app/fonts.ts): next/font serves the files from the app's own address, read from the
// font's npm package (SIL Open Font License 1.1) at build time, so nothing is fetched from Google.
// Plus Jakarta Sans, the approved mock-up's face, for everything in the office: words, headlines
// (`text-title`, 800) and the big numbers (`font-stat`, 800 with fixed-width digits). One
// variable face (200 to 800) in latin, and latin-ext for names such as Łukasz (fetched only for a
// page that uses one). Declared here, in the office's layout, so only office pages fetch it ahead:
// the casual app never uses it. globals.css puts it on [data-office], in `--title-font` and under
// `font-stat`, with the system's after it. As in fonts.ts, the latin face has no metric-matched
// fallback (it would cover "Ł" before the latin-ext face) and next/font wants every value written
// out in place. The consts' names become the families' names (the browser tests look for
// "plusJakarta").

export const plusJakartaSans = localFont({
  src: "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-plus-jakarta",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const plusJakartaSansExt = localFont({
  src: "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-plus-jakarta-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

// The two variables, for the office's [data-office] wrapper (src/app/office/layout.tsx).
export const officeFontVariables = [plusJakartaSans, plusJakartaSansExt]
  .map((f) => f.variable)
  .join(" ");
