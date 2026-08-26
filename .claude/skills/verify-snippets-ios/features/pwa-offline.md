# Offline PWA

The installed app must open and work with no network: documents from the
service worker cache, data from IndexedDB. The SW
(`public/sw.js`) carries three hard-won invariants — its header comment
is required reading before touching this area.

## Sub-features

- **Offline relaunch**: a visited route loads offline; `/calendar` is
  the shell fallback for unvisited ones.
- **Offline client-side nav**: App Router navigation fetches RSC
  payloads (`?_rsc=…`); the SW caches them per pathname so taps still
  navigate offline.
- **No redirected responses**: `/` 307s to `/calendar`; the SW must
  never cache/serve the redirect (WebKit rejects it with a blank error
  page).
- **PWA identity**: `manifest.ts` (`display: standalone`,
  `start_url`), `appleWebApp` meta + `apple-touch-startup-image` links
  in `layout.tsx`, `viewportFit: cover`.

## How to get to it (user POV)

Install to the home screen from Safari (or visit in any browser), open
it once online, then go to airplane mode and relaunch. `/verify` tells
users to try exactly this, so it must itself work offline.

## Driving it with the Chromium ios-pwa persona

The SW registers in **production builds only** — launch per SKILL.md.

1. `page = ios_pwa_page(browser)`; `goto("/calendar?seed=40&years=1")`.
2. Wait for control: `navigator.serviceWorker.ready`, then poll
   `navigator.serviceWorker.controller` (first load may need one
   `page.reload()` to be controlled; precache runs on install).
3. `page.context.set_offline(True)`.
4. Reload `/calendar` directly (never `/` — that's the redirect
   invariant). Prove: document loads, seeded entries render from
   IndexedDB, no browser error page.
5. Offline client-side nav: tap through to Settings; prove the URL and
   content changed (this is invariant 3 — it used to stick on
   `/calendar` on iOS).
6. Identity checks (cheap, same run): fetch `/manifest.webmanifest`,
   assert `display === "standalone"`; assert the `apple-mobile-web-app`
   meta and startup-image links exist in the document.

## Gotchas

- Bump `VERSION` in `sw.js` when changing caching behavior — an old
  cache name silently serves the old world and your proof passes for
  the wrong reason. Assert the cache name matches the current
  `VERSION` (`caches.keys()`).
- CSS-referenced assets (the sheet's paper grain) are precached by
  explicit name (`PRECACHE_ASSETS`) — an offline relaunch that loses
  the grain is a regression even though the document loads.
- `set_offline` cuts the network at the browser; it does not exercise
  iOS's cold-relaunch path or a wedged CacheStorage (invariant 1) —
  those stay real-device territory.
- Headless `env(safe-area-inset-*)` is 0; layout under a notch is not
  provable here.
