import { z } from "zod";
import type { EstimateMode } from "../db/schema/travel";
import { straightLineMetres } from "./distance";
import type { Point } from "./geocoder";

// Travel times (docs/office-v2.md 5.4; D1; 12G.2): one search is a site's point, an arrive-by time,
// a way of travelling and up to SEARCH_MAX_ORIGINS start points, each under a meaningless id ("o1",
// "o2": never a postcode, a name or a database id). The answer for each start point: minutes (and
// metres, by car), or null when the site can't be reached within TRAVEL_CEILING_MINUTES; or the whole
// search "unavailable". Worker only: the travel job calls it (src/lib/travel/estimates.ts), never a
// page.
//
// - fake: times worked out from the straight-line distance (development, tests and a demo).
// - TravelTime's time-filter (https://docs.traveltime.com/api/reference/time-filter): an arrival
//   search, the 90-minute ceiling, the distance by car; the answer checked with zod, read only up
//   to TRAVELTIME_MAX_BYTES, with a time limit. Real calls wait for "Connect postcodes.io and
//   TravelTime" (PLAN.md Parking lot).

export const TRAVEL_CEILING_MINUTES = 90;
export const SEARCH_MAX_ORIGINS = 2000;
export { straightLineMetres };

export interface TravelSearch {
  to: Point;
  arriveBy: Date;
  mode: EstimateMode;
  from: { id: string; point: Point }[];
}

export type Trip = { minutes: number; metres: number | null } | null; // null: not within 90 minutes

export type SearchResult =
  | { status: "ok"; trips: Map<string, Trip> } // an id not in the map: no answer for it
  | { status: "unavailable" };

export interface TravelProvider {
  readonly name: "fake" | "traveltime";
  search(s: TravelSearch): Promise<SearchResult>;
}

function tooMany(s: TravelSearch) {
  if (s.from.length > SEARCH_MAX_ORIGINS) {
    throw new Error(`a travel search takes at most ${SEARCH_MAX_ORIGINS} start points`);
  }
}

// --- fake ---

// Roads are about 1.3 times the straight line. By car: 40 km/h on average, plus 5 minutes to park.
// By public transport: 18 km/h on average, plus 10 minutes of walking and waiting.
export function fakeTrip(from: Point, to: Point, mode: EstimateMode): Trip {
  const road = straightLineMetres(from, to) * 1.3;
  const minutes =
    mode === "car"
      ? Math.ceil(road / ((40 * 1000) / 60)) + 5
      : Math.ceil(road / ((18 * 1000) / 60)) + 10;
  if (minutes > TRAVEL_CEILING_MINUTES) return null;
  return { minutes, metres: mode === "car" ? Math.round(road) : null };
}

export const fakeTravelProvider: TravelProvider = {
  name: "fake",
  async search(s) {
    tooMany(s);
    return {
      status: "ok",
      trips: new Map(s.from.map((f) => [f.id, fakeTrip(f.point, s.to, s.mode)])),
    };
  },
};

// --- TravelTime ---

export const TRAVELTIME_URL = "https://api.traveltimeapp.com/v4/time-filter";
export const TRAVELTIME_TIMEOUT_MS = 10_000;
export const TRAVELTIME_MAX_BYTES = 2 * 1024 * 1024;

// Only the fields used; the rest of its answer is ignored.
const timeFilterAnswer = z.object({
  results: z
    .array(
      z.object({
        search_id: z.string(),
        locations: z.array(
          z.object({
            id: z.string(),
            properties: z
              .array(
                z.object({
                  travel_time: z
                    .number()
                    .int()
                    .min(0)
                    .max(TRAVEL_CEILING_MINUTES * 60),
                  distance: z.number().int().min(0).optional(),
                }),
              )
              .min(1),
          }),
        ),
        unreachable: z.array(z.string()),
      }),
    )
    .max(1),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// "2026-10-25T00:50:00Z": the absolute time, so the clock change can't move it.
const isoSeconds = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export function travelTimeProvider(o: {
  appId: string;
  apiKey: string;
  fetch?: Fetch;
  url?: string;
  timeoutMs?: number;
}): TravelProvider {
  const send: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  return {
    name: "traveltime",
    async search(s) {
      tooMany(s);
      if (s.from.length === 0) return { status: "ok", trips: new Map() };
      const ids = new Set(s.from.map((f) => f.id));
      const body = {
        locations: [
          { id: "site", coords: { lat: s.to.lat, lng: s.to.lng } },
          ...s.from.map((f) => ({ id: f.id, coords: { lat: f.point.lat, lng: f.point.lng } })),
        ],
        arrival_searches: [
          {
            id: "search",
            arrival_location_id: "site",
            departure_location_ids: s.from.map((f) => f.id),
            arrival_time: isoSeconds(s.arriveBy),
            travel_time: TRAVEL_CEILING_MINUTES * 60,
            transportation: { type: s.mode === "car" ? "driving" : "public_transport" },
            properties: s.mode === "car" ? ["travel_time", "distance"] : ["travel_time"],
          },
        ],
      };
      let response: Response;
      try {
        response = await send(o.url ?? TRAVELTIME_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "X-Application-Id": o.appId,
            "X-Api-Key": o.apiKey,
          },
          body: JSON.stringify(body),
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(o.timeoutMs ?? TRAVELTIME_TIMEOUT_MS),
        });
      } catch {
        return { status: "unavailable" };
      }
      if (response.status !== 200) return { status: "unavailable" };
      if (Number(response.headers.get("content-length") ?? 0) > TRAVELTIME_MAX_BYTES) {
        return { status: "unavailable" };
      }
      let parsed: z.infer<typeof timeFilterAnswer>;
      try {
        const text = await response.text();
        if (text.length > TRAVELTIME_MAX_BYTES) return { status: "unavailable" };
        const answer = timeFilterAnswer.safeParse(JSON.parse(text));
        if (!answer.success) return { status: "unavailable" };
        parsed = answer.data;
      } catch {
        return { status: "unavailable" };
      }
      const [result] = parsed.results;
      if (!result) return { status: "ok", trips: new Map() };
      if (result.search_id !== "search") return { status: "unavailable" };
      const trips = new Map<string, Trip>();
      for (const location of result.locations) {
        // Only the ids we sent; an answer about anything else isn't ours.
        if (!ids.has(location.id)) return { status: "unavailable" };
        const p = location.properties[0];
        if (!p) continue;
        trips.set(location.id, {
          minutes: Math.ceil(p.travel_time / 60),
          metres: s.mode === "car" ? (p.distance ?? null) : null,
        });
      }
      for (const id of result.unreachable) {
        if (!ids.has(id)) return { status: "unavailable" };
        trips.set(id, null);
      }
      return { status: "ok", trips };
    },
  };
}
