"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* ── the wax stamp ────────────────────────────────────────────────
   A pressed wax seal, rendered as a real 3-D one: a per-pixel height
   field (flat pressed field → a thin raised ridge → a moat at field
   level → a rounded lip that rolls over like the outside of a donut,
   undulating into irregular lobes) lit with Lambert diffuse +
   Blinn-Phong specular. Highlights stay a pale tint and shadows stay a
   deep tint of the same wax — never white, never black. Every press
   generates its own silhouette (5–7 lobes, random rotation and spacing)
   within the trough/peak extents measured from a real wax seal, so no
   two seals are identical. The lip/field proportions are measured too.
   The glyph is embossed
   into the same field so it is lit identically. Colour comes from the
   live `--wax*` tokens, so it themes for Paper and Lamplight.

   A keep plays the press: a bead drops and grows, spreads into a puck
   with no vertical squash (the die presses on z, the wax spreads
   radially), then the relief emerges — ridge, moat, lip and glyph rise
   out of the flat puck — and settles. Replays when `playKey` changes;
   collapses to the settled seal under reduced motion. */

// silhouette r(θ)/rmean — measured from a real seal as ~6 lobes spanning
// [LIP_LO, LIP_HI]. Rather than one fixed Fourier fit, every press generates its
// own profile in that family (see makeProfile) so no two seals are identical.
const LIP_LO = 0.94, LIP_HI = 1.075; // trough/peak silhouette radius; also lump 0..1

// radial structure (fractions of mean radius) + heights (0..1)
const FIELD_R = 0.68, RIDGE_R = 0.745, MOAT_R = 0.8;
const FIELDH = 0.45;          // field AND moat baseline
const RIDGE_AMP = 0.18, RIDGE_W = 2.5; // raised ring (world units ~ /100 of MR)
const CREST_BASE = 0.82, CREST_LUMP = 0.38; // trough crest ≈ ridge; lobes higher
const CREST_FRAC = 0.56, OUT_POW = 3.1;     // crest position; donut roll shape
const GLYPH_AMP = 0.54;
const DOME_AMP = 8;           // a low rounded circle (button-like), NOT a sphere
const PUD_EDGE = 0.86;        // puddle radius (×MR); the lip squishes out past this

// lighting
const SS = 4.5;               // height→slope: high relief so it reads glossy, not flat
const LX = -0.52, LY = -0.52, LZ = 0.54;
const AMBIENT = 0.26, DIFF = 1.18;
const SPEC_STR = 1.35, SHIN = 19, SPEC_RIM = 3.7, ENV = 0.33, HICAP = 0.99;
const SPEC_AA = 5;            // roughen (roll specular off) on steep walls → no edge sparkle

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const sm = (t: number) => t * t * (3 - 2 * t);
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const eob = (t: number) => { t = clamp(t); const c = 2.0; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }; // ease-out-back (overshoot)
const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// scale "juice" variations, chosen per-instance via the `variant` prop
const popScale = (t: number) => 1 + 0.028 * Math.sin(clamp(win(t, 0.05, 0.3)) * Math.PI); // small impact pop
const springScale = (t: number) => { // springs inward, bounces outward, settles
  const p = clamp((t - 0.02) / 0.74);
  return p <= 0 ? 1 : 1 - 0.16 * Math.exp(-2.1 * p) * Math.sin(6.6 * p);
};

// a tiny seeded PRNG so each press is deterministic per playKey (both lab seals
// match within a play) yet every new keep reshuffles the seal.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Profile = (th: number) => number;
// build a per-press silhouette r(θ): N∈[5,7] lobes from a dominant harmonic k=N,
// plus smaller neighbours k=N±1 with random amplitude+phase (→ irregular lobe
// sizes and spacing), and a random overall rotation. Remapped so the trough/peak
// extents stay [LIP_LO, LIP_HI] — about the same as the measured seal every time.
function makeProfile(rand: () => number): Profile {
  const N = 5 + Math.floor(rand() * 3);   // 5..7 lobes
  const phase = rand() * TAU;             // overall rotation
  const aLo = 0.18 + rand() * 0.16;       // k=N-1: varies lobe sizes
  const aHi = 0.12 + rand() * 0.14;       // k=N+1: varies lobe spacing
  const pLo = rand() * TAU, pHi = rand() * TAU;
  const raw = (th: number) =>
    Math.cos(N * (th - phase)) +
    aLo * Math.cos((N - 1) * th - pLo) +
    aHi * Math.cos((N + 1) * th - pHi);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < 720; i++) {
    const v = raw((i / 720) * TAU);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  return (th: number) => LIP_LO + ((raw(th) - mn) / span) * (LIP_HI - LIP_LO);
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
  spec: lighten01(hexToRgb01("#3d6b9e"), 0.5),
  shadow: "#0a1a2e",
};

type Variant = "pop" | "spring";
type Ease = "even" | "front" | "snap";
// remap the timeline so the press (first half) runs faster, leaving more settle/hold
const easeT = (t: number, e: Ease) =>
  e === "front" ? 1 - Math.pow(1 - t, 2.3) : e === "snap" ? 1 - Math.pow(1 - t, 3.6) : t;
type Beat = { scale: number; dome: number; relief: number; lobe: number; cf: number; rot: number; o: number };
function stateAt(t: number, variant: Variant, ease: Ease): Beat {
  const tp = easeT(t, ease); // front-loaded timeline for the press beats
  // physical press (~1.71s): a low matte circle, then the die presses. The die
  // only imprints where it has reached the wax — a contact front (cf) spreading
  // from the centre outward — so the emblem (centre) appears first and the ridge
  // (near the die's edge) imprints LAST, not before the edge has touched. The
  // displaced wax is pushed outward, growing the lip + lobes (lobe); then settles.
  return {
    o: clamp(win(t, 0, 0.03)),                      // fade-in on real time
    scale: variant === "spring" ? springScale(tp) : popScale(tp), // juicy scale (pop or spring)
    dome: 1 - sm(win(tp, 0.06, 0.5)),               // circle flattens
    relief: sm(win(tp, 0.09, 0.54)),                // lip displacement / field conform
    lobe: sm(win(tp, 0.12, 0.58)),                  // lip pushed outward, lobes appear
    cf: (MOAT_R + 0.05) * sm(win(tp, 0.08, 0.6)),   // contact front: centre → die edge
    rot: 0.5 * (1 - eob(win(tp, 0.04, 0.62))),      // ~28° twist, settling upright
  };
}

export type WaxStampProps = {
  /** increment once per keep; any change replays the press. */
  playKey: number;
  /** seal diameter, px. */
  size?: number;
  /** the letter or icon pressed into the wax (e.g. "S", "quill", "mic"). */
  glyph?: string;
  /** the scale "juice": a small impact pop, or a spring in→out. */
  variant?: Variant;
  /** timeline shaping: "even", or front-loaded so the press runs faster. */
  ease?: Ease;
  className?: string;
};

export function WaxStamp({ playKey, size = 96, glyph = "S", variant = "pop", ease = "front", className }: WaxStampProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(false);
  const colors = useRef<Colors>(DEFAULT_COLORS);
  // scratch buffers, (re)allocated when the backing size changes
  const buf = useRef<{ dim: number; hgt: Float32Array; msk: Float32Array; gly: Float32Array; off: HTMLCanvasElement; img: ImageData; baked: string } | null>(null);

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
        spec: lighten01(hexToRgb01(bright || wax), 0.5),
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
        baked: "",
      };
    }
    const B = buf.current;
    if (B.baked !== glyph) { bakeGlyph(B.gly, dim, glyph); B.baked = glyph; } // re-bake on glyph change
    const MR = dim * 0.38; // mean seal radius in backing px (room for lobes + shadow)
    // a fresh seal each keep: 5–7 lobes, random rotation/spacing, same extents.
    // Seeded by playKey so the lab's two seals match within a play, every replay differs.
    const prof = makeProfile(mulberry32(Math.imul(playKey, 0x9e3779b1) >>> 0));

    const draw = (k: Beat) => {
      ctx.clearRect(0, 0, dim, dim);
      if (k.o <= 0.003) return;
      // one continuous object: a convex wax drop that flattens into the puck and
      // takes the impression — same height-field lighting throughout.
      paintSeal(B, dim, MR * k.scale, dim * 0.46, k.relief, k.lobe, k.dome, k.cf, colors.current, prof);
      B.off.getContext("2d")!.putImageData(B.img, 0, 0);
      ctx.save();
      ctx.globalAlpha = k.o;
      // entrance twist: the wax is rotated as the stamp presses, settling upright
      ctx.translate(dim / 2, dim * 0.46);
      ctx.rotate(k.rot);
      ctx.translate(-dim / 2, -dim * 0.46);
      ctx.shadowColor = colors.current.shadow;
      ctx.shadowBlur = MR * (0.09 + 0.05 * k.scale);
      ctx.shadowOffsetY = MR * (0.05 + 0.06 * k.scale);
      ctx.drawImage(B.off, 0, 0);
      ctx.restore();
    };

    let raf = 0;
    // TODO(remove before ship): deterministic seek for visual capture
    type SeekWin = Window & { __stampSeek?: (t: number) => void };
    (window as SeekWin).__stampSeek = (t) => { cancelAnimationFrame(raf); draw(stateAt(clamp(t), variant, ease)); };
    const cleanup = () => { cancelAnimationFrame(raf); (window as SeekWin).__stampSeek = undefined; };

    if (reduce.current) { draw(stateAt(1, variant, ease)); return cleanup; }
    const t0 = performance.now();
    const DUR = 1150;
    const frame = (now: number) => {
      const t = (now - t0) / DUR;
      if (t >= 1) { draw(stateAt(1, variant, ease)); return; }
      draw(stateAt(t, variant, ease));
      raf = requestAnimationFrame(frame);
    };
    draw(stateAt(0, variant, ease));
    raf = requestAnimationFrame(frame);
    return cleanup;
  }, [playKey, size, glyph, variant, ease]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={cn("block", className)}
      style={{ width: size, height: size, overflow: "visible" }}
    />
  );
}

// The masthead "Snippets" reads friendly because Fraunces renders at a small
// optical size; the seal "S" must match it. Canvas can't set the opsz axis (and
// an SVG <img> ignores it too), so we bake the italic Fraunces "S" pre-instanced
// at opsz≈22 (wght 600, WONK 1) as a vector outline — font units, 2000 UPM, Y-up
// (flip for canvas). Centre of its ink bounds is (S_CX, S_CY).
const GLYPH_UPM = 2000;
const S_CX = 661.3, S_CY = 701.5;
const S_PATH =
  "M575 -23Q489 -23 432 -7Q374 10 339 32Q304 54 283 71Q262 87 250 87Q237 87 220 72Q203 57 184 36Q164 16 145 1Q126 -14 108 -14Q80 -14 66 1Q53 16 56 48L100 401Q103 435 119 453Q134 471 158 471Q181 471 196 455Q211 439 223 407L245 302Q264 191 339 134Q414 76 517 76Q581 76 631 100Q680 123 710 165Q740 207 749 264Q764 350 719 424Q675 499 543 582Q392 678 329 777Q266 876 282 1009Q294 1120 360 1215Q427 1310 545 1368Q664 1426 832 1426Q976 1426 1074 1380Q1172 1334 1221 1262Q1271 1189 1267 1109Q1265 1053 1236 1016Q1207 979 1156 979Q1114 979 1088 1002Q1062 1026 1045 1079L1025 1156Q1002 1248 947 1292Q893 1336 814 1336Q739 1336 683 1307Q627 1277 594 1227Q561 1177 553 1115Q540 1023 588 947Q635 871 761 784Q882 704 946 633Q1010 562 1032 490Q1053 417 1043 334Q1032 228 970 147Q908 67 806 22Q705 -23 575 -23Z";

// rasterise the glyph/icon once → an alpha mask used as embossed relief.
// Drawn oversampled and box-downsampled (+ a whisper of blur) so the edges are
// crisp yet anti-aliased — sharp, without the relief lighting stair-stepping.
function bakeGlyph(out: Float32Array, dim: number, glyph: string) {
  out.fill(0);
  if (!glyph) return;
  const OV = 3, big = dim * OV;          // oversample factor + working resolution
  const gc = document.createElement("canvas");
  gc.width = big; gc.height = big;
  const gx = gc.getContext("2d");
  if (!gx) return;
  gx.fillStyle = "#fff"; gx.strokeStyle = "#fff";
  gx.lineCap = "round"; gx.lineJoin = "round";
  const cx = big / 2, cy = big * 0.46;
  // the app's own icons (shell-nav quill/calendar, the record mic) live in a
  // 0–20 viewBox with stroke-width ~1.5 — reuse them verbatim, centred & scaled
  // into the seal field with a fine stroke.
  const APP_ICONS: Record<string, () => void> = {
    quill() {
      gx.lineWidth = 1.7;
      for (const dd of [
        "M4.4 15.6C5.2 10.2 9 5.6 16 3.8c.5 2.7-.7 6.6-3.2 9.1-1.9 1.9-4.9 2.7-8.4 2.7Z",
        "M4.4 15.6 12.6 7", "M4.4 15.6 3.4 17.6",
      ]) gx.stroke(new Path2D(dd));
    },
    mic() {
      gx.beginPath(); gx.roundRect(7.4, 2.6, 5.2, 9.2, 2.6); gx.fill();
      gx.lineWidth = 1.8;
      gx.stroke(new Path2D("M4.6 9.8 a5.4 5.4 0 0 0 10.8 0"));
      gx.stroke(new Path2D("M10 15.2 V17.6"));
    },
    calendar() {
      gx.lineWidth = 1.7;
      gx.beginPath(); gx.roundRect(3.2, 4.6, 13.6, 12, 2.2); gx.stroke();
      gx.stroke(new Path2D("M6.8 2.8v3.4M13.2 2.8v3.4M3.2 9h13.6"));
    },
    check() {
      gx.lineWidth = 1.9;
      gx.stroke(new Path2D("M4.6 10.6 L8.6 14.8 L15.4 5.6"));
    },
  };
  if (glyph === "S") {
    // friendly opsz≈22 italic Fraunces "S", baked from its vector outline so it
    // matches the masthead regardless of canvas's lack of opsz control.
    const s = (0.46 * big) / GLYPH_UPM;
    gx.save();
    gx.translate(cx, cy); gx.scale(s, -s); gx.translate(-S_CX, -S_CY);
    gx.fill(new Path2D(S_PATH));
    gx.restore();
  } else if (APP_ICONS[glyph]) {
    const sc = (0.48 * big) / 20;            // fit the 0–20 viewBox into the field
    gx.save();
    gx.translate(cx, cy); gx.scale(sc, sc); gx.translate(-10, -10);
    APP_ICONS[glyph]();
    gx.restore();
  } else {
    // other letters: canvas text (Fraunces italic) — no opsz control, but the
    // default and only shipped glyph is "S", handled above.
    const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-fraunces").trim();
    gx.textAlign = "center"; gx.textBaseline = "middle";
    gx.font = `italic 560 ${Math.round(big * 0.46)}px ${fam || "Fraunces"}, Georgia, "Times New Roman", serif`;
    gx.fillText(glyph, cx, cy);
  }
  // downsample to backing res: high-quality averaging anti-aliases the edges,
  // a whisper of blur keeps the relief lighting from biting on the last hard pixel.
  const dc = document.createElement("canvas");
  dc.width = dim; dc.height = dim;
  const dx = dc.getContext("2d");
  if (!dx) return;
  dx.filter = `blur(${dim * 0.0035}px)`;
  dx.imageSmoothingEnabled = true;
  dx.imageSmoothingQuality = "high";
  // recentre on the seal's centre from the glyph's actual ink bounds — a font's
  // "middle" baseline and an icon's viewBox aren't centred on their own glyph.
  const src = gx.getImageData(0, 0, big, big).data;
  let minX = big, minY = big, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < big; y += OV) {
    for (let x = 0; x < big; x += OV) {
      if (src[(y * big + x) * 4 + 3] > 8) {
        any = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const tx = any ? dim / 2 - (minX + maxX) / (2 * OV) : 0;
  const ty = any ? dim * 0.46 - (minY + maxY) / (2 * OV) : 0;
  dx.drawImage(gc, 0, 0, big, big, tx, ty, dim, dim);
  const d = dx.getImageData(0, 0, dim, dim).data;
  for (let i = 0; i < dim * dim; i++) out[i] = d[i * 4 + 3] / 255;
}

// compute the lit seal into B.img (alpha 0 outside the silhouette)
function paintSeal(
  B: { hgt: Float32Array; msk: Float32Array; gly: Float32Array; img: ImageData },
  dim: number, MR: number, cy: number, relief: number, lobe: number, dome: number, cf: number, col: Colors, prof: Profile,
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
      const p = prof(th);
      const edge = MR * lp(PUD_EDGE, p, lobe);
      const a = clamp((edge + 0.55 - r) / 1.05);
      msk[i] = a;
      if (a <= 0) { hgt[i] = 0; continue; }
      // contact front: the die has imprinted only out to radius cf (·MR), spreading
      // from the centre, so the emblem appears first and the ridge imprints last.
      const cl = clamp((cf + 0.05 - r / MR) / 0.1);
      let h: number;
      if (r < moatR) {
        h = FIELDH + RIDGE_AMP * cl * Math.exp(-(((r - ridgeR) / ridgeW) ** 2));
      } else {
        const t = clamp((r - moatR) / (edge - moatR));
        const lump = clamp((p - LIP_LO) / (LIP_HI - LIP_LO));
        const crestH = FIELDH + (CREST_BASE + CREST_LUMP * lump - FIELDH) * relief;
        if (t < CREST_FRAC) {
          const s = t / CREST_FRAC;
          h = FIELDH + (crestH - FIELDH) * sm(s);
        } else {
          const s = (t - CREST_FRAC) / (1 - CREST_FRAC);
          h = crestH * Math.pow(Math.max(0, 1 - Math.pow(s, OUT_POW)), 1 / OUT_POW);
        }
      }
      const rn = r / edge;
      hgt[i] = h + GLYPH_AMP * cl * gly[i] + dome * DOME_AMP * Math.sqrt(Math.max(0, 1 - rn * rn));
    }
  }
  // pass 2 — lighting
  const d = B.img.data;
  d.fill(0);
  const Llen = Math.hypot(LX, LY, LZ), lx = LX / Llen, ly = LY / Llen, lz = LZ / Llen;
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const ss = SS * (MR / 100);
  const specDamp = 1 - 0.6 * dome;    // pre-press circle is low-sheen (matte-ish); pressed seal glossy
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
      // geometric specular AA: a near-vertical wall (the glyph emboss, the outer
      // lip roll) packs the sharp highlight into sub-pixel width, so it sparkles
      // and the edge reads "pixelated". Roughen — roll the specular off as slope
      // climbs — so steep edges stay defined by the (sharp) diffuse shadow, not glitter.
      const aa = 1 / (1 + SPEC_AA * slope * slope);
      const gloss = SPEC_STR * specDamp * (1 + (SPEC_RIM - 1) * clamp(slope * 0.5)) * aa;
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
      d[o] = Math.round(Math.pow(R, 1 / 1.08) * 255);
      d[o + 1] = Math.round(Math.pow(G, 1 / 1.08) * 255);
      d[o + 2] = Math.round(Math.pow(Bl, 1 / 1.08) * 255);
      d[o + 3] = Math.round(a * 255);
    }
  }
}
