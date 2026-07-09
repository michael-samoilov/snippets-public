"use client";

/* The recording wash's moving parts — shared by the app (RecordingWash,
   at the bottom) and the /lab/wax-wash desk.
   ShaderBox is a deliberately tiny WebGL mount (fullscreen triangle,
   uniform dials read per-frame). It does NOT honor reduced motion by
   itself: the lab wants motion always (motion is the thing being
   judged), and RecordingWash swaps to the static wash before any
   canvas mounts.
   AURORA_FRAG is ours: domain-warped value noise shaped into hanging
   curtains with sway and shimmer — the thing flat gradients can't do.
   NEURO_FRAG is adapted from Paper Shaders' neuro-noise
   (https://github.com/paper-design/shaders, Apache-2.0), vendored per
   house style rather than installed, and re-tinted to the wash ink. */

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PulsingBorder } from "@/vendor/paper-shaders/react/shaders/pulsing-border";

/* the wash ink: oklab keeps the blue alive at low alpha (srgb dulls it).
   Reads --wash-src, provided by .wax-wash-scene in the app and
   [data-wash-lab] in the lab. */
export const WASH = (pct: number) =>
  `color-mix(in oklab, var(--wash-src) ${pct * 2}%, transparent)`;

/* keeps light near the frame, clears the writing in the middle; `inner`
   is where the clear middle ends — lower reaches further in. Sized by
   closest-side and fully opaque by 88% so the ink actually reaches the
   frame (the old 85%-ellipse metric faded back out before the edge
   midpoints, leaving a faint unpainted rim); the ×0.85 keeps existing
   `inner` values looking the same as before the fix. */
export const edgeMask = (inner = 52) =>
  `radial-gradient(closest-side at 50% 50%, transparent ${inner * 0.85}%, black 88%)`;

/* the aurora's turning conic, in wash ink; `m` scales the pigment */
export const conic = (m: number) =>
  `conic-gradient(from 0deg, ${WASH(19 * m)}, ${WASH(7 * m)}, ${WASH(24 * m)}, ${WASH(9 * m)}, ${WASH(17 * m)}, ${WASH(6 * m)}, ${WASH(19 * m)})`;

export type UniformValue = number | [number, number, number];

/* the wash ink reaches the shader as an rgb triple: read the resolved
   --wash-src off the canvas, let a 2d canvas parse whatever notation
   the theme used (oklch, hex…), and pull the pixel */
function resolveWashColor(el: HTMLElement): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue("--wash-src").trim();
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx || !raw) return [0.23, 0.42, 0.65];
  ctx.fillStyle = "#3a6ba5";
  ctx.fillStyle = raw; // invalid values leave the fallback in place
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function ShaderBox({
  frag,
  uniforms,
  resolutionScale = 1,
}: {
  frag: string;
  /** floats and vec3s, read live every frame — dials update without a remount */
  uniforms: Record<string, UniformValue>;
  /** backing-store scale under the CSS-pixel cap. Soft/noisy output survives
      well below 1 — the shader draws fewer pixels and the canvas bilinear-
      upscales them (a free extra blur). Default 1 (lab fidelity). */
  resolutionScale?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uniformsRef = useRef(uniforms);
  useEffect(() => {
    uniformsRef.current = uniforms;
  });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const gl = cv.getContext("webgl2", { alpha: true, antialias: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("wash shader:", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const dpr = Math.max(0.5, Math.min(1.5, window.devicePixelRatio || 1) * resolutionScale);
    const fit = () => {
      const w = Math.round(cv.clientWidth * dpr);
      const h = Math.round(cv.clientHeight * dpr);
      if (w === cv.width && h === cv.height) return;
      cv.width = Math.max(1, w);
      cv.height = Math.max(1, h);
      gl.viewport(0, 0, cv.width, cv.height);
    };
    fit();

    const color = resolveWashColor(cv);
    const locs = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
      return locs.get(name)!;
    };

    /* the lab exists to judge motion, so it animates even under the
       OS reduce-motion setting — production washes must NOT copy this */
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      gl.uniform1f(loc("u_time"), (now - t0) / 1000);
      gl.uniform2f(loc("u_resolution"), cv.width, cv.height);
      gl.uniform1f(loc("u_dpr"), dpr);
      gl.uniform3f(loc("u_color"), color[0], color[1], color[2]);
      for (const [name, v] of Object.entries(uniformsRef.current)) {
        if (typeof v === "number") gl.uniform1f(loc(name), v);
        else gl.uniform3f(loc(name), v[0], v[1], v[2]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    /* the zone resizes with its day — refit the buffer */
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [frag, resolutionScale]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

/* ---- borealis: curtains of light, hand-rolled, radial ------------------
   The curtain hangs inward from the whole border. Depth comes from a
   rounded-rect signed-distance field, so it hugs the frame at ANY size
   or aspect and follows live resizes; the ray coordinate is a unit
   vector sampled on a closed circle of noise, so there is no seam. */

export const AURORA_FRAG = `#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dpr;
uniform vec3 u_color;
uniform float u_intensity; // overall pigment
uniform float u_rays;      // ray density around the ring
uniform float u_sway;      // how far the curtains bend
uniform float u_pace;      // time scale
uniform float u_flicker;   // shimmer depth
uniform float u_reach;     // how far toward the middle the curtains hang
uniform float u_corner;    // frame corner radius, css px

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.07; a *= 0.5; }
  return v;
}
vec2 rot(vec2 v, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * v;
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * u_resolution;
  vec2 b = 0.5 * u_resolution;
  /* how deep this pixel sits, as a fraction of the frame's half-size */
  float depth = -sdRoundBox(p, b, u_corner * u_dpr) / min(b.x, b.y);
  if (depth <= 0.0) { fragColor = vec4(0.0); return; }

  float t = u_time * u_pace;
  vec2 dir = normalize(p + 1e-4);

  /* the bend grows with depth, like hanging fabric */
  float swayN = fbm(rot(dir, 0.4) * 1.7 + vec2(t * 0.35, -t * 0.11)) - 0.5;
  vec2 sdir = rot(dir, swayN * u_sway * (0.3 + 2.2 * depth));

  /* rays around the ring, slowly processing */
  vec2 rp = rot(sdir, 0.07 * t);
  float ray = fbm(rp * u_rays + vec2(0.31 * t, -0.23 * t));
  ray = pow(smoothstep(0.34, 0.92, ray), 1.5);
  /* a finer counter-turning wisp layer */
  float wisp = fbm(rot(sdir, -0.05 * t) * u_rays * 2.1 + vec2(4.7 - 0.4 * t, 0.26 * t));
  wisp = 0.55 * pow(smoothstep(0.48, 0.95, wisp), 2.0);

  /* full pigment against the border itself, feathering toward the words
     (an earlier draft ramped in over the first 4.5% of depth — it read
     as a hairline gap between the ink and the frame) */
  float prof = 1.0 - smoothstep(0.03, u_reach, depth);
  /* shimmer travelling around the curtain */
  float flick = 1.0 - u_flicker
              * (0.5 + 0.5 * sin(6.2832 * vnoise(dir * 2.0 + vec2(t * 1.9, 0.0))));

  float a = clamp((ray + wisp) * prof * flick * u_intensity, 0.0, 1.0);
  fragColor = vec4(u_color * a, a); // premultiplied
}`;

export const BOREALIS_DEFAULTS = {
  intensity: 0.55,
  rays: 3, // owner-tuned: 2–4 reads as broad slow curtains, not spokes
  sway: 0.28,
  pace: 0.6,
  flicker: 0.35,
  reach: 0.45,
};
export type BorealisOpts = typeof BOREALIS_DEFAULTS;

/* ---- pulsing border: vendored from Paper Shaders -----------------------
   Their PulsingBorder component (the "border gradient"), seeded from its
   own northern-lights preset but re-inked in wash monochrome. The vendored
   react mount handles its own sizing/resize. */

/* owner-tuned defaults, settled on the desk */
export const PULSE_DEFAULTS = {
  thickness: 0.4,
  softness: 1,
  glow: 0.14, // their `intensity`
  bloom: 0.1,
  spots: 6,
  spotSize: 0.3,
  pulse: 0.2,
  smoke: 0,
  smokeSize: 0.5,
  pace: 0.3, // their `speed`
};
export type PulseOpts = typeof PULSE_DEFAULTS;

export function WashPulsingBorder({ o }: { o: PulseOpts }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState<string[] | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const [r, g, b] = resolveWashColor(hostRef.current);
    const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
    const base = `#${hex(r)}${hex(g)}${hex(b)}`;
    /* monochrome wax at three strengths — hue variety is the aurora's,
       not ours; the wash stays one ink */
    setColors([base, `${base}cc`, `${base}77`]);
  }, []);
  return (
    <div ref={hostRef} aria-hidden className="pointer-events-none absolute inset-0">
      {colors && (
        <PulsingBorder
          colors={colors}
          colorBack="#00000000"
          /* the component's own default is scale 0.6 (a floating inner
             box) — scale 1 pins the border to the canvas edges */
          scale={1}
          roundness={0.1}
          thickness={o.thickness}
          softness={o.softness}
          intensity={o.glow}
          bloom={o.bloom}
          spots={o.spots}
          spotSize={o.spotSize}
          pulse={o.pulse}
          smoke={o.smoke}
          smokeSize={o.smokeSize}
          speed={o.pace}
          // the mount renders at max(dpr, minPixelRatio) — i.e. full retina on
          // a phone — and only the pixel ceiling actually reins it in. This
          // border is soft (softness 1 + bloom), so cap it low: ~230k px is
          // about 1.3× CSS pixels on the today zone, and the softness hides it.
          minPixelRatio={1}
          maxPixelCount={230_000}
          style={{ width: "100%", height: "100%" }}
        />
      )}
    </div>
  );
}

/* ---- border beam: a courier of light on the frame ----------------------
   Hand-rolled from the technique in jakubantalik's border-beam
   (beam.jakubantalik.com, MIT) — no dependency, no canvas, one ink.
   The original: a conic comet arc spun by an animatable @property angle,
   masked to the border ring; an inner glow rides along behind it; a
   blurred copy of the ring is the bloom. Theirs cycles a rainbow — ours
   keeps the single wash ink (wax is semantic) and the comet's head/tail
   shading is drawn straight into the conic stops instead of a second
   arc mask. All three layers inherit one angle from the wrapper, so
   they can never drift apart.
   Like ShaderBox, this does NOT gate on reduced motion itself — the lab
   judges motion; production must swap to the static wash first (browsers
   without @property support get the same static arc for free: the spin
   keyframe just never interpolates). */

const BEAM_CSS = `
@property --wash-beam-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: true;
}
@keyframes wash-beam-spin { to { --wash-beam-angle: 360deg; } }
.wash-beam-spin { animation: wash-beam-spin 6.5s linear infinite; }
`;

/* one comet: tail fades in over the arc, head burns brightest at the
   leading edge, then drops off a cliff — the conic wraps at 100% so the
   dark remainder of the turn is the night between laps */
const beamArc = (peak: number, arc: number, offsetDeg = 0) => {
  const tail = (1 - arc) * 100;
  const at = (f: number) => `${(tail + arc * 100 * f).toFixed(2)}%`;
  return `conic-gradient(from calc(var(--wash-beam-angle) + ${offsetDeg}deg),
    transparent 0%, transparent ${at(0)},
    ${WASH(peak * 0.05)} ${at(0.28)},
    ${WASH(peak * 0.18)} ${at(0.55)},
    ${WASH(peak * 0.55)} ${at(0.8)},
    ${WASH(peak)} ${at(0.94)},
    ${WASH(peak * 0.3)} ${at(0.99)},
    transparent 100%)`;
};

/* `heads` couriers spaced evenly around the turn */
const beamArcs = (peak: number, arc: number, heads: number) =>
  Array.from({ length: heads }, (_, i) =>
    beamArc(peak, arc, (360 / heads) * i),
  ).join(", ");

export const BEAM_DEFAULTS = {
  mult: 1, // pigment
  lap: 6.5, // seconds per revolution
  arc: 0.3, // comet length, as a fraction of the turn
  stroke: 2, // ring thickness, css px
  glow: 0.5, // inner-seep opacity
  reach: 30, // how far the seep reaches inward, css px
  bloom: 0.55, // blurred-halo opacity
  heads: 1, // couriers on the frame
};
export type BeamOpts = typeof BEAM_DEFAULTS;

export function WashBorderBeam({ o, corner = 16 }: { o: BeamOpts; corner?: number }) {
  const heads = Math.max(1, Math.round(o.heads));
  /* the stroke/bloom live on the border ring: pad by the stroke width,
     then punch the content-box out of the mask */
  const ring = (pad: number): CSSProperties => ({
    position: "absolute",
    inset: 0,
    padding: pad,
    borderRadius: Math.max(0, corner - pad),
    clipPath: `inset(0 round ${corner}px)`,
    WebkitMask:
      "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    maskComposite: "exclude",
  });
  /* the glow is confined to a band just inside the frame — the union of
     four edge fades, so it seeps inward only where the comet passes */
  const seep = [
    `linear-gradient(white, transparent ${o.reach}px, transparent calc(100% - ${o.reach}px), white)`,
    `linear-gradient(to right, white, transparent ${o.reach}px, transparent calc(100% - ${o.reach}px), white)`,
  ].join(", ");
  return (
    <div
      aria-hidden
      className="wash-beam-spin pointer-events-none absolute inset-0"
      style={{ animationDuration: `${o.lap}s` }}
    >
      <style>{BEAM_CSS}</style>
      {/* inner glow, under the stroke: a wider, fainter comet */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 round ${corner}px)`,
          background: beamArcs(15 * o.mult, Math.min(o.arc * 1.6, 0.85), heads),
          opacity: o.glow,
          WebkitMaskImage: seep,
          maskImage: seep,
          WebkitMaskComposite: "source-over",
          maskComposite: "add",
        }}
      />
      {/* the stroke itself */}
      <div style={{ ...ring(o.stroke), background: beamArcs(46 * o.mult, o.arc, heads) }} />
      {/* bloom: the same ring, blurred into a halo */}
      <div
        style={{
          ...ring(o.stroke),
          background: beamArcs(34 * o.mult, o.arc * 0.85, heads),
          filter: "blur(6px)",
          opacity: o.bloom,
        }}
      />
    </div>
  );
}

/* ---- neuro: vendored from Paper Shaders -------------------------------
   Adapted from paper-design/shaders `neuro-noise` (Apache-2.0):
   the 15-layer rotating-sine accumulator is theirs; the wash tint,
   uv handling, and premultiplied output are ours. */

export const NEURO_FRAG = `#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;
uniform float u_scale;

out vec4 fragColor;

vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

float neuroShape(vec2 uv, float t) {
  vec2 sine_acc = vec2(0.);
  vec2 res = vec2(0.);
  float scale = 8.;
  for (int j = 0; j < 15; j++) {
    uv = rotate(uv, 1.);
    sine_acc = rotate(sine_acc, 1.);
    vec2 layer = uv * scale + float(j) + sine_acc - t;
    sine_acc += sin(layer);
    res += (.5 + .5 * cos(layer)) / scale;
    scale *= (1.2);
  }
  return res.x + res.y;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = 0.5 * u_time;
  float noise = neuroShape(uv * u_scale, t);
  noise = 1.2 * noise * noise;
  noise = pow(noise, 2.2);
  noise = min(1.3, noise);
  float a = clamp(noise * u_intensity, 0.0, 1.0);
  fragColor = vec4(u_color * a, a);
}`;

/* ---- the app's recording wash ------------------------------------------
   The owner-chosen blend, settled on the lab's combo zone:
   aurora 0.20 · borealis 0.30 · pulse 0.45. Each layer's recipe below
   mirrors a lab bench — retune there, then carry the numbers here.
   Honors reduced motion by falling back to the static .wax-wash. */

const APP_AURORA = { mult: 1.4, dur: 26, blur: 32, inner: 53 };
const APP_BOREALIS = {
  u_intensity: 1.0,
  u_rays: 2.0,
  u_sway: 0.5,
  u_pace: 0.6,
  u_flicker: 0.55,
  u_reach: 0.6,
};
const APP_PULSE: PulseOpts = {
  thickness: 0.8,
  softness: 1,
  glow: 0.14,
  bloom: 0.25,
  spots: 6,
  spotSize: 0.3,
  pulse: 0.2,
  smoke: 0.12,
  smokeSize: 0.5,
  pace: 0.3,
};
const APP_MIX = { aurora: 0.2, borealis: 0.3, pulse: 0.45 };

/* memo: the composer re-renders on every streamed word while a take runs;
   the wash depends on none of that, so keep its two canvases off React's
   critical path (the RAF loops keep drawing regardless). */
export const RecordingWash = memo(function RecordingWash({
  corner = 16,
}: {
  corner?: number;
}) {
  /* live, not just initial — the wash may outlast a settings change */
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // stable across re-renders so ShaderBox never re-reads a fresh object
  const borealisUniforms = useMemo(() => ({ ...APP_BOREALIS, u_corner: corner }), [corner]);

  if (reduced) {
    return <div className="wax-wash absolute inset-0 rounded-[inherit]" />;
  }
  return (
    <div className="wax-wash-scene pointer-events-none absolute inset-0 rounded-[inherit]">
      {/* aurora: the conic turning behind the frame. It's a heavy blur, so
          render the conic at half size with half the blur radius and let a
          static 2× upscale finish it — the Gaussian runs on a quarter of the
          pixels. This matters most on WebKit/iOS, which re-rasterizes a
          blurred element on every rotation frame instead of caching it. */}
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-[inherit]"
        style={{
          opacity: APP_MIX.aurora,
          maskImage: edgeMask(APP_AURORA.inner),
          WebkitMaskImage: edgeMask(APP_AURORA.inner),
        }}
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{ width: "100%", aspectRatio: "1", transform: "translate(-50%, -50%) scale(2)" }}
        >
          <div
            className="wax-wash-spin absolute inset-0"
            style={{
              filter: `blur(${APP_AURORA.blur / 2}px)`,
              animationDuration: `${APP_AURORA.dur}s`,
              background: conic(APP_AURORA.mult),
              willChange: "transform",
            }}
          />
        </div>
      </div>
      {/* borealis: noise curtains hanging inward from the border. Low-frequency
          by nature — render below CSS resolution and upscale. */}
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-[inherit]"
        style={{ opacity: APP_MIX.borealis }}
      >
        <ShaderBox frag={AURORA_FRAG} uniforms={borealisUniforms} resolutionScale={0.7} />
      </div>
      {/* pulsing border: smoke pooling along the frame. Soft enough (softness 1,
          bloom) to render at ~1.3× CSS pixels — the mount's default is retina. */}
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-[inherit]"
        style={{ opacity: APP_MIX.pulse }}
      >
        <WashPulsingBorder o={APP_PULSE} />
      </div>
    </div>
  );
});
