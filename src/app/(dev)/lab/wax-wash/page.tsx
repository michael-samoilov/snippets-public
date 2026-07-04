"use client";

/* Dev lab for the recording "wax wash" — the blue radial wash that seeps
   inward from the today zone's border while the microphone is on. Each
   card is one treatment on a mock zone; the toggle plays enter/exit.
   Iterate here, then wire the winner into TodayZoneFill (calendar page).
   Theme: localStorage.setItem('theme','dark') + reload, as everywhere. */

import { useEffect, useState } from "react";

/* the wash ink: oklab keeps the blue alive at low alpha (srgb dulls it).
   Paper mixes from --wax (pigment into paper); Lamplight from --wax-bright
   (light out of the dark) — see the <style> block for the .dark override. */
const WASH = (pct: number) => `color-mix(in oklab, var(--wash-src) ${pct * 2}%, transparent)`;

interface Variant {
  key: string;
  label: string;
  note: string;
  /** overlay style while listening (the wash layer itself) */
  wash: React.CSSProperties;
  /** extra class on the wash layer (for keyframe treatments) */
  washClass?: string;
  /** how the wash meets the paper (default: multiply, like ink) */
  blend?: React.CSSProperties["mixBlendMode"];
}

const VARIANTS: Variant[] = [
  {
    key: "vignette",
    label: "vignette",
    note: "one radial, strongest in the corners",
    wash: {
      background: `radial-gradient(72% 72% at 50% 50%, transparent 52%, ${WASH(16)} 100%)`,
    },
  },
  {
    key: "four-edge",
    label: "four edges",
    note: "even seep from every border of the tall box",
    wash: {
      background: [
        `linear-gradient(to bottom, ${WASH(13)}, transparent 18%)`,
        `linear-gradient(to top, ${WASH(13)}, transparent 18%)`,
        `linear-gradient(to right, ${WASH(11)}, transparent 22%)`,
        `linear-gradient(to left, ${WASH(11)}, transparent 22%)`,
      ].join(", "),
    },
  },
  {
    key: "breath",
    label: "four edges · breathing",
    note: "same seep, alive on the seal-breathe cadence",
    wash: {
      background: [
        `linear-gradient(to bottom, ${WASH(13)}, transparent 18%)`,
        `linear-gradient(to top, ${WASH(13)}, transparent 18%)`,
        `linear-gradient(to right, ${WASH(11)}, transparent 22%)`,
        `linear-gradient(to left, ${WASH(11)}, transparent 22%)`,
      ].join(", "),
    },
    washClass: "wash-breathe",
  },
  {
    key: "inkline",
    label: "ink line + bloom",
    note: "the border itself deepens, with a shallow bloom",
    wash: {
      boxShadow: `inset 0 0 0 1px ${WASH(55)}, inset 0 0 34px 4px ${WASH(10)}`,
    },
  },
  {
    key: "tide",
    label: "tide",
    note: "the vignette's reach slowly swells and recedes",
    wash: {
      background: `radial-gradient(78% 78% at 50% 50%, transparent 46%, ${WASH(17)} 100%)`,
    },
    washClass: "wash-tide",
  },
  {
    key: "watercolor",
    label: "watercolor",
    note: "broad seep + pigment pooling against the lip",
    wash: {
      background: [
        `linear-gradient(to bottom, ${WASH(11)}, transparent 4%)`,
        `linear-gradient(to top, ${WASH(11)}, transparent 4%)`,
        `linear-gradient(to right, ${WASH(10)}, transparent 5%)`,
        `linear-gradient(to left, ${WASH(10)}, transparent 5%)`,
        `linear-gradient(to bottom, ${WASH(8)}, transparent 20%)`,
        `linear-gradient(to top, ${WASH(8)}, transparent 20%)`,
        `linear-gradient(to right, ${WASH(7)}, transparent 24%)`,
        `linear-gradient(to left, ${WASH(7)}, transparent 24%)`,
      ].join(", "),
    },
  },
  {
    key: "lamplit",
    label: "lamplit",
    note: "heavier at the top edge — the desk's light carries the wax",
    wash: {
      background: [
        `linear-gradient(to bottom, ${WASH(17)}, transparent 26%)`,
        `linear-gradient(to top, ${WASH(9)}, transparent 14%)`,
        `linear-gradient(to right, ${WASH(11)}, transparent 20%)`,
        `linear-gradient(to left, ${WASH(11)}, transparent 20%)`,
      ].join(", "),
    },
  },
];

function MockZone({ v, on }: { v: Variant; on: boolean }) {
  return (
    <figure className="m-0">
      <div className="relative h-[430px] w-[300px] rounded-2xl border border-wax/45">
        {/* the wash — born from the frame, fading inward */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-[240ms] ease-[var(--ease-out)] ${v.washClass ?? ""}`}
          style={{ mixBlendMode: v.blend ?? "normal", ...v.wash, opacity: on ? 1 : 0 }}
        />
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
        @keyframes wash-tide {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.72; }
        }
        .wash-tide { animation: wash-tide 3.6s var(--ease-in-out) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .wash-breathe, .wash-tide { animation: none; }
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
