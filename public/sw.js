/* Snippets service worker — every visited page usable offline, data in IndexedDB.

   Three hard-won invariants, all about real-device behaviour:

   1. THE CACHE LAYER CAN NEVER FAIL A NAVIGATION. On iOS a wedged CacheStorage
      (quota-full or corrupt) made `caches.open` reject OUTSIDE the old try/catch,
      the respondWith promise rejected, and Safari showed "This page couldn't
      load" for every visit — surviving reloads and redeploys. Every cache
      operation is best-effort; the network answer always stands alone.

   2. NEVER SERVE A REDIRECTED RESPONSE FOR A NAVIGATION. WebKit rejects it with
      "Response served by service worker has redirections" and shows a blank
      error page. `/` redirects to `/calendar`, so a redirected response could
      otherwise land in the cache (bare-domain visit) and poison offline loads.
      We refuse to cache any redirected response, so one can never be served.

   3. CLIENT-SIDE NAVIGATION NEEDS ITS RSC PAYLOAD OFFLINE. The App Router doesn't
      re-fetch a whole document when you tap a link — it fetches an RSC payload
      (`/settings?_rsc=…`, header `rsc: 1`). If that fetch dies offline, the nav
      stalls on the current page (this is why Settings "stuck to /calendar" on
      iOS, where the full-navigation fallback doesn't reliably fire). So we cache
      each route's RSC payload by pathname and serve it offline — client-side nav
      then resolves from cache, no browser-specific fallback required. */
const VERSION = "snippets-v14";
// The app's real entry (start_url). Its own document is a clean 200 — used as the
// offline fallback for any route we haven't cached yet, and pre-cached on install
// alongside the other first-party pages so a first offline visit still has a doc.
const SHELL_URL = "/calendar";
const PRECACHE_ROUTES = ["/calendar", "/settings", "/privacy", "/signin", "/welcome"];

// Cache a navigation/RSC response only when it's a plain 200 that did NOT go
// through a redirect — a redirected response poisons WebKit (invariant 2).
async function cacheClean(key, response) {
  if (response.redirected) return;
  if (response.status < 200 || response.status >= 300) return;
  try {
    const cache = await caches.open(VERSION);
    await cache.put(key, response.clone());
  } catch {
    /* couldn't cache; the live response is what matters */
  }
}

// The RSC payload for a route is cached under a stable per-pathname key — the
// real request carries a `?_rsc=<hash>` cache-buster that changes every time.
function rscKey(pathname) {
  return `${self.location.origin}${pathname}?__rsc`;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Pre-cache each first-party route so every page is reachable offline even
      // if the user never opened it online. Per route we cache: the full document
      // (cold full navigation / reload); the hashed JS/CSS it names, harvested from
      // that HTML (a route can't hydrate without its own chunks, and a never-visited
      // route never requested them); and the RSC payload (in-app client-side nav).
      // Every fetch is best-effort: a single failure (or being offline at install)
      // never blocks activation.
      const assets = new Set();
      await Promise.all(
        PRECACHE_ROUTES.flatMap((route) => [
          (async () => {
            try {
              const res = await fetch(route);
              if (!res.redirected && res.status >= 200 && res.status < 300) {
                const html = await res.clone().text();
                for (const m of html.matchAll(/\/_next\/static\/[^"'()\s]+?\.(?:js|css|woff2)/g)) {
                  assets.add(m[0]);
                }
                await cacheClean(route, res);
              }
            } catch {
              /* no offline doc for this route this round */
            }
          })(),
          (async () => {
            try {
              const rsc = await fetch(route, { headers: { RSC: "1" } });
              await cacheClean(rscKey(route), rsc);
            } catch {
              /* no offline RSC for this route this round */
            }
          })(),
        ]),
      );
      // Now warm the harvested build assets (cache-first at runtime, so this just
      // seeds them for routes the user hasn't visited yet).
      try {
        const cache = await caches.open(VERSION);
        await Promise.all(
          [...assets].map(async (href) => {
            try {
              const res = await fetch(href);
              if (res.ok) await cache.put(href, res.clone());
            } catch {
              /* one missing asset shouldn't fail the batch */
            }
          }),
        );
      } catch {
        /* cache unavailable; runtime cache-first still fills as pages load */
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

  // RSC payloads (App Router client-side navigation + prefetch). Network-first so
  // it stays current online; offline, serve the cached payload for this route so
  // tapping through the app works without a live connection (invariant 3).
  const isRsc = request.headers.get("rsc") === "1" || url.searchParams.has("_rsc");
  if (isRsc) {
    event.respondWith(
      (async () => {
        const key = rscKey(url.pathname);
        try {
          const response = await fetch(request);
          await cacheClean(key, response);
          return response;
        } catch {
          try {
            const cache = await caches.open(VERSION);
            const cached = await cache.match(key, { ignoreVary: true });
            if (cached) return cached;
          } catch {
            /* cache unavailable */
          }
          // No cached RSC — let it error so the App Router falls back to a full
          // navigation, which the navigate handler serves from the doc cache.
          return Response.error();
        }
      })(),
    );
    return;
  }

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
          await cacheClean(url.pathname, response);
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
