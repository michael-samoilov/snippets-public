"use client";

/* TEMPORARY dev harness for iterating and comparing the wax-stamp press.
   Not linked anywhere; removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

const ICONS = ["S", "quill", "mic", "calendar", "check", "spark", "eye"];
const EASES = ["even", "front", "snap"] as const;
const EXITS = ["fade", "rise", "shrink", "grow"] as const;
// candidate stamp colours to preview (the app ships ONE semantic wax blue; these
// are an exploration for the categorisation moonshot, sandboxed to the lab).
const TINTS: { name: string; tint?: Tint }[] = [
  { name: "navy" }, // theme default (--wax token)
  { name: "red", tint: { wax: "#a23a32", bright: "#cc5e4f", shadow: "#380c08" } },
  { name: "amber", tint: { wax: "#9a6a2e", bright: "#c4923f", shadow: "#34200a" } },
  { name: "terracotta", tint: { wax: "#9c4f38", bright: "#c47356", shadow: "#371307" } },
  { name: "plum", tint: { wax: "#6a3a6e", bright: "#8f5a93", shadow: "#27122b" } },
  { name: "teal", tint: { wax: "#2e6a5e", bright: "#3f9385", shadow: "#0a3029" } },
  { name: "slate", tint: { wax: "#46506a", bright: "#67728f", shadow: "#171b27" } },
];
// bump this string every push so it's obvious on-screen which build is live
const BUILD = "build 14 · 2026-06-17 · sharp label, continuous press→release";

export default function StampLab() {
  const [playKey, setPlayKey] = useState(1);
  const [size, setSize] = useState(160);
  const [icon, setIcon] = useState("S");
  const [ease, setEase] = useState<(typeof EASES)[number]>("front");
  const [bounce, setBounce] = useState(1);
  const [rotate, setRotate] = useState(30);
  const [autoplay, setAutoplay] = useState(false);
  const [linger, setLinger] = useState(1200);
  const [exitMs, setExitMs] = useState(450);
  const [exit, setExit] = useState<(typeof EXITS)[number]>("fade");
  const [tintName, setTintName] = useState("navy");
  const [pressed, setPressed] = useState(false);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const replay = () => setPlayKey((n) => n + 1);
  const tint = TINTS.find((t) => t.name === tintName)?.tint;

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${
      active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="voice-label">wax-stamp lab</h1>
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
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="voice-label text-ink-faint">ease</span>
        {EASES.map((e) => (
          <button key={e} type="button" onClick={() => setEase(e)} className={chip(ease === e)}>
            {e}
          </button>
        ))}
        <span className="voice-label ml-3 text-ink-faint">exit</span>
        {EXITS.map((x) => (
          <button key={x} type="button" onClick={() => setExit(x)} className={chip(exit === x)}>
            {x}
          </button>
        ))}
        <button type="button" onClick={() => setAutoplay((v) => !v)} className={chip(autoplay)}>
          autoplay {autoplay ? "on" : "off"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="voice-label text-ink-faint">colour</span>
        {TINTS.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => setTintName(t.name)}
            title={t.name}
            className={`size-7 rounded-full border ${tintName === t.name ? "border-ink ring-2 ring-wax" : "border-rule-faint"}`}
            style={{ background: t.tint?.wax ?? "var(--wax)" }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">size {size}</span>
          <input type="range" min={48} max={260} step={4} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">bounce {bounce.toFixed(1)}×</span>
          <input type="range" min={0} max={2.6} step={0.1} value={bounce} onChange={(e) => setBounce(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">rotate {rotate}°</span>
          <input type="range" min={0} max={60} step={5} value={rotate} onChange={(e) => setRotate(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">linger {linger}ms</span>
          <input type="range" min={0} max={3000} step={100} value={linger} onChange={(e) => setLinger(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">exit {exitMs}ms</span>
          <input type="range" min={120} max={1200} step={30} value={exitMs} onChange={(e) => setExitMs(+e.target.value)} />
        </label>
        <button type="button" data-replay onClick={replay} className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper">
          Replay
        </button>
        <span className="voice-data">play #{playKey}</span>
      </div>

      <button
        type="button"
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => { setPressed(false); replay(); }}
        onPointerLeave={() => setPressed(false)}
        title="press and release to stamp"
        className="mt-2 grid cursor-pointer touch-none select-none place-items-center rounded-[12px] border border-rule-faint bg-paper py-16"
      >
        <WaxStamp
          key={`${theme}-${tintName}`}
          playKey={playKey}
          size={size}
          glyph={icon}
          variant="spring"
          ease={ease}
          bounce={bounce}
          rotate={rotate}
          mode={autoplay ? "loop" : "tap"}
          lingerMs={linger}
          exitMs={exitMs}
          exit={exit}
          tint={tint}
          pressed={pressed}
        />
      </button>
    </div>
  );
}
