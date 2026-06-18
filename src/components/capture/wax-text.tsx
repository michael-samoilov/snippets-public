"use client";

/* TEMPORARY (wordmark lab): embossed-ink relief for a whole word — the same
   rounded-crown + light-from-upper-left relief the seal gives its glyph, applied
   to arbitrary text on a transparent background. Lets us try "every letter of the
   wordmark embossed like the S." Removed before the feature ships. */

import { useEffect, useRef } from "react";

// relief look — tuned to read like the seal's embossed glyph
const OV = 2;              // oversample for crisp edges
const BLUR_FRAC = 0.05;    // crown blur (× fontPx) — higher = rounder/softer
const AMP = 0.32;          // plateau height (crisp edge)
const CROWN = 0.95;        // domed crown on top → rounded volume
const SS = 4.2;            // height→slope
const LX = -0.5, LY = -0.55, LZ = 0.62;
const AMB = 0.6, DIFF = 0.6;   // ink letters: lift ambient so the body stays inky, not black
const SPEC = 0.9, SHIN = 16;

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
function hexToRgb01(hex: string): [number, number, number] {
  const m = hex.trim().replace("#", "");
  if (m.length < 6) return [0.14, 0.12, 0.08];
  return [parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255];
}
// separable box blur (multi-pass ≈ Gaussian), src→dst
function blur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, passes: number) {
  r = Math.max(0, Math.round(r));
  if (r === 0) { dst.set(src); return; }
  const inv = 1 / (2 * r + 1);
  const tmp = new Float32Array(w * h);
  let a = src;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) { tmp[row + x] = acc * inv; acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) { dst[y * w + x] = acc * inv; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    a = dst;
  }
}

/** the embossed text canvas + the S's centre within it (for placing a seal behind). */
export function WaxText({ text, fontPx, ink, themeKey, onLayout }: {
  text: string; fontPx: number; ink: string; themeKey: string;
  onLayout?: (info: { sCenterX: number; sCenterY: number; cssW: number; cssH: number }) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-fraunces").trim() || "Fraunces";
    const font = (px: number) => `italic 560 ${px}px ${fam}, Georgia, serif`;

    const mc = document.createElement("canvas").getContext("2d")!;
    mc.font = font(fontPx);
    const tm = mc.measureText(text);
    const sm = mc.measureText(text.slice(0, 1));
    const ascent = tm.actualBoundingBoxAscent || fontPx * 0.72;
    const descent = tm.actualBoundingBoxDescent || fontPx * 0.22;
    const padX = Math.ceil(fontPx * 0.2), padY = Math.ceil(fontPx * 0.22);
    const cssW = Math.ceil(tm.width + padX * 2);
    const cssH = Math.ceil(ascent + descent + padY * 2);
    const baseCss = padY + ascent;          // baseline from top, in css px
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    cv.width = W; cv.height = H; cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
    // align the canvas so its internal baseline sits on the text line's baseline
    cv.style.verticalAlign = `${-(cssH - baseCss)}px`;

    // the first glyph's centre (for a seal disc placed behind it)
    onLayout?.({ sCenterX: padX + sm.width / 2, sCenterY: baseCss - ascent / 2, cssW, cssH });

    // rasterise oversampled, downscale to an alpha mask
    const bw = W * OV, bh = H * OV;
    const gc = document.createElement("canvas"); gc.width = bw; gc.height = bh;
    const gx = gc.getContext("2d")!;
    gx.fillStyle = "#fff"; gx.textBaseline = "alphabetic";
    gx.font = font(fontPx * dpr * OV);
    gx.fillText(text, padX * dpr * OV, baseCss * dpr * OV);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(gc, 0, 0, bw, bh, 0, 0, W, H);
    const src = ctx.getImageData(0, 0, W, H).data;
    const mask = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = src[i * 4 + 3] / 255;

    const crown = new Float32Array(W * H);
    blur(mask, crown, W, H, dpr * fontPx * BLUR_FRAC, 3);
    const hgt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) hgt[i] = mask[i] * (AMP + CROWN * crown[i]);

    const Llen = Math.hypot(LX, LY, LZ), lx = LX / Llen, ly = LY / Llen, lz = LZ / Llen;
    let hx = lx, hy = ly, hz = lz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
    const ss = SS * dpr;
    const [ir, ig, ib] = hexToRgb01(ink);
    const hr = 0.97, hg = 0.94, hb = 0.86; // warm light highlight on the lit crown
    const out = ctx.createImageData(W, H);
    const d = out.data;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; const a = mask[i];
      if (a <= 0.004) continue;
      const o = i * 4;
      const dhx = (hgt[i + 1] - hgt[i - 1]) * 0.5 * ss, dhy = (hgt[i + W] - hgt[i - W]) * 0.5 * ss;
      let nx = -dhx, ny = -dhy, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
      const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
      const spec = Math.pow(ndh, SHIN) * SPEC;
      const lf = AMB + DIFF * ndl;
      d[o] = Math.round(clamp(ir * lf + hr * spec) * 255);
      d[o + 1] = Math.round(clamp(ig * lf + hg * spec) * 255);
      d[o + 2] = Math.round(clamp(ib * lf + hb * spec) * 255);
      d[o + 3] = Math.round(a * 255);
    }
    ctx.putImageData(out, 0, 0);
  }, [text, fontPx, ink, themeKey, onLayout]);

  return <canvas ref={ref} aria-hidden style={{ display: "block" }} />;
}
