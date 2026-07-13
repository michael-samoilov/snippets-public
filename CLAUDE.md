@AGENTS.md

# Snippets — working in this repo

A local-first PWA commonplace book ("Homework for Life"): frictionless
voice/typed capture, calendar review.
**Before touching any UI, styling, copy, or animation, use the
`snippets-craft` skill** (`.claude/skills/snippets-craft/`) — it is the
design constitution. `DESIGN.md` has the full rationale and tokens.
`BACKLOG.md` holds owner-accepted future work with design notes —
check it before proposing scope; items there are decided.

## Commands

```sh
pnpm dev          # dev server (Turbopack)
pnpm build        # production build + typecheck (the de facto test gate)
pnpm start        # serve the build
pnpm lint         # eslint
pnpm icons        # regenerate app icons from scripts/generate-icons.mjs
```

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
  code; each adapter supplies only socket/send/parse/finalize/doneOnClose).
  Two ship: **deepgram** — Nova-3 (`DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`/
  `DEEPGRAM_LANGUAGE`; token at `src/app/api/deepgram-token/route.ts`
  mints a short-lived JWT, browser connects with a `["bearer", jwt]`
  subprotocol and streams raw binary PCM; ~2x lower latency, `language=multi`
  code-switching) — and **scribe** — ElevenLabs Scribe v2 Realtime
  (`ELEVENLABS_API_KEY`, `SCRIBE_MODEL`/`ELEVENLABS_BASE_URL`; token in
  the WS query, base64-JSON audio). Order/default set by
  `NEXT_PUBLIC_SPEECH_PROVIDERS` (default `deepgram,scribe`) — first
  available wins, the rest are automatic backups; the token is pre-minted
  (warm grant) so the tap opens the socket instantly. Partial/final
  transcripts land in the hook's `interim`/`segments`. Fallback: **batch**
  — a Whisper-dialect
  proxy at `src/app/api/transcribe/route.ts` (`TRANSCRIBE_API_KEY`,
  optional `TRANSCRIBE_BASE_URL`/`TRANSCRIBE_MODEL`; `AQUA_*` honored
  as aliases; default Aqua's Avalon — swap recipes in README.md) —
  MediaRecorder → upload on stop → text settles ~450ms later.
  Fallback: Web Speech API streaming live words (tap-to-toggle,
  auto-restarts dropped mobile sessions, iOS runs non-continuous,
  circuit breaker against dead services). Engines chosen by probing
  `GET /api/scribe-token` and `GET /api/transcribe`. Every failure
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
- **The book is WINDOWED; cards must still default FLAT.**
  `src/app/calendar/page.tsx`'s schedule feed used to mount a live card for
  the reader's *whole* history, so any PER-CARD paint effect (`mix-blend`,
  `isolation: isolate`, a blurred `box-shadow`) was paid hundreds of times
  and scaled with the book — which jetsam-kills iOS on a years-deep book
  ("A problem repeatedly occurred"; scroll-momentum stalls are the milder
  form of the same memory pressure). It's now virtualized: `ScheduleFeedBase`
  renders only the on-screen day-sections plus overscan (~40 cards, never the
  whole book), geometry in `src/lib/book-window.ts` (pure, fling-tested), with
  spacer divs holding the scroll height for the rest. That bounds the live
  card count, so the lift + ink-into-paper blend are back — gated behind
  `[data-rich]` on near-viewport sections. The invariant that keeps iOS
  momentum alive: **never write scrollTop to compensate a height change during
  a scroll** (the lesson in `src/components/calendar/shared.ts`) — so
  un-rendered rows reserve a height estimated from their text (canvas
  line-count matching the real column) and locked to the exact measured height
  once seen; corrections only ever land at rest. The `.book-card` DEFAULT stays
  flat (windowing is the only thing bounding the count), so do NOT move
  blend/isolation/blurred-shadow onto the bare card. The full "FLAT-BOOK LAW"
  lives on `.book-card` in `globals.css`.
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
- **End-to-end encryption (opt-in):** `payloadFormat: 2` seals entry
  payloads with AES-GCM under a per-user book key
  (`src/lib/crypto.ts`, unit-tested; state machine in `src/lib/e2e.ts`).
  The key is wrapped under the passphrase AND a recovery code; only
  the wrapped envelopes rest server-side (`/api/keys` — PUT once,
  never replaceable, that's deliberate). On-device the key is a
  NON-extractable CryptoKey in the meta table. Enrolled + no key =
  the `locked` sync state: sync pauses loudly, capture never does.
  A key that no longer opens pulled rows (encryption turned off→on
  elsewhere) throws `KeyMismatchError`: the device forgets the stale
  key and re-enters `locked` — never an endless retry. On outages the
  enrollment probe may reuse a cached "enrolled", never a cached
  "not enrolled" (that could push plaintext into a sealed book;
  unit-tested in `e2e.test.ts`). Decrypt/encrypt OUTSIDE Dexie
  transactions (foreign awaits kill them).
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
  scrubber. Google OAuth
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

## Deploy

Any Node host (Vercel works as-is). Sync/backup need
`DATABASE_URL`/`BETTER_AUTH_SECRET` (and the Google/Resend keys);
without them the app stays whole and device-only.
