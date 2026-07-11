/**
 * Fling relief — the zoom-relief pattern, applied to the book's scroll.
 *
 * A hard fling through the schedule makes iOS rasterize fresh tiles as
 * fast as the finger moves, across content that is all grace: the
 * ink-into-paper blends, each card's isolated blend layer, the seat
 * shadows, the full-viewport soft-light desk grain composited over every
 * frame. On a low-memory iPhone that allocation spike is what jetsam
 * kills the page for — the "A problem repeatedly occurred" crash — the
 * same death the pinch used to cause before zoom relief.
 *
 * Same answer here: while the book is moving faster than anyone can
 * read, there is nothing worth paying to draw. The schedule's scroll spy
 * (already rAF-sampled) reports scrollTop through `bookScrolled`; two
 * consecutive fast samples set `data-flinging` on <html> and globals.css
 * sheds the blends, the per-card isolation, the seat shadows, and the
 * desk layers — so the tiles the fling demands are cheap to paint. Two
 * samples, not one: a programmatic instant jump (goTo, the today
 * landing) reads as a single huge delta and must not flicker the relief.
 *
 * Relief holds for the whole scroll and lifts only at rest (no scroll
 * events for a beat) — restoring mid-drift would repaint the grace onto
 * tiles still visibly moving. At rest the restore is a single repaint
 * nobody sees.
 */

// ~3px/ms is past any reading pace (a screenful in ~300ms) but well
// inside what a flick reaches; below it, normal scrolling never sheds
const FLING_SPEED = 3;
// scroll events stop when the momentum ends; one quiet beat = at rest
const REST_MS = 160;
// rAF samples arrive ~16ms apart; a gap this long means a new gesture,
// not a velocity
const STALE_MS = 120;

let flinging = false;
let fastRuns = 0;
let lastTop: number | null = null;
let lastAt = 0;
let settle: ReturnType<typeof setTimeout> | undefined;

function setFlinging(next: boolean) {
  if (next === flinging) return;
  flinging = next;
  const root = document.documentElement;
  if (next) root.dataset.flinging = "1";
  else delete root.dataset.flinging;
}

/** The book's scroll spy feeds every rAF-sampled scrollTop through here. */
export function bookScrolled(top: number) {
  const now = performance.now();
  if (lastTop !== null) {
    const dt = now - lastAt;
    if (dt > 0 && dt < STALE_MS) {
      const speed = Math.abs(top - lastTop) / dt;
      fastRuns = speed >= FLING_SPEED ? fastRuns + 1 : 0;
      if (fastRuns >= 2) setFlinging(true);
    } else {
      fastRuns = 0;
    }
  }
  lastTop = top;
  lastAt = now;
  // the rest-watch runs only while shed — an armed timer per sample on
  // every ordinary scroll would be churn for nothing (STALE_MS already
  // fences a stale lastTop off the next gesture's arithmetic)
  if (flinging) {
    clearTimeout(settle);
    settle = setTimeout(() => {
      setFlinging(false);
      fastRuns = 0;
      lastTop = null;
    }, REST_MS);
  }
}
