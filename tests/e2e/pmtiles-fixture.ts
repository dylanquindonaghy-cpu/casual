// A tiny street map file for the browser tests' street-map run (Phase 26.2; the claims-auditor's
// round 1): a valid PMTiles v3 archive (https://github.com/protomaps/PMTiles, spec v3) over the
// UK with no tiles in it, made in memory. MapLibre and the PMTiles reader open it exactly as they
// open the firm's real file, ask for its header and directory by byte range, and draw nothing (no
// tiles): enough to run the street map's whole path (the reader, MapLibre, its worker from our own
// route) with no outside map host. Never a real map, never fetched from anywhere.

const HEADER_BYTES = 127;

export function pmtilesFixture(): Uint8Array {
  // The root directory: no entries (a varint 0); no compression.
  const directory = new Uint8Array([0]);
  const metadata = new TextEncoder().encode(
    JSON.stringify({ name: "e2e", vector_layers: [], attribution: "e2e fixture" }),
  );
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + directory.length;
  const tilesOffset = metadataOffset + metadata.length;
  const out = new Uint8Array(tilesOffset);
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
  u64(56, tilesOffset); // tile data: none
  u64(64, 0);
  u64(72, 0); // addressed tiles
  u64(80, 0); // tile entries
  u64(88, 0); // tile contents
  out[96] = 1; // clustered
  out[97] = 1; // internal compression: none
  out[98] = 1; // tile compression: none
  out[99] = 1; // tile type: vector (MVT)
  out[100] = 0; // min zoom
  out[101] = 14; // max zoom
  const e7 = (at: number, degrees: number) => view.setInt32(at, Math.round(degrees * 1e7), true);
  e7(102, -8.7); // min lon
  e7(106, 49.8); // min lat
  e7(110, 1.9); // max lon
  e7(114, 60.9); // max lat
  out[118] = 5; // centre zoom
  e7(119, -1.5); // centre lon
  e7(123, 53.5); // centre lat
  out.set(directory, rootOffset);
  out.set(metadata, metadataOffset);
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
