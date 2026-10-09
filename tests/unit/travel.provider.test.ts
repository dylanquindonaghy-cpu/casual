import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPEN_WINDOW_DAYS } from "@/lib/portal/open-shifts";
import { parseWorkerEnv } from "@/lib/env";
import { ESTIMATE_WINDOW_DAYS, travelEstimatesPayload } from "@/lib/travel/estimate-queue";
import { straightLineMetres } from "@/lib/travel/distance";
import { travelLineText, type TravelFacts } from "@/lib/travel/line-copy";
import {
  fakeTravelProvider,
  fakeTrip,
  SEARCH_MAX_ORIGINS,
  TRAVELTIME_URL,
  travelTimeProvider,
  type TravelSearch,
} from "@/lib/travel/provider";

// Travel times (12G.2; docs/office-v2.md 5.4): the fake, TravelTime against its answers as written
// down in tests/fixtures/traveltime/ (made up, in its documented shape; every call here goes to a
// fake `fetch`, never the network), the travel line's words, and the job's payload.

const answer = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/traveltime/${name}.json`, "utf8")) as unknown;

const SITE = { lat: 53.833, lng: -1.532 }; // ZZ1 1AA's fake point
const search = (o: Partial<TravelSearch> = {}): TravelSearch => ({
  to: SITE,
  arriveBy: new Date("2026-11-07T13:30:00Z"),
  mode: "car",
  from: [
    { id: "o1", point: { lat: 53.866, lng: -1.514 } },
    { id: "o2", point: { lat: 54.1, lng: -1.38 } },
    { id: "o3", point: { lat: 55.9, lng: -3.2 } },
  ],
  ...o,
});

type Sent = { url: string; init: RequestInit };
function replying(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { sent, provider: travelTimeProvider({ appId: "app-id", apiKey: "api-key", fetch }) };
}
const bodyOf = (s: Sent | undefined) => JSON.parse(String(s?.init.body)) as Record<string, unknown>;

describe("the fake travel provider", () => {
  it("works times out from the straight line; over 90 minutes is out of reach", async () => {
    expect(fakeTrip({ lat: 53.866, lng: -1.514 }, SITE, "car")).toEqual({
      minutes: 13,
      metres: 5012,
    });
    expect(fakeTrip({ lat: 53.866, lng: -1.514 }, SITE, "public_transport")).toEqual({
      minutes: 27,
      metres: null,
    });
    expect(fakeTrip({ lat: 55.9, lng: -3.2 }, SITE, "car")).toBeNull();
    const result = await fakeTravelProvider.search(search());
    expect(result.status === "ok" && [...result.trips.keys()]).toEqual(["o1", "o2", "o3"]);
    expect(result.status === "ok" && result.trips.get("o3")).toBeNull();
  });

  it("takes at most 2,000 start points a search", async () => {
    const many = Array.from({ length: SEARCH_MAX_ORIGINS + 1 }, (_, i) => ({
      id: `o${i + 1}`,
      point: SITE,
    }));
    await expect(fakeTravelProvider.search(search({ from: many }))).rejects.toThrow(/2000/);
    await expect(
      fakeTravelProvider.search(search({ from: many.slice(0, SEARCH_MAX_ORIGINS) })),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("the straight line between two points", () => {
    expect(straightLineMetres(SITE, SITE)).toBe(0);
    // About 69 miles a degree of latitude.
    expect(straightLineMetres({ lat: 53, lng: -1.5 }, { lat: 54, lng: -1.5 })).toBe(111195);
  });
});

describe("TravelTime, against its written-down answers", () => {
  it("sends one arrival search: coordinates and meaningless ids only, nothing personal", async () => {
    const { sent, provider } = replying(200, answer("car"));
    await provider.search(search());
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(only?.url).toBe(TRAVELTIME_URL);
    expect(only?.init.method).toBe("POST");
    expect(only?.init.redirect).toBe("error");
    expect(only?.init.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      "X-Application-Id": "app-id",
      "X-Api-Key": "api-key",
    });
    expect(bodyOf(only)).toEqual({
      locations: [
        { id: "site", coords: SITE },
        { id: "o1", coords: { lat: 53.866, lng: -1.514 } },
        { id: "o2", coords: { lat: 54.1, lng: -1.38 } },
        { id: "o3", coords: { lat: 55.9, lng: -3.2 } },
      ],
      arrival_searches: [
        {
          id: "search",
          arrival_location_id: "site",
          departure_location_ids: ["o1", "o2", "o3"],
          arrival_time: "2026-11-07T13:30:00Z",
          travel_time: 5400,
          transportation: { type: "driving" },
          properties: ["travel_time", "distance"],
        },
      ],
    });
    // No postcode, name, phone number, email or database id anywhere in what's sent.
    const text = String(only?.init.body);
    expect(text).not.toMatch(/ZZ\d|[A-Z]{1,2}\d[A-Z0-9]? \d[A-Z]{2}/);
    expect(text).not.toMatch(/@|\+44|07700|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("by car: minutes (rounded up) and metres; out of reach is null", async () => {
    const result = await replying(200, answer("car")).provider.search(search());
    expect(result).toEqual({
      status: "ok",
      trips: new Map([
        ["o1", { minutes: 18, metres: 11587 }],
        ["o2", { minutes: 42, metres: 30410 }],
        ["o3", null],
      ]),
    });
  });

  it("by public transport: no distance asked for; out of reach is null", async () => {
    const { sent, provider } = replying(200, answer("public-transport"));
    const result = await provider.search(search({ mode: "public_transport" }));
    const [s] = (bodyOf(sent[0]).arrival_searches as Record<string, unknown>[]) ?? [];
    expect(s?.transportation).toEqual({ type: "public_transport" });
    expect(s?.properties).toEqual(["travel_time"]);
    expect(result).toEqual({
      status: "ok",
      trips: new Map([
        ["o1", { minutes: 41, metres: null }],
        ["o2", null],
        ["o3", null],
      ]),
    });
  });

  it("an error, an odd answer, someone else's ids: unavailable, never a guess", async () => {
    const car = answer("car") as { results: Record<string, unknown>[] };
    const first = car.results[0] ?? {};
    for (const [status, body] of [
      [422, answer("error")],
      [500, "<html>down</html>"],
      [200, "not json"],
      [200, { results: "nope" }],
      [200, { results: [{ ...first, search_id: "another" }] }],
      [200, { results: [{ ...first, unreachable: ["o9"] }] }],
      [
        200,
        {
          results: [{ ...first, locations: [{ id: "o1", properties: [{ travel_time: 5401 }] }] }],
        },
      ],
      [200, { results: [first, first] }],
    ] as const) {
      expect(await replying(status, body).provider.search(search()), String(status)).toEqual({
        status: "unavailable",
      });
    }
  });

  it("no answer in time, no network, or too big an answer: unavailable", async () => {
    const hanging = travelTimeProvider({
      appId: "a",
      apiKey: "k",
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    expect(await hanging.search(search())).toEqual({ status: "unavailable" });
    const offline = travelTimeProvider({
      appId: "a",
      apiKey: "k",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await offline.search(search())).toEqual({ status: "unavailable" });
    const huge = { results: [], padding: "x".repeat(2.1 * 1024 * 1024) };
    expect(await replying(200, huge).provider.search(search())).toEqual({ status: "unavailable" });
  });

  it("nothing to search: no call; more than 2,000: refused before any call", async () => {
    const { sent, provider } = replying(200, answer("car"));
    expect(await provider.search(search({ from: [] }))).toEqual({ status: "ok", trips: new Map() });
    const many = Array.from({ length: SEARCH_MAX_ORIGINS + 1 }, (_, i) => ({
      id: `o${i + 1}`,
      point: SITE,
    }));
    await expect(provider.search(search({ from: many }))).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("the arrive-by time is absolute, so the clock change can't move it", async () => {
    const { sent, provider } = replying(200, answer("car"));
    // Sun 25 Oct 2026: clocks go back at 02:00 BST. 00:50 UTC is 01:50 BST, before the change.
    await provider.search(search({ arriveBy: new Date("2026-10-25T00:50:00Z") }));
    const [s] = (bodyOf(sent[0]).arrival_searches as Record<string, unknown>[]) ?? [];
    expect(s?.arrival_time).toBe("2026-10-25T00:50:00Z");
  });
});

describe("TravelTime's settings", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    APP_BASE_DOMAIN: "localhost:3000",
    SESSION_SECRET: "a-test-secret-that-is-long-enough-0123456789",
    NODE_ENV: "development",
  };
  it("traveltime needs both keys (worker); never in tests", () => {
    expect(() => parseWorkerEnv({ ...base, TRAVEL_PROVIDER: "traveltime" })).toThrow(
      /needs TRAVELTIME_APP_ID and TRAVELTIME_API_KEY/,
    );
    expect(
      parseWorkerEnv({
        ...base,
        TRAVEL_PROVIDER: "traveltime",
        TRAVELTIME_APP_ID: "a",
        TRAVELTIME_API_KEY: "k",
      }).TRAVEL_PROVIDER,
    ).toBe("traveltime");
    expect(process.env.TRAVELTIME_API_KEY).toBe("");
  });
});

describe("the travel line's words", () => {
  const TZ = "Europe/London";
  const arriveBy = new Date("2026-11-07T09:00:00Z");
  const facts = (o: Partial<Extract<TravelFacts, { kind: "estimated" }>> = {}): TravelFacts => ({
    kind: "estimated",
    straightMetres: 9000,
    arriveBy,
    car: { minutes: 18, metres: 11587 },
    publicTransport: { minutes: 41 },
    ...o,
  });
  it("worked out: the road distance and both times", () => {
    expect(travelLineText(facts(), TZ)).toBe(
      "7.2 miles · 18 min by car · 41 min by public transport",
    );
    expect(travelLineText(facts({ publicTransport: null }), TZ)).toBe(
      "7.2 miles · 18 min by car · no public transport by 09:00",
    );
    expect(travelLineText(facts({ car: null }), TZ)).toBe(
      "about 6 miles (straight line) · over 90 min by car · 41 min by public transport",
    );
  });

  it("the provider down, or not worked out yet: the straight line, labelled", () => {
    expect(travelLineText({ kind: "straight", straightMetres: 11300 }, TZ)).toBe(
      "about 7 miles (straight line) · Travel time not known yet",
    );
    expect(travelLineText({ kind: "straight", straightMetres: 300 }, TZ)).toBe(
      "about 1 mile (straight line) · Travel time not known yet",
    );
    expect(travelLineText({ kind: "unknown" }, TZ)).toBe("Distance not known yet");
  });

  it("arrive-by in the firm's time, across the clock change", () => {
    // A 01:20 GMT start on 25 Oct 2026 means arriving by 00:50 UTC: 01:50 BST, before the change.
    expect(
      travelLineText(
        facts({ arriveBy: new Date("2026-10-25T00:50:00Z"), publicTransport: null }),
        TZ,
      ),
    ).toBe("7.2 miles · 18 min by car · no public transport by 01:50");
  });
});

describe("the travel job's payload", () => {
  const firmId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("sessions or the window, ids only; at most 200 sessions", () => {
    const id = "1f8fad5b-d9cb-469f-a165-70867728950e";
    const ok = (p: object) => travelEstimatesPayload.safeParse({ firmId, ...p }).success;
    expect(ok({ idempotencyKey: "travel-estimates:abc", shiftIds: [id] })).toBe(true);
    expect(ok({ idempotencyKey: "travel-estimates:window-2026-11-02", window: true })).toBe(true);
    expect(ok({ idempotencyKey: "travel-estimates:abc", shiftIds: [id], window: true })).toBe(
      false,
    );
    expect(ok({ idempotencyKey: "travel-estimates:abc" })).toBe(false);
    expect(ok({ idempotencyKey: "travel-estimates:abc", shiftIds: ["ZZ1 1AA"] })).toBe(false);
    expect(
      ok({
        idempotencyKey: "travel-estimates:abc",
        shiftIds: Array.from({ length: 201 }, () => id),
      }),
    ).toBe(false);
  });

  it("the nightly window is the open-shifts window", () => {
    expect(ESTIMATE_WINDOW_DAYS).toBe(OPEN_WINDOW_DAYS);
  });
});
