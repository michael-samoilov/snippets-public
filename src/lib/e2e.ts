"use client";

/**
 * End-to-end encryption state on this device. The account either has
 * wrapped keys on the server (enrolled) or not; this device either
 * holds the unwrapped book key (unlocked) or not. Enrollment and
 * unlocking both happen here; the sync engine only ever asks
 * `getBookKey()` and treats its absence on an enrolled account as the
 * locked state — sync pauses loudly, capture never does.
 */
import { getMeta, setMeta, reencryptSweep } from "@/lib/db";
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

export async function refreshEnrollment(): Promise<boolean> {
  try {
    const response = await fetch("/api/keys");
    if (response.status === 404) return (enrolledCache = false);
    if (!response.ok) return enrolledCache ?? false;
    enrolledCache = true;
    return true;
  } catch {
    return enrolledCache ?? false;
  }
}

export async function getBookKey(): Promise<CryptoKey | undefined> {
  return getMeta<CryptoKey>(KEY_META);
}

/**
 * Turn on end-to-end encryption for this account. Generates the book
 * key, seals it under the passphrase and a fresh recovery code,
 * stores only the sealed envelopes server-side, keeps the
 * non-extractable key on this device, and sweeps the whole book for
 * re-encrypted upload. Returns the recovery code — show it ONCE and
 * offer the kit download; it is never reconstructable.
 */
export async function enroll(passphrase: string): Promise<string> {
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
  if (response.status === 409) throw new Error("already enrolled");
  if (!response.ok) throw new Error(`keys ${response.status}`);

  // day-to-day copy is non-extractable; re-derive it via unwrap
  const local = await unwrapBookKey(passphraseKey, passphrase, "passphrase");
  await setMeta(KEY_META, local);
  enrolledCache = true;

  await reencryptSweep();
  return recoveryCode;
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

/** The downloadable recovery kit, in plain text. */
export function recoveryKitText(recoveryCode: string, email: string): string {
  return [
    "Snippets — recovery kit",
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
