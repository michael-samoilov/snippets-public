/**
 * Every Google token at rest in the `account` table is encrypted, and the
 * database refuses one that is not.
 *
 * Before 2026-11-11 each Google sign-in stored its access, refresh, and ID
 * tokens in plaintext. The account hooks (src/server/oauth-tokens.ts) stop
 * new ones, and `encryptOAuthTokens` encrypts what still rests. This
 * module encrypts the old values in place, once, and then adds a CHECK
 * constraint (`account_tokens_encrypted`) so a plaintext token can never
 * be written again. They are encrypted rather than nulled because two
 * paths still read them: /api/backup/adopt hands a leftover refresh token
 * to a device with none, and /api/account/delete revokes it at Google.
 *
 * The constraint is also the completion record: once it exists there is
 * nothing to do, and an instance only checks for it.
 */
import { sql } from "drizzle-orm";
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from "better-auth/crypto";
import type { ServerDb } from "@/server/db";
import {
  ENCRYPTED_TOKENS_SQL,
  TOKEN_COLUMNS,
  TOKEN_CONSTRAINT,
  isEncryptedToken,
} from "@/server/db/token-format";

type TokenColumn = (typeof TOKEN_COLUMNS)[number];
type Executor = Pick<ServerDb, "execute">;

export interface TokenRow {
  id: string;
  provider_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
}

export interface TokenUpdate {
  id: string;
  column: TokenColumn;
  from: string;
  to: string;
}

type Cipher = (args: { key: string | SecretConfig; data: string }) => Promise<string>;

/**
 * The writes that encrypt each plaintext Google token, each one checked
 * before it is planned: the ciphertext must decrypt to exactly the value
 * it replaces. A value that fails the check is counted and left alone,
 * never nulled.
 */
export async function planEncryption(
  rows: TokenRow[],
  key: string | SecretConfig,
  encrypt: Cipher = symmetricEncrypt,
  decrypt: Cipher = symmetricDecrypt,
): Promise<{ updates: TokenUpdate[]; failures: number }> {
  const updates: TokenUpdate[] = [];
  let failures = 0;
  for (const row of rows) {
    if (row.provider_id !== "google") continue;
    for (const column of TOKEN_COLUMNS) {
      const value = row[column];
      if (value === null || isEncryptedToken(value)) continue;
      const to = await encrypt({ key, data: value });
      const back = await decrypt({ key, data: to }).catch(() => null);
      if (back === value && isEncryptedToken(to)) updates.push({ id: row.id, column, from: value, to });
      else failures += 1;
    }
  }
  return { updates, failures };
}

export interface EncryptionReport {
  constraint: "present" | "added" | "withheld";
  encrypted: number;
  failures: number;
  plaintextLeft: number;
}

async function constraintExists(db: Executor): Promise<boolean> {
  const result = await db.execute(
    sql`select 1 from pg_constraint where conname = ${TOKEN_CONSTRAINT}`,
  );
  return result.rows.length > 0;
}

/** How many account rows hold a token that is not encrypted. */
export async function plaintextTokenRows(db: Executor): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from "account" where not (${sql.raw(ENCRYPTED_TOKENS_SQL)})`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Encrypt every plaintext Google token in place, then add the constraint
 * if no plaintext token is left anywhere. One transaction under an
 * advisory lock, so two instances can't race; each write also matches on
 * the value it replaces, so a row changed meanwhile is skipped, not
 * clobbered. Safe to run any number of times.
 */
export async function encryptLegacyTokens(
  db: ServerDb,
  key: string | SecretConfig,
): Promise<EncryptionReport> {
  if (await constraintExists(db))
    return { constraint: "present", encrypted: 0, failures: 0, plaintextLeft: 0 };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${TOKEN_CONSTRAINT}))`);
    if (await constraintExists(tx))
      return { constraint: "present", encrypted: 0, failures: 0, plaintextLeft: 0 };
    const found = await tx.execute(
      sql`select "id", "provider_id", "access_token", "refresh_token", "id_token"
          from "account" where not (${sql.raw(ENCRYPTED_TOKENS_SQL)})`,
    );
    // SAFETY: the select names exactly TokenRow's columns, all text or null
    const { updates, failures } = await planEncryption(found.rows as unknown as TokenRow[], key);
    let encrypted = 0;
    for (const u of updates) {
      const column = sql.identifier(u.column);
      const written = await tx.execute(
        sql`update "account" set ${column} = ${u.to} where "id" = ${u.id} and ${column} = ${u.from}`,
      );
      encrypted += written.rowCount ?? 0;
    }
    const plaintextLeft = await plaintextTokenRows(tx);
    if (plaintextLeft > 0)
      return { constraint: "withheld", encrypted, failures, plaintextLeft };
    await tx.execute(
      sql.raw(
        `alter table "account" add constraint "${TOKEN_CONSTRAINT}" check (${ENCRYPTED_TOKENS_SQL})`,
      ),
    );
    return { constraint: "added", encrypted, failures, plaintextLeft };
  });
}
