/**
 * The wrapped book key, at rest. The server stores two sealed
 * envelopes (passphrase-wrapped and recovery-wrapped) and can open
 * neither — unwrapping happens on the writer's devices. PUT is
 * enrollment, once: a second PUT is refused, because silently
 * replacing the wrapped key would let a compromised client brick
 * every other device's ability to read the book.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";

export const runtime = "nodejs";

const wrappedKeySchema = z.object({
  v: z.literal(1),
  kdf: z.literal("PBKDF2-SHA256"),
  iterations: z.number().int().min(1).max(5_000_000),
  salt: z.string().min(8).max(64),
  iv: z.string().min(8).max(32),
  ct: z.string().min(16).max(256),
});

const bodySchema = z.object({
  passphraseKey: wrappedKeySchema,
  recoveryKey: wrappedKeySchema,
});

export async function GET(request: Request) {
  if (!serverDb)
    return Response.json({ error: "accounts are not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const [row] = await serverDb
    .select()
    .from(schema.userKeys)
    .where(eq(schema.userKeys.userId, session.user.id));
  if (!row) return Response.json({ enrolled: false }, { status: 404 });
  return Response.json({
    enrolled: true,
    passphraseKey: row.passphraseKey,
    recoveryKey: row.recoveryKey,
    keyVersion: row.keyVersion,
  });
}

export async function PUT(request: Request) {
  if (!serverDb)
    return Response.json({ error: "accounts are not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "malformed keys" }, { status: 400 });

  const [existing] = await serverDb
    .select({ userId: schema.userKeys.userId })
    .from(schema.userKeys)
    .where(eq(schema.userKeys.userId, session.user.id));
  if (existing)
    return Response.json({ error: "already enrolled" }, { status: 409 });

  await serverDb.insert(schema.userKeys).values({
    userId: session.user.id,
    passphraseKey: parsed.data.passphraseKey,
    recoveryKey: parsed.data.recoveryKey,
  });
  return Response.json({ ok: true });
}
