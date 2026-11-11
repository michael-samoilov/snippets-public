/**
 * Binding a device's Drive refresh token to the account that adopted it.
 *
 * /api/backup/refresh attaches the server's Google client secret to a
 * refresh token and returns an access token. Unbound, any signed-in
 * account could exchange any token it got hold of. Bound, a token is
 * exchanged only for the account that adopted it (/api/backup/adopt
 * records the binding), and deleting that account ends its exchange.
 */
import { createHash } from "node:crypto";

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
 * Whether `userId` may exchange a token whose binding is `boundTo`
 * (undefined: no binding yet). "claim" exchanges it and records the
 * binding first.
 */
export function grantVerdict(
  boundTo: string | undefined,
  userId: string,
  now: number,
): "exchange" | "claim" | "refuse" {
  if (boundTo !== undefined) return boundTo === userId ? "exchange" : "refuse";
  return now < CLAIM_UNBOUND_UNTIL ? "claim" : "refuse";
}
