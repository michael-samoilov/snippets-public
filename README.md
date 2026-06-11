# Snippets

*A pocket commonplace book.* Catch the stories, jokes, quotes, and stray
thoughts of your day before they evaporate — by voice, in one breath.

Built in the spirit of **Homework for Life** (Matthew Dicks,
*Storyworthy*): at the end of every day, keep the most storyworthy
moment that happened. Do it for a month and you discover your mundane
life is full of stories.

## What it does

- **Speak it or write it.** Tap the wax seal and talk; words set
  themselves on the page as you speak — live, streaming, on-device via
  the Web Speech API. Or just type. Nothing is asked of you at the
  moment of capture.
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

Voice capture needs Chrome, Safari, or Edge (typing works everywhere).

### Automatic filing (optional)

Set an API key and entries title/file themselves:

```sh
ANTHROPIC_API_KEY=sk-ant-…   # uses claude-haiku-4-5; override with ENRICH_MODEL
```

Without a key the app is fully functional — filing falls back to
heuristics and one-tap chips.

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
