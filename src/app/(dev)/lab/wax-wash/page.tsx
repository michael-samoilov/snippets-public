"use client";

/* Dev lab for the recording "wax wash" — the blue wash that seeps inward
   from the today zone's border while the microphone is on. Each card is
   one treatment on a mock zone; the toggle plays enter/exit, auto cycles
   it. The static winner (four edges · breathing) shipped to
   TodayZoneFill; the animated rounds live here until one is chosen.
   Round two sweeps the three finalists — inhale, aurora, curtains —
   across intensity (pigment), speed (period), and extent (reach).
   The desk at the top has every dial live; tapping a sweep card loads
   its recipe onto the desk. The recipe line under each desk zone is
   the values to carry into production.
   Theme: localStorage.setItem('theme','dark') + reload, as everywhere. */

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ShaderBox,
  AURORA_FRAG,
  NEURO_FRAG,
  BOREALIS_DEFAULTS,
  WashPulsingBorder,
  PULSE_DEFAULTS,
  WASH,
  edgeMask,
  conic,
  type BorealisOpts,
  type PulseOpts,
} from "@/components/capture/wash-shaders";

/* the shipped four-edge seep, with dials: `mult` scales the pigment,
   `reach` scales how far the seep travels from the frame */
const fourEdge = (mult = 1, reach = 1) =>
  [
    `linear-gradient(to bottom, ${WASH(13 * mult)}, transparent ${18 * reach}%)`,
    `linear-gradient(to top, ${WASH(13 * mult)}, transparent ${18 * reach}%)`,
    `linear-gradient(to right, ${WASH(9 * mult)}, transparent ${22 * reach}%)`,
    `linear-gradient(to left, ${WASH(9 * mult)}, transparent ${22 * reach}%)`,
  ].join(", ");

const FOUR_EDGE = fourEdge();

interface Layer {
  className?: string;
  style: React.CSSProperties;
}

type FamilyKey = "inhale" | "aurora" | "curtains" | "borealis" | "pulse";

interface Variant {
  key: string;
  label: string;
  note: string;
  /** the base wash layer */
  wash?: React.CSSProperties;
  washClass?: string;
  /** extra animated layers inside the (masked, clipped) wash container */
  layers?: Layer[];
  /** mask on the container, confining light to the edges */
  mask?: string;
  /** a rendered layer (shader canvas) inside the wash container */
  node?: React.ReactNode;
  /** which desk bench this card's recipe loads onto, and the resolved dials */
  family?: FamilyKey;
  opts?: Record<string, number>;
}

/* ---- inhale: the seep's reach swells and settles ---------------------- */

const INHALE_DEFAULTS = { mult: 1, reach: 1, dur: 3.2, scale: 1.05, dim: 0.66 };
type InhaleOpts = typeof INHALE_DEFAULTS;

function inhale(
  key: string,
  label: string,
  note: string,
  opts: Partial<InhaleOpts> = {},
): Variant {
  const { mult, reach, dur, scale, dim } = { ...INHALE_DEFAULTS, ...opts };
  return {
    key,
    label,
    note,
    family: "inhale",
    opts: { mult, reach, dur, scale, dim },
    washClass: "wash-inhale",
    wash: {
      background: fourEdge(mult, reach),
      animationDuration: `${dur}s`,
      "--inhale-scale": String(scale),
      "--inhale-dim": String(dim),
    } as React.CSSProperties,
  };
}

/* ---- aurora: wax hues turning very slowly behind the frame ------------ */

const AURORA_DEFAULTS = { mult: 1, dur: 26, blur: 26, inner: 52 };
type AuroraOpts = typeof AURORA_DEFAULTS;

function aurora(
  key: string,
  label: string,
  note: string,
  opts: Partial<AuroraOpts> = {},
): Variant {
  const { mult, dur, blur, inner } = { ...AURORA_DEFAULTS, ...opts };
  return {
    key,
    label,
    note,
    family: "aurora",
    opts: { mult, dur, blur, inner },
    mask: edgeMask(inner),
    layers: [
      {
        /* a 200%-of-width square centred on the zone: still covers a
           portrait frame up to √3× as tall as it is wide */
        className: "wash-spin",
        style: {
          position: "absolute",
          left: "-50%",
          top: "50%",
          width: "200%",
          aspectRatio: "1",
          marginTop: "-100%",
          filter: `blur(${blur}px)`,
          animationDuration: `${dur}s`,
          background: conic(mult),
        },
      },
    ],
  };
}

/* ---- curtains: two counter-drifting glows ----------------------------- */

const CURTAINS_DEFAULTS = { mult: 1, durA: 14, durB: 19, drift: 7, spread: 1, inner: 52 };
type CurtainsOpts = typeof CURTAINS_DEFAULTS;

function curtains(
  key: string,
  label: string,
  note: string,
  opts: Partial<CurtainsOpts> = {},
): Variant {
  const { mult, durA, durB, drift, spread, inner } = { ...CURTAINS_DEFAULTS, ...opts };
  return {
    key,
    label,
    note,
    family: "curtains",
    opts: { mult, durA, durB, drift, spread, inner },
    mask: edgeMask(inner),
    layers: [
      {
        className: "wash-curtain-a",
        style: {
          position: "absolute",
          inset: "-10%",
          filter: "blur(18px)",
          animationDuration: `${durA}s`,
          "--drift": `${drift}%`,
          background: `radial-gradient(${50 * spread}% ${38 * spread}% at 30% 0%, ${WASH(26 * mult)}, transparent 74%), radial-gradient(${44 * spread}% ${34 * spread}% at 78% 100%, ${WASH(19 * mult)}, transparent 72%)`,
        } as React.CSSProperties,
      },
      {
        className: "wash-curtain-b",
        style: {
          position: "absolute",
          inset: "-10%",
          filter: "blur(22px)",
          animationDuration: `${durB}s`,
          "--drift": `${drift}%`,
          background: `radial-gradient(${42 * spread}% ${34 * spread}% at 72% 0%, ${WASH(17 * mult)}, transparent 72%), radial-gradient(${50 * spread}% ${36 * spread}% at 22% 100%, ${WASH(22 * mult)}, transparent 74%)`,
        } as React.CSSProperties,
      },
    ],
  };
}

/* ---- round one, kept for reference ------------------------------------ */

const ROUND_ONE: Variant[] = [
  {
    key: "shipped",
    label: "four edges · breathing (shipped)",
    note: "the current production wash, for reference",
    wash: { background: FOUR_EDGE },
    washClass: "wash-breathe",
  },
  {
    key: "ripple",
    label: "sonar",
    note: "a ring collapsing inward on the listening cadence",
    wash: { background: FOUR_EDGE, opacity: 0.5 },
    layers: [
      {
        className: "wash-ripple",
        style: {
          position: "absolute",
          inset: 2,
          borderRadius: 14,
          border: `1px solid ${WASH(34)}`,
        },
      },
      {
        className: "wash-ripple wash-ripple-late",
        style: {
          position: "absolute",
          inset: 2,
          borderRadius: 14,
          border: `1px solid ${WASH(34)}`,
        },
      },
    ],
  },
  {
    key: "vignette",
    label: "vignette (static)",
    note: "one radial, strongest in the corners",
    wash: {
      background: `radial-gradient(72% 72% at 50% 50%, transparent 52%, ${WASH(16)} 100%)`,
    },
  },
  {
    key: "watercolor",
    label: "watercolor (static)",
    note: "broad seep + pigment pooling against the lip",
    wash: {
      background: [
        `linear-gradient(to bottom, ${WASH(11)}, transparent 4%)`,
        `linear-gradient(to top, ${WASH(11)}, transparent 4%)`,
        `linear-gradient(to right, ${WASH(10)}, transparent 5%)`,
        `linear-gradient(to left, ${WASH(10)}, transparent 5%)`,
        FOUR_EDGE,
      ].join(", "),
    },
  },
];

/* ---- round three: can anything actually dance? ------------------------
   (the round-two parameter sweeps were retired once the desk's dials
   covered the same space continuously — subtle variants are turned,
   not listed) */

const borealisUniforms = (o: BorealisOpts) => ({
  u_intensity: o.intensity,
  u_rays: o.rays,
  u_sway: o.sway,
  u_pace: o.pace,
  u_flicker: o.flicker,
  u_reach: o.reach,
  u_corner: 16, // rounded-2xl, matching the zone frame
});

const RAYS_TOP_MASK = "linear-gradient(to bottom, black 3%, transparent 46%)";
const RAYS_BOTTOM_MASK = "linear-gradient(to top, black 3%, transparent 40%)";

const ROUND_THREE: Variant[] = [
  {
    key: "borealis",
    label: "borealis (webgl · radial)",
    note: "curtains hanging inward from the whole border — tap to put it on the desk",
    family: "borealis",
    opts: { ...BOREALIS_DEFAULTS },
    node: <ShaderBox frag={AURORA_FRAG} uniforms={borealisUniforms(BOREALIS_DEFAULTS)} />,
  },
  {
    key: "pulse",
    label: "pulsing border (vendored)",
    note: "paper shaders' border, northern-lights recipe in wash ink — tap for the desk",
    family: "pulse",
    opts: { ...PULSE_DEFAULTS },
    node: <WashPulsingBorder o={PULSE_DEFAULTS} />,
  },
  {
    key: "neuro",
    label: "neuro (webgl · vendored)",
    note: "paper shaders' neuro-noise in wash ink (apache-2.0)",
    mask: edgeMask(46),
    node: <ShaderBox frag={NEURO_FRAG} uniforms={{ u_intensity: 0.8, u_scale: 1 }} />,
  },
  {
    key: "css-rays",
    label: "rays (gradients only)",
    note: "two repeating gradients drifting under a fade — no canvas",
    layers: [
      {
        className: "wash-rays-a",
        style: {
          position: "absolute",
          inset: "-24px",
          filter: "blur(7px)",
          background: `repeating-linear-gradient(87deg, transparent 0px, transparent 9px, ${WASH(26)} 13px, transparent 21px)`,
          WebkitMaskImage: RAYS_TOP_MASK,
          maskImage: RAYS_TOP_MASK,
        },
      },
      {
        className: "wash-rays-b",
        style: {
          position: "absolute",
          inset: "-24px",
          filter: "blur(11px)",
          background: `repeating-linear-gradient(94deg, transparent 0px, transparent 14px, ${WASH(20)} 19px, transparent 30px)`,
          WebkitMaskImage: RAYS_BOTTOM_MASK,
          maskImage: RAYS_BOTTOM_MASK,
        },
      },
    ],
  },
];

/* one treatment's wash container — clipped to the frame, masked to its
   edges; `opacity` lets the combo zone weigh treatments against each other */
function WashLayer({ v, on, opacity = 1 }: { v: Variant; on: boolean; opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-[240ms] ease-[var(--ease-out)]"
      style={{
        opacity: on ? opacity : 0,
        ...(v.mask
          ? { maskImage: v.mask, WebkitMaskImage: v.mask }
          : null),
      }}
    >
      {v.wash && (
        <div
          className={`absolute inset-0 ${v.washClass ?? ""}`}
          style={v.wash}
        />
      )}
      {v.layers?.map((l, i) => (
        <div key={i} className={l.className} style={l.style} />
      ))}
      {v.node}
    </div>
  );
}

/* the mock zone's furniture: date, ruled lines, stand-in dome */
function ZoneContent({ on }: { on: boolean }) {
  return (
    <div className="flex h-full flex-col items-center gap-4 px-4 py-6 text-center">
      <div className="mt-10 leading-none">
        <p className="voice-label text-[0.72rem] text-ink-faint">Friday</p>
        <h2 className="voice-display mt-1 text-[1.6rem] leading-none text-ink">July 3</h2>
      </div>
      <div className="flex-1" />
      <div
        className="w-[calc(100%-28px)]"
        style={{
          height: 60,
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--rule-faint) 19px, var(--rule-faint) 20px)",
        }}
      />
      <div className="flex-1" />
      {/* stand-in dome */}
      <div
        className="mb-6 size-[88px] rounded-full"
        style={{
          transform: on ? "scale(1.14)" : "scale(1)",
          transition: "transform 240ms var(--ease-out)",
          background:
            "radial-gradient(circle at 32% 28%, var(--wax-bright) 0%, var(--wax) 48%, var(--wax-deep) 100%)",
          boxShadow:
            "inset 0 1.5px 2px rgb(255 255 255/0.3), inset 0 -3px 5px rgb(0 0 0/0.3), 0 5px 12px -2px var(--wax-shadow)",
        }}
      />
    </div>
  );
}

const CARD_FRAME =
  "relative h-[430px] w-[300px] rounded-2xl border border-wax/45 transition-[width,height] duration-[240ms] ease-[var(--ease-out)]";

function MockZone({
  v,
  on,
  onPick,
  size,
}: {
  v: Variant;
  on: boolean;
  /** when set, tapping the card loads its recipe onto the desk */
  onPick?: (v: Variant) => void;
  /** the real zone is never one fixed size — benches can stretch it */
  size?: { w: number; h: number };
}) {
  return (
    <figure className="m-0">
      <div
        className={`${CARD_FRAME} ${onPick ? "cursor-pointer" : ""}`}
        style={size ? { width: size.w, height: size.h } : undefined}
        onClick={onPick ? () => onPick(v) : undefined}
        title={onPick ? "load onto the desk" : undefined}
      >
        <WashLayer v={v} on={on} />
        <ZoneContent on={on} />
      </div>
      <figcaption className="voice-label mt-2 text-center text-[0.72rem] text-ink-soft">
        {v.label}
        <span className="voice-data block text-[0.62rem] lowercase text-ink-faint">{v.note}</span>
      </figcaption>
    </figure>
  );
}

/* the combo zone: every bench's current treatment stacked in one frame,
   each at its own weight */
function ComboZone({
  layers,
  on,
  size,
  note,
}: {
  layers: { v: Variant; opacity: number }[];
  on: boolean;
  size?: { w: number; h: number };
  note: string;
}) {
  return (
    <figure className="m-0">
      <div className={CARD_FRAME} style={size ? { width: size.w, height: size.h } : undefined}>
        {layers.map((l) => (
          <WashLayer key={l.v.key} v={l.v} on={on} opacity={l.opacity} />
        ))}
        <ZoneContent on={on} />
      </div>
      <figcaption className="voice-label mt-2 text-center text-[0.72rem] text-ink-soft">
        combo
        <span className="voice-data block text-[0.62rem] lowercase text-ink-faint">{note}</span>
      </figcaption>
    </figure>
  );
}

/* one dial on the desk: label + live value + range, stamp-lab style */
function Dial({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[0.85rem]">
      <span className="voice-data w-28 shrink-0 lowercase">
        {label} {(fmt ?? ((v: number) => v.toFixed(2)))(value)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full min-w-0"
      />
    </label>
  );
}

/* a bench: one live zone + its dial column + the recipe to carry away */
function Bench({
  v,
  on,
  onReset,
  size,
  children,
}: {
  v: Variant;
  on: boolean;
  onReset: () => void;
  size?: { w: number; h: number };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <MockZone v={v} on={on} size={size} />
      {/* beside the zone on desktop; wraps beneath it on a phone */}
      <div className="flex w-[300px] flex-col gap-2.5 sm:mt-9 sm:w-60">
        {children}
        <button
          type="button"
          onClick={onReset}
          className="voice-label pressable mt-1 self-start rounded-full border border-rule px-3 py-1 text-[0.68rem] text-ink-soft"
        >
          reset
        </button>
      </div>
    </div>
  );
}

const s = (v: number) => `${v.toFixed(1)}s`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const int = (v: number) => String(Math.round(v));

export default function WaxWashLab() {
  const [on, setOn] = useState(true);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setOn((v) => !v), 1600);
    return () => clearInterval(t);
  }, [auto]);

  const [inh, setInh] = useState(INHALE_DEFAULTS);
  const [aur, setAur] = useState(AURORA_DEFAULTS);
  const [cur, setCur] = useState(CURTAINS_DEFAULTS);
  const [bor, setBor] = useState(BOREALIS_DEFAULTS);
  const [pul, setPul] = useState(PULSE_DEFAULTS);
  /* the combo can stretch its zone, proving every effect refits */
  const [zone, setZone] = useState({ w: 300, h: 430 });
  /* per-treatment weights for the combo zone */
  const [mix, setMix] = useState({
    shipped: 0,
    inhale: 0,
    aurora: 0,
    curtains: 0,
    borealis: 1,
    pulse: 1,
  });
  const deskRef = useRef<HTMLElement>(null);

  /* lamplight/paper without a trip to settings; the key on the page body
     remounts the shader canvases so they re-read the wash ink.
     resolvedTheme is undefined until hydration — no mounted flag needed. */
  const { resolvedTheme, setTheme } = useTheme();

  /* tapping a sweep card sends its recipe to the matching bench */
  const pick = (v: Variant) => {
    if (!v.family) return;
    if (v.family === "inhale") setInh({ ...INHALE_DEFAULTS, ...(v.opts as Partial<InhaleOpts>) });
    if (v.family === "aurora") setAur({ ...AURORA_DEFAULTS, ...(v.opts as Partial<AuroraOpts>) });
    if (v.family === "curtains") setCur({ ...CURTAINS_DEFAULTS, ...(v.opts as Partial<CurtainsOpts>) });
    if (v.family === "borealis") setBor({ ...BOREALIS_DEFAULTS, ...(v.opts as Partial<BorealisOpts>) });
    if (v.family === "pulse") setPul({ ...PULSE_DEFAULTS, ...(v.opts as Partial<PulseOpts>) });
    deskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const inhZone = inhale(
    "desk-inhale",
    "inhale",
    `mult ${inh.mult.toFixed(2)} · reach ${inh.reach.toFixed(2)} · ${inh.dur.toFixed(1)}s · scale ${inh.scale.toFixed(3)} · dim ${inh.dim.toFixed(2)}`,
    inh,
  );
  const aurZone = aurora(
    "desk-aurora",
    "aurora",
    `mult ${aur.mult.toFixed(2)} · ${aur.dur.toFixed(0)}s · blur ${aur.blur.toFixed(0)} · inner ${aur.inner.toFixed(0)}%`,
    aur,
  );
  const curZone = curtains(
    "desk-curtains",
    "curtains",
    `mult ${cur.mult.toFixed(2)} · ${cur.durA.toFixed(1)}s/${cur.durB.toFixed(1)}s · drift ${cur.drift.toFixed(1)}% · spread ${cur.spread.toFixed(2)} · inner ${cur.inner.toFixed(0)}%`,
    cur,
  );
  const borZone: Variant = {
    key: "desk-borealis",
    label: "borealis",
    note: `int ${bor.intensity.toFixed(2)} · rays ${bor.rays.toFixed(1)} · sway ${bor.sway.toFixed(2)} · pace ${bor.pace.toFixed(2)} · flicker ${bor.flicker.toFixed(2)} · reach ${bor.reach.toFixed(2)}`,
    node: <ShaderBox frag={AURORA_FRAG} uniforms={borealisUniforms(bor)} />,
  };
  const pulZone: Variant = {
    key: "desk-pulse",
    label: "pulsing border",
    note: `thick ${pul.thickness.toFixed(2)} · soft ${pul.softness.toFixed(2)} · glow ${pul.glow.toFixed(2)} · bloom ${pul.bloom.toFixed(2)} · spots ${pul.spots.toFixed(0)}×${pul.spotSize.toFixed(2)} · pulse ${pul.pulse.toFixed(2)} · smoke ${pul.smoke.toFixed(2)}/${pul.smokeSize.toFixed(2)} · pace ${pul.pace.toFixed(2)}`,
    node: <WashPulsingBorder o={pul} />,
  };

  return (
    <main className="fixed inset-0 z-50 overflow-auto bg-[var(--desk)] p-4 sm:p-8" data-wash-lab>
      <style>{`
        [data-wash-lab] { --wash-src: var(--wax); }
        .dark [data-wash-lab] { --wash-src: var(--wax-bright); }

        @keyframes wash-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
        .wash-breathe { animation: wash-breathe 3.2s var(--ease-in-out) infinite; }

        /* the reach itself breathes — transform only, center-origin;
           amplitude and trough are dials (--inhale-scale, --inhale-dim) */
        @keyframes wash-inhale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% {
            transform: scale(var(--inhale-scale, 1.05));
            opacity: var(--inhale-dim, 0.66);
          }
        }
        .wash-inhale { animation: wash-inhale 3.2s var(--ease-in-out) infinite; }

        /* aurora: a very slow turn; the edge mask keeps it out of the words */
        @keyframes wash-spin { to { transform: rotate(360deg); } }
        .wash-spin { animation: wash-spin 26s linear infinite; }

        /* curtains: counter-phased lateral drift, northern-lights slow;
           travel is a dial (--drift), b runs at 0.86× a's amplitude */
        @keyframes wash-curtain-a {
          0%, 100% { transform: translateX(calc(-1 * var(--drift, 7%))) translateY(0); }
          50% { transform: translateX(var(--drift, 7%)) translateY(2%); }
        }
        .wash-curtain-a { animation: wash-curtain-a 14s var(--ease-in-out) infinite; }
        @keyframes wash-curtain-b {
          0%, 100% { transform: translateX(calc(0.86 * var(--drift, 7%))) translateY(1.5%); }
          50% { transform: translateX(calc(-0.86 * var(--drift, 7%))) translateY(0); }
        }
        .wash-curtain-b { animation: wash-curtain-b 19s var(--ease-in-out) infinite; }

        /* sonar: a ring collapsing inward, the seal-ring's inverse */
        @keyframes wash-ripple {
          0% { transform: scale(1); opacity: 0.55; }
          75%, 100% { transform: scale(0.92); opacity: 0; }
        }
        .wash-ripple { animation: wash-ripple 2.6s var(--ease-out) infinite; }
        .wash-ripple-late { animation-delay: 1.3s; }

        /* rays: near-vertical stripes counter-drifting; the uneven opacity
           stops are the flicker — CSS has no noise, only irregularity */
        @keyframes wash-rays-a {
          0%, 100% { transform: translateX(-2.5%); opacity: 0.9; }
          13% { opacity: 0.55; }
          31% { opacity: 0.95; }
          50% { transform: translateX(2.5%); opacity: 0.65; }
          72% { opacity: 1; }
          88% { opacity: 0.6; }
        }
        .wash-rays-a { animation: wash-rays-a 11s var(--ease-in-out) infinite; }
        @keyframes wash-rays-b {
          0%, 100% { transform: translateX(2%); opacity: 0.8; }
          19% { opacity: 0.5; }
          42% { opacity: 0.9; }
          50% { transform: translateX(-2%); opacity: 0.6; }
          67% { opacity: 0.95; }
          84% { opacity: 0.55; }
        }
        .wash-rays-b { animation: wash-rays-b 17s var(--ease-in-out) infinite; }

        /* No reduced-motion collapse here, deliberately: this lab exists
           to judge motion, so it must show motion even when the OS asks
           for less. The production wash honors reduced motion. */
      `}</style>
      <header className="mb-6 flex items-center gap-4">
        <h1 className="voice-display text-[1.4rem] text-ink">wax wash</h1>
        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          className="voice-label pressable rounded-full border border-rule px-3 py-1 text-[0.72rem] text-ink-soft"
        >
          {on ? "listening" : "idle"}
        </button>
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          className="voice-label pressable rounded-full border border-rule px-3 py-1 text-[0.72rem] text-ink-soft"
        >
          {auto ? "auto: on" : "auto: off"}
        </button>
      </header>
      {/* keyed by theme: a flip remounts the shader canvases so they
          re-resolve the wash ink; css washes recolor on their own */}
      <div key={resolvedTheme ?? "boot"}>
      <section className="mb-12">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">the combo</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          the benches layered in one frame — each dial is a treatment’s weight; shape the treatments themselves on the desk below
        </p>
        <div className="flex flex-wrap items-start gap-5">
          <ComboZone
            on={on}
            size={zone}
            note={
              Object.entries(mix)
                .filter(([, o]) => o > 0)
                .map(([k, o]) => `${k} ${o.toFixed(2)}`)
                .join(" · ") || "all weights at zero"
            }
            layers={[
              { v: ROUND_ONE[0], opacity: mix.shipped },
              { v: inhZone, opacity: mix.inhale },
              { v: aurZone, opacity: mix.aurora },
              { v: curZone, opacity: mix.curtains },
              { v: pulZone, opacity: mix.pulse },
              { v: borZone, opacity: mix.borealis },
            ]}
          />
          <div className="flex w-[300px] flex-col gap-2.5 sm:mt-9 sm:w-60">
            <Dial label="shipped" value={mix.shipped} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, shipped: v })} />
            <Dial label="inhale" value={mix.inhale} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, inhale: v })} />
            <Dial label="aurora" value={mix.aurora} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, aurora: v })} />
            <Dial label="curtains" value={mix.curtains} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, curtains: v })} />
            <Dial label="borealis" value={mix.borealis} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, borealis: v })} />
            <Dial label="border" value={mix.pulse} min={0} max={1} step={0.05} onChange={(v) => setMix({ ...mix, pulse: v })} />
            <Dial label="zone w" value={zone.w} min={220} max={380} step={4} fmt={int} onChange={(v) => setZone({ ...zone, w: v })} />
            <Dial label="zone h" value={zone.h} min={280} max={600} step={4} fmt={int} onChange={(v) => setZone({ ...zone, h: v })} />
            <p className="voice-data text-[0.6rem] lowercase text-ink-faint">
              a layer’s look inherits its bench — retune below and the combo follows
            </p>
          </div>
        </div>
      </section>
      <section ref={deskRef} className="mb-12 scroll-mt-8">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">the desk</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          every dial live — tap any card below to send its recipe here; the line under each zone is what production gets
        </p>
        <div className="flex flex-wrap gap-x-12 gap-y-8">
          <Bench v={inhZone} on={on} onReset={() => setInh(INHALE_DEFAULTS)}>
            <Dial label="pigment" value={inh.mult} min={0.2} max={2} step={0.05} onChange={(v) => setInh({ ...inh, mult: v })} />
            <Dial label="reach" value={inh.reach} min={0.4} max={2} step={0.05} onChange={(v) => setInh({ ...inh, reach: v })} />
            <Dial label="breath" value={inh.dur} min={1.5} max={7} step={0.1} fmt={s} onChange={(v) => setInh({ ...inh, dur: v })} />
            <Dial label="swell" value={inh.scale} min={1} max={1.12} step={0.005} fmt={(v) => v.toFixed(3)} onChange={(v) => setInh({ ...inh, scale: v })} />
            <Dial label="trough" value={inh.dim} min={0.3} max={1} step={0.02} onChange={(v) => setInh({ ...inh, dim: v })} />
          </Bench>
          <Bench v={aurZone} on={on} onReset={() => setAur(AURORA_DEFAULTS)}>
            <Dial label="pigment" value={aur.mult} min={0.2} max={2} step={0.05} onChange={(v) => setAur({ ...aur, mult: v })} />
            {/* rotation is always on; this only sets how long one turn takes */}
            <Dial label="speed" value={aur.dur} min={6} max={60} step={1} fmt={(v) => `${v.toFixed(0)}s/turn`} onChange={(v) => setAur({ ...aur, dur: v })} />
            <Dial label="blur" value={aur.blur} min={8} max={48} step={2} fmt={int} onChange={(v) => setAur({ ...aur, blur: v })} />
            <Dial label="inner" value={aur.inner} min={25} max={70} step={1} fmt={int} onChange={(v) => setAur({ ...aur, inner: v })} />
            <p className="voice-data text-[0.6rem] lowercase text-ink-faint">inner: where the clear middle ends — lower reaches further in</p>
          </Bench>
          <Bench v={curZone} on={on} onReset={() => setCur(CURTAINS_DEFAULTS)}>
            <Dial label="pigment" value={cur.mult} min={0.2} max={2} step={0.05} onChange={(v) => setCur({ ...cur, mult: v })} />
            <Dial label="period a" value={cur.durA} min={4} max={40} step={0.5} fmt={s} onChange={(v) => setCur({ ...cur, durA: v })} />
            <Dial label="period b" value={cur.durB} min={4} max={45} step={0.5} fmt={s} onChange={(v) => setCur({ ...cur, durB: v })} />
            <Dial label="drift" value={cur.drift} min={0} max={18} step={0.5} fmt={pct} onChange={(v) => setCur({ ...cur, drift: v })} />
            <Dial label="spread" value={cur.spread} min={0.6} max={1.6} step={0.05} onChange={(v) => setCur({ ...cur, spread: v })} />
            <Dial label="inner" value={cur.inner} min={25} max={70} step={1} fmt={int} onChange={(v) => setCur({ ...cur, inner: v })} />
          </Bench>
          <Bench v={borZone} on={on} onReset={() => setBor(BOREALIS_DEFAULTS)}>
            <Dial label="pigment" value={bor.intensity} min={0.1} max={1.2} step={0.05} onChange={(v) => setBor({ ...bor, intensity: v })} />
            <Dial label="rays" value={bor.rays} min={2} max={12} step={0.5} fmt={(v) => v.toFixed(1)} onChange={(v) => setBor({ ...bor, rays: v })} />
            <Dial label="sway" value={bor.sway} min={0} max={0.8} step={0.02} onChange={(v) => setBor({ ...bor, sway: v })} />
            <Dial label="pace" value={bor.pace} min={0.1} max={2} step={0.05} onChange={(v) => setBor({ ...bor, pace: v })} />
            <Dial label="flicker" value={bor.flicker} min={0} max={0.8} step={0.05} onChange={(v) => setBor({ ...bor, flicker: v })} />
            <Dial label="reach" value={bor.reach} min={0.15} max={1} step={0.05} onChange={(v) => setBor({ ...bor, reach: v })} />
            <p className="voice-data text-[0.6rem] lowercase text-ink-faint">webgl, radial — curtains hang inward from the whole border; stretch the combo zone to watch it refit</p>
          </Bench>
          <Bench v={pulZone} on={on} onReset={() => setPul(PULSE_DEFAULTS)}>
            <Dial label="thickness" value={pul.thickness} min={0.05} max={1} step={0.05} onChange={(v) => setPul({ ...pul, thickness: v })} />
            <Dial label="softness" value={pul.softness} min={0} max={1} step={0.05} onChange={(v) => setPul({ ...pul, softness: v })} />
            <Dial label="glow" value={pul.glow} min={0} max={0.6} step={0.02} onChange={(v) => setPul({ ...pul, glow: v })} />
            <Dial label="bloom" value={pul.bloom} min={0} max={1} step={0.05} onChange={(v) => setPul({ ...pul, bloom: v })} />
            <Dial label="spots" value={pul.spots} min={1} max={7} step={1} fmt={int} onChange={(v) => setPul({ ...pul, spots: v })} />
            <Dial label="spot size" value={pul.spotSize} min={0.1} max={1} step={0.05} onChange={(v) => setPul({ ...pul, spotSize: v })} />
            <Dial label="pulse" value={pul.pulse} min={0} max={1} step={0.05} onChange={(v) => setPul({ ...pul, pulse: v })} />
            <Dial label="smoke" value={pul.smoke} min={0} max={1} step={0.02} onChange={(v) => setPul({ ...pul, smoke: v })} />
            <Dial label="smoke size" value={pul.smokeSize} min={0} max={1} step={0.05} onChange={(v) => setPul({ ...pul, smokeSize: v })} />
            <Dial label="pace" value={pul.pace} min={0.02} max={1} step={0.02} onChange={(v) => setPul({ ...pul, pace: v })} />
            <p className="voice-data text-[0.6rem] lowercase text-ink-faint">paper shaders’ border gradient, vendored — their northern-lights recipe in wash ink</p>
          </Bench>
        </div>
      </section>
      <section className="mb-12">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">round one</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          the first field, kept for reference — the finalists live on the desk above
        </p>
        <div className="flex flex-wrap gap-8">
          {ROUND_ONE.map((v) => (
            <MockZone key={v.key} v={v} on={on} />
          ))}
        </div>
      </section>
      <section className="mb-12">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">round three — dancing light</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          what gradients can’t do: borealis and pulsing border are real noise on webgl; rays is the best gradients-only impression
        </p>
        <div className="flex flex-wrap gap-8">
          {ROUND_THREE.map((v) => (
            <MockZone key={v.key} v={v} on={on} onPick={pick} />
          ))}
        </div>
      </section>
      </div>
      {/* paper ↔ lamplight without leaving the lab */}
      <button
        type="button"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="voice-label pressable float fixed bottom-5 right-5 z-10 rounded-full px-4 py-2 text-[0.72rem] text-ink-soft"
      >
        {resolvedTheme ? (resolvedTheme === "dark" ? "paper" : "lamplight") : "…"}
      </button>
    </main>
  );
}
