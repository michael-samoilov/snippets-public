/**
 * Scroll fidelity — cards travel light, rest rich.
 *
 * The book's expensive paint (the ink-into-paper blend on every line, each
 * card's isolated blend layer and blurred seat shadow, the full-viewport
 * soft-light desk grain and lamplight pool) is worn ONLY when the book is
 * still. While it scrolls — and on first load, until it settles — the book
 * is flat: plain paper, hairline border, text. Flat is cheap to raster, so a
 * fast flick never overruns the compositor, and a cold render of a
 * years-deep book (the crash: iOS jetsam-kills the page building the whole
 * ledger at once) lays out flat instead of painting every rich tile up
 * front.
 *
 * The trick that makes this safe where content-visibility wasn't: every
 * toggle here is PAINT ONLY — isolation, blend-mode, box-shadow, a grain
 * layer's visibility. None of them change a box's size or position, so the
 * scroll can never shift and momentum can never die (the exact failure
 * content-visibility caused on iOS by swapping real heights for estimates).
 * The whole book stays in the DOM at its true height the entire time; only
 * how it's painted changes, and only the on-screen tiles pay for the rich
 * repaint when the book comes to rest.
 *
 * `data-book-still` on <html> is the flag: ABSENT (the default, so the
 * server render and first paint are flat) = travelling, PRESENT = at rest.
 * globals.css keys off it.
 */

// at rest this long → rich. Short enough that lifting your thumb shows full
// cards near-instantly ("if we stop at any point we see the cards there
// fast"), long enough that a flick's brief between-samples gaps don't flicker
// richness on mid-fling.
const REST_MS = 130;

let still = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function setStill(next: boolean) {
  if (next === still) return;
  still = next;
  const root = document.documentElement;
  if (next) root.dataset.bookStill = "1";
  else delete root.dataset.bookStill;
}

function armRest() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => setStill(true), REST_MS);
}

/** The book's scroll spy calls this on every rAF-sampled scroll. Any motion
 *  flattens at once; rest a beat later re-riches. */
export function bookScrolled() {
  setStill(false);
  armRest();
}

/** Call once the book has mounted (and again once the full history mounts):
 *  a book that never gets scrolled still earns its richness a beat after it
 *  settles — and the heavy full-book mount happens inside the flat window. */
export function bookSettled() {
  armRest();
}
