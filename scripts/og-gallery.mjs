/**
 * Builds the OG-variant review gallery from a `pnpm og` bake:
 *
 *   node scripts/og-gallery.mjs      # og-review/ -> og-review/gallery.html
 *
 * One self-contained HTML file (images inlined as data URIs) showing every
 * variant inside simulated share contexts at true preview scale — an iMessage
 * bubble (square crop), an X card (16:9 crop), a Slack unfurl (tiny), and the
 * full 1200×630 — so the cull happens under the same conditions recipients
 * will actually see. The crops are simulated with CSS object-fit over one
 * downscaled JPEG per variant, keeping the file small enough to publish.
 */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("og-review/manifest.json", "utf8"));

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const imgs = {};
for (const m of manifest) {
  const buf = await sharp(`og-review/${m.key}.png`)
    .resize(720, 378)
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  imgs[m.key] = `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const LENS_ORDER = [
  "letter", "corner", "diary", "envelope", "stack",
  "hero-object", "editorial", "app-truth", "material", "scene", "wild", "smoke",
];
const LENS_TITLES = {
  letter: "Letter — a sealed sheet on the desk",
  corner: "Corner desk — the sheet arriving into open space",
  diary: "Diary today — the dated page",
  envelope: "Envelope — the seal closing the sheet",
  stack: "Stacked altitudes — the app's zoom levels as a deck",
  "hero-object": "Hero object — the seal monumental",
  editorial: "Editorial — type leads",
  "app-truth": "App truth — the product itself",
  material: "Material — macro wax and paper",
  scene: "Scene — the desk under lamplight",
  wild: "Wild cards — restraint and play",
  smoke: "Smoke tests",
};
const byLens = new Map();
for (const m of manifest) {
  if (!byLens.has(m.lens)) byLens.set(m.lens, []);
  byLens.get(m.lens).push(m);
}
// any lens not in the fixed order still renders, appended at the end
const orderedLenses = [
  ...LENS_ORDER.filter((l) => byLens.has(l)),
  ...[...byLens.keys()].filter((l) => !LENS_ORDER.includes(l)),
];

const card = (m) => `
<article class="variant" id="${esc(m.key)}">
  <header class="v-head">
    <span class="v-key">${esc(m.key)}</span>
    <span class="chip">${m.theme}</span>
    ${m.needs.length ? `<span class="chip chip-needs">needs ${esc(m.needs.join(" + "))}</span>` : ""}
  </header>
  <p class="v-concept">${esc(m.concept)}</p>
  <div class="mocks">
    <figure class="mock">
      <div class="imsg"><img src="${imgs[m.key]}" alt="${esc(m.key)} — iMessage square crop"></div>
      <figcaption>iMessage · square crop</figcaption>
    </figure>
    <figure class="mock">
      <div class="xcard">
        <img src="${imgs[m.key]}" alt="${esc(m.key)} — X 16:9 crop">
        <div class="x-meta">snippets.ink</div>
      </div>
      <figcaption>X · 16:9 crop</figcaption>
    </figure>
    <figure class="mock">
      <div class="slack">
        <div class="slack-bar"></div>
        <div class="slack-body">
          <div class="slack-title">Snippets</div>
          <div class="slack-desc">A pocket notebook. Catch the stories, jokes, and stray thoughts of your day…</div>
          <img src="${imgs[m.key]}" alt="${esc(m.key)} — Slack unfurl size">
        </div>
      </div>
      <figcaption>Slack · unfurl</figcaption>
    </figure>
    <figure class="mock mock-full">
      <img class="full" src="${imgs[m.key]}" alt="${esc(m.key)} — full 1200×630">
      <figcaption>full 1200×630</figcaption>
    </figure>
  </div>
</article>`;

const sections = orderedLenses
  .map(
    (l) => `
<section class="lens">
  <h2>${esc(LENS_TITLES[l] ?? l)} <span class="count">${byLens.get(l).length}</span></h2>
  ${byLens.get(l).map(card).join("\n")}
</section>`,
  )
  .join("\n");

const html = `<title>Snippets — link-preview candidates</title>
<style>
  :root {
    --ground: #f2ead8;
    --card: #f9f4e7;
    --ink: #2a2318;
    --ink-soft: #6f6553;
    --line: #ddd2ba;
    --wax: #2e5685;
    --chat: #e6e0d0;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ground: #14100b; --card: #1e1913; --ink: #e8dfca; --ink-soft: #a59879; --line: #352d20; --wax: #5b8cc0; --chat: #241e15; }
  }
  :root[data-theme="dark"] { --ground: #14100b; --card: #1e1913; --ink: #e8dfca; --ink-soft: #a59879; --line: #352d20; --wax: #5b8cc0; --chat: #241e15; }
  :root[data-theme="light"] { --ground: #f2ead8; --card: #f9f4e7; --ink: #2a2318; --ink-soft: #6f6553; --line: #ddd2ba; --wax: #2e5685; --chat: #e6e0d0; }

  body { background: var(--ground); color: var(--ink); font-family: "Iowan Old Style", Georgia, serif; margin: 0; padding: 2.5rem 1.25rem 5rem; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 1.7rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.4rem; text-wrap: balance; }
  .sub { color: var(--ink-soft); max-width: 60ch; line-height: 1.55; margin: 0 0 0.75rem; }
  .how { color: var(--ink-soft); font-size: 0.92rem; border-left: 2px solid var(--wax); padding-left: 0.8rem; max-width: 60ch; line-height: 1.5; }
  .lens { margin-top: 3rem; }
  .lens h2 { font-size: 1.15rem; font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 0.45rem; margin: 0 0 1.25rem; }
  .count { color: var(--ink-soft); font-weight: 400; font-size: 0.9rem; }
  .variant { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1.1rem 1.2rem 1.3rem; margin-bottom: 1.4rem; }
  .v-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
  .v-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95rem; font-weight: 700; }
  .chip { font-family: ui-monospace, monospace; font-size: 0.68rem; letter-spacing: 0.05em; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.55rem; }
  .chip-needs { color: var(--wax); border-color: var(--wax); }
  .v-concept { color: var(--ink-soft); font-size: 0.95rem; line-height: 1.5; margin: 0.35rem 0 1rem; max-width: 70ch; }
  .mocks { display: flex; gap: 1.4rem; align-items: flex-start; flex-wrap: wrap; }
  .mock { margin: 0; }
  .mock figcaption { font-family: ui-monospace, monospace; font-size: 0.68rem; color: var(--ink-soft); margin-top: 0.4rem; letter-spacing: 0.04em; }
  .mock img { display: block; max-width: 100%; }
  .imsg { width: 200px; border-radius: 14px; overflow: hidden; background: var(--chat); }
  .imsg img { width: 200px; height: 200px; object-fit: cover; }
  .xcard { width: 300px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--chat); }
  .xcard img { width: 300px; aspect-ratio: 16 / 9; object-fit: cover; }
  .x-meta { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--ink-soft); padding: 0.35rem 0.6rem; }
  .slack { width: 300px; display: flex; gap: 0.55rem; }
  .slack-bar { width: 4px; border-radius: 4px; background: var(--line); flex-shrink: 0; }
  .slack-title { font-weight: 700; font-size: 0.82rem; color: var(--wax); }
  .slack-desc { font-size: 0.78rem; color: var(--ink-soft); line-height: 1.35; margin: 0.15rem 0 0.4rem; }
  .slack img { width: 280px; border-radius: 6px; }
  .mock-full { flex-basis: 100%; }
  .mock-full .full { width: min(560px, 100%); border: 1px solid var(--line); border-radius: 4px; }
  @media (max-width: 760px) { .mocks { gap: 1rem; } }
</style>
<div class="wrap">
  <h1>Link-preview candidates — ${manifest.length} directions</h1>
  <p class="sub">Every composition baked from the real app materials at 1200×630, shown here the way recipients meet it: an iMessage square crop, an X 16:9 crop, a Slack unfurl. Judge at these sizes — the full frame is reference, not the test.</p>
  <p class="how">To cull: reply in the session with the keys to keep (aim for ~5). Dashed “needs” chips mean the variant is a blocking stand-in — a tilted seal is a CSS tilt until the relight module is built, and app views are gray boxes until real screenshots are captured. Judge the composition, not the placeholder.</p>
  ${sections}
</div>
`;

await writeFile("og-review/gallery.html", html);
console.log(`wrote og-review/gallery.html (${(html.length / 1024 / 1024).toFixed(1)} MB, ${manifest.length} variants)`);
