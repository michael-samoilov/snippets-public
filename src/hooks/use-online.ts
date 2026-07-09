"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Reactive connectivity, read from the browser itself — `navigator.onLine`
 * plus the `online`/`offline` events. Works entirely offline (it's the
 * cached page's own JS deciding), so a page served from the service-worker
 * cache can still tell the reader they're offline. SSR snapshot is `true`
 * (assume online until the client says otherwise — no offline flash on load).
 *
 * Caveat worth knowing: `navigator.onLine` is honest about "no network
 * interface" but can read `true` on a captive/dead connection. Good enough
 * for a quiet status line; never gate a write on it.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
