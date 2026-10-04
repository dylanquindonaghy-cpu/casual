import { afterEach, describe, expect, it, vi } from "vitest";
import { logOut, logOutOfThisPhone, logoutProblemText } from "@/lib/portal/logout-client";

// Logging out from the browser: a plain request to /api/logout (works from a page kept from any
// later build: audit L92), in a fixed order on the phone, and what the button says when it
// couldn't (audit L91).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("logOut", () => {
  it("posts the kind to /api/logout, same origin only, with a time limit", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ status: "done" }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await logOut("worker")).toBe("done");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/logout");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "worker" }),
      credentials: "same-origin",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("no signal (the request failed), weak signal (no answer in time), or an answer that isn't a yes", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await logOut("worker")).toBe("no_signal");
    // A request that hangs: the limit ends it.
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("t", "TimeoutError")),
          ),
        ),
    );
    expect(await logOut("worker", 50)).toBe("no_signal");
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    expect(await logOut("office")).toBe("error");
  });
});

describe("logging out of this phone", () => {
  const run = async (outcome: "done" | "no_signal" | "error", cleared = true) => {
    const steps: string[] = [];
    const result = await logOutOfThisPhone("worker", {
      clearCopy: async () => {
        steps.push("clear copy");
        return cleared;
      },
      forgetPush: async () => {
        steps.push("forget push");
      },
      logOut: async (kind) => {
        steps.push(`log out ${kind}`);
        return outcome;
      },
    });
    return { result, steps };
  };

  it("the copy first, then the alerts, then the session; once ended, the copy again", async () => {
    expect(await run("done")).toEqual({
      result: { outcome: "done", copyCleared: true },
      steps: ["clear copy", "forget push", "log out worker", "clear copy"],
    });
  });

  it("not logged out: the copy is gone anyway, and only once", async () => {
    expect(await run("no_signal", false)).toEqual({
      result: { outcome: "no_signal", copyCleared: false },
      steps: ["clear copy", "forget push", "log out worker"],
    });
  });
});

describe("what the button says", () => {
  it("only what we know: maybe still logged in, and (for a worker) the copy gone if it is", () => {
    expect(logoutProblemText("worker", "no_signal", true)).toBe(
      "No signal. You may still be logged in. Your shifts are no longer kept on this phone. Try again when you have signal.",
    );
    expect(logoutProblemText("worker", "no_signal", false)).toBe(
      "No signal. You may still be logged in. Try again when you have signal.",
    );
    expect(logoutProblemText("office", "no_signal", true)).toBe(
      "No signal. You may still be logged in. Try again when you have signal.",
    );
    expect(logoutProblemText("worker", "error", true)).toBe("Logging out didn't work. Try again.");
  });
});
