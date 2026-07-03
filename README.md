# Snippets

*A pocket commonplace book.* Catch the stories, jokes, quotes, and stray
thoughts of your day before they evaporate — by voice, in one breath.

Built in the spirit of **Homework for Life** (Matthew Dicks,
*Storyworthy*): at the end of every day, keep the most storyworthy
moment that happened. Do it for a month and you discover your mundane
life is full of stories.

## What it does

- **Speak it or write it.** Tap the wax seal and talk. With an
  ElevenLabs key configured, Scribe v2 Realtime sets your words on the
  page as you speak — live, in any browser that has a microphone, in
  90+ languages. With a Whisper-dialect key instead, recordings are
  transcribed about half a second after you stop. Without either, the
  browser's own speech engine streams words live (Chrome, Safari,
  Edge). Or just type. Nothing is asked of you at the moment of
  capture.
- **Filed for you, quietly.** A few seconds after you keep an entry,
  Claude titles it, files it under a kind (story · joke · quote · idea ·
  phrase · observation), and tags it. No key configured? One-tap chips
  do the same job. Hand edits always win.
- **Leaf back through.** A searchable collection grouped by day, a
  calendar ledger with ink-dot density, and *On this day* resurfacing
  what you kept a month and a year ago.
- **Yours alone.** Everything lives in IndexedDB on your device.
  Installable PWA, works offline, exports to JSON and Markdown anytime.
  The only thing that ever leaves the device is entry text sent for
  filing — and you can turn that off.

## Running it

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

### Optional keys

Both are optional; the app is fully functional with neither.

```sh
# Live voice transcription via ElevenLabs Scribe v2 Realtime — words
# stream onto the page as you speak, in any browser with a microphone.
# The key never reaches the browser; the server mints single-use
# tokens (/api/scribe-token) for each take.
ELEVENLABS_API_KEY=…
# SCRIBE_MODEL=scribe_v2_realtime              # override the model
# ELEVENLABS_BASE_URL=https://api.elevenlabs.io

# Batch fallback (used when no ElevenLabs key is set): a proxy that
# speaks the OpenAI Whisper dialect — recordings upload when you stop.
# TRANSCRIBE_API_KEY=…
# TRANSCRIBE_BASE_URL=https://api.aqua.sh/v1   # default: Aqua's Avalon
# TRANSCRIBE_MODEL=avalon-1
# (the older AQUA_API_KEY / AQUA_BASE_URL / AQUA_MODEL names still work)
# Any Whisper-compatible provider is a two-line swap:
#   OpenAI  TRANSCRIBE_BASE_URL=https://api.openai.com/v1
#           TRANSCRIBE_MODEL=gpt-4o-transcribe
#   Groq    TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1
#           TRANSCRIBE_MODEL=whisper-large-v3-turbo
#
# With neither key, voice falls back to the browser's own speech engine
# (Chrome, Safari, Edge) — typing works everywhere regardless.

# Automatic filing (title/kind/tags) via Claude.
# Without it, filing falls back to heuristics and one-tap chips.
ANTHROPIC_API_KEY=sk-ant-…   # uses claude-haiku-4-5; override with ENRICH_MODEL
```

### Production

```sh
pnpm build && pnpm start
```

Deploys as-is to Vercel or any Node host. On your phone: open it,
"Add to Home Screen", and it behaves like an app — offline included.

## The design

Paper and ink, a faded red margin rule, printers' marks in the margin,
sealing-wax red reserved for the act of recording. The whole system —
tokens, type voices, motion budget, copy voice — is documented in
[`DESIGN.md`](./DESIGN.md), and enforced for agentic contributors by the
skills in [`.claude/skills/`](./.claude/skills/).

| | |
|---|---|
| Stack | Next.js 16 · React 19 · Tailwind v4 · Dexie · Web Speech API · Claude Haiku |
| Data | Local-first (IndexedDB), soft-delete + undo, JSON/Markdown export |
| Typography | Fraunces (display + prose) · IBM Plex Mono (meta) |
