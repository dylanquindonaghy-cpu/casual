// The page's side of the offline copy of My shifts (public/sw.js keeps it; ADR-016).
// Browser-safe: no imports, so client components can use it (tests/unit/client-boundary.test.ts).

// Must match CACHE in public/sw.js (tests/unit/offline.sw.test.ts checks).
export const OFFLINE_CACHE = "shiftdesk-my-shifts-v1";
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
      const registrations = await sw.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    } catch {
      // Nothing to remove.
    }
  }
  await clearOfflineCopy();
}

// Deletes the offline copy: on logout, and on login (a shared phone never shows the previous
// worker's shifts). Never throws and never waits long: logging in or out must not depend on it.
export async function clearOfflineCopy(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await Promise.race([
      caches.delete(OFFLINE_CACHE),
      new Promise((resolve) => setTimeout(resolve, CLEAR_WAIT_MS)),
    ]);
  } catch {
    // Storage blocked (private browsing, say): there's no copy to clear.
  }
}
