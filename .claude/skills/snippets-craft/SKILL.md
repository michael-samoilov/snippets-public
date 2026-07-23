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
   *Perf exception — the book's entry cards:* they carry only the top
   highlight, no seat shadow, because the schedule renders hundreds at once
   (unwindowed) and a blurred shadow per card jetsam-kills iOS. See the
   FLAT-BOOK LAW below (rule 6) and on `.book-card` in `globals.css`.
2. **Four voices, two fonts, named steps.** `.voice-display` (Fraunces
   WONK, letterpress) · `.voice-label` (small-caps serif — section
   headers, nav, chips) · `.voice-data` (tiny lowercase mono — times,
   counts, tags ONLY) · `.voice-prose` (entry text). Mono is never
   uppercase and never used for labels. No Inter, no icon fonts; buttons
   are serif. Voices are set only at their **named steps** — the base
   class, its `-sm` variant (`voice-label-sm`, `voice-prose-sm`), or
   `text-ui` (0.95rem, the ONE size for serif control text: buttons,
   inputs, action titles) — **never `text-[…]` a voice**; if a new size
   is truly needed it becomes a named step in `globals.css` first.
   Section headers render through `<SectionHeading>`
   (`src/components/section-heading.tsx`), not hand-rolled
   `voice-label border-b` strings. (One tuned exception: the calendar
   composer's textarea keeps its literal 0.9rem/line-height pairing —
   it must wrap character-for-character like the book card preview.)
   **One body shade — the primary ink.** Reading text (full-sentence
   body prose) is the default `ink`; `voice-prose`/`voice-prose-sm` set
   no color, so leave it unset — do NOT mute paragraphs with `ink-soft`
   or `ink-faint`. Hierarchy comes from headers + position + voice, not
   from fading the prose. `ink-soft` is the quiet small-caps label voice
   (`voice-label`); `ink-faint` is for mono data, inactive/secondary
   labels, placeholders, and icons — never a paragraph of body copy.
   `ember` is errors. (This settled over three passes: the settings
   page first drifted to ~12 sizes, then to two prose shades
   (soft/faint), before landing here — one reading shade, the primary
   ink, matching the privacy page.)
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
   are hold-to-confirm (ember `clip-path` fill, ~10s linear hold /
   200ms release). Haptic taps (`navigator.vibrate` 6–10ms) on keep/file/select.
6. **No cards, no iconography.** Entries are typeset lists with the
   `.entry-list` margin rule, and they are their words ALONE: title,
   kind, tags, time, and source live in the data (search) and are
   never displayed (the printers' marks, kind labels, and chips were
   all retired by the owner — don't reintroduce any of them). One sanctioned tile material exists — the
   calendar's (year minis + the book's entry tiles + the header's
   search pill + the book's composer, whose paint fades into the page:
   `bg-paper`, hairline border, inset top highlight), owner-approved
   and calendar only; don't spread it. The sanctioned
   marks: the wordmark's wax dot, the StampMark, the dock's two
   hand-drawn strokes (quill + calendar, small-caps words beneath),
   the calendar header's search glass, the entry card's foot marks
   (a wax quill CONFIRM-stamp — editing an entry, or the composer once
   it holds words — + an ember trash — destructive red, NOT wax), the account glyph,
   the account menu's stroke glyphs (gear · shield · door · person —
   Feather set, 1.8/24 ≡ the app's 1.5/20 line, ink-faint, menu rows
   ONLY), the Google "G" on the sign-in button (owner-approved,
   4-hue, that one button only), and the passphrase field's eye /
   eye-off toggle (same Feather set, encryption enrollment/unlock ONLY)
   — nothing
   else. Wax (a sealing-wax BLUE) is
   semantic (recording, rule, today) and never destructive — the ember
   red (`--ember`) is destructive's alone; the marker yellow
   (`--marker`) belongs to found words in search, nothing else;
   gilt = favorites only. One owner-approved off-palette exception: the
   passphrase strength meter ramps ember→green (`--strength-weak` …
   `--strength-strong`), the app's only green, that meter alone. Text on the sheet is real ink:
   `.voice-prose`/`.voice-display` multiply into the paper in Paper
   mode — **except the book's entry cards**, whose prose is flat (no
   multiply). THE FLAT-BOOK LAW: the schedule renders every kept entry as a
   live card (not windowed), so any per-card paint — `mix-blend`,
   `isolation`, a blurred shadow — is paid hundreds of times, scales with
   the book, and jetsam-kills iOS ("A problem repeatedly occurred"). Book
   cards therefore carry no per-card paint; the ink-into-paper look and the
   lift shadow come back only once the render is windowed (BACKLOG.md #12).
   Do not "restore" them onto the card — it has been tried and it crashes.
7. **Copy voice:** quiet, literary, terse, sentence case, curly quotes,
   `…`. No exclamation marks, emoji, or sparkle-AI framing. Streaks
   past-tense; gaps blank, never red. **Name things plainly — the desk /
   paper / light conceit is the *visual* skin, never a vocabulary the
   copy makes the reader learn.** Say what a thing literally does, in
   words the user already owns: **encrypt your entries**, not *seal your
   book*; **your entries**, not *your book* (allow "book"/"notebook" only
   in warm, descriptive prose where it's deliberate, and never the
   non-idiomatic "commonplace book"). Metaphor earns its place only when
   it names an actual on-screen object — the **wax seal** you tap to
   record/keep is real, so "tap the seal" stays — or genuinely aids
   understanding; otherwise the plainer word wins. When in doubt, prefer
   the word a non-user would understand. **Be concrete, not vague:** when
   a thing has a real figure — an interval, a count, a limit — name it
   (*every 15 minutes*, not *now and then*; *at least ten characters*, not
   *long enough*). A specific number is clearer, and reads as more honest,
   than a soft quantifier that makes the reader guess. **The technical
   register** — copy that explains a mechanism (privacy, terms, the
   sync/backup/encryption lines in Settings, *not* the literary prompts) —
   is held to an STE-informed bar (after ASD-STE100): short one-idea
   sentences (~25 words), active voice, ONE word per meaning (encrypt is
   always *encrypt*, never *seal*), no internal jargon (*payload*,
   *tombstone*, *cursor*, *LWW*), concrete figures. Still the house voice,
   just more literal. A `pnpm test` linter enforces the mechanical rules
   (`copy-clarity.test.ts` / `pnpm check:copy`) over an allowlist — extend
   it when you add a technical surface. Full standard in `DESIGN.md` → Copy
   voice.
8. **Capture friction is sacred.** Nothing may add a decision, dialog,
   or required field to the moment of capture; the app stays whole with
   no API key and no network. `enriched: "manual"` always wins.
   Accounts obey the same law: signing in is never required, sync is a
   quiet additive layer (its states are terse Settings lines — "Synced
   3:12 pm.", counts in the data voice — never banners or spinners in
   the capture path), and no keep ever fails silently — a failed write
   un-stamps, restores the words, and says why. Signing in implies
   end-to-end encryption: enrollment (the passphrase step) is part of
   sign-in, sync WAITS for it — loudly, in letters and Settings lines —
   and capture never does. There is no way to turn encryption off, and
   no UI may offer one.
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
