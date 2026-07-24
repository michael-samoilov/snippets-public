/**
 * The book's cryptography — WebCrypto only, no dependencies, every
 * parameter written into the envelope so future upgrades (a stronger
 * KDF, a new cipher) are a version bump, not a migration.
 *
 * Model: one random 256-bit AES-GCM "book key" per account encrypts
 * every entry payload. The book key itself never travels naked — it
 * is wrapped (encrypted) under keys derived from two things only the
 * writer has: their passphrase, and their recovery code. The server
 * stores only the wrapped envelopes; unwrapping happens on-device,
 * and the unwrapped key is kept non-extractable so even page scripts
 * can't export its bytes.
 *
 * KDF: PBKDF2-SHA256 at 600,000 iterations (OWASP's floor for this
 * construction) — native to WebCrypto everywhere, zero WASM. The
 * envelope's `kdf`/`iterations` fields leave the door open to
 * Argon2id later. The recovery code carries ~123 bits of real entropy
 * (25 uniform picks from a 30-symbol alphabet), so its derivation uses
 * a lighter round count by design.
 */

export interface WrappedKey {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 — the wrapped book key */
  ct: string;
}

export interface EncryptedPayload {
  v: 1;
  /** base64 */
  iv: string;
  /** base64 */
  ct: string;
}

const PASSPHRASE_ITERATIONS = 600_000;
const RECOVERY_ITERATIONS = 10_000; // the code itself carries ~123 bits

// ── small codecs ────────────────────────────────────────────────

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── recovery codes ──────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L/U

/**
 * Draw `n` uniform indices into an alphabet of `range` symbols. A raw
 * byte is uniform over 0..255, but `byte % range` is not when `range`
 * doesn't divide 256 — for our 30-symbol alphabet it favours the first
 * 16 symbols (256 % 30 = 16). Rejection sampling fixes that: discard any
 * byte at or above the largest multiple of `range` (240 for 30) before
 * taking the modulo, so every symbol is equally likely.
 */
function uniformIndices(n: number, range: number): number[] {
  const limit = 256 - (256 % range);
  const out: number[] = [];
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n - out.length))) {
      if (b < limit) out.push(b % range);
    }
  }
  return out;
}

/** e.g. "F7QZM-K2WXA-9RTBH-4NPCV-D8JSE" — ~123 bits over 25 chars */
export function generateRecoveryCode(): string {
  const idx = uniformIndices(25, CODE_ALPHABET.length);
  let code = "";
  for (let i = 0; i < 25; i++) {
    code += CODE_ALPHABET[idx[i]];
    if (i % 5 === 4 && i < 24) code += "-";
  }
  return code;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

// ── key derivation + wrapping ───────────────────────────────────

async function deriveWrappingKey(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function generateBookKey(): Promise<CryptoKey> {
  // extractable so it can be wrapped; the caller re-imports the
  // unwrapped copy non-extractable for day-to-day use
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapBookKey(
  bookKey: CryptoKey,
  secret: string,
  kind: "passphrase" | "recovery",
): Promise<WrappedKey> {
  const iterations =
    kind === "passphrase" ? PASSPHRASE_ITERATIONS : RECOVERY_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveWrappingKey(
    kind === "recovery" ? normalizeRecoveryCode(secret) : secret,
    salt,
    iterations,
  );
  const ct = await crypto.subtle.wrapKey("raw", bookKey, kek, {
    name: "AES-GCM",
    iv: iv as BufferSource,
  });
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

/** Throws on a wrong secret (GCM authentication fails). */
export async function unwrapBookKey(
  wrapped: WrappedKey,
  secret: string,
  kind: "passphrase" | "recovery",
): Promise<CryptoKey> {
  const kek = await deriveWrappingKey(
    kind === "recovery" ? normalizeRecoveryCode(secret) : secret,
    fromB64(wrapped.salt),
    wrapped.iterations,
  );
  // non-extractable: usable for entry crypto, unexportable as bytes
  return crypto.subtle.unwrapKey(
    "raw",
    fromB64(wrapped.ct) as BufferSource,
    kek,
    { name: "AES-GCM", iv: fromB64(wrapped.iv) as BufferSource },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── entry payloads ──────────────────────────────────────────────

/**
 * The additional authenticated data for a sealed entry: the row's
 * identity and clocks, which must travel in the clear (the server
 * merges on them) but must not be *editable* in the clear. Binding
 * them into the cipher as AES-GCM AAD makes decryption fail if a
 * sealed payload is moved onto another row, rolled back to an earlier
 * clock, or has its tombstone flag flipped — a hostile or buggy server
 * can no longer rearrange the book without reading it.
 *
 * A fixed-order pipe string, not JSON: no key-ordering ambiguity, and
 * `payloadFormat` rides inside so a format downgrade also fails loudly.
 */
export function aadForRow(row: {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
  payloadFormat: number;
}): Uint8Array {
  return new TextEncoder().encode(
    `snippets/aad/v1|${row.id}|${row.updatedAt}|${row.deletedAt ?? ""}|${row.payloadFormat}`,
  );
}

export async function encryptJSON(
  key: CryptoKey,
  value: unknown,
  aad?: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      ...(aad ? { additionalData: aad as BufferSource } : {}),
    },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON<T>(
  key: CryptoKey,
  payload: EncryptedPayload,
  aad?: Uint8Array,
): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromB64(payload.iv) as BufferSource,
      ...(aad ? { additionalData: aad as BufferSource } : {}),
    },
    key,
    fromB64(payload.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return p.v === 1 && typeof p.iv === "string" && typeof p.ct === "string";
}
