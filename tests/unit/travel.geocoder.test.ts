import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serverEnv } from "../../playwright.config";
import { parseAppEnv, parseWorkerEnv } from "@/lib/env";
import {
  fakeGeocoder,
  fakePoint,
  geocoderFor,
  POSTCODES_IO_URL,
  postcodesIoGeocoder,
} from "@/lib/travel/geocoder";
import { postcodeDistrict, tidyPostcode } from "@/lib/travel/postcode";

// Postcode to coordinates (12G.1; docs/office-v2.md 5.4): the postcode helpers, the fake (made-up
// ZZ postcodes only), and postcodes.io against its answers as written down in
// tests/fixtures/postcodes-io/ (made up, in its documented shape; never the network: every call
// here goes to a fake `fetch`).

const answer = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/postcodes-io/${name}.json`, "utf8")) as unknown;

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
  return { sent, geocoder: postcodesIoGeocoder({ fetch }) };
}

describe("postcodes", () => {
  it("tidies any case and spacing, and gives the district (the outward code)", () => {
    expect(tidyPostcode(" zz1   1aa ")).toBe("ZZ1 1AA");
    expect(tidyPostcode("ZZ11AA")).toBe("ZZ1 1AA");
    expect(tidyPostcode("zz10 3bd")).toBe("ZZ10 3BD");
    expect(tidyPostcode("ZZ1A 1AA")).toBe("ZZ1A 1AA");
    for (const bad of ["", "ZZ1", "1AA ZZ1", "ZZ1 1A", "not one", "ZZ1 1AA X", "Z".repeat(13)]) {
      expect(tidyPostcode(bad), bad).toBeNull();
    }
    expect(postcodeDistrict("zz1 1aa")).toBe("ZZ1");
    expect(postcodeDistrict("ZZ10 3BD")).toBe("ZZ10");
    expect(postcodeDistrict("nope")).toBeNull();
  });
});

describe("the fake geocoder", () => {
  it("places every made-up ZZ postcode at its own fixed point, near its neighbours", async () => {
    expect(await fakeGeocoder.locate("zz1 1aa")).toEqual({
      status: "found",
      postcode: "ZZ1 1AA",
      point: { lat: 53.833, lng: -1.532 },
    });
    expect(fakePoint("ZZ2 2BB")).toEqual({ lat: 53.86627, lng: -1.51373 });
    // The same postcode, the same point, every time.
    expect(fakePoint("ZZ1 1AA")).toEqual(fakePoint("ZZ1 1AA"));
    const a = fakePoint("ZZ1 1AA");
    const b = fakePoint("ZZ9 9ZZ");
    expect(a && b && Math.abs(a.lat - b.lat) < 1 && Math.abs(a.lng - b.lng) < 1).toBe(true);
  });

  it("doesn't know district ZZ0 or a non-postcode; says a real postcode is beyond it ('off')", async () => {
    for (const p of ["ZZ0 0AA", "not one", ""]) {
      expect(await fakeGeocoder.locate(p), p).toEqual({ status: "not_found" });
    }
    // Not "unknown": look-ups aren't switched on, and the words say so.
    for (const p of ["SW1A 1AA", "ls1 4ap"]) {
      expect(await fakeGeocoder.locate(p), p).toEqual({ status: "off" });
    }
  });
});

describe("postcodes.io, against its written-down answers", () => {
  it("sends the postcode and nothing else: one GET of /postcodes/{postcode}", async () => {
    const { sent, geocoder } = replying(200, answer("found"));
    await geocoder.locate(" zz1  1aa ");
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(only?.url).toBe(`${POSTCODES_IO_URL}/postcodes/ZZ1%201AA`);
    expect(only?.init.method).toBe("GET");
    expect(only?.init.body).toBeUndefined();
    expect(only?.init.headers).toEqual({ accept: "application/json" });
    expect(only?.init.redirect).toBe("error");
    expect(only?.init.signal).toBeInstanceOf(AbortSignal);
    // Nothing but the tidy postcode in what goes out.
    expect(JSON.stringify(only)).not.toMatch(/worker|firm|name|mobile|@/i);
  });

  it("a postcode it knows: its central point, to six decimal places; the rest is ignored", async () => {
    expect(await replying(200, answer("found")).geocoder.locate("ZZ1 1AA")).toEqual({
      status: "found",
      postcode: "ZZ1 1AA",
      point: { lat: 53.831235, lng: -1.531235 },
    });
  });

  it("one it doesn't know, or not a postcode at all: not found", async () => {
    expect(await replying(404, answer("not-found")).geocoder.locate("ZZ1 1AA")).toEqual({
      status: "not_found",
    });
    expect(await replying(404, answer("invalid")).geocoder.locate("ZZ1 1AA")).toEqual({
      status: "not_found",
    });
    // One that isn't a postcode is never sent at all.
    const never = replying(200, answer("found"));
    expect(await never.geocoder.locate("not one")).toEqual({ status: "not_found" });
    expect(never.sent).toHaveLength(0);
  });

  it("one it knows with no central point: not found (it can't be placed)", async () => {
    expect(await replying(200, answer("no-point")).geocoder.locate("ZZ9 9ZZ")).toEqual({
      status: "not_found",
    });
  });

  it("anything else is 'unavailable', never a guess", async () => {
    const wrongPlace = answer("found") as { result: Record<string, unknown> };
    for (const [status, body] of [
      [500, { status: 500, error: "Internal server error" }],
      [503, "<html>down</html>"],
      [200, "not json"],
      [200, { status: 200, result: { postcode: "ZZ1 1AA", latitude: "53.8", longitude: 1 } }],
      [200, { status: 200, result: { postcode: "ZZ1 1AA", latitude: 91, longitude: 0 } }],
      [200, { status: 200 }],
      // Someone else's answer: a different postcode back.
      [200, { ...wrongPlace, result: { ...wrongPlace.result, postcode: "ZZ2 2BB" } }],
      [404, { message: "an unexpected body" }],
      [302, {}],
    ] as const) {
      expect(await replying(status, body).geocoder.locate("ZZ1 1AA"), String(status)).toEqual({
        status: "unavailable",
      });
    }
  });

  it("an answer too big to be one: unavailable, without reading it all", async () => {
    const huge = { ...(answer("found") as object), padding: "x".repeat(70 * 1024) };
    expect(await replying(200, huge).geocoder.locate("ZZ1 1AA")).toEqual({
      status: "unavailable",
    });
  });

  it("no answer in time, or no network: unavailable", async () => {
    const hanging = postcodesIoGeocoder({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    expect(await hanging.locate("ZZ1 1AA")).toEqual({ status: "unavailable" });
    const offline = postcodesIoGeocoder({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await offline.locate("ZZ1 1AA")).toEqual({ status: "unavailable" });
  });
});

describe("TRAVEL_PROVIDER", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    APP_BASE_DOMAIN: "localhost:3000",
    SESSION_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  };

  it("is fake unless set, and traveltime is refused under NODE_ENV=test (web and worker)", () => {
    expect(parseAppEnv({ ...base, NODE_ENV: "development" }).TRAVEL_PROVIDER).toBe("fake");
    expect(
      parseAppEnv({ ...base, NODE_ENV: "development", TRAVEL_PROVIDER: "" }).TRAVEL_PROVIDER,
    ).toBe("fake");
    expect(
      parseAppEnv({ ...base, NODE_ENV: "development", TRAVEL_PROVIDER: "traveltime" })
        .TRAVEL_PROVIDER,
    ).toBe("traveltime");
    expect(() => parseAppEnv({ ...base, NODE_ENV: "test", TRAVEL_PROVIDER: "traveltime" })).toThrow(
      /traveltime is refused when NODE_ENV=test/,
    );
    expect(() =>
      parseWorkerEnv({ ...base, NODE_ENV: "test", TRAVEL_PROVIDER: "traveltime" }),
    ).toThrow(/traveltime is refused when NODE_ENV=test/);
    expect(() =>
      parseAppEnv({ ...base, NODE_ENV: "development", TRAVEL_PROVIDER: "google" }),
    ).toThrow();
  });

  it("is pinned to fake for the tests and the browser tests' servers", () => {
    expect(process.env.TRAVEL_PROVIDER).toBe("fake");
    expect(serverEnv(3100, ".dev/outbox").TRAVEL_PROVIDER).toBe("fake");
  });

  it("picks the geocoder: fake, or postcodes.io for traveltime", () => {
    expect(geocoderFor("fake")).toBe(fakeGeocoder);
    expect(geocoderFor("traveltime")).not.toBe(fakeGeocoder);
  });
});
