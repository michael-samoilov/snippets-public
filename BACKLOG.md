# Backlog

Accepted future work, in the owner's words, with design notes attached
so implementation starts warm. Items here are *decided* — don't re-ask
whether to do them, only how. Check this file before proposing new
scope. When an item ships, delete it here and amend `DESIGN.md` /
`.claude/skills/snippets-craft/` if it changes a rule.

## 1. Text that reads as ink on paper

> "Is there a way we can render text in the app to make it look more
> like ink on paper?"

The cheap, convincing recipe (try in this order, screenshot each):

- **Let the fibers show through the strokes.** Text inside the sheet
  gets `mix-blend-mode: multiply` (Paper) / `screen` or `plus-lighter`
  tests (Lamplight) so the `PaperTexture` fibers modulate the ink the
  way real paper drinks it. Scope to `.voice-prose` / `.voice-display`
  via a `.text-ink-real` class — blend modes create stacking contexts,
  so apply deliberately, not globally. Ink color may need to darken
  slightly to keep APCA contrast after multiply.
- **Soften the edge a hair.** Real ink has no razor edges: a barely-
  there `text-shadow: 0 0 0.4px currentColor` fattens/feathers strokes
  (works at all sizes, costs nothing).
- **Bleed on display sizes only.** An SVG filter
  (`feTurbulence baseFrequency≈0.25 + feDisplacementMap scale 1–1.5`)
  applied to mastheads gives true edge wobble. Per-element SVG filters
  on text are paint-expensive: display headings only, never prose,
  skip under Save-Data, verify Safari.
- Keep the existing letterpress shadow; these layer on top of it.

## 2. Remove the printers' marks (kind glyphs)

> "Let's remove the icons/characters associated with each type of
> observation."

Retire ¶ ‽ ❞ ✳ ~ ◉ everywhere: entry margins, chips, command-menu
results, the favorites ✳ on the filter chip. Kinds become small-caps
colored labels alone (`.voice-label` + `--kind-*`), chips become
text-only stamps. Decide what (if anything) hangs in the `.entry-list`
margin afterwards — likely nothing but the rule itself; check the
gutter doesn't feel orphaned at `sm:` and tighten `padding-left` if so.
Delete `kind-mark.tsx` when no imports remain. **Constitution change:**
DESIGN.md "Structure" and snippets-craft rule 6 currently mandate the
marks — amend both in the same commit.

## 3. Backfill snippets onto past days

> "Add a way to add snippets for days which have already passed."

`addSnippet` already accepts a `capturedAt` override and derives `day`
from it — the data layer is ready. UI: on the Calendar's day view, when
the selected day is in the past, show a quiet one-line capture beneath
the day's entries ("Add something you remember from this day…") — a
slim variant of `Capture` (typed-first; voice optional) that passes
`capturedAt` = noon local of the selected day (noon avoids DST edges).
Entries land in that day's list via the existing live query + FLIP.
Keep the Today page untouched — backfilling lives where the past
lives. Streak semantics: `computeStats` counts by day keys, so
backfilled days extend runs retroactively; that's acceptable and
honest (the moment happened; the writing came late).

## 4. Calendar: Apple-Calendar-grade navigation

> "More sleek, drawing inspiration from Apple Calendar — scroll up/down
> between months, go 'back' to a year-at-a-glance view, navigate from
> there."

Three layers, in implementation order:

- **Scroll/swipe between months.** Wheel + touch vertical pan over the
  grid steps months with the existing directional slide; debounce wheel
  by intent (accumulate deltaY past a threshold, ~80px, then commit),
  `overscroll-behavior: contain`, keep the chevrons (a11y + discover-
  ability), arrow-key support while the grid has focus.
- **Year at a glance.** Tap the month title (or pinch-out later) →
  a 3×4 grid of mini-months: tiny day dots only where entries exist,
  current month ringed in wax. Tap a mini-month → month view.
- **The morph.** Year↔month is the app's one shared-element
  opportunity: give each mini-month a `layoutId` (`month-2026-06`) and
  let the chosen one expand into the full grid (spring 380/30) while
  the others fade. Render only prev/current/next months' full grids;
  mini-months are cheap (dots from `useDayCounts`).
- "Today" affordance returns view + selection to now from anywhere.

## Done from the same request

- ~~Calendar focus-ring z-order (ring traveled under tiles when moving
  to an earlier date)~~ — fixed: ring lifted to `z-10` so it glides
  over tiles in both directions.
