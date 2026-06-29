/* Snippets service worker — app shell offline, data lives in IndexedDB. */
const VERSION = "snippets-v4";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: stale-while-revalidate, cached per-URL. Serve the cached
  // document instantly (a refresh paints without waiting on the network — the
  // book is client-rendered from IndexedDB regardless), then refresh the cache
  // in the background for next time. First-ever visit (no cache) waits on the
  // network; offline with no entry falls back to the shell. A deploy bumps
  // VERSION, which clears the old cache on activate, so the first load after a
  // deploy is network-fresh and only later loads are served stale.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(request);
        const fromNetwork = fetch(request)
          .then((response) => {
            cache.put(request, response.clone());
            return response;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(fromNetwork); // revalidate without blocking the paint
          return cached;
        }
        const network = await fromNetwork;
        return (
          network ??
          (await cache.match(SHELL_URL)) ??
          new Response("Offline", { status: 503, statusText: "Offline" })
        );
      })(),
    );
    return;
  }

  // Hashed build assets and icons: cache first — they never change in place.
  const immutable =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".woff2");
  if (immutable) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
