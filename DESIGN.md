# Snippets — Design System

> A desk under lamplight, one sheet of paper on it. The sheet carries
> your words; the desk gives them depth. Everything you can touch
> responds like a physical thing.

This is the design constitution. Future work — by people or by agents —
is checked against it. The `.claude/skills/snippets-craft/` skill
enforces the short version. The lineage: Emil Kowalski's design-eng
skill, Rauno Freiberg's Web Interface Guidelines, Vercel's interface
checklist, and Apple HIG motion principles, all vendored knowledge in
this repo's history.

## The idea

Snippets exists for one ritual: *Homework for Life* (Matthew Dicks,
**Storyworthy**) — at the end of each day, keep the most storyworthy
moment before it evaporates. Two governing constraints:

1. **Capture costs one breath.** Speak or type; never decide, file, or
   configure at the moment of capture. Filing happens afterwards,
   invisibly (Claude), into the data only — never onto the page.
2. **Rereading feels like a beloved notebook**, not a database. The UI
   defers to the words (HIG: deference); the world around them is
   physical, lit, and quiet.

## The physical model

Everything renders inside one conceit — **a desk under lamplight**:

- **The desk** (`--desk`): the page background. Darker than the sheet,
  lit by a radial pool of light from above (`body` background-image),
  textured with grain. Chrome lives here: wordmark, nav, footer, the
  floating mobile dock.
- **The sheet** (`.sheet`): one piece of paper holding all content.
  Raised off the desk by a warm layered shadow + top-edge highlight
  (light from above), with a real paper material on top
  (`@paper-design/shaders-react` `PaperTexture`, static, masked to fade
  out down the page; plain paper beneath so it's never load-bearing).
- **Floating surfaces** (`.float`): dialogs, menus, toasts, the dock —
  brighter paper (`--paper-raised`), stronger shadow. Depth = hierarchy.
- **Light is the depth cue.** Shadows are warm
  (`rgb(var(--shadow-hue))`, never gray-black in Paper mode), highlights
  sit on top edges (`--press-highlight`), display type is pressed into
  the paper (`.voice-display` letterpress text-shadow).

## Tokens (`src/app/globals.css` is the source of truth)

| Token | Paper | Lamplight | Role |
|---|---|---|---|
| `--desk` | `#e8dcc2` | `#0f0c08` | the table; page bg, browser chrome |
| `--paper` | `#f7f1e3` | `#1d1812` | the sheet |
| `--paper-raised` | `#fdf9ef` | `#292219` | floating surfaces |
| `--paper-recessed` | `#eee6d2` | `#15100b` | pressed/secondary fills |
| `--ink` / `--ink-soft` / `--ink-faint` | warm blacks→taupes | creams→umbers | text hierarchy |
| `--rule` / `--rule-faint` | ink @ 14% / 8% | @ 16% / 9% | hairlines |
| `--wax` / `--wax-deep` / `--wax-bright` | `#2e5685` família (sealing-wax blue) | brighter set | recording, margin rule, today; bright = specular highlight |
| `--ember` / `--ember-deep` | `#993b26` família | brighter set | destructive only — never an accent |
| `--marker` | `#f6ce3c` (opaque marker ink) | `#c2952e` | found words in search, nothing else |
| `--gilt` | `#a87a24` | `#c99c45` | favorites only |
| `--kind-*` | six muted editorial inks | lightened | kind labels + marks |
| `--sheet-shadow` / `--float-shadow` | warm layered stacks | black layered | the two elevations |

Rules: wax is semantic (recording, rule, today) and never destructive
— the ember red is destructive's alone, so the writer's color can't be
mistaken for the destroyer's; gilt only on
favorites, all shadows from the shadow tokens or `--shadow-hue`, no flat
hex in components, no new flat fills — a new surface needs a light story
(highlight + shadow), not just a color.

## Type voices

Two families, three voices. No Inter, no icon fonts, ever. Mono is
**data only** and never uppercase.

| Voice | Class | Spec | Used for |
|---|---|---|---|
| Display | `.voice-display` | Fraunces 560, `WONK 1`, letterpress shadow | mastheads, day headers, wordmark |
| Label | `.voice-label` | Fraunces 540, `all-small-caps`, +0.13em | section headers, nav, chips, eyebrows |
| Data | `.voice-data` | Plex Mono 450, 11px, lowercase, tabular lining | times, counts, tags |
| Prose | `.voice-prose` | Fraunces 420, 17px/1.6, oldstyle figures | snippet text |

The Today masthead pattern: small-caps eyebrow (weekday) → huge display
date → italic serif stat line with `<NumberFlow>`. Other pages: display
title + italic stat line (no forced eyebrow).

## Motion

Strong curves, short durations, springs for anything touchable.
Duration tokens collapse under `prefers-reduced-motion`; Motion runs
inside `<MotionConfig reducedMotion="user">`.

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` (entries, default) |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` (on-screen moves) |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` (gesture surfaces) |
| `--dur-fast/base/slow` | 120 / 180 / 260ms |

**The frequency rule (Emil):** actions used 100+×/day never animate
(⌘K palette: zoom neutralized, 100ms fade); tens-of-times actions get
≤120ms; occasional surfaces get standard motion; the one theatrical
moment is the live transcription. **Springs:** magic-move indicators
(`layoutId` nav underline, dock pill) use
`{ stiffness: 380, damping: 30 }`; the calendar day ring uses the same
spring on arithmetic x/y, not `layoutId` (layout projection is
hazardous across virtual block remounts); list insertions
`{ type: "spring", duration: 0.5, bounce: 0.16 }`; selection pops
`bounce: 0.4` keyframed `[1, 1.07, 1]`. **CSS transitions over
keyframes** for anything rapidly re-triggered (interruptibility);
`AnimatePresence` + `layout` for list changes (`MotionEntryList`);
never `scale(0)`; exits faster than entries; transform/opacity only;
hovers gated behind `@media (hover: hover)`.

## Pressable physics

Everything clickable feels physical:

- `.pressable` — comprehensive interactive transition + `scale(0.97)`
  on `:active`. It owns the `transition` property; never pair it with
  `transition-*` utilities.
- Raised buttons (Keep, `PaperButton`) — gradient light from above,
  inset top highlight, drop shadow; press = `translateY(1px)` +
  `scale(0.98)` + shadow compresses to an inset.
- The seal — radial wax material (`--wax-bright` specular at 32%/28%),
  grooved rim, breathing animation + rings while listening, icon
  crossfades through 2px blur (Emil's blur-masking). This live seal
  (`WaxStamp`) is also the **source of truth for the app icons/favicons** —
  they're HD renders of it, not standalone art; re-bake per
  `public/icons/README.md`.
- Chips stamp: `whileTap 0.93`, pop `[1, 1.07, 1]` on selection, tinted
  fill via `color-mix`.
- Destructive = **hold-to-confirm** (`HoldToErase`): ember fills via
  `clip-path` over ~10s linear while held, drains in 200ms on release —
  a deliberate hold so an irreversible act can never be a slip.
- Haptics: `navigator.vibrate` 6–10ms taps on keep/file/select (Android
  enhancement; never load-bearing).

## Feedback placement

Feedback appears **at its trigger** (Rauno): keeping an entry stamps
"Kept." beside the button (`stamp-in`), not a toast; the entry then
visibly settles into the list below (FLIP). Toasts are reserved for
undo-able events (delete) and far-from-trigger results (import).
Numbers that change on action animate with `<NumberFlow>`.

## Structure

One centered column (`max-w-[46rem]` desk, sheet inside). On phones
the desk is exactly one screen: the sheet takes the remaining height
and pages scroll inside it — the paper's bottom edge stays above the
dock. The page itself holds no scroll range, but it may be *dragged*:
the desk (color, lamplight) is painted on the root canvas, which fills
any overscroll and never translates, so Safari's rubber-band and
pull-to-refresh move the sheet over a desk that holds perfectly still
(the fixed grain overlay is oversized past the viewport for the same
reason — nothing ever shows an edge). No cards, no boxes, **no
metadata on the page**: entries are typeset with hairline dividers
and the `.entry-list` margin rule (an empty margin, like a legal
pad's), and they are their words alone — title, kind, tags, time, and
source stay in the data, feeding search, never displayed. The one sanctioned tile material is the calendar's
(year minis, the book's entry tiles, the header search pill, and the
book's composer — whose paint fades rightward into the bare page, an
entry not yet written, seated on the tile line in the tiles' own
paddings — `bg-paper`, hairline border, inset top highlight); it never
leaves the calendar. The sanctioned marks are the wordmark's wax dot, the "Kept."
StampMark, the dock's two hand-drawn strokes (a quill for the day's
page, a calendar for the book — with small-caps words beneath), the
calendar header's search glass in the same line, the entry card's two
foot marks (a pressed-wax quill confirm-stamp — shown while editing an entry,
and on the composer once it holds words — and an ember trash — destructive red, deliberately not wax: wax is the
writer's color, not the destroyer's), and the account glyph. Desktop navigation
is words — small-caps serif with a gliding ink underline; there are
two pages, Today and the calendar (the collection folded into the
book). The avatar sits on the desk's top-right edge: its menu holds
Settings and the seam where cross-device sync will plug in
(`src/lib/auth.ts` — local-first is the constitution, sync only ever
adds on top).

The calendar is a camera over time with **four altitudes**: the year
at a glance, the month canvas, **the book** (the schedule of kept
days), and the focused entry. All are always-mounted layers in one
stage; every transition is the same camera move, paired counter-scales
about the chosen thing's own slot (spring 320/34) while the layers
crossfade. Year⇄month uses the mini's literal slot ratio; month⇄book
anchors on the tapped day's cell at a capped 2.4× (the literal ~7× is
violent). book⇄entry is *not* a camera scale but a shared element: the
pressed tile is the same paper card you read on, so it grows to fill
the stage (easeOutCubic, GPU-promoted via `will-change` — scaling a
mix-blended card is murder to re-raster on the CPU) while the schedule
fades under it. Both directions follow one recipe: a beat of blank,
then the words re-rendered in their **final configuration**, which
pure geometry carries home. Opening, the full entry text holds its
natural size against the growing box (a window opening over the
words) as it fades in. Closing, a stand-in wearing the tile's exact
layout takes the stage in the first beat and rides the card at a
uniform width-locked scale — its right edge can never clip, and it
lands pixel-identical to the real tile (the card's radius eases 10→6
alongside), so the swap is invisible. Never two text layouts
crossfading mid-air. The card keeps the tiles' 8px breath under
the header's hairline rather than climbing flush to it. In the entry
the header climbs to the full date — the weekday and day-of-month
**wipe open from their own slots** (animated `0fr`→`1fr` grid columns)
while the month and year hold still, so there's no separate date line
and the Today control sheds. The date header sizes to
`--date-head: clamp(1.05rem, 5vw, 1.3rem)` — the largest size that
keeps the longest full date ("Wednesday, September 22, 2020") on one
line at any width. **Shared
elements fly across the camera moves.** During month⇄book, any date
number standing in both altitudes flies from its grid cell to its
ledger slot (pulling back, only the day being read); its flyer overlays
both typefaces — the grid's mono and the ledger's Fraunces — and
position, size, and the crossfade ride one spring value, so the type
changes at the flight's spatial midpoint, not on landing (no blur — the
flight's too quick to read one). During year⇄month, the month's
abbreviation morphs between its year-view mini label and its hand-over
label over the first of the month — one small-caps tag, flying and
resizing. Originals hide while their double is in the air; endpoints are
Range text-rects, not line boxes (leading would read as a landing skip).
The stage is **one fixed frame at every altitude**: it fills the page
column, the same distance from the sheet's bottom as the header stands
from its top. Every scrollable surface marks its own terminus with the
**standard scroll terminus** (`components/ui/scroll-terminus`:
`useScrollEdges` + `ScrollTerminus`/`ScrollTerminusHead`): a hairline
pinned at an edge while content lies clipped past it, clearing once
that end is in view (or everything already fit), so a line is drawn
only when there's more to reach. It sits on the very edge with the
content clipping beneath it and nothing past it — an overscroll
rubber-band reveals only the bare sheet. The entry card alone gets a
softer treatment for its long prose: a paper fade just above the line,
and a paper cap just below it that seals the scroller's fractional
sub-pixel bottom so no sliver of the next line peeks under the rule.
Both ride the same state, clearing with the line at the last word, and
both are safe only on the card's plain stock — over the textured sheet
a fade reads as a band and the cap flashes on overscroll, so the
canvases and the book keep the bare hairline. The entry card, the
book, and the month/year canvases each carry the foot line; the Today
page, which scrolls in the sheet itself, marks both ends (head + foot)
the same distance — the header's inset — from the sheet's edges. The
frame's own old line is retired so the two never double up. The feeds' floors are laid out,
not measured — a px container to the last offset plus a `min-h-full`
tail — so a mid-zoom stage resize can never clamp a scroller and
drift a flight's landing. The canvas alone is the deep
archive: it scrolls to January 1950 (or the first entry's year, should
an import reach further) — room for any living writer's earliest
pages, with the effort of getting there scaling with the unlikelihood
of needing to. The glance shows only the lived years: the first
entry's through today's (last week's on an empty book), dormant years
between kept ones standing as empty blocks, a gap of five or more
folding away so old and new pages sit a scroll apart. The year the
camera is over is always in the glance — climbing out of 1980 needs a
1980 to land in — but without permanence: move the camera on and it
folds away. Either way a title never names a month the feed beneath
can't show, and when a feed's list breathes, it re-anchors by month
and year, not by index, keeping the reader's page. The desk is exactly one screen at every size
(every scroll lives in a container — the sheet's main, the feeds, the
entry card — and the page itself only rubber-bands over the
canvas-painted desk). The title row always climbs one altitude and
follows whichever feed scrolls beneath it. The Today button wipes
away rightward and yields its width while the reader stands on today —
the search glass slides over to the corner — returning the same way
when they wander. (Months and years still step by keyboard — PageUp/
PageDown — but carry no on-screen chevrons; only the back chevron, to
the left of the title, climbs an altitude.) The glass itself is a
circle of the cards' material, as tall
as the grown bar and centered on the title text (the same coin the
avatar is struck from); pressed, that circle grows from its own spot
out both ways into the full-row search bar — the title slides off
left, the other buttons off right — and on dismissal the bar retracts
both sides back into the circle, opaque the whole way, wearing the
glass at its center from the retraction's first frame so it lands
already in costume. Dismissing the keyboard over an empty bar
dismisses the bar too; standing words keep it open. While a query stands, the stage shows **the filtered
book**: the same ledger and tiles, only the days that answer, opened
at its last page (the weekday rail folds; the altitudes wait beneath,
hidden; no animation — it re-renders with every keystroke). Found words wear **the
marker** — a real highlighter drawn by `@highlighters/core`: wet ink
that pools and frays, one band per wrapped line joined across the
wrap, swept on left-to-right (suppressed under reduced motion by the
library itself), mounted INSIDE the tile (element targets default
their overlay to `document.body`, which would stand still while the
filtered book scrolls — the `host` argument pins it) and multiplied
into the paper. The ink is the marker token, opaque — the library
supplies the translucency. A match deeper than the six-line
clamp re-windows the preview to show it — led by EARLIER context,
snapped to a sentence opening, behind an ellipsis (a story builds
forward; the lines before a match explain it). Pressing a
found tile opens that day's page in the book itself, straight from
any altitude — from the glance the camera dives through the day's
month-mini directly to the book; the canvas never shows its face.
Clear hands the stage and the row back by the same moves. A **left-to-right swipe**
(touch/pen, rightward within a 45° cone, a flick not a wander) climbs
one altitude too: entry → book anywhere on the card; book → month and
month → year when the swipe begins on the page itself (the blank cells
and label rows between months, a composer or tile or day never arms
it). The layers carry `touch-action: pan-y` so iOS never claims the
horizontal gesture mid-flight. **Every dive is a real history entry**
(`?d=` for the book, `&e=` for the entry — which deep-links too):
descents run through `history.back()` + one popstate handler, so the
browser's own back — the iOS edge swipe included — pops one altitude
through the same camera moves and flights, with the book's scroll and
the ring's day kept. The forward gesture re-dives. Arriving deep, the
stack beneath is synthesized so back always has a floor; on
Chrome/Android, `overscroll-behavior-x: none` declines the rival
navigation gesture outright. The weekday rail exists
only at the month altitude — elsewhere it folds shut (animated
`0fr`/`1fr` grid row) so content sits flush under the title, its
hairline riding along to mark where the scroll area terminates.

Within the year and month, time is one continuous **virtualized
feed**: ten years at precomputed offsets inside a fixed-height spacer
(floored one viewport past the last offset so the current month lands
flush), a scroll-bucketed render window, and **zero scrollTop writes
during gestures** — iOS kills fling momentum the instant a feed
compensates scroll mid-flight — plus `overflow-anchor: none`. The
months are one **continuous canvas**, not tiles: per-day top-edge
rules only (no verticals, no plate), blanks bare — each month's lines
start at its first day and stop at its last — and a short hand-over
row carries the month's small-caps name over its first day's column;
the voids interlock like paragraphs. A matching hairline under the
pinned weekday rail is the reference line: the title hands over the
moment a month's final row-line slips beneath it. The wax ring lives
on the canvas itself so it springs across month boundaries; the year
is 3–4-column mini-month dot constellations.

**The book** lists only days that hold something, ascending, dates
standing in a narrow margin (2.1rem) as sticky ledger headers, with
month hand-over labels inherited from the canvas grammar. Entries are
**paper tiles in the year-mini material** (the one sanctioned card:
`bg-paper`, hairline border, inset top highlight) carrying nothing but
their text at reading density (0.9rem/1.5, clamped at six lines) — no
title, no time, no kind, no tags, no menu — **an entry is its words,
everywhere**: title, kind, tags, time, and source live in the data
(they feed search and the future) but are never displayed. Pressing a
tile dives to the **focused entry**: the whole text, read in peace.
**Pressing the words** opens them for rewriting *in place* — the words
themselves become the field, same metrics, caret at the end, keyboard
up (a focusable div, not a `role=button`, so a long-press still
selects and copies). Only then does a wax quill **confirm-stamp**
appear at the card's foot; pressing it — or dismissing the keyboard —
keeps the change. Across from it, always, a single **ember trash**
(destructive red, no stamp) lets the entry go (soft delete, undo in
the toast, the page closing over the struck line). The words fade softly where
they run off the top or bottom of the card — a "more this way" cue
that dissolves into the crisp foot hairline only once the final line
is in view (no fade, no more to scroll). The card's lit top edge is
held on an overlay ABOVE the scrolling ink, so the depth never
darkens away under the words. Diving back out, the foot fades in the
first beat rather than riding the whole camera move. Today is always present — blank, it
offers "Add something from today…", stamped at the real moment; the
page the reader opened (`probe`) keeps its composer too, past days
stamping at noon. The views are one instrument: tapping
a day opens the book there; reading the book moves selection, title,
and URL — the reader's day is the **topmost whose margin date is
still fully stacked** (a row whose tail merely peeks has handed over)
— so pulling back finds the ring already on the day being read. The final row is wrapped in `min-h-full` so landings
are exact and shrinking content can never dip scrollHeight and clamp
the reader off their page. `?d=` deep-links into the book; the month
view drops it. PageUp/Down step months (no on-screen chevrons); a wax "Today"
affordance fades in whenever the view has wandered. URL carries view
state (`?d=`). The calendar page is chromeless — no masthead, the
title row is the page's first line — and the stage terminates in the
same hairline the weekday rail draws at its top.

## Copy voice

Quiet, literary, terse, sentence case. Curly quotes, the `…` character.
"Kept." / "Let go." / "Nothing kept this day." No exclamation marks, no
emoji, no sparkle-AI framing. Streaks past-tense only; gaps are blank,
never red.

**Name things plainly.** The desk/paper/light conceit is the *visual*
skin — it is never a vocabulary the copy imposes on the reader. Say what
a thing literally does, in words the user already owns: *encrypt your
entries*, not *seal your book*; *your entries*, not *your book*. "Book"
(or "notebook") is allowed only in warm, descriptive prose where it
reads deliberately, and the non-idiomatic "commonplace book" is retired
everywhere. Metaphor earns its place only when it names an actual
on-screen object — the **wax seal** you tap to record/keep is a real
thing, so "tap the seal" stays — or when it genuinely aids
understanding; otherwise the plainer, more idiomatic word wins. A reader
should never have to learn our theme to understand what a control does.

## Architecture notes that protect the design

- Local-first Dexie; soft delete + undo; day keys in local time.
- **Sync is strictly additive.** The device copy is always whole;
  signing in only adds a server copy on top (per-row last-write-wins,
  hand filing outranks the clock, the server's verdict is final —
  src/lib/merge.ts is the one rule). Capture never waits on the
  network; every sync/backup state is a visible line in Settings,
  never a silent stall. Settings/preferences stay per-device by
  intent. Erase on a synced book erases everywhere, and says so.
- **Backup is the escape hatch, not a feature.** The writer's own
  device delivers readable Markdown + a restorable JSON archive into
  a visible folder in their own Drive after each settled sync; the
  JSON stays bit-compatible with "Restore from JSON…" so the book
  outlives the app. The server keeps no Drive credentials (tokens
  transit, never rest) and, under end-to-end encryption, no readable
  entries either — the operator cannot read the book. The plaintext
  Drive files double as the key-loss safety net; they are never
  encrypted. Failures escalate: ledger → Settings line → one quiet
  watchdog email per silence.
- Enrichment is best-effort decoration; `enriched: "manual"` wins; the
  app must remain whole with zero AI and zero network.
- **Ink on paper:** `.voice-prose`/`.voice-display` use
  `mix-blend-mode: multiply` in Paper mode so the sheet's fibers show
  through the strokes (Lamplight stays unblended — luminous ink), plus
  a hair of `currentColor` text-shadow feathering the edges. (Mastheads
  once wore an `.ink-bleed` SVG displacement; it was retired — the
  text-shadow feathering carries the edges.)
- Speech: two engines behind one hook. Aqua/Avalon (primary, when
  keyed): record with the live wax waveform (`InkBars`), words set
  ~450ms after stop; works in every browser. Web Speech (fallback):
  live word-by-word ink (26ms stagger, blur 3px→0). Both settle via
  `onSettled`; tap-to-toggle always; failures always say why.
- The shader layer is progressive enhancement: gated on mount + Save-Data,
  static (`speed 0`), masked, plain paper always beneath.

## Deferred (intentionally)

Weekly digest · push nudges · more backup channels (email digest,
Dropbox — the `backup_status.provider` column is the seam) · optional
per-user end-to-end encryption (the sync payload is already a
versioned envelope; a client-encrypted format is a `payloadFormat`
bump, at the cost of server-rendered Markdown backups) · vaul drawer
editor on touch · opt-in UI sound (paper-thud at 440→220Hz, gain ≤0.08,
default off) · view transitions (no list→detail route pair yet).
