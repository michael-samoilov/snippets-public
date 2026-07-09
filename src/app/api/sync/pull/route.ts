/**
 * The read half of sync: a cursor walk up the user's change feed.
 * Gap-safety comes from the push handler's per-user advisory lock —
 * seq values for one user commit in order, so `> cursor` can never
 * skip a row.
 */
import type { NextRequest } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import type { PullResponse, SnippetPayload, WireRow } from "@/lib/sync-wire";

export const runtime = "nodejs";

const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session)
    return Response.json({ error: "signed out" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const cursor = Math.max(0, Number(params.get("cursor")) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.get("limit")) || MAX_LIMIT),
  );

  const rows = await serverDb
    .select()
    .from(schema.snippets)
    .where(
      and(
        eq(schema.snippets.userId, session.user.id),
        gt(schema.snippets.serverSeq, cursor),
      ),
    )
    .orderBy(asc(schema.snippets.serverSeq))
    .limit(limit);

  const wire: WireRow[] = rows.map((row) => ({
    id: row.id,
    payloadFormat: row.payloadFormat,
    payload: row.payload as SnippetPayload | null,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    serverSeq: row.serverSeq,
  }));

  const response: PullResponse = {
    rows: wire,
    nextCursor: wire.length ? wire[wire.length - 1].serverSeq : cursor,
    hasMore: wire.length === limit,
  };
  return Response.json(response);
}
