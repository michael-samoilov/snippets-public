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
const plates = args.includes("--plates");

const variants = JSON.parse(
  await readFile(new URL("../src/lib/og-variants.json", import.meta.url), "utf8"),
);
const wanted = pick ? [pick] : only ? only.split(",") : null;
const targets = wanted ? variants.filter((v) => wanted.includes(v.key)) : variants;
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

/**
 * `--plates`: capture the app's four altitudes (schedule / month / year /
 * entry) in both themes as plate images for the lab's `plate` blocks.
 * Rides the standing dev-seed (`?seed=` — src/lib/dev-seed.ts, deterministic,
 * inert on prod) for a realistic fictional book, at a phone viewport (the
 * app's native form). Written to public/og-plates/ (gitignored — bake-time
 * inputs, not shipped assets).
 */
// Strip the app chrome for a clean plate: drop the masthead ribbon (wordmark +
// account) so a stacked plate doesn't repeat it, and remove the desk gutters —
// the shell's horizontal padding + the sheet's rounded corners — so the paper
// fills the frame edge to edge. Injected after each navigation load and BEFORE
// scrolling, so the reflowed sheet settles before scroll positions are taken.
// (An init-script style appended pre-<head> gets dropped by Next's hydration,
// so addStyleTag is the reliable path.)
const PLATE_CSS = [
  "[data-app-shell] header{display:none!important}",
  "[data-app-shell]>div{padding-left:0!important;padding-right:0!important;max-width:none!important}",
  ".sheet{border-radius:0!important}",
].join("");
async function hideHeader(page) {
  await page.addStyleTag({ content: PLATE_CSS }).catch(() => {});
}

async function capturePlates(browser) {
  await mkdir("public/og-plates", { recursive: true });
  const year = new Date().getFullYear();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
        // rapid successive bake loads would otherwise look like a crash loop
        // and make the app ignore deep links (src/lib/crash-recovery.ts)
        localStorage.removeItem("snip:loadmarks");
      } catch {}
    }, theme);
    const page = await ctx.newPage();

    // schedule (seeds the book on first load; live query paints the cards)
    await page.goto(`${BASE}/calendar?seed=600&years=3`, { waitUntil: "load", timeout: 60000 });
    // cards outside the render window are cv:hidden — "attached" is the signal
    await page.waitForSelector(".book-card", { state: "attached", timeout: 45000 });
    await hideHeader(page); // drop the masthead ribbon BEFORE scrolling
    await page.waitForTimeout(2500); // fonts + motion + reflow settle
    // today zone (tall) — the fresh load lands on today's foot; scroll to the
    // very bottom to frame the composer (date, ruled lines, mic seal)
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `public/og-plates/today-${theme}.png` });
    console.log(`plate today-${theme}`);
    // scroll up into the kept days so the plate shows the book alive, not the
    // (mostly empty) fresh today zone — today is the book's END, so scroll up
    await page.mouse.wheel(0, -2600);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `public/og-plates/schedule-${theme}.png` });
    console.log(`plate schedule-${theme}`);

    // month canvas — the schedule sits on a synthesized month "floor" in
    // history, so Back IS the zoom-out (the title's ‹ does the same)
    await page.goBack();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `public/og-plates/calendar-${theme}.png` });
    console.log(`plate calendar-${theme}`);

    // year glance — the ?y= deep link (safe now that the init script clears
    // the crash-recovery load marks each navigation)
    await page.goto(`${BASE}/calendar?y=${year}`, { waitUntil: "load", timeout: 60000 });
    await hideHeader(page);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `public/og-plates/year-${theme}.png` });
    console.log(`plate year-${theme}`);

    // entry — pick a recent medium-length seeded row straight from IndexedDB
    const target = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("snippets");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const dbx = req.result;
            const all = dbx.transaction("snippets").objectStore("snippets").getAll();
            all.onsuccess = () => {
              const rows = all.result
                .filter((r) => !r.deletedAt && r.text.length > 80 && r.text.length < 240)
                .sort((a, b) => b.capturedAt - a.capturedAt);
              const r = rows[0];
              resolve(r ? { id: r.id, day: r.day } : null);
            };
            all.onerror = () => reject(all.error);
          };
        }),
    );
    if (!target) throw new Error("no seeded entry found for the entry plate");
    await page.goto(`${BASE}/calendar?d=${target.day}&e=${target.id}`, {
      waitUntil: "load",
      timeout: 60000,
    });
    await hideHeader(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `public/og-plates/entry-${theme}.png` });
    console.log(`plate entry-${theme}`);

    await ctx.close();
  }

  // PORTRAIT BLEED SET (light only): each altitude captured at the target
  // portrait aspect (2:3) so a full-bleed portrait variant shows the real app
  // UI edge-to-edge with no cropping. Written to <view>-bleed.png.
  const bctx = await browser.newContext({
    viewport: { width: 420, height: 640 },
    deviceScaleFactor: 2,
  });
  await bctx.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
      localStorage.removeItem("snip:loadmarks");
    } catch {}
  });
  const bp = await bctx.newPage();

  // today — the composer/doorway (date, write line, mic seal). Fresh load lands
  // on today's schedule foot; scroll to the very bottom to frame the composer.
  await bp.goto(`${BASE}/calendar?seed=600&years=3`, { waitUntil: "load", timeout: 60000 });
  await bp.waitForSelector(".book-card", { state: "attached", timeout: 45000 });
  await hideHeader(bp);
  await bp.waitForTimeout(2500);
  await bp.mouse.move(210, 420);
  await bp.mouse.wheel(0, 4000);
  await bp.waitForTimeout(1500);
  await bp.screenshot({ path: "public/og-plates/today-bleed.png" });
  console.log("plate today-bleed");

  // schedule — scroll up into the kept days
  await bp.mouse.wheel(0, -2600);
  await bp.waitForTimeout(1500);
  await bp.screenshot({ path: "public/og-plates/schedule-bleed.png" });
  console.log("plate schedule-bleed");

  // month canvas
  await bp.goBack();
  await bp.waitForTimeout(1800);
  await bp.screenshot({ path: "public/og-plates/calendar-bleed.png" });
  console.log("plate calendar-bleed");

  // year glance
  await bp.goto(`${BASE}/calendar?y=${year}`, { waitUntil: "load", timeout: 60000 });
  await hideHeader(bp);
  await bp.waitForTimeout(2200);
  await bp.screenshot({ path: "public/og-plates/year-bleed.png" });
  console.log("plate year-bleed");

  // entry
  const btarget = await bp.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("snippets");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction("snippets").objectStore("snippets").getAll();
          all.onsuccess = () => {
            const rows = all.result
              .filter((r) => !r.deletedAt && r.text.length > 80 && r.text.length < 240)
              .sort((a, b) => b.capturedAt - a.capturedAt);
            resolve(rows[0] ? { id: rows[0].id, day: rows[0].day } : null);
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
  if (btarget) {
    await bp.goto(`${BASE}/calendar?d=${btarget.day}&e=${btarget.id}`, { waitUntil: "load", timeout: 60000 });
    await hideHeader(bp);
    await bp.waitForTimeout(2500);
    await bp.screenshot({ path: "public/og-plates/entry-bleed.png" });
    console.log("plate entry-bleed");
  }

  await bctx.close();
}

async function main() {
  await waitUp();
  const browser = await chromium.launch(
    process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  );
  if (plates) {
    await capturePlates(browser);
    await browser.close();
    return;
  }
  // one page, resized per variant (portrait variants set their own size)
  const page = await browser.newPage({ deviceScaleFactor: SCALE });

  await mkdir("og-review", { recursive: true });
  const manifest = [];

  for (const v of targets) {
    const vw = v.size?.w ?? W;
    const vh = v.size?.h ?? H;
    await page.setViewportSize({ width: vw + 80, height: vh + 80 });
    const url = `${BASE}/lab/og?variant=${encodeURIComponent(v.key)}`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector('#og-stage-wrap[data-ready="1"]', { timeout: 45000 });
    const shot = await page.locator("#og-stage").screenshot();
    const full = await sharp(shot).resize(vw, vh).png().toBuffer();

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
    // the ~1.91:1 "feed crop" — what Facebook/X/LinkedIn center-crop TO. For a
    // landscape variant it's nearly the whole image; for a portrait one it's
    // the thin middle band those platforms would show (the honest caveat).
    const fbW = vw;
    const fbH = Math.min(vh, Math.round(vw / 1.91));
    await sharp(full)
      .extract({ left: 0, top: Math.round((vh - fbH) / 2), width: fbW, height: fbH })
      .toFile(`og-review/${v.key}.fbx.png`);
    manifest.push({
      key: v.key,
      theme: v.theme,
      lens: v.lens,
      concept: v.concept,
      needs: v.needs ?? [],
      size: { w: vw, h: vh },
      portrait: vh > vw,
      bytes: full.length,
    });
    console.log(`baked ${v.key} ${vw}×${vh} (${(full.length / 1024).toFixed(0)} KB)`);
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

  // contact sheet: labelled grid, 4 across. Each cell is a fixed landscape box;
  // portrait variants are letterboxed inside it (contain) so mixed aspects sit
  // in one grid.
  const COLS = 4;
  const TW = 400;
  const TH = 230;
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
    const thumb = await sharp(`og-review/${m.key}.png`)
      .resize(TW, TH, { fit: "contain", background: "#d9cdb2" })
      .toBuffer();
    comps.push({ input: thumb, left: x, top: y });
    const tag = `${m.theme} · ${m.lens}${m.portrait ? " · PORTRAIT" : ""}${m.needs?.length ? " · needs " + m.needs.join("+") : ""}`;
    const label = Buffer.from(
      `<svg width="${TW}" height="${LABEL}"><text x="4" y="14" font-family="monospace" font-size="12" font-weight="bold" fill="#241e15">${esc(m.key)}</text><text x="4" y="28" font-family="monospace" font-size="10" fill="#6f6553">${esc(tag)}</text></svg>`,
    );
    comps.push({ input: label, left: x, top: y + TH });
  }
  await sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: "#e8dcc2" },
  })
    .composite(comps)
    .jpeg({ quality: 86 })
    .toFile("og-review/contact-sheet.jpg");
  console.log(`wrote og-review/contact-sheet.jpg (${manifest.length} variants)`);
}

try {
  await main();
} finally {
  stopServer();
}
