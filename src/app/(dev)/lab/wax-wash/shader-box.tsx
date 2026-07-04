"use client";

/* WebGL candidates for the recording wash — lab-only for now.
   ShaderBox is a deliberately tiny mount (fullscreen triangle, uniform
   dials read per-frame, single static frame under reduced motion).
   AURORA_FRAG is ours: domain-warped value noise shaped into hanging
   curtains with sway and shimmer — the thing flat gradients can't do.
   NEURO_FRAG is adapted from Paper Shaders' neuro-noise
   (https://github.com/paper-design/shaders, Apache-2.0), vendored per
   house style rather than installed, and re-tinted to the wash ink. */

import { useEffect, useRef, useState } from "react";
import { PulsingBorder } from "@/vendor/paper-shaders/react/shaders/pulsing-border";

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
}: {
  frag: string;
  /** floats and vec3s, read live every frame — dials update without a remount */
  uniforms: Record<string, UniformValue>;
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

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
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

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    /* the zone resizes with its day — refit and (under reduced motion,
       where no loop runs) repaint the single frame */
    const ro = new ResizeObserver(() => {
      fit();
      if (reduced) draw(performance.now());
    });
    ro.observe(cv);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [frag]);

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

  /* bright lip just inside the border, feathering toward the words */
  float prof = smoothstep(0.0, 0.045, depth) * (1.0 - smoothstep(0.05, u_reach, depth));
  /* shimmer travelling around the curtain */
  float flick = 1.0 - u_flicker
              * (0.5 + 0.5 * sin(6.2832 * vnoise(dir * 2.0 + vec2(t * 1.9, 0.0))));

  float a = clamp((ray + wisp) * prof * flick * u_intensity, 0.0, 1.0);
  fragColor = vec4(u_color * a, a); // premultiplied
}`;

export const BOREALIS_DEFAULTS = {
  intensity: 0.55,
  rays: 5,
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

export const PULSE_DEFAULTS = {
  thickness: 1,
  softness: 1,
  glow: 0.1, // their `intensity`
  bloom: 0.2,
  spots: 4,
  spotSize: 0.25,
  pulse: 0,
  smoke: 0.32,
  smokeSize: 0.5,
  pace: 0.18, // their `speed`
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
          roundness={0.07}
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
          style={{ width: "100%", height: "100%" }}
        />
      )}
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
