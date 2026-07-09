/**
 * Bakes the app icons + favicons from the ONE official seal:
 *
 *   pnpm icons
 *
 * Reproduces, headless, exactly what /lab/icon-studio bakes: it renders the live
 * 3-D WaxStamp at the spec in src/lib/icon-seal.json (via the /lab/icon-bake
 * route), reads that seal at full canvas resolution, and composites every variant
 * with the spec's per-platform fill + optical centre. So the icons never drift
 * from the seal or from the studio. Tune in the studio (or edit icon-seal.json),
 * re-run this, done. See public/icons/README.md.
 *
 * Needs a browser (`pnpm exec playwright install chromium` once). By default it
 * starts its own `next dev`; set BAKE_URL to an already-running app to skip that.
 * PW_CHROME points Playwright at a specific Chromium binary.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

const PORT = process.env.BAKE_PORT || "3111";
const BASE = process.env.BAKE_URL || `http://localhost:${PORT}`;
const ROUTE = `${BASE}/lab/icon-bake`;

const spec = JSON.parse(await readFile(new URL("../src/lib/icon-seal.json", import.meta.url), "utf8"));
const hexRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

let server = null;
if (!process.env.BAKE_URL) {
  server = spawn("node_modules/.bin/next", ["dev", "-p", PORT], { stdio: "ignore" });
}
const stopServer = () => server?.kill("SIGTERM");
process.on("exit", stopServer);

async function waitUp() {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(ROUTE)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`bake route never responded at ${ROUTE}`);
}

async function main() {
  await waitUp();

  const browser = await chromium.launch(
    process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  );
  const page = await browser.newPage({ deviceScaleFactor: 3 }); // hi-res master
  await page.goto(ROUTE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector("#icon-bake canvas");
      if (!c) return false;
      // sample a small centre region only — the master is huge, a full read is slow
      const s = Math.min(240, c.width);
      const d = c
        .getContext("2d")
        .getImageData((c.width - s) / 2, (c.height - s) / 2, s, s).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10 && ++n > 300) return true;
      return false;
    },
    { timeout: 30000 },
  );
  const dataUrl = await page.evaluate(() =>
    document.querySelector("#icon-bake canvas").toDataURL("image/png"),
  );
  await browser.close();

  // the seal master, at full canvas resolution (NOT trimmed — the studio composes
  // from the whole canvas too, so fill/centre mean the same in both)
  const master = Buffer.from(dataUrl.split(",")[1], "base64");

  // AUTOMATIC OPTICAL BALANCE — identical to /lab/icon-studio: the optical anchor
  // is the centroid of the opaque wax (soft shadow excluded) blended halfway to
  // the bounding-box centre; per variant we place that anchor at the frame centre,
  // which depends on fill. Computed on a small downsample (normalised → resolution
  // independent). This overwrites the spec's cx/cy so pnpm icons self-balances and
  // matches the studio; the balanced values are written back for the record.
  const { data, info } = await sharp(master)
    .resize(400, 400, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minx = info.width, miny = info.height, maxx = 0, maxy = 0, sx = 0, sy = 0, np = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1] > 180) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
        sx += x;
        sy += y;
        np++;
      }
    }
  }
  const anchor = np
    ? { x: ((minx + maxx) / 2 + sx / np) / 2 / info.width, y: ((miny + maxy) / 2 + sy / np) / 2 / info.height }
    : { x: 0.5, y: 0.5 };
  const clamp46 = (n) => Math.max(0.4, Math.min(0.6, +n.toFixed(3)));
  for (const v of spec.variants) {
    v.cx = clamp46(0.5 - (anchor.x - 0.5) * v.fill);
    v.cy = clamp46(0.5 - (anchor.y - 0.5) * v.fill);
  }

  await mkdir("public/icons", { recursive: true });
  for (const v of spec.variants) {
    // scale the whole master so its width = fill × frame, then place its centre at
    // (cx,cy)×frame — cropping whatever bleeds past the frame (as a canvas does).
    const D = Math.max(1, Math.round(v.fill * v.size));
    const scaled = await sharp(master).resize(D, D).png().toBuffer();
    const left = Math.round(v.cx * v.size - D / 2);
    const top = Math.round(v.cy * v.size - D / 2);
    const srcX = Math.max(0, -left), srcY = Math.max(0, -top);
    const dstX = Math.max(0, left), dstY = Math.max(0, top);
    const w = Math.min(D - srcX, v.size - dstX);
    const h = Math.min(D - srcY, v.size - dstY);
    const piece = await sharp(scaled)
      .extract({ left: srcX, top: srcY, width: Math.max(1, w), height: Math.max(1, h) })
      .toBuffer();
    await sharp({
      create: {
        width: v.size,
        height: v.size,
        channels: 4,
        background: v.bg ? { ...hexRgb(v.bg), alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: piece, left: dstX, top: dstY }])
      .png()
      .toFile(v.file);
    console.log("wrote", v.file, `(centre ${v.cx}, ${v.cy})`);
  }

  // persist the balanced centres so the spec on disk reflects what was baked
  await writeFile(
    new URL("../src/lib/icon-seal.json", import.meta.url),
    JSON.stringify(spec, null, 2) + "\n",
  );
}

try {
  await main();
} finally {
  stopServer();
}
