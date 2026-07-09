/* Snippets service worker — app shell offline, data lives in IndexedDB.
   Hardened so the CACHE LAYER CAN NEVER FAIL A NAVIGATION: on iOS a wedged
   CacheStorage (quota-full or corrupt) made `caches.open` reject OUTSIDE the
   old try/catch, the respondWith promise rejected, and Safari showed "This
   page couldn't load" for every visit — surviving reloads and redeploys.
   Every cache operation is now best-effort; the network answer stands alone. */
const VERSION = "snippets-v10";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(VERSION);
        // Try to cache the shell, following any redirects to get the final page.
        const response = await fetch(SHELL_URL, { redirect: "follow" });
        console.log(`[SW install] Fetched ${SHELL_URL}: status=${response.status}, ok=${response.ok}, type=${response.type}`);
        if (response.ok) {
          await cache.put(SHELL_URL, response);
          console.log(`[SW install] Cached shell ${SHELL_URL}`);
        } else {
          console.log(`[SW install] Not caching shell — status ${response.status} is not ok`);
        }
      } catch (e) {
        console.log(`[SW install] Error caching shell:`, e.message);
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
        try {
          // Online: always fetch fresh from network for navigations.
          const response = await fetch(request);
          // Cache successful responses only (2xx/3xx redirects to 2xx).
          if (response.status >= 200 && response.status < 300) {
            try {
              const cache = await caches.open(VERSION);
              await cache.put(url.pathname, response.clone());
            } catch {
              /* couldn't cache */
            }
          }
          return response;
        } catch (fetchErr) {
          // Offline: serve the shell so the SPA can route client-side to any path.
          // The shell "/" is fully hydrated and can navigate within itself without network.
          console.log(`[SW navigate] Offline for ${url.pathname}:`, fetchErr.message);
          try {
            const cache = await caches.open(VERSION);
            const shell = await cache.match(SHELL_URL);
            if (shell) {
              console.log(`[SW navigate] Found cached shell: status=${shell.status}, type=${shell.type}, ok=${shell.ok}`);
              if (shell.status >= 200 && shell.status < 300) {
                console.log(`[SW navigate] Serving cached shell for ${url.pathname}`);
                return shell;
              } else {
                console.log(`[SW navigate] Cached shell has status ${shell.status}, not serving`);
              }
            } else {
              console.log(`[SW navigate] No cached shell found`);
            }
          } catch (cacheErr) {
            console.log(`[SW navigate] Cache error:`, cacheErr.message);
          }
          console.log(`[SW navigate] Returning 503 Offline for ${url.pathname}`);
          return new Response("Offline", { status: 503, statusText: "Offline" });
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
