import { describe, expect, it, vi } from "vitest";

/**
 * Adoption hands the device its Drive refresh token, binds the token's
 * hash to the adopting account, and forgets the token. Database and
 * session mocked; the writes are recorded in order.
 */
const log = vi.hoisted(() => ({ writes: [] as unknown[] }));

vi.mock("@/server/db", () => {
  const tx = {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoNothing: async () => void log.writes.push({ bind: v }),
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({ where: async () => void log.writes.push({ account: v }) }),
    }),
  };
  return {
    serverDb: {
      execute: async () => {},
      select: () => ({
        from: () => ({
          where: async () => [{ id: "acc-1", refreshToken: "stored", accessToken: null }],
        }),
      }),
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
    schema: { account: {}, driveGrant: {} },
  };
});
vi.mock("@/server/auth", () => ({
  auth: {},
  getSession: async () => ({ user: { id: "user-1" } }),
  readStoredToken: async () => "1//adopted-refresh-token",
}));

import { POST } from "./route";
import { hashRefreshToken } from "@/server/drive-grant";

describe("adopt route", () => {
  it("binds the token's hash to the account, then forgets the token", async () => {
    const res = await POST(new Request("http://test/api/backup/adopt", { method: "POST" }));
    expect(await res.json()).toEqual({ refreshToken: "1//adopted-refresh-token" });
    expect(log.writes).toEqual([
      { bind: { tokenHash: hashRefreshToken("1//adopted-refresh-token"), userId: "user-1" } },
      { account: { refreshToken: null, accessToken: null } },
    ]);
  });
});
