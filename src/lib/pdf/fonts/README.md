# Fonts for PDFs

Embedded in the PDFs ShiftDesk makes (`src/lib/pdf/record.ts`), so names such as Łukasz, Ştefan or
Gülşen and the "✓" mark print (pdf-lib's built-in fonts only cover Western European letters and
throw on anything else).

| File | What | From |
|---|---|---|
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` | Noto Sans: Latin (with Extended A, B and Additional), Greek, Cyrillic, punctuation, currency and arrows | npm `@expo-google-fonts/noto-sans` 0.4.2 (Google Fonts), cut down with `pyftsubset --unicodes="U+0020-007E,U+00A0-024F,U+0259,U+02B0-02FF,U+0300-036F,U+0370-03FF,U+0400-052F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-2199,U+2212,U+FEFF,U+FFFD" --layout-features="kern,mark,mkmk,ccmp,locl" --no-hinting` (630 KB to about 200 KB) |
| `NotoSansSymbols2-Marks.ttf` | Only "✓" (U+2713) and "✗" (U+2717) from Noto Sans Symbols 2 | npm `@expo-google-fonts/noto-sans-symbols-2` 0.4.1, cut down with fontTools `pyftsubset --unicodes=U+2713,U+2717` (the whole font is 1.2 MB) |

They're embedded whole (pdf-lib's `subset: false`): fontkit's own subsetting breaks these fonts
(letters go missing when drawn). All three are under the SIL Open Font License 1.1 (`OFL.txt`, The Noto Project Authors), which
allows embedding, bundling and subsetting. Noto declares no Reserved Font Names.
