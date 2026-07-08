/**
 * The one conflict rule, shared verbatim by the server's push handler
 * and the client's pull applier. Entries are single-author prose, so
 * per-row last-write-wins covers everything: the newer `updatedAt` wins,
 * and equal clocks keep the existing row (which makes re-applying the
 * same change a no-op — idempotence is what lets every sync step be
 * safely retried). A deletion or restore is just another write, resolved
 * by the same clock.
 *
 * The merge only has to be *reasonable*, not perfect: the server is the
 * single arbiter (its writes are serialized per user), and a push the
 * server rejects returns the server's winning row for the client to
 * adopt — so every disagreement converges to one truth.
 */
export interface MergeSide {
  /** the client LWW clock, epoch ms */
  updatedAt: number;
  /** tombstone marker */
  deletedAt?: number | null;
}

export function incomingWins(existing: MergeSide, incoming: MergeSide): boolean {
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
