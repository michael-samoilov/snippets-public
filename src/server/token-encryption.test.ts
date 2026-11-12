import { describe, expect, it } from "vitest";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { planEncryption, type TokenRow } from "./token-encryption";
import { ENCRYPTED_TOKENS_SQL, isEncryptedToken } from "./db/token-format";

/**
 * The one-time encryption of the plaintext Google tokens that sign-ins
 * stored before 2026-11-11. Each write is checked before it is planned;
 * the database half (and the constraint) is proven against Postgres.
 */
const SECRET = "test-secret-0123456789abcdef0123456789abcdef";

const row = (over: Partial<TokenRow>): TokenRow => ({
  id: "acc-1",
  provider_id: "google",
  access_token: null,
  refresh_token: null,
  id_token: null,
  ...over,
});

describe("planEncryption", () => {
  it("encrypts each plaintext Google token so that it decrypts to the original", async () => {
    const { updates, failures } = await planEncryption(
      [row({ access_token: "ya29.a0-old", refresh_token: "1//0g-old", id_token: "eyJh.eyJz.sig" })],
      SECRET,
    );
    expect(failures).toBe(0);
    expect(updates.map((u) => u.column)).toEqual(["access_token", "refresh_token", "id_token"]);
    for (const u of updates) {
      expect(isEncryptedToken(u.to)).toBe(true);
      expect(await symmetricDecrypt({ key: SECRET, data: u.to })).toBe(u.from);
    }
  });

  it("leaves encrypted values, nulls, and other providers alone", async () => {
    const encrypted = await symmetricEncrypt({ key: SECRET, data: "1//0g-new" });
    const { updates } = await planEncryption(
      [
        row({ refresh_token: encrypted }),
        row({ id: "acc-2", provider_id: "credential", access_token: "not-google" }),
      ],
      SECRET,
    );
    expect(updates).toEqual([]);
  });

  it("never plans a write whose ciphertext fails to decrypt to the original", async () => {
    const broken = async () => "00ff";
    const { updates, failures } = await planEncryption(
      [row({ refresh_token: "1//0g-old" })],
      SECRET,
      broken,
    );
    expect(updates).toEqual([]);
    expect(failures).toBe(1);
  });
});

describe("the encrypted-token format", () => {
  it("accepts Better Auth's two formats and refuses Google's raw tokens", () => {
    expect(isEncryptedToken("a1b2c3d4")).toBe(true);
    expect(isEncryptedToken("$ba$1$a1b2c3")).toBe(true);
    for (const raw of ["ya29.a0AfB_byC", "1//0gLegacyRefresh", "eyJhbGciOi.eyJzdWIi.sig", ""])
      expect(isEncryptedToken(raw)).toBe(false);
  });

  it("the SQL check covers all three token columns", () => {
    for (const column of ["access_token", "refresh_token", "id_token"])
      expect(ENCRYPTED_TOKENS_SQL).toContain(`"${column}" is null`);
  });
});
