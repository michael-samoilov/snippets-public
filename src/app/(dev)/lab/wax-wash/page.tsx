"use client";

/* Dev lab for the recording "wax wash" — the blue wash that seeps inward
   from the today zone's border while the microphone is on. Each card is
   one treatment on a mock zone; the toggle plays enter/exit, auto cycles
   it. The static winner (four edges · breathing) shipped to
   TodayZoneFill; the animated rounds live here until one is chosen.
   Theme: localStorage.setItem('theme','dark') + reload, as everywhere. */

import { useEffect, useState } from "react";

/* the wash ink: oklab keeps the blue alive at low alpha (srgb dulls it).
   Paper mixes from --wax (pigment into paper); Lamplight from --wax-bright
   (light out of the dark) — see the <style> block for the .dark override. */
const WASH = (pct: number) => `color-mix(in oklab, var(--wash-src) ${pct * 2}%, transparent)`;

const FOUR_EDGE = [
  `linear-gradient(to bottom, ${WASH(13)}, transparent 18%)`,
  `linear-gradient(to top, ${WASH(13)}, transparent 18%)`,
  `linear-gradient(to right, ${WASH(9)}, transparent 22%)`,
  `linear-gradient(to left, ${WASH(9)}, transparent 22%)`,
].join(", ");

/* keeps light near the frame, clears the writing in the middle */
const EDGE_MASK =
  "radial-gradient(85% 85% at 50% 50%, transparent 52%, black 95%)";

interface Layer {
  className?: string;
  style: React.CSSProperties;
}

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
}

const VARIANTS: Variant[] = [
  {
    key: "shipped",
    label: "four edges · breathing (shipped)",
    note: "the current production wash, for reference",
    wash: { background: FOUR_EDGE },
    washClass: "wash-breathe",
  },
  {
    key: "inhale",
    label: "inhale",
    note: "the seep's reach swells and settles, like a chest",
    wash: { background: FOUR_EDGE },
    washClass: "wash-inhale",
  },
  {
    key: "aurora",
    label: "aurora",
    note: "wax hues turning very slowly behind the frame",
    mask: EDGE_MASK,
    layers: [
      {
        className: "wash-spin",
        style: {
          position: "absolute",
          left: "-35%",
          top: "-35%",
          width: "170%",
          aspectRatio: "1",
          filter: "blur(26px)",
          background: `conic-gradient(from 0deg, ${WASH(19)}, ${WASH(7)}, ${WASH(24)}, ${WASH(9)}, ${WASH(17)}, ${WASH(6)}, ${WASH(19)})`,
        },
      },
    ],
  },
  {
    key: "curtains",
    label: "curtains",
    note: "two counter-drifting glows, northern-lights slow",
    mask: EDGE_MASK,
    layers: [
      {
        className: "wash-curtain-a",
        style: {
          position: "absolute",
          inset: "-10%",
          filter: "blur(18px)",
          background: `radial-gradient(50% 38% at 30% 0%, ${WASH(26)}, transparent 74%), radial-gradient(44% 34% at 78% 100%, ${WASH(19)}, transparent 72%)`,
        },
      },
      {
        className: "wash-curtain-b",
        style: {
          position: "absolute",
          inset: "-10%",
          filter: "blur(22px)",
          background: `radial-gradient(42% 34% at 72% 0%, ${WASH(17)}, transparent 72%), radial-gradient(50% 36% at 22% 100%, ${WASH(22)}, transparent 74%)`,
        },
      },
    ],
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

function MockZone({ v, on }: { v: Variant; on: boolean }) {
  return (
    <figure className="m-0">
      <div className="relative h-[430px] w-[300px] rounded-2xl border border-wax/45">
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

export default function WaxWashLab() {
  const [on, setOn] = useState(true);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setOn((v) => !v), 1600);
    return () => clearInterval(t);
  }, [auto]);

  return (
    <main className="fixed inset-0 z-50 overflow-auto bg-[var(--desk)] p-8" data-wash-lab>
      <style>{`
        [data-wash-lab] { --wash-src: var(--wax); }
        .dark [data-wash-lab] { --wash-src: var(--wax-bright); }

        @keyframes wash-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
        .wash-breathe { animation: wash-breathe 3.2s var(--ease-in-out) infinite; }

        /* the reach itself breathes — transform only, center-origin */
        @keyframes wash-inhale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.66; }
        }
        .wash-inhale { animation: wash-inhale 3.2s var(--ease-in-out) infinite; }

        /* aurora: a very slow turn; the edge mask keeps it out of the words */
        @keyframes wash-spin { to { transform: rotate(360deg); } }
        .wash-spin { animation: wash-spin 26s linear infinite; }

        /* curtains: counter-phased lateral drift, northern-lights slow */
        @keyframes wash-curtain-a {
          0%, 100% { transform: translateX(-7%) translateY(0); }
          50% { transform: translateX(7%) translateY(2%); }
        }
        .wash-curtain-a { animation: wash-curtain-a 14s var(--ease-in-out) infinite; }
        @keyframes wash-curtain-b {
          0%, 100% { transform: translateX(6%) translateY(1.5%); }
          50% { transform: translateX(-6%) translateY(0); }
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
      <div className="flex flex-wrap gap-8">
        {VARIANTS.map((v) => (
          <MockZone key={v.key} v={v} on={on} />
        ))}
      </div>
    </main>
  );
}
