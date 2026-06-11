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
