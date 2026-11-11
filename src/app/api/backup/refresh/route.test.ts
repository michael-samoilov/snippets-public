import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The token exchange tells the device WHY Google refused, because the
 * device's failure line (and with it the cause Settings and the email
 * print) is built from this answer. Session mocked; Google's token
 * endpoint stubbed with its documented error bodies.
 */
vi.mock("@/server/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
// the binding table: the token's hash → the account that adopted it
const grants = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock("@/server/db", () => {
  // each case holds at most one binding, so a lookup returns it
  return {
    serverDb: {
      select: () => ({
        from: () => ({
          where: async () =>
            [...grants.rows].map(([, userId]) => ({ userId })).slice(0, 1),
        }),
      }),
      insert: () => ({
        values: (v: { tokenHash: string; userId: string }) => ({
          onConflictDoNothing: async () => {
            if (!grants.rows.has(v.tokenHash)) grants.rows.set(v.tokenHash, v.userId);
          },
        }),
      }),
    },
    schema: { driveGrant: {} },
  };
});

import { POST } from "./route";
import { getSession } from "@/server/auth";
import { CLAIM_UNBOUND_UNTIL, hashRefreshToken } from "@/server/drive-grant";

const TOKEN_HASH = hashRefreshToken("1//refresh-token-example");

function refresh(): Request {
  return new Request("http://test/api/backup/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "1//refresh-token-example" }),
  });
}

/** The two bodies Google's token endpoint documents: a grant or an error. */
type GoogleTokenBody =
  | { access_token: string; expires_in: number }
  | { error: string; error_description: string };

function google(status: number, body: GoogleTokenBody) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  // the device's token is bound to user-1 unless a case says otherwise
  grants.rows = new Map([[TOKEN_HASH, "user-1"]]);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof getSession>>);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("refresh route — Google's verdict travels back", () => {
  it("invalid_grant → 401 revoked, with Google's code and words", async () => {
    google(400, {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "revoked",
      google: "invalid_grant",
      description: "Token has been expired or revoked.",
    });
  });

  it("invalid_client → 502 that names it (our configuration, not the grant)", async () => {
    google(401, {
      error: "invalid_client",
      error_description: "The OAuth client was not found.",
    });
    const res = await POST(refresh());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "refresh failed",
      google: "invalid_client",
    });
  });

  it("a body-less Google failure still names its HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 500 })),
    );
    const res = await POST(refresh());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ google: "http 500" });
  });

  it("success returns the access token only", async () => {
    google(200, { access_token: "ya29.example", expires_in: 3599 });
    const res = await POST(refresh());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "ya29.example",
      expiresIn: 3599,
    });
  });

  it("an expired Snippets session is a different 401: no `revoked`", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    // the device deletes its Drive token only on error === "revoked"
    expect(await res.json()).toEqual({ error: "signed out" });
  });
});

describe("refresh route — a token is exchanged only for the account it is bound to", () => {
  it("refuses a token bound to another account, without asking Google", async () => {
    grants.rows = new Map([[TOKEN_HASH, "someone-else"]]);
    google(200, { access_token: "ya29.example", expires_in: 3599 });
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "revoked", google: "unbound_grant" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unbound token from before bindings is claimed by its first account", async () => {
    vi.useFakeTimers({ now: CLAIM_UNBOUND_UNTIL - 1, toFake: ["Date"] });
    grants.rows = new Map();
    google(200, { access_token: "ya29.example", expires_in: 3599 });
    const res = await POST(refresh());
    expect(res.status).toBe(200);
    expect(grants.rows.get(TOKEN_HASH)).toBe("user-1");
  });

  it("after the claim window an unbound token is refused", async () => {
    vi.useFakeTimers({ now: CLAIM_UNBOUND_UNTIL, toFake: ["Date"] });
    grants.rows = new Map();
    google(200, { access_token: "ya29.example", expires_in: 3599 });
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
