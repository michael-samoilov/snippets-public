/**
 * Guarded History API writes.
 *
 * Safari rate-limits history.pushState/replaceState — 100 calls per 10
 * seconds (per 30 before Safari 17), a thrown SecurityError beyond — and
 * an uncaught throw mid-choreography would silently desync the calendar's
 * altitude model (the URL floor, the dive stack) and stop the day sync
 * cold. The app's writes are debounced well under the budget, so a throw
 * here is a freak storm, not a plan: swallow it and let the next write
 * land once the window rolls over. The URL going briefly stale loses a
 * refresh-restore; a half-run navigation handler loses the session.
 */

export function replaceUrl(url: string | URL) {
  try {
    window.history.replaceState(null, "", url);
  } catch {
    // rate-limited — the next settled write will catch the URL up
  }
}

export function pushUrl(url: string | URL) {
  try {
    window.history.pushState(null, "", url);
  } catch {
    // rate-limited — back loses one altitude this once; never a crash
  }
}
