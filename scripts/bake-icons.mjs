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
import { mkdir, readFile } from "node:fs/promises";
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
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(ROUTE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector("#icon-bake canvas");
      if (!c) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10 && ++n > 800) return true;
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
    console.log("wrote", v.file);
  }
}

try {
  await main();
} finally {
  stopServer();
}
