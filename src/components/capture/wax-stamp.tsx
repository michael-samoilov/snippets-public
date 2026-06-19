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
const GLYPH_AMP = 0.55;       // base plateau height (gives the crisp, steep edges)
const GLYPH_CROWN = 0.8;      // domed crown on top → reads as raised VOLUME, not a flat plateau
const GLYPH_ROUND = 0.022;    // crown blur (×dim): rounds the crown into a dome
// resting glob shape: a `puck` factor (0 = round globe, 1 = flat puck) maps to
// dome height + top-flatness between these globe→puck endpoints.
const DOME_AMP_HI = 9, DOME_AMP_LO = 2.5;  // height: globe → flat
const DOME_POW_LO = 2, DOME_POW_HI = 5;    // top: hemisphere → flat-top
const PUD_EDGE = 0.86;        // puddle radius (×MR); the lip squishes out past this

// lighting
const SS = 4.5;               // height→slope: high relief so it reads glossy, not flat
const LX = -0.52, LY = -0.52, LZ = 0.54;
const AMBIENT = 0.26, DIFF = 1.18;
const SPEC_STR = 1.35, SHIN = 19, SPEC_RIM = 3.7, ENV = 0.33, HICAP = 0.99;
const SPEC_AA = 5;            // roughen (roll specular off) on steep walls → no edge sparkle
const HI_KNEE = 0.74;        // highlights roll off above this (soft, not blown/harsh)
const GLYPH_SHADE_LIFT = 0.3; // lift the embossed glyph's shadow side so it isn't harsh

// metallic texture (gold · bronze · silver), two independent controls:
//  • speckle → suspended micro-facets that re-reflect the light as sharp glints
//  • cloud   → a faint low-frequency swirl in the base lightness (molten look)
// Both gated by their props, so the matte blue ship path pays nothing.
const FLAKE_REL = 0.011;     // flake cell (×dim): larger → distinct points, not grain
const FLAKE_THRESH = 0.5;    // cells above this hash bear a flake (sparse sprinkle)
const FLAKE_TIGHT = 7;       // point tightness within the cell (higher = smaller point)
const FLAKE_TILT = 0.42;     // facet tilt off the normal (smaller → cluster at highlight)
const FLAKE_SHIN = 70;       // facet exponent — sharp pinpoint glints
const FLAKE_STR = 2.6;       // glint boost folded into the specular lobe (× speckle)
const GRAIN_REL = 0.055;     // molten-cloud cell as a fraction of dim
const GRAIN_STR = 0.18;      // cloud lightness wobble (× cloud)

// soft highlight shoulder: ease values toward `cap` instead of hard-clipping, so
// bright highlights roll off gently rather than blowing out to a harsh flat patch.
const softclip = (x: number, knee: number, cap: number) =>
  x <= 0 ? 0 : x < knee ? x : knee + (cap - knee) * (1 - Math.exp((knee - x) / (cap - knee)));

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const sm = (t: number) => t * t * (3 - 2 * t);
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const eob = (t: number) => { t = clamp(t); const c = 2.0; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }; // ease-out-back (overshoot)
const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// scale "juice" variations, chosen per-instance via the `variant` prop
const popScale = (t: number) => 1 + 0.028 * Math.sin(clamp(win(t, 0.05, 0.3)) * Math.PI); // small impact pop
const springScale = (t: number, amp: number) => { // springs inward, bounces outward, settles (lively)
  const p = clamp((t - 0.02) / 0.82);
  if (p <= 0 || p >= 1) return 1;        // (1-p) envelope guarantees a clean settle at 1
  return 1 - amp * Math.exp(-1.15 * p) * (1 - p) * Math.sin(12.5 * p);
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

// integer hash → [0,1): deterministic per-cell randomness for the metallic
// flake/grain. Keyed on seal-image pixels so the flecks transform with the seal.
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Profile = (th: number) => number;
// build a per-press silhouette r(θ): N∈[5,7] lobes from a dominant harmonic k=N,
// plus smaller neighbours k=N±1 with random amplitude+phase (→ irregular lobe
// sizes and spacing), and a random overall rotation. Remapped so the trough/peak
// extents stay [LIP_LO, LIP_HI] — about the same as the measured seal every time.
function makeProfile(rand: () => number): Profile {
  const u = rand();
  const N = u < 3 / 6 ? 5 : u < 5 / 6 ? 6 : 7;   // 5..7 lobes, weighted 3:2:1
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

// a wax colour: base, a brighter tone for the specular, and a deep drop shadow.
export type Tint = { wax: string; bright: string; shadow: string };
// highlight stays a PALE TINT, never near-white: lighten the bright tone but cap
// each channel, so a light base (e.g. Lamplight's pale blue) doesn't blow out.
const paleSpec = (hex: string): Rgb => {
  const c = lighten01(hexToRgb01(hex), 0.5);
  return [Math.min(c[0], 0.84), Math.min(c[1], 0.84), Math.min(c[2], 0.85)];
};
// resolve the seal colours: an explicit tint wins, else the dev override, else
// the live --wax* tokens (so it themes for Paper/Lamplight).
function resolveColors(tint?: Tint): Colors {
  if (tint) return { wax: hexToRgb01(tint.wax), spec: paleSpec(tint.bright), shadow: tint.shadow };
  const ov = (window as Window & { __waxOverride?: Colors }).__waxOverride;
  if (ov) return ov;
  const cs = getComputedStyle(document.documentElement);
  const wax = cs.getPropertyValue("--wax").trim();
  const bright = cs.getPropertyValue("--wax-bright").trim();
  const shadow = cs.getPropertyValue("--wax-shadow").trim();
  return wax
    ? { wax: hexToRgb01(wax), spec: paleSpec(bright || wax), shadow: shadow || DEFAULT_COLORS.shadow }
    : DEFAULT_COLORS;
}

// layered drop shadow (× MR): [blur, offsetY, alpha] — a soft, elevated stack:
// wide ambient → mid → tight contact, so the seal reads as lifted off the paper.
const SHADOW_LAYERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.28, 0.135, 0.12], [0.13, 0.075, 0.18], [0.05, 0.03, 0.3],
];
// shadow colour at a given alpha, from either a hex or an rgb()/rgba() token.
function shadowRgba(c: string, a: number): string {
  let r = 18, g = 28, b = 45;
  const hex = c.match(/#([0-9a-fA-F]{6})/);
  if (hex) { r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16); }
  else { const m = c.match(/(\d+)[ ,]+(\d+)[ ,]+(\d+)/); if (m) { r = +m[1]; g = +m[2]; b = +m[3]; } }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

type Variant = "pop" | "spring";
type Ease = "even" | "front" | "snap";
// "press": play the press once on mount/playKey, then hold the settled seal (the
// shipped keep confirmation). "loop": auto-cycle the whole lifecycle (lab).
// "tap": rest as the dome; play one full lifecycle when playKey changes (lab).
type PlayMode = "press" | "loop" | "tap";
// remap the timeline so the press (first half) runs faster, leaving more settle/hold
const easeT = (t: number, e: Ease) =>
  e === "front" ? 1 - Math.pow(1 - t, 2.3) : e === "snap" ? 1 - Math.pow(1 - t, 3.6) : t;
type Beat = { scale: number; dome: number; relief: number; lobe: number; cf: number; rot: number; o: number; oy: number; iconWhite: number };
function stateAt(t: number, variant: Variant, ease: Ease, bounce: number, rotate: number): Beat {
  const tp = easeT(t, ease); // front-loaded timeline for the press beats
  // physical press (~1.71s): a low matte circle, then the die presses. The die
  // only imprints where it has reached the wax — a contact front (cf) spreading
  // from the centre outward — so the emblem (centre) appears first and the ridge
  // (near the die's edge) imprints LAST, not before the edge has touched. The
  // displaced wax is pushed outward, growing the lip + lobes (lobe); then settles.
  return {
    o: clamp(win(t, 0, 0.03)),                      // fade-in on real time
    scale: variant === "spring" ? springScale(tp, 0.2 * bounce) : popScale(tp), // juicy scale (pop or spring)
    dome: 1 - sm(win(tp, 0.06, 0.5)),               // circle flattens
    relief: sm(win(tp, 0.09, 0.54)),                // lip displacement / field conform
    lobe: sm(win(tp, 0.12, 0.58)),                  // lip pushed outward, lobes appear
    cf: (MOAT_R + 0.05) * sm(win(tp, 0.08, 0.6)),   // contact front: centre → die edge
    rot: (rotate * Math.PI / 180) * (1 - eob(win(tp, 0.04, 0.62))), // entrance twist, settling upright
    oy: 0,
    iconWhite: 1 - sm(win(tp, 0.05, 0.26)),         // white label gives way to the embossed stamp
  };
}

// ── full lifecycle (lab preview) ──────────────────────────────────
// a wax drop expands into the resting dome, waits, is pressed, lingers at the
// settled seal, then exits; loops. Lets us tune the linger + exit by feel.
type Exit = "fade" | "rise" | "shrink" | "grow";
const DROP_MS = 420, IDLE_MS = 360, PRESS_MS = 1150;
const PRESSED_SCALE = 0.89, PRESSED_OY = 0.09; // how far the dome presses toward the paper
// the resting/dropping dome (no relief); shows the glyph as a white label (iconWhite).
const domeBeat = (scale: number, o: number, iconWhite = 1): Beat =>
  ({ scale, o, dome: 1, relief: 0, lobe: 0, cf: 0, rot: 0, oy: 0, iconWhite });
// press-down (q: 0→1): the dome presses toward the paper AND pre-rotates to the
// press's start angle, so the lift-off continues from here with no jump.
const pushdownBeat = (q: number, rotate: number): Beat =>
  ({ scale: lp(1, PRESSED_SCALE, q), o: 1, dome: 1, relief: 0, lobe: 0, cf: 0,
    rot: (rotate * Math.PI / 180) * q, oy: PRESSED_OY * q, iconWhite: 1 });
// release: scale grows continuously from the pressed size outward (no jump back to
// full size first), overshooting a touch with `bounce`, then settles at 1.
const releaseScale = (tp: number, bounce: number) => {
  const p = clamp(tp / 0.85);
  if (p >= 1) return 1;
  const grow = PRESSED_SCALE + (1 - PRESSED_SCALE) * eo(p);
  return grow + bounce * 0.11 * Math.exp(-2.4 * p) * (1 - p) * Math.sin(6.2 * p);
};
function cycleBeat(
  e: number, variant: Variant, ease: Ease, bounce: number, rotate: number,
  lingerMs: number, exitMs: number, exit: Exit,
): Beat {
  const tIdle = DROP_MS + IDLE_MS, tPress = tIdle + PRESS_MS, tLinger = tPress + lingerMs;
  if (e < DROP_MS) return domeBeat(lp(0.2, 1, eo(e / DROP_MS)), clamp(e / 150)); // drop expands in
  if (e < tIdle) return domeBeat(1, 1);                                          // rests, waiting
  if (e < tPress) { const b = stateAt((e - tIdle) / PRESS_MS, variant, ease, bounce, rotate); b.o = 1; return b; }
  if (e < tLinger) { const b = stateAt(1, variant, ease, bounce, rotate); b.o = 1; return b; } // linger
  const p = clamp((e - tLinger) / exitMs);                                       // exit
  const b = stateAt(1, variant, ease, bounce, rotate);
  applyExit(b, exit, p);
  return b;
}

function applyExit(b: Beat, exit: Exit, p: number) {
  b.o = 1 - eo(p);
  if (exit === "shrink") b.scale *= 1 - 0.28 * p;
  else if (exit === "grow") b.scale *= 1 + 0.22 * p;
  else if (exit === "rise") b.oy = -0.55 * eo(p);
}

// one tap-triggered play from the resting dome: press → linger → exit → a new
// drop expands back into the resting dome. (Returns the resting dome past the end.)
const TAP_TOTAL = (lingerMs: number, exitMs: number) => PRESS_MS + lingerMs + exitMs + DROP_MS;
function tapBeat(
  e: number, variant: Variant, ease: Ease, bounce: number, rotate: number,
  lingerMs: number, exitMs: number, exit: Exit,
): Beat {
  const tLinger = PRESS_MS + lingerMs, tExit = tLinger + exitMs;
  if (e < PRESS_MS) { // press: grow + lift continuously from the pressed-down size
    const tp = easeT(e / PRESS_MS, ease);
    const b = stateAt(e / PRESS_MS, variant, ease, bounce, rotate);
    b.o = 1;
    b.scale = releaseScale(tp, bounce);
    b.oy = PRESSED_OY * (1 - eo(clamp(tp / 0.45)));
    return b;
  }
  if (e < tLinger) { const b = stateAt(1, variant, ease, bounce, rotate); b.o = 1; return b; }            // linger
  if (e < tExit) { const b = stateAt(1, variant, ease, bounce, rotate); applyExit(b, exit, clamp((e - tLinger) / exitMs)); return b; }
  const p = clamp((e - tExit) / DROP_MS);                                                                  // a fresh drop returns
  return domeBeat(lp(0.2, 1, eo(p)), clamp((e - tExit) / 150));
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
  /** spring liveliness multiplier (1 = default); higher = bouncier. */
  bounce?: number;
  /** entrance twist in degrees (the wax is rotated as the die presses, then settles). */
  rotate?: number;
  /** play behaviour: "press" (default, ship), "loop" or "tap" (lab). */
  mode?: PlayMode;
  /** lab: ms to hold the settled seal before it exits. */
  lingerMs?: number;
  /** lab: ms for the exit animation. */
  exitMs?: number;
  /** lab: exit style — fade, rise, shrink, grow. */
  exit?: Exit;
  /** override the wax colour (else reads the live --wax* tokens). */
  tint?: Tint;
  /** resting-glob flatness: 0 = round globe, 1 = flat puck. */
  puck?: number;
  /** icon glyph size as a fraction of the seal (smaller keeps it inside the ridge). */
  iconScale?: number;
  /** lab/tap: held-down feedback while the thumb is on the button (before release). */
  pressed?: boolean;
  /** metallic glint strength (0 = none); micro-facets that catch the light. */
  speckle?: number;
  /** molten-cloud strength (0 = none); a low-frequency swirl in the lightness. */
  cloud?: number;
  /** render the settled seal immediately, with no entrance animation. */
  still?: boolean;
  /** render the embossed glyph white (keeps its relief) instead of wax-coloured. */
  whiteGlyph?: boolean;
  /** render the embossed glyph in this colour (hex) — overrides whiteGlyph (e.g. the ink). */
  glyphColor?: string;
  /** how much of the seal the "S"/letter fills (0.46 default; higher = thinner wax border). */
  glyphScale?: number;
  /** render the backing canvas at this multiple over device pixels — sharper for
      a small, mostly-static seal (e.g. the masthead) where the dpr cap would
      otherwise undersample it. Default 1 (no supersampling). */
  superSample?: number;
  className?: string;
};

export function WaxStamp({ playKey, size = 96, glyph = "S", variant = "spring", ease = "front", bounce = 1.5, rotate = 5, mode = "press", lingerMs = 1000, exitMs = 200, exit = "grow", tint, puck = 1, iconScale = 0.4, pressed = false, speckle = 0, cloud = 0, still = false, whiteGlyph = false, glyphColor, glyphScale = 0.46, superSample = 1, className }: WaxStampProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(false);
  const lastKey = useRef<number | null>(null); // tap mode: distinguish mount from a tap
  const colors = useRef<Colors>(DEFAULT_COLORS);
  // scratch buffers, (re)allocated when the backing size changes
  const buf = useRef<{ dim: number; hgt: Float32Array; msk: Float32Array; gly: Float32Array; glyR: Float32Array; off: HTMLCanvasElement; comp: HTMLCanvasElement; iconImg: HTMLCanvasElement; img: ImageData; baked: string; bakedScale: number; bakedGlyphScale: number } | null>(null);

  useLayoutEffect(() => {
    colors.current = resolveColors(tint); // tint > dev override > --wax* tokens
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [tint]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const dim = Math.round(size * dpr * superSample);
    cv.width = dim;
    cv.height = dim;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // (re)allocate scratch for this backing size
    if (!buf.current || buf.current.dim !== dim) {
      const mk = () => { const c = document.createElement("canvas"); c.width = dim; c.height = dim; return c; };
      buf.current = {
        dim,
        hgt: new Float32Array(dim * dim),
        msk: new Float32Array(dim * dim),
        gly: new Float32Array(dim * dim),
        glyR: new Float32Array(dim * dim),
        off: mk(),
        comp: mk(),     // composite: layered shadow + body + white icon label
        iconImg: mk(),  // the glyph in white, for the resting-dome label
        img: ctx.createImageData(dim, dim),
        baked: "",
        bakedScale: -1,
        bakedGlyphScale: -1,
      };
    }
    const B = buf.current;
    if (B.baked !== glyph || B.bakedScale !== iconScale || B.bakedGlyphScale !== glyphScale) { // re-bake on glyph or size change
      bakeGlyph(B.gly, B.glyR, B.iconImg, dim, glyph, iconScale, glyphScale); B.baked = glyph; B.bakedScale = iconScale; B.bakedGlyphScale = glyphScale;
    }
    colors.current = resolveColors(tint); // refresh (theme/tint may have changed)
    const MR = dim * 0.38; // mean seal radius in backing px (room for lobes + shadow)
    // a fresh seal each keep: 5–7 lobes, random rotation/spacing, same extents.
    // Seeded by playKey so the lab's two seals match within a play, every replay differs.
    const prof = makeProfile(mulberry32(Math.imul(playKey, 0x9e3779b1) >>> 0));
    // resting-glob shape: puck 0 → round globe, 1 → flat puck, >1 → flatter still.
    // Height falls off exponentially (stays positive past 1); top keeps flattening.
    const domeAmp = DOME_AMP_HI * Math.pow(DOME_AMP_LO / DOME_AMP_HI, puck);
    const domePow = DOME_POW_LO + (DOME_POW_HI - DOME_POW_LO) * puck;

    // embossed-glyph colour: an explicit glyphColor wins, else white, else wax.
    const gcol: Rgb | null = glyphColor ? hexToRgb01(glyphColor) : whiteGlyph ? [1, 1, 1] : null;
    const cy = dim * 0.46;
    const draw = (k: Beat, p: Profile = prof) => {
      ctx.clearRect(0, 0, dim, dim);
      if (k.o <= 0.003) return;
      // one continuous object at a FIXED size (scale is a transform below, so the
      // glyph scales with the seal as one unit) — same height-field lighting throughout.
      paintSeal(B, dim, MR, cy, k.relief, k.lobe, k.dome, k.cf, colors.current, p, domeAmp, domePow, speckle, cloud, gcol);
      B.off.getContext("2d")!.putImageData(B.img, 0, 0);

      // composite (full alpha): layered drop shadow, the seal body, then the white
      // glyph label on the resting dome — so one fade/transform carries everything.
      const cc = B.comp.getContext("2d")!;
      cc.clearRect(0, 0, dim, dim);
      cc.save();
      for (const [blur, soy, al] of SHADOW_LAYERS) {
        cc.shadowColor = shadowRgba(colors.current.shadow, al);
        cc.shadowBlur = MR * blur;
        cc.shadowOffsetY = MR * soy;
        cc.drawImage(B.off, 0, 0);
      }
      cc.restore();
      if (k.iconWhite > 0.004) {
        cc.save(); cc.globalAlpha = 0.9 * k.iconWhite; cc.drawImage(B.iconImg, 0, 0); cc.restore();
      }

      ctx.save();
      ctx.globalAlpha = k.o;
      // place + entrance twist + uniform scale (seal, glyph, shadow move as one)
      ctx.translate(dim / 2, cy + k.oy * MR);
      ctx.rotate(k.rot);
      ctx.scale(k.scale, k.scale);
      ctx.translate(-dim / 2, -cy);
      ctx.drawImage(B.comp, 0, 0);
      ctx.restore();
    };

    const cycleTotal = DROP_MS + IDLE_MS + PRESS_MS + lingerMs + exitMs;
    const tapTotal = TAP_TOTAL(lingerMs, exitMs);
    let raf = 0;
    // TODO(remove before ship): deterministic seek for visual capture
    type SeekWin = Window & { __stampSeek?: (t: number) => void };
    (window as SeekWin).__stampSeek = (t) => {
      cancelAnimationFrame(raf);
      const tt = clamp(t);
      draw(mode === "loop" ? cycleBeat(tt * cycleTotal, variant, ease, bounce, rotate, lingerMs, exitMs, exit)
        : mode === "tap" ? tapBeat(tt * tapTotal, variant, ease, bounce, rotate, lingerMs, exitMs, exit)
        : stateAt(tt, variant, ease, bounce, rotate));
    };
    const cleanup = () => { cancelAnimationFrame(raf); (window as SeekWin).__stampSeek = undefined; };

    if (still || reduce.current) { draw(mode === "tap" ? domeBeat(1, 1) : stateAt(1, variant, ease, bounce, rotate)); return cleanup; }
    const t0 = performance.now();

    if (mode === "loop") { // lab: continuous idle→press→linger→exit→drop lifecycle
      let cyc = -1, cProf = prof; // a fresh seal each loop, to show the variety
      const frame = (now: number) => {
        const el = now - t0;
        const ci = Math.floor(el / cycleTotal);
        if (ci !== cyc) { cyc = ci; cProf = makeProfile(mulberry32(Math.imul(playKey + ci * 101, 0x9e3779b1) >>> 0)); }
        draw(cycleBeat(el % cycleTotal, variant, ease, bounce, rotate, lingerMs, exitMs, exit), cProf);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return cleanup;
    }

    if (mode === "tap") { // rest as the dome; play one lifecycle when tapped (playKey change)
      const tapped = lastKey.current !== null && lastKey.current !== playKey;
      lastKey.current = playKey;
      if (pressed) { // thumb is down — ease into the pressed-down (pre-rotated) state and hold
        const frame = (now: number) => {
          const q = clamp((now - t0) / 150);
          draw(pushdownBeat(eo(q), rotate));
          if (q < 1) raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return cleanup;
      }
      if (!tapped) { draw(domeBeat(1, 1)); return cleanup; } // mount / non-tap dep change → just rest
      const frame = (now: number) => {
        const e = now - t0;
        if (e >= tapTotal) { draw(domeBeat(1, 1)); return; }  // settle back to the resting dome
        draw(tapBeat(e, variant, ease, bounce, rotate, lingerMs, exitMs, exit));
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return cleanup;
    }

    const DUR = 1150; // mode === "press": the shipped keep confirmation
    const frame = (now: number) => {
      const t = (now - t0) / DUR;
      if (t >= 1) { draw(stateAt(1, variant, ease, bounce, rotate)); return; }
      draw(stateAt(t, variant, ease, bounce, rotate));
      raf = requestAnimationFrame(frame);
    };
    draw(stateAt(0, variant, ease, bounce, rotate));
    raf = requestAnimationFrame(frame);
    return cleanup;
  }, [playKey, size, glyph, variant, ease, bounce, rotate, mode, lingerMs, exitMs, exit, tint, puck, iconScale, pressed, speckle, cloud, still, whiteGlyph, glyphColor, glyphScale, superSample]);

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

// alternative icon sets for the seal glyph — each has quill/mic/calendar/check,
// drawn in a 0–20 viewBox. Chosen via a "set:icon" glyph (e.g. "b:quill");
// a bare icon name uses set "a". (Lab exploration of icon styles.)
type IconFn = (gx: CanvasRenderingContext2D) => void;
const ICON_SETS: Record<string, Record<string, IconFn>> = {
  a: { // line — the app's own (shell-nav) marks
    quill: (gx) => { gx.lineWidth = 1.7; for (const dd of ["M4.4 15.6C5.2 10.2 9 5.6 16 3.8c.5 2.7-.7 6.6-3.2 9.1-1.9 1.9-4.9 2.7-8.4 2.7Z", "M4.4 15.6 12.6 7", "M4.4 15.6 3.4 17.6"]) gx.stroke(new Path2D(dd)); },
    mic: (gx) => { gx.beginPath(); gx.roundRect(7.4, 2.6, 5.2, 9.2, 2.6); gx.fill(); gx.lineWidth = 1.8; gx.stroke(new Path2D("M4.6 9.8 a5.4 5.4 0 0 0 10.8 0")); gx.stroke(new Path2D("M10 15.2 V17.6")); },
    calendar: (gx) => { gx.lineWidth = 1.7; gx.beginPath(); gx.roundRect(3.2, 4.6, 13.6, 12, 2.2); gx.stroke(); gx.stroke(new Path2D("M6.8 2.8v3.4M13.2 2.8v3.4M3.2 9h13.6")); },
    check: (gx) => { gx.lineWidth = 1.9; gx.stroke(new Path2D("M4.6 10.6 L8.6 14.8 L15.4 5.6")); },
  },
  b: { // solid — chunky filled shapes
    quill: (gx) => { gx.fill(new Path2D("M16.5 3.5 C 10.5 4.5 6 8.5 5 14.5 L 3.6 16 L 5.2 15.2 C 11 14.5 15.5 10 16.5 3.5 Z")); gx.lineWidth = 1.6; gx.stroke(new Path2D("M5 15 L 3.1 17.9")); },
    mic: (gx) => { gx.beginPath(); gx.roundRect(6.8, 2.4, 6.4, 9.8, 3.2); gx.fill(); gx.lineWidth = 2; gx.stroke(new Path2D("M4.4 9.8 a5.6 5.6 0 0 0 11.2 0")); gx.stroke(new Path2D("M10 15.4 V18.1")); gx.stroke(new Path2D("M6.8 18.1 H13.2")); },
    calendar: (gx) => {
      gx.beginPath(); gx.roundRect(3.4, 4.6, 13.2, 12, 2.2); gx.fill();
      gx.save(); gx.globalCompositeOperation = "destination-out";
      gx.fillRect(3.4, 8.2, 13.2, 1.5);
      for (const ry of [11.6, 14.4]) for (const rx of [6.2, 9.8, 13.4]) { gx.beginPath(); gx.roundRect(rx - 0.85, ry - 0.85, 1.7, 1.7, 0.4); gx.fill(); }
      gx.restore();
      gx.lineWidth = 2; gx.stroke(new Path2D("M7 2.6 V5.2 M13 2.6 V5.2"));
    },
    check: (gx) => { gx.lineWidth = 2.8; gx.stroke(new Path2D("M4.3 10.6 L 8.4 15 L 15.7 5")); },
  },
  c: { // fine — thin, delicate lines
    quill: (gx) => { gx.lineWidth = 1.1; gx.stroke(new Path2D("M4.5 16.5 C 9 11 13 6.5 16.8 3.4")); gx.stroke(new Path2D("M7.2 12 l 2.2 1.3 M9.7 9.2 l 2.2 1.3 M12.2 6.6 l 2.2 1.3")); gx.stroke(new Path2D("M4.5 16.5 L 3.1 18.2")); },
    mic: (gx) => { gx.lineWidth = 1.2; gx.beginPath(); gx.roundRect(7.7, 2.8, 4.6, 8.4, 2.3); gx.stroke(); gx.stroke(new Path2D("M5.2 9.4 a4.8 4.8 0 0 0 9.6 0")); gx.stroke(new Path2D("M10 14.2 V17.4")); gx.stroke(new Path2D("M7.4 17.4 H12.6")); },
    calendar: (gx) => { gx.lineWidth = 1.2; gx.beginPath(); gx.roundRect(3.6, 4.8, 12.8, 11.6, 1.6); gx.stroke(); gx.stroke(new Path2D("M7 3 V6 M13 3 V6 M3.6 8.6 H16.4")); for (const ry of [11.4, 14]) for (const rx of [6.6, 10, 13.4]) { gx.beginPath(); gx.arc(rx, ry, 0.7, 0, Math.PI * 2); gx.fill(); } },
    check: (gx) => { gx.lineWidth = 1.3; gx.stroke(new Path2D("M3.8 10.8 L 8.2 15.2 L 16.2 4.6")); },
  },
  d: { // Remix Icon (line) — Apache-2.0, remixicon.com. Filled outline paths in a
    // 24-box; scaled 20/24 so they centre + size like the others. Credit in licenses.
    quill: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M6.94 14.033a30 30 0 0 0-.606 1.783c.96-.697 2.101-1.14 3.418-1.304c2.513-.314 4.746-1.973 5.876-4.058l-1.456-1.455l1.413-1.415l1-1.002c.43-.429.915-1.224 1.428-2.367c-5.593.867-9.018 4.291-11.074 9.818M17 8.997l1 1c-1 3-4 6-8 6.5q-4.003.5-5.002 5.5H3c1-6 3-20 18-20q-1.5 4.496-2.997 5.997z")); gx.restore(); },
    mic: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M12 3a3 3 0 0 0-3 3v4a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3m0-2a5 5 0 0 1 5 5v4a5 5 0 0 1-10 0V6a5 5 0 0 1 5-5M3.055 11H5.07a7.002 7.002 0 0 0 13.858 0h2.016A9.004 9.004 0 0 1 13 18.945V23h-2v-4.055A9.004 9.004 0 0 1 3.055 11")); gx.restore(); },
    calendar: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M9 1v2h6V1h2v2h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4V1zm11 10H4v8h16zM7 5H4v4h16V5h-3v2h-2V5H9v2H7z")); gx.restore(); },
    check: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("m10 15.17l9.192-9.191l1.414 1.414L10 17.999l-6.364-6.364l1.414-1.414z")); gx.restore(); },
  },
  e: { // Zest Interface Icons — MIT. Filled paths (evenodd fill), 24-box. Credit in licenses.
    quill: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M22.8013 1.74899C22.6665 1.22946 22.1457 0.908925 21.6212 1.02275C8.65054 3.83745 2.58949 13.7685 0.052924 22.7276C-0.0695134 23.16 0.111594 23.621 0.495639 23.8545C0.671767 23.9616 0.870732 24.0087 1.06614 23.9987C1.30094 22.8623 2.3183 22.0061 3.53976 22L3.82845 21.7288C4.23095 21.3506 4.25066 20.7177 3.87248 20.3153C3.65552 20.0843 3.35472 19.9794 3.06169 20.0033L3.10053 19.9025C3.13285 19.8568 3.16175 19.8078 3.18671 19.7556C3.39169 19.327 3.62105 19.0828 3.85127 18.9282C4.08827 18.769 4.38857 18.663 4.7947 18.6054C5.20936 18.5467 5.69118 18.5437 6.27396 18.5637C6.4627 18.5702 6.66791 18.5794 6.8832 18.5891L6.88328 18.5891C7.29482 18.6077 7.74319 18.6279 8.18371 18.6335C9.57215 18.6515 11.1777 18.5382 12.8464 17.8022C14.5236 17.0625 16.1803 15.7318 17.7487 13.451C17.9918 13.0974 17.9823 12.6281 17.7249 12.2846C17.6946 12.2443 17.6617 12.2067 17.6266 12.1721C18.6722 11.5802 19.5909 10.7793 20.3487 9.88147C21.3629 8.6798 22.1246 7.27154 22.5618 5.86914C22.9956 4.47728 23.1309 3.02041 22.8013 1.74899ZM6.34251 16.5649C5.75764 16.5449 5.15144 16.5409 4.57221 16.6173C7.63752 10.6611 12.7418 5.34921 20.9846 3.22857C20.9893 3.84429 20.8812 4.53976 20.6524 5.27392C20.2948 6.42083 19.663 7.59302 18.8203 8.59148C17.1301 10.5941 14.7335 11.7666 12.0659 10.9528C11.6664 10.8309 11.2332 10.9702 10.9795 11.3021C10.7259 11.634 10.7053 12.0885 10.9278 12.442C11.5713 13.4641 12.8696 14.1643 14.5192 14.2379C13.6686 15.0806 12.8349 15.6214 12.0393 15.9723C10.7466 16.5425 9.46928 16.65 8.20953 16.6337C7.79588 16.6284 7.41308 16.611 7.02596 16.5934H7.02595C6.80185 16.5832 6.57631 16.5729 6.34251 16.5649Z"), "evenodd"); gx.restore(); },
    calendar: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M4 3C4.55228 3 5 3.44772 5 4V5H7V4C7 3.44772 7.44772 3 8 3C8.55228 3 9 3.44772 9 4V5H11V4C11 3.44772 11.4477 3 12 3C12.5523 3 13 3.44772 13 4V5H15V4C15 3.44772 15.4477 3 16 3C16.5523 3 17 3.44772 17 4V5H19V4C19 3.44772 19.4477 3 20 3C20.5523 3 21 3.44772 21 4V6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6V4C3 3.44772 3.44772 3 4 3ZM19 7H16H12H8H5V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V7ZM13 10C13 10.5523 12.5523 11 12 11C11.4477 11 11 10.5523 11 10C11 9.44771 11.4477 9 12 9C12.5523 9 13 9.44771 13 10ZM16 11C16.5523 11 17 10.5523 17 10C17 9.44771 16.5523 9 16 9C15.4477 9 15 9.44771 15 10C15 10.5523 15.4477 11 16 11ZM9 13C9 13.5523 8.55228 14 8 14C7.44772 14 7 13.5523 7 13C7 12.4477 7.44772 12 8 12C8.55228 12 9 12.4477 9 13ZM12 14C12.5523 14 13 13.5523 13 13C13 12.4477 12.5523 12 12 12C11.4477 12 11 12.4477 11 13C11 13.5523 11.4477 14 12 14ZM17 13C17 13.5523 16.5523 14 16 14C15.4477 14 15 13.5523 15 13C15 12.4477 15.4477 12 16 12C16.5523 12 17 12.4477 17 13ZM8 17C8.55228 17 9 16.5523 9 16C9 15.4477 8.55228 15 8 15C7.44772 15 7 15.4477 7 16C7 16.5523 7.44772 17 8 17ZM13 16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16C11 15.4477 11.4477 15 12 15C12.5523 15 13 15.4477 13 16ZM16 17C16.5523 17 17 16.5523 17 16C17 15.4477 16.5523 15 16 15C15.4477 15 15 15.4477 15 16C15 16.5523 15.4477 17 16 17Z"), "evenodd"); gx.restore(); },
    check: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M20.6097 5.20743C21.0475 5.54416 21.1294 6.17201 20.7926 6.60976L10.7926 19.6098C10.6172 19.8378 10.352 19.9793 10.0648 19.9979C9.77765 20.0166 9.49637 19.9106 9.29289 19.7072L4.29289 14.7072C3.90237 14.3166 3.90237 13.6835 4.29289 13.2929C4.68342 12.9024 5.31658 12.9024 5.70711 13.2929L9.90178 17.4876L19.2074 5.39034C19.5441 4.95258 20.172 4.87069 20.6097 5.20743Z"), "evenodd"); gx.restore(); },
    mic: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M10 6C10 4.89543 10.8954 4 12 4C13.1046 4 14 4.89543 14 6H13C12.4477 6 12 6.44772 12 7C12 7.55228 12.4477 8 13 8H14V10H13C12.4477 10 12 10.4477 12 11C12 11.5523 12.4477 12 13 12H14V13C14 14.1046 13.1046 15 12 15C10.8954 15 10 14.1046 10 13V6ZM12 2C9.79086 2 8 3.79086 8 6V13C8 15.2091 9.79086 17 12 17C14.2091 17 16 15.2091 16 13V11V7V6C16 3.79086 14.2091 2 12 2ZM7 11C7 10.4477 6.55228 10 6 10C5.44772 10 5 10.4477 5 11V13C5 16.5265 7.60771 19.4439 11 19.9291V21H8C7.44772 21 7 21.4477 7 22C7 22.5523 7.44772 23 8 23H12H16C16.5523 23 17 22.5523 17 22C17 21.4477 16.5523 21 16 21H13V19.9291C16.3923 19.4439 19 16.5265 19 13V11C19 10.4477 18.5523 10 18 10C17.4477 10 17 10.4477 17 11V13C17 15.7614 14.7614 18 12 18C9.23858 18 7 15.7614 7 13V11Z"), "evenodd"); gx.restore(); },
  },
};
const EXTRA_ICONS: Record<string, IconFn> = {
  spark: (gx) => { gx.fill(new Path2D("M10 2 L11.6 8.4 L18 10 L11.6 11.6 L10 18 L8.4 11.6 L2 10 L8.4 8.4 Z")); },
  // the app (set a) calendar + date dots: 2 rows × 3, top-left absent (5 dots).
  caldots: (gx) => {
    gx.lineWidth = 1.7;
    gx.beginPath(); gx.roundRect(3.2, 4.6, 13.6, 12, 2.2); gx.stroke();
    gx.stroke(new Path2D("M6.8 2.8v3.4M13.2 2.8v3.4M3.2 9h13.6"));
    const cols = [6.6, 10, 13.4], rows = [11.7, 14.1];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 0) continue;
      gx.beginPath(); gx.arc(cols[c], rows[r], 0.85, 0, Math.PI * 2); gx.fill();
    }
  },
  // Zest Interface Icons (MIT), 24-box evenodd. "joke" = Zest speech bubble + the
  // grinning face's squint eyes + their shared smile, fused into one evenodd fill
  // (bubble ring hollow; eyes + mouth fill inside it).
  eye: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M6.30147 15.5771C4.77832 14.2684 3.6904 12.7726 3.18002 12C3.6904 11.2274 4.77832 9.73158 6.30147 8.42294C7.87402 7.07185 9.81574 6 12 6C14.1843 6 16.1261 7.07185 17.6986 8.42294C19.2218 9.73158 20.3097 11.2274 20.8201 12C20.3097 12.7726 19.2218 14.2684 17.6986 15.5771C16.1261 16.9282 14.1843 18 12 18C9.81574 18 7.87402 16.9282 6.30147 15.5771ZM12 4C9.14754 4 6.75717 5.39462 4.99812 6.90595C3.23268 8.42276 2.00757 10.1376 1.46387 10.9698C1.05306 11.5985 1.05306 12.4015 1.46387 13.0302C2.00757 13.8624 3.23268 15.5772 4.99812 17.0941C6.75717 18.6054 9.14754 20 12 20C14.8525 20 17.2429 18.6054 19.002 17.0941C20.7674 15.5772 21.9925 13.8624 22.5362 13.0302C22.947 12.4015 22.947 11.5985 22.5362 10.9698C21.9925 10.1376 20.7674 8.42276 19.002 6.90595C17.2429 5.39462 14.8525 4 12 4ZM10 12C10 10.8954 10.8955 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8955 14 10 13.1046 10 12ZM12 8C9.7909 8 8.00004 9.79086 8.00004 12C8.00004 14.2091 9.7909 16 12 16C14.2092 16 16 14.2091 16 12C16 9.79086 14.2092 8 12 8Z"), "evenodd"); gx.restore(); },
  joke: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M18.3121 23.3511C17.4463 23.0228 16.7081 22.5979 16.1266 22.1995C14.8513 22.7159 13.4578 23 12 23C5.92487 23 1 18.0751 1 12C1 5.92487 5.92487 1 12 1C18.0751 1 23 5.92487 23 12C23 14.2788 22.306 16.3983 21.1179 18.1551C21.0425 19.6077 21.8054 20.9202 22.5972 22.0816C23.2907 23.0987 23.1167 23.9184 21.8236 23.9917C21.244 24.0245 19.9903 23.9874 18.3121 23.3511ZM3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 13.9503 20.3808 15.7531 19.328 17.2262C18.8622 17.8782 19.1018 19.0998 19.2616 19.8011C19.4167 20.4818 19.7532 21.2051 20.0856 21.8123C19.7674 21.7356 19.4111 21.6288 19.0212 21.481C18.1239 21.1407 17.3824 20.6624 16.8594 20.261C16.5626 20.0332 16.1635 19.9902 15.825 20.1494C14.6654 20.6947 13.3697 21 12 21C7.02944 21 3 16.9706 3 12ZM17.3944 8.55279C17.1474 8.05881 16.5468 7.85858 16.0528 8.10557L13.0528 9.60557C12.714 9.77496 12.5 10.1212 12.5 10.5C12.5 10.8788 12.714 11.225 13.0528 11.3944L16.0528 12.8944C16.5468 13.1414 17.1474 12.9412 17.3944 12.4472C17.6414 11.9532 17.4412 11.3526 16.9472 11.1056L15.7361 10.5L16.9472 9.89443C17.4412 9.64744 17.6414 9.04676 17.3944 8.55279ZM7.94721 8.10557C7.45324 7.85858 6.85256 8.05881 6.60557 8.55279C6.35858 9.04676 6.55881 9.64744 7.05279 9.89443L8.26393 10.5L7.05279 11.1056C6.55881 11.3526 6.35858 11.9532 6.60557 12.4472C6.85256 12.9412 7.45324 13.1414 7.94721 12.8944L10.9472 11.3944C11.286 11.225 11.5 10.8788 11.5 10.5C11.5 10.1212 11.286 9.77496 10.9472 9.60557L7.94721 8.10557ZM8.03001 15.2425C7.87428 14.6196 8.36619 14.0002 9.00016 13.9998H15.0002C15.6333 14.0002 16.126 14.6172 15.9703 15.24C15.4525 16.9881 13.7854 18 12.0002 18C10.2834 18 8.46902 16.9986 8.03001 15.2425Z"), "evenodd"); gx.restore(); },
  // Remix Icon (line) — Apache-2.0: alternative eye + laugh/smile to compare.
  eye2: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M12 3c5.392 0 9.878 3.88 10.819 9c-.94 5.12-5.427 9-10.819 9s-9.878-3.88-10.818-9C2.122 6.88 6.608 3 12 3m0 16a9.005 9.005 0 0 0 8.778-7a9.005 9.005 0 0 0-17.555 0A9.005 9.005 0 0 0 12 19m0-2.5a4.5 4.5 0 1 1 0-9a4.5 4.5 0 0 1 0 9m0-2a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5")); gx.restore(); },
  laugh: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2m0 2a8 8 0 1 0 0 16a8 8 0 0 0 0-16m0 7q3 0 5 1a5 5 0 0 1-10 0q2-1 5-1M8.5 7a2.5 2.5 0 0 1 2.45 2h-4.9A2.5 2.5 0 0 1 8.5 7m7 0a2.5 2.5 0 0 1 2.45 2h-4.9a2.5 2.5 0 0 1 2.45-2")); gx.restore(); },
  smile: (gx) => { gx.save(); gx.scale(20 / 24, 20 / 24); gx.fill(new Path2D("M7.291 20.824L2 22l1.176-5.291A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a9.96 9.96 0 0 1-4.709-1.176m.29-2.113l.653.35A7.96 7.96 0 0 0 12 20a8 8 0 1 0-8-8c0 1.335.325 2.617.94 3.766l.349.653l-.655 2.947zM7 12h2a3 3 0 1 0 6 0h2a5 5 0 0 1-10 0")); gx.restore(); },
};

// rasterise the glyph/icon once → an alpha mask used as embossed relief.
// Drawn oversampled and box-downsampled (+ a whisper of blur) so the edges are
// crisp yet anti-aliased — sharp, without the relief lighting stair-stepping.
function bakeGlyph(out: Float32Array, outR: Float32Array, iconImg: HTMLCanvasElement, dim: number, glyph: string, iconScale: number, glyphScale: number) {
  out.fill(0); outR.fill(0);
  iconImg.getContext("2d")!.clearRect(0, 0, dim, dim);
  if (!glyph) return;
  const OV = 3, big = dim * OV;          // oversample factor + working resolution
  const gc = document.createElement("canvas");
  gc.width = big; gc.height = big;
  const gx = gc.getContext("2d");
  if (!gx) return;
  gx.fillStyle = "#fff"; gx.strokeStyle = "#fff";
  gx.lineCap = "round"; gx.lineJoin = "round";
  const cx = big / 2, cy = big * 0.46;
  if (glyph === "S") {
    // friendly opsz≈22 italic Fraunces "S", baked from its vector outline so it
    // matches the masthead regardless of canvas's lack of opsz control.
    const s = (glyphScale * big) / GLYPH_UPM;
    gx.save();
    gx.translate(cx, cy); gx.scale(s, -s); gx.translate(-S_CX, -S_CY);
    gx.fill(new Path2D(S_PATH));
    gx.restore();
  } else {
    // icon set glyph "set:icon" (e.g. "b:quill"); a bare name uses set "a".
    const ci = glyph.indexOf(":");
    const setKey = ci > 0 ? glyph.slice(0, ci) : "a";
    const iconKey = ci > 0 ? glyph.slice(ci + 1) : glyph;
    const iconFn = ICON_SETS[setKey]?.[iconKey] ?? ICON_SETS.a[iconKey] ?? EXTRA_ICONS[iconKey];
    if (iconFn) {
      const sc = (iconScale * big) / 20;     // icon size as a fraction of the field
      gx.save();
      gx.translate(cx, cy); gx.scale(sc, sc); gx.translate(-10, -10);
      iconFn(gx);
      gx.restore();
    } else {
      // other letters: canvas text (Fraunces italic)
      const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-fraunces").trim();
      gx.textAlign = "center"; gx.textBaseline = "middle";
      gx.font = `italic 560 ${Math.round(big * glyphScale)}px ${fam || "Fraunces"}, Georgia, "Times New Roman", serif`;
      gx.fillText(glyph, cx, cy);
    }
  }
  // recentre on the seal's centre from the glyph's actual ink bounds (a font's
  // "middle" baseline and an icon's viewBox aren't centred on their own glyph),
  // then resolve two masks from the same oversampled draw: a crisp one for the
  // edges, and a rounded one used to dome the crown so the relief reads as volume.
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
  // one AA downscale (oversample averaging — NOT canvas ctx.filter, which iOS
  // Safari silently ignores, leaving the crown un-domed → a flat, shallow glyph),
  // then blur in JS so the crisp and domed masks come out identical everywhere.
  const base = new Float32Array(dim * dim);
  resolveMask(base, gc, dim, big, tx, ty);
  blurMask(base, out, dim, dim * 0.004, 1);          // crisp edges (whisper)
  blurMask(base, outR, dim, dim * GLYPH_ROUND, 3);   // rounded → domed crown
  // crisp white label from the AA base (NOT the softened relief mask) — sharp, not blurry
  const ig = iconImg.getContext("2d")!;
  const im = ig.createImageData(dim, dim);
  for (let i = 0; i < dim * dim; i++) {
    const a = base[i]; im.data[i * 4] = 255; im.data[i * 4 + 1] = 255; im.data[i * 4 + 2] = 255;
    im.data[i * 4 + 3] = a > 0 ? Math.round((a > 1 ? 1 : a) * 255) : 0;
  }
  ig.putImageData(im, 0, 0);
}

// downsample the oversampled glyph into a dim×dim alpha mask, recentred by
// (tx,ty); high-quality averaging anti-aliases the edges.
function resolveMask(
  out: Float32Array, gc: HTMLCanvasElement, dim: number, big: number, tx: number, ty: number,
) {
  const dc = document.createElement("canvas");
  dc.width = dim; dc.height = dim;
  const dx = dc.getContext("2d");
  if (!dx) return;
  dx.imageSmoothingEnabled = true;
  dx.imageSmoothingQuality = "high";
  dx.drawImage(gc, 0, 0, big, big, tx, ty, dim, dim);
  const d = dx.getImageData(0, 0, dim, dim).data;
  for (let i = 0; i < dim * dim; i++) out[i] = d[i * 4 + 3] / 255;
}

// separable box blur (multi-pass ≈ Gaussian) on a dim×dim mask, src→dst — done in
// JS, not ctx.filter, so the domed crown renders on every browser including iOS.
function blurMask(src: Float32Array, dst: Float32Array, dim: number, radius: number, passes: number) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) { dst.set(src); return; }
  const inv = 1 / (2 * r + 1);
  const tmp = new Float32Array(dim * dim);
  let a = src;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < dim; y++) {              // horizontal a→tmp
      const row = y * dim;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(dim - 1, Math.max(0, k))];
      for (let x = 0; x < dim; x++) {
        tmp[row + x] = acc * inv;
        acc += a[row + Math.min(dim - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < dim; x++) {              // vertical tmp→dst
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(dim - 1, Math.max(0, k)) * dim + x];
      for (let y = 0; y < dim; y++) {
        dst[y * dim + x] = acc * inv;
        acc += tmp[Math.min(dim - 1, y + r + 1) * dim + x] - tmp[Math.max(0, y - r) * dim + x];
      }
    }
    a = dst;                                      // subsequent passes blur dst in place
  }
}

// compute the lit seal into B.img (alpha 0 outside the silhouette)
function paintSeal(
  B: { hgt: Float32Array; msk: Float32Array; gly: Float32Array; glyR: Float32Array; img: ImageData },
  dim: number, MR: number, cy: number, relief: number, lobe: number, dome: number, cf: number, col: Colors, prof: Profile,
  domeAmp: number, domePow: number, speckle: number, cloud: number, glyphCol: Rgb | null,
) {
  const cx = dim / 2;
  const hgt = B.hgt, msk = B.msk, gly = B.gly, glyR = B.glyR;
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
      // At rest (cf 0) this is 0 everywhere — a clean dome, no centre dot.
      const cl = clamp((cf - r / MR) / 0.1);
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
      // glyph: crisp-edged plateau (gly) lifted by a rounded crown (glyR) so it
      // reads as raised volume, not a flat-topped engraving that blends with the field.
      const glyphH = cl * gly[i] * (GLYPH_AMP + GLYPH_CROWN * glyR[i]);
      // resting glob: height domeAmp, top-flatness domePow (>2 = flatter puck top)
      hgt[i] = h + glyphH + dome * domeAmp * Math.sqrt(Math.max(0, 1 - Math.pow(rn, domePow)));
    }
  }
  // pass 2 — lighting
  const d = B.img.data;
  d.fill(0);
  const Llen = Math.hypot(LX, LY, LZ), lx = LX / Llen, ly = LY / Llen, lz = LZ / Llen;
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const ss = SS * (MR / 100);
  const [wr, wg, wb] = col.wax;
  const [sr, sg, sb] = col.spec;
  // a bright base (e.g. Lamplight's pale blue) has little headroom, so a full
  // specular blows out → harsh. Damp the gloss as the base gets lighter.
  const baseLuma = 0.3 * wr + 0.59 * wg + 0.11 * wb;
  const lumaDamp = 1 - 0.6 * clamp((baseLuma - 0.34) / 0.34);
  const specDamp = (1 - 0.6 * dome) * lumaDamp; // pre-press circle low-sheen; bright base less glossy
  // soft pastels: a very light base shouldn't carry dark shadows — lift the ambient
  // floor and ease the diffuse swing + form-shadow as the base lightens (deep
  // colours have low luma → soft 0 → unchanged).
  const soft = clamp((baseLuma - 0.48) / 0.32);
  const amb = AMBIENT + soft * 0.45;
  const dif = DIFF * (1 - soft * 0.5);
  const envA = ENV * (1 - soft * 0.7);
  // metallic texture cell sizes (in backing px) for the glints + molten cloud
  const flakeCell = Math.max(2, Math.round(dim * FLAKE_REL));
  const grainCell = Math.max(4, Math.round(dim * GRAIN_REL));
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
      const env = 1 + envA * (((cx - px) + (cy - py)) / dim);
      // soften the embossed glyph's shadow side (lift only where it's dark), on
      // every colour — so the icon's shadows aren't harsher than the seal body.
      const ambEff = amb + GLYPH_SHADE_LIFT * gly[i] * (1 - ndl);
      let lf = (ambEff + dif * ndl) * env;
      // molten cloud: smooth low-freq value noise nudges the base lightness (the
      // "liquid metal" swirl). Independent of the glints, on its own control.
      if (cloud > 0) {
        const gxf = px / grainCell, gyf = py / grainCell;
        const ix = Math.floor(gxf), iy = Math.floor(gyf);
        const sxf = sm(gxf - ix), syf = sm(gyf - iy);
        const v0 = lp(hash2(ix, iy), hash2(ix + 1, iy), sxf);
        const v1 = lp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), sxf);
        lf *= 1 + cloud * GRAIN_STR * (lp(v0, v1, syf) - 0.5);
      }
      // micro-facet glints: perturb the normal at high spatial frequency and
      // re-reflect the SAME light (Blinn-Phong half-vector), so a fleck brightens
      // only where it actually catches the light — clustering in and around the
      // highlight. Folded into the specular term so it rides the metal tint, the
      // edge-AA and the dome damping (a real reflection), not a flat white dot.
      let specMicro = spec;
      if (speckle > 0) {
        const fcx = (px / flakeCell) | 0, fcy = (py / flakeCell) | 0;
        const seed = hash2(fcx + 41, fcy + 7);       // only some cells bear a flake
        if (seed > FLAKE_THRESH) {
          // a soft round point centred randomly in its cell (not a square block)
          const ox = px - fcx * flakeCell - hash2(fcx + 2, fcy + 8) * flakeCell;
          const oy = py - fcy * flakeCell - hash2(fcx + 6, fcy + 3) * flakeCell;
          const fall = Math.exp(-(ox * ox + oy * oy) / (flakeCell * flakeCell) * FLAKE_TIGHT);
          if (fall > 0.02) {
            const fa = hash2(fcx, fcy) * TAU;
            const famp = FLAKE_TILT * (0.5 + 0.5 * hash2(fcx * 3 + 7, fcy * 5 + 13));
            let fnx = nx + Math.cos(fa) * famp, fny = ny + Math.sin(fa) * famp, fnz = nz;
            const fnl = Math.hypot(fnx, fny, fnz); fnx /= fnl; fny /= fnl; fnz /= fnl;
            const fndh = Math.max(0, fnx * hx + fny * hy + fnz * hz);
            // a sharp point that brightens only where its facet catches the light
            specMicro += speckle * FLAKE_STR * seed * fall * Math.pow(fndh, FLAKE_SHIN);
          }
        }
      }
      // material base: the wax colour, blended toward `glyphCol` where the glyph
      // is raised — a coloured embossed mark (white, or the ink) that keeps relief.
      let mr = wr, mg = wg, mb = wb;
      if (glyphCol) {
        const t = gly[i];
        if (t > 0) { mr = wr + (glyphCol[0] - wr) * t; mg = wg + (glyphCol[1] - wg) * t; mb = wb + (glyphCol[2] - wb) * t; }
      }
      let R = mr * lf + sr * specMicro * gloss;
      let G = mg * lf + sg * specMicro * gloss;
      let Bl = mb * lf + sb * specMicro * gloss;
      R = softclip(R, HI_KNEE, HICAP);
      G = softclip(G, HI_KNEE, HICAP);
      Bl = softclip(Bl, HI_KNEE, HICAP * 0.98);
      d[o] = Math.round(Math.pow(R, 1 / 1.08) * 255);
      d[o + 1] = Math.round(Math.pow(G, 1 / 1.08) * 255);
      d[o + 2] = Math.round(Math.pow(Bl, 1 / 1.08) * 255);
      d[o + 3] = Math.round(a * 255);
    }
  }
}
