# The street map's letter shapes

The dashboard's street map (Phase 27.8) draws its names (towns, areas, streets, water) with these
letter shapes, served from our own server at `/map-glyphs/{fontstack}/{range}.pbf`
(`src/lib/office/map-style.ts`, `MAP_GLYPHS`). No other site is asked for them.

- **What they are:** Noto Sans, as the signed-distance-field glyph files MapLibre reads (one file per
  typeface and block of 256 characters), made with MapLibre's font-maker.
- **Where they came from:** Protomaps' basemaps assets,
  `https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf`
  (https://github.com/protomaps/basemaps-assets), downloaded on 2026-11-04. Only the files were
  copied; nothing downloaded was run.
- **Typefaces** (the folder names are the typeface names, spaces included, as the map style asks for
  them): `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic`.
- **Ranges** (each typeface has all five):
  - `0-255`: Basic Latin and Latin-1 (English, and é, ö and the like)
  - `256-511`: Latin Extended-A and the start of B (Welsh ŵ and ŷ, and letters such as ł, ő and ş)
  - `512-767`: the rest of Latin Extended-B, IPA and the spacing modifier letters
  - `7680-7935`: Latin Extended Additional (Welsh ẁ, ẃ, ẅ, ỳ)
  - `8192-8447`: General Punctuation (’ “ ” – — …)

A name in any other script (rare on a UK map) still shows: MapLibre draws letters it has no file
for with the browser's own font, and asks for nothing elsewhere.

**Licence:** Noto Sans is © The Noto Project Authors, under the SIL Open Font License 1.1: the full
text is `OFL.txt` here, as it came with the files. These are unmodified copies, not sold on their
own.

To add a range, download it from the same address into a new empty folder, check it, then copy the
`.pbf` file into each typeface's folder here, and add it to `MAP_GLYPH_RANGES` (the unit test checks
every typeface has every range).
