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
pnpm test         # vitest — merge/e2e/backup units + the copy-clarity linter
pnpm check:copy   # just the STE-informed copy linter (copy-clarity.test.ts)
pnpm icons        # regenerate app icons from scripts/generate-icons.mjs
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
  ledger state `error`); Settings derives its line via
  `backupHealth()` (`backup-shared.ts`, unit-tested) — "failing" is
  a reported error OR a ledger quiet past 3 days while the book
  moved (`behind` flag from `/api/sync/status`), which catches the
  vanished-device case no report can reach. The daily cron
  (`CRON_SECRET`, vercel.json) is a watchdog only — stale ledger +
  moving book → one email per silence — plus the tombstone
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

## Visual verification (do this for UI changes)

`pnpm build`, then serve and screenshot with the `webapp-testing` skill:

```sh
python3 .claude/skills/webapp-testing/scripts/with_server.py \
  --server "node_modules/.bin/next start" --port 3000 -- python3 <script>
```

Gotchas learned the hard way:
- Start the server as `node_modules/.bin/next start` (not `pnpm start`)
  so the harness can actually kill it; orphaned `next-server` processes
  serve stale chunk manifests → mysterious 500s. Clean up with
  `pkill -9 -f "next[-]server"` (brackets stop pkill matching itself).
- This sandbox pins Playwright browsers at `/opt/pw-browsers`
  (chromium 1194 ⇒ `pip install playwright==1.56.0`).
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
from. Merge finished feature branches there (no need to ask).

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
