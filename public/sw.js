/* Snippets service worker — every visited page usable offline, data in IndexedDB.

   Two hard-won invariants, both about Safari/WebKit:

   1. THE CACHE LAYER CAN NEVER FAIL A NAVIGATION. On iOS a wedged CacheStorage
      (quota-full or corrupt) made `caches.open` reject OUTSIDE the old try/catch,
      the respondWith promise rejected, and Safari showed "This page couldn't
      load" for every visit — surviving reloads and redeploys. Every cache
      operation is best-effort; the network answer always stands alone.

   2. NEVER SERVE A REDIRECTED RESPONSE FOR A NAVIGATION. WebKit rejects it with
      "Response served by service worker has redirections" and shows a blank
      error page. `/` redirects to `/calendar`, so a redirected response could
      otherwise land in the cache (bare-domain visit) and poison offline loads.
      We refuse to cache any redirected response, so one can never be served. */
const VERSION = "snippets-v13";
// The app's real entry (start_url). Its own document is a clean 200 — used as the
// offline fallback for any route we haven't cached yet.
const SHELL_URL = "/calendar";

// Cache a navigation response only when it's a plain 200 that did NOT go through
// a redirect — a redirected response poisons WebKit (invariant 2 above).
async function cacheNavigation(pathname, response) {
  if (response.redirected) return;
  if (response.status < 200 || response.status >= 300) return;
  try {
    const cache = await caches.open(VERSION);
    await cache.put(pathname, response.clone());
  } catch {
    /* couldn't cache; the live response is what matters */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(SHELL_URL);
        await cacheNavigation(SHELL_URL, response);
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

  // Navigations: network-FIRST, per-route cache as the offline copy. The live
  // document must win when online, because it names the hashed JS chunks to load
  // — a stale document references chunks that no longer exist and can't hydrate.
  // Each route is cached under its own PATHNAME (query stripped, so the calendar's
  // dated URLs — ?d=2026-07-02, one per day ever visited — collapse to a single
  // /calendar entry). Offline, we serve that route's own cached document, so
  // /settings shows settings, not the calendar shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          await cacheNavigation(url.pathname, response);
          return response;
        } catch {
          // Offline: this exact route if we have it, else the shell so the app
          // still opens (its client router then handles wherever the URL points).
          try {
            const cache = await caches.open(VERSION);
            const cached = await cache.match(url.pathname);
            if (cached) return cached;
            const shell = await cache.match(SHELL_URL);
            if (shell) return shell;
          } catch {
            /* cache unavailable */
          }
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
