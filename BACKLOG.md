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

## 11. Status indicators: green icons for active security + sync features

> Partial overlap since the privacy push (2026-07-23): Settings' protection
> rows already carry live worded states — Encrypted / Locked / Sync paused
> (needs-setup) — in wax/ember tones. This item is the at-a-glance GLYPH
> layer above them.

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

## 13. Link preview: dynamic today's-date and animated-seal variants

The static link-preview image (src/app/opengraph-image.*, baked by
`pnpm og` from the /lab/og variant lab) shipped first. Two richer
variants were designed and deliberately deferred:

**Dynamic today's date** (an `opengraph-image.tsx` ImageResponse route
rendering the date live). Deferred because the honest version is hard:
- Scrapers cache unfurls per-URL for days — a "live" date goes stale
  the moment it's cached; only a date-stamped URL (`?d=YYYY-MM-DD`) on
  per-day share links escapes that, which is a different feature than
  the site-wide default image.
- The server doesn't know the sender's timezone; the app computes day
  keys in device-local time. Evening shares in the Americas would show
  tomorrow's date.
- satori can't run the canvas seal renderer — the seal must be a
  pre-baked transparent PNG composited under live text, and Fraunces
  needs a checked-in TTF subset (none exists; the app loads fonts via
  next/font/google). Small-caps weekday must be faked (satori's
  font-feature support is unreliable).
If pursued: bake the seal + font assets via the existing `pnpm og`
pipeline, and scope it to per-day share URLs, not the root.

**Animated seal press** (`opengraph-image.gif`). Next's file convention
accepts GIF; Discord animates GIF og:images and Slack usually does;
iMessage / X / Facebook / WhatsApp show a static frame, so the FIRST
frame must be the settled seal (never an empty desk). Risks: GIF's
256-color palette bands on the wax gradients; size balloons (keep
≤~1.5 MB; Facebook hard cap 8 MB). Capture: drive the /lab/og stage's
WaxStamp press frame-by-frame with Playwright, assemble with sharp/
gifsicle. Re-verify per-platform behavior against live unfurls at ship
time — the platform matrix above is from research, not measurement.

## 14. The short privacy page — GATED on the legacy books re-encrypting

The privacy push (2026-07-23) made the architecture true: sign-in
implies end-to-end encryption (wire format 3, AAD-bound), the server
refuses plaintext pushes, the plaintext window is gone (proven by
tests/e2e/forced_e2e.py), and /verify exists. The final step — the
short, unqualified page modeled on "We cannot read your entries. Not
won't, can't." with a 4-row data-flow table (Your words / Sync / Your
voice / Drive backup) and the "Don't take our word for it → /verify"
close — is written into the plan but MUST NOT ship until:
1. the pre-push users have opened the app and set a passphrase
   (their old format-1 rows re-encrypt in place automatically), and
2. `select payload_format, count(*) from snippets group by 1` on prod
   Neon shows no format-1 rows, and the database-backup retention
   window (~24 h on the free tier — confirm) has passed since.
Until then their old rows are still readable server-side and the
unqualified headline would overclaim. (2026-08-18: the client half is
now complete — the format-3 re-seal rule rides every server-row
adoption path, not just the pull applier's clean branch; see
SECURITY-STATE's change log. Criterion 2's SQL query stays the gate.) The interim page (shipped) is
already two-state and honest. When this lands: privacy likely drops
PolicySection (terms keeps it), the contents nav shrinks, and the
deep-dive/honest-limits/Drive/voice/leaving content survives below the
fold in compact form. Bump LAST_UPDATED; run pnpm check:copy.

## 15. Ciphertext self-viewer — "see what our server sees"

The one verify-tier item no journal app ships (prior art: Notesnook's
Vericrypt). A Settings row (or /verify section) for signed-in writers:
fetch one of YOUR rows as the server holds it and show it — the
v/iv/ct envelope beside the local plaintext — with a one-line "this is
everything we have of this entry." The crypto and wire types already
exist (crypto.ts, sync-wire.ts); the honest scope note from the MEGA
lesson: claim "stored ciphertext", never "immune to a malicious
server" (that's /verify test 3's honesty paragraph). Design: quiet,
data-voice, no theatrics; the entry picker can be "your latest entry".

## 16. On-device transcription — "your voice never leaves this phone"

Deferred by decision (2026-07-23): quarter-scale work, shippable only
as an opt-in. Research digest: WebGPU ships by default in iOS 26
Safari; Whisper-small/turbo runs in-browser via transformers.js (~150–
400 MB one-time model download, chunked ~1–2 s behind speech, not live
streaming); nothing yet does streaming + multilingual + code-switching
+ small-enough-for-an-iPhone-web-process; and this app already lives
near the iOS jetsam cliff (FLAT-BOOK LAW), so the model must live in a
worker and needs a real on-device memory A/B before it goes anywhere
near the book. Triggers that flip this to "build now": (a) Moonshine
v2 multilingual variants land (publicly planned — streaming, ~50–100
MB); (b) a <500M distilled streaming multilingual open model in ONNX
(watch the Voxtral lineage, Apache-2.0); (c) WebKit wires the Web
Speech API to iOS 26's on-device SpeechAnalyzer (would make the FREE
built-in path on-device — watch WebKit release notes); (d) iOS 26
saturates the user base. Until then the Soniox/Speechmatics chain
(no-storage defaults) carries the claim "we never store your voice."

## 17. Open-source the client

Owner is "not in principle opposed"; implications written up in
OPEN-SOURCE.md (license choice, history secret-scan at publish time,
what it does and doesn't obligate, and that an OSI license + public
repo unlocks eligibility for a free OTF Red Team Lab security audit —
the only realistic third-party-audit path at indie budget). When the
owner says go: run gitleaks/trufflehog over full history first; if
anything surfaces, publish a fresh-history mirror and rotate the
secret regardless; add LICENSE + a short outsider README. Publishing
upgrades every /verify claim from "we say" to "you can read."

## 18. CSP: drop `unsafe-inline` from script-src via a nonce

> Main motivation retired 2026-07-24: `/verify` Test 3 no longer links to
> securityheaders.com (`98c1487`). It now centers the direct read of the
> `connect-src` header (curl it yourself) instead of a third-party grade,
> so a trust-checking visitor is no longer routed to a page that flags
> `unsafe-inline`. The A+ badge is now wanted only for an external reason
> (a partner, a store listing), not the app's own verify flow. Revisit
> only if such a reason appears; otherwise keeping static rendering wins.

securityheaders.com flags `'unsafe-inline'` in `script-src` (yellow;
overall grade A). It's genuinely required today: the only inline scripts
in the served HTML are Next's per-build RSC bootstrap (`self.__next_f.push`),
which are unhashable, and Next's SRI is webpack-only (broken on
Turbopack, our bundler). The ONLY clean removal is a per-request nonce.

Investigated approach (2026-07-23) if the owner wants the hardening:
- Generate a nonce in `src/proxy.ts` (Next 16's middleware); set it on
  BOTH the request and response `Content-Security-Policy` header so Next's
  renderer stamps its own scripts; broaden the matcher to page routes
  (exclude `/api`, `/_next/static`, `/_next/image`, prefetches); fold in
  the existing prod-only `/lab` 404 + debug-param logic already there.
- `src/lib/security-headers.ts`: add `buildCsp(nonce)`; move CSP to the
  proxy, keep the 4 static headers (nosniff/referrer/permissions/dns) in
  `next.config.ts` to avoid a duplicate CSP header. `script-src 'self'
  'nonce-…' blob:` (drop `'unsafe-inline'`; keep `'self'`/`blob:`). Keep
  `'unsafe-inline'` on `style-src` (nonces don't cover inline `style=`;
  lower risk; the scanner grades only script-src).
- `src/app/layout.tsx`: make it async, `const nonce = (await headers())
  .get('x-nonce')`, pass `nonce` to both inline `<script>` tags
  (APP_HEIGHT_SCRIPT, FIRST_RUN_SCRIPT — they carry it fine).
- `src/components/providers.tsx`: pass `nonce` to `<ThemeProvider>`
  (next-themes 0.4.6 supports a `nonce` prop).
- `security-invariants.test.ts`: assert `script-src` has no
  `'unsafe-inline'` and contains `'nonce-'` (shape, not value — it's
  per-request); re-run the zero-violation sweep against a live server.
- Update `/verify` Test 3 to drop the "the header allows inline scripts"
  caveat.

THE COST (why it's deferred, not done): reading the nonce forces every
page to render DYNAMICALLY — Next can't statically prerender a page that
reads per-request headers. That loses Vercel's static-HTML edge caching
(higher first-load TTFB, more serverless invocations). For this
local-first PWA the practical impact is small (it runs client-side and
the service worker caches the document + its matching CSP header
together, so offline stays consistent), but it's a real architectural
trade for a scanner green. Owner's call; default is to keep
`'unsafe-inline'` — every other CSP directive is already tight, and it
only bites alongside an injection sink.

## 19. The transient downward selection-handle drag — OPEN, unexplained

> "There's a bug where i am trying to drag the selection handle downward
> and the app doesn't let me… I've also had similar webapp text box
> issues on other websites. Native text boxes have no such issues."

Screen recording, 2026-07-24, rewriting an entry: with a selection
standing, the bottom handle would not follow the finger DOWN for four
solid seconds, then suddenly worked and kept working. Frame analysis of
the recording is the one hard measurement we have: the highlight's
deepest pixel row never moved for those four seconds while its WIDTH
oscillated several times, then it jumped a whole paragraph at once. So
the gesture was live and tracking sideways throughout — only its
vertical component was being eaten.

**Then it stopped reproducing** (owner, same week: "it's working in both
places, seems like a very transient issue"). Do not open this by writing
a fix; open it by catching it in the act.

RULED OUT — don't re-walk these:
- *The DOM and hit testing.* On real WebCore a synthetic drag extends the
  selection downward through the app's own editor, with elementFromPoint
  finding the textarea, selectable, at every step
  (`scripts/measure-webkit-drag-select.py`).
- *The press bloom.* It holds the card at scale(1.0195) for the whole
  edit, but tracking the card's width frame by frame across the recording
  shows it constant at 999px through the failure AND the recovery — it
  never changed when the behaviour did.
- *Any single CSS property, and the editor's whole shape.* `/lab/handle-drag`
  round one added one app property at a time to a bare field (pan-y, the
  bloom's scale, the touch-action relief); round two started from the
  editor's full shape and behaviour — capped self-scrolling field, the
  1.2s `useContainedField` re-fit, nested scrollers, pan-y, the bloom,
  overscroll-contain — and removed one thing per pane. Every pane of both
  rounds let the handle through.

NEVER TESTED, and the obvious next move: **round two ran in a Safari tab,
never in the installed app.** The recording was made in the standalone
PWA, where iOS handles the keyboard, viewport and gestures differently.
When it recurs, run `/lab/handle-drag` from the home-screen icon first.

The other untested axis is COST rather than shape: the real book is a
document with hundreds of live cards, and `body:has(textarea:focus,
input:focus) *:not(textarea):not(input)` (a few lines above the
touch-action relief in `globals.css`) makes every style recalc while
writing evaluate a universal selector across all of them. iOS abandons a
handle drag when the main thread stalls, and WebKit selector scans over
the book are a pathology this repo has measured before
(`scripts/measure-webkit-spans.py`). A lab page of five elements can
never reproduce that; a weighted one, or an in-app A/B, could.

Note `[data-layer]:has(textarea:focus, input:focus) { touch-action: auto }`
shipped during this hunt and STAYS, but on its own older justification
(the field-level `touch-action: auto` beside it was a no-op against the
layers' pan-y) — not as a fix for this. It is not evidence either way.

A LEAD, from a different bug that WAS solved (2026-07-31, the caret that
drifted out of its card — see `scripts/measure-composer-room.py` and the
scroll contract in `use-keyboard-room.ts`): when the app holds the book
unscrollable, iOS spends the drag somewhere else — panning its visual
viewport — and text interaction desynchronises from what is painted.
That is the same family of symptom as a handle drag whose vertical
component goes nowhere, and a standing selection is the one case that
still holds the book unscrollable (`selLocked`, overflow:hidden for as
long as the selection stands — which is exactly the state the recording
was made in). Worth an A/B the next time it reproduces: does the drag
work if the selection hold is lifted?


## 20. Sync server hygiene: batch the push, type the payload column

From the 2026-08 audit (S03). The push route runs 2N+2 sequential
statements inside the per-user advisory lock — one select plus one
write per change, 402 round trips at the 200-row batch that first sync
always sends. The lock already guarantees a stable read set, so the
shape is snapshot → decide → apply: one `inArray` select into a Map,
the existing `incomingWins` loop, one multi-row upsert whose rows each
carry `nextval('snippets_seq')`. The merge verdict stays in JS and
stays `src/lib/merge.ts` verbatim — never express LWW in SQL. Fold
duplicate ids by id first (untrusted boundary; a multi-row upsert
rejects them) and keep results in request order. Drop `maxSeq` from
the push response while there: nothing reads it, and it costs an
aggregate inside the lock per push (`PushResponse` in sync-wire.ts
moves with it). Also say the row shape once: `$type` the `payload`
column (both routes cast it today, to the one type the server refuses),
share one `toWireRow`, and add
`CHECK (payload IS NOT NULL OR deleted_at IS NOT NULL)` — a payload-less
live row currently reads as a tombstone on every device via
`ghostTombstone`, so the constraint makes the dangerous combination
unrepresentable. `ADD CONSTRAINT … NOT VALID` then `VALIDATE` on live
data. Note: `push/route.test.ts` stubs the transaction to a no-op, so
the rewrite must bring its own test with a fake `tx` recording
statements.

## 21. Sync status: a gate and a phase, not three fields

From the audit (S02/S04). `SyncStatus` is `phase` × `locked` ×
`needsSetup` — 20 combinations for ~7 real states, `locked &&
needsSetup` representable, and each consumer re-derives the precedence
(settings' seven-step chain, the calendar's letters). Split the axes:
`gate: "open" | "locked" | "needsSetup" | "signedOut"` and `phase:
"idle" | "syncing" | "offline" | "error"`. Assigning the gate IS the
clear, so the hand-clears at the signedOut/locked/needsSetup sites
disappear. Keep the member name `needsSetup` (SECURITY-STATE points at
it), start the gate `"open"` so no pause renders before the first cycle
decides, and reproduce `syncRow`'s copy precedence exactly (linted).
Sibling wart, same pass: `clearLocalKey` writes `enrolledCache = false`
— a device fact in an account slot; after a key mismatch on an
unreachable server the engine flaps into error/retry where a truthful
cache would rest at locked. Drop that line and the unused
`e2eEnrolledCached` export, and add the two `e2e.test.ts` cases (a
cleared key must not downgrade a known "enrolled").

## 22. Voice capture: a take with identity, one engine chain

From the audit (S05). `wantedRef` is the only "am I in a take" fact —
ten async continuations cancel on a boolean that cannot tell "the
writer stopped" from "the writer started another take". Exactly one
site does the sound check (`wsRef.current !== ws` in onclose); its
sibling onmessage does not, so an orphaned socket's finals land in the
live take's transcript and its close tears the live take down. A
superseded take also keeps its mic and socket until its own cap. Mint
a take record — id, phase, adapter, stream, sockets, timers — and make
every continuation open with `takeRef.current !== take`; per-adapter
session state (sonioxFinalBuf, smSentFrames…) moves onto it. Keep the
typed-failure law intact ("stopping" is `transcribe`, not `network`).
Separately: the probe builds the full engine chain then stores it as
two lossy pieces, so at tap time the fallback walks streaming providers
only and hard-fails with a healthy batch proxy configured ("probes
available, refuses to mint" is the normal quota case). Store one
ordered candidate list; walk it handing over the same MediaStream.
Policy line to keep: never promote the browser's own dictation (`web`)
after a mint failure — batch is first-party and closes the hole without
touching the CSP. Validate with tests/e2e/speech_adapters.py plus the
deferred-token orphan checks; the iOS non-continuous restart loop is
the riskiest edge and needs a device pass.

## 23. Settings: unions for the encryption view and the backup action

From the audit (S15). EncryptionSection holds two un-sequenced
tri-state probes; `hasKey === null` falls into the locked arm, so a
device holding the key can flash the unlock form, and opening Settings
offline blanks the section (`enrolled === null` → body null). Derive
one view — probing | unknown | notEnrolled | unlocked | locked — via
the `Promise.all` + alive-guard shape `/welcome` already uses, with the
rule that a failed probe never downgrades a known view. Keep
`enrollOpen`'s committed-flow latch (see the 2026-08-18 recovery_guard
regression) and the ?seal/?unlock no-strip comments. BackupSection:
one `BackupAction` union instead of `connecting`/`disconnecting`/
`error` (both buttons are on screen at once and don't gate each other),
and stop discarding `adoptDriveToken()`'s deliberate tri-state —
"none"/"transient" currently read as success. Also `deviceHasToken`
refreshes off remote-ledger deps, so a just-connected second device
keeps the "deliveries run from the device where Drive was connected"
hint all session; set it from the outcomes that change it. Same class,
different component: DangerZone's `onComplete={() => void
onComplete()}` discards the erase promise and `doErase` has no
try/catch — a rejection after the 10-second hold is invisible. Type the
callback `() => void | Promise<void>` and give doErase the catch
doDelete already has.

## 24. Backup ledger: one health derivation, an attempt-stamped cadence

From the audit (S07). The ledger's `state` is a fleet-wide last-writer
slot: `delivered` lacks the `ne(state,'disconnected')` guard `failed`
has, so a delivery in flight during a disconnect silently re-enables
backups everywhere. The two derivations
of "failing" disagree — device B's dead grant marks the ledger error
while device A's fresh delivery proves the Drive copy current, and
Settings prints "haven't gone through since today". Split owner intent
(`state`: active|disconnected, written only by connect/disconnect)
from the fleet delivery record (`lastBackedUpSeq` via `greatest()`,
failure as a timestamped observation outranked by a newer success), and
derive health once in backup-shared for Settings AND the cron — which
also makes the cron's one-email-per-silence rule unit-testable. Open
decision: `pending` has no clock; a `connectedAt` column would let a
never-delivered ledger expire into failing on the same threshold.
Delivery cadence: `drive:lastDeliveryAt` stamps success only, so a
failing device re-renders and re-uploads the whole book on every
settled cycle with no backoff (multi-MB stringify per capture on a deep
book) — stamp the attempt instead, and replace the per-tab `delivering`
boolean with a `navigator.locks` request so two tabs cannot upload
duplicate archives into the key-loss safety net. Do NOT gate delivery
on `behind`: copy.ts promises a deleted Drive file is set right by the
next delivery, and only the unconditional hourly re-upload keeps that
promise. (2026-10-21: `behind` now *bypasses* the hourly gap, so an
entry saved within the hour after a delivery goes out on the next sync
instead of waiting for the next session; the cron imports
`STALE_AFTER_DAYS`, and a quiet ledger reads "behind", not "failing".)

## 25. The keep-run record, and the one keep protocol

From the audit (S11/S12). The 2026-08-18 law-8 fix moved the carded
latch below the abort check, so a write that fails BEFORE the carding
beat now returns the composer with the words. A rejection landing
AFTER that beat still strands them — the full fix is one nullable
`runRef` record ({id, text, aborted, carded, settled}) minted per keep,
every continuation opening with `runRef.current !== run`. Identity is
the guard; `aborted ∧ carded` becomes unrepresentable, and a slow
quota rejection can no longer contaminate the NEXT keep (today it
clears the newer draft, restores the older words, and strands the newer
row in heldIds). Land it as a record, not another flag — because the
same write-at-submit / hold / abort / file-at-the-beat protocol and the
seal's pointer hit-test exist TWICE (backfill composer and today zone,
down to matching comments) and have diverged: the zone guards every
pointer handler and cancels its watchers on abort; the composer does
neither. SCHEDULE-MAP.md now records this axis; the extraction
(useKeepRun/useSealPress) should lift the record's shape, not two flag
sets. tests/e2e/backfill_keep.py's fault-injection leg is the gate; add
the late-rejection leg (reject at +5s, then a second successful keep —
both entries must be stored AND rendered).

## 26. Camera bookkeeping: release what was acquired, one day of truth

From the audit (S09). The zoom effect releases every resource from a
closure-local record — except the climb band, which finish() re-derives
with a predicate the acquire side must stay "EXACTLY symmetric" with
(the comment says so; it has already failed once, and the feed carries
a 1500ms timeout band-aid). The reduced-motion path breaks the symmetry
TODAY: it returns before the acquire, but finish() still computes
`climbed === true` and calls clearOnStage on a book that never climbed
— an unnecessary scrollTop write and a ~720-row observer re-prime per
climb. One `bandOnStage` local beside the seven records that already
exist; finish tests the record. (~5 lines.) Note: no harness sets
prefers-reduced-motion, so this path has never been measured — add a
reduced-motion leg first. Separately, "which day is the book on" is
four fields with three write latencies, and the deferred writer wins:
press Today mid-dive and finish() clobbers the newer jump
(`setSelected(pendingSelectRef.current)`), leaving the h1 and the
Today button on day X while the scroller and URL sit on today. Collapse
to `selected` + `liveDayRef` (that split is deliberate and stays);
delete `pendingSelectRef` (finish commits `liveDayRef.current`, so the
latest writer wins by construction) and `selectedRef` (one reader, and
it is the wrong mirror — openEntry pushes a stale ?d= URL). The
strictly-safe first step is a one-line supersede check at the finish
commit. Do NOT extend the zooming latch to appBack/closeSchedule —
their unguardedness is documented and load-bearing.

## 27. Today zone: a keyed keyboard baseline, listeners that remember

From the audit (S12); neither is in SCHEDULE-MAP's census. `baseVh` is
a monotonic running max standing for "viewport height with no
keyboard", never reset — rotate in the browser, split-view an iPad, or
shorten a desktop window and `baseVh - vv.height ≥ 60` forever: the
rest stance becomes unreachable, the dismiss-pill rescue goes dead
(`mustCycle` needs kb < 60), and a phantom reach spacer up to 640px
seeds under the zone. Key the baseline by `vv.width` (a soft keyboard
never changes visual-viewport WIDTH, so a width change proves the old
baseline is from a viewport that no longer exists) and refresh it
whenever the zone's own textarea is not focused. The existing __setKb
harness trick cannot reproduce this — it shrinks vv.height only; a
real viewport resize is required. And the six nullable listener refs:
teardown re-derives its target (`scrollerOf()` via a btnRef that never
clears), so unmount removes nothing and nulls the ref anyway — one
inert orphan scroll listener per zone unmount on the app's hottest
scroller, and "which of the 11 registrations are live" unanswerable.
One disposers array, each attach pushing its own exact removal closure
(the pan handler is on two targets — push two). Keep releaseTail's
internal order (the spacer clear moves scrollHeight) and its
idempotence; the subscriptions stay synchronous inside onFocus.

## 28. The write fan-out: one keep re-renders one day, not the book

From the audit (S10). `dayGroups` rebuilds every day's array identity
on any snippets write, so a keep, an edit, or a background sync pull
re-renders every BookRow — the comments claim per-day stability and the
code delivers it only across probe changes. Reuse a day's previous
array when its (id, updatedAt) sequence is unchanged (~12 lines;
updatedAt is trustworthy because db.ts is the single write choke
point; tolerate StrictMode double-invocation). Then give the kept-draft
store a per-day subscription — context bypasses memo, so today a single
keep re-renders ~all ScheduleCards four times inside the seal
choreography (hold → set → release → clear). The ProbeStore +
useSyncExternalStore pattern in the same file is the model; preserve
the deliberate two-paint hand-off (release the hold, then clear the
draft) and morphDays visibility for the affected day. Context: the
audit's companion claim — that the per-row ref cycle strands data-warm
marks — did NOT reproduce (tests/e2e/warm_window.py stands guard), so
this item is efficiency with an honest measurement bar:
a render counter proving one seeded keep is O(1) rows, and
measure-lift-fire/-first-motion for the choreography.

## 29. The entry rewrite: one owner for the commit

From the audit (S13). `stopEdit` is fire-and-forget with five call
sites; Escape runs it twice by bubbling (textarea then content div, no
stopPropagation) and its own blur() re-enters it — one confirm, two or
three identical db.transaction writes, each bumping the LWW clock and
re-dirtying the row for sync. Collapse `editing` + `draft` to a mode
value, read the text from the field at commit (it is already seeded
imperatively), and make one `commit()` idempotent within a dispatch via
a ref guard. The sharp edges to preserve verbatim: startEdit's
synchronous focus() + setSelectionRange inside the tap (what raises the
iOS keyboard), the rAF-deferred autosize, and both inline-height sheds
— and leave the `compact` measurement machinery alone (every branch
cites a recorded bug). A failed updateSnippet still silently drops the
rewrite (law 8 again); making "written but not committed" representable
is the door to fixing that, but the visible behavior is an owner call.
New check: exactly one updateSnippet per confirm across all four exit
paths, zero when unchanged.

## 30. Accounts: "unavailable" is a state, and the welcome phase is a value

From the audit (S08). A deployment with DATABASE_URL but no
BETTER_AUTH_SECRET answers 401 "signed out" from ten `!serverDb`-guarded
routes while /api/auth correctly 503s — three spellings of "is this
install configured". Server side, one answer: `{state:"unconfigured"} |
{state:"signed-out"} | {state:"in", userId, db, auth}` so a route
cannot narrow serverDb without deciding auth. Client side, add
`"unavailable"` to SessionStatus, derived from the session fetch's
error (no new request), so /signin can say "not switched on" before the
first keystroke instead of after submit (the copy already exists).
"unavailable" only ever quiets an offer — never blocks capture; fail
closed to "signed-out" when undeterminable. And the welcome page: the
render gate is `if (!show || !user) return null`, where `user` is null
both while loading and on any session blip — a refetch hiccup while the
once-only recovery code is on screen unmounts EnrollFlow and loses the
code (the flow's state is its only home; /api/keys never re-issues).
Phase value — deciding | enroll | saved, email captured at flow start —
so "saved" has no branch that can unmount. The step-aside's
"enrolled !== false || key" outage reading survives verbatim. New
harness step: reach the code screen, make get-session return 401,
assert the code is still on screen. That fails today.

## 31. Speech token routes: one mint policy, a policed grant

From the audit (S06). Four token routes retype the same fail-closed
guard, the same 401/403→503-else-502 mapping (comment included), and
the same availability handler; the grant contract they share is typed
only client-side, which is how `scheme` is emitted by three routes,
read by no adapter, and has a member nobody sends. One server-only
factory (`src/server/speech-token.ts`, the api/auth `export const {GET,
POST} =` shape) over an honestly vendor-specific descriptor — apiKey as
a lazy closure over a STATIC process.env member (Next inlining), the
descriptor owning the whole fetch (scribe has no body and a non-Bearer
header; speechmatics rides ?type=rt), vendor origins staying literal in
the route files so the egress registry keeps its file attribution. GET
and POST then read the same apiKey(), so a route can no longer
advertise availability it cannot mint. New check that exists nowhere: a
route.test.ts table across all four descriptors — no key → 503,
upstream 401 → 503, upstream 500 → 502, malformed body → 502, success →
exactly the SpeechGrant keys.
