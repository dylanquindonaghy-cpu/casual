// The page's side of the offline copy of My shifts (public/sw.js keeps it; ADR-016).
// Browser-safe: no imports, so client components can use it (tests/unit/client-boundary.test.ts).

// Must match CACHE, FORGOT, FORGOT_KEY, FORGOT_AT and KEPT_AT in public/sw.js
// (tests/unit/offline.sw.test.ts checks).
export const OFFLINE_CACHE = "shiftdesk-my-shifts-v1";
export const OFFLINE_FORGOT_CACHE = "shiftdesk-my-shifts-forgot";
const FORGOT_KEY = "/forgot";
const FORGOT_AT = "x-shiftdesk-forgot-at";
const KEPT_AT = "x-shiftdesk-kept-at";
export const SERVICE_WORKER_URL = "/sw.js";
const CLEAR_WAIT_MS = 1500;

const serviceWorkers = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;

// My shifts is on screen: start the service worker if needed, and ask it to keep this page now
// (it also keeps it on every full load; this covers arriving by a link inside the portal, after
// logging in or going back). Browsers without service workers simply don't get a copy.
// The pages kept: Home (her next shift) and Booked (12H.1). Must match PAGES in public/sw.js.
export const OFFLINE_PAGES = ["/", "/shifts"] as const;
export type OfflinePage = (typeof OFFLINE_PAGES)[number];

export function keepOfflineCopy(path: OfflinePage = "/"): void {
  const sw = serviceWorkers();
  if (!sw) return;
  sw.register(SERVICE_WORKER_URL)
    .then(() => sw.ready)
    .then((registration) => registration.active?.postMessage({ type: "keep-my-shifts", path }))
    .catch(() => undefined);
}

// The offline copy is switched off (OFFLINE_COPY=off, or development): remove the service worker
// and the copy if an earlier visit left them.
export async function stopOfflineCopy(): Promise<void> {
  const sw = serviceWorkers();
  if (sw) {
    try {
      // Kept while it carries this phone's push notifications (turned off on the profile).
      for (const r of await sw.getRegistrations()) {
        const pushing = await r.pushManager?.getSubscription().catch(() => null);
        if (!pushing) await r.unregister();
      }
    } catch {
      // Nothing to remove.
    }
  }
  await clearOfflineCopy();
}

// Fired on the page when the copy is about to be deleted (logout, login): the fresh-copy watcher
// stops, so it never opens My shifts again in the middle of a logout (the review of audit L90).
export const FORGET_EVENT = "shiftdesk-forget-copy";

// Deletes the offline copy: on logout, and on login (a shared phone never shows the previous
// worker's shifts). It first writes down when, so the service worker never keeps the answer to a
// load of My shifts that was still on its way (audit M27: on poor signal it could arrive after the
// logout and put the copy back). True when it's gone (or there's no storage to hold one); false
// when it gave up waiting. Never throws and never waits long: logging in or out must not depend on
// it.
export async function clearOfflineCopy(): Promise<boolean> {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FORGET_EVENT));
  } catch {
    // No events: nothing is watching.
  }
  try {
    if (typeof caches === "undefined") return true;
    const work = async () => {
      // The time first, then the delete: a late answer the service worker is writing then sees it.
      const store = await caches.open(OFFLINE_FORGOT_CACHE);
      await store.put(
        FORGOT_KEY,
        new Response("", { headers: { [FORGOT_AT]: String(Date.now()) } }),
      );
      await caches.delete(OFFLINE_CACHE);
      return true;
    };
    return await Promise.race([
      work(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLEAR_WAIT_MS)),
    ]);
  } catch {
    return true; // storage blocked (private browsing, say): there's no copy to clear
  }
}

// When the copy now kept was kept (its x-shiftdesk-kept-at): null when there's none, undefined when
// storage couldn't be read (then nothing is done about it).
export async function keptCopyTime(): Promise<string | null | undefined> {
  try {
    if (typeof caches === "undefined") return undefined;
    if (!(await caches.has(OFFLINE_CACHE))) return null;
    const kept = await (await caches.open(OFFLINE_CACHE)).match("/");
    return kept?.headers.get(KEPT_AT) ?? null;
  } catch {
    return undefined;
  }
}

// The kept copy is on screen (shown after 4 s with no answer; its notice carries when it was
// kept). Watches the cache: once a newer copy has been kept (the answer came after all) it opens
// that one (`/?fresh`, answered by the service worker); once the copy is gone (the answer said
// "logged out") it opens the page from the network. It stops for good as soon as the worker taps
// or types anything (a cancellation half-filled is never thrown away) or a logout or login starts
// (FORGET_EVENT), and gives up after `forMs` (no signal at all). Returns a function that stops it
// (audit L90).
export function watchForFreshCopy(opts: {
  shownKeptAt: string;
  read?: () => Promise<string | null | undefined>;
  go?: (path: string) => void;
  everyMs?: number;
  forMs?: number;
  stopOn?: EventTarget; // where taps, keys and FORGET_EVENT are heard (the window)
}): () => void {
  const read = opts.read ?? keptCopyTime;
  const go = opts.go ?? ((path: string) => window.location.replace(path));
  const every = opts.everyMs ?? 2000;
  const until = Date.now() + (opts.forMs ?? 10 * 60 * 1000);
  const target = opts.stopOn ?? (typeof window !== "undefined" ? window : undefined);
  const STOP_ON = ["click", "keydown", "submit", FORGET_EVENT];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const type of STOP_ON) target?.removeEventListener(type, stop, true);
  };
  for (const type of STOP_ON) target?.addEventListener(type, stop, true);
  const look = async () => {
    if (stopped) return;
    const now = await read();
    if (stopped) return;
    if (now === null) {
      stop();
      return go("/");
    }
    if (now !== undefined && now !== opts.shownKeptAt) {
      stop();
      return go("/?fresh");
    }
    if (Date.now() < until) timer = setTimeout(() => void look(), every);
    else stop();
  };
  timer = setTimeout(() => void look(), every);
  return stop;
}

// The signal is back only when the network answers, not when the browser says "online": a phone
// often fires "online" before data flows, and opening the page then gets the kept copy again from
// the service worker (its fetch failed), after which nothing would open it fresh (Phase 30's run
// found it: the copy stayed). So on "online" it first asks the page's address with a HEAD request,
// which the service worker never answers (it handles GETs only: public/sw.js), and opens the page
// only once that comes back with any answer at all (a redirect to log in is an answer too). If it
// fails it asks again every RELOAD_RETRY_MS, up to RELOAD_TRIES times, while the browser stays
// online; "offline" pauses it until the next "online". Once only, never after it's stopped or a
// logout or login starts (FORGET_EVENT).
export const RELOAD_RETRY_MS = 2000;
export const RELOAD_TRIES = 30;
export const answersNow = (path: string): Promise<boolean> =>
  fetch(path, { method: "HEAD", cache: "no-store", credentials: "same-origin", redirect: "manual" })
    .then(() => true)
    .catch(() => false);
export function reloadWhenOnline(opts: {
  path: OfflinePage;
  target?: EventTarget; // where "online", "offline" and FORGET_EVENT are heard (the window)
  go?: (path: string) => void;
  probe?: (path: string) => Promise<boolean>; // does the network answer now (answersNow)
  wait?: (ms: number, then: () => void) => () => void; // a timer; returns its cancel
}): () => void {
  const target = opts.target ?? (typeof window !== "undefined" ? window : undefined);
  const go = opts.go ?? ((path: string) => window.location.replace(path));
  const probe = opts.probe ?? answersNow;
  const wait =
    opts.wait ??
    ((ms: number, then: () => void) => {
      const t = setTimeout(then, ms);
      return () => clearTimeout(t);
    });
  let stopped = false;
  let trying = false; // a check is on its way, or one is waiting to run
  let tries = 0;
  let cancel: (() => void) | undefined;
  const stop = () => {
    stopped = true;
    cancel?.();
    target?.removeEventListener("online", online);
    target?.removeEventListener("offline", offline);
    target?.removeEventListener(FORGET_EVENT, stop);
  };
  function attempt() {
    cancel = undefined;
    if (stopped) return;
    tries += 1;
    void probe(opts.path).then((answered) => {
      if (stopped || !trying) return;
      if (answered) {
        stop();
        go(opts.path);
      } else if (tries < RELOAD_TRIES) {
        cancel = wait(RELOAD_RETRY_MS, attempt);
      } else {
        trying = false;
      }
    });
  }
  function online() {
    if (stopped || trying) return;
    trying = true;
    tries = 0;
    attempt();
  }
  function offline() {
    trying = false;
    cancel?.();
    cancel = undefined;
  }
  target?.addEventListener("online", online);
  target?.addEventListener("offline", offline);
  target?.addEventListener(FORGET_EVENT, stop);
  return stop;
}

// The same, as a few lines the page carries in its own HTML (OfflineCopy), for the moment before
// the page's scripts have started, or when they never can (a kept copy that can't fetch a script it
// doesn't hold, as under `next dev`). It reloads only while its page is the kept copy on screen
// (the notice showing, checked when "online" comes and again before it opens the page), and only
// once the network answers, as above; stops on FORGET_EVENT, and leaves its stop function on the
// window (ONLINE_RELOAD_STOP) so the page's own code takes over once it runs. Nothing the worker
// typed or the firm wrote goes in it: `path` is one of the two kept pages.
export const ONLINE_RELOAD_STOP = "__shiftdeskStopOnlineReload";
export function onlineReloadScript(path: OfflinePage): string {
  const p = JSON.stringify(OFFLINE_PAGES.includes(path) ? path : "/");
  return (
    `(function(){var w=window,p=${p},t=0,on=0,h=0,done=0;` +
    `function kept(){var n=document.querySelector("[data-offline-notice]");return location.pathname===p&&n&&!n.hidden}` +
    `function off(){done=1;clearTimeout(h);w.removeEventListener("online",go);w.removeEventListener("offline",pause);w.removeEventListener("${FORGET_EVENT}",off)}` +
    `function pause(){on=0;clearTimeout(h)}` +
    `function check(){if(done||!on)return;t++;fetch(p,{method:"HEAD",cache:"no-store",credentials:"same-origin",redirect:"manual"}).then(function(){return 1},function(){return 0}).then(function(ok){if(done||!on)return;if(ok){if(!kept())return pause();off();location.replace(p)}else if(t<${RELOAD_TRIES})h=setTimeout(check,${RELOAD_RETRY_MS});else on=0})}` +
    `function go(){if(done||on||!kept())return;on=1;t=0;check()}` +
    `w.addEventListener("online",go);w.addEventListener("offline",pause);w.addEventListener("${FORGET_EVENT}",off);` +
    `w.${ONLINE_RELOAD_STOP}=off})()`
  );
}

// Stops the in-page lines above, if they ran (the page's own code has started).
export function stopOnlineReloadScript(): void {
  if (typeof window === "undefined") return;
  const holder = window as unknown as Record<string, unknown>;
  const stop = holder[ONLINE_RELOAD_STOP];
  if (typeof stop === "function") (stop as () => void)();
  delete holder[ONLINE_RELOAD_STOP];
}
