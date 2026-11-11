import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enrollment refuses a weak envelope. A passphrase envelope below the
 * client's 600,000 PBKDF2 rounds (or a recovery envelope below its
 * 10,000) is a key a stolen database could brute-force, and the route
 * is write-once, so a weak one would stay forever. Session and db
 * mocked; the envelopes come from the real client code.
 */
const inserted: { userId: string }[] = [];
vi.mock("@/server/db", () => ({
  serverDb: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({
      values: async (row: { userId: string }) => {
        inserted.push(row);
      },
    }),
  },
  schema: { userKeys: { userId: "user_id" } },
}));
vi.mock("@/server/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

import { PUT } from "./route";
import { generateBookKey, wrapBookKey, type WrappedKey } from "@/lib/crypto";

function put(passphraseKey: WrappedKey, recoveryKey: WrappedKey): Request {
  return new Request("http://test/api/keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphraseKey, recoveryKey }),
  });
}

let passphrase: WrappedKey;
let recovery: WrappedKey;

beforeEach(async () => {
  inserted.length = 0;
  if (passphrase) return;
  const bookKey = await generateBookKey();
  passphrase = await wrapBookKey(bookKey, "correct horse battery staple", "passphrase");
  recovery = await wrapBookKey(bookKey, "ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2", "recovery");
});

describe("keys PUT — the KDF floor", () => {
  it("stores what the client really produces", async () => {
    const res = await PUT(put(passphrase, recovery));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
  });

  it("refuses a 1-round passphrase envelope", async () => {
    const res = await PUT(put({ ...passphrase, iterations: 1 }, recovery));
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a passphrase envelope one round under 600,000", async () => {
    const res = await PUT(put({ ...passphrase, iterations: 599_999 }, recovery));
    expect(res.status).toBe(400);
  });

  it("refuses a 1-round recovery envelope", async () => {
    const res = await PUT(put(passphrase, { ...recovery, iterations: 1 }));
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });
});
