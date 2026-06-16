"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/* ── the wax stamp ────────────────────────────────────────────────
   A pressed wax seal, rendered the way a 3D one is and animated as a
   real press. The body is a grayscale height field lit by SVG diffuse +
   specular lighting (curved rim globes go glossy, the flat field stays
   matte); the diffuse light is tinted from the live `--wax` tokens, so
   it themes for Paper and Lamplight. The impression (a thin moat, a thin
   ring and the glyph) lives in the same height field and its relief
   grows from nothing, so the stamp genuinely presses in rather than
   fading on. The silhouette is an organic wax drop that the press
   spreads further into lobes. Any icon works — it's lit from its own
   alpha. Replays when `playKey` changes; collapses to the settled seal
   under reduced motion. */

// organic lobe harmonics: blob radius = R·(1 + lobe·Σ a·cos(kθ+p))
const HARM: ReadonlyArray<readonly [number, number, number]> = [
  [5, 0.01917, 3.4178],
  [6, 0.02156, 3.7926],
  [7, 0.02621, 0.4115],
];
const R = 102;
const M = 216;
const TAU = Math.PI * 2;

function blobD(lobe: number): string {
  const p: [number, number][] = [];
  for (let i = 0; i < M; i++) {
    const th = (TAU * i) / M;
    let f = 1;
    for (const [k, a, ph] of HARM) f += lobe * a * Math.cos(k * th + ph);
    const r = R * f;
    p.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)} `;
  for (let i = 0; i < M; i += 3) {
    const a = p[(i - 3 + M) % M], b = p[i], c = p[(i + 3) % M], e = p[(i + 6) % M];
    d += `C ${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)} `;
  }
  return d + "Z";
}

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const sm = (t: number) => t * t * (3 - 2 * t);
const lp = (a: number, b: number, t: number) => a + (b - a) * t;

function lighten(hex: string, amt: number): string {
  const m = hex.trim().replace("#", "");
  if (m.length < 6) return hex;
  const r = parseInt(m.slice(0, 2), 16),
    g = parseInt(m.slice(2, 4), 16),
    b = parseInt(m.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

type Beat = { s: number; dy: number; ballO: number; sealO: number; lobe: number; impress: number };

// drop & grow a bead → spread it into an organic puck → the impression
// presses in (relief grows linearly) while lobes deepen → settle. No
// vertical squash: the die presses on z, so the wax spreads radially.
function stateAt(t: number): Beat {
  const grow = eo(win(t, 0.05, 0.22));
  const s = lp(0.1, 0.34, grow) + 0.66 * sm(win(t, 0.2, 0.4));
  const dy = lp(-98, 0, eo(win(t, 0, 0.3)));
  const press = win(t, 0.42, 1.0);
  return {
    s,
    dy,
    ballO: 1 - win(t, 0.24, 0.34),
    sealO: win(t, 0.26, 0.36),
    lobe: 0.4 + 0.6 * press,
    impress: press,
  };
}

export type WaxStampProps = {
  /** increment once per keep; any change replays the press. */
  playKey: number;
  /** seal diameter, px. Defaults to the Seal button's 64. */
  size?: number;
  /** the letter pressed into the wax (used when `icon` is absent). */
  glyph?: string;
  /** an arbitrary impression: light-grey SVG shapes (filled or stroked)
      on a 0-centered, ~150-wide field — brighter = raised. Overrides
      `glyph`. The relief is lit from its alpha, so any icon works. */
  icon?: ReactNode;
  className?: string;
};

export function WaxStamp({ playKey, size = 64, glyph = "S", icon, className }: WaxStampProps) {
  const uid = useId().replace(/:/g, "");
  const reduce = useRef(false);
  const stage = useRef<SVGGElement>(null);
  const ball = useRef<SVGGElement>(null);
  const seal = useRef<SVGGElement>(null);
  const massPath = useRef<SVGPathElement>(null);
  const clipP = useRef<SVGPathElement>(null);
  const impress = useRef<SVGGElement>(null);

  const [lit, setLit] = useState("#6a96c8");
  useLayoutEffect(() => {
    const bright = getComputedStyle(document.documentElement).getPropertyValue("--wax-bright").trim();
    if (bright) setLit(lighten(bright, 0.16));
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const st = stage.current, b = ball.current, s = seal.current,
      mp = massPath.current, cp = clipP.current, im = impress.current;
    if (!st || !b || !s || !mp || !cp || !im) return;
    const set = (k: Beat) => {
      st.setAttribute("transform", `translate(0 ${k.dy.toFixed(1)}) scale(${k.s.toFixed(3)})`);
      b.setAttribute("opacity", k.ballO.toFixed(3));
      s.setAttribute("opacity", k.sealO.toFixed(3));
      const d = blobD(k.lobe);
      mp.setAttribute("d", d);
      cp.setAttribute("d", d);
      im.setAttribute("opacity", k.impress.toFixed(3));
    };
    if (reduce.current) { set(stateAt(1)); return; }
    let raf = 0;
    const t0 = performance.now();
    const DUR = 1200;
    const frame = (now: number) => {
      const t = (now - t0) / DUR;
      if (t >= 1) { set(stateAt(1)); return; }
      set(stateAt(t));
      raf = requestAnimationFrame(frame);
    };
    set(stateAt(0));
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playKey]);

  const fId = `wb-${uid}`;
  const sil = `sil-${uid}`;

  return (
    <span
      aria-hidden="true"
      className={cn("relative block", className)}
      style={{ width: size, height: size, overflow: "visible", isolation: "isolate" }}
    >
      <svg viewBox="-112 -112 224 224" width="100%" height="100%" style={{ overflow: "visible" }}>
        <defs>
          <radialGradient id={`mass-${uid}`} cx="50%" cy="50%" r="56%">
            <stop offset="0%" stopColor="#cccccc" />
            <stop offset="42%" stopColor="#cacaca" />
            <stop offset="70%" stopColor="#bcbcbc" />
            <stop offset="88%" stopColor="#969696" />
            <stop offset="100%" stopColor="#1e1e1e" />
          </radialGradient>
          <radialGradient id={`ballS-${uid}`} cx="38%" cy="32%" r="70%">
            <stop offset="0%" stopColor="#cfe0f4" />
            <stop offset="42%" stopColor="var(--wax)" />
            <stop offset="100%" stopColor="var(--wax-deep)" />
          </radialGradient>
          <filter id={`ballsh-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <clipPath id={sil}>
            <path ref={clipP} d="" />
          </clipPath>
          <filter id={fId} x="-55%" y="-55%" width="210%" height="210%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" result="ht" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0" />
            <feGaussianBlur in="ht" stdDeviation="3.2" result="hb" />
            <feSpecularLighting in="hb" surfaceScale="7" specularConstant="0.8" specularExponent="9" lightingColor="#eaf1ff" result="sp">
              <feDistantLight azimuth="235" elevation="37" />
            </feSpecularLighting>
            <feDiffuseLighting in="hb" surfaceScale="7" diffuseConstant="1.55" lightingColor={lit} result="df">
              <feDistantLight azimuth="235" elevation="37" />
            </feDiffuseLighting>
            <feColorMatrix in="df" type="saturate" values="1.18" result="dfR" />
            <feComponentTransfer in="dfR" result="dfC">
              <feFuncR type="gamma" exponent="1.28" />
              <feFuncG type="gamma" exponent="1.18" />
              <feFuncB type="gamma" exponent="0.92" />
            </feComponentTransfer>
            <feComposite in="dfC" in2="SourceAlpha" operator="in" result="bodyc" />
            <feComposite in="sp" in2="SourceAlpha" operator="in" result="spc" />
            <feBlend in="bodyc" in2="spc" mode="screen" result="shiny" />
            <feDropShadow in="shiny" dx="0" dy="9" stdDeviation="8" floodColor="#0a1a2e" floodOpacity="0.34" />
          </filter>
        </defs>

        <g ref={stage} transform="scale(0.12)">
          <g ref={ball}>
            <ellipse cx="6" cy="98" rx="54" ry="13" fill="var(--wax-shadow)" opacity="0.4" filter={`url(#ballsh-${uid})`} />
            <circle r="100" fill={`url(#ballS-${uid})`} />
          </g>
          <g ref={seal} opacity="0">
            <g clipPath={`url(#${sil})`} filter={`url(#${fId})`}>
              <path ref={massPath} fill={`url(#mass-${uid})`} d="" />
              <g ref={impress} opacity="0">
                <circle r="70" fill="#6f6f6f" />
                <circle r="80" fill="none" stroke="#2c2c2c" strokeWidth="2" />
                <circle r="74" fill="none" stroke="#f2f2f2" strokeWidth="1.2" />
                {icon ?? (
                  <text
                    x="0"
                    y="2"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#e2e2e2"
                    style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 104 }}
                  >
                    {glyph}
                  </text>
                )}
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
