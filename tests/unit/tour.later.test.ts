import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { logOutOfThisPhone } from "@/lib/portal/logout-client";
import { tourLaterKey } from "@/lib/tour/later-key";
import { forgetTourLater, TOUR_LATER_PREFIX, TOUR_STORE } from "@/lib/tour/steps";

// The first-login tour's "Not now" (Phase 33.2): it holds for one login, kept in the browser under a
// key the server makes from the login's id with its own secret (an HMAC, so the id can't be worked
// out or matched from the page), and it's forgotten when the person logs out on this device.

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const OTHER = "another-test-secret-at-least-32-characters-long!!";
const SESSION = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";

describe("the Not now key", () => {
  it("an HMAC of the login's id with the server's secret, short, and stable for one login", () => {
    const key = tourLaterKey(SESSION, SECRET);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(tourLaterKey(SESSION, SECRET)).toBe(key);
    expect(key).toBe(
      createHmac("sha256", SECRET).update(`tour-later:${SESSION}`).digest("hex").slice(0, 16),
    );
  });

  it("differs for another login and another secret; never the plain digest of the id", () => {
    const key = tourLaterKey(SESSION, SECRET);
    expect(tourLaterKey("7f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f", SECRET)).not.toBe(key);
    expect(tourLaterKey(SESSION, OTHER)).not.toBe(key);
    for (const plain of [SESSION, `tour-later:${SESSION}`])
      expect(createHash("sha256").update(plain).digest("hex").slice(0, 16)).not.toBe(key);
  });
});

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("logging out forgets it", () => {
  it("removes every tour's Not now and a walkthrough under way, and nothing else", () => {
    const local = memoryStorage({
      [`${TOUR_LATER_PREFIX}office`]: "abc",
      [`${TOUR_LATER_PREFIX}casual`]: "def",
      "sd-theme": "dark",
    });
    const session = memoryStorage({ [TOUR_STORE]: '{"id":"office","step":2}', other: "x" });
    forgetTourLater(local, session);
    expect([...Array(local.length).keys()].map((i) => local.key(i))).toEqual(["sd-theme"]);
    expect(session.getItem(TOUR_STORE)).toBeNull();
    expect(session.getItem("other")).toBe("x");
  });

  it("with storage switched off, it does nothing and doesn't throw", () => {
    const broken = {
      get length(): number {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => forgetTourLater(broken, broken)).not.toThrow();
  });

  it("is a step of logging out on this phone or laptop, before the request (office and casual)", async () => {
    for (const kind of ["office", "worker"] as const) {
      const order: string[] = [];
      const result = await logOutOfThisPhone(kind, {
        clearCopy: async () => {
          order.push("copy");
          return true;
        },
        forgetPush: async () => void order.push("push"),
        forgetTour: () => void order.push("tour"),
        logOut: async () => {
          order.push("logout");
          return "no_signal";
        },
      });
      expect(result.outcome).toBe("no_signal");
      expect(order.indexOf("tour")).toBeGreaterThan(-1);
      expect(order.indexOf("tour")).toBeLessThan(order.indexOf("logout"));
    }
  });
});
