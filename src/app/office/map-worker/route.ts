import { readFile } from "node:fs/promises";
import { join } from "node:path";

// MapLibre's web worker (Phase 26.2: the dashboard's street map, ./dashboard/venue-map.tsx). MapLibre
// looks for its worker file next to its own, which the bundler has folded into one of our chunks,
// so the file isn't there and the streets never draw ("Worker failed to load"). The map asks here
// instead (`setWorkerUrl`): the installed package's own file, so it always matches the MapLibre
// that asks (`?v=` its version, for the cache). The image carries node_modules (Dockerfile), and
// it's the same file for everyone: nothing of a firm's in it.

const FILE = join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
let worker: Promise<Buffer> | null = null;

export async function GET(): Promise<Response> {
  worker ??= readFile(FILE);
  try {
    const body = await worker;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    worker = null;
    return new Response("Not found", { status: 404 });
  }
}
