# Backlog

Accepted future work, in the owner's words, with design notes attached
so implementation starts warm. Items here are *decided* — don't re-ask
whether to do them, only how. Check this file before proposing new
scope. When an item ships, delete it here and amend `DESIGN.md` /
`.claude/skills/snippets-craft/` if it changes a rule.

## 0. Voice: retire the diagnostics once trust is earned

The live pipeline is PROVEN (2026-07-04): the CI harness transcribed
the spoken fixture word-perfect at both chunk sizes. Measured — mint
134–287ms (now off the tap path via pre-minted tokens) · connect
~100ms · commit→settled ~80ms (already near-instant, so
`commit_strategy=vad` is NOT worth pursuing) · speech→first-partial
~2s at either chunk size (model-side session warm-up, not our
buffering — if that lag ever matters, it's an ElevenLabs conversation,
not a client tune). Remaining chores, whenever convenient:
- gate or remove `GET /api/scribe-selftest` (spends credit; it was the
  no-secret verification path and is now redundant with CI)
- decide /lab/wax-wash's fate after the wash iterations conclude
  (owner: lab-in-prod is fine short-term)

## 1. The seal becomes the completion affordance

> "Wax seal should show microphone by default, but if the user starts
> typing or talking it should shift to some kind of 'completion'
> interaction instead of remaining a microphone icon."

**Partially shipped (2026-07-02, owner-directed): minimal tap-toggle
voice wiring in the today zone** — tap the mic to record, tap again to
stop, the web engine's words land live on the rules, the transcript
merges into the field, kept entries carry `source: "voice"`. What
remains here is the full completion interaction below (the mode
machine, push-to-talk, the third glyph) plus a mic for the backfill
composer — **to be designed together with the owner, not shipped
unilaterally.** A working prototype of that fuller interaction was
built and e2e-tested in-session (2026-06-11), then deliberately
reverted so the interaction can be shaped collaboratively. What the
prototype established (reuse freely):

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

## 4. The kept entry wears its seal — and re-stamps after an edit

> "Add the stamp generated by the user's entry submission (i.e. the final
> image of the post-animation wax seal) to the bottom-left corner in the
> entry view, opposite the trash icon in the bottom-right. If the user
> edits their submission, the wax seal plays the animation in reverse and
> reverts to a version that's just the white icon, and once they confirm
> their edits, it will replay the animation and return to being the same
> stamp it was before."

Companion to #1 and #2 (the same seal machinery), but for the entry
*view* rather than the moment of capture: the seal becomes the entry's
standing "sealed" mark, and the edit cycle un-seals then re-seals it.

**Where it goes.** The entry foot (`[data-entry-foot]`, `page.tsx`) is a
`justify-between` row — today the bottom-left holds the confirm-quill
(shown only while editing), the bottom-right the ember trash. The request
puts the seal bottom-left, opposite the trash, so it likely *replaces or
subsumes* that confirm-quill (the seal would now carry the same "kept /
confirm the rewrite" meaning). Resolve that relationship first (see open
questions).

**Reuse — and the one real gap (reverse).** The canvas seal is already
imported here as `CanvasSeal` (the 3-D `WaxStamp` from `wax-stamp.tsx`;
the local `WaxStamp` at `page.tsx:3377` is the unrelated CSS quill).

- *Settled stamp* = the kept state. Mount an already-kept entry with
  `still` so it shows the settled seal at once, no entrance.
- *"Just the white icon"* = the seal's resting **dome** (`domeBeat`,
  `iconWhite = 1`): the un-pressed globe wearing the white glyph label.
  That is the revert target.
- *Replay on confirm* = a `playKey` bump (the existing forward press).
- **Reverse doesn't exist yet.** `mode="press"` only runs the beats
  forward (`stateAt` t: 0→1) then holds — there's no settled→dome path.
  `stateAt(t)` is a pure function of `t` and already morphs white label ↔
  embossed glyph through `iconWhite`, so a reverse is tractable, but it
  needs a new path/mode (e.g. "unpress") that drives the beats 1→0 (relief,
  lobe and contact-front recede; `iconWhite` returns to 1). This is the
  bulk of the build.

**Make it the *same* stamp.** The silhouette is seeded by `playKey`
(`makeProfile(mulberry32(playKey…))`), so every press reshuffles the
lobes. For the post-edit replay to return "the same stamp it was before,"
seed it stably per entry (e.g. from the snippet id), not from a counter —
otherwise the re-seal grows a different lobe pattern.

**Reduced motion.** The seal collapses to its settled state with no
animation under reduced motion; the reverse/replay must degrade to an
instant swap (settled ⇄ dome), never a missing or stuck frame.

**Open questions (decide before building).**

- Does the seal *replace* the confirm-quill and become the tappable
  confirm (press the dome → it stamps → edit saved), or stay a passive
  reflection of edit state while confirmation keeps to the existing
  affordance (keyboard dismiss / the quill)? "Once they confirm" is
  agnostic; the cleaner story is the seal-as-confirm.
- Which glyph — the brand "S" (as the wordmark and app icons), matching
  "the same stamp," or the quill the foot wears today? Keep it consistent
  with whatever seal #1/#2 settle on.

**Touches the rules.** Law 6's sanctioned-marks list names the foot's
"wax quill CONFIRM-stamp + ember trash"; standing a wax seal there changes
it — amend `DESIGN.md` and the `snippets-craft` SKILL on ship.

## 5. First-run introduction: the purpose, and the quiet reassurance

> "Intro card to app that: 1) explains purpose (storyworthy etc.)
> 2) reassures about sync & security"

Accepted 2026-07-07, right after accounts/sync/backup shipped. Two jobs
in one first impression: say *what this is for* (Homework for Life —
keep the storyworthy moment before it evaporates) and *why it's safe to
invest* (yours on this device; signing in keeps a server copy; daily
delivery to your own Drive; the app's death doesn't take your book).

**Form: not literally a card.** Law 6 bans cards; law 8 bans dialogs
anywhere near capture. The intent — orientation + reassurance — should
live *on the sheet* as the first-ever empty state, not float over it as
a modal. Today that state is already split across two seams: the today
zone's `placeholderFirstEver` ("Start saving your memories…") and
`copy.today.empty` ("Your days are fuller than you think…" — the
purpose half already exists there in miniature). This item grows that
moment into a proper introduction, then gets out of the way forever.

**Content, in the house voice.** Three short strokes, no more:

1. *Purpose* — extend the `copy.today.empty` register; the About
   section's Matthew Dicks sentence (`copy.settings.about`) is the
   source of truth to echo, not duplicate.
2. *Reassurance* — one sentence, not a security brochure. The register
   is `signin.lead` ("Your book stays on this device either way…") +
   the backup section's "Yours even if this app disappears." Link the
   word, not a button: a quiet underline to `/privacy`.
3. *The door* — the existing capture affordance IS the call to action;
   don't add another.

**Retirement.** The first kept entry retires it naturally (the empty
state ceases to exist). No localStorage "seen" flag unless the intro
outgrows the empty state; if it ever does, key it
`snippets:introSeen` and keep dismissal implicit (writing = dismissing),
never an ✕.

**Kindred case discovered in the field (2026-07-07, the owner hit it):
the blank-book heart-stop.** A returning writer whose entries live under
another origin (domain migration) or another sign-in sees an empty book
with no explanation — indistinguishable from loss. When the book is
empty AND a signed-in account's server copy is also empty, the intro
moment may add one gentle line ("Expecting entries? They may live under
another address or sign-in — Restore from JSON in Settings brings them
here."). Same surface, same voice, same retirement rule.

**Where.** `src/app/calendar/page.tsx` (today zone empty state),
`src/lib/copy.ts` (new `intro` group beside `today`), possibly
`src/components/capture/capture.tsx` if the standalone today page wants
it too. Screenshot both themes, both widths; the intro must read as ink
on the sheet, never as chrome.

## 6. 404 and error pages

> "404 / error pages"

Accepted 2026-07-08. The app currently falls to Next's defaults: the
framework 404 and the bare error boundary ("This page couldn't load" —
seen in the field during testing, and it reads as a broken foreign
app, not Snippets). Ship `src/app/not-found.tsx` and
`src/app/error.tsx` (+ `global-error.tsx` for the shell itself), each
a quiet page in the house voice on the sheet: what happened, one line;
the way back ("Back to the book"); no mascots, no illustrations, no
jokes at the writer's expense. The error page should offer reload
without dumping a stack trace on the reader. Copy lives in `copy.ts`.

## 7. Empty states — a pass over every "nothing here" moment

> "Custom empty states, if needed." And, from field testing: "how does
> the app empty state look — if the full prior year is available when a
> user joins in the middle of the year, that's probably not necessary."

Accepted 2026-07-08, deliberately scoped as an *audit first*: walk
every surface with an empty or sparse book and decide which need a
designed state versus which are quietly fine. Known candidates:

- **The calendar's back-catalogue on a young book** (the owner's
  concrete case): a writer who joins mid-year can page into a full
  prior year of blank months — dead territory that implies neglect
  rather than a fresh start. Consider bounding the navigable range at
  the book's first entry (or the join month), letting history unlock
  as backfill happens. Decide what the year-at-a-glance shows for
  months before the book began.
- Search with no results vs. search on an empty book (today: one
  "Nothing found." — fine for the former, odd for the latter).
- "On this day" is already quietly absent when empty (correct — the
  model to copy).
- A day view opened on a past day with no entries (the backfill
  composer may already carry this).

The first-ever intro (#5, shipped) owns the today-zone empty state;
this item is everything else. Rule of thumb from the constitution:
gaps stay blank, never scolding — an empty state earns copy only when
silence would read as breakage.

## 8. E2E: bind the envelope's cleartext fields into the cipher (AAD)

> Adversarial security review, 2026-07-08. (The critical sibling
> finding — the plaintext-downgrade bug, where the server's enrollment
> answer, not the local key, chose whether to encrypt — was fixed the
> same day: `runCycle` now makes the on-device key authoritative.)

AES-256-GCM authenticates each entry's *ciphertext*, but the row's
identity, `updatedAt`, `deletedAt`, and `payloadFormat` ride *outside*
the sealed envelope, unsigned (`src/lib/sync-wire.ts`). A tampered body
fails to open — but a hostile (or buggy) server can still swap one
sealed entry's ciphertext onto another row, roll a row back to an
earlier sealed version, or flip `deletedAt` to hide or resurrect an
entry, all without reading a word. Close it by binding those cleartext
fields as AES-GCM **additional authenticated data (AAD)** so decryption
fails if the envelope has been moved or its metadata edited.

Design notes:
- AAD = a canonical serialization of `{id, updatedAt, deletedAt,
  payloadFormat}` (exactly the fields sync needs in the clear).
  `encryptJSON`/`decryptJSON` in `crypto.ts` take it as a parameter;
  decrypt recomputes it from the wire row and a mismatch throws — surface
  it as the same "tampered entry" failure that a bad tag already gives.
- This is a `payloadFormat` bump. Existing format-2 seals carry no AAD,
  so either add **format 3** for AAD-bound seals and keep format 2
  decryptable through a migration, or re-seal the whole book on next
  unlock (`reencryptSweep` already exists for exactly this). **Check
  whether any live encrypted books exist before choosing** — a re-seal
  sweep is simplest if the install base is still zero/small.
- Extend `crypto.test.ts`: a row decrypts under the right AAD and fails
  under a swapped `id`, a bumped `updatedAt`, or a flipped `deletedAt`.
- The privacy deep-dive says "a tampered entry fails to open"; once this
  ships that becomes true of the *envelope* too — tighten the copy to
  say so (today it slightly overclaims).

## 9. E2E: refuse weak passphrases at enrollment (+ two crypto tidies)

> Adversarial security review, 2026-07-08.

Enrollment gates only on length (`pass.length < 10`,
`src/app/settings/page.tsx`), so `password12` seals a book. PBKDF2 at
600k iterations slows a guesser but can't rescue a guessable passphrase
— it is the weakest link in the whole scheme, and the copy implies
stronger protection than a weak phrase delivers. Add real strength
enforcement at the "Seal the book?" dialog: a zxcvbn-style estimator +
a common-password blocklist, with a **quiet, in-voice** strength read
(not a coloured nagging meter — laws 6/7) and a floor below which "Seal
it" won't fire.

Design notes:
- Dependency call: `@zxcvbn-ts/core` with lazy-loaded dictionaries, or a
  lighter estimator — load it **only** in the enrollment path, never
  anywhere near capture (law 8) and never in the main bundle.
- The read is one line in the house voice ("that phrase is easy to
  guess — try a longer, stranger one"), not a rainbow bar. The floor is
  a strength score, not a character count; keep the ten-character
  minimum as a floor beneath it.
- Two small hardening tidies to fold in while in `crypto.ts`:
  (a) `generateRecoveryCode` uses `bytes[i] % 30` — modulo bias over the
  30-char alphabet; switch to rejection sampling so every symbol is
  uniform. (b) A comment claims "128 bits"; reconcile it with the true
  figure (~120). Neither is exploitable, but both should read honestly.

## 11. Status indicators: green icons for active security + sync features

Visual signals for user confidence — a quick scan confirms the features
the user has turned on are working:

- **Encryption active** — green shield or shield-with-lock icon
- **Sync active and healthy** — green sync/arrow icon  
- **Google Drive backup active** — green Google Drive icon

Where they live: likely the header or settings top (needs to be visible
at a glance without requiring a deep read). The look will be iterated
on — design for tasteful, quiet signals that don't break the sheet's
calm. Icon set is already Feather (see `SKILL.md` law 6 sanctioned marks);
confirm whether shield/sync/Drive glyphs fit or need custom marks. Icon
placement and styling should follow existing guidance: small, wax-toned
when inactive/unavailable, green only when the state is actively good.

Open: should these show in the header, settings (account section?), both,
or as a separate status line? Should they include tooltips or does
presence alone suffice?
