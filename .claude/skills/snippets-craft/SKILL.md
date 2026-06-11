---
name: snippets-craft
description: The design constitution for this repo (Snippets, a paper-and-ink commonplace book PWA). Use whenever building, changing, or reviewing ANY user interface, styling, copy/microcopy, or animation in this repository — before writing the code. Encodes the token system, type voices, motion budget, copy voice, and the anti-generic guardrails this app was built on.
---

# Snippets craft rules

Snippets is a "writer's field notes" app: one column of warm paper, ink
typography, a faded red margin rule, sealing-wax red reserved for
recording. Full rationale lives in `DESIGN.md` at the repo root — read it
for anything structural. These are the laws:

## Hard rules

1. **Tokens only.** Colors come from `globals.css` custom properties
   (`--paper*`, `--ink*`, `--rule*`, `--wax*`, `--gilt`, `--kind-*`).
   Never hex literals in components, never Tailwind palette colors
   (`zinc-500`, `indigo-600`…). New tokens go through `globals.css` with
   both Paper and Lamplight values.
2. **Three voices, two fonts.** `.voice-display` (Fraunces, WONK 1) for
   titles, `.voice-prose` (Fraunces 420) for content, `.voice-meta`
   (Plex Mono caps, lining numerals) for dates/labels/nav. Never
   introduce Inter or another sans. Buttons are serif.
3. **No cards, no icon identity.** Entries are typeset lists with
   hairline dividers and the `.entry-list` margin rule. Kinds are marked
   with the hand-drawn printers' marks in `kind-mark.tsx` (¶ ‽ ❞ ✳ ~ ◉)
   — extend that file, don't reach for Lucide/emoji. Lucide only for
   purely functional chrome, and only if text can't do the job.
4. **Wax is semantic.** Recording, margin rule, active dot, destructive.
   Gilt = favorites only. Don't decorate with either.
5. **Motion budget.** Use `--dur-*`/`--ease-*` tokens (they collapse
   under reduced-motion). Transform/opacity only; scale floor 0.95;
   stagger ≤8 items × 45ms. The only theatrical moment in the app is the
   live transcription; do not add competing spectacle.
6. **Copy voice:** quiet, literary, terse, sentence case. "Kept." /
   "Let go." / "Nothing kept yet." No exclamation marks, no emoji, no
   sparkle-AI framing; streaks past-tense only, gaps never shamed.
7. **Capture friction is sacred.** Nothing may add a decision, dialog,
   or required field to the moment of capture. Enrichment is best-effort
   decoration: `enriched: "manual"` always wins; the app must remain
   fully usable with no API key and no network.
8. **Quality floor:** keyboard focus visible (wax ring on controls;
   caret + darkened rule on text fields), touch targets ≥44px, both
   themes checked, `prefers-reduced-motion` respected, IndexedDB rows
   use `0|1` not booleans for indexed fields.

## Before shipping UI

Screenshot it (see CLAUDE.md → Visual verification) at 1280px and 390px
in Paper and Lamplight, and ask: *would this be mistaken for a default
shadcn/AI-generated app?* If any part would, it isn't done. Check the
mirror, remove one accessory.
