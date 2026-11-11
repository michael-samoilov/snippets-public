/**
 * Which Google tokens Better Auth may write into the `account` table.
 *
 * The server's one use for a Google token is the Drive grant a device
 * adopts (/api/backup/adopt), so a token rests here only when it IS that
 * grant: written by the Drive link flow (`linkSocial`) and carrying the
 * drive.file scope. Every other write of a token is nulled: a sign-in's
 * tokens, and a link the writer unticked Drive on.
 *
 * Why this matters: Better Auth's Google provider sends
 * `include_granted_scopes=true` on every authorization, and Snippets asks
 * for `access_type=offline` with consent, so a Google sign-in after a
 * Drive grant returns a refresh token that opens Drive too. With Better
 * Auth's default `updateAccountOnSignIn`, each such sign-in stored one.
 */
import { getOAuthState } from "better-auth/api";
import { symmetricDecrypt, type SecretConfig } from "better-auth/crypto";
import { DRIVE_SCOPE } from "@/lib/backup-shared";

/** Google returns scopes space-separated; Better Auth joins them with commas. */
export function grantedScopes(scope: string | null | undefined): string[] {
  return (scope ?? "").split(/[\s,]+/).filter(Boolean);
}

type TokenFields = {
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
};

/**
 * The override for an account write: `{}` keeps the tokens as written,
 * otherwise both token columns are nulled. A write that carries no token
 * is left alone. `linking` is true only inside the `linkSocial` callback.
 */
export function tokenOverride(
  write: TokenFields,
  linking: boolean,
): { accessToken?: null; refreshToken?: null } {
  const carriesToken = "accessToken" in write || "refreshToken" in write;
  if (!carriesToken) return {};
  const isDriveGrant =
    linking && grantedScopes(write.scope).includes(DRIVE_SCOPE);
  return isDriveGrant ? {} : { accessToken: null, refreshToken: null };
}

/** True only inside a `linkSocial` callback (its OAuth state names a link). */
async function linking(): Promise<boolean> {
  try {
    return !!(await getOAuthState())?.link;
  } catch {
    // no request state: not a link callback, so no token may rest
    return false;
  }
}

/** Better Auth `databaseHooks.account`: every account write passes here. */
export const accountTokenHooks = {
  create: {
    before: async <T extends TokenFields>(account: T) => ({
      data: { ...account, ...tokenOverride(account, await linking()) },
    }),
  },
  update: {
    before: async <T extends TokenFields>(account: T) => ({
      data: { ...account, ...tokenOverride(account, await linking()) },
    }),
  },
};

/**
 * A Google token as the `account` table holds it, decrypted with Better
 * Auth's own key and envelope test. A token written before
 * `encryptOAuthTokens` was on is plain and reads back as written: Google
 * tokens carry `.` or `/`, never an envelope prefix or bare hex.
 */
export async function decryptStoredToken(
  stored: string,
  key: string | SecretConfig,
): Promise<string> {
  const encrypted =
    stored.startsWith("$ba$") ||
    (stored.length % 2 === 0 && /^[0-9a-f]+$/i.test(stored));
  return encrypted ? symmetricDecrypt({ key, data: stored }) : stored;
}
