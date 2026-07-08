/**
 * Generates the iOS launch screens (the PWA splash), one per device per theme:
 *
 *   pnpm splash
 *
 * A standalone PWA paints its launch splash from the manifest's single
 * `background_color` (light), so a Lamplight user saw a light flash before the
 * dark app on every cold launch. iOS's only theme-aware lever is
 * `apple-touch-startup-image` links media-queried on prefers-color-scheme (and
 * the exact device metrics), so we bake one image per device per theme: the desk
 * colour the app rests on (--desk) with the wax seal centred — icon → splash →
 * app, one continuous surface. The matching <link> tags live in layout.tsx's
 * `appleWebApp.startupImage`; its device list MIRRORS APPLE_LAUNCH below —
 * regenerate both together.
 *
 * NOTE: this splash seal is a FLAT mark (a launch placeholder shown for a beat).
 * The shipped APP ICONS are NOT made here — they are high-res renders of the
 * live 3-D WaxStamp seal; see public/icons/README.md for the source of truth and
 * how to re-bake them. Do not add icon generation to this script.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// the masthead "S": italic Fraunces (opsz≈22) as a vector outline, 2000 UPM,
// Y-up (flipped for SVG). Centre of its ink bounds is (S_CX, S_CY).
const S_CX = 661.3, S_CY = 701.5, S_H = 1449;
const S_PATH =
  "M575 -23Q489 -23 432 -7Q374 10 339 32Q304 54 283 71Q262 87 250 87Q237 87 220 72Q203 57 184 36Q164 16 145 1Q126 -14 108 -14Q80 -14 66 1Q53 16 56 48L100 401Q103 435 119 453Q134 471 158 471Q181 471 196 455Q211 439 223 407L245 302Q264 191 339 134Q414 76 517 76Q581 76 631 100Q680 123 710 165Q740 207 749 264Q764 350 719 424Q675 499 543 582Q392 678 329 777Q266 876 282 1009Q294 1120 360 1215Q427 1310 545 1368Q664 1426 832 1426Q976 1426 1074 1380Q1172 1334 1221 1262Q1271 1189 1267 1109Q1265 1053 1236 1016Q1207 979 1156 979Q1114 979 1088 1002Q1062 1026 1045 1079L1025 1156Q1002 1248 947 1292Q893 1336 814 1336Q739 1336 683 1307Q627 1277 594 1227Q561 1177 553 1115Q540 1023 588 947Q635 871 761 784Q882 704 946 633Q1010 562 1032 490Q1053 417 1043 334Q1032 228 970 147Q908 67 806 22Q705 -23 575 -23Z";

// desk = the surface the app rests on (globals.css --desk).
const THEMES = {
  light: { desk: "#e8dcc2" },
  dark: { desk: "#0f0c08" },
};

// device-width × device-height (CSS px) × devicePixelRatio, portrait. Covers the
// modern iPhone lineup; unmatched devices fall back to the manifest colour.
const APPLE_LAUNCH = [
  { w: 320, h: 568, r: 2 }, // SE (1st gen)
  { w: 375, h: 667, r: 2 }, // SE 2/3, 8, 7, 6s
  { w: 414, h: 736, r: 3 }, // 8/7/6s Plus
  { w: 375, h: 812, r: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 390, h: 844, r: 3 }, // 12/13/14, 12/13 Pro
  { w: 393, h: 852, r: 3 }, // 14 Pro, 15/16, 15/16 Pro
  { w: 402, h: 874, r: 3 }, // 16 Pro
  { w: 414, h: 896, r: 2 }, // XR, 11
  { w: 414, h: 896, r: 3 }, // XS Max, 11 Pro Max
  { w: 428, h: 926, r: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 430, h: 932, r: 3 }, // 14/15 Pro Max, 15/16 Plus
  { w: 440, h: 956, r: 3 }, // 16 Pro Max
];

// a centred wax seal on the desk, sized to the shorter edge — the icon's mark
// (deep #2e5685 seal, cream S), so only the background tells the themes apart.
const splash = (pw, ph, desk) => {
  const cx = pw / 2;
  const cy = ph / 2;
  const r = Math.min(pw, ph) * 0.15; // seal outer radius
  const sc = (0.88 * r) / S_H;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}">
  <rect width="${pw}" height="${ph}" fill="${desk}"/>
  <circle cx="${cx}" cy="${cy + r * 0.06}" r="${r * 1.07}" fill="#0a1a2e" opacity="0.28"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.04}" fill="#234468"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2e5685"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="#1c3a5c" stroke-width="${r * 0.045}" opacity="0.5"/>
  <g fill="#eae1cd" transform="translate(${cx} ${cy}) scale(${sc} ${-sc}) translate(${-S_CX} ${-S_CY})"><path d="${S_PATH}"/></g>
</svg>`);
};

await mkdir("public/splash", { recursive: true });
for (const [name, { desk }] of Object.entries(THEMES)) {
  for (const { w, h, r } of APPLE_LAUNCH) {
    await sharp(splash(w * r, h * r, desk))
      .png()
      .toFile(`public/splash/${name}-${w}x${h}@${r}.png`);
  }
}
console.log(`splash written (${Object.keys(THEMES).length}×${APPLE_LAUNCH.length})`);
