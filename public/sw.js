/* Snippets service worker — app shell offline, data lives in IndexedDB.
   Hardened so the CACHE LAYER CAN NEVER FAIL A NAVIGATION: on iOS a wedged
   CacheStorage (quota-full or corrupt) made `caches.open` reject OUTSIDE the
   old try/catch, the respondWith promise rejected, and Safari showed "This
   page couldn't load" for every visit — surviving reloads and redeploys.
   Every cache operation is now best-effort; the network answer stands alone. */
const VERSION = "snippets-v8";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(VERSION);
        await cache.add(SHELL_URL);
      } catch {
        /* no offline shell this round — installing still must succeed */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      } catch {
        /* stale caches linger; the app still runs */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-FIRST, cache as offline fallback. The document must be
  // current, because it names the hashed JS chunks to load — a stale document
  // references chunks that no longer exist and the app can't hydrate. Cache
  // entries are keyed by PATHNAME (search stripped): the calendar's dated URLs
  // (?d=2026-07-02, one per day ever visited) were each cached in full, growing
  // the cache without bound — one entry per path is the whole shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const key = url.pathname;
        try {
          // Fetch with manual redirect handling so we never cache a redirect.
          const network = await fetch(request, { redirect: "manual" });
          // If it's a redirect, don't cache it — fetch the final destination instead.
          if (network.status >= 300 && network.status < 400) {
            const location = network.headers.get("Location");
            if (location) {
              const finalResponse = await fetch(new Request(location, { redirect: "manual" }));
              try {
                const cache = await caches.open(VERSION);
                if (finalResponse.status >= 200 && finalResponse.status < 300) {
                  await cache.put(key, finalResponse.clone());
                }
              } catch {
                /* couldn't cache */
              }
              return finalResponse;
            }
          }
          // Not a redirect; cache if successful.
          if (network.status >= 200 && network.status < 300) {
            try {
              const cache = await caches.open(VERSION);
              await cache.put(key, network.clone());
            } catch {
              /* couldn't cache */
            }
          }
          return network;
        } catch {
          try {
            const cache = await caches.open(VERSION);
            // Offline: try the exact path first, then fall back to shell so the SPA can route.
            return (
              (await cache.match(key)) ??
              (await cache.match(SHELL_URL)) ??
              new Response("Offline", { status: 503, statusText: "Offline" })
            );
          } catch {
            return new Response("Offline", { status: 503, statusText: "Offline" });
          }
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
      (async () => {
        try {
          const cached = await caches.match(request);
          if (cached) return cached;
        } catch {
          /* fall through to the network */
        }
        const response = await fetch(request);
        try {
          const cache = await caches.open(VERSION);
          await cache.put(request, response.clone());
        } catch {
          /* couldn't cache; serve it anyway */
        }
        return response;
      })(),
    );
  }
});
