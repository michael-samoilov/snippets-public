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
   A pressed wax seal, rendered the way a 3D one is: a grayscale height
   field (a domed, lobed wax mass with a recessed flat field, a circular
   moat and a raised ring) is lit by SVG diffuse + specular lighting, so
   the curved rim globes go glossy while the flat field stays matte —
   real form from a height map, not a flat gradient. The impressed icon
   is lit the same way (any icon works — it's just the alpha that's lit).

   The blue is ours: the diffuse light is tinted with the live `--wax`
   tokens, so it themes for Paper and Lamplight. The motion mirrors the
   reference: a glossy bead drops and grows, flattens wide under the die,
   the impression presses in, then it settles and holds. Filters are
   computed once; only transforms/opacity animate, so the press is cheap.
   Replays when `playKey` changes; collapses to the settled seal under
   reduced motion. */

// the wax mass: an organic, irregular lobed blob (centered on 0,0 in a
// 248-unit viewBox). Baked so it isn't recomputed at runtime.
const BLOB =
  "M 100.8 0.0 C 100.9 2.9 100.9 5.9 100.7 8.8 C 100.5 11.7 100.2 14.7 99.8 17.6 C 99.4 20.5 98.8 23.4 98.2 26.3 C 97.6 29.2 96.9 32.1 96.1 35.0 C 95.4 37.9 94.5 40.8 93.5 43.6 C 92.5 46.4 91.4 49.3 90.1 52.0 C 88.8 54.8 87.4 57.5 85.8 60.1 C 84.1 62.6 82.3 65.1 80.3 67.4 C 78.2 69.6 76.0 71.7 73.6 73.6 C 71.2 75.5 68.6 77.2 66.0 78.7 C 63.4 80.2 60.6 81.4 57.9 82.6 C 55.1 83.8 52.3 84.8 49.6 85.9 C 46.8 86.9 44.1 87.8 41.4 88.8 C 38.7 89.9 36.1 90.9 33.5 92.0 C 30.9 93.2 28.3 94.4 25.6 95.6 C 23.0 96.9 20.3 98.2 17.5 99.5 C 14.8 100.7 11.9 102.0 9.0 102.9 C 6.1 103.9 3.0 104.8 0.0 105.4 C -3.0 105.9 -6.2 106.1 -9.3 106.0 C -12.3 105.9 -15.5 105.4 -18.4 104.6 C -21.4 103.7 -24.3 102.5 -27.1 101.1 C -29.9 99.8 -32.5 98.0 -35.1 96.3 C -37.6 94.6 -40.0 92.6 -42.3 90.8 C -44.7 89.0 -47.0 87.1 -49.3 85.4 C -51.6 83.6 -53.9 82.0 -56.3 80.4 C -58.7 78.8 -61.1 77.3 -63.6 75.8 C -66.1 74.2 -68.7 72.8 -71.2 71.2 C -73.7 69.5 -76.3 67.9 -78.7 66.0 C -81.1 64.1 -83.4 62.1 -85.5 59.9 C -87.5 57.6 -89.4 55.1 -91.0 52.5 C -92.5 49.9 -93.8 47.1 -94.8 44.2 C -95.7 41.3 -96.4 38.3 -96.9 35.3 C -97.4 32.3 -97.6 29.2 -97.8 26.2 C -98.0 23.2 -98.1 20.2 -98.2 17.3 C -98.4 14.4 -98.5 11.5 -98.8 8.6 C -99.0 5.8 -99.3 2.9 -99.7 0.0 C -100.0 -2.9 -100.5 -5.8 -100.9 -8.8 C -101.2 -11.8 -101.6 -14.9 -101.7 -17.9 C -101.8 -21.0 -101.8 -24.1 -101.4 -27.2 C -101.0 -30.2 -100.4 -33.3 -99.4 -36.2 C -98.4 -39.0 -97.0 -41.9 -95.3 -44.5 C -93.7 -47.1 -91.7 -49.5 -89.6 -51.7 C -87.5 -54.0 -85.1 -56.0 -82.7 -57.9 C -80.4 -59.9 -77.9 -61.6 -75.6 -63.4 C -73.2 -65.2 -70.9 -66.9 -68.7 -68.7 C -66.6 -70.6 -64.5 -72.5 -62.5 -74.5 C -60.5 -76.5 -58.6 -78.7 -56.6 -80.9 C -54.7 -83.1 -52.8 -85.5 -50.7 -87.8 C -48.6 -90.0 -46.4 -92.4 -44.1 -94.5 C -41.7 -96.6 -39.2 -98.6 -36.5 -100.2 C -33.8 -101.8 -30.8 -103.1 -27.9 -104.0 C -24.9 -104.9 -21.7 -105.3 -18.6 -105.4 C -15.5 -105.5 -12.3 -105.2 -9.2 -104.6 C -6.1 -104.1 -3.0 -103.1 -0.0 -102.1 C 3.0 -101.2 5.8 -100.0 8.7 -98.9 C 11.5 -97.9 14.2 -96.7 16.9 -95.8 C 19.6 -94.9 22.3 -94.0 25.0 -93.3 C 27.7 -92.6 30.5 -92.1 33.3 -91.6 C 36.2 -91.0 39.1 -90.7 42.0 -90.1 C 45.0 -89.6 48.0 -89.1 51.0 -88.3 C 53.9 -87.5 56.9 -86.6 59.8 -85.3 C 62.6 -84.1 65.4 -82.7 67.9 -80.9 C 70.4 -79.2 72.8 -77.2 75.0 -75.0 C 77.1 -72.8 79.0 -70.3 80.7 -67.7 C 82.4 -65.2 83.9 -62.4 85.2 -59.7 C 86.5 -56.9 87.7 -54.0 88.7 -51.2 C 89.8 -48.4 90.7 -45.6 91.7 -42.7 C 92.6 -39.9 93.5 -37.1 94.3 -34.3 C 95.1 -31.5 95.9 -28.7 96.7 -25.9 C 97.4 -23.1 98.1 -20.3 98.7 -17.4 C 99.3 -14.5 99.8 -11.7 100.1 -8.8 C 100.5 -5.9 100.7 -2.9 100.8 0.0 Z";

function lighten(hex: string, amt: number): string {
  const m = hex.trim().replace("#", "");
  if (m.length < 6) return hex;
  const r = parseInt(m.slice(0, 2), 16),
    g = parseInt(m.slice(2, 4), 16),
    b = parseInt(m.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const sm = (t: number) => t * t * (3 - 2 * t);
const lp = (a: number, b: number, t: number) => a + (b - a) * t;

type Beat = {
  sx: number;
  sy: number;
  dy: number;
  ballO: number;
  sealO: number;
  embO: number;
  es: number;
};

// the press timeline: drop & grow → flatten wide → impress → settle.
// Nothing crosses its rest value, so there is no bounce.
function stateAt(t: number): Beat {
  const grow = eo(win(t, 0, 0.2));
  const s = lp(0.12, 1, grow);
  const pr = sm(win(t, 0.16, 0.3));
  const rec = sm(win(t, 0.3, 0.52));
  const sx = s * (1 + 0.25 * pr * (1 - rec));
  const sy = s * (1 - 0.36 * pr * (1 - rec));
  const dy = lp(-98, 0, eo(win(t, 0, 0.24)));
  return {
    sx,
    sy,
    dy,
    ballO: 1 - win(t, 0.22, 0.32),
    sealO: win(t, 0.24, 0.34),
    embO: win(t, 0.36, 0.5),
    es: lp(0.88, 1, sm(win(t, 0.36, 0.56))),
  };
}

export type WaxStampProps = {
  /** increment once per keep; any change replays the press. */
  playKey: number;
  /** seal diameter, px. Defaults to the Seal button's 64. */
  size?: number;
  /** the letter pressed into the wax (used when `icon` is absent). */
  glyph?: string;
  /** an arbitrary impression: white SVG shapes on a 0-centered, ~120-wide
      field (filled or stroked). Overrides `glyph`. The relief is lit from
      its alpha, so any icon works. */
  icon?: ReactNode;
  className?: string;
};

export function WaxStamp({
  playKey,
  size = 64,
  glyph = "S",
  icon,
  className,
}: WaxStampProps) {
  const uid = useId().replace(/:/g, "");
  const reduce = useRef(false);
  const stage = useRef<SVGGElement>(null);
  const ball = useRef<SVGGElement>(null);
  const seal = useRef<SVGGElement>(null);
  const emb = useRef<SVGGElement>(null);

  // tint the diffuse light with the live wax tokens (themes both modes)
  const [wax, setWax] = useState({ lit: "#5e8cc2", deep: "#21436b" });
  useLayoutEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const bright = cs.getPropertyValue("--wax-bright").trim();
    const deep = cs.getPropertyValue("--wax-deep").trim();
    if (bright || deep)
      setWax({ lit: bright ? lighten(bright, 0.18) : "#6a96c8", deep: deep || "#21436b" });
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const st = stage.current,
      b = ball.current,
      s = seal.current,
      e = emb.current;
    if (!st || !b || !s || !e) return;
    const set = (k: Beat) => {
      st.setAttribute(
        "transform",
        `translate(0 ${k.dy.toFixed(1)}) scale(${k.sx.toFixed(3)} ${k.sy.toFixed(3)})`,
      );
      b.setAttribute("opacity", k.ballO.toFixed(3));
      s.setAttribute("opacity", k.sealO.toFixed(3));
      e.setAttribute("opacity", k.embO.toFixed(3));
      e.setAttribute("transform", `scale(${k.es.toFixed(3)})`);
    };
    if (reduce.current) {
      set(stateAt(1));
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const DUR = 900;
    const frame = (now: number) => {
      const t = (now - t0) / DUR;
      if (t >= 1) {
        set(stateAt(1));
        return;
      }
      set(stateAt(t));
      raf = requestAnimationFrame(frame);
    };
    set(stateAt(0));
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playKey]);

  const fId = `wb-${uid}`;
  const sId = `st-${uid}`;
  const sil = `sil-${uid}`;
  const light = (
    <feDistantLight azimuth="235" elevation="38" />
  );

  return (
    <span
      aria-hidden="true"
      className={cn("relative block", className)}
      style={{ width: size, height: size, overflow: "visible", isolation: "isolate" }}
    >
      <svg viewBox="-112 -112 224 224" width="100%" height="100%" style={{ overflow: "visible" }}>
        <defs>
          {/* grayscale height field for the falling bead (a domed sphere) */}
          <radialGradient id={`ball-${uid}`} cx="42%" cy="36%" r="62%">
            <stop offset="0%" stopColor="#f4f4f4" />
            <stop offset="55%" stopColor="#9a9a9a" />
            <stop offset="100%" stopColor="#0e0e0e" />
          </radialGradient>
          <clipPath id={sil}>
            <path d={BLOB} />
          </clipPath>
          <radialGradient id={`mass-${uid}`} cx="50%" cy="50%" r="52%">
            <stop offset="0%" stopColor="#aaaaaa" />
            <stop offset="50%" stopColor="#c4c4c4" />
            <stop offset="74%" stopColor="#e6e6e6" />
            <stop offset="86%" stopColor="#f4f4f4" />
            <stop offset="94%" stopColor="#cfcfcf" />
            <stop offset="100%" stopColor="#1e1e1e" />
          </radialGradient>

          {/* the wax body: height (alpha) → diffuse(blue) + specular(cool) */}
          <filter
            id={fId}
            x="-55%"
            y="-55%"
            width="210%"
            height="210%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              result="ht"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0"
            />
            <feGaussianBlur in="ht" stdDeviation="5.5" result="hb" />
            <feSpecularLighting
              in="hb"
              surfaceScale="12"
              specularConstant="2.35"
              specularExponent="18"
              lightingColor="#eaf1ff"
              result="sp"
            >
              {light}
            </feSpecularLighting>
            <feDiffuseLighting
              in="hb"
              surfaceScale="12"
              diffuseConstant="1.35"
              lightingColor={wax.lit}
              result="df"
            >
              {light}
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
            <feDropShadow
              in="shiny"
              dx="0"
              dy="10"
              stdDeviation="9"
              floodColor="#0a1a2e"
              floodOpacity="0.34"
            />
          </filter>

          {/* the impression: sharp embossed relief from its alpha */}
          <filter
            id={sId}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="hb" />
            <feSpecularLighting
              in="hb"
              surfaceScale="10"
              specularConstant="1.4"
              specularExponent="24"
              lightingColor="#eaf1ff"
              result="sp"
            >
              <feDistantLight azimuth="235" elevation="48" />
            </feSpecularLighting>
            <feDiffuseLighting
              in="hb"
              surfaceScale="10"
              diffuseConstant="1.2"
              lightingColor={wax.lit}
              result="df"
            >
              <feDistantLight azimuth="235" elevation="48" />
            </feDiffuseLighting>
            <feColorMatrix in="df" type="saturate" values="1.18" result="dfR" />
            <feComponentTransfer in="dfR" result="dfC">
              <feFuncR type="gamma" exponent="1.28" />
              <feFuncG type="gamma" exponent="1.18" />
              <feFuncB type="gamma" exponent="0.92" />
            </feComponentTransfer>
            <feComposite in="dfC" in2="SourceAlpha" operator="in" result="bodyc" />
            <feComposite in="sp" in2="SourceAlpha" operator="in" result="spc" />
            <feBlend in="bodyc" in2="spc" mode="screen" />
          </filter>
        </defs>

        <g ref={stage} transform="scale(0.12)">
          {/* the falling bead */}
          <g ref={ball}>
            <circle r="102" fill={`url(#ball-${uid})`} filter={`url(#${fId})`} />
          </g>
          {/* the formed seal */}
          <g ref={seal} opacity="0">
            <g clipPath={`url(#${sil})`} filter={`url(#${fId})`}>
              <path d={BLOB} fill={`url(#mass-${uid})`} />
              <circle r="52" fill="#9c9c9c" />
              <circle r="68" fill="none" stroke="#535353" strokeWidth="10" />
              <circle r="57" fill="none" stroke="#dadada" strokeWidth="3" />
            </g>
            <g ref={emb} opacity="0" filter={`url(#${sId})`}>
              {icon ?? (
                <text
                  x="0"
                  y="2"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  style={{ fontFamily: "var(--font-serif)", fontWeight: 720, fontSize: 104 }}
                >
                  {glyph}
                </text>
              )}
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
