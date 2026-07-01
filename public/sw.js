/* Snippets service worker — app shell offline, data lives in IndexedDB. */
const VERSION = "snippets-v5";
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

  // Navigations: network-FIRST, cache as offline fallback. The document must be
  // current, because it names the hashed JS chunks to load; a stale document
  // (from an earlier deploy) names chunks that have since been cleaned from the
  // server or evicted from the SW cache, and the app then can't hydrate — it
  // hangs on the SSR skeleton. So always fetch fresh when online (the shell is
  // tiny; the book renders from IndexedDB regardless), and fall back to the
  // cached document only when the network fails.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const network = await fetch(request);
          cache.put(request, network.clone());
          return network;
        } catch {
          return (
            (await cache.match(request)) ??
            (await cache.match(SHELL_URL)) ??
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }
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
