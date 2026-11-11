@AGENTS.md

# Snippets — working in this repo

A local-first PWA commonplace book ("Homework for Life"): frictionless
voice/typed capture, calendar review.
**Before touching any UI, styling, copy, or animation, use the
`snippets-craft` skill** (`.claude/skills/snippets-craft/`) — it is the
design constitution. `DESIGN.md` has the full rationale and tokens.
`BACKLOG.md` holds owner-accepted future work with design notes —
check it before proposing scope; items there are decided.
**`SECURITY-STATE.md` is the single source of truth for what the app
actually does with user data** — read it before editing any privacy /
terms / Settings / `/verify` copy (the copy must match its architecture,
not memory), and update it *in the same commit* whenever a privacy- or
security-relevant behavior changes (its Change log is how we avoid
describing outdated architecture as current).

## Commands

```sh
pnpm dev          # dev server (Turbopack)
pnpm build        # production build + typecheck (the de facto test gate)
pnpm start        # serve the build
pnpm lint         # eslint
pnpm lint:slop    # oxlint + the vendored anti-slop rules (advisory)
pnpm test         # vitest — merge/e2e/backup units + the copy-clarity linter
pnpm check:copy   # just the STE-informed copy linter (copy-clarity.test.ts)
pnpm icons        # regenerate app icons from scripts/bake-icons.mjs
```

**Technical-register copy is linted.** Copy that explains a mechanism
(privacy, terms, the sync/backup/encryption Settings lines — never the
literary prompts) is held to an STE-informed bar (after ASD-STE100): short
one-idea sentences, active voice, one word per meaning (*encrypt*, never
*seal*), no internal jargon (*payload*/*tombstone*/*cursor*/*LWW*),
concrete figures. `src/lib/copy-clarity.test.ts` mechanises the
low-false-positive rules over an allowlist (`TECH_COPY_PATHS` + `PAGES`)
and rides `pnpm test` — banned/inconsistent terms and vague cadence fail
the build; over-long sentences print as advisory. Add a new technical
surface to the allowlist when you write one. Full standard: `DESIGN.md` →
Copy voice; the rule lives in the `snippets-craft` skill (law 7).

**Type evidence is linted, advisorily.** `pnpm lint:slop` runs oxlint
over the vendored anti-slop rules (`tools/oxlint/anti-slop`, MIT — ours
to edit, same vendoring rule as `src/vendor/paper-shaders`). They reject
low-evidence TypeScript: `unknown` parameters, chained `as` casts,
`object` as a type, runtime `typeof` where a boundary parse belongs, an
assertion with no `SAFETY:` comment. It is NOT the build gate — `pnpm
lint` (eslint) and `pnpm build` are. Five rules the codebase already
satisfies are set to `error` (0 errors as of 2026-11-11); the other ten
are `warn`. `oxlint.config.ts` records each rule's count at the 2026-08
install (263 in all); a 2026-11-11 run counts 271 warnings, mostly
missing `SAFETY:` comments and boundary `typeof`s. Don't bulk-"fix"
them — the honest move is to clear a rule's backlog while working in
that area, then promote that rule to `error`. Never silence a finding
with a cast or a weakened severity to make the report quiet.

**Agent failure modes are guarded, not just described.** When a review
catches the same agent mistake twice, or a "do NOT" here would otherwise
rely on the next agent noticing it, encode it as a build-failing check
instead of more prose (principle "encode lessons in structure").
`src/lib/agent-footguns.test.ts` is the append-only registry for agent
slop and this repo's non-security "deleted things stay deleted"
invariants; `security-invariants.test.ts` holds the encryption ones. Both
ride `pnpm test`, so a violation fails the build. The one rule for
writing a guard is that it must be targeted, never a blanket lexical ban:
this repo's invariants are semantic, so the same construct is right in
one file and wrong in another, and a guard that flags correct code trains
the next agent to disable it. The `harden` skill
(`.claude/skills/harden/`) runs the loop that proposes new guards from
observed corrections; invoke it with `/harden`.

**Claude's own prose follows the Google developers style guide.** All
replies, visible thinking, commit messages, PR and review text, repo
docs, and code comments follow the `google-style` skill
(`.claude/skills/google-style/`), the house distillation of
developers.google.com/style. A SessionStart hook in
`.claude/settings.json` injects it into every session; if it is missing
from context, load it before writing prose. Scope note: app UI copy is
exempt. The product's words stay governed by `snippets-craft`,
`DESIGN.md`, and the copy linter described in this section, and those
win wherever the two standards disagree.

**Replies lead with the action and number their steps.** Interactive output (chat
replies, visible thinking, questions to the owner, PR threads) also
follows the vendored `action-first-replies` skill
(`.claude/skills/action-first-replies/`, MIT, from a skill by Ayoub Ghriss (github.com/ayghri)):
lead with the next action, number multi-step work, restate state each
turn, concrete time estimates, no preamble or closers. The same
SessionStart hook injects it. It composes with `google-style`
(`google-style` governs the sentences; `action-first-replies` governs the
reply's shape); repo docs and commit messages stay `google-style`-only.
Saying "stop action-first mode" pauses it for a session.

**Every work turn closes with the owner's report.** The reply that
closes a turn of work answers five standing questions before they are
asked: what changed and whether it is merged to the production branch,
how each change was measured (tests or a harness, never inference),
the trade-offs, a side-by-side view (screenshots or a before/after
table), and numbered manual-test steps when the owner's device is
needed. The `turn-report` skill (`.claude/skills/turn-report/`) is the
template; the same SessionStart hook injects it. Keep the report under
about 150 words plus attachments; detail belongs in commits and files.

**pstack is vendored; `/poteto-mode` is its entry point.** Open Pstack
1.2.0 (`.claude/vendor/pstack/VENDORING.md` records the source commit and
what was left out) adds 52 skills and 12 agent definitions under
`.claude/`. Run `/poteto-mode` before a nontrivial code change and it
routes the work to a playbook, the `principle-*` leaves, and the review
skills. No session-start hook forces it — it runs when you ask for it.
The multi-model panels in `arena`, `architect`, `interrogate`, and `how`
need `/setup-pstack` plus the Codex and Grok command-line tools and Bun;
without those, the skills run on the session's own model.

Three overlaps to know about:

- **Prose.** pstack's `unslop` says it "must always apply", and
  `poteto-mode` bans the em dash outright. This repo's standards win:
  `google-style` governs sentences, `action-first-replies` governs reply shape,
  `turn-report` governs the closing reply, and `snippets-craft` plus the
  copy linter govern app copy. Read `unslop` and `technical-writing` for
  what they catch that `google-style` doesn't, not as a replacement.
- **`babysit`.** The harness reads `.claude/skills/babysit/SKILL.md` as
  this repo's PR guidance, so pstack's babysit skill now fills that slot.
  That is intended. `poteto-mode` routes PR-status work to its own
  Babysit playbook (`.claude/skills/poteto-mode/playbooks/babysit.md`)
  rather than the skill.
- **Verification.** pstack's `run` and `verify` built-ins are not in
  this repo. Use `webapp-testing` and the harnesses described in "Prove
  the fix" instead; `principle-prove-it-works` says the same thing this
  file's "Prove the fix" section says.

The vendored Bun scripts under `.claude/skills/poteto-mode/scripts/`
reach none of the gates: TypeScript skips dot-directories (verified by
running `tsc --listFiles` with and without an explicit exclude; both saw
zero files under `.claude/`), vitest is scoped to `src/**`, and both
`eslint.config.mjs` and `oxlint.config.ts` ignore `.claude/**`. ESLint's
flat config lints dot-directories by default, so that ignore entry is
load-bearing: without it `pnpm lint` fails on a vendored test.


## Architecture

- **Next.js 16 (App Router, Turbopack) + Tailwind v4** (tokens via
  `@theme inline` in `src/app/globals.css` — the design system's source
  of truth). React 19.
- **Data:** Dexie/IndexedDB, schema + all queries in `src/lib/db.ts`;
  types in `src/lib/types.ts`. Local-first; day keys (`YYYY-MM-DD`) are
  computed in *local* time (`src/lib/dates.ts`). Soft delete
  (`deletedAt`) with 30-day purge; `favorite` is `0|1` because IndexedDB
  can't index booleans. Live UI via `dexie-react-hooks` in
  `src/hooks/use-snippets.ts`.
- **Speech:** `src/hooks/use-speech.ts` is one hook, wired to the today
  zone's wax seal in `src/app/calendar/page.tsx`. **Streaming providers**
  are pluggable `StreamAdapter`s (shared mic/worklet/downsample/settle
  code; each adapter supplies only socket/send/parse/finalize/doneOnClose),
  and `src/lib/speech-providers.ts` is the one table of provider truth
  (labels, privacy links, WS origins for the CSP, retention lines the
  privacy page prints — keep it in step when providers change). Four ship,
  ordered privacy-first by `NEXT_PUBLIC_SPEECH_PROVIDERS` (default
  `soniox,speechmatics,deepgram`) — first AVAILABLE wins (a name without
  its API key stands aside), the rest are automatic backups: **soniox** —
  realtime multilingual with mid-sentence code-switching, memory-only /
  no-training at self-serve (`SONIOX_API_KEY`, `SONIOX_MODEL` default
  `stt-rt-v5`; temp key minted at `/api/soniox-token` rides the socket's
  first JSON config frame, then raw binary PCM; empty frame finalizes);
  **speechmatics** — realtime, stores nothing by architecture, EU endpoint
  (`SPEECHMATICS_API_KEY`, one language per session via
  `SPEECHMATICS_LANGUAGE` — no code-switching mode; JWT from
  `/api/speechmatics-token` rides the `?jwt=` query; StartRecognition →
  binary AddAudio frames → EndOfStream with the sent-frame count);
  **deepgram** — Nova-3 (`DEEPGRAM_API_KEY`; short-lived JWT from
  `/api/deepgram-token` on a `["bearer", jwt]` subprotocol; every request
  sends `mip_opt_out=true` — the privacy page depends on it); and
  **scribe** — ElevenLabs Scribe v2 Realtime, OUT of the default chain
  (zero-retention is enterprise-only there) but wired for explicit env
  use. The token is pre-minted (warm grant) so the tap opens the socket
  instantly. Partial/final transcripts land in the hook's
  `interim`/`segments`. Fallback: **batch** — a Whisper-dialect
  proxy at `src/app/api/transcribe/route.ts` (`TRANSCRIBE_API_KEY`,
  optional `TRANSCRIBE_BASE_URL`/`TRANSCRIBE_MODEL`; `AQUA_*` honored
  as aliases; default Aqua's Avalon — swap recipes in README.md) —
  MediaRecorder → upload on stop → text settles ~450ms later.
  Fallback: Web Speech API streaming live words (tap-to-toggle,
  auto-restarts dropped mobile sessions, iOS runs non-continuous,
  circuit breaker against dead services; NOTE it is the browser's own
  dictation — audio goes to Google/Apple, invisible to our CSP and
  network tab, and the privacy page says so). Engines chosen by probing
  each provider's token route + `GET /api/transcribe`. Every failure
  surfaces a typed reason (`SpeechFailure`) turned into specific copy
  from `copy.capture.voiceFailures`.
- **Enrichment (removed 2026-07):** automatic filing — Claude-generated
  title/kind/tags — has been fully retired. There is no `/api/enrich`
  route, no `enrich.ts`, and no `enriched` field; the `kind`/`tags`
  fields survive on the model (unused, kept for possible future
  tagging). Entries are their words alone.
- **UI primitives:** `src/components/ui/*` are vendored shadcn sources
  (the registry domain is blocked in some sandboxes; they're ours now
  and intentionally restyled — overlay tint, input focus, etc.). Edit
  them directly; don't re-fetch over local changes.
- **The book renders every entry (not windowed) → cards must stay FLAT.**
  `src/app/calendar/page.tsx`'s schedule feed mounts a live card for the
  reader's whole history, so any PER-CARD paint effect (`mix-blend`,
  `isolation: isolate`, a blurred `box-shadow`) is paid hundreds of times
  and scales with the book — which jetsam-kills iOS on a years-deep book
  ("A problem repeatedly occurred"; scroll-momentum stalls are the milder
  form of the same memory pressure). Book cards therefore carry only
  O(1)-in-book-size paint (flat fill, hairline, non-blurred top highlight).
  Do NOT add per-card blend/isolation/blurred-shadow, and do NOT "restore"
  the seat-shadow lift — it was tried and crashes. The full "FLAT-BOOK LAW"
  lives on `.book-card` in `globals.css`. (A render window — cv:hidden at
  rest + a warm band — already limits how much of the book LAYS OUT; the
  law is about per-card PAINT cost and stands regardless.)
- **Shaders:** `src/vendor/paper-shaders/` is the vendored PaperTexture
  chain from paper-design/shaders (Apache-2.0, LICENSE alongside) — no
  npm dependency, same rule as the shadcn sources. Used only by the
  `/lab/texture` bake route; the app ships baked bitmaps from
  `public/textures`. The wax-wash lab's aurora/neuro candidates sit on
  a small hand-rolled WebGL mount in
  `src/app/(dev)/lab/wax-wash/shader-box.tsx`.
- **Accounts + sync (optional):** Better Auth (Google + email OTP via
  Resend) on Neon Postgres/Drizzle — schema in `src/server/db/schema.ts`,
  SQL migrations in `drizzle/` (`pnpm db:generate` / `db:migrate`).
  Absent `DATABASE_URL`/`BETTER_AUTH_SECRET`, auth routes 503 and the
  app stays device-only. Sync is a custom pull/push protocol
  (`src/app/api/sync/*`, client engine `src/lib/sync.ts`): per-row LWW
  with ONE rule shared client/server (`src/lib/merge.ts` — unit-tested,
  `pnpm test`; newer `updatedAt` wins, ties are no-ops; the server's
  verdict is final). Dexie v2 adds an indexed `_dirty` flag; every write in
  `db.ts` stamps it (db.ts stays the single write choke point — never
  write around it); v3 adds a `meta` table (book key, Drive tokens).
  Tombstones live forever server-side; client purge only drops
  server-acknowledged ones. Erase-all on a synced book soft-deletes
  (propagates) — never `clear()`.
- **End-to-end encryption (REQUIRED at sign-in, 2026-07):** there is no
  plaintext sync. `payloadFormat: 3` seals entry payloads with AES-GCM
  under a per-user book key, with the row's cleartext fields
  (`id`/`updatedAt`/`deletedAt`/`payloadFormat`) bound in as AAD
  (`aadForRow` in `src/lib/crypto.ts` — the canonical pipe string is
  pinned by a test; changing it orphans every sealed book) so a moved /
  rolled-back / resurrected / format-downgraded envelope fails to open.
  Formats 1|2 remain READABLE on pull (legacy rows re-seal to 3 via the
  one-time per-device sweep + the pull re-dirty rule in `sync.ts`);
  nothing can WRITE them — `pushAll`/`pullAll`/`toWireChange` take the
  key as a required argument, and the push route accepts 2|3 only
  (format 1 → 409 `encryption_required`, sealed payloads must be shaped
  `{v:1,iv,ct}`). `disableEncryption` was deleted deliberately — do not
  reintroduce any path that re-pushes plaintext. The key is wrapped
  under the passphrase AND a recovery code; only the wrapped envelopes
  rest server-side (`/api/keys` — PUT once, never replaceable or
  deletable over the API, that's deliberate; account deletion cascades
  them away). On-device the key is a NON-extractable CryptoKey in the
  meta table. Signed in + never enrolled = the `needsSetup` sync state
  (mirror of `locked`): NO push, NO pull, counts only — enrollment is
  the `/welcome` step (shared `EnrollFlow` component, also mounted by
  Settings; the calendar's needs-setup letter carries stragglers to
  `?seal=1`). Enrolled + no key = `locked`: same pause; unlock in
  Settings. Both pause sync loudly, never capture. A key that no longer
  opens pulled rows throws `KeyMismatchError`: the device forgets the
  stale key and re-enters `locked` — never an endless retry. On outages
  the enrollment probe may reuse a cached "enrolled", never a cached
  "not enrolled" (unit-tested in `e2e.test.ts`). Decrypt/encrypt
  OUTSIDE Dexie transactions (foreign awaits kill them). The whole
  no-plaintext-window guarantee is OBSERVED, not assumed:
  `tests/e2e/forced_e2e.py` (see also `tests/e2e/speech_adapters.py`
  for the voice wire) — run it via `with_server.py` after touching
  sync/e2e/crypto.
- **Drive backup (device-delivered):** the writer's device renders
  (keep `src/lib/render-book.ts` the single renderer — the JSON stays
  bit-compatible with Restore from JSON) and uploads to the visible
  Drive folder itself (`src/lib/backup-client.ts` + `drive-client.ts`),
  after each settled sync. The server keeps NO Drive tokens: each
  device adopts its own refresh token once (`/api/backup/adopt` —
  the server then forgets it) and exchanges it statelessly
  (`/api/backup/refresh`). Grants are PER DEVICE and additive — any
  signed-in device can mint its own via the same consent (Settings →
  "Back up from this device too"); every device holding one delivers,
  and Drive writes converge by name, no duplicates. The device
  reports deliveries
  (`/api/backup/delivered`) AND failures (`/api/backup/failed` →
  ledger state `error`, one line carrying Google's own error code);
  Settings derives its line via `backupHealth()` (`backup-shared.ts`,
  unit-tested) — "failing" is a reported error, named by
  `classifyBackupError` with its own fix and action (never a blanket
  "Reconnect": it can't fix a full Drive); "behind" is a ledger quiet
  past 3 days while the book moved (`behind` flag from
  `/api/sync/status`), the vanished-device case no report can reach.
  New entries bypass the hourly delivery gap and rewrite only the year
  files that changed, newest first (`yearsToUpload`), so a delivery iOS
  cuts short has already landed the new entry; the hourly delivery
  still rewrites every file. The delivered seq is read BEFORE the book
  snapshot, and an "outrun" delivery (newer rows pulled mid-upload)
  queues a sync of its own. The Settings line re-reads the ledger after
  each delivery.
  `tests/e2e/backup_failures.py` observes every cause end to end. The
  daily cron (`CRON_SECRET`, vercel.json) is a watchdog only — stale
  ledger + moving book → one email per silence, naming the same cause
  and fix (`backupEmail`) — plus the tombstone
  scrubber, plus an ops storage watchdog (`pg_database_size` vs the
  Neon free-tier 0.5 GB cap → emails `OPS_ALERT_EMAIL` past ~70%, so
  the owner upgrades before writes are refused; capture stays
  local-first regardless). Google OAuth
  app must be *published to Production* or refresh tokens die in
  7 days. Plaintext Drive files are the key-loss safety net; never
  encrypt them.
- **PWA:** `src/app/manifest.ts`, hand-rolled `public/sw.js`
  (registered in `src/components/providers.tsx`, production only).
  Bump `VERSION` in `sw.js` when changing caching behavior.

## Prove the fix (do this for every nontrivial change)

A change that "should" fix the bug hasn't fixed anything until you've
*observed* it fixed. Don't ship on theory or on a proxy measurement —
observe the actual behavior. (This repo learned it the hard way: a crash
was "fixed" several times by reasoning about compositor cost, each raising
the ceiling without removing it; only an on-device A/B settled it. See the
FLAT-BOOK LAW in `globals.css`.)

- **First priority — a real harness you build yourself.** Reproduce the
  old bug, apply the change, and measure the *actual* app behavior
  proving it's gone: real screenshots, DOM/state readouts, computed
  styles, event traces (`webapp-testing` skill; see the section below).
  Not "the number should be lower" — the observed thing that broke must
  now demonstrably work. Iterate against the harness until it's solved,
  and **write down the dead ends** (in the commit/BACKLOG/code comments)
  so the next person doesn't re-walk them.
- **Second priority — only when you truly cannot observe it yourself**
  (e.g. iOS-Safari-specific memory/compositor behavior a headless
  Chromium can't reproduce): hand the owner a testable build and be
  precise. You MUST give **(a)** the exact commit to open (and which
  branch/URL it's on), and **(b)** numbered, literal step-by-step actions
  to run and what to look for — enough that the result is an unambiguous
  yes/no, not a vibe. State plainly which claims you verified vs. which
  depend on their device.

**Cross-surface verification lives in one skill.** The `verify-snippets`
skill (`.claude/skills/verify-snippets/`) is the single home for driving
the app the way a reader does — the browser personas (iOS PWA, iOS Safari,
iOS Chrome, Android Chrome, desktop Chrome), the real-WebKit WebKitGTK
harness, the real-iOS lane (device farm, Simulator, or a manual iPhone
protocol), and the feature map. Extend it — add a persona or a lane —
rather than starting a second `verify-*` skill; there should stay exactly
one. `webapp-testing` below remains the lower-level Playwright toolkit it
builds on.

## Visual verification (do this for UI changes)

`pnpm build`, then serve and drive the app. **agent-browser (Vercel) is
the default driver**; Playwright is the fallback where agent-browser
cannot reach (non-Chromium engines, raw CDP sessions, the frozen
`measure-*.py` harnesses). `.claude/skills/verify-snippets/scripts/ab`
wraps it with this sandbox's settings and the four personas:

```sh
python3 .claude/skills/webapp-testing/scripts/with_server.py \
  --server "node_modules/.bin/next start" --port 3000 -- bash <proof>.sh

# inside <proof>.sh
.claude/skills/verify-snippets/scripts/ab --persona ios-pwa batch --bail \
  "set viewport 393 852" \
  "open http://127.0.0.1:3000/calendar" \
  "wait 5000" \
  "screenshot /tmp/verify-snippets/book.png"
```

Gotchas learned the hard way:
- Start the server as `node_modules/.bin/next start` (not `pnpm start`)
  so the harness can actually kill it; orphaned `next-server` processes
  serve stale chunk manifests → mysterious 500s. Clean up with
  `pkill -9 -f "next[-]server"` (brackets stop pkill matching itself).
- This sandbox pins Playwright browsers at `/opt/pw-browsers`
  (chromium 1194 ⇒ `pip install playwright==1.56.0`). agent-browser
  cannot fetch its own Chrome here — the Chrome for Testing CDN is
  blocked by the agent proxy — so the `ab` wrapper points it at that same
  pinned binary.
- `ab batch` re-splits each command on spaces. Single-quote any argument
  containing one (`"eval 'JSON.stringify({a: 1})'"`), or the argument is
  truncated and you get a parse error or "Element not found".
- To exercise voice capture headlessly, stub **both**
  `window.SpeechRecognition` and `window.webkitSpeechRecognition` via
  `add_init_script` (Chromium exposes the unprefixed one too).
- Screenshot at 1280px and 390px, Paper and Lamplight
  (`localStorage.setItem('theme','dark')` + reload).

**WebKit testing IS available** — not via Playwright (`/opt/pw-browsers`
has Chromium only and downloads are blocked; don't conclude WebKit is
impossible from that). Drive the system WebKitGTK over raw W3C WebDriver
HTTP (stdlib urllib, no selenium):

```sh
apt-get install -y webkit2gtk-driver xvfb        # once per sandbox
xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &  # keep running
```

then POST to `127.0.0.1:4599/session` with capabilities
`{"browserName":"MiniBrowser","webkitgtk:browserOptions":{"binary":
"/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser","args":
["--automation"]}}` and use plain endpoints (`/url`, `/execute/sync`).
**`scripts/measure-webkit-spans.py` is the complete working reference.**
Caveats: single session only (on "session already exists":
`pkill -9 -f WebKitWebDriver; pkill -9 -f MiniBrowser`, restart the
driver); software-rendered under Xvfb, so paint costs read ~5× a real
device and no rAF ticks fire while idle — use it for relative A/Bs and
WebKit-specific pathologies (it has caught real ones Blink hides:
selector-engine scans, pointer-events compositing walks), keep Chromium
harnesses for correctness, and nothing replaces the on-device pass.

## Deploy

**Production branch: `claude/nice-dijkstra-q7d285`** — this repo has no
`main`/`master`; that branch is the GitHub default and what prod deploys
from. Merge finished feature branches there without asking. The
owner's permission to merge is standing: a session instruction to
develop on a feature branch says where the work happens, not that
finished work waits here.

**One thing waits: a change to the reader's experience that nobody has
watched work.** The test is not "is it visual". It is "can a reader
feel this if it is wrong" — a broken sign-in, a sync that drops an
entry, a capture that loses a recording, and a card that paints wrong
are the same class of bug, and shipping any of them unobserved is the
whole reason for the gate. So the gate covers UI, styling, copy, and
motion, and equally the flows behind them: auth and sign-in, sync and
merge, encryption and enrollment, backup and restore, speech capture,
and the API routes those flows call. Such a change stays on its branch
until a harness run, a test that reproduces the old failure, or an
on-device pass has observed it working, or until the owner says to
ship it. See "Prove the fix" for what counts as observed.

Everything else merges as soon as it is finished: tooling, skills,
docs, internal refactors the test suite already covers, and any
reader-facing change you have watched work.

Every production page ships a strict Content-Security-Policy from
`next.config.ts` — its `connect-src` is the browser-enforced list of
everywhere the app may send data, derived from
`src/lib/speech-providers.ts`, and `/verify` tells users to curl it. A
new external origin is a privacy event: update the provider table (or
config), `/verify`, and the privacy page in the same commit, and re-run
the zero-violation sweep. `CSP_REPORT_ONLY=1` de-fangs the header in an
emergency without new code.

Any Node host (Vercel works as-is). Sync/backup need
`DATABASE_URL`/`BETTER_AUTH_SECRET` (and the Google/Resend keys);
without them the app stays whole and device-only.
