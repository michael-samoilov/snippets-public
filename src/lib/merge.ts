/**
 * The one conflict rule, shared verbatim by the server's push handler
 * and the client's pull applier. Entries are single-author prose, so
 * per-row last-write-wins covers almost everything; the exceptions are
 * deliberate:
 *
 * - Between two live rows, the writer's own hand outranks the clock:
 *   a row filed by hand (`enriched: "manual"`) beats any non-manual
 *   version regardless of timestamps, in both directions — otherwise
 *   two devices could each keep their own copy forever.
 * - A deletion (or a restore) is a user action like any other and
 *   resolves purely by clock — hand filing never resurrects an entry
 *   the writer let go.
 * - Equal clocks keep the existing row, which makes re-applying the
 *   same change a no-op (idempotence is what lets every sync step be
 *   safely retried).
 *
 * The merge only has to be *reasonable*, not perfect: the server is
 * the single arbiter (its writes are serialized per user), and a push
 * the server rejects returns the server's winning row for the client
 * to adopt — so every disagreement converges to one truth.
 */
export interface MergeSide {
  /** the client LWW clock, epoch ms */
  updatedAt: number;
  /** tombstone marker */
  deletedAt?: number | null;
  /** the enrichment state; `"manual"` is the writer's own filing */
  enriched?: string | null;
}

export function incomingWins(existing: MergeSide, incoming: MergeSide): boolean {
  const bothLive = !existing.deletedAt && !incoming.deletedAt;
  if (bothLive) {
    const existingManual = existing.enriched === "manual" ? 1 : 0;
    const incomingManual = incoming.enriched === "manual" ? 1 : 0;
    if (existingManual !== incomingManual)
      return incomingManual > existingManual;
  }
  return incoming.updatedAt > existing.updatedAt;
}

/**
 * The client clock stamp: strictly after the row being replaced, so a
 * device with a slow wall clock can never write an edit that loses to
 * the very row it was editing.
 */
export function bumpClock(previous: number | undefined): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}
