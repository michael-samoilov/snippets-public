/**
 * Generates the app icons from one SVG source: a wax seal pressed with
 * the six-ray asterisk, resting on paper.
 *
 *   pnpm icons
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const seal = (size, { pad = 0.18, paper = "#f6f0e2" } = {}) => {
  const s = 1000;
  const inset = s * pad;
  const r = (s - inset * 2) * 0.34;
  const cx = s / 2;
  const cy = s / 2;
  const ray = r * 0.52;
  const rays = [0, 60, 120]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.sin(rad) * ray;
      const dy = -Math.cos(rad) * ray;
      return `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}" />`;
    })
    .join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${paper}"/>
  <circle cx="${cx}" cy="${cy + s * 0.004}" r="${r * 1.06}" fill="#7a2c1b" opacity="0.35"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.04}" fill="#8f3522"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#993b26"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="#7a2c1b" stroke-width="${r * 0.045}" opacity="0.55"/>
  <g stroke="${paper}" stroke-width="${r * 0.13}" stroke-linecap="round">${rays}</g>
</svg>`);
};

await mkdir("public/icons", { recursive: true });
await sharp(seal(192)).png().toFile("public/icons/icon-192.png");
await sharp(seal(512)).png().toFile("public/icons/icon-512.png");
await sharp(seal(512, { pad: 0.26 })).png().toFile("public/icons/maskable-512.png");
await sharp(seal(180, { pad: 0.12 })).png().toFile("src/app/apple-icon.png");
console.log("icons written");
