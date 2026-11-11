import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The privacy page says deleting the account from a device that backs
 * up to Drive asks Google to revoke the grant. After adoption the server
 * holds no Drive token, so the device's own token is the one revoked.
 * Database and session mocked; Google's revoke endpoint stubbed.
 */
const calls = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("@/server/db", () => ({
  serverDb: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    delete: () => ({
      where: async () => {
        calls.log.push("delete user");
      },
    }),
  },
  schema: { account: {}, user: {} },
}));
vi.mock("@/server/auth", () => ({
  auth: { api: { signOut: async () => new Response(null) } },
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
  readStoredToken: async (stored: string) => stored,
}));

import { POST } from "./route";

function del(body?: { driveToken?: string }): Request {
  return new Request("http://test/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  calls.log = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.log.push(`${url} ${String(init.body)}`);
      return new Response(null, { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("account deletion — the Drive grant", () => {
  it("revokes the token the deleting device holds, before the delete", async () => {
    const res = await POST(del({ driveToken: "1//device-refresh-token" }));
    expect(res.status).toBe(200);
    expect(calls.log).toEqual([
      "https://oauth2.googleapis.com/revoke token=1%2F%2Fdevice-refresh-token",
      "delete user",
    ]);
  });

  it("still deletes when the device holds no token (or is an older client)", async () => {
    const res = await POST(del());
    expect(res.status).toBe(200);
    expect(calls.log).toEqual(["delete user"]);
  });
});
