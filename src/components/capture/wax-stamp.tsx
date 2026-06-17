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
const DOME_AMP = 4.8;         // resting glob height — a flattened wax puck, not a globe
const DOME_POW = 4.2;         // >2 flattens the top + rounds the shoulder (puck, not hemisphere)
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
  /** lab/tap: held-down feedback while the thumb is on the button (before release). */
  pressed?: boolean;
  className?: string;
};

export function WaxStamp({ playKey, size = 96, glyph = "S", variant = "spring", ease = "front", bounce = 1.5, rotate = 15, mode = "press", lingerMs = 1000, exitMs = 200, exit = "grow", tint, pressed = false, className }: WaxStampProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(false);
  const lastKey = useRef<number | null>(null); // tap mode: distinguish mount from a tap
  const colors = useRef<Colors>(DEFAULT_COLORS);
  // scratch buffers, (re)allocated when the backing size changes
  const buf = useRef<{ dim: number; hgt: Float32Array; msk: Float32Array; gly: Float32Array; glyR: Float32Array; off: HTMLCanvasElement; comp: HTMLCanvasElement; iconImg: HTMLCanvasElement; img: ImageData; baked: string } | null>(null);

  useLayoutEffect(() => {
    colors.current = resolveColors(tint); // tint > dev override > --wax* tokens
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [tint]);

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
      };
    }
    const B = buf.current;
    if (B.baked !== glyph) { bakeGlyph(B.gly, B.glyR, B.iconImg, dim, glyph); B.baked = glyph; } // re-bake on glyph change
    colors.current = resolveColors(tint); // refresh (theme/tint may have changed)
    const MR = dim * 0.38; // mean seal radius in backing px (room for lobes + shadow)
    // a fresh seal each keep: 5–7 lobes, random rotation/spacing, same extents.
    // Seeded by playKey so the lab's two seals match within a play, every replay differs.
    const prof = makeProfile(mulberry32(Math.imul(playKey, 0x9e3779b1) >>> 0));

    const cy = dim * 0.46;
    const draw = (k: Beat, p: Profile = prof) => {
      ctx.clearRect(0, 0, dim, dim);
      if (k.o <= 0.003) return;
      // one continuous object at a FIXED size (scale is a transform below, so the
      // glyph scales with the seal as one unit) — same height-field lighting throughout.
      paintSeal(B, dim, MR, cy, k.relief, k.lobe, k.dome, k.cf, colors.current, p);
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

    if (reduce.current) { draw(mode === "tap" ? domeBeat(1, 1) : stateAt(1, variant, ease, bounce, rotate)); return cleanup; }
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
  }, [playKey, size, glyph, variant, ease, bounce, rotate, mode, lingerMs, exitMs, exit, tint, pressed]);

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
function bakeGlyph(out: Float32Array, outR: Float32Array, iconImg: HTMLCanvasElement, dim: number, glyph: string) {
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
    // candidate category glyphs (lab preview)
    spark() {
      gx.fill(new Path2D("M10 2 L11.6 8.4 L18 10 L11.6 11.6 L10 18 L8.4 11.6 L2 10 L8.4 8.4 Z"));
    },
    eye() {
      gx.lineWidth = 1.7;
      gx.stroke(new Path2D("M2.6 10 Q10 4 17.4 10 Q10 16 2.6 10 Z"));
      gx.beginPath(); gx.arc(10, 10, 2.5, 0, Math.PI * 2); gx.fill();
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
      // flattened-puck dome: flat-ish top, shoulder rounds off at the edge (DOME_POW)
      hgt[i] = h + glyphH + dome * DOME_AMP * Math.sqrt(Math.max(0, 1 - Math.pow(rn, DOME_POW)));
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
