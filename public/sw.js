// ShiftDesk service worker: keeps the worker's last "My shifts" page on their phone, so it opens
// with poor signal at a venue (docs/screens.md, `/`; docs/decisions.md ADR-016).
//
// It also shows web push notifications (an urgent offer) and opens their page when tapped.
//
// It handles only two kinds of request; everything else goes to the network untouched:
// - Opening My shifts (`/`, no query): the network first. With no signal, or no answer within
//   NETWORK_TIMEOUT_MS, the copy kept from the last good load, with its "No signal" notice
//   unhidden. With no copy (or one older than MAX_AGE_MS), a plain "No signal" page. If anything
//   in here goes wrong, the page is fetched as if this worker weren't there.
// - The kept page's own styles and scripts (`/_next/static/`, whose names change whenever their
//   contents do): from the copy when kept, else the network.
// A good load of My shifts replaces the copy, and so does a "keep" message from the page (sent
// when My shifts is shown without a full load: after logging in, or going back to it). A redirect
// (logged out) or a 401, 403 or 404 deletes it. The page deletes it on logout and login
// (src/lib/portal/offline.ts, same cache name), first writing the time into FORGOT: an answer to a
// load that started before then is never kept, even one that arrives after the logout (audit
// M27). Only same-origin `/_next/static/` files are ever kept besides the page, fetched without
// cookies.
//
// Slow but working signal (audit L90): the kept copy shown after 4 s carries its keep time
// (data-kept-at on its notice). The page watches the cache, and once a newer copy has been kept
// (the late answer came) it opens `/?fresh`, answered here with that just-kept copy.
//
// Never delete this file from the site: a phone checking for an update and getting a 404 keeps
// the old worker. To switch it off, see docs/runbooks.md ("A bad service worker").
//
// Plain JavaScript with no build step. Tests run it in a sandbox (tests/unit/offline.sw.test.ts).

const CACHE = "shiftdesk-my-shifts-v1";
// When the page last deleted the copy (logout, login): src/lib/portal/offline.ts writes it.
const FORGOT = "shiftdesk-my-shifts-forgot";
const FORGOT_KEY = "/forgot";
const FORGOT_AT = "x-shiftdesk-forgot-at";
const PAGE = "/";
const FRESH = "?fresh";
const FRESH_MS = 2 * 60 * 1000; // `/?fresh` shows a copy kept this recently, without the network
const STATIC = "/_next/static/";
const KEPT_AT = "x-shiftdesk-kept-at";
const NETWORK_TIMEOUT_MS = 4000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_MS = 10 * 1000; // a "keep" message this soon after a copy was made is skipped
const MAX_ASSETS = 100;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Caches from older versions of this file.
      for (const key of await caches.keys()) {
        if (key.startsWith("shiftdesk-") && key !== CACHE && key !== FORGOT) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const myShifts = request.mode === "navigate" && url.pathname === PAGE;
  if (myShifts && (url.search === "" || url.search === FRESH)) {
    // Set up synchronously: the network request, and keeping its answer alongside. `/?fresh` (the
    // page saw a newer copy kept while a stale one was showing) is that copy when there is one,
    // else the same as `/`.
    const startedAt = Date.now();
    const fresh = url.search === FRESH ? justKept().catch(() => null) : Promise.resolve(null);
    const network =
      url.search === FRESH ? fresh.then((page) => (page ? null : fetch(request))) : fetch(request);
    event.waitUntil(
      network
        .then((response) => (response ? keep(response.clone(), startedAt) : undefined))
        .catch(() => undefined),
    );
    event.respondWith(fresh.then((page) => page || openMyShifts(network).catch(() => network)));
  } else if (url.pathname.startsWith(STATIC)) {
    event.respondWith(staticFile(request).catch(() => fetch(request)));
  }
});

// A web push (an urgent offer, say): show it. Only our own site's pages are ever opened from one.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title =
    typeof data.title === "string" && data.title ? data.title.slice(0, 100) : "Shift update";
  const body = typeof data.body === "string" ? data.body.slice(0, 300) : "";
  event.waitUntil(
    self.registration.showNotification(title, { body, data: { url: ownPage(data.url) } }),
  );
});

// Tapping it opens the page it names (a window already on that page is brought forward).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = ownPage(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// The browser renewed this phone's push subscription: save the new one for the logged-in worker and
// drop the old one (the same route the profile uses; the session cookie goes with it).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const renewed =
        event.newSubscription ||
        (old && old.options && old.options.applicationServerKey
          ? await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: old.options.applicationServerKey,
            })
          : null);
      if (!renewed) return;
      const send = (method, body) =>
        fetch("/api/push/subscribe", {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        });
      await send("POST", renewed.toJSON());
      if (old && old.endpoint !== renewed.endpoint)
        await send("DELETE", { endpoint: old.endpoint });
    })().catch(() => undefined),
  );
});

// A page on this site, or its home page for anything else (never another site).
function ownPage(raw) {
  if (typeof raw !== "string" || raw === "") return `${self.location.origin}/`;
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/`;
  } catch {
    return `${self.location.origin}/`;
  }
}

// My shifts is showing without a full load (after logging in, or going back to it): keep it now.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "keep-my-shifts") return;
  event.waitUntil(refreshCopy().catch(() => undefined));
});

async function openMyShifts(network) {
  const kept = await keptPage(await caches.open(CACHE));
  if (!kept) return network.catch(() => noSignalPage());
  return Promise.race([network, wait(NETWORK_TIMEOUT_MS).then(() => kept)]).catch(() => kept);
}

async function refreshCopy() {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(PAGE);
  const at = kept ? Number(kept.headers.get(KEPT_AT)) : NaN;
  if (Number.isFinite(at) && Date.now() - at < RECENT_MS) return;
  const startedAt = Date.now();
  await keep(await fetch(PAGE, { redirect: "manual", credentials: "same-origin" }), startedAt);
}

// When the page last deleted the copy (logout, login), or null.
async function forgottenAt() {
  if (!(await caches.has(FORGOT))) return null;
  const marker = await (await caches.open(FORGOT)).match(FORGOT_KEY);
  const at = marker ? Number(marker.headers.get(FORGOT_AT)) : NaN;
  return Number.isFinite(at) ? at : null;
}

// Has the page deleted the copy since `startedAt`?
async function forgottenSince(startedAt) {
  const at = await forgottenAt();
  return at !== null && at >= startedAt;
}

// An answer to a load of My shifts that started at `startedAt`: kept, unless the page deleted the
// copy after the load started (checked before and after writing, so a logout at that moment wins).
async function keep(response, startedAt) {
  if (await forgottenSince(startedAt)) return;
  await remember(await caches.open(CACHE), response, startedAt);
  if (await forgottenSince(startedAt)) await caches.delete(CACHE);
}

// Keep a good answer; forget the copy when the server says the worker isn't logged in.
async function remember(cache, response, startedAt) {
  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    [401, 403, 404].includes(response.status)
  ) {
    await forget(cache);
    return;
  }
  if (response.status !== 200 || response.type !== "basic") return;
  const html = await response.text();
  if (await forgottenSince(startedAt)) return;
  // Only what's needed to show it again (not the original encoding or length headers).
  const headers = new Headers({
    "content-type": response.headers.get("content-type") || "text/html; charset=utf-8",
    [KEPT_AT]: String(Date.now()),
  });
  await cache.put(PAGE, new Response(html, { status: 200, headers }));
  // Lost the race with a logout while writing: gone at once (before its files are fetched).
  if (await forgottenSince(startedAt)) {
    await caches.delete(CACHE);
    return;
  }

  // The styles and scripts the page names, so the copy looks right offline; drop the rest.
  const files = assetsIn(html).slice(0, MAX_ASSETS);
  const wanted = new Set(files);
  await Promise.all(
    files.map(async (href) => {
      try {
        const file = await fetch(href, { credentials: "omit" });
        if (file.ok) await cache.put(href, file);
      } catch {
        // Not fatal: that file just won't be there offline.
      }
    }),
  );
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (url.pathname !== PAGE && !wanted.has(url.href)) await cache.delete(request);
  }
}

async function forget(cache) {
  for (const request of await cache.keys()) await cache.delete(request);
}

// The kept page, if there is one young enough to show, with its "No signal" notice unhidden and
// marked with when it was kept (the page watches for a newer one: audit L90).
async function keptPage(cache) {
  const kept = await cache.match(PAGE);
  if (!kept) return null;
  const at = Number(kept.headers.get(KEPT_AT));
  if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) {
    await forget(cache);
    return null;
  }
  const html = showNoSignalNotice(await kept.text(), at);
  return new Response(html, { status: 200, headers: kept.headers });
}

// The copy as kept, if it was kept in the last two minutes (the late answer to a slow load) and not
// before a logout or login since, as the server sent it (its notice hidden). Null otherwise.
async function justKept() {
  const kept = await (await caches.open(CACHE)).match(PAGE);
  if (!kept) return null;
  const at = Number(kept.headers.get(KEPT_AT));
  if (!Number.isFinite(at) || Date.now() - at > FRESH_MS || Date.now() < at) return null;
  const forgot = await forgottenAt();
  if (forgot !== null && forgot >= at) return null;
  return new Response(await kept.text(), { status: 200, headers: kept.headers });
}

async function staticFile(request) {
  const kept = await (await caches.open(CACHE)).match(request);
  return kept || fetch(request);
}

// Every same-origin /_next/static/ file the page names, once each, as full URLs. The page's text
// can include what the firm typed (instructions, addresses), so a path is taken only if it still
// points into /_next/static/ once resolved ("/_next/static/../../pay" is not kept).
function assetsIn(html) {
  const found = new Set();
  for (const raw of html.match(/\/_next\/static\/[^"'\s)\\<>]+/g) || []) {
    let url;
    try {
      url = new URL(raw, self.location.origin);
    } catch {
      continue;
    }
    if (url.origin === self.location.origin && url.pathname.startsWith(STATIC)) found.add(url.href);
  }
  return [...found];
}

// My shifts renders the notice with `hidden` (src/app/my-shifts-view.tsx); unhide only that one,
// and mark it with when this copy was kept.
function showNoSignalNotice(html, keptAt) {
  return html.replace(/<[^>]*\bdata-offline-notice\b[^>]*>/, (tag) =>
    tag.replace(/\s+hidden(="[^"]*")?/, "").replace(/>$/, ` data-kept-at="${Number(keptAt)}">`),
  );
}

function noSignalPage() {
  return new Response(
    '<!doctype html><html lang="en-GB"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>No signal</title></head>' +
      '<body style="font-family:system-ui,sans-serif;font-size:1.125rem;line-height:1.5;max-width:28rem;margin:0 auto;padding:1.5rem">' +
      "<h1>No signal</h1><p>Your shifts will open here without signal once you've opened them with signal.</p>" +
      "<p>Try again when you have signal.</p></body></html>",
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
