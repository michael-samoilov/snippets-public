# Snippets — Design System

> A pocket commonplace book. The interface is a sheet of warm paper; your
> words are the only thing on it that matters. Everything else whispers.

This document is the design constitution. Future work — by people or by
agents — should be checked against it. The companion skill
`.claude/skills/snippets-craft/` enforces the short version.

## The idea

Snippets exists for one ritual: *Homework for Life* (Matthew Dicks,
**Storyworthy**) — at the end of each day, keep the most storyworthy moment
that happened, before it evaporates. Jokes, quotes, ideas, and turns of
phrase ride along. The two governing constraints:

1. **Capture must cost one breath.** Speak or type; never decide, file,
   or configure at the moment of capture. Filing happens afterwards,
   invisibly (Claude) or with one tap (chips).
2. **Rereading must feel like leafing through a beloved notebook**, not
   scanning a database. Typography does the work; chrome stays quiet.

## Visual direction: writer's field notes

Warm paper and ink, a faded red margin rule, marks in the margin,
sealing-wax red reserved for the act of recording. Deliberately **not**
the generic AI-app look (cream + serif + terracotta cards): the
distinctiveness lives in *structure* — a ruled page, hanging marks,
typographic chrome — not in the background color.

### The signature moment

Live transcription on the day's page: words appear in Fraunces as you
speak — finalized phrases in full ink (`word-arrive`), the phrase still
forming in ghost ink (`.ink-interim`), a wax caret blinking after it.
The seal button breathes while listening. **Spend boldness here and
nowhere else.** Everything around it stays disciplined.

## Tokens (`src/app/globals.css` is the source of truth)

| Token | Paper (light) | Lamplight (dark) | Role |
|---|---|---|---|
| `--paper` | `#f6f0e2` | `#171310` | the page |
| `--paper-raised` | `#fcf8ee` | `#211c15` | popovers, dialogs, toasts |
| `--paper-recessed` | `#ede5d2` | `#100d0a` | pressed/secondary surfaces |
| `--ink` | `#241e15` | `#eae1cd` | primary text |
| `--ink-soft` | `#6f6553` | `#a59879` | secondary text |
| `--ink-faint` | `#978c79` | `#6e6450` | meta text |
| `--rule` / `--rule-faint` | ink @ 14% / 8% | ink @ 16% / 9% | hairlines |
| `--wax` / `--wax-deep` | `#993b26` / `#7a2c1b` | `#c75b40` / `#a44733` | recording, margin rule, destructive |
| `--gilt` | `#a87a24` | `#c99c45` | favorites only |
| `--kind-*` | six muted editorial inks | lightened variants | kind labels + marks |

Rules of use:
- **Wax is semantic, not decorative**: the recording light, the margin
  rule, the active nav dot, destructive actions. Never as a "brand splash".
- **Gilt appears only on favorites.** Scarcity is what makes it gold.
- New colors require a reason this table can't answer.

## Type system

Two families, three voices. No Inter, no Lucide-as-identity, ever.

| Voice | Class | Spec | Used for |
|---|---|---|---|
| Display | `.voice-display` | Fraunces, wght 540, `WONK 1`, `SOFT 0`, tight tracking | page titles, day headers, wordmark (italic) |
| Prose | `.voice-prose` | Fraunces, wght 420, 17px/1.6, oldstyle figures | snippet text, longer copy |
| Meta | `.voice-meta` | IBM Plex Mono 500, 11px, +0.08em, uppercase, **lining tabular numerals** | dates, counts, labels, nav |

Details that matter: `font-optical-sizing: auto` everywhere (WONK
auto-disables ≤18px); `hanging-punctuation` on quotes (Safari
enhancement); quotes set in italic with `.hang-quotes`.

## Structure

- One centered column, `max-w-[42rem]`. No sidebars, no cards, no grids
  of boxes.
- **Entries are typeset, not boxed**: hairline dividers
  (`divide-rule-faint`), a `.entry-list` inset with the faded wax margin
  rule (from `sm:`), kind marks hanging in the margin.
- **Printers' marks** (`src/components/kind-mark.tsx`) are the only
  iconography of identity: ¶ story, ‽ joke, ❞ quote, ✳ idea, ~ phrase,
  ◉ observation — drawn as SVG (the glyphs aren't reliable cross-platform).
  Lucide is permitted for purely functional chrome only (and currently
  unused outside vendored primitives).
- Navigation is **words**: mono-caps links with a wax dot for the active
  page. Mobile gets a typographic bottom tab bar — no icons.

## Motion

Durations and easings are tokens; durations collapse to 0.01ms under
`prefers-reduced-motion` (opacity feedback survives, movement doesn't).

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 140ms | hovers, color shifts |
| `--dur-base` | 220ms | dropdowns, chips |
| `--dur-slow` | 320ms | entries arriving, dialogs |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | everything entering |
| `--ease-in` | `cubic-bezier(0.45, 0, 0.85, 0.4)` | everything leaving |

Choreography: `entry-rise` (8px rise + fade, 45ms stagger, capped at 8),
`word-arrive` (rise + blur(2px)→0 per finalized phrase), `seal-ring`
(1.8s breathing pulse ×2, second delayed 0.9s). Scale floor 0.95; never
animate from scale(0); transform/opacity only. No scroll-triggered
theater, no parallax.

## Surfaces & depth

Paper sits flat. Elevation exists only for transient surfaces
(dialogs, menus, toasts): `--paper-raised` + hairline border + a warm
layered shadow (`rgb(58 46 28 / 0.05–0.07)`, doubling offsets — never
neutral black). Overlays are ink-tinted (`rgb(24 19 13 / 0.45)`), not
gray. Grain: `feTurbulence` fractalNoise 0.7/3 octaves at 5% (7% dark),
`soft-light` — subliminal or delete it.

## Focus & input

- Buttons/links: 2px wax outline, offset 2px.
- Text fields: no box — the caret plus a darkened bottom rule show focus.
- Touch targets ≥ 44px; the seal is 64px on touch, 56px on desktop.

## Copy voice

Quiet, literary, terse, second person. Sentence case. No exclamation
marks, no emoji, no "✨ AI". Claude is mentioned by name only in
Settings; elsewhere filing simply *happens*.

| Instead of | Say |
|---|---|
| Saved successfully! | Kept. |
| Delete / Are you sure? | Let go / "Let this one go?" |
| No items found | Nothing kept yet. Today is a good day to start. |
| Streak: 🔥 12 | 12 days running *(only ever past-tense, never countdown)* |

Streaks are framed as accumulation ("collected on N days"), missed days
are blank, never red.

## Architecture notes that protect the design

- Local-first: Dexie (`src/lib/db.ts`), soft delete with undo, day keys
  in local time. The storage layer is the seam for future sync.
- Enrichment (`/api/enrich`, Claude Haiku) is **best-effort decoration**:
  `enriched: "manual"` always wins; offline → retried; unavailable →
  heuristics + chips. The app must remain whole with zero AI.
- Speech (`use-speech.ts`) auto-stitches mobile session drops and
  flushes lingering interim text on stop. Tap-to-toggle, never hold.

## Roadmap (intentionally deferred)

Sync layer behind the repository seam · Whisper-class adapter behind the
speech interface · weekly "review" digest · notification nudges (needs
push infra) · drawer-based editor on touch · import from Apple
Notes/Google Docs.
