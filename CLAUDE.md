@AGENTS.md

# Snippets — working in this repo

A local-first PWA commonplace book ("Homework for Life"): frictionless
voice/typed capture, quiet Claude-powered filing, calendar review.
**Before touching any UI, styling, copy, or animation, use the
`snippets-craft` skill** (`.claude/skills/snippets-craft/`) — it is the
design constitution. `DESIGN.md` has the full rationale and tokens.

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
- **Speech:** `src/hooks/use-speech.ts` is one hook with two engines.
  Primary: Aqua Voice's Avalon via `src/app/api/transcribe/route.ts`
  (Whisper-compatible proxy; `AQUA_API_KEY`, optional `AQUA_BASE_URL`/
  `AQUA_MODEL`) — MediaRecorder → upload on stop → text settles ~450ms
  later; works in every browser incl. Firefox/Brave/installed iOS PWA.
  Fallback: Web Speech API streaming live words (tap-to-toggle,
  auto-restarts dropped mobile sessions, iOS runs non-continuous,
  circuit breaker against dead services). Engine chosen by probing
  `GET /api/transcribe`. Every failure surfaces a typed reason
  (`SpeechFailure`) that capture.tsx turns into specific copy.
- **Enrichment:** `src/app/api/enrich/route.ts` (Claude Haiku via
  `@anthropic-ai/sdk`, structured output with `zodOutputFormat`,
  model overridable via `ENRICH_MODEL`). Client orchestration +
  heuristics fallback in `src/lib/enrich.ts`. It must stay best-effort:
  no key → 503 → chips; `enriched: "manual"` is never overwritten.
  When changing this code, consult the `claude-api` skill first.
- **UI primitives:** `src/components/ui/*` are vendored shadcn sources
  (the registry domain is blocked in some sandboxes; they're ours now
  and intentionally restyled — overlay tint, input focus, etc.). Edit
  them directly; don't re-fetch over local changes.
- **PWA:** `src/app/manifest.ts`, hand-rolled `public/sw.js`
  (registered in `src/components/providers.tsx`, production only).
  Bump `VERSION` in `sw.js` when changing caching behavior.

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

Any Node host (Vercel works as-is). `ANTHROPIC_API_KEY` enables filing;
without it everything still works. Static-export hosting also works —
the enrich route 404s and the client falls back gracefully.
