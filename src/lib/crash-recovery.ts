/**
 * Crash-loop recovery — a floor under the "A problem repeatedly occurred" page.
 *
 * The book renders every entry as live DOM. On a large book (years of
 * history) that can exceed a low-memory iPhone's ceiling; iOS kills the
 * WebContent process and RELOADS the same URL — and because the scroll spy
 * writes the viewed day into the URL (`?d=2021-01-01`), the reload rebuilds
 * the whole book from that day forward and dies again. That is the reload
 * loop the user sees, unrecoverable without clearing the tab.
 *
 * This can't stop the crash (that's a memory-budget problem), but it can
 * break the LOOP: count loads within a short window in localStorage (which
 * survives the process kill, unlike in-memory state). Three loads inside six
 * seconds is not human — it's the loop. On the third, the caller enters
 * RECOVERY: ignore the deep-linked day, open the light recent-days window,
 * and skip mounting the rest of the book. That load is cheap, so it
 * survives; surviving fires the clear below, and the next open is normal
 * again. The app always comes back to something usable.
 */

const KEY = "snip:loadmarks";
const WINDOW_MS = 6000;
const LOOP_COUNT = 3;
// a load that lives this long is a survivor — clear the marks so an ordinary
// reopen later never inherits a stale count. Shorter than a comfortable read,
// longer than the render spike that would crash.
const SURVIVED_MS = 4000;

/**
 * Record this load and report whether we're in a crash loop. Call once, at
 * the top of the page, before the heavy render. Best-effort: any storage
 * failure reports "not looping" so normal loads are never degraded.
 */
export function enterRecoveryIfLooping(now: number): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    const recent: number[] = (raw ? JSON.parse(raw) : []).filter(
      (t: number) => typeof t === "number" && now - t < WINDOW_MS,
    );
    recent.push(now);
    localStorage.setItem(KEY, JSON.stringify(recent));

    if (recent.length >= LOOP_COUNT) {
      // we're taking the light path now; this load should survive, so let it
      // clear the slate rather than carry the loop count forward
      window.setTimeout(() => {
        try {
          localStorage.removeItem(KEY);
        } catch {}
      }, SURVIVED_MS);
      return true;
    }

    // an ordinary load: if it survives, wipe the marks so they never
    // accumulate across unrelated reopens
    window.setTimeout(() => {
      try {
        localStorage.removeItem(KEY);
      } catch {}
    }, SURVIVED_MS);
    return false;
  } catch {
    return false;
  }
}
