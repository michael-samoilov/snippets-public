# Backlog

Accepted future work, in the owner's words, with design notes attached
so implementation starts warm. Items here are *decided* — don't re-ask
whether to do them, only how. Check this file before proposing new
scope. When an item ships, delete it here and amend `DESIGN.md` /
`.claude/skills/snippets-craft/` if it changes a rule.

## 1. The seal becomes the completion affordance

> "Wax seal should show microphone by default, but if the user starts
> typing or talking it should shift to some kind of 'completion'
> interaction instead of remaining a microphone icon."

**To be designed together with the owner — do not ship unilaterally.**
A working prototype was built and e2e-tested in-session (2026-06-11),
then deliberately reverted so the interaction can be shaped
collaboratively. What the prototype established (reuse freely):

- Mode machine derived, not stored: `busy` (transcribing) → `stop`
  (listening) → `arm` (idle + text present) → `mic` (idle + empty).
  Seal renders when `speech.supported || hasText`, which also gives
  no-speech browsers the seal as a pure keep-stamp.
- Gestures: all actions dispatch on `pointerup`; in `arm`, a 480ms
  hold on `pointerdown` flips into **push-to-talk** (release = stop) —
  this resolved the voice-append fork and felt right. Pointer capture
  on down; `onContextMenu` preventDefault; keyboard activation arrives
  as `click` with `detail === 0` (guard so mouse doesn't double-fire);
  hold state needs real `useState` for the hint copy (refs in render
  trip react-hooks lint).
- Third glyph: the six-ray emblem (StampMark's rays) crossfades in via
  the existing blur-morph. `aria-label` per mode; hint copy: "press
  the seal to keep it · hold it to speak more".
- The separate ink Keep button was removed; `⌘↵` kept working.
- e2e flow passed: record → settle → seal arms → press keeps.
- Full prototype source preserved at `/tmp/seal-prototype-capture.tsx`
  during the session (gone with the container — the notes above are
  the durable record).

## 2. The stamping moment — make keeping an entry juicy

> "Make the wax seal animation more delightful and juicy upon
> completing an entry. We may need a dedicated working session to get
> this right, may need some custom work."

Companion to #1; same joint session. Prototype findings worth keeping:

- Press choreography that read well: imperative
  `animate(seal, { scale: [1, .86, 1.05, 1], rotate: [0, -2.5, 1, 0] },
  { duration: .45, times: [0, .3, .68, 1], ease: [.23, 1, .32, 1] })`
  triggered from `keep()` (Motion's standalone `animate` on the DOM
  node; skip under `useReducedMotion`).
- One decisive ring: keyed span, CSS `scale(.95→1.9)` + fade, 480ms —
  distinct from the listening breath.
- Glint: `::before` gradient bar sweeping `translateX(-130%→130%)
  rotate(12deg)`, 320ms with 90ms delay, inside the seal's
  overflow-hidden face.
- "Kept." impression now slides out from the seal's side
  (`stamp-in` gained `translateX(-8px→0)`) — this part SHIPPED and
  stays.
- Haptic `[12, 30, 12]`. Still open for the session: should the new
  entry's flight into the list originate from the seal; sound (opt-in);
  whether the press squash wants squash-and-stretch asymmetry.

## 3. Move the primary typeface off Fraunces

> "Consider changing our primary font away from Fraunces. I've seen it
> in the first two other vibecoded websites I've seen. I think all the
> following are examples of being vibecoded: Fraunces, Bricolage, Space
> Grotesk, Sora, Young Serif, Bodoni, Geist, Syne, Inter, Instrument
> Serif."
>
> "When we do that, we'll have to change the logo S as well (and the
> favicon, etc.)."

A *consideration*, not a settled swap — the owner wants off Fraunces
because it now reads as a vibecode tell, but the replacement is open.
Whatever lands has to carry the type system, not just substitute a
family.

**What the serif must keep doing.** Fraunces is the whole serif half of
law 2's "two fonts": it backs `.voice-display` (WONK axis + the
letterpress emboss), `.voice-label` (small-caps), and every button (the
mono, IBM Plex Mono, is the other font and stays). A replacement needs
(a) real character at display size — Fraunces's WONK/SOFT/opsz is what
keeps the masthead from looking default; (b) a clean letterpress emboss,
since the seal "S" and mastheads lean on fine serifs that don't halo;
and (c) a quiet small-caps for the label voice. Decide up front whether
one family covers display + label or they split (still two fonts total).

**Avoid-list** (the owner's vibecode tells — don't pick these): Fraunces,
Bricolage, Space Grotesk, Sora, Young Serif, Bodoni, Geist, Syne, Inter,
Instrument Serif. (Inter is already banned by law 2 regardless.)

**The cascade — what the swap touches** (the owner's "the logo S and
favicon, etc."):

- `src/app/layout.tsx` — the `next/font` loader, its axes, and the
  `--font-fraunces` variable name.
- `src/app/globals.css` — the `--font-fraunces` token, `.voice-display`
  / `.voice-label`, and the letterpress treatment tuned to Fraunces's
  metrics.
- `src/components/shell/wordmark.tsx` + `src/components/capture/wax-stamp.tsx`
  — the masthead seal is the letter **"S"** set in italic Fraunces and
  embossed. A new glyph changes the silhouette, so re-tune `SEAL_RATIO`,
  `NUDGE`, the baseline alignment, and `superSample`.
- `scripts/generate-icons.mjs` — the favicon "S" is a **hard-coded
  vector outline** (`S_PATH`, with bounds `S_CX` / `S_CY` / `S_H`) traced
  from italic Fraunces at opsz≈22. Re-trace from the new font, recompute
  the centring constants, then `pnpm icons`. And per the script's own
  note, the icons that actually *ship* are re-rendered from the live 3-D
  seal — regenerate those too, not just this flat fallback.
- Regenerate the baked assets: `src/app/icon.png`,
  `src/app/apple-icon.png`, and `public/icons/icon-192.png` /
  `icon-512.png` / `maskable-512.png`. (Wax + paper hues are unchanged,
  so `themeColor` / the manifest shouldn't move.)
- On ship, amend the rule-holders this file's header names: `DESIGN.md`
  and `.claude/skills/snippets-craft/SKILL.md` (both cite Fraunces in
  law 2), plus the `README.md` mention.

**Choosing (start warm).** The bar: a serif with genuine letterpress
character and either an expressive axis or true italics, that does *not*
read as a 2020s variable-font default. Favour real history or quirk over
the current designy crop; confirm it embosses cleanly at the seal "S"
and holds the small-caps label voice, in both themes and the masthead
press, before committing. The `frontend-design` skill is the right
companion for that selection session.
