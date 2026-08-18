"use client";

/**
 * End-to-end encryption state on this device. The account either has
 * wrapped keys on the server (enrolled) or not; this device either
 * holds the unwrapped book key (unlocked) or not. Enrollment and
 * unlocking both happen here; the sync engine only ever asks
 * `getBookKey()` and treats its absence on an enrolled account as the
 * locked state — sync pauses loudly, capture never does.
 */
import { getMeta, setMeta, deleteMeta, reencryptSweep } from "@/lib/db";
import {
  generateBookKey,
  generateRecoveryCode,
  unwrapBookKey,
  wrapBookKey,
  type WrappedKey,
} from "@/lib/crypto";

const KEY_META = "e2e:bookKey";

/** null = not known yet; the sync engine refreshes it each cycle */
let enrolledCache: boolean | null = null;

export function e2eEnrolledCached(): boolean | null {
  return enrolledCache;
}

/**
 * Ask the server whether this account holds wrapped keys. Tri-state on
 * purpose: a definite yes/no, or `"unknown"` when the server can't be
 * reached or answers with an error we can't interpret. The sync engine
 * must treat `"unknown"` as "do not assume plaintext" — never as a
 * licence to downgrade a sealed book. Only a clean 404 means "not
 * enrolled"; anything short of a clean 404/200 stays unknown.
 */
export async function refreshEnrollment(): Promise<boolean | "unknown"> {
  try {
    const response = await fetch("/api/keys");
    if (response.status === 404) return (enrolledCache = false);
    if (response.ok) return (enrolledCache = true);
    // On an error, only a cached TRUE may stand in — worst case we lock
    // unnecessarily, which is safe. A cached FALSE must not: the account
    // could have been sealed elsewhere since, and acting on the stale
    // "false" would push plaintext into a sealed book.
    return enrolledCache === true ? true : "unknown";
  } catch {
    return enrolledCache === true ? true : "unknown";
  }
}

export async function getBookKey(): Promise<CryptoKey | undefined> {
  return getMeta<CryptoKey>(KEY_META);
}

/** The account already holds wrapped keys — retrying enrollment can never
    succeed. Its own class so the surface can say something truthful ("unlock
    with your passphrase") instead of a generic failure. */
export class AlreadyEnrolledError extends Error {
  constructor() {
    super("already enrolled");
    this.name = "AlreadyEnrolledError";
  }
}

export interface EnrollResult {
  /** shown ONCE; never reconstructable */
  recoveryCode: string;
  /** whether this device now holds the unwrapped book key. "keyPending"
      means the account is sealed but the local install step failed — the
      unlock form takes the passphrase the writer just chose. */
  device: "unlocked" | "keyPending";
}

/**
 * Turn on end-to-end encryption for this account. Generates the book
 * key, seals it under the passphrase and a fresh recovery code,
 * stores only the sealed envelopes server-side, keeps the
 * non-extractable key on this device, and sweeps the whole book for
 * re-encrypted upload.
 *
 * The `/api/keys` PUT is the point of no return: it is write-once with
 * no DELETE, so once it lands the account is sealed whether or not this
 * function returns. Past that line, enroll must hand back the recovery
 * code no matter what else fails — a post-commit throw used to eat the
 * one chance to show it, leaving the account sealed forever with the
 * code destroyed. Every step after the commit is therefore best-effort
 * and self-healing: a failed key install lands in the ordinary locked
 * state (the unlock form takes the passphrase just typed), and a failed
 * sweep re-runs on the next sync cycle (maybeAadSweep).
 */
export async function enroll(passphrase: string): Promise<EnrollResult> {
  const bookKey = await generateBookKey();
  const recoveryCode = generateRecoveryCode();
  const [passphraseKey, recoveryKey] = await Promise.all([
    wrapBookKey(bookKey, passphrase, "passphrase"),
    wrapBookKey(bookKey, recoveryCode, "recovery"),
  ]);

  const response = await fetch("/api/keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphraseKey, recoveryKey }),
  });
  if (response.status === 409) throw new AlreadyEnrolledError();
  if (!response.ok) throw new Error(`keys ${response.status}`);
  // ── the account is sealed from here on ──
  enrolledCache = true;

  let device: EnrollResult["device"] = "unlocked";
  try {
    // day-to-day copy is non-extractable; re-derive it via unwrap
    const local = await unwrapBookKey(passphraseKey, passphrase, "passphrase");
    await setMeta(KEY_META, local);
  } catch {
    device = "keyPending";
  }
  try {
    await reencryptSweep();
  } catch {
    // the once-per-device sweep flag was not set, so maybeAadSweep
    // (sync.ts) runs the sweep on the next cycle
  }
  return { recoveryCode, device };
}

/** Throws on a wrong secret. */
export async function unlock(
  secret: string,
  kind: "passphrase" | "recovery",
): Promise<void> {
  const response = await fetch("/api/keys");
  if (!response.ok) throw new Error(`keys ${response.status}`);
  const data = (await response.json()) as {
    passphraseKey: WrappedKey;
    recoveryKey: WrappedKey;
  };
  const wrapped = kind === "passphrase" ? data.passphraseKey : data.recoveryKey;
  const key = await unwrapBookKey(wrapped, secret, kind);
  await setMeta(KEY_META, key);
  enrolledCache = true;
}

/** Drop the on-device key and mark the account not-enrolled locally. */
export async function clearLocalKey(): Promise<void> {
  await deleteMeta(KEY_META);
  enrolledCache = false;
}

// `deleteServerKeys` used to live here. Removed with the ability to turn
// encryption off: enrollment is one-way (account deletion is the only
// path that removes the wrapped keys, by server-side cascade), which is
// also what lets the keys route stay write-once.

/** The downloadable recovery file, in plain text. */
export function recoveryKitText(recoveryCode: string, email: string): string {
  return [
    "Snippets — recovery code",
    "",
    `Account: ${email}`,
    `Recovery code: ${recoveryCode}`,
    "",
    "This code unlocks your end-to-end encrypted entries if you",
    "forget your passphrase. Keep it somewhere safe and private —",
    "it is shown exactly once and cannot be recovered or reset.",
    "",
    "Your Google Drive backups remain readable without any code.",
  ].join("\n");
}
