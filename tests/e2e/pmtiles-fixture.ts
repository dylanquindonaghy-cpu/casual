// A tiny street map file for the browser tests' street-map run (Phase 26.2; the claims-auditor's
// round 1): a valid PMTiles v3 archive (https://github.com/protomaps/PMTiles, spec v3) over the
// UK, made in memory. MapLibre and the PMTiles reader open it exactly as they open the firm's real
// file, ask for its header and directory by byte range, and draw it: enough to run the street
// map's whole path (the reader, MapLibre, its worker from our own route) with no outside map host.
// Never a real map, never fetched from anywhere.
//
// Since Phase 27.8 (the map's names) it holds one tile, the whole world at zoom 0 (MapLibre
// stretches it to any zoom), with two made-up town names near the demo's venues (FIXTURE_PLACES),
// as the real file's `places` layer carries them. So MapLibre lays out their labels and asks for
// their letter shapes, which come from /map-glyphs on our own server: Exampleton, a big town
// (min_zoom 4), in Noto Sans Medium; St Demo’s in Noto Sans Regular, its ’ from the punctuation
// range (8192-8447). tests/unit/office.map-style.test.ts reads the file back with the PMTiles reader
// and MapLibre's own vector tile parser.

const HEADER_BYTES = 127;
const EXTENT = 4096;

export const FIXTURE_PLACES = [
  { name: "Exampleton", lng: -1.52, lat: 53.86, minZoom: 4, populationRank: 10 },
  { name: "St Demo’s", lng: -1.46, lat: 53.93, minZoom: 9, populationRank: 6 },
] as const;

// Protocol buffers, by hand (the vector tile and the directory are both in this encoding).
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}
const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const key = (field: number, wire: number) => varint(field * 8 + wire);
const uint = (field: number, n: number) => [...key(field, 0), ...varint(n)];
const bytes = (field: number, data: number[]) => [
  ...key(field, 2),
  ...varint(data.length),
  ...data,
];
const text = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);

// A place's point in the zoom-0 tile (Web Mercator, EXTENT units).
function tilePoint(lng: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * EXTENT;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * EXTENT;
  return [Math.round(x), Math.round(y)];
}

// The tile (Mapbox Vector Tile 2.1): one layer, `places`, a point for each town with the fields
// Protomaps' place labels read (kind, name, min_zoom, population_rank).
export function fixtureTile(): Uint8Array {
  const keys = ["kind", "name", "min_zoom", "population_rank"];
  const values: (string | number)[] = [];
  const valueAt = (v: string | number) => {
    const i = values.indexOf(v);
    return i >= 0 ? i : values.push(v) - 1;
  };
  const features = FIXTURE_PLACES.map((p) => {
    const tags = [
      [0, valueAt("locality")],
      [1, valueAt(p.name)],
      [2, valueAt(p.minZoom)],
      [3, valueAt(p.populationRank)],
    ].flat();
    const [x, y] = tilePoint(p.lng, p.lat);
    const geometry = [(1 & 0x7) | (1 << 3), zigzag(x), zigzag(y)]; // MoveTo, one point
    return bytes(2, [
      ...bytes(2, tags.flatMap(varint)),
      ...uint(3, 1), // a point
      ...bytes(4, geometry.flatMap(varint)),
    ]);
  });
  const layer = [
    ...uint(15, 2), // version 2
    ...text(1, "places"),
    ...features.flat(),
    ...keys.flatMap((k) => text(3, k)),
    ...values.flatMap((v) => bytes(4, typeof v === "string" ? text(1, v) : uint(5, v))),
    ...uint(5, EXTENT),
  ];
  return Uint8Array.from(bytes(3, layer));
}

export function pmtilesFixture(): Uint8Array {
  const tile = fixtureTile();
  // The root directory: one entry, tile 0 (zoom 0), a run of 1, its length, at offset 0 (stored
  // as 1: 0 means "right after the one before"); no compression.
  const directory = Uint8Array.from([
    ...varint(1),
    ...varint(0),
    ...varint(1),
    ...varint(tile.length),
    ...varint(1),
  ]);
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      name: "e2e",
      vector_layers: [{ id: "places", fields: {} }],
      attribution: "e2e fixture",
    }),
  );
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + directory.length;
  const tilesOffset = metadataOffset + metadata.length;
  const out = new Uint8Array(tilesOffset + tile.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PMTiles"), 0);
  out[7] = 3; // version
  const u64 = (at: number, n: number) => view.setBigUint64(at, BigInt(n), true);
  u64(8, rootOffset);
  u64(16, directory.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, tilesOffset); // leaf directories: none
  u64(48, 0);
  u64(56, tilesOffset); // tile data: the one tile
  u64(64, tile.length);
  u64(72, 1); // addressed tiles
  u64(80, 1); // tile entries
  u64(88, 1); // tile contents
  out[96] = 1; // clustered
  out[97] = 1; // internal compression: none
  out[98] = 1; // tile compression: none
  out[99] = 1; // tile type: vector (MVT)
  out[100] = 0; // min zoom
  out[101] = 0; // max zoom: the one tile, stretched by MapLibre to any zoom
  const e7 = (at: number, degrees: number) => view.setInt32(at, Math.round(degrees * 1e7), true);
  e7(102, -8.7); // min lon
  e7(106, 49.8); // min lat
  e7(110, 1.9); // max lon
  e7(114, 60.9); // max lat
  out[118] = 0; // centre zoom
  e7(119, -1.5); // centre lon
  e7(123, 53.5); // centre lat
  out.set(directory, rootOffset);
  out.set(metadata, metadataOffset);
  out.set(tile, tilesOffset);
  return out;
}

// The bytes a Range request asks for, as a file server answers it (206 and Content-Range), or the
// whole file without one.
export function rangeOf(
  file: Uint8Array,
  range: string | undefined,
): { status: number; body: Buffer; headers: Record<string, string> } {
  const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
  if (!m) {
    return {
      status: 200,
      body: Buffer.from(file),
      headers: { "content-type": "application/octet-stream", "accept-ranges": "bytes" },
    };
  }
  const start = Number(m[1]);
  const end = Math.min(m[2] ? Number(m[2]) : file.length - 1, file.length - 1);
  return {
    status: 206,
    body: Buffer.from(file.subarray(start, end + 1)),
    headers: {
      "content-type": "application/octet-stream",
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${file.length}`,
    },
  };
}
