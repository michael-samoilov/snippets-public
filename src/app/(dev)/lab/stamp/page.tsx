"use client";

/* TEMPORARY dev harness for iterating and comparing the wax-stamp press.
   Not linked anywhere; removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp } from "@/components/capture/wax-stamp";

const ICONS = ["S", "quill", "mic", "calendar", "check"];
const VARIANTS = ["pop", "spring"] as const;
const EASES = ["even", "front", "snap"] as const;
// bump this string every push so it's obvious on-screen which build is live
const BUILD = "build 7 · 2026-06-17 · deep relief + bouncy spring (default)";

export default function StampLab() {
  const [playKey, setPlayKey] = useState(1);
  const [size, setSize] = useState(180);
  const [icon, setIcon] = useState("S");
  const [ease, setEase] = useState<(typeof EASES)[number]>("front");
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${
      active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"
    }`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="voice-label">wax-stamp lab — compare</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">
        {BUILD}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((ic) => (
            <button key={ic} type="button" onClick={() => setIcon(ic)} className={chip(icon === ic)}>
              {ic}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className={chip(false)}>
          {dark ? "Lamplight" : "Paper"}
        </button>
        <div className="flex flex-wrap gap-1.5">
          {EASES.map((e) => (
            <button key={e} type="button" onClick={() => setEase(e)} className={chip(ease === e)}>
              {e}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-20">size {size}</span>
          <input type="range" min={48} max={260} step={4} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <button
          type="button"
          data-replay
          onClick={() => setPlayKey((n) => n + 1)}
          className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper"
        >
          Replay both
        </button>
        <span className="voice-data">play #{playKey}</span>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {VARIANTS.map((v) => (
          <div key={v} className="grid place-items-center gap-3 rounded-[10px] border border-rule-faint bg-paper py-14">
            <WaxStamp playKey={playKey} size={size} glyph={icon} variant={v} ease={ease} />
            <span className="voice-label">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
