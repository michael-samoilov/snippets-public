import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const runtime = "nodejs";

// accounts unconfigured → a quiet 503, the same shape /api/sync returns
const disabled = () =>
  Response.json({ error: "accounts are not configured" }, { status: 503 });

const handler = auth ? toNextJsHandler(auth) : { GET: disabled, POST: disabled };

export const { GET, POST } = handler;
