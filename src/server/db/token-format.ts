/**
 * The one definition of "an encrypted OAuth token at rest", shared by the
 * schema's CHECK constraint, the one-time backfill, and the daily cron.
 *
 * Better Auth's `symmetricEncrypt` writes bare hex under a single
 * `BETTER_AUTH_SECRET`, and a `$ba$<version>$` envelope under versioned
 * secrets. A Google token is never either: access tokens carry `.`,
 * refresh tokens `/`, ID tokens are dotted JWTs.
 */
export const TOKEN_COLUMNS = ["access_token", "refresh_token", "id_token"] as const;

export const TOKEN_CONSTRAINT = "account_tokens_encrypted";

/** True for a value Better Auth's encryption produced. */
export function isEncryptedToken(value: string): boolean {
  return value.startsWith("$ba$") || /^(?:[0-9a-f]{2})+$/i.test(value);
}

/** The same test in SQL, over all three columns: null or encrypted. */
export const ENCRYPTED_TOKENS_SQL = TOKEN_COLUMNS.map(
  (c) => `("${c}" is null or "${c}" like '$ba$%' or "${c}" ~ '^([0-9a-fA-F]{2})+$')`,
).join(" and ");
