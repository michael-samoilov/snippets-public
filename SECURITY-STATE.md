# Privacy & security — the true state

**This file is the single source of truth for what Snippets actually
does with your data.** Every user-facing claim (the privacy page, terms,
Settings copy, `/verify`) and every internal doc (CLAUDE.md, DESIGN.md,
the snippets-craft skill) must agree with the "Current state" section
below. When a privacy- or security-relevant behavior changes, update
this file **in the same commit** — the Change log at the bottom is how we
avoid describing yesterday's architecture as if it were today's.

**Authoring rule:** describe mechanism, not motive; anchor each claim to a
code symbol (a constant, function, route, or test) so a reader can verify
it. A stated *purpose* has nothing to test against and rots silently — if a
"we keep X for reason Y" claim can't name the code that consumes X, drop the
Y or trace it first. (This is how a false "content kept 30 days for
cross-device undo" line survived here: no such consumer existed.)

How to use it:
- **Before editing any privacy/terms/Settings/verify copy:** read the
  matching row in Current state; the copy must match the *architecture*
  column, not memory.
- **After changing any enforcement code** (sync gate, push route, crypto,
  CSP, providers): update the row *and* add a Change log entry, then
  re-run the harnesses named in "How each claim is proven."
- If this file and a page disagree, this file is presumed right and the
  page is the bug (unless the code has drifted from both — then fix the
  code first).

### What's mechanized vs. what this file must carry by hand

This doc is prose, so drift is prevented in three tiers — strongest first:

1. **Derive, don't duplicate (can't drift — it's one value).** Facts that
   appear on several surfaces are a single imported value, not copies:
   the speech provider table (`src/lib/speech-providers.ts`) is read by
   the privacy page, Settings, *and* the CSP; the CSP itself
   (`src/lib/security-headers.ts`) is built from it and applied by
   `next.config.ts`. These surfaces cannot disagree.
2. **Mechanized invariants (fail the build like the copy linter).**
   `src/lib/security-invariants.test.ts` is the egress/absence linter:
   every external origin in `src/` must be classified (a new `fetch`/
   `WebSocket` host fails the build until declared *and* added to the CSP),
   the CSP `connect-src` must equal the code's real browser egress, and
   the deleted plaintext paths (`disableEncryption`, keys `DELETE`, the
   no-key wire path) must stay deleted. Adding a data destination is
   therefore impossible without a conscious edit that also forces the
   privacy/`/verify` review.
3. **Human-only (this file's real job).** No linter can verify that the
   English sentence "we cannot read your entries" *matches* the crypto,
   or that a provider's external retention policy still holds. Those get
   a dated review against the rows below — the doc exists to make that
   review fast, not to replace it.

---

## Current state (as of 2026-07-23)

### Can we read your entries?
- **No.** Signed out: entries live only in this browser's IndexedDB and
  never reach the server. Signed in: end-to-end encryption is **required**
  — entries are sealed on-device (AES-256-GCM under a per-user book key)
  before anything is sent, and the server refuses anything readable.
- **Enforcement:** `src/lib/sync.ts` (no plaintext push path — `pushAll`/
  `pullAll`/`toWireChange` require the key), `src/app/api/sync/push/route.ts`
  (accepts payload formats 2|3 only; format 1 → `409 encryption_required`),
  `src/lib/sync-wire.ts` (format 3 = AAD-bound envelope).
- **Asserts it:** privacy `#can-you-read`, `#if-you-sign-in`,
  `#end-to-end-encryption`; terms `#encryption`; Settings Encryption
  section; the first-run intro (`copy.intro.about`, the today zone's
  first-ever prose); `/verify` tests 2 & 3.

### The sign-in → encryption window
- **There is none.** A signed-in-but-unenrolled account sits in the
  `needsSetup` sync state: no push, no pull, counts only. The first push
  cannot happen before a key exists. Enrollment (set a passphrase +
  save a recovery code) is the `/welcome` step; capture is never blocked.
- **Enforcement:** `runCycle` in `src/lib/sync.ts` (the `needsSetup`
  branch), `src/components/encryption/enroll-flow.tsx`,
  `src/app/welcome/page.tsx`, the calendar's needs-setup letter.

### Can encryption be turned off?
- **No — deliberately.** `disableEncryption` was deleted; `/api/keys` is
  write-once (no DELETE, no replace). Only deleting the whole account
  removes the wrapped keys (server-side cascade).
- **Enforcement:** `src/app/api/keys/route.ts`, `src/lib/e2e.ts`.

### What can the server do to a sealed entry?
- **Nothing without failing loudly.** The row's `id`, `updatedAt`,
  `deletedAt`, and `payloadFormat` are bound into the cipher as AES-GCM
  AAD, so a moved, rolled-back, resurrected, or format-downgraded
  envelope fails to decrypt (surfaces as the `locked` state, never a
  silent swap). The server still sees that entries exist, their rough
  size, and when each changed.
- **Enforcement:** `aadForRow` in `src/lib/crypto.ts` (canonical string
  pinned by a test), `fromWireRow`/`toWireChange` in `src/lib/sync-wire.ts`.

### Voice
- Speaking an entry streams audio to a transcription provider; words
  come back; **we store none of it**. Provider order (first available
  wins) and each provider's data posture live in ONE table:
  `src/lib/speech-providers.ts`. Default chain: **Soniox** (in-memory,
  no storage, no training) → **Speechmatics** (stores neither audio nor
  transcript) → **Deepgram** (every request sends `mip_opt_out=true`).
  **ElevenLabs is out of the default chain** (its zero-retention is
  enterprise-only). Last-resort fallback is the browser's own Web Speech
  API — that audio is sent by the *browser* to Google/Apple, invisible to
  our CSP and network tab, and the privacy page says so.
- **Which providers are named on the privacy page** = `activeSpeechProviders()`
  (only those whose API key is set on this deployment).
- **Asserts it:** privacy `#voice`, `/verify` test 2; the retention lines
  are STE-linted (in `copy-clarity.test.ts` PAGES).

### Google Drive backup
- Plaintext **by design** — it's the key-loss safety net, delivered by
  the writer's own device to their own Drive (`drive.file` scope, visible
  folder). The server holds no Drive tokens and never carries the files.
- **Do not encrypt these files.** Enforcement: `src/lib/backup-client.ts`,
  `src/lib/drive-client.ts`. Asserts it: privacy `#google-drive-backup`.

### What leaves the app, ever (the CSP allowlist)
- Every production page ships a strict `Content-Security-Policy` whose
  `connect-src` is the complete, browser-enforced list of destinations:
  `'self'`, `https://www.googleapis.com` (Drive upload), and exactly the
  configured speech WebSocket origins. Plus `frame-ancestors/object-src/
  base-uri 'none'`, `form-action 'self'`, DNS-prefetch off, same-origin
  referrer, microphone-to-self Permissions-Policy.
- **Source:** `src/lib/security-headers.ts` (built from `speech-providers.ts`),
  applied by `next.config.ts`. Escape hatch: `CSP_REPORT_ONLY=1`.
- **A new external origin is a privacy event:** update the provider table
  (or config), `/verify`, and the privacy page in the same commit.
- **`script-src` keeps `'unsafe-inline'`** — it is genuinely required by
  Next.js's inline RSC bootstrap scripts (unhashable per-build; SRI is
  webpack-only, broken on Turbopack). Removing it needs a per-request
  nonce, which forces every page to render dynamically (loses Vercel's
  static-HTML edge cache). Judged not worth that trade for now; every
  other directive is tight. The nonce path is written up in BACKLOG.
- **`access-control-allow-origin: *` is benign, not ours.** Vercel's CDN
  stamps it on public static assets and the static `/`→`/calendar`
  redirect only — never on our cookie-authed Node API routes, and `*` is
  spec-incompatible with credentials, so it cannot expose logged-in data.
  No code sets it; no action taken. (Confirm live if wanted:
  `curl -sI https://www.snippets.ink/api/sync/status | grep -i access-control`
  → expect no line.)

### Data we collect
- Sign-in needs your email (and, with Google, your name + profile
  picture). No passwords. No ads, no selling, no analytics on entry
  content. Only measurement: anonymous page-view counting (Vercel,
  same-origin `/_vercel/insights`). Only emails: a sign-in code, or a
  backup-stopped warning.

### Leaving
- Erase-all is permanent — there is no in-app undo for it (unlike a single
  delete, which has a 10-second local undo toast). It soft-deletes
  everywhere (propagates as tombstones), and a delivering device empties
  the Drive backup on its next run. The permanent part is the tombstone
  (id + timestamps, no words), kept forever server-side — that permanence,
  not the payload, is what stops resurrection. The encrypted payload lingers
  ≤30 days, then the cron scrubs it. That window feeds no feature today
  (single undo reads the local row, not the server; no restore-erased UI
  exists), so it is only a grace period before destruction and future
  optionality for a restore feature; the plumbing (payload-carrying pull +
  `restoreSnippet`) already exists. `PURGE_AFTER_MS` (client) and
  `TOMBSTONE_SCRUB_AFTER_MS` (server) are the paired 30-day constants; the
  privacy copy's "within 30 days" must move with them.
  Account deletion removes the account, synced entries + tombstones,
  wrapped keys, and backup record from the server immediately; revokes
  the Drive grant. Device copies and delivered Drive files remain yours.

### How each claim is proven (run these after touching the area)
- **No plaintext window, end to end:** `tests/e2e/forced_e2e.py` (real
  build + real WebCrypto vs stub server; sentinel scanned on every wire
  body). 22 checks.
- **Server refusal matrix:** `src/app/api/sync/push/route.test.ts`.
- **AAD binding + legacy-format reads:** `src/lib/crypto.test.ts`,
  `src/lib/sync-wire.test.ts`.
- **Speech adapters speak the documented protocols:**
  `tests/e2e/speech_adapters.py` (14 checks).
- **Copy stays in the STE register:** `pnpm check:copy`.
- **No undeclared data destination; CSP == code egress; deleted plaintext
  paths stay deleted:** `src/lib/security-invariants.test.ts` (rides
  `pnpm test`).
- **CSP has zero runtime violations:** the sweep in the commit that added
  it (re-run a page/theme/capture pass after any `connect-src` change).

---

## Known gaps / pending (do not describe as done)

- **The short, unqualified privacy page is NOT live yet.** The current
  privacy page is the honest *interim* two-state version. The headline
  "We cannot read your entries. Not won't, can't." + 4-row data-flow
  table is **gated** on the pre-2026-07-23 accounts re-encrypting — see
  BACKLOG #14. Do not swap it in until the gate check passes.
- **The short privacy page + digestibility revision** is on preview branch
  `claude/privacy-short-page-preview`, pending owner review and merge. The
  gate is met, so the unqualified
  "We cannot read your entries" headline is architecturally true. Not yet
  on prod.
- The old "early accounts / plaintext lingers" note is removed from the
  privacy page, because the re-encryption gate in BACKLOG #14 passed.
- **Soniox / Speechmatics are wired but dormant** until their API keys
  are set in the environment. Until then the active chain is whatever
  keys exist (likely Deepgram, mip-opted-out). The privacy page names
  only active providers, so it stays truthful automatically.
- **On-device transcription** (BACKLOG #16), **ciphertext self-viewer**
  (BACKLOG #15), **open-sourcing** (BACKLOG #17, brief in `OPEN-SOURCE.md`)
  are deferred by decision.

---

## Change log

Newest first. One entry per privacy/security-relevant change; cite the
commit and note which user-facing surfaces it moved.

### 2026-08-13 — first-run intro corrected; it still described optional encryption
No behavior change. The first-ever intro in the today zone (the first
description of our security model a new reader ever gets) still said
"if you like, you can turn on end-to-end encryption" and called the Drive
backup a "sync". Encryption became required at sign-in on 2026-07-23, and
there is no UI to turn it off, so that paragraph had been wrong for three
weeks. It was invisible to the copy-clarity linter because the whole
`copy.intro` group was treated as literary. Fixed by splitting the group:
`intro.body` + `intro.close` stay literary and exempt, while the rewritten
`intro.about` joins `TECH_COPY_PATHS` and now says the server copy is
always encrypted with a key only the writer's devices hold, and that Drive
receives a readable copy (matching the privacy page's "plain, readable
files by design"). Also on this surface: the recovery-code controls in
`EnrollFlow` are now inert for a beat after they appear, so a stale tap
carried over from "Encrypt my entries" cannot dismiss a once-only recovery
code.

### 2026-07-24 — MDX policy pages; deletion copy corrected; em-dash ban (preview)
No behavior change. The privacy/terms/verify pages moved to `.mdx` (owner
can edit the prose as Markdown). Corrected a real drift: the erase story
described a "cross-device undo" that does not exist. The 30-day payload
retention feeds no feature (single undo reads the local row, not the
server; no restore-erased UI), so the privacy "Leaving" copy now leads
with "erasing is permanent, export first" and frames the 30 days as the
server finishing destruction, not a recovery window; the Drive-empties-on-
next-delivery fact is stated. This entry's `### Leaving` bullet above was
fixed to match. Also: em-dashes purged from all user-facing copy (they read
as AI prose) with a new copy-clarity rule banning `—` across `copy` + the
policy pages; the OG alt text is exempt (its em-dash quotes the designed
share image). On preview branch, pending merge.

### 2026-07-23 — privacy/verify digestibility revision (preview)
Seven-pass audit → shorter, plainer pages. Trust fixes: the voice glance
line no longer overclaims "then it is gone" (it contradicted our own
Deepgram retention line); Backup now says "unencrypted" and states
"Google can read them" in the glance; a "no catch — no ads, no selling,
no training" row surfaces that concern up top. De-jargon: "your entries"
not "your words", "saved" not "kept/written into", the verify network
table made plain (no "payload / v/iv/ct / API-key" register). Consolidation:
duplicate encryption/Drive explanations cut, Voice reordered above Drive.
Styling: all three policy pages unified on `SectionHeading` (sticky
`policy.tsx` + CSS retired). Copy voice updated (law 7 + DESIGN.md) with
new lint rules (`your book`, `v/iv/ct`, `payload`-on-pages banned). CORS
finding documented as benign; CSP `unsafe-inline` kept (nonce backlogged).
Also fixed a real render bug: the JSX transform drops the literal space
after a closing tag, so "cannotsend"/"Content-Security-Policyheader" — now
explicit `{" "}`. On preview branch, pending merge.

### 2026-07-23 — the privacy & security push
- **Deepgram opted out of model-improvement** (`mip_opt_out=true` on every
  streaming request) so retained-and-trained audio stops. Made the
  existing "audio is not kept" true. — `b114aca`
- **Encryption became required at sign-in.** Wire format 3 (AAD-bound);
  client plaintext path deleted (key now required); server rejects
  format 1 (409); `needsSetup` sync state; enrollment moved into
  `/welcome` (shared `EnrollFlow`); `disableEncryption` and the
  `/api/keys` DELETE removed; legacy books converge to format 3 via a
  re-seal sweep + pull re-dirty rule. Absorbed BACKLOG #8 (AAD). Interim
  privacy/terms edits shipped in the same commit (three-state "can you
  read?" → No). — `8722cc2`
- **No-window guarantee made observable:** `tests/e2e/forced_e2e.py` +
  `push/route.test.ts`; fixed a welcome-flow bug that discarded the
  once-only recovery code. — `e711abf`
- **Voice provider chain swapped to no-storage-by-default:** Soniox
  primary, Speechmatics backup, ElevenLabs out of default; new adapters +
  token routes; `speech-providers.ts` truth table; privacy Voice section
  renders from it + Web-Speech-fallback disclosure. — `93802cf`
- **Strict CSP + `/verify`:** `connect-src` as the browser-enforced
  allowlist; the three-test "verify, don't trust" page. — `15a1955`
- **Constitution/backlog/docs:** CLAUDE.md E2E + CSP rules, snippets-craft
  law 8, DESIGN.md "Privacy is architecture", BACKLOG #14–17,
  `OPEN-SOURCE.md`. — `2b3f811`
- **This file** created as the source of truth; CLAUDE.md points at it. —
  `471a496`
- **Drift made mechanical:** CSP moved to a tested value
  (`security-headers.ts`); `security-invariants.test.ts` added — the
  egress registry + CSP cross-check + absence guards that fail the build
  on a new data destination or a reintroduced plaintext path.

### (before this push)
Optional per-user E2E (format 2), accounts + sync, client-delivered Drive
backup, account deletion — see git history; superseded where the rows
above say so (E2E is no longer optional; format 2 is now legacy-read-only).
