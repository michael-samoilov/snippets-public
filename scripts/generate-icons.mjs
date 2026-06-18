/**
 * Generates the app icons: a deep-blue wax seal pressed with the letter "S"
 * (the wordmark's seal), resting on paper.
 *
 *   pnpm icons
 *
 * NOTE: the icons that actually SHIP are rendered from the live 3-D wax seal so
 * they match the masthead exactly (lit relief, lobed silhouette). This script is
 * a FLAT, on-brand fallback for when a browser render isn't available — it keeps
 * the colour + "S" identity but not the 3-D lighting. Re-render from the seal for
 * the full-fidelity icons.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// the masthead "S": italic Fraunces (opsz≈22) as a vector outline, 2000 UPM,
// Y-up (flipped for SVG). Centre of its ink bounds is (S_CX, S_CY).
const S_CX = 661.3, S_CY = 701.5, S_H = 1449;
const S_PATH =
  "M575 -23Q489 -23 432 -7Q374 10 339 32Q304 54 283 71Q262 87 250 87Q237 87 220 72Q203 57 184 36Q164 16 145 1Q126 -14 108 -14Q80 -14 66 1Q53 16 56 48L100 401Q103 435 119 453Q134 471 158 471Q181 471 196 455Q211 439 223 407L245 302Q264 191 339 134Q414 76 517 76Q581 76 631 100Q680 123 710 165Q740 207 749 264Q764 350 719 424Q675 499 543 582Q392 678 329 777Q266 876 282 1009Q294 1120 360 1215Q427 1310 545 1368Q664 1426 832 1426Q976 1426 1074 1380Q1172 1334 1221 1262Q1271 1189 1267 1109Q1265 1053 1236 1016Q1207 979 1156 979Q1114 979 1088 1002Q1062 1026 1045 1079L1025 1156Q1002 1248 947 1292Q893 1336 814 1336Q739 1336 683 1307Q627 1277 594 1227Q561 1177 553 1115Q540 1023 588 947Q635 871 761 784Q882 704 946 633Q1010 562 1032 490Q1053 417 1043 334Q1032 228 970 147Q908 67 806 22Q705 -23 575 -23Z";

const seal = (size, { pad = 0.18, paper = "#f6f0e2" } = {}) => {
  const s = 1000;
  const inset = s * pad;
  const r = (s - inset * 2) * 0.34;
  const cx = s / 2;
  const cy = s / 2;
  const sc = (0.88 * r) / S_H; // S height ≈ 0.44 of the seal diameter, as in the seal
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${paper}"/>
  <circle cx="${cx}" cy="${cy + s * 0.006}" r="${r * 1.07}" fill="#0a1a2e" opacity="0.32"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.04}" fill="#234468"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2e5685"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="#1c3a5c" stroke-width="${r * 0.045}" opacity="0.5"/>
  <g fill="#eae1cd" transform="translate(${cx} ${cy}) scale(${sc} ${-sc}) translate(${-S_CX} ${-S_CY})"><path d="${S_PATH}"/></g>
</svg>`);
};

await mkdir("public/icons", { recursive: true });
await sharp(seal(192)).png().toFile("public/icons/icon-192.png");
await sharp(seal(512)).png().toFile("public/icons/icon-512.png");
await sharp(seal(512, { pad: 0.26 })).png().toFile("public/icons/maskable-512.png");
await sharp(seal(180, { pad: 0.12 })).png().toFile("src/app/apple-icon.png");
console.log("icons written");
