/**
 * Better Auth, wired to the Drizzle/Neon handle. Null when the server
 * isn't configured for accounts (no DATABASE_URL or secret) — the
 * /api/auth route then answers 503 and the client keeps everything
 * on the device, which is the app's whole constitution anyway.
 *
 * Sign-in methods: Google OAuth and a passwordless email code. No
 * passwords anywhere. Google is configured `accessType: "offline"` +
 * `prompt: "select_account consent"` so a refresh token is granted on
 * every consent — the Drive backup (a later, separate `linkSocial`
 * grant with the drive.file scope) depends on holding one.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { serverDb, schema } from "./db";
import { sendSignInCode } from "./email";

function buildAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!serverDb || !secret) return null;

  const googleConfigured =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    appName: "Snippets",
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(serverDb, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            accessType: "offline",
            prompt: "select_account consent",
          },
        }
      : undefined,
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        // The verification row holds an HMAC of the code, keyed by the
        // auth secret. A plain hash would not help: a 6-digit code has a
        // million values, so a leaked table would reverse in a second.
        storeOTP: {
          hash: async (otp) =>
            createHmac("sha256", secret).update(otp).digest("base64url"),
        },
        async sendVerificationOTP({ email, otp }) {
          await sendSignInCode(email, otp);
        },
      }),
    ],
    // serverless functions don't share memory; the database is the only
    // rate-limit store that actually counts
    rateLimit: { enabled: true, storage: "database", modelName: "rateLimit" },
    session: {
      // a signed cookie snapshot answers most getSession calls without
      // a Neon round-trip; revocation still lands within five minutes
      cookieCache: { enabled: true, maxAge: 300 },
    },
  });
}

export const auth = buildAuth();

/** Session lookup for API routes; null when signed out or unconfigured. */
export async function getSession(headers: Headers) {
  if (!auth) return null;
  return auth.api.getSession({ headers });
}
