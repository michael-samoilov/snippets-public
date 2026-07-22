import { describe, expect, it } from "vitest";
import {
  decryptJSON,
  encryptJSON,
  generateBookKey,
  generateRecoveryCode,
  isEncryptedPayload,
  normalizeRecoveryCode,
  unwrapBookKey,
  wrapBookKey,
} from "./crypto";

describe("book key wrap/unwrap", () => {
  it("round-trips under a passphrase", async () => {
    const book = await generateBookKey();
    const wrapped = await wrapBookKey(book, "correct horse battery staple", "passphrase");
    const unwrapped = await unwrapBookKey(wrapped, "correct horse battery staple", "passphrase");
    // prove the unwrapped key decrypts what the original encrypted
    const ct = await encryptJSON(book, { text: "hello" });
    const pt = await decryptJSON<{ text: string }>(unwrapped, ct);
    expect(pt.text).toBe("hello");
    expect(unwrapped.extractable).toBe(false);
  });

  it("rejects a wrong passphrase", async () => {
    const book = await generateBookKey();
    const wrapped = await wrapBookKey(book, "right", "passphrase");
    await expect(unwrapBookKey(wrapped, "wrong", "passphrase")).rejects.toThrow();
  });

  it("round-trips under a recovery code, tolerant of formatting", async () => {
    const book = await generateBookKey();
    const code = generateRecoveryCode();
    const wrapped = await wrapBookKey(book, code, "recovery");
    const sloppy = code.toLowerCase().replace(/-/g, " ");
    const unwrapped = await unwrapBookKey(wrapped, sloppy, "recovery");
    const ct = await encryptJSON(unwrapped, { n: 42 });
    expect((await decryptJSON<{ n: number }>(book, ct)).n).toBe(42);
  });
});

describe("recovery codes", () => {
  it("are 25 chars of the crockford-ish alphabet, grouped by 5", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[01OIL U]/);
  });
  it("normalize strips separators and case", () => {
    expect(normalizeRecoveryCode("ab2c3-de4f5")).toBe("AB2C3DE4F5");
  });
  it("draws across the whole alphabet (rejection sampling maps every symbol)", () => {
    const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    const seen = new Set<string>();
    for (let n = 0; n < 500 && seen.size < ALPHABET.length; n++) {
      for (const ch of generateRecoveryCode().replace(/-/g, "")) seen.add(ch);
    }
    expect([...seen].sort().join("")).toBe([...ALPHABET].sort().join(""));
  });
});

describe("payload encryption", () => {
  it("round-trips an entry payload", async () => {
    const key = await generateBookKey();
    const payload = { text: "the moment worth telling", tags: ["a"], favorite: 0 };
    const ct = await encryptJSON(key, payload);
    expect(isEncryptedPayload(ct)).toBe(true);
    expect(JSON.stringify(ct)).not.toContain("moment");
    expect(await decryptJSON(key, ct)).toEqual(payload);
  });

  it("tampered ciphertext fails closed", async () => {
    const key = await generateBookKey();
    const ct = await encryptJSON(key, { text: "x" });
    const bent = { ...ct, ct: ct.ct.slice(0, -4) + (ct.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(decryptJSON(key, bent)).rejects.toThrow();
  });

  it("unique IVs per encryption", async () => {
    const key = await generateBookKey();
    const a = await encryptJSON(key, { t: 1 });
    const b = await encryptJSON(key, { t: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});
