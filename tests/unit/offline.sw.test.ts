import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/home-view";
import { BookedView } from "@/app/shifts/booked-view";
import { offlineCopyOn } from "@/lib/env";
import { logOutOfThisPhone } from "@/lib/portal/logout-client";
import {
  clearOfflineCopy,
  OFFLINE_CACHE,
  OFFLINE_FORGOT_CACHE,
  watchForFreshCopy,
} from "@/lib/portal/offline";

// public/sw.js, the service worker that keeps My shifts for when there's no signal, run as it is
// in a sandbox: a fake cache store, a fake network and fake fetch events. Service workers only run
// in a browser; the e2e test (tests/e2e/offline.worker.spec.ts) runs it in one too.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const SOURCE = readFileSync("public/sw.js", "utf8");
const ORIGIN = "http://acme.localhost:3100";
const DAY = 86_400_000;

type Req = { url: string; method: string; mode: string };
const req = (path: string, o: Partial<Req> = {}): Req => ({
  url: new URL(path, ORIGIN).href,
  method: "GET",
  mode: "no-cors",
  ...o,
});
const navigate = (path = "/") => req(path, { mode: "navigate" });
const key = (r: Req | string | Request) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  async match(r: Req | string) {
    return this.entries.get(key(r))?.clone();
  }
  async put(r: Req | string, response: Response) {
    this.entries.set(key(r), response.clone());
  }
  async delete(r: Req | string | Request) {
    return this.entries.delete(key(r));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  paths() {
    return [...this.entries.keys()].map((url) => new URL(url).pathname).sort();
  }
}
class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name) as FakeCache;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

// A same-origin answer as a browser would give it (type "basic"), clones included.
function answer(
  body: string,
  status = 200,
  redirected = false,
  headers: Record<string, string> = {},
): Response {
  const make = (r: Response): Response => {
    const clone = r.clone.bind(r);
    Object.defineProperty(r, "type", { value: "basic" });
    Object.defineProperty(r, "redirected", { value: redirected });
    r.clone = () => make(clone());
    return r;
  };
  return make(new Response(body, { status, headers: { "content-type": "text/html", ...headers } }));
}
// A redirect a navigation fetch doesn't follow (the browser does): what "logged out" looks like.
const opaqueRedirect = () =>
  ({
    type: "opaqueredirect",
    status: 0,
    ok: false,
    redirected: false,
    headers: new Headers(),
    clone() {
      return this;
    },
  }) as unknown as Response;

type Handler = (event: unknown) => void;
type Init = { credentials?: string; redirect?: string };
function loadWorker(
  network: (r: Req | string, init?: Init) => Promise<Response>,
  clock = { now: 0 },
  caches = new FakeCaches(),
) {
  const listeners: Record<string, Handler> = {};
  const fetched: string[] = [];
  const inits: Record<string, Init | undefined> = {};
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const calls: { path: string; init?: Init & { method?: string; body?: string } }[] = [];
  const resubscribed: unknown[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const windows: { url: string; focus: () => Promise<void> }[] = [];
  const sandbox = vm.createContext({
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: Handler) => (listeners[type] = fn),
      skipWaiting: () => undefined,
      clients: {
        claim: async () => undefined,
        matchAll: async () => windows,
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
      registration: {
        showNotification: async (title: string, options: (typeof shown)[number]["options"]) => {
          shown.push({ title, options });
        },
        pushManager: {
          subscribe: async (options: unknown) => {
            resubscribed.push(options);
            return {
              endpoint: "https://fcm.googleapis.com/fcm/send/renewed",
              toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/renewed", keys: {} }),
            };
          },
        },
      },
    },
    caches,
    fetch: (r: Req | string, init?: Init) => {
      fetched.push(new URL(key(r)).pathname);
      inits[new URL(key(r)).pathname] = init;
      calls.push({ path: new URL(key(r)).pathname, init });
      return network(r, init);
    },
    Request,
    Response,
    Headers,
    URL,
    Set,
    Number,
    Promise,
    Date: { now: () => clock.now },
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  });
  vm.runInContext(SOURCE, sandbox);
  return {
    listeners,
    caches,
    fetched,
    inits,
    shown,
    calls,
    resubscribed,
    opened,
    focused,
    windows,
    sandbox: sandbox as unknown as Record<string, unknown>,
  };
}

// Dispatches a fetch event; `handled` is null when the worker let the request pass through.
function dispatch(w: ReturnType<typeof loadWorker>, request: Req) {
  let handled: Promise<Response> | null = null;
  const pending: Promise<unknown>[] = [];
  w.listeners.fetch?.({
    request,
    respondWith: (p: Promise<Response>) => (handled = Promise.resolve(p)),
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  });
  const settled = async () => {
    while (pending.length > 0) await pending.shift();
  };
  return { handled: handled as Promise<Response> | null, settled };
}

// Sends the page's "keep this now" message and waits for the worker to finish.
async function keepMessage(w: ReturnType<typeof loadWorker>) {
  const pending: Promise<unknown>[] = [];
  w.listeners.message?.({
    data: { type: "keep-my-shifts" },
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  });
  await Promise.all(pending);
}

const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="/_next/static/css/app.css">
<script src="/_next/static/chunks/main.js" async></script></head><body>
<h1>Hello Sam</h1><p>Updated 09:00 on Mon 2 Nov</p>
<div data-offline-notice="" hidden="" role="status"><p>No signal.</p></div>
<div hidden="">not this one</div>
<script>self.__next_f.push([1,"\\"/_next/static/chunks/flight.js\\""])</script>
</body></html>`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("which requests the service worker answers", () => {
  it("only opening My shifts, and the site's own styles and scripts", async () => {
    const w = loadWorker(async () => answer("x"));
    const answers = (r: Req) => dispatch(w, r).handled !== null;
    expect(answers(navigate("/"))).toBe(true);
    expect(answers(req("/_next/static/chunks/main.js"))).toBe(true);
    // Everything else goes straight to the network.
    expect(answers(navigate("/?view=past"))).toBe(false);
    expect(answers(navigate("/profile"))).toBe(false);
    expect(answers(navigate("/pay"))).toBe(false);
    expect(answers(navigate("/office"))).toBe(false);
    expect(answers(req("/", { mode: "cors" }))).toBe(false); // not opening the page
    expect(answers(req("/?_rsc=abc", { mode: "cors" }))).toBe(false); // a page's data
    expect(answers(req("/", { method: "POST", mode: "navigate" }))).toBe(false); // an action
    expect(answers(req("https://example.com/_next/static/x.js"))).toBe(false);
    // Photos and certificate images (12F.2) are never kept: always the network, with the server's
    // access check and "private, no-store".
    expect(answers(req("/files/7c1d2e3f-0000-4000-8000-000000000001"))).toBe(false);
    expect(answers(navigate("/files/7c1d2e3f-0000-4000-8000-000000000001"))).toBe(false);
    expect(answers(req("/_next/static/../../files/7c1d2e3f-0000-4000-8000-000000000001"))).toBe(
      false,
    );
  });

  it("shares its cache names with the page (which deletes the copy on logout and login)", () => {
    expect(SOURCE).toContain(`const CACHE = "${OFFLINE_CACHE}";`);
    expect(SOURCE).toContain(`const FORGOT = "${OFFLINE_FORGOT_CACHE}";`);
    // The marker's key and header, and the copy's time header, as the page writes and reads them.
    const page = readFileSync("src/lib/portal/offline.ts", "utf8");
    for (const constant of ["FORGOT_KEY", "FORGOT_AT", "KEPT_AT"]) {
      const value = new RegExp(`const ${constant} = ("[^"]+");`);
      expect(SOURCE.match(value)?.[1], constant).toBe(page.match(value)?.[1]);
    }
  });
});

describe("keeping the copy", () => {
  it("answers from the network, then keeps the page and the files it names", async () => {
    const w = loadWorker(
      async (r) =>
        key(r).endsWith("/")
          ? answer(PAGE, 200, false, { "content-encoding": "gzip", "content-length": "9" })
          : answer("file"),
      { now: 1000 },
    );
    const cache = await w.caches.open(OFFLINE_CACHE);
    await cache.put("/_next/static/chunks/old.js", new Response("old")); // from an earlier build
    const { handled, settled } = dispatch(w, navigate());
    const page = await (await handled)?.text();
    expect(page).toBe(PAGE); // exactly what the server sent: the notice stays hidden
    await settled();
    expect(cache.paths()).toEqual([
      "/",
      "/_next/static/chunks/flight.js",
      "/_next/static/chunks/main.js",
      "/_next/static/css/app.css",
    ]);
    // Kept with only what's needed to show it again; the files fetched without cookies.
    const kept = await cache.match("/");
    expect([...(kept?.headers.keys() ?? [])].sort()).toEqual([
      "content-type",
      "x-shiftdesk-kept-at",
    ]);
    expect(kept?.headers.get("x-shiftdesk-kept-at")).toBe("1000");
    expect(w.inits["/_next/static/css/app.css"]).toEqual({ credentials: "omit" });
  });

  it("never keeps a page the firm's text points at, however it's written", async () => {
    const tricky = `${PAGE}<p>Meet at /_next/static/../../pay or /_next/static/%2e%2e/%2e%2e/requests
      or /_next/static/..%2f..%2foffice</p>`;
    const w = loadWorker(async (r) => answer(key(r).endsWith("/") ? tricky : "file"));
    const { settled } = dispatch(w, navigate());
    await settled();
    const cache = await w.caches.open(OFFLINE_CACHE);
    for (const path of cache.paths())
      expect(path === "/" || path.startsWith("/_next/static/")).toBe(true);
    expect(w.fetched.filter((p) => !p.startsWith("/_next/static/"))).toEqual(["/"]);
  });

  it("keeps the page when asked by the page (shown after logging in, or going back to it)", async () => {
    const clock = { now: 60_000 };
    const w = loadWorker(async (r) => answer(key(r).endsWith("/") ? PAGE : "file"), clock);
    await keepMessage(w);
    const cache = await w.caches.open(OFFLINE_CACHE);
    expect(cache.paths()).toContain("/");
    expect(w.inits["/"]).toEqual({ redirect: "manual", credentials: "same-origin" });
    // Asked again within 10 seconds of a copy: nothing fetched.
    const before = w.fetched.length;
    clock.now += 9_000;
    await keepMessage(w);
    expect(w.fetched.length).toBe(before);
    // Later: fetched and kept again.
    clock.now += 2_000;
    await keepMessage(w);
    expect(w.fetched.length).toBeGreaterThan(before);
  });

  it("forgets the copy when asked to keep it but the worker is logged out", async () => {
    const w = loadWorker(async () => opaqueRedirect(), { now: 60_000 });
    const cache = await w.caches.open(OFFLINE_CACHE);
    await cache.put("/", new Response(PAGE, { headers: { "x-shiftdesk-kept-at": "1" } }));
    await keepMessage(w);
    expect(cache.paths()).toEqual([]);
  });

  it("if its own storage fails, still opens the page from the network", async () => {
    const broken = new FakeCaches();
    broken.open = () => Promise.reject(new Error("storage broken"));
    const w = loadWorker(async () => answer(PAGE), { now: 0 }, broken);
    expect(await (await dispatch(w, navigate()).handled)?.text()).toBe(PAGE);
    expect(await (await dispatch(w, req("/_next/static/css/app.css")).handled)?.text()).toBe(PAGE);
  });

  it("forgets it when the server says the worker isn't logged in", async () => {
    for (const loggedOut of [
      opaqueRedirect(),
      answer("", 200, true),
      answer("", 401),
      answer("", 403),
      answer("", 404),
    ]) {
      const w = loadWorker(async () => loggedOut);
      const cache = await w.caches.open(OFFLINE_CACHE);
      await cache.put("/", answer(PAGE));
      await cache.put("/_next/static/css/app.css", new Response("css"));
      const { handled, settled } = dispatch(w, navigate());
      expect(await handled).toBe(loggedOut); // the browser follows it to the login page
      await settled();
      expect(cache.paths()).toEqual([]);
    }
  });

  it("keeps the old copy through a server error", async () => {
    const w = loadWorker(async () => answer("Something went wrong", 500), { now: 5 });
    const cache = await w.caches.open(OFFLINE_CACHE);
    const kept = new Headers({ "x-shiftdesk-kept-at": "1" });
    await cache.put("/", new Response(PAGE, { headers: kept }));
    const { handled, settled } = dispatch(w, navigate());
    expect((await handled)?.status).toBe(500);
    await settled();
    expect(await (await cache.match("/"))?.text()).toBe(PAGE);
  });
});

describe("with no signal", () => {
  const withCopy = async (w: ReturnType<typeof loadWorker>, keptAt: number) => {
    const cache = await w.caches.open(OFFLINE_CACHE);
    await cache.put(
      "/",
      new Response(PAGE, { headers: { "x-shiftdesk-kept-at": String(keptAt) } }),
    );
    await cache.put("/_next/static/css/app.css", new Response("css"));
    return cache;
  };

  it("opens the kept copy, with its No signal notice showing", async () => {
    const w = loadWorker(() => Promise.reject(new TypeError("offline")), { now: 2 * DAY });
    await withCopy(w, DAY);
    const page = await (await dispatch(w, navigate()).handled)?.text();
    // Its notice shows, marked with when the copy was kept (the page watches for a newer one).
    expect(page).toContain(`<div data-offline-notice="" role="status" data-kept-at="${DAY}">`);
    expect(page).toContain('<div hidden="">not this one</div>'); // nothing else unhidden
    expect(page).toContain("Updated 09:00 on Mon 2 Nov");
    // And the styles come from the copy.
    const css = await dispatch(w, req("/_next/static/css/app.css")).handled;
    expect(await css?.text()).toBe("css");
  });

  it("with poor signal, opens the kept copy after 4 seconds, then updates it when the answer comes", async () => {
    vi.useFakeTimers();
    let arrive: (r: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => (arrive = resolve));
    const w = loadWorker((r) => (key(r).endsWith("/") ? slow : Promise.resolve(answer("file"))), {
      now: 2 * DAY,
    });
    const cache = await withCopy(w, DAY);
    const { handled, settled } = dispatch(w, navigate());
    await vi.advanceTimersByTimeAsync(3_999);
    let shown: Response | undefined;
    void handled?.then((r) => (shown = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toBeUndefined(); // still waiting for the network
    await vi.advanceTimersByTimeAsync(1);
    expect(await shown?.text()).toContain(
      `<div data-offline-notice="" role="status" data-kept-at="${DAY}">`,
    );
    arrive(answer(PAGE.replace("09:00", "09:07")));
    await settled();
    expect(await (await cache.match("/"))?.text()).toContain("Updated 09:07");
  });

  it("with no copy, or one older than 14 days, shows a plain No signal page", async () => {
    const offline = () => Promise.reject(new TypeError("offline"));
    const empty = loadWorker(offline);
    const none = await dispatch(empty, navigate()).handled;
    expect(none?.status).toBe(503);
    expect(await none?.text()).toContain(
      "Your shifts will open here without signal once you've opened them with signal.",
    );

    const old = loadWorker(offline, { now: 15 * DAY + 1 });
    const cache = await withCopy(old, DAY);
    const expired = await dispatch(old, navigate()).handled;
    expect(expired?.status).toBe(503);
    expect(cache.paths()).toEqual([]); // and it's gone
  });

  it("a kept style or script comes from the copy even with signal (its name changes with it)", async () => {
    const w = loadWorker(async () => answer("from the network"));
    await (
      await w.caches.open(OFFLINE_CACHE)
    ).put("/_next/static/css/app.css", new Response("css"));
    const css = await dispatch(w, req("/_next/static/css/app.css")).handled;
    expect(await css?.text()).toBe("css");
    expect(w.fetched).toEqual([]);
  });

  it("a style or script it doesn't have goes to the network as usual", async () => {
    const w = loadWorker(() => Promise.reject(new TypeError("offline")));
    await expect(dispatch(w, req("/_next/static/chunks/other.js")).handled).rejects.toThrow(
      "offline",
    );
  });
});

// Poor signal at a venue, with the page's own side (src/lib/portal/offline.ts) run against the same
// cache store, on one clock: the page's clearOfflineCopy() on logout and login, and its watcher.
describe("with a slow network, logging out, logging in and the fresh page (audit M27, L90)", () => {
  const T = 2 * DAY;
  // The worker's clock is the test's (fake) clock, so the page and the worker agree on "now".
  const sharedClock = {
    get now() {
      return Date.now();
    },
  };
  const slowPage = () => {
    let arrive: (r: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => (arrive = resolve));
    return { slow, arrive: (r: Response) => arrive(r) };
  };
  const keptCopy = async (w: ReturnType<typeof loadWorker>, keptAt: number) => {
    const cache = await w.caches.open(OFFLINE_CACHE);
    await cache.put(
      "/",
      new Response(PAGE, { headers: { "x-shiftdesk-kept-at": String(keptAt) } }),
    );
  };
  const keptPage = async (w: ReturnType<typeof loadWorker>) =>
    (await w.caches.has(OFFLINE_CACHE))
      ? await (await (await w.caches.open(OFFLINE_CACHE)).match("/"))?.text()
      : undefined;

  it("logging out while the page is still loading: the late answer is never kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const net = slowPage();
    const w = loadWorker(
      (r) => (key(r).endsWith("/") ? net.slow : Promise.resolve(answer("f"))),
      sharedClock,
    );
    vi.stubGlobal("caches", w.caches);
    await keptCopy(w, DAY);
    const { handled, settled } = dispatch(w, navigate());
    await vi.advanceTimersByTimeAsync(4_000); // no answer yet: the kept copy shows
    expect(await (await handled)?.text()).toContain("No signal.");
    await vi.advanceTimersByTimeAsync(1_000);
    await clearOfflineCopy(); // "Log out"
    expect(await keptPage(w)).toBeUndefined();
    // The answer to the load from before the logout arrives (a 200: it was asked while logged in).
    net.arrive(answer(PAGE.replace("Sam", "Sam again")));
    await settled();
    expect(await keptPage(w)).toBeUndefined();
  });

  it("an answer being written as the logout comes is removed straight after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const w = loadWorker(
      async (r) => (key(r).endsWith("/") ? answer(PAGE) : answer("f")),
      sharedClock,
    );
    vi.stubGlobal("caches", w.caches);
    // The page writes its "forgotten at" mark just as the worker stores the page (and its delete of
    // the copy hasn't happened: it raced its 1.5-second limit, say).
    const cache = await w.caches.open(OFFLINE_CACHE);
    const put = cache.put.bind(cache);
    cache.put = async (r, response) => {
      if (key(r).endsWith("/")) {
        vi.setSystemTime(Date.now() + 5);
        await (
          await w.caches.open(OFFLINE_FORGOT_CACHE)
        ).put(
          "/forgot",
          new Response("", { headers: { "x-shiftdesk-forgot-at": String(Date.now()) } }),
        );
      }
      return put(r, response);
    };
    await dispatch(w, navigate()).settled();
    expect(await keptPage(w)).toBeUndefined();
  });

  it("logging in while the last worker's page is still loading keeps only the new worker's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const before = slowPage();
    let calls = 0;
    const w = loadWorker((r) => {
      if (!key(r).endsWith("/")) return Promise.resolve(answer("f"));
      calls += 1;
      return calls === 1 ? before.slow : Promise.resolve(answer(PAGE.replace("Sam", "Kim")));
    }, sharedClock);
    vi.stubGlobal("caches", w.caches);
    const first = dispatch(w, navigate()); // the last worker's page, on its way
    await vi.advanceTimersByTimeAsync(1_000);
    await clearOfflineCopy(); // the new worker logs in on this phone
    await vi.advanceTimersByTimeAsync(1);
    await dispatch(w, navigate()).settled(); // the new worker's My shifts
    before.arrive(answer(PAGE)); // then the last worker's answer turns up
    await first.settled();
    expect(await keptPage(w)).toContain("Hello Kim");
  });

  it("a slow but working signal: the fresh page replaces the kept copy as soon as it's kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const net = slowPage();
    const w = loadWorker(
      (r) => (key(r).endsWith("/") ? net.slow : Promise.resolve(answer("f"))),
      sharedClock,
    );
    vi.stubGlobal("caches", w.caches);
    await keptCopy(w, DAY);
    const { handled, settled } = dispatch(w, navigate());
    await vi.advanceTimersByTimeAsync(4_000);
    const shown = (await (await handled)?.text()) ?? "";
    const shownKeptAt = shown.match(/data-kept-at="(\d+)"/)?.[1] ?? "";
    expect(shownKeptAt).toBe(String(DAY));
    // The page watches; the answer arrives 3 seconds later and is kept.
    const went: string[] = [];
    const stop = watchForFreshCopy({ shownKeptAt, go: (path) => went.push(path), everyMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(went).toEqual([]);
    net.arrive(answer(PAGE.replace("09:00", "09:07")));
    await settled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(went).toEqual(["/?fresh"]);
    stop();
    // `/?fresh` is answered with that copy, as the server sent it (no notice), without the network.
    const fetchedBefore = w.fetched.length;
    const fresh = await (await dispatch(w, navigate("/?fresh")).handled)?.text();
    expect(fresh).toContain("Updated 09:07");
    expect(fresh).toContain('<div data-offline-notice="" hidden="" role="status">');
    expect(w.fetched.length).toBe(fetchedBefore);
  });

  it("the answer says logged out instead: the page goes to the network (and the login page)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const net = slowPage();
    const w = loadWorker(
      (r) => (key(r).endsWith("/") ? net.slow : Promise.resolve(answer("f"))),
      sharedClock,
    );
    vi.stubGlobal("caches", w.caches);
    await keptCopy(w, DAY);
    const { settled } = dispatch(w, navigate());
    await vi.advanceTimersByTimeAsync(4_000);
    const went: string[] = [];
    watchForFreshCopy({ shownKeptAt: String(DAY), go: (path) => went.push(path), everyMs: 1_000 });
    net.arrive(opaqueRedirect());
    await settled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(went).toEqual(["/"]);
  });

  it("`/?fresh` with no recent copy goes to the network as usual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const w = loadWorker(async () => answer("from the network"), sharedClock);
    await keptCopy(w, T - 3 * 60 * 1000); // kept 3 minutes ago: not "just kept"
    expect(await (await dispatch(w, navigate("/?fresh")).handled)?.text()).toBe("from the network");
    const empty = loadWorker(async () => answer("from the network"), sharedClock);
    expect(await (await dispatch(empty, navigate("/?fresh")).handled)?.text()).toBe(
      "from the network",
    );
  });

  // The reviews of this task: logging out from the kept copy deleted it, the watcher saw it gone
  // and opened My shifts again (the no-signal message vanished; on slow signal, the page was kept
  // again with the session still live).
  it("a logout from the kept copy stops the watcher; a load that started meanwhile is never kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const later = slowPage();
    const w = loadWorker(
      (r) => (key(r).endsWith("/") ? later.slow : Promise.resolve(answer("f"))),
      sharedClock,
    );
    vi.stubGlobal("caches", w.caches);
    await keptCopy(w, DAY);
    const went: string[] = [];
    watchForFreshCopy({ shownKeptAt: String(DAY), go: (p) => went.push(p), everyMs: 1_000 });
    // Log out: the copy first (the watcher stops), then a load of My shifts starts somehow (another
    // tab) while the session is still live, then the server ends the session.
    let other: ReturnType<typeof dispatch> | undefined;
    const result = logOutOfThisPhone("worker", {
      clearCopy: clearOfflineCopy,
      forgetPush: async () => {
        await vi.advanceTimersByTimeAsync(1);
        other = dispatch(w, navigate());
        await vi.advanceTimersByTimeAsync(3_000);
      },
      logOut: async () => "done",
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({ outcome: "done", copyCleared: true });
    // That load's answer comes last: the page (the session was live when it was asked).
    later.arrive(answer(PAGE));
    await other?.settled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(went).toEqual([]);
    expect(await keptPage(w)).toBeUndefined();
  });

  it("a tap or a key stops the watcher (a cancellation half-filled is never thrown away)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const win = new EventTarget();
    const went: string[] = [];
    watchForFreshCopy({
      shownKeptAt: String(DAY),
      read: async () => "newer",
      go: (p) => went.push(p),
      everyMs: 1_000,
      stopOn: win,
    });
    win.dispatchEvent(new Event("click"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(went).toEqual([]);
  });

  it("`/?fresh` with no fresh copy and no signal shows the kept copy, asking the network once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const w = loadWorker(() => Promise.reject(new TypeError("offline")), sharedClock);
    await keptCopy(w, DAY); // kept yesterday
    const shown = await (await dispatch(w, navigate("/?fresh")).handled)?.text();
    expect(shown).toContain("No signal.");
    expect(w.fetched.filter((p) => p === "/")).toHaveLength(1);
  });

  it("a copy kept before a logout or login is never shown as fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const w = loadWorker(async () => answer("from the network"), sharedClock);
    await keptCopy(w, T - 30_000);
    await (
      await w.caches.open(OFFLINE_FORGOT_CACHE)
    ).put(
      "/forgot",
      new Response("", { headers: { "x-shiftdesk-forgot-at": String(T - 10_000) } }),
    );
    expect(await (await dispatch(w, navigate("/?fresh")).handled)?.text()).toBe("from the network");
  });

  it("the watcher stops when asked, and gives up when no answer ever comes (no signal at all)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const went: string[] = [];
    let reads = 0;
    const read = async () => {
      reads += 1;
      return String(DAY);
    };
    watchForFreshCopy({
      shownKeptAt: String(DAY),
      read,
      go: (p) => went.push(p),
      everyMs: 1_000,
      forMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(went).toEqual([]);
    expect(reads).toBeLessThanOrEqual(6);
    const stop = watchForFreshCopy({
      shownKeptAt: String(DAY),
      read: async () => "later",
      go: (p) => went.push(p),
      everyMs: 1_000,
    });
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(went).toEqual([]);
  });
});

describe("Booked (`/shifts`) is kept too, on its own (12H.1)", () => {
  const BOOKED = PAGE.replace("Hello Sam", "Booked shifts").replace(
    "/_next/static/chunks/main.js",
    "/_next/static/chunks/booked.js",
  );
  const online = () =>
    loadWorker(
      async (r) => {
        const path = new URL(key(r)).pathname;
        return path === "/" ? answer(PAGE) : path === "/shifts" ? answer(BOOKED) : answer("file");
      },
      { now: 1000 },
    );

  it("answers opening `/shifts` with no query, nothing else under it", () => {
    const w = online();
    const answers = (r: Req) => dispatch(w, r).handled !== null;
    expect(answers(navigate("/shifts"))).toBe(true);
    expect(answers(navigate("/shifts?view=past"))).toBe(false);
    expect(answers(navigate("/shifts/open"))).toBe(false);
    expect(answers(navigate("/shifts?fresh"))).toBe(false); // the fresh copy is Home's alone
  });

  it("keeps each page under its own address, with the files both name", async () => {
    const w = online();
    await dispatch(w, navigate("/")).settled();
    await dispatch(w, navigate("/shifts")).settled();
    const cache = await w.caches.open(OFFLINE_CACHE);
    expect(cache.paths()).toEqual([
      "/",
      "/_next/static/chunks/booked.js",
      "/_next/static/chunks/flight.js",
      "/_next/static/chunks/main.js",
      "/_next/static/css/app.css",
      "/shifts",
    ]);
    expect(await (await cache.match("/shifts"))?.text()).toContain("Booked shifts");
    expect(await (await cache.match("/"))?.text()).toContain("Hello Sam");
  });

  it("with no signal, each opens its own copy with the notice showing", async () => {
    const w = online();
    await dispatch(w, navigate("/")).settled();
    await dispatch(w, navigate("/shifts")).settled();
    const offline = loadWorker(
      () => Promise.reject(new TypeError("offline")),
      { now: 2000 },
      w.caches,
    );
    const booked = await (await dispatch(offline, navigate("/shifts")).handled)?.text();
    expect(booked).toContain("Booked shifts");
    expect(booked).toContain('<div data-offline-notice="" role="status" data-kept-at="1000">');
    expect(await (await dispatch(offline, navigate("/")).handled)?.text()).toContain("Hello Sam");
  });

  it("the page's keep message names its page; any other path is ignored", async () => {
    const w = online();
    const send = async (data: unknown) => {
      const pending: Promise<unknown>[] = [];
      w.listeners.message?.({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    };
    await send({ type: "keep-my-shifts", path: "/shifts" });
    expect(w.fetched[0]).toBe("/shifts");
    const cache = await w.caches.open(OFFLINE_CACHE);
    expect(await cache.match("/")).toBeUndefined();
    expect(await (await cache.match("/shifts"))?.text()).toContain("Booked shifts");
    const before = w.fetched.length;
    await send({ type: "keep-my-shifts", path: "/pay" });
    await send({ type: "keep-my-shifts", path: "https://example.com/" });
    expect(w.fetched.length).toBe(before);
    // An older page's message names no page: Home, as before.
    await send({ type: "keep-my-shifts" });
    expect(await (await cache.match("/"))?.text()).toContain("Hello Sam");
  });

  it("logged out on either page: every copy goes", async () => {
    const w = online();
    await dispatch(w, navigate("/")).settled();
    const out = loadWorker(async () => opaqueRedirect(), { now: 2000 }, w.caches);
    await dispatch(out, navigate("/shifts")).settled();
    expect((await w.caches.open(OFFLINE_CACHE)).paths()).toEqual([]);
  });

  it("one page too old is dropped alone; the other and its files stay", async () => {
    const w = online();
    await dispatch(w, navigate("/shifts")).settled(); // kept at 1000
    const later = loadWorker(
      async (r) => (new URL(key(r)).pathname === "/" ? answer(PAGE) : answer("file")),
      { now: 14 * DAY },
      w.caches,
    );
    await dispatch(later, navigate("/")).settled(); // kept at 14 days
    const offline = loadWorker(
      () => Promise.reject(new TypeError("offline")),
      { now: 15 * DAY + 1001 },
      w.caches,
    );
    expect((await dispatch(offline, navigate("/shifts")).handled)?.status).toBe(503);
    const paths = (await w.caches.open(OFFLINE_CACHE)).paths();
    expect(paths).toContain("/");
    expect(paths).not.toContain("/shifts");
    expect(paths).toContain("/_next/static/css/app.css");
    expect(await (await dispatch(offline, navigate("/")).handled)?.text()).toContain("Hello Sam");
  });

  it("the page side names the same two pages", () => {
    expect(SOURCE).toContain('const PAGES = [PAGE, "/shifts"];');
    expect(readFileSync("src/lib/portal/offline.ts", "utf8")).toContain(
      'export const OFFLINE_PAGES = ["/", "/shifts"] as const;',
    );
  });
});

describe("a new version of the service worker", () => {
  it("deletes older ShiftDesk caches and leaves the current one and anyone else's", async () => {
    const w = loadWorker(async () => answer("x"));
    for (const name of [OFFLINE_CACHE, "shiftdesk-my-shifts-v0", "someone-else"]) {
      await w.caches.open(name);
    }
    const pending: Promise<unknown>[] = [];
    w.listeners.activate?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
    expect((await w.caches.keys()).sort()).toEqual([OFFLINE_CACHE, "someone-else"]);
    // The page's "forgotten at" mark is kept too (it outlives the copy it was about).
    await w.caches.open(OFFLINE_FORGOT_CACHE);
    w.listeners.activate?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
    expect(await w.caches.keys()).toContain(OFFLINE_FORGOT_CACHE);
  });
});

describe("My shifts and the kept copy together", () => {
  it.each(["Home", "Booked"])(
    "%s carries its time and a hidden notice; the worker unhides only that notice",
    (which) => {
      const now = new Date("2026-11-02T09:05:00Z");
      const html = renderToStaticMarkup(
        which === "Home"
          ? createElement(HomeView, {
              firstName: "Sam",
              timeZone: "Europe/London",
              now,
              next: null,
              needs: [],
              photo: { status: "up_to_date", current: null, waiting: null },
              open: {
                shifts: [],
                truncated: false,
                offerAlerts: true,
                travelOn: true,
                area: null,
                further: { count: 0, atLeast: false },
                choices: { days: [], sites: [], roles: [] },
              },
            })
          : createElement(BookedView, {
              timeZone: "Europe/London",
              now,
              view: "upcoming",
              shifts: [],
            }),
      );
      // Home's heading says the time (Phase 18); Booked's the time and day. The notice says both.
      expect(html).toContain(which === "Home" ? "Updated 09:05</p>" : "Updated 09:05 on Mon 2 Nov");
      const notice = html.match(/<div[^>]*data-offline-notice[^>]*>/)?.[0] ?? "";
      expect(notice).toContain('hidden=""');
      const { sandbox } = loadWorker(async () => answer("x"));
      const show = sandbox.showNoSignalNotice as (html: string, keptAt: number) => string;
      const shown = show(html, 1000);
      expect(shown.match(/<div[^>]*data-offline-notice[^>]*>/)?.[0]).not.toContain("hidden");
      expect(shown.replace(/<[^>]+>/g, "")).toContain(
        "No signal.This is your saved copy from 09:05 on Mon 2 Nov. It updates when you&#x27;re back online.Taking or cancelling a shift needs signal.",
      );
    },
  );
});

describe("switching the offline copy on and off (OFFLINE_COPY)", () => {
  it("is on in production and off in development unless set", () => {
    expect(offlineCopyOn({ NODE_ENV: "production" })).toBe(true);
    expect(offlineCopyOn({ NODE_ENV: "development" })).toBe(false);
    expect(offlineCopyOn({ NODE_ENV: "test" })).toBe(false);
    expect(offlineCopyOn({ NODE_ENV: "development", OFFLINE_COPY: "on" })).toBe(true);
    expect(offlineCopyOn({ NODE_ENV: "production", OFFLINE_COPY: "off" })).toBe(false);
  });
});

describe("web push notifications", () => {
  const settle = async (handler: Handler | undefined, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    handler?.({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const pushEvent = (data: unknown) => ({
    data: {
      json: () => {
        if (typeof data === "string") throw new SyntaxError("not JSON");
        return data;
      },
    },
  });

  it("shows the pushed offer, keeping its link", async () => {
    const w = loadWorker(async () => answer("x"));
    await settle(
      w.listeners.push,
      pushEvent({
        title: "Urgent shift",
        body: "Door supervisor needed today 19:00.",
        url: "/shifts/1",
      }),
    );
    expect(w.shown).toEqual([
      {
        title: "Urgent shift",
        options: {
          body: "Door supervisor needed today 19:00.",
          data: { url: `${ORIGIN}/shifts/1` },
        },
      },
    ]);
  });

  it("a push that isn't what we send still shows something safe", async () => {
    const w = loadWorker(async () => answer("x"));
    await settle(w.listeners.push, pushEvent("garbage"));
    await settle(w.listeners.push, pushEvent({ title: 42, url: "https://evil.example/phish" }));
    expect(w.shown.map((n) => [n.title, n.options.data.url])).toEqual([
      ["Shift update", `${ORIGIN}/`],
      ["Shift update", `${ORIGIN}/`], // never another site's page
    ]);
  });

  it("tapping it opens the shift, or brings forward a window already on it", async () => {
    const w = loadWorker(async () => answer("x"));
    const tap = (url: string) =>
      settle(w.listeners.notificationclick, {
        notification: { close: () => undefined, data: { url } },
      });
    await tap(`${ORIGIN}/shifts/1`);
    expect(w.opened).toEqual([`${ORIGIN}/shifts/1`]);
    w.windows.push({
      url: `${ORIGIN}/shifts/2`,
      focus: async () => {
        w.focused.push(`${ORIGIN}/shifts/2`);
      },
    });
    await tap(`${ORIGIN}/shifts/2`);
    expect(w.focused).toEqual([`${ORIGIN}/shifts/2`]);
    expect(w.opened).toHaveLength(1);
    // A link to anywhere else opens our home page instead.
    await tap("https://evil.example/phish");
    expect(w.opened.at(-1)).toBe(`${ORIGIN}/`);
  });
});

describe("a renewed push subscription", () => {
  const change = async (w: ReturnType<typeof loadWorker>, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    w.listeners.pushsubscriptionchange?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);
  };

  it("saves the new one for the logged-in worker and drops the old one", async () => {
    const w = loadWorker(async () => answer("{}"));
    await change(w, {
      oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/old" },
      newSubscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/new",
        toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: {} }),
      },
    });
    expect(w.calls.map((c) => [c.path, c.init?.method, c.init?.body])).toEqual([
      [
        "/api/push/subscribe",
        "POST",
        JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: {} }),
      ],
      [
        "/api/push/subscribe",
        "DELETE",
        JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/old" }),
      ],
    ]);
  });

  it("subscribes again with the old key when the browser gives no new one", async () => {
    const w = loadWorker(async () => answer("{}"));
    await change(w, {
      oldSubscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/old",
        options: { applicationServerKey: "KEY" },
      },
    });
    expect(w.resubscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: "KEY" }]);
    expect(w.calls.map((c) => c.init?.method)).toEqual(["POST", "DELETE"]);
  });

  it("does nothing it can't: no old key, no new subscription", async () => {
    const w = loadWorker(async () => answer("{}"));
    await change(w, { oldSubscription: null });
    expect(w.calls).toEqual([]);
  });
});
