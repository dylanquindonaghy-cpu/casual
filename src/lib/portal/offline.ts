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
export function keepOfflineCopy(): void {
  const sw = serviceWorkers();
  if (!sw) return;
  sw.register(SERVICE_WORKER_URL)
    .then(() => sw.ready)
    .then((registration) => registration.active?.postMessage({ type: "keep-my-shifts" }))
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
