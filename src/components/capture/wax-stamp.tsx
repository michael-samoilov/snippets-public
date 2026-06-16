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
  "M 101.5 0.0 C 102.0 2.9 102.3 5.9 102.2 8.8 C 102.2 11.7 101.9 14.7 101.4 17.5 C 100.9 20.4 100.1 23.3 99.2 26.1 C 98.3 28.9 97.2 31.6 96.1 34.3 C 95.0 37.0 93.9 39.7 92.7 42.3 C 91.6 45.0 90.5 47.7 89.3 50.4 C 88.1 53.1 86.9 55.9 85.6 58.5 C 84.3 61.2 82.9 63.9 81.2 66.4 C 79.6 68.9 77.8 71.4 75.7 73.6 C 73.6 75.7 71.2 77.7 68.7 79.3 C 66.2 80.9 63.3 82.2 60.5 83.3 C 57.7 84.3 54.6 85.0 51.7 85.7 C 48.8 86.4 45.8 86.8 42.9 87.4 C 40.1 87.9 37.4 88.4 34.7 89.2 C 32.1 90.0 29.6 91.0 27.1 92.2 C 24.5 93.4 22.1 94.9 19.5 96.4 C 17.0 98.0 14.4 99.8 11.6 101.4 C 8.9 103.0 6.0 104.7 3.0 105.9 C 0.1 107.1 -3.1 108.1 -6.2 108.5 C -9.3 108.8 -12.5 108.7 -15.5 108.1 C -18.6 107.4 -21.6 106.2 -24.3 104.6 C -27.1 103.1 -29.7 100.9 -32.1 98.8 C -34.5 96.7 -36.7 94.2 -38.9 92.0 C -41.1 89.8 -43.0 87.5 -45.2 85.6 C -47.3 83.7 -49.4 81.9 -51.7 80.5 C -54.0 79.0 -56.5 77.8 -59.1 76.6 C -61.7 75.4 -64.5 74.5 -67.3 73.4 C -70.2 72.2 -73.2 71.1 -75.9 69.7 C -78.7 68.2 -81.4 66.6 -83.8 64.6 C -86.1 62.6 -88.2 60.3 -89.9 57.8 C -91.5 55.2 -92.8 52.4 -93.7 49.4 C -94.6 46.5 -95.1 43.4 -95.4 40.3 C -95.8 37.3 -95.7 34.1 -95.8 31.1 C -95.9 28.1 -95.8 25.2 -96.0 22.3 C -96.1 19.4 -96.4 16.7 -96.8 13.9 C -97.2 11.1 -97.9 8.4 -98.6 5.6 C -99.3 2.8 -100.2 0.0 -101.0 -2.9 C -101.7 -5.8 -102.5 -8.8 -103.0 -11.8 C -103.4 -14.8 -103.8 -18.0 -103.7 -21.0 C -103.5 -24.0 -103.1 -27.1 -102.3 -30.0 C -101.4 -32.9 -100.1 -35.8 -98.6 -38.4 C -97.1 -41.0 -95.2 -43.5 -93.2 -45.8 C -91.2 -48.1 -88.9 -50.3 -86.8 -52.3 C -84.6 -54.4 -82.2 -56.2 -80.1 -58.2 C -77.9 -60.1 -75.7 -61.9 -73.7 -63.8 C -71.6 -65.8 -69.7 -67.7 -67.8 -69.7 C -65.8 -71.8 -64.0 -73.9 -62.2 -76.0 C -60.3 -78.2 -58.5 -80.4 -56.5 -82.6 C -54.5 -84.8 -52.5 -87.1 -50.3 -89.1 C -48.2 -91.2 -45.9 -93.3 -43.4 -95.1 C -41.0 -96.9 -38.4 -98.7 -35.7 -100.1 C -33.0 -101.5 -30.1 -102.6 -27.2 -103.5 C -24.3 -104.3 -21.2 -104.9 -18.2 -105.1 C -15.2 -105.4 -12.0 -105.3 -9.0 -105.0 C -6.0 -104.6 -2.9 -103.9 -0.0 -103.1 C 2.9 -102.3 5.8 -101.2 8.6 -100.2 C 11.4 -99.1 14.1 -97.8 16.7 -96.6 C 19.4 -95.5 21.9 -94.3 24.5 -93.3 C 27.1 -92.2 29.6 -91.3 32.3 -90.5 C 34.9 -89.7 37.6 -89.1 40.4 -88.5 C 43.2 -87.9 46.1 -87.4 49.0 -86.8 C 52.0 -86.2 55.1 -85.7 58.0 -84.9 C 61.0 -84.1 64.1 -83.2 67.0 -81.9 C 69.8 -80.6 72.6 -79.1 75.0 -77.2 C 77.5 -75.3 79.7 -73.1 81.6 -70.7 C 83.5 -68.3 85.0 -65.5 86.2 -62.7 C 87.5 -59.8 88.4 -56.8 89.1 -53.8 C 89.9 -50.8 90.3 -47.6 90.8 -44.7 C 91.4 -41.7 91.7 -38.7 92.2 -35.9 C 92.7 -33.0 93.2 -30.3 93.9 -27.6 C 94.5 -24.8 95.3 -22.2 96.2 -19.5 C 97.0 -16.8 97.9 -14.1 98.7 -11.3 C 99.6 -8.6 100.4 -5.7 101.0 -2.9 C 101.6 -0.0 102.0 2.9 102.2 5.8 Z";

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
      setWax({ lit: bright || "#5e8cc2", deep: deep || "#21436b" });
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
      <svg viewBox="-124 -124 248 248" width="100%" height="100%" style={{ overflow: "visible" }}>
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
            <feGaussianBlur in="ht" stdDeviation="3" result="hb" />
            <feSpecularLighting
              in="hb"
              surfaceScale="15"
              specularConstant="1.5"
              specularExponent="22"
              lightingColor="#eaf1ff"
              result="sp"
            >
              {light}
            </feSpecularLighting>
            <feDiffuseLighting
              in="hb"
              surfaceScale="15"
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
              <path d={BLOB} fill="#ffffff" />
              <circle r="53" fill="#9a9a9a" />
              <circle r="70" fill="none" stroke="#454545" strokeWidth="8" />
              <circle r="60" fill="none" stroke="#dadada" strokeWidth="3.5" />
            </g>
            <g ref={emb} opacity="0" filter={`url(#${sId})`}>
              {icon ?? (
                <text
                  x="0"
                  y="2"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  style={{ fontFamily: "var(--font-serif)", fontWeight: 680, fontSize: 98 }}
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
