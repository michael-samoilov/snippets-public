/**
 * DEV-ONLY endpoint behind the /lab/icon-studio tuner. GET returns the current
 * icon-seal spec; POST persists a new spec (src/lib/icon-seal.json) and writes the
 * baked PNGs the studio composed. 404s in production — it writes to the repo and
 * must never exist on a deployed server. Writes are whitelisted to the icon paths.
 */
import { NextResponse } from "next/server";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SPEC = "src/lib/icon-seal.json";
const ALLOWED = new Set([
  "src/app/icon.png",
  "src/app/apple-icon.png",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/maskable-512.png",
]);

const devOnly = () => process.env.NODE_ENV === "production";

export async function GET() {
  if (devOnly()) return new NextResponse("Not found", { status: 404 });
  const json = await readFile(path.join(ROOT, SPEC), "utf8");
  return NextResponse.json(JSON.parse(json));
}

export async function POST(req: Request) {
  if (devOnly()) return new NextResponse("Not found", { status: 404 });
  const { spec, files } = (await req.json()) as {
    spec?: unknown;
    files?: { file: string; dataUrl: string }[];
  };

  for (const { file, dataUrl } of files ?? []) {
    if (!ALLOWED.has(file)) {
      return NextResponse.json({ error: `refusing to write ${file}` }, { status: 400 });
    }
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await writeFile(path.join(ROOT, file), Buffer.from(b64, "base64"));
  }

  if (spec) {
    await writeFile(path.join(ROOT, SPEC), JSON.stringify(spec, null, 2) + "\n");
  }

  return NextResponse.json({ ok: true, wrote: (files ?? []).map((f) => f.file) });
}
