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
   invisibly (Claude) or with one tap (chips).
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
| `--wax` / `--wax-deep` / `--wax-bright` | `#993b26` família | brighter set | recording, margin rule, destructive; bright = specular highlight |
| `--gilt` | `#a87a24` | `#c99c45` | favorites only |
| `--kind-*` | six muted editorial inks | lightened | kind labels + marks |
| `--sheet-shadow` / `--float-shadow` | warm layered stacks | black layered | the two elevations |

Rules: wax is semantic (recording, rule, destructive), gilt only on
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
  crossfades through 2px blur (Emil's blur-masking).
- Chips stamp: `whileTap 0.93`, pop `[1, 1.07, 1]` on selection, tinted
  fill via `color-mix`.
- Destructive = **hold-to-confirm** (`HoldToErase`): wax fills via
  `clip-path` over 1.4s linear while held, drains in 200ms on release —
  slow where deciding, fast where responding.
- Haptics: `navigator.vibrate` 6–10ms taps on keep/file/select (Android
  enhancement; never load-bearing).

## Feedback placement

Feedback appears **at its trigger** (Rauno): keeping an entry stamps
"Kept." beside the button (`stamp-in`), not a toast; the entry then
visibly settles into the list below (FLIP). Toasts are reserved for
undo-able events (delete) and far-from-trigger results (import).
Numbers that change on action animate with `<NumberFlow>`.

## Structure

One centered column (`max-w-[46rem]` desk, sheet inside). No cards, no
boxes, **no iconography for kinds**: entries are typeset with hairline
dividers and the `.entry-list` margin rule (an empty margin, like a
legal pad's); kinds appear only as small-caps colored labels, chips are
text-only stamps. The app's sole marks are the wordmark's wax dot and
the "Kept." StampMark. Navigation is words — small-caps serif with a
gliding ink underline (desktop) and a floating dock pill (mobile).

The calendar is a camera over time. Month view and a **year at a
glance** are two altitudes of the same world — always-mounted layers in
a fixed stage; switching views zooms both layers about the active
month's own slot (paired scales, factor ↔ 1/factor, spring 320/34)
while they crossfade. Within a view, time is one continuous
**virtualized feed**: ten years of months/years at precomputed offsets
inside a fixed-height spacer (floored one viewport past the last offset
so the current month lands flush at the top), a scroll-bucketed render
window, and **zero scrollTop writes during gestures** — iOS kills fling
momentum the instant a feed compensates scroll mid-flight — plus
`overflow-anchor: none` so the browser never re-anchors across window
remounts. The month grid is recessed (gap hairlines + inset shadow)
with the wax ring springing between selected days on z-10; the year is
3–4-column mini-month dot constellations. Native scrolling does the
travel (the title follows the feed); PageUp/Down and chevrons remain
for discoverability; a wax "Today" affordance appears whenever the view
has wandered. Past days grow a quiet backfill line in the day view
("Add something you remember from this day…", stamped at noon local).
URL carries view state (`?d=`, `?q=`, `?kind=`, `?fav=`).

## Copy voice

Quiet, literary, terse, sentence case. Curly quotes, the `…` character.
"Kept." / "Let go." / "Nothing kept this day." No exclamation marks, no
emoji, no sparkle-AI framing. Streaks past-tense only; gaps are blank,
never red.

## Architecture notes that protect the design

- Local-first Dexie; soft delete + undo; day keys in local time.
- Enrichment is best-effort decoration; `enriched: "manual"` wins; the
  app must remain whole with zero AI and zero network.
- **Ink on paper:** `.voice-prose`/`.voice-display` use
  `mix-blend-mode: multiply` in Paper mode so the sheet's fibers show
  through the strokes (Lamplight stays unblended — luminous ink), plus
  a hair of `currentColor` text-shadow feathering the edges; the four
  mastheads get `.ink-bleed` (SVG `feDisplacementMap`, scale 1.6 —
  display sizes only, it's paint-expensive).
- Speech: two engines behind one hook. Aqua/Avalon (primary, when
  keyed): record with the live wax waveform (`InkBars`), words set
  ~450ms after stop; works in every browser. Web Speech (fallback):
  live word-by-word ink (26ms stagger, blur 3px→0). Both settle via
  `onSettled`; tap-to-toggle always; failures always say why.
- The shader layer is progressive enhancement: gated on mount + Save-Data,
  static (`speed 0`), masked, plain paper always beneath.

## Deferred (intentionally)

Sync layer · weekly digest · push nudges · vaul drawer
editor on touch · opt-in UI sound (paper-thud at 440→220Hz, gain ≤0.08,
default off) · view transitions (no list→detail route pair yet).
