# Typed capture

Writing an entry with the keyboard and keeping it — the app's core loop.
Two composers exist and both must work; a proof that drives only one is
incomplete.

## Sub-features

- **Today-zone composer**: the ruled textarea in the calendar's blue
  today zone; the wax button swaps mic → quill once words exist.
- **Backfill invite composer**: the inline "Add a story from yesterday" /
  "Add something from today" textarea with its own keep stamp.
- **Failure honesty** (craft law 8): a failed write un-stamps, restores
  the words, and says why — never a silent loss.
- **Keep choreography**: press → card born in the schedule → composer
  clears (today's placeholder flips to "Add something else from today…").

## How to get to it (user POV)

Open `/calendar`. The today zone sits at the book's foot with the ruled
field and wax seal. The backfill invite appears inline in the schedule
near recent day gaps (seed a small book, `?seed=40&years=1`, to surface
it). Type words; the seal arms; press it.

## Driving it with the Chromium personas

`tests/e2e/backfill_keep.py` is the complete working reference for the
backfill leg, including the failure leg. For the today zone:

1. `page = ios_pwa_page(browser)` (or `chrome_ios_page` — typed capture
   must behave identically in both).
2. `goto("/calendar?seed=40&years=1")`, wait ~6 s for the seed.
3. Find `textarea[aria-label^="Write an entry for"]`; set text through
   the prototype setter + `input` event (React ignores `.value =`; see
   `backfill_keep.py:29`).
4. Click `button[aria-label="Keep today's entry"]`; wait ~4.5 s for the
   full press → card → compose sequence.
5. Prove: canary text in `[data-entry]` on the page AND in IndexedDB
   (db `snippets`, store `snippets`, field `.text` —
   `backfill_keep.py:38`), composer emptied, screenshot.

Failure leg: patch `IDBObjectStore.prototype.add` to throw
`QuotaExceededError` behind a `window.__failWrites` flag
(`backfill_keep.py:82`), then prove the row is NOT stored and the words
came back into a visible composer.

## Gotchas

- A keep writes through `db.ts` and stamps `_dirty` — asserting on
  IndexedDB is the real side effect; never write around `db.ts` to set
  up state.
- The seal's aria-label is stateful: "Speak today's entry" with no text.
  Selecting `[aria-label="Keep today's entry"]` too early finds nothing —
  wait after typing (~600 ms).
- The calendar rewrites the URL to `?d=…` on load; pass seed params on
  the initial `goto` only.
- The keep sequence is long (~4.5 s of choreography). Asserting storage
  too early fails a working keep.
