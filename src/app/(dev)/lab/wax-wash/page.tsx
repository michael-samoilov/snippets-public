"use client";

/* Dev lab for the recording "wax wash" — the blue wash that seeps inward
   from the today zone's border while the microphone is on. Round 3:
   parameter sweeps. Each family (inhale · aurora · curtains) gets three
   rows, one axis per row — intensity, speed, extent — with the family
   default in the middle of every row for side-by-side judgment.
   The toggle plays enter/exit, auto cycles it. The static winner
   (four edges · breathing) shipped to TodayZoneFill; rounds live here.
   Theme: localStorage.setItem('theme','dark') + reload, as everywhere. */

import { useEffect, useState } from "react";

/* the wash ink: oklab keeps the blue alive at low alpha (srgb dulls it).
   Paper mixes from --wax (pigment into paper); Lamplight from --wax-bright
   (light out of the dark) — see the <style> block for the .dark override. */
const WASH = (pct: number) =>
  `color-mix(in oklab, var(--wash-src) ${Math.min(100, Math.round(pct * 2 * 10) / 10)}%, transparent)`;

/* i = intensity multiplier, r = reach multiplier */
const fourEdge = (i = 1, r = 1) =>
  [
    `linear-gradient(to bottom, ${WASH(13 * i)}, transparent ${18 * r}%)`,
    `linear-gradient(to top, ${WASH(13 * i)}, transparent ${18 * r}%)`,
    `linear-gradient(to right, ${WASH(9 * i)}, transparent ${22 * r}%)`,
    `linear-gradient(to left, ${WASH(9 * i)}, transparent ${22 * r}%)`,
  ].join(", ");

/* keeps light near the frame; hole = how much of the middle stays clear */
const edgeMask = (hole = 52) =>
  `radial-gradient(85% 85% at 50% 50%, transparent ${hole}%, black 95%)`;

interface Layer {
  className?: string;
  style: React.CSSProperties;
}
interface Card {
  key: string;
  label: string;
  note?: string;
  wash?: React.CSSProperties;
  washClass?: string;
  washStyle?: React.CSSProperties;
  layers?: Layer[];
  mask?: string;
}
interface Row {
  axis: string;
  cards: Card[];
}
interface Family {
  title: string;
  note: string;
  rows: Row[];
}

/* ── inhale: the seep's reach swells and settles ────────────────── */
const inhale = (
  key: string,
  label: string,
  { i = 1, dur = 3.2, amp = 1.05, r = 1 } = {},
): Card => ({
  key,
  label,
  wash: { background: fourEdge(i, r) },
  washClass: "wash-inhale",
  washStyle: {
    animationDuration: `${dur}s`,
    ["--inhale-amp" as string]: String(amp),
  },
});

/* ── aurora: wax hues turning very slowly behind the frame ──────── */
const aurora = (
  key: string,
  label: string,
  { i = 1, dur = 26, hole = 52, blur = 26 } = {},
): Card => ({
  key,
  label,
  mask: edgeMask(hole),
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
        background: `conic-gradient(from 0deg, ${WASH(19 * i)}, ${WASH(7 * i)}, ${WASH(24 * i)}, ${WASH(9 * i)}, ${WASH(17 * i)}, ${WASH(6 * i)}, ${WASH(19 * i)})`,
      },
    },
  ],
});

/* ── curtains: two counter-drifting glows, northern-lights slow ─── */
const curtains = (
  key: string,
  label: string,
  { i = 1, spd = 1, sz = 1 } = {},
): Card => ({
  key,
  label,
  mask: edgeMask(48),
  layers: [
    {
      className: "wash-curtain-a",
      style: {
        position: "absolute",
        inset: "-10%",
        filter: "blur(18px)",
        animationDuration: `${14 * spd}s`,
        background: `radial-gradient(${50 * sz}% ${38 * sz}% at 30% 0%, ${WASH(26 * i)}, transparent 74%), radial-gradient(${44 * sz}% ${34 * sz}% at 78% 100%, ${WASH(19 * i)}, transparent 72%)`,
      },
    },
    {
      className: "wash-curtain-b",
      style: {
        position: "absolute",
        inset: "-10%",
        filter: "blur(22px)",
        animationDuration: `${19 * spd}s`,
        background: `radial-gradient(${42 * sz}% ${34 * sz}% at 72% 0%, ${WASH(17 * i)}, transparent 72%), radial-gradient(${50 * sz}% ${36 * sz}% at 22% 100%, ${WASH(22 * i)}, transparent 74%)`,
      },
    },
  ],
});

const FAMILIES: Family[] = [
  {
    title: "inhale",
    note: "the seep's reach swells and settles, like a chest",
    rows: [
      {
        axis: "intensity",
        cards: [
          inhale("in-i-soft", "soft ·55%", { i: 0.55 }),
          inhale("in-i-def", "default"),
          inhale("in-i-bold", "bold ·160%", { i: 1.6 }),
        ],
      },
      {
        axis: "speed",
        cards: [
          inhale("in-s-brisk", "brisk ·1.8s", { dur: 1.8 }),
          inhale("in-s-def", "default ·3.2s"),
          inhale("in-s-glacial", "glacial ·6.5s", { dur: 6.5 }),
        ],
      },
      {
        axis: "extent",
        cards: [
          inhale("in-e-near", "near ·amp 1.02 reach 70%", { amp: 1.02, r: 0.7 }),
          inhale("in-e-def", "default ·amp 1.05"),
          inhale("in-e-deep", "deep ·amp 1.1 reach 150%", { amp: 1.1, r: 1.5 }),
        ],
      },
    ],
  },
  {
    title: "aurora",
    note: "wax hues turning very slowly behind the frame",
    rows: [
      {
        axis: "intensity",
        cards: [
          aurora("au-i-soft", "soft ·55%", { i: 0.55 }),
          aurora("au-i-def", "default"),
          aurora("au-i-bold", "bold ·160%", { i: 1.6 }),
        ],
      },
      {
        axis: "speed",
        cards: [
          aurora("au-s-brisk", "brisk ·12s", { dur: 12 }),
          aurora("au-s-def", "default ·26s"),
          aurora("au-s-glacial", "glacial ·48s", { dur: 48 }),
        ],
      },
      {
        axis: "extent",
        cards: [
          aurora("au-e-near", "near ·hole 64, blur 18", { hole: 64, blur: 18 }),
          aurora("au-e-def", "default ·hole 52"),
          aurora("au-e-deep", "deep ·hole 38, blur 34", { hole: 38, blur: 34 }),
        ],
      },
    ],
  },
  {
    title: "curtains",
    note: "two counter-drifting glows, northern-lights slow",
    rows: [
      {
        axis: "intensity",
        cards: [
          curtains("cu-i-soft", "soft ·55%", { i: 0.55 }),
          curtains("cu-i-def", "default"),
          curtains("cu-i-bold", "bold ·160%", { i: 1.6 }),
        ],
      },
      {
        axis: "speed",
        cards: [
          curtains("cu-s-brisk", "brisk ·6s/8s", { spd: 0.42 }),
          curtains("cu-s-def", "default ·14s/19s"),
          curtains("cu-s-glacial", "glacial ·28s/38s", { spd: 2 }),
        ],
      },
      {
        axis: "extent",
        cards: [
          curtains("cu-e-near", "near ·70% glows", { sz: 0.7 }),
          curtains("cu-e-def", "default"),
          curtains("cu-e-deep", "deep ·140% glows", { sz: 1.4 }),
        ],
      },
    ],
  },
];

/* the earlier rounds, kept for reference */
const KEEPERS: Card[] = [
  {
    key: "shipped",
    label: "four edges · breathing (shipped)",
    note: "the current production wash",
    wash: { background: fourEdge() },
    washClass: "wash-breathe",
  },
  {
    key: "ripple",
    label: "sonar",
    note: "a ring collapsing inward on the listening cadence",
    wash: { background: fourEdge(), opacity: 0.5 },
    layers: [
      {
        className: "wash-ripple",
        style: { position: "absolute", inset: 2, borderRadius: 14, border: `1px solid ${WASH(34)}` },
      },
      {
        className: "wash-ripple wash-ripple-late",
        style: { position: "absolute", inset: 2, borderRadius: 14, border: `1px solid ${WASH(34)}` },
      },
    ],
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
        fourEdge(),
      ].join(", "),
    },
  },
];

function MockZone({ v, on }: { v: Card; on: boolean }) {
  return (
    <figure className="m-0">
      <div className="relative h-[340px] w-[240px] rounded-2xl border border-wax/45">
        {/* the wash container — clipped to the frame, masked to its edges */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-[240ms] ease-[var(--ease-out)]"
          style={{
            opacity: on ? 1 : 0,
            ...(v.mask ? { maskImage: v.mask, WebkitMaskImage: v.mask } : null),
          }}
        >
          {v.wash && (
            <div
              className={`absolute inset-0 ${v.washClass ?? ""}`}
              style={{ ...v.wash, ...v.washStyle }}
            />
          )}
          {v.layers?.map((l, i) => (
            <div key={i} className={l.className} style={l.style} />
          ))}
        </div>
        <div className="flex h-full flex-col items-center gap-3 px-4 py-5 text-center">
          <div className="mt-6 leading-none">
            <p className="voice-label text-[0.66rem] text-ink-faint">Friday</p>
            <h2 className="voice-display mt-1 text-[1.3rem] leading-none text-ink">July 3</h2>
          </div>
          <div className="flex-1" />
          <div
            className="w-[calc(100%-24px)]"
            style={{
              height: 40,
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--rule-faint) 19px, var(--rule-faint) 20px)",
            }}
          />
          <div className="flex-1" />
          {/* stand-in dome */}
          <div
            className="mb-4 size-[64px] rounded-full"
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
      <figcaption className="voice-label mt-1.5 text-center text-[0.66rem] text-ink-soft">
        {v.label}
        {v.note && (
          <span className="voice-data block text-[0.6rem] lowercase text-ink-faint">{v.note}</span>
        )}
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

        /* the reach itself breathes — transform only, center-origin;
           amplitude rides --inhale-amp so one keyframe serves the sweep */
        @keyframes wash-inhale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(var(--inhale-amp, 1.05)); opacity: 0.66; }
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
        <h1 className="voice-display text-[1.4rem] text-ink">wax wash · sweeps</h1>
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

      {FAMILIES.map((f) => (
        <section key={f.title} className="mb-10">
          <h2 className="voice-display text-[1.1rem] text-ink">{f.title}</h2>
          <p className="voice-data mb-4 text-[0.66rem] lowercase text-ink-faint">{f.note}</p>
          {f.rows.map((row) => (
            <div key={row.axis} className="mb-6">
              <h3 className="voice-label mb-2 text-[0.7rem] text-ink-soft">{row.axis}</h3>
              <div className="flex flex-wrap gap-6">
                {row.cards.map((c) => (
                  <MockZone key={c.key} v={c} on={on} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      <section className="mb-10">
        <h2 className="voice-display text-[1.1rem] text-ink">earlier rounds</h2>
        <p className="voice-data mb-4 text-[0.66rem] lowercase text-ink-faint">
          the shipped wash and the keepers, for reference
        </p>
        <div className="flex flex-wrap gap-6">
          {KEEPERS.map((c) => (
            <MockZone key={c.key} v={c} on={on} />
          ))}
        </div>
      </section>
    </main>
  );
}
