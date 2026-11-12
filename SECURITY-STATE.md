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

## Current state (as of 2026-11-12)

### Can we read your entries?
- **No.** Signed out: entries live only in this browser's IndexedDB and
  never reach the server. Signed in: end-to-end encryption is **required**
  — entries are sealed on-device (AES-256-GCM under a per-user book key)
  before anything is sent, and the server refuses anything readable.
- **Enforcement:** `src/lib/sync.ts` (no plaintext push path — `pushAll`/
  `pullAll`/`toWireChange` require the key), `src/app/api/sync/push/route.ts`
  (accepts payload format 3 only; format 1 → `409 encryption_required`,
  the AAD-less format 2 → `400`), `src/lib/sync-wire.ts` (format 3 =
  AAD-bound envelope; `fromWireRow` refuses a plaintext row on pull).
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
- **The recovery code survives the commit.** The `/api/keys` PUT is the
  point of no return, so `enroll` (`src/lib/e2e.ts`) returns the code
  past that line no matter which post-commit step fails: a failed local
  key install returns `device: "keyPending"` (the unlock form takes the
  passphrase just typed) and a failed sweep re-runs next cycle
  (`maybeAadSweep`). A 409 raises `AlreadyEnrolledError`, which the
  flow renders as "unlock instead" rather than a generic failure.
  Pinned by the enroll cases in `src/lib/e2e.test.ts`.

### Can encryption be turned off?
- **No — deliberately.** `disableEncryption` was deleted; `/api/keys` is
  write-once (no DELETE, no replace). Only deleting the whole account
  removes the wrapped keys (server-side cascade).
- **Enforcement:** `src/app/api/keys/route.ts`, `src/lib/e2e.ts`.
- **A new envelope must use the client's key-derivation strength.** The
  PUT refuses a passphrase envelope below 600,000 PBKDF2 rounds and a
  recovery envelope below 10,000 (`PASSPHRASE_ITERATIONS` /
  `RECOVERY_ITERATIONS` in `src/lib/crypto.ts`, imported by the route's
  schema). GET returns stored envelopes as they are, so no enrolled key
  stops opening. Pinned by `src/app/api/keys/route.test.ts`.

### What can the server do to a sealed entry?
- **It cannot read one, or change one a device holds; it can leave one
  out or mark one deleted.** The row's `id`, `updatedAt`, `deletedAt`,
  and `payloadFormat` are bound into the cipher as AES-GCM AAD, so an
  envelope moved to another id, or given other clocks or another format,
  fails to decrypt (`KeyMismatchError` → the `locked` state, never a
  silent swap).
- **AAD alone can't refuse a resend.** An older envelope sent again under
  the clocks it was sealed with still decrypts. So `adoptServerRow`
  refuses, for every entry the device holds: a copy older than its own
  (a rolled-back version, or a deleted entry's pre-deletion copy), and an
  AAD-less format-2 envelope (nothing writes format 2 any more, so on a
  held entry it can only be a replay). `fromWireRow` refuses every row no
  client writes: plaintext (format 1), an unknown format, a sealed format
  that isn't an envelope, and a payload-less row that isn't a deletion.
  A refused row is skipped, never stored; on the push path the device's
  own edit re-asserts past it.
- **What remains.** A payload-less deletion (what the cron leaves 30 days
  after a delete, `TOMBSTONE_SCRUB_AFTER_MS`) carries no proof, so a
  server can send one for any entry. The device applies it as a soft
  delete that keeps the words, and the 30-day local recovery window
  starts on arrival, not at the server's `deletedAt` (Settings →
  "Recently let go"). The server can also leave rows out of the feed. A
  device that holds no copy (a new device, or an entry purged 30 days
  after its deletion) relies on the server for which entries exist and
  which version is newest, though every entry it opens is one the
  writer's devices encrypted. The server still sees that entries exist,
  their rough size, and when each changed.
- **Legacy rows.** Rows written before 2026-07-23 may rest as format 2.
  A device opens one only for an entry it doesn't hold yet, stores it
  dirty (`needsReseal`), and re-pushes it as format 3.
- **Enforcement:** `aadForRow` in `src/lib/crypto.ts` (canonical string
  pinned by a test); `fromWireRow`, `adoptServerRow`, `toWireChange` in
  `src/lib/sync-wire.ts`; both adoption paths in `src/lib/sync.ts` (the
  pull applier and the push's superseded adoption) go through
  `adoptServerRow`.
- **Asserts it:** privacy `#how-the-encryption-works` (the deep dive).
- **Proven by:** `src/lib/sync-wire.test.ts` (each refusal and each
  held-entry rule); `tests/e2e/forced_e2e.py` (a hostile stub server
  plants plaintext, replays an older copy, swaps a format-2 envelope onto
  a held entry, sends a payload-less live row, and forges a deletion; the
  device's IndexedDB is read after each).

### How much one account can store
- **50,000 rows and 50 MB of encrypted entries per account.** A push
  that would grow an account past either ceiling gets
  `507 quota_exceeded` and writes nothing; a push that does not grow it
  (a deletion, a shorter edit) is never refused, so an account over the
  ceiling can always shrink. Checked under the per-user lock, so two
  pushes can't both slip under it. The numbers and the arithmetic behind
  them live in `src/server/sync-quota.ts`: a 100-word entry is about
  1 KB encrypted, so the ceiling is 137 years of one entry a day, and
  one account at the ceiling uses about a tenth of the 512 MB database.
- **Enforcement:** `growth` + `exceedsQuota` in `src/server/sync-quota.ts`,
  applied in `src/app/api/sync/push/route.ts`. **Proven by:**
  `src/server/sync-quota.test.ts`, the quota cases in
  `src/app/api/sync/push/route.test.ts`.

### Voice
- Speaking an entry streams audio to a transcription provider; words
  come back; **we store none of it**. Provider order (first available
  wins) and each provider's data posture live in ONE table:
  `src/lib/speech-providers.ts`. Default chain: **Soniox** (in-memory,
  no storage, no training) → **Speechmatics** (stores neither audio nor
  transcript) → **Deepgram** (every request sends `mip_opt_out=true`,
  enforced across all callers by the "every Deepgram listen socket opts
  out of model training" guard in `src/lib/security-invariants.test.ts`).
  **ElevenLabs is out of the default chain** (its zero-retention is
  enterprise-only). Last-resort fallback is the browser's own Web Speech
  API — that audio is sent by the *browser* to Google/Apple, invisible to
  our CSP and network tab, and the privacy page says so.
- **Which providers are named on the privacy page** = `activeSpeechProviders()`
  (only those whose API key is set on this deployment).
- **Asserts it:** privacy `#voice`, `/verify` test 2; the retention lines
  are STE-linted (in `copy-clarity.test.ts` PAGES).

### Who can spend the voice providers' credit
- **Only the app's own pages, and only so fast.** The four token routes
  (`/api/{soniox,speechmatics,deepgram,scribe}-token`) and the
  transcription proxy (`/api/transcribe`) need no account, because
  capture without one is the product. Their POST runs `speechGuard`
  (`src/server/speech-guard.ts`) before any upstream call:
  - **Same origin.** `Sec-Fetch-Site` must be absent or `same-origin`,
    and `Origin` must be present and name the host the request reached;
    anything else is `403 cross_site`. This stops another site from
    spending credit through its visitors' browsers. A script can forge
    both headers, so the next check is the limit.
  - **Per-network budget.** A fixed window per bucket (`SPEECH_BUDGETS`):
    30 token mints per network per 10 minutes across all four providers,
    20 uploads per 10 minutes; over it, `429 rate_limited` with
    `Retry-After`. A network is one IPv4 address or one IPv6 /64, because
    one home or server usually holds a whole /64. An IPv4-mapped IPv6
    address counts as its IPv4 address. Counted in Postgres (`speech_rate_limit`, one atomic
    upsert) so all serverless instances share one count; without
    `DATABASE_URL` + `BETTER_AUTH_SECRET`, or when the query fails, an
    in-process count stands in (voice is never refused for a database
    error).
  - **Token lifetimes are capped.** `tokenTtlSeconds` clamps the Soniox,
    Speechmatics, and Deepgram TTL overrides to 60–600 seconds (a
    non-number falls back to 300). ElevenLabs fixes its own token at 15
    minutes, single use.
  - **Upload size.** `/api/transcribe` refuses a declared
    `Content-Length` over 25 MB (plus 64 KB of form overhead) with 413
    before it reads the body.
- **What the budget does not bound:** how long a provider session runs
  once its token is accepted. The providers' own spend limits are the
  backstop.
- **No self-test routes.** The two diagnostics that streamed audio on
  the owner's accounts without a session (`/api/scribe-selftest`,
  `/api/deepgram-selftest`) are deleted.
- **Enforcement:** `src/server/speech-guard.ts`, the five route files,
  and the guard in `src/lib/security-invariants.test.ts` that fails any
  API route that reads a `*_API_KEY` and calls `fetch` without running
  `speechGuard` first.

### Google Drive backup
- Plaintext **by design** — it's the key-loss safety net, delivered by
  the writer's own device to their own Drive (`drive.file` scope, visible
  folder). The server never carries the files.
- **Every Google token at rest is encrypted, and the database refuses
  one that is not.** The CHECK constraint `account_tokens_encrypted`
  (`src/server/db/token-format.ts`, migration 0004) admits only null or
  Better Auth's encrypted format in `access_token`, `refresh_token`, and
  `id_token`. Writes are encrypted under `BETTER_AUTH_SECRET`
  (`encryptOAuthTokens`); the plaintext values stored before 2026-11-11
  were encrypted in place, each checked to decrypt to the original
  before it was written, and the constraint went in only once none was
  left (`encryptLegacyTokens`, run once per instance before its first
  session lookup; the constraint is its completion record).
- **How long the server keeps each Google token:**
  - *Drive link (`linkSocial` with `drive.file`), access + refresh
    token:* from the consent until a device collects it from
    `/api/backup/adopt` (Settings calls it right after the consent;
    normally seconds), which nulls both. Otherwise until the account's
    next Google sign-in or link (the hooks null them), or account
    deletion.
  - *Google sign-in since 2026-11-11, any token:* none. The account
    hooks (`accountTokenHooks` in `src/server/oauth-tokens.ts`) null
    every token write except the Drive link's access and refresh
    tokens, though a sign-in's tokens cover Drive after a grant (Better
    Auth sends `include_granted_scopes=true`).
  - *ID tokens:* none since 2026-11-12. Better Auth writes them
    unencrypted and nothing reads them back for Google (its provider has
    no end-session URL), so the hooks null them on every write.
  - *Tokens a Google sign-in stored before 2026-11-11 (access, refresh,
    ID):* encrypted since 2026-11-12. The refresh token may still reach
    a device with none through adoption, so it was not deleted. Each
    stays until a device adopts it (adopt nulls the access and refresh
    token), the account's next Google sign-in or link (the hooks null
    all three), or account deletion.
  - `/api/backup/refresh` exchanges a device's token statelessly and
    stores no token; `drive_grant` keeps only its SHA-256.
- **A changed `BETTER_AUTH_SECRET` fails safe.** A stored token that no
  longer decrypts reads as absent (`decryptStoredToken` → null): adopt
  answers 404, as for no token, and deletion skips it. Nothing crashes
  and nothing is nulled. Rotating through Better Auth's versioned
  secrets keeps old values readable; replacing the secret outright
  strands any token not yet adopted, so that device reconnects.
- **The daily cron counts plaintext tokens** (`plaintextTokenRows`) and
  mails the count, never a row, to `OPS_ALERT_EMAIL` if any is found.
- **A token is exchanged only for the account that adopted it.** Adoption
  records the token's SHA-256 with the account (`drive_grant`); the
  refresh route refuses any other account with `401 revoked` /
  `unbound_grant`, without asking Google, so a token from elsewhere
  can't borrow the server's client secret. Deleting the account empties
  the row's account (`on delete set null`) instead of removing the row:
  a row with no account is never exchanged, where a missing row could be
  claimed. Only the hash rests, with no account once deleted. Tokens
  adopted before bindings existed are claimed by the first account that
  exchanges them, until `CLAIM_UNBOUND_UNTIL` (2026-12-31); after that an
  unclaimed device reconnects from Settings. The table creates itself on
  first use (`driveGrantTableReady`), and migration
  `drizzle/0003_drive-grants.sql` runs the same idempotent statements, so
  either may run first. Enforcement: `src/server/drive-grant.ts`,
  `/api/backup/adopt`, `/api/backup/refresh`. Proven by
  `adopt/route.test.ts`, `refresh/route.test.ts`, and a run of both real
  routes against a fresh Postgres 16 holding only migrations 0000-0001.
- **Proven by:** `src/server/oauth-tokens.test.ts` drives a real Better
  Auth through Google's sign-in and link callbacks (token endpoint
  stubbed) and reads the `account` row after each;
  `src/server/token-encryption.test.ts` covers the checked encryption;
  two `security-invariants.test.ts` cases pin `encryptOAuthTokens`, the
  hooks' nulling, the constraint, and the backfill's wiring. Against
  Postgres 16 shaped like production: old plaintext rows encrypted and
  decrypting to the originals, rows the new flow wrote untouched, the
  constraint refusing a plaintext write in each column, adopt still
  handing over an old token, an adopted device still refreshing, a real
  Better Auth sign-in and mid-adoption Drive link succeeding with the
  constraint in place, a rotated secret answering 404, and the cron
  counting 1 before and 0 after.
- **Do not encrypt these files.** Enforcement: `src/lib/backup-client.ts`,
  `src/lib/drive-client.ts`. Asserts it: privacy `#google-drive-backup`
  (including "our server stores none of your Drive credentials" after
  the device collects the grant).
- **A failed delivery reports one line, no entry content:** its source and
  Google's error code and message, or for a failure on the device itself,
  the error's name and message (`failureLine` in `backup-client.ts` →
  `/api/backup/failed` → `backup_status.last_error`, 500 characters at
  most). `classifyBackupError` reads it back into a cause that Settings and
  the watchdog email print; the raw message is shown only for a cause
  Snippets can't name any closer ("Google refused" or "this device"). `/api/backup/refresh` returns Google's
  token-endpoint error code with its 502/401, never a token.

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
- **Sign-in codes rest as a keyed hash.** The email-code plugin stores
  an HMAC-SHA-256 of the code under `BETTER_AUTH_SECRET` (`storeOTP` in
  `src/server/auth.ts`), never the code. A plain hash would not do: six
  digits have a million values. Pinned by the "sign-in codes rest as a
  keyed hash" guard in `src/lib/security-invariants.test.ts`.
- **Abuse counters.** The voice routes' budget stores, per network and
  bucket, a 22-character HMAC of the IPv4 address or the IPv6 /64 prefix
  (keyed by `BETTER_AUTH_SECRET`), a window start, and a count; never
  the address. The daily cron
  deletes rows older than a day (`SPEECH_LIMIT_ROW_TTL_MS`). Better
  Auth's own sign-in rate limit is different: its `rate_limit` rows key
  on the raw IP and path (`ip|path`), and Better Auth deletes them once
  their window has passed.

### Leaving
- Erase-all is permanent — there is no in-app undo for it (unlike a single
  delete, which has a short local undo toast AND a Settings recovery list).
  It soft-deletes everywhere (propagates as tombstones), and a delivering
  device empties the Drive backup on its next run. The permanent part is the
  tombstone (id + timestamps, no words), kept forever server-side — that
  permanence, not the payload, is what stops resurrection. On the device, a
  soft-deleted row keeps its words until `purgeOldDeleted` (`PURGE_AFTER_MS`,
  30 days); Settings → "Recently let go" (`listSoftDeleted` +
  `restoreSnippet`) brings one back during that window. The encrypted
  server payload lingers ≤30 days then the cron scrubs it — that server
  window is still only a grace period before destruction (no
  restore-from-server UI). `PURGE_AFTER_MS` (client) and
  `TOMBSTONE_SCRUB_AFTER_MS` (server) are the paired 30-day constants; the
  privacy copy's "within 30 days" must move with them.
  Account deletion removes the account, synced entries + tombstones,
  wrapped keys, and backup record from the server immediately. It asks
  Google to revoke the grant only with a token in hand: the deleting
  device sends the Drive refresh token it holds (Settings' `doDelete` →
  `/api/account/delete`), plus any token still resting on the server
  before adoption. Revoking one token ends the whole grant for this app,
  every device's token included. A device with no Drive token (and no
  server-held one) leaves the grant listed in the user's Google Account;
  the privacy page says so and links the page where they can remove it.
  Device copies and delivered Drive files remain yours. Proven by
  `src/app/api/account/delete/route.test.ts` and
  `tests/e2e/delete_revoke.py`.

### How each claim is proven (run these after touching the area)
- **No plaintext window, end to end, and a hostile server can't rearrange
  a held entry:** `tests/e2e/forced_e2e.py` (real build + real WebCrypto
  vs stub server; sentinel scanned on every wire body; IndexedDB read
  after each hostile row). 33 checks.
- **Server refusal matrix:** `src/app/api/sync/push/route.test.ts`.
- **AAD binding, pull refusals, held-entry rules:** `src/lib/crypto.test.ts`,
  `src/lib/sync-wire.test.ts`.
- **Speech adapters speak the documented protocols:**
  `tests/e2e/speech_adapters.py` (14 checks).
- **Voice routes refuse other sites and bursts, and run for the app:**
  `src/server/speech-guard.test.ts` (route-level: cross-site 403, burst
  429, oversized 413 without reading the body, TTL cap) and
  `tests/e2e/speech_routes.py` (the real build in a real browser, the
  real routes against a stub provider: the page's own mint and upload
  succeed, a cross-site page's fetch and a burst are refused). The
  Postgres count was proven against a real Postgres 16 when it landed:
  table created on first use, 32 sequential hits gave 30 passes then
  429s, 50 parallel hits counted exactly 50, an ended window reset to 1,
  and no row held the address.
- **Copy stays in the STE register:** `pnpm check:copy`.
- **No undeclared data destination; CSP == code egress; deleted plaintext
  paths stay deleted:** `src/lib/security-invariants.test.ts` (rides
  `pnpm test`).
- **CSP has zero runtime violations:** the sweep in the commit that added
  it (re-run a page/theme/capture pass after any `connect-src` change).

---

## Known gaps (as of 2026-11-11; do not describe as done)

- **Encryption was optional before 2026-07-23.** Entries an account
  synced without it rested on the server unencrypted. Since then the
  server refuses an unencrypted write (`409 encryption_required`), each
  device re-encrypted such entries on its next sync (`needsReseal`), and
  since 2026-11-11 a device also refuses an unencrypted row on pull. The
  privacy page's unqualified "We cannot read your entries" shipped on
  2026-07-24, after those entries were re-encrypted.
- **A payload-less deletion carries no proof.** The server can mark any
  entry deleted; a device that holds it keeps the words for 30 days
  (see "What can the server do to a sealed entry?"). Proving a deletion
  would need a proof the cron leaves in place when it clears a deleted
  entry's words. Not built.
- **A device with no copy trusts the server about which entries exist.**
  A new device can't tell an omitted entry, or an older version, from
  the current book. Closing that needs a signed index of the whole book.
  Not built.
- **Drive tokens adopted before the binding shipped are bound on first
  use.** Until 2026-12-31 the first signed-in account to exchange an
  unbound token claims it (`CLAIM_UNBOUND_UNTIL`); an active device
  claims its own on its next delivery.
- **Revoking the Google grant needs a token.** Account deletion from a
  device with no Drive token leaves the grant listed in the reader's
  Google Account. The privacy page says so and links the page that
  removes it.
- **Speech providers follow the deployment's keys.** The privacy page
  names only the providers whose API keys are set
  (`activeSpeechProviders()`), so it stays truthful as keys change.
- **Deferred by decision:** on-device transcription (BACKLOG #16), the
  ciphertext self-viewer (BACKLOG #15), and open-sourcing (BACKLOG #17).

---

## Change log

Newest first. One entry per privacy/security-relevant change; cite the
commit and note which user-facing surfaces it moved.

### 2026-11-12 — the voice budget counts an IPv6 /64 as one caller
`speechGuard` keyed its budget by the full address. An IPv6 caller
usually holds a whole /64, so a script could rotate addresses and get a
fresh budget for each one. The guard now hashes the /64 prefix of an
IPv6 address, and the IPv4 address inside an IPv4-mapped one. IPv4
budgets are unchanged. Proven by two cases in
`src/server/speech-guard.test.ts` (the old guard fails both) and the
IPv6 leg of `tests/e2e/speech_routes.py`. No user-facing copy moved.
Surfaces: the "Who can spend the voice providers' credit" and "Data we
collect" rows above.

### 2026-11-12 — the README states the Drive-permission lifetime
The README's sync and backup section said the server keeps no Drive
tokens. It now matches the privacy page: the server keeps the Drive
permission Google grants, encrypted, only until the device collects
it. No behavior change. Surfaces: README "Accounts, sync, and Drive
backup".

### 2026-11-12 — the privacy page states the Drive-permission lifetime in one sentence
The Drive paragraph now says the server keeps the Drive permission,
encrypted, only until a device collects it. That one sentence covers
both the Drive link and a token left by a Google sign-in before
2026-11-11, so the separate exception for those tokens is gone. The
encryption deep dive also drops its note on entries saved before
2026-07-23. This file's rows keep both details. No behavior change.
Surfaces: privacy `#google-drive-backup` and the encryption deep dive.

### 2026-11-11 — a Drive token is exchanged only for the account that adopted it
`/api/backup/refresh` checked only that some session existed, then
attached the server's Google client secret to whatever refresh token it
received. Any signed-in account could use it to turn a Drive refresh
token from anywhere into an access token. Adoption now records the
token's SHA-256 with the account (`drive_grant`), and the refresh route
exchanges a token only for that account. Account deletion keeps the
row with no account, so a deleted account's tokens can never be
claimed. Tokens adopted earlier are claimed on first use until
2026-12-31. A refused token reads to the device as revoked
(`unbound_grant`), so Settings offers Reconnect. The table creates
itself on first use, like `speech_rate_limit`, so the deploy needs no
manual migration; migration 0003 is idempotent. Run against a fresh
Postgres holding only migrations 0000-0001, the previous version of
this change failed 5 of 7 checks with `relation "drive_grant" does not
exist`; this one passes all 7. Surfaces: the "Google Drive backup" row
above.

### 2026-11-11 — "Known gaps" rewritten as a dated note
The section said both that the short privacy page was not live and that
its gate was met, though the page has been live since 2026-07-24. It
also carried a production database query result and the database's
history-retention setting. It now lists, neutrally and dated, what a
reader needs: the pre-2026-07-23 history, the limits this file's rows
describe, and the open and deferred items. No code change.

### 2026-11-11 — a per-account storage ceiling on sync
The push route took 200 changes of up to 64 KB each per request with
no per-account limit, so one account could fill the 512 MB database and
stop every writer's sync. It now refuses, with `507 quota_exceeded`, a
push that would grow an account past 50,000 rows or 50 MB of encrypted
entries, and never refuses one that shrinks it. Capture is unaffected:
entries stay on the device. Proven by `src/server/sync-quota.test.ts`
and the quota cases in `push/route.test.ts` (the old route fails them).
Surfaces: the "How much one account can store" row above.

### 2026-11-11 — account deletion revokes the grant the deleting device holds
This file and the privacy page said account deletion revokes the Drive
grant. The route revoked only tokens the server held, and after a
device adopts its grant the server holds none, so in the usual case
nothing was revoked. Now the deleting device sends its Drive refresh
token with the request and the route revokes it before the delete;
the device then forgets its Drive tokens. The privacy page states the
condition and links the Google Account page where the reader can remove
the access themselves. Proven by `src/app/api/account/delete/route.test.ts`
(the old route fails it) and `tests/e2e/delete_revoke.py`, which holds
the real "Hold to delete" control. Surfaces: privacy `#leaving`, the
"Leaving" row above.

### 2026-11-11 — a Google sign-in no longer stores a Drive-capable token
This file said the server holds no Drive tokens, and the privacy page
said it keeps none of your Drive credentials. But Better Auth's default
`updateAccountOnSignIn` wrote each Google sign-in's tokens to the
`account` row, in plaintext, and its Google provider always sends
`include_granted_scopes=true`: after a Drive grant, a sign-in's refresh
token opens Drive too. Now the account hooks (`accountTokenHooks`, in
`src/server/oauth-tokens.ts`) null every token write except the Drive
link's, and `encryptOAuthTokens` encrypts the grant while it waits for
adoption; `/api/backup/adopt` decrypts it (`readStoredToken`), and a
token stored before this change still reads as written. A later Google
sign-in also clears any token an earlier sign-in left. Proven by
`src/server/oauth-tokens.test.ts`: under the old config a sign-in after
the grant leaves `1//refresh-3` in plaintext; now it leaves null.
Surfaces: privacy `#google-drive-backup`, the "Google Drive backup" row
above, DESIGN.md.

### 2026-11-12 — every Google token at rest is encrypted, and the database enforces it
Google sign-ins before 2026-11-11 left their access, refresh, and ID
tokens in plaintext in the `account` table. They were not deleted,
because two paths still read them: adoption can hand a leftover refresh
token to a device with none, and account deletion revokes it at Google.
`encryptLegacyTokens` (`src/server/token-encryption.ts`) encrypts each
one in place with Better Auth's own cipher, writes it only after the
ciphertext decrypts to exactly the original, and then adds the CHECK
constraint `account_tokens_encrypted`, which refuses any plaintext token
from then on. It runs once per instance before the first session lookup
and logs counts only. The account hooks now also null the ID token,
which Better Auth stores unencrypted and Snippets never reads. A token
that no longer decrypts reads as absent. The daily cron counts any
plaintext token and mails the count to the owner. Surfaces: privacy
`#google-drive-backup`, the "Google Drive backup" row above.

### 2026-11-11 — a hostile server can no longer rearrange the entries a device holds
A review found that the pull path trusted the server further than the
privacy page said. `fromWireRow` stored a plaintext (format 1) row as
it came, so a server could plant a readable entry; it turned any
payload-less row into a deletion that erased the device's copy of the
words; and it opened AAD-less format-2 envelopes on any entry, so a
server could move old content onto another entry. AAD also never
covered a plain resend: an older envelope under its own clocks still
opened, and a clean device row took it, so a server could roll an entry
back or bring a deleted one back. The page's "a moved, rolled-back, or
resurrected entry fails to open" was true only of an envelope whose
clocks were edited. Now `fromWireRow` refuses rows no client writes,
`adoptServerRow` refuses older copies and format-2 envelopes on held
entries, and a payload-less deletion keeps the words for 30 days. The
push route refuses format 2, so every row written from now on is bound.
Nothing legitimate is stranded: the server has refused format-1 pushes
since 2026-07-23, the short privacy page shipped only after the July
re-encryption gate (BACKLOG #14) passed, and format-2 rows still open on
a device that doesn't hold them. Proven by the new `sync-wire.test.ts`
cases and five new legs in `tests/e2e/forced_e2e.py`: the unchanged
build fails 9 of its checks, this one passes all 33. Surfaces: privacy
`#how-the-encryption-works`, the "Can we read your entries?" and "What
can the server do to a sealed entry?" rows above.

### 2026-11-11 — voice routes gated; self-tests deleted; codes hashed; KDF floor
An independent review found five routes that spend the owner's speech
credit with no gate: any site or script could mint provider tokens or
proxy 25 MB uploads, and two self-test routes streamed audio on the
ElevenLabs and Deepgram accounts for anyone who added `?spend=yes`. The
self-tests are deleted. The token routes and `/api/transcribe` now run
`speechGuard`: same-origin only, a per-IP fixed-window budget counted in
Postgres under a keyed hash of the address, token lifetimes clamped to
60–600 s, and an oversized declared upload refused before it is read.
Capture without an account still works. Sign-in codes now rest as an
HMAC instead of plain text; a code issued before the deploy stops
verifying, so a reader mid-sign-in at that moment requests a new one.
`/api/keys` refuses a new envelope weaker than the client's own PBKDF2
rounds. The cron compares its secret in constant time. No user-facing
copy moved. Surfaces: the "Who can spend the voice providers' credit"
and "Data we collect" rows, the keys row above.

### 2026-10-22 — device-side backup errors no longer blamed on Google
An independent review found that any exception that wasn't a Google
answer was reported as "Google Drive refused the copy", and a plain
TypeError as a network failure. Network failures are now typed at the
fetch (`NetworkError`), and everything else is the "device" cause, with
the error's name and message. The failure line stays content-free.
Surfaces: Settings backup section, `copy.settings.backup.failures.device`,
`copy.backupEmail.detail`, the "Google Drive backup" row above.

### 2026-10-21 — backup failures name their cause
The failure line a device reports now carries Google's own error code
(`DriveError`, `RefreshError`), and the status route returns the cause
`classifyBackupError` reads from it. Settings → Backup prints that cause
and its fix; the watchdog email does the same and counts days instead of
printing a UTC date. Still content-free. A 401 for an expired Snippets
session no longer deletes the device's Drive token; only Google's
`invalid_grant` does. Surfaces: Settings backup section,
`copy.settings.backup.failures`, `copy.backupEmail`, the "Google Drive
backup" row above.

### 2026-09-21 — soft-deleted entries recover from Settings for 30 days
A single delete still raises the short undo toast. Soft-deleted rows keep
their words on this device until `purgeOldDeleted` (30 days); Settings →
"Recently let go" (`listSoftDeleted` + `restoreSnippet`) now lists them
and brings one back. The server payload scrub window stays a grace period
only (no restore-from-server UI). Surfaces: Settings data section,
`SECURITY-STATE` Leaving bullet, `copy.settings.data.recentlyLetGo*`.

### 2026-08-18 — the format-3 re-seal rule now rides every server-row adoption
Legacy rows (plaintext format 1, AAD-less format 2) converge to format 3
through one rule: a pulled server row still in an older format stores
dirty with a fresh clock, so its own next push re-seals it. That rule
lived only on the pull applier's clean branch. Two other paths adopt
server rows and skipped it: the pull applier's contested branch (a dirty
local row that loses the merge) and the push path's superseded adoption.
A row adopted there rested clean, and if no later pull re-delivered it,
its plaintext copy stayed on the server. Analysis while staging the
harness narrowed the live window: the cursor protocol re-delivers any
row a device has not pulled yet, and the clean branch then rescues it —
so stranding needed an import (Restore from JSON stamps `_dirty` while
keeping old clocks) landing between one cycle's push and pull phases.
Narrow, but the rule now rides the row, not the branch:
`needsReseal(row)` lives in `src/lib/sync-wire.ts` beside the format
constants, both `sync.ts` adoption paths map through it, and the pull
loop is one decision + one apply so no future branch can miss it.
Pinned by the `needsReseal` cases in `src/lib/sync-wire.test.ts`; the
stub server in `tests/e2e/forced_e2e.py` now merges by LWW like the
real one and a contested-legacy leg proves end-to-end convergence
(25 checks). This closes the convergence prerequisite BACKLOG item 14
names. Found by the 2026-08 codebase audit.

### 2026-08-18 — a post-commit failure inside enroll() could destroy the recovery code
`/api/keys` is write-once with no DELETE, so its PUT is the point of no
return — yet three steps still ran after it inside `enroll`
(`src/lib/e2e.ts`): unwrap the local key, store it in Dexie meta, and
sweep the book for re-encryption. Any of them throwing (or the PUT's
response being lost after the server committed) fell into the flow's
one catch, so the code screen never rendered: the account was sealed
forever and the once-only recovery code no longer existed anywhere.
Retrying hit the 409 and showed the same generic failure. Now `enroll`
returns `{recoveryCode, device}` once the PUT lands — the post-commit
steps are best-effort, a failed key install reports
`device: "keyPending"` and resolves through the ordinary locked state,
and the 409 is a distinct `AlreadyEnrolledError` with truthful copy
("already encrypted — unlock with your passphrase"). `EnrollFlow`'s
`onEnrolled` split into `onSealed` (committed; nothing may navigate
away from the code) and `onKeyInstalled` (this device holds the key),
because its two call sites meant different things by it. The failure
cases are pinned in `src/lib/e2e.test.ts`, including "a non-ok PUT
yields no code" — the inverse hazard. Found by the 2026-08 codebase
audit.

### 2026-08-18 — two Deepgram callers opened the socket without the training opt-out
The app's take has sent `mip_opt_out=true` since 2026-07-23, but two other
callers built the same `/v1/listen` URL without it:
`src/app/api/deepgram-selftest/route.ts` and `scripts/deepgram-live-test.mjs`.
The selftest is reachable on the deployment (`?spend=yes`), so real speech
could go to Deepgram under the model-improvement default — the one thing
the privacy page says never happens — and, because that route exists to
reproduce the browser's wire exactly, it also returned a confident pass for
a socket the app never opens. The flag now rides all three callers, and the
rule is mechanized per-CALLER rather than per-remembered-file: the new guard
in `src/lib/security-invariants.test.ts` collects every file that constructs
a `/v1/listen` URL (sweeping `src/` and, explicitly, the `scripts/` sibling
its `.ts`-only walker cannot see) and fails if any lacks the flag. Verified
by reverting one caller and watching the guard fail. No user-facing copy
moved: the privacy page's claim was already the intended architecture — this
makes it true of every caller, and testable. Found by the 2026-08 codebase
audit.

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
  law 8, DESIGN.md "Privacy is architecture", BACKLOG #14–17, and an
  open-sourcing brief. — `2b3f811`
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
