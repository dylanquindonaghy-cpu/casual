import { z } from "zod";
import { readCapped } from "./body";
import { tidyPostcode } from "./postcode";

// Postcode to coordinates (docs/office-v2.md 5.4): a postcode's central point, never a house or a
// person's position. Only the postcode is ever sent, never who it belongs to. Server only.
//
// - fake: fixed points for the made-up ZZ postcodes (golden rule 7), for development, tests and a
//   demo; district ZZ0 is never found (for "unknown postcode"). Any other postcode is "off": the
//   fake can't place it, and says so, rather than calling a real postcode unknown.
// - postcodes.io (https://postcodes.io/docs/overview/): free and keyless. A GET of the postcode
//   alone, with a time limit; its answer is checked with zod before anything is used. A postcode
//   it doesn't know (404), or one without a central point, is "not found"; anything else that
//   goes wrong is "unavailable", and the caller says so and saves nothing. Its answer is read only
//   up to POSTCODES_IO_MAX_BYTES (one is about 2 KB).
//
// Chosen by the server's TRAVEL_PROVIDER (`geocoderFor`): "fake", or "traveltime" (postcodes.io).

export interface Point {
  lat: number;
  lng: number;
}

export type GeocodeResult =
  | { status: "found"; postcode: string; point: Point }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "off" }; // the fake, asked about a real postcode: look-ups aren't switched on

export interface Geocoder {
  locate(postcode: string): Promise<GeocodeResult>;
}

export type TravelProvider = "fake" | "traveltime";

// Six decimal places: about 10 cm, and what sites.lat/lng and worker_travel keep.
const sixPlaces = (n: number) => Math.round(n * 1e6) / 1e6;

// --- fake ---

// A made-up centre; district n sits n × 0.03° north and n × 0.02° east of it, its sector and
// unit spread it a little more, so every ZZ postcode has its own point and nearby districts are
// near each other.
const FAKE_CENTRE: Point = { lat: 53.8, lng: -1.55 };
const FAKE = /^ZZ([0-9]{1,2})[A-Z]? ([0-9])([A-Z])([A-Z])$/;

export function fakePoint(postcode: string): Point | null {
  const m = FAKE.exec(postcode);
  if (!m) return null;
  const district = Number(m[1]);
  if (district === 0) return null;
  const sector = Number(m[2]);
  const unit = ((m[3] ?? "A").charCodeAt(0) - 65) * 26 + ((m[4] ?? "A").charCodeAt(0) - 65);
  return {
    lat: sixPlaces(FAKE_CENTRE.lat + district * 0.03 + sector * 0.003 + unit * 0.00001),
    lng: sixPlaces(FAKE_CENTRE.lng + district * 0.02 - sector * 0.002 + unit * 0.00001),
  };
}

export const fakeGeocoder: Geocoder = {
  async locate(raw) {
    const postcode = tidyPostcode(raw);
    if (!postcode) return { status: "not_found" };
    if (!postcode.startsWith("ZZ")) return { status: "off" };
    const point = fakePoint(postcode);
    return point ? { status: "found", postcode, point } : { status: "not_found" };
  },
};

// --- postcodes.io ---

export const POSTCODES_IO_URL = "https://api.postcodes.io";
export const POSTCODES_IO_TIMEOUT_MS = 5000;
export const POSTCODES_IO_MAX_BYTES = 64 * 1024;

// Only the fields used; the rest of its answer is ignored.
const foundAnswer = z.object({
  status: z.literal(200),
  result: z.object({
    postcode: z.string().max(10),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  }),
});
const missingAnswer = z.object({ status: z.literal(404), error: z.string().max(200) });

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function postcodesIoGeocoder(
  o: { fetch?: Fetch; baseUrl?: string; timeoutMs?: number } = {},
): Geocoder {
  const send: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const base = o.baseUrl ?? POSTCODES_IO_URL;
  const timeoutMs = o.timeoutMs ?? POSTCODES_IO_TIMEOUT_MS;
  return {
    async locate(raw) {
      const postcode = tidyPostcode(raw);
      if (!postcode) return { status: "not_found" };
      let response: Response;
      try {
        response = await send(`${base}/postcodes/${encodeURIComponent(postcode)}`, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { status: "unavailable" };
      }
      let body: unknown;
      try {
        const text = await readCapped(response, POSTCODES_IO_MAX_BYTES);
        if (text === null) return { status: "unavailable" };
        body = JSON.parse(text);
      } catch {
        return { status: "unavailable" };
      }
      if (response.status === 404) {
        return missingAnswer.safeParse(body).success
          ? { status: "not_found" }
          : { status: "unavailable" };
      }
      if (response.status !== 200) return { status: "unavailable" };
      const answer = foundAnswer.safeParse(body);
      if (!answer.success) return { status: "unavailable" };
      const { latitude, longitude } = answer.data.result;
      // A postcode with no central point (some are only for PO boxes or large users): it can't
      // be placed.
      if (latitude === null || longitude === null) return { status: "not_found" };
      // Its own tidy form must be the one asked for (never someone else's answer).
      if (tidyPostcode(answer.data.result.postcode) !== postcode) return { status: "unavailable" };
      return {
        status: "found",
        postcode,
        point: { lat: sixPlaces(latitude), lng: sixPlaces(longitude) },
      };
    },
  };
}

export function geocoderFor(provider: TravelProvider): Geocoder {
  return provider === "traveltime" ? postcodesIoGeocoder() : fakeGeocoder;
}
