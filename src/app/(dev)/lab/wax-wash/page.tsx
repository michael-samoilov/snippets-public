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

/* the wash ink: oklab keeps the blue alive at low alpha (srgb dulls it).
   Paper mixes from --wax (pigment into paper); Lamplight from --wax-bright
   (light out of the dark) — see the <style> block for the .dark override. */
const WASH = (pct: number) => `color-mix(in oklab, var(--wash-src) ${pct * 2}%, transparent)`;

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

/* keeps light near the frame, clears the writing in the middle;
   `inner` is where the clear middle ends — lower reaches further in */
const edgeMask = (inner = 52) =>
  `radial-gradient(85% 85% at 50% 50%, transparent ${inner}%, black 95%)`;

interface Layer {
  className?: string;
  style: React.CSSProperties;
}

type FamilyKey = "inhale" | "aurora" | "curtains";

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

const conic = (m: number) =>
  `conic-gradient(from 0deg, ${WASH(19 * m)}, ${WASH(7 * m)}, ${WASH(24 * m)}, ${WASH(9 * m)}, ${WASH(17 * m)}, ${WASH(6 * m)}, ${WASH(19 * m)})`;

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
        className: "wash-spin",
        style: {
          position: "absolute",
          left: "-35%",
          top: "-35%",
          width: "170%",
          aspectRatio: "1",
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

/* ---- round two: the finalists, swept ----------------------------------- */

interface Family {
  title: string;
  note: string;
  variants: Variant[];
}

const FAMILIES: Family[] = [
  {
    title: "inhale",
    note: "the seep's reach swells and settles, like a chest",
    variants: [
      inhale("inhale-base", "base", "as round one left it"),
      inhale("inhale-whisper", "whisper", "less pigment in the water", { mult: 0.6 }),
      inhale("inhale-deep", "deep", "more pigment, dimmer trough", { mult: 1.5, dim: 0.55 }),
      inhale("inhale-quick", "quick", "a runner's breath", { dur: 2 }),
      inhale("inhale-slow", "slow", "sleeping breath", { dur: 5.4 }),
      inhale("inhale-shallow", "shallow", "the seep stays by the frame", {
        reach: 0.66,
        scale: 1.03,
      }),
      inhale("inhale-far", "far", "reaches toward the words", { reach: 1.6, scale: 1.08 }),
    ],
  },
  {
    title: "aurora",
    note: "wax hues turning very slowly behind the frame",
    variants: [
      aurora("aurora-base", "base", "as round one left it"),
      aurora("aurora-faint", "faint", "less pigment in the turn", { mult: 0.6 }),
      aurora("aurora-vivid", "vivid", "more pigment in the turn", { mult: 1.5 }),
      aurora("aurora-brisk", "brisk", "a noticeable turn", { dur: 13 }),
      aurora("aurora-glacial", "glacial", "almost too slow to catch", { dur: 48 }),
      aurora("aurora-rim", "rim", "confined to the very edge", { inner: 66 }),
      aurora("aurora-flood", "flood", "glow reaches toward the middle", { inner: 34, blur: 34 }),
    ],
  },
  {
    title: "curtains",
    note: "two counter-drifting glows, northern-lights slow",
    variants: [
      curtains("curtains-base", "base", "as round one left it"),
      curtains("curtains-whisper", "whisper", "less pigment in the folds", { mult: 0.6 }),
      curtains("curtains-vivid", "vivid", "more pigment in the folds", { mult: 1.5 }),
      curtains("curtains-quick", "quick", "a draught through the room", { durA: 8, durB: 11 }),
      curtains("curtains-slow", "slow", "barely disturbed air", { durA: 26, durB: 35 }),
      curtains("curtains-still", "still", "narrow travel, tall folds", { drift: 3 }),
      curtains("curtains-sweeping", "sweeping", "wide travel, broad folds", {
        drift: 14,
        spread: 1.25,
      }),
      curtains("curtains-flood", "flood", "folds allowed past the frame", { inner: 36 }),
    ],
  },
];

function MockZone({
  v,
  on,
  onPick,
}: {
  v: Variant;
  on: boolean;
  /** when set, tapping the card loads its recipe onto the desk */
  onPick?: (v: Variant) => void;
}) {
  return (
    <figure className="m-0">
      <div
        className={`relative h-[430px] w-[300px] rounded-2xl border border-wax/45 ${onPick ? "cursor-pointer" : ""}`}
        onClick={onPick ? () => onPick(v) : undefined}
        title={onPick ? "load onto the desk" : undefined}
      >
        {/* the wash container — clipped to the frame, masked to its edges */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-[240ms] ease-[var(--ease-out)]"
          style={{
            opacity: on ? 1 : 0,
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
        </div>
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
      </div>
      <figcaption className="voice-label mt-2 text-center text-[0.72rem] text-ink-soft">
        {v.label}
        <span className="voice-data block text-[0.62rem] lowercase text-ink-faint">{v.note}</span>
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
  children,
}: {
  v: Variant;
  on: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <MockZone v={v} on={on} />
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
  const deskRef = useRef<HTMLElement>(null);

  /* tapping a sweep card sends its recipe to the matching bench */
  const pick = (v: Variant) => {
    if (v.family === "inhale") setInh({ ...INHALE_DEFAULTS, ...(v.opts as Partial<InhaleOpts>) });
    if (v.family === "aurora") setAur({ ...AURORA_DEFAULTS, ...(v.opts as Partial<AuroraOpts>) });
    if (v.family === "curtains") setCur({ ...CURTAINS_DEFAULTS, ...(v.opts as Partial<CurtainsOpts>) });
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

        @media (prefers-reduced-motion: reduce) {
          .wash-breathe, .wash-inhale, .wash-spin,
          .wash-curtain-a, .wash-curtain-b, .wash-ripple {
            animation: none;
          }
          .wash-ripple { opacity: 0; }
        }
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
            <Dial label="turn" value={aur.dur} min={6} max={60} step={1} fmt={s} onChange={(v) => setAur({ ...aur, dur: v })} />
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
        </div>
      </section>
      <section className="mb-12">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">round one</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          the field before the sweep — finalists repeated below as “base”
        </p>
        <div className="flex flex-wrap gap-8">
          {ROUND_ONE.map((v) => (
            <MockZone key={v.key} v={v} on={on} />
          ))}
        </div>
      </section>
      {FAMILIES.map((f) => (
        <section key={f.title} className="mb-12">
          <h2 className="voice-label text-[0.78rem] text-ink-soft">{f.title}</h2>
          <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">{f.note}</p>
          <div className="flex flex-wrap gap-8">
            {f.variants.map((v) => (
              <MockZone key={v.key} v={v} on={on} onPick={pick} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
