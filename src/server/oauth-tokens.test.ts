import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { DRIVE_SCOPE } from "@/lib/backup-shared";
import {
  accountTokenHooks,
  decryptStoredToken,
  tokenOverride,
} from "./oauth-tokens";

/**
 * SECURITY-STATE says the server holds no Drive token at rest beyond the
 * moment between the Drive consent and a device adopting it. These cases
 * drive a real Better Auth (memory adapter) through Google's real
 * sign-in and link callbacks, with only Google's token endpoint stubbed,
 * and read the `account` row each one leaves behind. Google honours
 * `include_granted_scopes=true` (Better Auth always sends it), so the
 * stub returns every scope granted so far, as Google does.
 */

const BASE = "http://localhost:3000";
const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const SIGN_IN_SCOPES = ["openid", "email", "profile"];

let granted: string[] = [];
let issued = 0;

function idToken(): string {
  const part = (o: Record<string, string | number | boolean>) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [
    part({ alg: "RS256", kid: "test" }),
    part({
      iss: "https://accounts.google.com",
      aud: "client-id",
      sub: "google-sub-1",
      email: "writer@example.com",
      email_verified: true,
      name: "Test Writer",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "signature",
  ].join(".");
}

function makeAuth() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: BASE,
    secret: SECRET,
    database: memoryAdapter(db),
    socialProviders: {
      google: {
        clientId: "client-id",
        clientSecret: "client-secret",
        accessType: "offline",
        prompt: "select_account consent",
      },
    },
    account: { encryptOAuthTokens: true },
    databaseHooks: { account: accountTokenHooks },
    rateLimit: { enabled: false },
  });
  return { auth, db };
}

type Auth = ReturnType<typeof makeAuth>["auth"];

function cookieHeader(res: Response, jar: Map<string, string>): string {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Start an OAuth round trip at `path`, then answer Google's callback. */
async function oauthRoundTrip(
  auth: Auth,
  jar: Map<string, string>,
  path: "sign-in/social" | "link-social",
  scopes: string[],
) {
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        cookie: cookieHeader(new Response(), jar),
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        ...(path === "link-social" ? { scopes } : {}),
      }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  granted = [...new Set([...granted, ...SIGN_IN_SCOPES, ...scopes])];
  const callback = await auth.handler(
    new Request(`${BASE}/api/auth/callback/google?code=c${issued}&state=${state}`, {
      headers: { cookie: cookieHeader(start, jar) },
    }),
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).not.toContain("error");
  cookieHeader(callback, jar);
}

beforeEach(() => {
  granted = [];
  issued = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://oauth2.googleapis.com/token"))
        throw new Error(`unexpected fetch ${url}`);
      issued += 1;
      return Response.json({
        access_token: `ya29.access-${issued}`,
        refresh_token: `1//refresh-${issued}`,
        id_token: idToken(),
        scope: granted.join(" "),
        expires_in: 3599,
        token_type: "Bearer",
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Google tokens at rest in the account table", () => {
  it("a sign-in stores no token", async () => {
    const { auth, db } = makeAuth();
    await oauthRoundTrip(auth, new Map(), "sign-in/social", []);
    expect(db.account).toHaveLength(1);
    expect(db.account[0].refreshToken).toBeNull();
    expect(db.account[0].accessToken).toBeNull();
  });

  it("the Drive link stores its refresh token, encrypted", async () => {
    const { auth, db } = makeAuth();
    const jar = new Map<string, string>();
    await oauthRoundTrip(auth, jar, "sign-in/social", []);
    await oauthRoundTrip(auth, jar, "link-social", [DRIVE_SCOPE]);
    const stored = db.account[0].refreshToken as string;
    expect(stored).not.toContain("refresh-");
    expect(await symmetricDecrypt({ key: SECRET, data: stored })).toBe(
      `1//refresh-${issued}`,
    );
  });

  it("a sign-in AFTER the Drive grant stores no token, though Google's covers Drive", async () => {
    const { auth, db } = makeAuth();
    const jar = new Map<string, string>();
    await oauthRoundTrip(auth, jar, "sign-in/social", []);
    await oauthRoundTrip(auth, jar, "link-social", [DRIVE_SCOPE]);
    await oauthRoundTrip(auth, new Map(), "sign-in/social", []);
    expect(String(db.account[0].scope)).toContain(DRIVE_SCOPE);
    expect(db.account[0].refreshToken).toBeNull();
    expect(db.account[0].accessToken).toBeNull();
  });

  it("a link with Drive unticked stores no token", async () => {
    const { auth, db } = makeAuth();
    const jar = new Map<string, string>();
    await oauthRoundTrip(auth, jar, "sign-in/social", []);
    await oauthRoundTrip(auth, jar, "link-social", []);
    expect(db.account[0].refreshToken).toBeNull();
  });
});

describe("tokenOverride", () => {
  it("leaves a write that carries no token alone", () => {
    expect(tokenOverride({ scope: DRIVE_SCOPE }, false)).toEqual({});
  });
  it("reads scopes split by commas or spaces", () => {
    expect(
      tokenOverride({ refreshToken: "t", scope: `openid ${DRIVE_SCOPE}` }, true),
    ).toEqual({});
    expect(
      tokenOverride({ refreshToken: "t", scope: `openid,${DRIVE_SCOPE}` }, true),
    ).toEqual({});
  });
});

describe("decryptStoredToken — what /api/backup/adopt hands the device", () => {
  it("opens a token Better Auth encrypted", async () => {
    const stored = await symmetricEncrypt({ key: SECRET, data: "1//refresh-x" });
    expect(await decryptStoredToken(stored, SECRET)).toBe("1//refresh-x");
  });
  it("returns a token stored before encryption as written", async () => {
    expect(await decryptStoredToken("1//0gPlainLegacyToken", SECRET)).toBe(
      "1//0gPlainLegacyToken",
    );
  });
});
