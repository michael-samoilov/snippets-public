# The schedule view's writing machinery — a full map

Written 2026-08-01, before the "make writing feel premium" push, at the
owner's request for a map of how the code around the writing surfaces
works. This is that map: every mechanism that can move the schedule's
scroll position or change a card's size, why each exists, and where the
jitter and the jumps structurally come from. The
contract section at the end records what the owner actually wants, from
the interview that followed.

## The three writing surfaces

The schedule feed (`data-layer="schedule"`, the `[data-book-scroller]`)
hosts THREE different editors, each with different machinery:

1. **The today zone** — the big composer at the book's foot
   (`data-room-center`, `calendar/page.tsx` ~6600–7420). Opted OUT of the
   generic keyboard hook; owns ~700 lines of private scroll machinery
   (below). Layout stance: date fixed under the zone top, seal fixed
   above the terminus, field centred between via a flex slack + a
   rest-sized spacer; growth consumes the slack, then grows the zone 1:1
   with max-scroll.
2. **Inline day composers** — "Add a story from yesterday" on any empty
   day row (`data-room-pin`, ~6260–6360). Managed by `useKeyboardRoom`.
   Capped at an exact six-line box (`max-h-[160px]`, 23px integer line
   grid) so it never outgrows the `line-clamp-6` preview card it becomes.
3. **The entry rewrite** — tap a card, edit in the entry layer
   (`entry-view.tsx`). Its own scroller (`data-entry-card-content`,
   `[overflow-anchor:none]`), `autosizeArea` per keystroke,
   `useContainedField` capping `max-height` to the space above the
   keyboard — re-fit at 300/700ms, on vv resize/scroll, AND every 1200ms.
   Also managed by `useKeyboardRoom` (the entry layer is a sibling of the
   schedule layer, so the book-scroller machinery doesn't reach it).

## The scroll-writer census

Every code path that writes the book scroller's `scrollTop` (grep
`scrollTop (+|-)?=`), grouped by system:

**A. `useKeyboardRoom`** (5 writers): `correct()`'s foot-anchor for
pinned composers; its band clamp + stranded-field rescue for plain
fields; the freeze snap-back (`frozenSt`, re-armed 900ms after each
legitimate mover); the selection lock (book held `overflow:hidden` while
a selection stands, snap-back underneath).

**B. The today zone** (7 writers): `anchorTail` (seal pin / caret-centre
fallback), `revealCaret` (nudge a strayed collapsed caret into view),
rest stance (`scrollHeight - clientHeight - spacer`), the walk clamp
`onScScroll` (2 writers: hold line 1 at top; pull a left-behind caret to
the walk's leading edge), the selection-drag containment (pull the zone
top back to the scroller top), plus `trimSpacer`/`sizeKbSpacer` resizing
the reach spacer (moves max-scroll, which moves effective position).
Anchor passes fire at 0, rAF, 80, 200, 360, 600, 900, 1300ms — the
comment says it plainly: "whoever writes last wins… the long tail just
makes sure ours is the final word."

**C. The render window** (4 writers): climb-end anchored widen
(fractional gBCR delta), `relandOnRow` (up to 3 corrective writes),
`flushHeal` placeholder healing (writes `scrollTop += above` when the
book has been quiet >120ms), `measureRows`/`--cis` rewrites (change
`scrollHeight` under the scroll).

**D. Choreography**: `smoothScrollTop` (rAF-eased glide),
`settleSealIntoView` (waits for keyboard + camera rest, then glides the
seal into view before the press), dive/rise climbs.

**E. iOS itself** (unattributable): focus scroll, late caret-reveal
scrolls, keyboard avoidance as a visual-viewport pan OR a document
scroll, WebKit's selection/caret auto-scroll chasing into the nearest
scrollable, momentum flings.

## The guard-flag census

Because iOS never says WHO caused a scroll, every system infers
legitimacy from side channels, and each historical mis-inference grew a
new flag. Current inventory: `touchDown`, `frozenSt`, `selLocked`,
`overflowHeld`, `armT`/`lastElMoveAt` (room); `touchActiveRef`,
`walkRef.until`, `walkRef.sanctioned`, `walkRef.prevSt/prevSel`,
`walkSessionRef`, `selDragRef` (+400ms self-extending), `lastInputRef`,
`lastFocusAt` (zone); `climbingRef`, `tookOverRef`,
`lastScrollTsRef` (window); plus the timer schedules (900/400/300ms
arm-freeze; 80–1300ms anchor tail; 140/300/450ms room settles;
300/700/1200ms contained-field refits; 600ms walk windows; 120ms heal
quiet rule). ~17 flags, ~20 timers, four systems, one scroller.

## Where sizes change (the jump inventory)

| Threshold | Where | Failure mode |
|---|---|---|
| 6-line cap = 160px = clamp-6 preview | inline composer ↔ book card | any drift between the three (fonts, fractional lines) = a leap at the 6/7-line boundary; the 23px integer grid was itself a fix for one |
| `autosizeArea` per keystroke | all three editors | grows a whole line at a time; every growth triggers the room's `run()` passes |
| `useContainedField` live `max-height` | entry rewrite | rewritten on a 1.2s interval + vv events; a flickering `visBottom` read = a flickering box |
| `--cis` placeholders | every cold day section | stale placeholder ≠ real height → content shifts when a section warms; healed only when quiet |
| keyboard inset estimate | `kbGeom` three viewport models, incl. a 45%-of-screen guess on pan-only devices | wrong guess = wrong stance = visible correction |
| reach spacer | today zone | sized at focus, trimmed per anchor pass — max-scroll moves while you write |
| FLIP (`MotionEntryList`) + `AnimatePresence` | card add/remove | animates layout deltas; any simultaneous scroll correction compounds |

## The structural diagnosis

None of these systems is individually wrong; each one demonstrably fixed
a real recorded bug. The tangle is that **four writers share one scroller
and none of them can tell the others' writes from iOS's from the
reader's.** Legitimacy is inferred from timers and flags; each inference
failure historically became a new flag; and several defences are
last-writer-wins timer barrages by design. Two systems disagreeing for a
frame = a visible twitch; disagreeing in a loop = violent jitter (the
2026-07-31 caret-drift bug was exactly such a loop: `correct()` versus
the iOS keyboard pan, discovered only because the caret made it visible).

Two DESIGN choices, not bugs, generate most of the fights:

1. **Contained fields** (inner-scrolling capped boxes) exist to keep
   WebKit's caret-follow off the book — but they create a second scroll
   surface per editor, the WebKit #138201 caret-drag dead zone, the cap
   thresholds, and the entire walk-clamp apparatus.
2. **Composers live inside the same scroller as the lazy-rendered
   book** — so keyboard clearance, warm-band placeholder healing, FLIP
   settles, and the reader's own scrolling all compete over one number.

A fix that keeps both choices must keep most of the machinery. A rebuild
that revisits either can delete whole systems instead of guarding them.

## Principles for the rebuild (proposed)

- **One scroll owner per mode.** At rest: the reader (plus quiet
  placeholder healing). While writing: exactly one anchoring routine per
  surface, everything else read-only. During choreography: the
  choreographer, with input parked.
- **Attribution over inference.** Corrections keyed off our own writes'
  bookkeeping (the `sanctioned` pattern, generalized), never off "it's
  been quiet 600ms."
- **Spec first.** The contract below is the test list; every clause gets
  a harness assertion (`scripts/measure-composer-room.py` is the
  template) before code moves.
- **Delete before adding.** Any clause the contract drops (e.g. inner
  containment) takes its guard flags with it in the same commit.

## The contract (owner interview, 2026-08-01 — first round)

Decided by the owner:

1. **Contained cards stay.** While typing, a growing entry caps and
   scrolls its own words inside the box; the page holds still. The
   rebuild's job is to make containment flawless, not to replace it —
   so the inner-scroll machinery stays in scope and must be hardened,
   not deleted.
2. **The keep choreography stays, executed flawlessly.** The full
   sequence — keyboard exits, seal settles into view, press, card
   settles, composer returns — is part of the app's soul. The bar is
   zero visible glitches through the whole sequence, not a shorter
   sequence.
3. **The keyboard goes down on keep** (current behaviour confirmed).
4. **The jitter is systemic** — the owner sees it "everywhere," across
   all three editors, which supports the structural diagnosis above
   (shared scroller, four writers) rather than any single surface's bug.

Open questions, for the owner to answer when they get to them (do NOT
re-ask; wait):

- **Which card-jump moments actually occur** — scrolling history /
  typing at a size boundary / right after sealing / opening-closing an
  entry? (Ranks the render-window vs cap vs choreography suspects.)
- **The silent six-line clamp** on book cards: keep as is, add a quiet
  "there's more" cue, or show full text? (Full text would rewrite the
  render window's economics and the composer's cap pact.)
- **Staging**: rebuild shipped in slices (my recommendation), one
  big-bang rebuild, or targeted fixes only?
- **When containment collides with a real iOS limitation** (e.g. WebKit
  cannot caret-drag to text hidden inside an inner-scrolled box): never
  fight iOS, keep a small named set of fights, or rule case by case?
