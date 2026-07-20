/**
 * Bakes the link-preview (OG image) candidates from the variant lab:
 *
 *   pnpm og                 # bake every variant in src/lib/og-variants.json
 *   pnpm og --only <key>    # bake one variant
 *   pnpm og --pick <key>    # bake one variant at final compression and write
 *                           # src/app/opengraph-image.(png|jpg) + .alt.txt
 *
 * Mirrors scripts/bake-icons.mjs: starts `next dev` (or BAKE_URL to reuse a
 * running app; PW_CHROME for a specific Chromium), loads /lab/og?variant=<key>,
 * waits for the stage's readiness flag (fonts loaded + seal canvas opaque),
 * screenshots the 1200×630 stage at 2×, and post-processes with sharp.
 *
 * Review output (og-review/, gitignored):
 *   <key>.png        full 1200×630
 *   <key>.imsg.png   center 630×630 (what iMessage's lock-screen square crop keeps)
 *   <key>.x.png      center 1120×630 (what X's 16:9 crop keeps)
 *   contact-sheet.jpg  labelled grid of everything baked
 *   manifest.json    per-variant metadata (key, concept, lens, needs, bytes)
 *
 * The shipped file targets <300 KB (WhatsApp recompresses aggressively; small
 * survives with detail intact): PNG if it fits, else JPEG stepping down from q82.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const PORT = process.env.BAKE_PORT || "3112";
const BASE = process.env.BAKE_URL || `http://localhost:${PORT}`;

const W = 1200;
const H = 630;
const SCALE = 2;
const MAX_BYTES = 300 * 1024;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only");
const pick = flag("--pick");

const variants = JSON.parse(
  await readFile(new URL("../src/lib/og-variants.json", import.meta.url), "utf8"),
);
const targets = (pick ?? only)
  ? variants.filter((v) => v.key === (pick ?? only))
  : variants;
if (targets.length === 0) {
  console.error(`no variant matches "${pick ?? only}"`);
  process.exit(1);
}

let server = null;
if (!process.env.BAKE_URL) {
  server = spawn("node_modules/.bin/next", ["dev", "-p", PORT], { stdio: "ignore" });
}
const stopServer = () => server?.kill("SIGTERM");
process.on("exit", stopServer);

async function waitUp() {
  const probe = `${BASE}/lab/og`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(probe)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`lab route never responded at ${probe}`);
}

/** encode to <MAX_BYTES: PNG if it fits, else JPEG stepping down in quality. */
async function encodeFinal(raw) {
  const png = await sharp(raw).png().toBuffer();
  if (png.length <= MAX_BYTES) return { buf: png, ext: "png" };
  for (const q of [82, 74, 66, 58]) {
    const jpg = await sharp(raw).flatten().jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (jpg.length <= MAX_BYTES) return { buf: jpg, ext: "jpg" };
  }
  const floor = await sharp(raw).flatten().jpeg({ quality: 50, mozjpeg: true }).toBuffer();
  return { buf: floor, ext: "jpg" };
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  await waitUp();
  const browser = await chromium.launch(
    process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  );
  const page = await browser.newPage({
    viewport: { width: W + 80, height: H + 80 },
    deviceScaleFactor: SCALE,
  });

  await mkdir("og-review", { recursive: true });
  const manifest = [];

  for (const v of targets) {
    const url = `${BASE}/lab/og?variant=${encodeURIComponent(v.key)}`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector('#og-stage-wrap[data-ready="1"]', { timeout: 45000 });
    const shot = await page.locator("#og-stage").screenshot(); // W×H at 2×
    const full = await sharp(shot).resize(W, H).png().toBuffer();

    if (pick) {
      const { buf, ext } = await encodeFinal(full);
      const file = `src/app/opengraph-image.${ext}`;
      await writeFile(file, buf);
      // alt text from the copy source of truth (copy.app.ogAlt)
      const copySrc = await readFile(
        new URL("../src/lib/copy.ts", import.meta.url),
        "utf8",
      );
      const m = copySrc.match(/ogAlt:\s*\n?\s*"([^"]+)"/);
      if (!m) throw new Error("copy.app.ogAlt not found in src/lib/copy.ts");
      await writeFile("src/app/opengraph-image.alt.txt", m[1] + "\n");
      console.log(`wrote ${file} (${(buf.length / 1024).toFixed(0)} KB) + alt.txt`);
      if (ext === "jpg")
        console.log("note: remove any stale src/app/opengraph-image.png");
      break;
    }

    await writeFile(`og-review/${v.key}.png`, full);
    await sharp(full)
      .extract({ left: (W - H) / 2, top: 0, width: H, height: H })
      .toFile(`og-review/${v.key}.imsg.png`);
    const xw = Math.round((H * 16) / 9);
    await sharp(full)
      .extract({ left: Math.round((W - xw) / 2), top: 0, width: xw, height: H })
      .toFile(`og-review/${v.key}.x.png`);
    manifest.push({
      key: v.key,
      theme: v.theme,
      lens: v.lens,
      concept: v.concept,
      needs: v.needs ?? [],
      bytes: full.length,
    });
    console.log(`baked ${v.key} (${(full.length / 1024).toFixed(0)} KB)`);
  }

  await browser.close();
  if (pick) return;

  // --only re-bakes must not clobber the rest of the manifest: merge with the
  // existing one, keeping og-variants.json order
  if (only) {
    let prior = [];
    try {
      prior = JSON.parse(await readFile("og-review/manifest.json", "utf8"));
    } catch { /* first bake */ }
    const merged = new Map(prior.map((m) => [m.key, m]));
    for (const m of manifest) merged.set(m.key, m);
    manifest.length = 0;
    for (const v of variants) if (merged.has(v.key)) manifest.push(merged.get(v.key));
  }

  await writeFile("og-review/manifest.json", JSON.stringify(manifest, null, 2) + "\n");

  // contact sheet: labelled grid, 4 across
  const COLS = 4;
  const TW = 400;
  const TH = 210;
  const LABEL = 34;
  const PAD = 12;
  const rows = Math.ceil(manifest.length / COLS);
  const sheetW = COLS * (TW + PAD) + PAD;
  const sheetH = rows * (TH + LABEL + PAD) + PAD;
  const comps = [];
  for (let i = 0; i < manifest.length; i++) {
    const m = manifest[i];
    const x = PAD + (i % COLS) * (TW + PAD);
    const y = PAD + Math.floor(i / COLS) * (TH + LABEL + PAD);
    const thumb = await sharp(`og-review/${m.key}.png`).resize(TW, TH).toBuffer();
    comps.push({ input: thumb, left: x, top: y });
    const label = Buffer.from(
      `<svg width="${TW}" height="${LABEL}"><text x="4" y="14" font-family="monospace" font-size="12" font-weight="bold" fill="#241e15">${esc(m.key)}</text><text x="4" y="28" font-family="monospace" font-size="10" fill="#6f6553">${esc(`${m.theme} · ${m.lens}${m.needs.length ? " · needs " + m.needs.join("+") : ""}`)}</text></svg>`,
    );
    comps.push({ input: label, left: x, top: y + TH });
  }
  await sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: "#e8dcc2" },
  })
    .composite(comps)
    .jpeg({ quality: 88 })
    .toFile("og-review/contact-sheet.jpg");
  console.log(`wrote og-review/contact-sheet.jpg (${manifest.length} variants)`);
}

try {
  await main();
} finally {
  stopServer();
}
