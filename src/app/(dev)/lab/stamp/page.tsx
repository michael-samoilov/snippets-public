"use client";

/* TEMPORARY dev harness for iterating the wax-stamp press. Not linked
   anywhere; removed before the feature ships. Replays on demand and
   exposes the tuning knobs so the motion can be tuned against the
   reference without rebuilding (set them in the URL, e.g.
   /lab/stamp?dur=0.6&squashX=1.22, or with the sliders). */

import { useState } from "react";
import { WaxStamp, type WaxTuning } from "@/components/capture/wax-stamp";

function readNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = new URLSearchParams(window.location.search).get(key);
  return v != null && v !== "" && !Number.isNaN(+v) ? +v : fallback;
}

const DEFAULTS: WaxTuning = {
  dur: 0.52,
  dropY: 15,
  startScale: 0.4,
  squashX: 1.18,
  squashY: 0.82,
  rotate: 3,
};

const KNOBS: Array<{ key: keyof WaxTuning; min: number; max: number; step: number }> = [
  { key: "dur", min: 0.3, max: 1.0, step: 0.02 },
  { key: "dropY", min: 0, max: 40, step: 1 },
  { key: "startScale", min: 0.1, max: 0.9, step: 0.05 },
  { key: "squashX", min: 1.0, max: 1.4, step: 0.01 },
  { key: "squashY", min: 0.6, max: 1.0, step: 0.01 },
  { key: "rotate", min: 0, max: 12, step: 0.5 },
];

export default function StampLab() {
  const [playKey, setPlayKey] = useState(1);
  const [size, setSize] = useState(() => readNum("size", 160));
  const [tuning, setTuning] = useState<WaxTuning>(() => {
    const next = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as Array<keyof WaxTuning>) {
      next[k] = readNum(k, DEFAULTS[k]);
    }
    return next;
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="voice-label">wax-stamp lab</h1>

      <div className="grid place-items-center rounded-[10px] border border-rule-faint bg-paper py-16">
        <WaxStamp playKey={playKey} size={size} tuning={tuning} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-replay
          onClick={() => setPlayKey((n) => n + 1)}
          className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper"
        >
          Replay
        </button>
        <span className="voice-data">play #{playKey}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3 text-[0.85rem]">
          <span className="voice-data w-24">size {size}</span>
          <input
            type="range"
            min={48}
            max={220}
            step={4}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
            className="flex-1"
          />
        </label>
        {KNOBS.map(({ key, min, max, step }) => (
          <label key={key} className="flex items-center gap-3 text-[0.85rem]">
            <span className="voice-data w-24">
              {key} {tuning[key]}
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={tuning[key]}
              onChange={(e) =>
                setTuning((t) => ({ ...t, [key]: +e.target.value }))
              }
              className="flex-1"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
