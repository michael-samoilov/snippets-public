"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* ── the wax stamp ────────────────────────────────────────────────
   A pressed wax seal, rendered as a real 3-D one: a per-pixel height
   field (flat pressed field → a thin raised ridge → a moat at field
   level → a rounded lip that rolls over like the outside of a donut,
   undulating into ~6 irregular lobes) lit with Lambert diffuse +
   Blinn-Phong specular. Highlights stay a pale tint and shadows stay a
   deep tint of the same wax — never white, never black. The silhouette
   profile, the lobe count (a k=6/k=4 Fourier pair) and the lip/field
   proportions are measured from a real wax seal. The glyph is embossed
   into the same field so it is lit identically. Colour comes from the
   live `--wax*` tokens, so it themes for Paper and Lamplight.

   A keep plays the press: a bead drops and grows, spreads into a puck
   with no vertical squash (the die presses on z, the wax spreads
   radially), then the relief emerges — ridge, moat, lip and glyph rise
   out of the flat puck — and settles. Replays when `playKey` changes;
   collapses to the settled seal under reduced motion. */

// silhouette r(θ)/rmean — Fourier fit of a real seal (6 lobes, k=4 varies
// their size). [harmonic, aCos, bSin]
const A0 = 1.0002;
const FH: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.0002, 0.0017], [2, -0.0044, -0.0012], [3, -0.002, -0.0043],
  [4, -0.0059, -0.0176], [5, -0.0046, -0.0062], [6, -0.0462, 0.0121], [7, 0.0012, -0.0032],
];
const LIP_LO = 0.94, LIP_HI = 1.075; // profile → per-lobe lip height 0..1

// radial structure (fractions of mean radius) + heights (0..1)
const FIELD_R = 0.68, RIDGE_R = 0.745, MOAT_R = 0.8;
const FIELDH = 0.45;          // field AND moat baseline
const RIDGE_AMP = 0.18, RIDGE_W = 2.5; // raised ring (world units ~ /100 of MR)
const CREST_BASE = 0.78, CREST_LUMP = 0.36; // trough crest ≈ ridge; lobes higher
const CREST_FRAC = 0.56, OUT_POW = 2.4;     // crest position; donut roll shape
const GLYPH_AMP = 0.48;
const DOME_AMP = 16;          // rounded bead/puddle (sphere-ish) that flattens out
const PUD_EDGE = 0.86;        // puddle radius (×MR); the lip squishes out past this

// lighting
const SS = 4.5;               // height→slope: high relief so it reads glossy, not flat
const LX = -0.52, LY = -0.52, LZ = 0.54;
const AMBIENT = 0.23, DIFF = 1.05;
const SPEC_STR = 1.3, SHIN = 18, SPEC_RIM = 3.3, ENV = 0.28, HICAP = 0.99;

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const sm = (t: number) => t * t * (3 - 2 * t);
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

function profileAt(th: number): number {
  let v = A0;
  for (const [k, a, b] of FH) v += a * Math.cos(k * th) + b * Math.sin(k * th);
  return v;
}
function lumpFn(th: number): number {
  return clamp((profileAt(th) - LIP_LO) / (LIP_HI - LIP_LO));
}

type Rgb = [number, number, number];
function hexToRgb01(hex: string): Rgb {
  const m = hex.trim().replace("#", "");
  if (m.length < 6) return [0.3, 0.4, 0.55];
  return [
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  ];
}
function lighten01(c: Rgb, amt: number): Rgb {
  return [c[0] + (1 - c[0]) * amt, c[1] + (1 - c[1]) * amt, c[2] + (1 - c[2]) * amt];
}

type Colors = { wax: Rgb; spec: Rgb; shadow: string };
const DEFAULT_COLORS: Colors = {
  wax: hexToRgb01("#2e5685"),
  spec: lighten01(hexToRgb01("#3d6b9e"), 0.72),
  shadow: "#0a1a2e",
};

type Beat = { scale: number; dome: number; relief: number; lobe: number; o: number };
function stateAt(t: number): Beat {
  // physical press (~1.71s), area-conserving in spirit: a low matte puddle sits
  // until the die contacts it (~t0.13); then the die presses — the field flattens
  // and the relief emerges (conform), and the displaced wax is pushed outward,
  // growing the lip + lobes past the die edge (lobe); then it settles and holds.
  return {
    o: clamp(win(t, 0, 0.03)),                      // already a full-size circle (the button)
    scale: 1,                                       // starts full size — no grow
    dome: 1 - sm(win(t, 0.06, 0.5)),                // ball flattens GRADUALLY (~100–850ms)
    relief: sm(win(t, 0.09, 0.54)),                 // field/ridge/emboss conform gradually
    lobe: sm(win(t, 0.12, 0.58)),                   // lip pushed outward, lobes appear gradually
  };
}

export type WaxStampProps = {
  /** increment once per keep; any change replays the press. */
  playKey: number;
  /** seal diameter, px. */
  size?: number;
  /** the letter pressed into the wax. */
  glyph?: string;
  className?: string;
};

export function WaxStamp({ playKey, size = 96, glyph = "S", className }: WaxStampProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(false);
  const colors = useRef<Colors>(DEFAULT_COLORS);
  // scratch buffers, (re)allocated when the backing size changes
  const buf = useRef<{ dim: number; hgt: Float32Array; msk: Float32Array; gly: Float32Array; off: HTMLCanvasElement; img: ImageData } | null>(null);

  useLayoutEffect(() => {
    // dev-only colour override for same-colour reference comparison (removed before ship)
    const ov = (window as Window & { __waxOverride?: Colors }).__waxOverride;
    const cs = getComputedStyle(document.documentElement);
    const wax = cs.getPropertyValue("--wax").trim();
    const bright = cs.getPropertyValue("--wax-bright").trim();
    const shadow = cs.getPropertyValue("--wax-shadow").trim();
    if (ov) {
      colors.current = ov;
    } else if (wax) {
      colors.current = {
        wax: hexToRgb01(wax),
        spec: lighten01(hexToRgb01(bright || wax), 0.72),
        shadow: shadow || colors.current.shadow,
      };
    }
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const dim = Math.round(size * dpr);
    cv.width = dim;
    cv.height = dim;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // (re)allocate scratch for this backing size
    if (!buf.current || buf.current.dim !== dim) {
      const off = document.createElement("canvas");
      off.width = dim; off.height = dim;
      buf.current = {
        dim,
        hgt: new Float32Array(dim * dim),
        msk: new Float32Array(dim * dim),
        gly: new Float32Array(dim * dim),
        off,
        img: ctx.createImageData(dim, dim),
      };
      bakeGlyph(buf.current.gly, dim, glyph);
    }
    const B = buf.current;
    const MR = dim * 0.38; // mean seal radius in backing px (room for lobes + shadow)

    const draw = (k: Beat) => {
      ctx.clearRect(0, 0, dim, dim);
      if (k.o <= 0.003) return;
      // one continuous object: a convex wax drop that flattens into the puck and
      // takes the impression — same height-field lighting throughout.
      paintSeal(B, dim, MR * k.scale, dim * 0.46, k.relief, k.lobe, k.dome, colors.current);
      B.off.getContext("2d")!.putImageData(B.img, 0, 0);
      ctx.save();
      ctx.globalAlpha = k.o;
      ctx.shadowColor = colors.current.shadow;
      ctx.shadowBlur = MR * (0.09 + 0.05 * k.scale);
      ctx.shadowOffsetY = MR * (0.05 + 0.06 * k.scale);
      ctx.drawImage(B.off, 0, 0);
      ctx.restore();
    };

    let raf = 0;
    // TODO(remove before ship): deterministic seek for visual capture
    type SeekWin = Window & { __stampSeek?: (t: number) => void };
    (window as SeekWin).__stampSeek = (t) => { cancelAnimationFrame(raf); draw(stateAt(clamp(t))); };
    const cleanup = () => { cancelAnimationFrame(raf); (window as SeekWin).__stampSeek = undefined; };

    if (reduce.current) { draw(stateAt(1)); return cleanup; }
    const t0 = performance.now();
    const DUR = 1700;
    const frame = (now: number) => {
      const t = (now - t0) / DUR;
      if (t >= 1) { draw(stateAt(1)); return; }
      draw(stateAt(t));
      raf = requestAnimationFrame(frame);
    };
    draw(stateAt(0));
    raf = requestAnimationFrame(frame);
    return cleanup;
  }, [playKey, size, glyph]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={cn("block", className)}
      style={{ width: size, height: size, overflow: "visible" }}
    />
  );
}

// rasterise the glyph once → an alpha mask used as embossed relief
function bakeGlyph(out: Float32Array, dim: number, glyph: string) {
  out.fill(0);
  if (!glyph) return;
  const gc = document.createElement("canvas");
  gc.width = dim; gc.height = dim;
  const gx = gc.getContext("2d");
  if (!gx) return;
  gx.fillStyle = "#fff";
  gx.textAlign = "center";
  gx.textBaseline = "middle";
  gx.filter = `blur(${dim * 0.006}px)`;
  gx.font = `700 ${Math.round(dim * 0.42)}px Fraunces, Georgia, "Times New Roman", serif`;
  gx.fillText(glyph, dim / 2, dim / 2 + dim * 0.01);
  const d = gx.getImageData(0, 0, dim, dim).data;
  for (let i = 0; i < dim * dim; i++) out[i] = d[i * 4 + 3] / 255;
}

// compute the lit seal into B.img (alpha 0 outside the silhouette)
function paintSeal(
  B: { hgt: Float32Array; msk: Float32Array; gly: Float32Array; img: ImageData },
  dim: number, MR: number, cy: number, relief: number, lobe: number, dome: number, col: Colors,
) {
  const cx = dim / 2;
  const hgt = B.hgt, msk = B.msk, gly = B.gly;
  const fieldR = FIELD_R * MR, ridgeR = RIDGE_R * MR, moatR = MOAT_R * MR;
  const ridgeW = RIDGE_W * (MR / 100);
  // pass 1 — height field + AA silhouette mask
  for (let py = 0; py < dim; py++) {
    const Y = py - cy;
    for (let px = 0; px < dim; px++) {
      const i = py * dim + px;
      const X = px - cx;
      const r = Math.hypot(X, Y);
      const th = Math.atan2(Y, X);
      // silhouette grows from the puddle circle out to the lobed final as the wax
      // is squished outward past the die — the lip and lobes are pushed out.
      const edge = MR * lp(PUD_EDGE, profileAt(th), lobe);
      const a = clamp((edge + 0.75 - r) / 1.5);
      msk[i] = a;
      if (a <= 0) { hgt[i] = 0; continue; }
      let h: number;
      if (r < moatR) {
        h = FIELDH + RIDGE_AMP * relief * Math.exp(-(((r - ridgeR) / ridgeW) ** 2));
      } else {
        const t = clamp((r - moatR) / (edge - moatR));
        const crestH = FIELDH + (CREST_BASE + CREST_LUMP * lumpFn(th) - FIELDH) * relief;
        if (t < CREST_FRAC) {
          const s = t / CREST_FRAC;
          h = FIELDH + (crestH - FIELDH) * sm(s);
        } else {
          const s = (t - CREST_FRAC) / (1 - CREST_FRAC);
          h = crestH * Math.pow(Math.max(0, 1 - Math.pow(s, OUT_POW)), 1 / OUT_POW);
        }
      }
      const rn = r / edge;
      hgt[i] = h + GLYPH_AMP * relief * gly[i] + dome * DOME_AMP * Math.sqrt(Math.max(0, 1 - rn * rn));
    }
  }
  // pass 2 — lighting
  const d = B.img.data;
  d.fill(0);
  const Llen = Math.hypot(LX, LY, LZ), lx = LX / Llen, ly = LY / Llen, lz = LZ / Llen;
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const ss = SS * (MR / 100);
  const specDamp = 1 - 0.32 * dome;   // bead is moderately glossy (matches the reference), seal glossy
  const [wr, wg, wb] = col.wax;
  const [sr, sg, sb] = col.spec;
  for (let py = 1; py < dim - 1; py++) {
    for (let px = 1; px < dim - 1; px++) {
      const i = py * dim + px;
      const a = msk[i];
      if (a <= 0.003) continue;
      const o = i * 4;
      const dx = (hgt[i + 1] - hgt[i - 1]) * 0.5 * ss;
      const dy = (hgt[i + dim] - hgt[i - dim]) * 0.5 * ss;
      let nx = -dx, ny = -dy, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
      const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
      const spec = Math.pow(ndh, SHIN);
      const slope = Math.hypot(dx, dy);
      const gloss = SPEC_STR * specDamp * (1 + (SPEC_RIM - 1) * clamp(slope * 0.5));
      // diagonal form shadow: brighter toward the upper-left light, deeper amber
      // toward the lower-right — gives the seal global 3-D depth like the reference
      const env = 1 + ENV * (((cx - px) + (cy - py)) / dim);
      const lf = (AMBIENT + DIFF * ndl) * env;
      let R = wr * lf + sr * spec * gloss;
      let G = wg * lf + sg * spec * gloss;
      let Bl = wb * lf + sb * spec * gloss;
      R = Math.min(clamp(R), HICAP);
      G = Math.min(clamp(G), HICAP);
      Bl = Math.min(clamp(Bl), HICAP * 0.98);
      d[o] = Math.round(Math.pow(R, 1 / 1.38) * 255);
      d[o + 1] = Math.round(Math.pow(G, 1 / 1.38) * 255);
      d[o + 2] = Math.round(Math.pow(Bl, 1 / 1.38) * 255);
      d[o + 3] = Math.round(a * 255);
    }
  }
}
