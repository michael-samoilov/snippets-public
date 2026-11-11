/**
 * Binding a device's Drive refresh token to the account that adopted it.
 *
 * /api/backup/refresh attaches the server's Google client secret to a
 * refresh token and returns an access token. Unbound, any signed-in
 * account could exchange any token it got hold of. Bound, a token is
 * exchanged only for the account that adopted it (/api/backup/adopt
 * records the binding), and deleting that account ends its exchange.
 * Only the token's SHA-256 rests, and only for this purpose.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ServerDb } from "@/server/db";

/**
 * Devices adopted their tokens before bindings existed, so a token with
 * no binding is claimed by the first signed-in account that exchanges
 * it, until this date. A device delivers at least hourly while open, so
 * an active device claims its own token on its next delivery. After this
 * date an unclaimed token is refused, and that device reconnects Drive
 * from Settings, which binds a fresh grant.
 */
export const CLAIM_UNBOUND_UNTIL = Date.parse("2026-12-31T00:00:00Z");

/** The SHA-256 of a refresh token: what the binding stores in its place. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whether `userId` may exchange a token whose binding names `boundTo`:
 * undefined when the token has no binding yet, null when its account was
 * deleted. A deleted account's tokens are never exchanged again, which
 * is why deletion empties the row instead of removing it. "claim"
 * exchanges the token and records the binding first.
 */
export function grantVerdict(
  boundTo: string | null | undefined,
  userId: string,
  now: number,
): "exchange" | "claim" | "refuse" {
  if (boundTo !== undefined) return boundTo === userId ? "exchange" : "refuse";
  return now < CLAIM_UNBOUND_UNTIL ? "claim" : "refuse";
}

/**
 * The binding table creates itself on first use, as `speech_rate_limit`
 * does (src/server/speech-guard.ts), so a deploy needs no manual
 * migration. Migration 0003 runs the same idempotent statements, with
 * the foreign key under Drizzle's name, so either may run first.
 */
const DRIVE_GRANT_DDL = [
  sql`create table if not exists "drive_grant" (
    "token_hash" text primary key not null,
    "user_id" text,
    "created_at" timestamp default now() not null,
    constraint "drive_grant_user_id_user_id_fk" foreign key ("user_id")
      references "public"."user"("id") on delete set null on update no action
  )`,
  sql`create index if not exists "drive_grant_user" on "drive_grant" using btree ("user_id")`,
];

let tableReady: Promise<unknown> | null = null;

/** Resolves once `drive_grant` exists; runs its DDL once per instance. */
export function driveGrantTableReady(db: ServerDb): Promise<unknown> {
  tableReady ??= (async () => {
    for (const statement of DRIVE_GRANT_DDL) await db.execute(statement);
  })().catch((error: Error) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}
