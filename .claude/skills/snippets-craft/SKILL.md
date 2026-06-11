---
name: snippets-craft
description: The design constitution for this repo (Snippets, a desk-and-paper commonplace book PWA). Use whenever building, changing, or reviewing ANY user interface, styling, copy/microcopy, or animation in this repository — before writing the code. Encodes the physical model (desk/sheet/light), type voices, pressable physics, motion budget, copy voice, and the anti-generic guardrails.
---

# Snippets craft rules

Snippets renders one conceit: **a desk under lamplight with a sheet of
paper on it**. The desk (`--desk` + radial light + grain) holds the
chrome; the sheet (`.sheet` + PaperTexture shader + warm layered shadow)
holds the words; floating surfaces (`.float`) sit above. Light from
above is the depth cue. Full rationale in `DESIGN.md`. The laws:

## Hard rules

1. **Tokens only; light, not fills.** Colors from `globals.css` custom
   properties; shadows from `--sheet-shadow`/`--float-shadow`/
   `--shadow-hue` (warm, never gray on Paper). A new surface needs a
   light story — top highlight + shadow — not just a background color.
   No Tailwind palette colors, no flat hex in components.
2. **Four voices, two fonts.** `.voice-display` (Fraunces WONK,
   letterpress) · `.voice-label` (small-caps serif — section headers,
   nav, chips) · `.voice-data` (tiny lowercase mono — times, counts,
   tags ONLY) · `.voice-prose` (entry text). Mono is never uppercase and
   never used for labels. No Inter, no icon fonts; buttons are serif.
3. **Everything pressable feels physical.** Use `.pressable` (it owns
   the `transition` property — never pair with `transition-*`
   utilities), or the raised-button recipe (inset top highlight + drop
   shadow; press = translateY(1px) + scale .98 + shadow compress).
   Hovers gated behind `@media (hover: hover)`.
4. **Motion budget (Emil's frequency rule).** 100+×/day actions don't
   animate (⌘K stays instant); UI motion ≤260ms with the strong curves
   (`--ease-out: cubic-bezier(0.23,1,0.32,1)`); springs for touchable
   things — magic-move indicators (`layoutId`) at
   `{stiffness: 380, damping: 30}`, list FLIP via `MotionEntryList`,
   selection pops `[1,1.07,1]`. CSS transitions over keyframes for
   rapidly re-triggered state. Never `scale(0)`; exits faster than
   entries; transform/opacity/filter only; everything inside
   `MotionConfig reducedMotion="user"` and the CSS duration tokens
   collapse under reduced motion.
5. **Feedback at the trigger.** Confirmations stamp in place ("Kept."
   beside the button); toasts only for undo (delete) or far-from-trigger
   results; counters animate with `<NumberFlow>`; destructive actions
   are hold-to-confirm (wax `clip-path` fill, 1.4s linear hold / 200ms
   release). Haptic taps (`navigator.vibrate` 6–10ms) on keep/file/select.
6. **No cards, no icon identity.** Entries are typeset lists with the
   `.entry-list` margin rule; kinds use the printers' marks in
   `kind-mark.tsx`. Wax is semantic (recording, rule, destructive);
   gilt = favorites only.
7. **Copy voice:** quiet, literary, terse, sentence case, curly quotes,
   `…`. No exclamation marks, emoji, or sparkle-AI framing. Streaks
   past-tense; gaps blank, never red.
8. **Capture friction is sacred.** Nothing may add a decision, dialog,
   or required field to the moment of capture; the app stays whole with
   no API key and no network. `enriched: "manual"` always wins.
9. **Quality floor:** wax focus ring on controls (caret + darkened rule
   on text fields), hit targets ≥44px touch, URL reflects view state,
   `touch-action: manipulation`, both themes + reduced-motion checked,
   IndexedDB indexed fields use `0|1` not booleans.

## Before shipping UI

Screenshot at 1280px and 390px, Paper and Lamplight (CLAUDE.md → Visual
verification; stub both SpeechRecognition globals; `force=True` clicks
on breathing elements). Then ask: *does every interactive element react
to the hand? does light explain the layers? would any part be mistaken
for a default shadcn app?* Check the mirror, remove one accessory.
