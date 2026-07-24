/**
 * The write half of sync. Batches of client changes are merged into
 * the server copy under one rule (src/lib/merge.ts) inside a
 * transaction that first takes `pg_advisory_xact_lock(hashtext(user))`
 * — one writer per user at a time, which is what makes the global
 * sequence gap-free per user and the whole cursor protocol sound.
 *
 * A change the server's copy beats comes back `superseded` with the
 * winning row attached; the client adopts it. The server's verdict is
 * final — that, not merge cleverness, is what guarantees convergence.
 */
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import { incomingWins, type MergeSide } from "@/lib/merge";
import {
  PAYLOAD_FORMAT_PLAIN,
  PAYLOAD_FORMAT_SEALED,
  PAYLOAD_FORMAT_SEALED_AAD,
  type PushResult,
  type SnippetPayload,
  type WireRow,
} from "@/lib/sync-wire";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64_000;

// Only sealed formats may be pushed: format 2 (legacy AES-GCM envelope)
// and format 3 (envelope with the row's cleartext fields AAD-bound).
// Format 1 (plaintext) is refused outright — see the 409 below — so the
// "we cannot read your entries" claim rests on the server's own refusal,
// not on client good behaviour. The payload must also LOOK like an
// envelope: a sealed format wrapping plaintext fields is rejected here,
// so mislabeling can't smuggle readable content in.
const sealedPayloadSchema = z
  .object({
    v: z.literal(1),
    iv: z.string().min(1),
    ct: z.string().min(1),
  })
  .strict();

const changeSchema = z.object({
  id: z.string().min(10).max(40),
  payloadFormat: z.union([
    z.literal(PAYLOAD_FORMAT_SEALED),
    z.literal(PAYLOAD_FORMAT_SEALED_AAD),
  ]),
  payload: sealedPayloadSchema,
  updatedAt: z.number().int().positive(),
  deletedAt: z.number().int().positive().nullable().optional(),
});

const bodySchema = z.object({
  changes: z.array(changeSchema).min(1).max(200),
});

type SnippetRow = typeof schema.snippets.$inferSelect;

function mergeSide(row: {
  updatedAt: number;
  deletedAt: number | null;
}): MergeSide {
  return { updatedAt: row.updatedAt, deletedAt: row.deletedAt };
}

function toWire(row: SnippetRow): WireRow {
  return {
    id: row.id,
    payloadFormat: row.payloadFormat,
    payload: row.payload as SnippetPayload | null,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    serverSeq: row.serverSeq,
  };
}

export async function POST(request: Request) {
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session)
    return Response.json({ error: "signed out" }, { status: 401 });

  const body = await request.json().catch(() => null);

  // A plaintext (format 1) push gets its own status, distinct from a
  // malformed one: a stale client that predates required encryption
  // must be told "enroll first" — which it maps to the needs-setup
  // pause — not left retrying a generic 400.
  if (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { changes?: unknown }).changes) &&
    (body as { changes: { payloadFormat?: unknown }[] }).changes.some(
      (c) => c?.payloadFormat === PAYLOAD_FORMAT_PLAIN,
    )
  )
    return Response.json({ error: "encryption_required" }, { status: 409 });

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "malformed push" }, { status: 400 });
  for (const change of parsed.data.changes) {
    if (JSON.stringify(change.payload).length > MAX_PAYLOAD_BYTES)
      return Response.json({ error: "entry too large" }, { status: 413 });
  }

  const userId = session.user.id;
  const results: PushResult[] = [];
  let maxSeq = 0;

  await serverDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    for (const change of parsed.data.changes) {
      const [existing] = await tx
        .select()
        .from(schema.snippets)
        .where(
          and(
            eq(schema.snippets.userId, userId),
            eq(schema.snippets.id, change.id),
          ),
        );

      const incoming: MergeSide = {
        updatedAt: change.updatedAt,
        deletedAt: change.deletedAt ?? null,
      };

      if (!existing) {
        await tx.insert(schema.snippets).values({
          userId,
          id: change.id,
          payload: change.payload,
          payloadFormat: change.payloadFormat,
          updatedAt: change.updatedAt,
          deletedAt: change.deletedAt ?? null,
          serverSeq: sql<number>`nextval('snippets_seq')`,
        });
        results.push({ id: change.id, outcome: "applied" });
      } else if (incomingWins(mergeSide(existing), incoming)) {
        await tx
          .update(schema.snippets)
          .set({
            payload: change.payload,
            payloadFormat: change.payloadFormat,
            updatedAt: change.updatedAt,
            deletedAt: change.deletedAt ?? null,
            serverSeq: sql<number>`nextval('snippets_seq')`,
          })
          .where(
            and(
              eq(schema.snippets.userId, userId),
              eq(schema.snippets.id, change.id),
            ),
          );
        results.push({ id: change.id, outcome: "applied" });
      } else {
        results.push({
          id: change.id,
          outcome: "superseded",
          row: toWire(existing),
        });
      }
    }

    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(server_seq), 0)` })
      .from(schema.snippets)
      .where(eq(schema.snippets.userId, userId));
    maxSeq = Number(max);
  });

  return Response.json({ results, serverNow: Date.now(), maxSeq });
}
