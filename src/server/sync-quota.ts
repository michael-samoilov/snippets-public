/**
 * The per-account ceiling on what the sync server stores. Without it one
 * account could push 200 changes of up to 64 KB each, request after
 * request, until the database (Neon free tier: 512 MB) refused every
 * writer's push.
 *
 * Sized from what a sealed entry costs. A 100-word entry seals to about
 * 1 KB (its JSON, plus the 16-byte AES-GCM tag, in base64 inside a
 * `{v,iv,ct}` envelope), and Snippets asks for one entry a day.
 *   - 50,000 rows: one entry a day for 137 years, or ten a day for 13.
 *     Deletion markers count, since they are kept for good.
 *   - 50 MB of payload: about 50,000 such entries, or 800 entries at the
 *     64 KB per-entry maximum. One account at the ceiling uses about a
 *     tenth of the database.
 * A push that does not grow the account (a deletion, a shorter edit) is
 * never refused, so an account over the ceiling can always shrink.
 */
export const QUOTA_ROWS = 50_000;
export const QUOTA_BYTES = 50 * 1024 * 1024;

export interface Usage {
  rows: number;
  bytes: number;
}

interface Change {
  id: string;
  payload: unknown;
  updatedAt: number;
}

interface StoredRow {
  payload: unknown;
  updatedAt: number;
}

/** The stored size the quota counts for one payload: its JSON length. */
export function payloadBytes(payload: unknown): number {
  return payload === null ? 0 : JSON.stringify(payload).length;
}

/**
 * What a batch adds to the account, merged in order as the push route
 * merges it (a change applies only if it is newer than the stored row,
 * src/lib/merge.ts): a row for each new id, and payload bytes added
 * minus the bytes each applied change replaces.
 */
export function growth(
  changes: Change[],
  stored: Map<string, StoredRow>,
): Usage {
  const seen = new Map(stored);
  let rows = 0;
  let bytes = 0;
  for (const change of changes) {
    const existing = seen.get(change.id);
    if (existing && change.updatedAt <= existing.updatedAt) continue;
    if (!existing) rows += 1;
    bytes +=
      payloadBytes(change.payload) - (existing ? payloadBytes(existing.payload) : 0);
    seen.set(change.id, change);
  }
  return { rows, bytes };
}

/** A batch that grows the account past either ceiling is refused. */
export function exceedsQuota(usage: Usage, added: Usage): boolean {
  if (added.rows <= 0 && added.bytes <= 0) return false;
  return (
    usage.rows + added.rows > QUOTA_ROWS ||
    usage.bytes + added.bytes > QUOTA_BYTES
  );
}
