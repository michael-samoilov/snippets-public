"use client";

/* TEMPORARY dev harness for iterating and comparing the wax-stamp press.
   Not linked anywhere; removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

const ICONS = ["S", "quill", "mic", "calendar", "caldots", "check", "spark", "eye", "eye2", "joke", "laugh", "smile"];
const SET_ICONS = ["quill", "mic", "calendar", "check"]; // these vary by icon-set
const ICON_SET_KEYS = ["a", "b", "c", "d", "e"] as const;
const SET_LABEL: Record<string, string> = { a: "a · line", b: "b · solid", c: "c · fine", d: "d · remix", e: "e · zest" };
const EASES = ["even", "front", "snap"] as const;
const EXITS = ["fade", "rise", "shrink", "grow"] as const;
// candidate stamp colours to preview (the app ships ONE semantic wax blue; these
// are an exploration for the categorisation moonshot, sandboxed to the lab). Each
// hue comes in a deep tone (rich, navy-like) and a soft pastel tone.
// metals (gold · bronze=rose · silver) are grouped at the end — they carry the
// metallic speckle; gold leans a touch orange so it doesn't read purely yellow.
const HUES = ["navy", "red", "teal", "plum", "gold", "rose", "silver"] as const;
const METAL_HUES = ["gold", "rose", "silver"]; // get the flake/grain texture
const DEEP: Record<string, Tint | undefined> = {
  navy: undefined, // theme --wax token (already deep navy)
  red: { wax: "#7e2c27", bright: "#a8534a", shadow: "#2a0a07" },
  gold: { wax: "#cd8a16", bright: "#eebe54", shadow: "#3e2606" },
  teal: { wax: "#225247", bright: "#3a8475", shadow: "#082420" },
  plum: { wax: "#4f2c54", bright: "#7a4a80", shadow: "#1e1022" },
  rose: { wax: "#7c3e2c", bright: "#a86048", shadow: "#2a0f08" },
  silver: { wax: "#8a919b", bright: "#edf1f6", shadow: "#363c44" },
};
const PASTEL: Record<string, Tint> = {
  navy: { wax: "#9bb6da", bright: "#bcd0e8", shadow: "#3c587c" },
  red: { wax: "#d99e96", bright: "#e9c2bc", shadow: "#6e3a34" },
  gold: { wax: "#eaca80", bright: "#f5e0b0", shadow: "#6c501e" },
  teal: { wax: "#97c4b6", bright: "#bedfd3", shadow: "#2c5048" },
  plum: { wax: "#b89cc9", bright: "#d2c0de", shadow: "#4e3a58" },
  rose: { wax: "#d6a895", bright: "#e8c8ba", shadow: "#6e4030" },
  silver: { wax: "#c6ccd4", bright: "#eef2f7", shadow: "#565d66" },
};
// bump this string every push so it's obvious on-screen which build is live
const BUILD = "build 28 · 2026-06-18 · glint rework + separate cloud slider";

export default function StampLab() {
  const [playKey, setPlayKey] = useState(1);
  const [size, setSize] = useState(160);
  const [icon, setIcon] = useState("S");
  const [iconSet, setIconSet] = useState<(typeof ICON_SET_KEYS)[number]>("a");
  const [ease, setEase] = useState<(typeof EASES)[number]>("front");
  const [bounce, setBounce] = useState(1.5);
  const [rotate, setRotate] = useState(5);
  const [puck, setPuck] = useState(1);
  const [iconScale, setIconScale] = useState(0.4);
  const [speckle, setSpeckle] = useState(0.6);
  const [cloud, setCloud] = useState(0.6);
  const [autoplay, setAutoplay] = useState(false);
  const [linger, setLinger] = useState(1000);
  const [exitMs, setExitMs] = useState(200);
  const [exit, setExit] = useState<(typeof EXITS)[number]>("grow");
  const [hue, setHue] = useState<(typeof HUES)[number]>("navy");
  const [tone, setTone] = useState<"deep" | "pastel">("deep");
  const [pressed, setPressed] = useState(false);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const replay = () => setPlayKey((n) => n + 1);
  const tint = tone === "deep" ? DEEP[hue] : PASTEL[hue];
  const glyph = SET_ICONS.includes(icon) && iconSet !== "a" ? `${iconSet}:${icon}` : icon;

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

      {/* active exploration */}
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
        <button type="button" onClick={() => setAutoplay((v) => !v)} className={chip(autoplay)}>
          autoplay {autoplay ? "on" : "off"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="voice-label text-ink-faint">icon set</span>
        {ICON_SET_KEYS.map((k) => (
          <button key={k} type="button" onClick={() => setIconSet(k)} className={chip(iconSet === k)}>
            {SET_LABEL[k]}
          </button>
        ))}
        <span className="voice-data text-ink-faint">(quill · mic · calendar · check)</span>
      </div>

      <div className="flex flex-col gap-2">
        {(["deep", "pastel"] as const).map((tn) => (
          <div key={tn} className="flex flex-wrap items-center gap-2">
            <span className="voice-label w-14 text-ink-faint">{tn}</span>
            {HUES.map((h) => {
              const t = tn === "deep" ? DEEP[h] : PASTEL[h];
              const active = hue === h && tone === tn;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => { setHue(h); setTone(tn); }}
                  title={`${h} ${tn}`}
                  className={`size-7 rounded-full border ${active ? "border-ink ring-2 ring-wax" : "border-rule-faint"}`}
                  style={{ background: t?.wax ?? "var(--wax)" }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">size {size}</span>
          <input type="range" min={48} max={260} step={4} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">puck {puck.toFixed(2)}</span>
          <input type="range" min={0} max={2} step={0.05} value={puck} onChange={(e) => setPuck(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">icon {iconScale.toFixed(2)}</span>
          <input type="range" min={0.26} max={0.54} step={0.02} value={iconScale} onChange={(e) => setIconScale(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">cloud {cloud.toFixed(2)}</span>
          <input type="range" min={0} max={1} step={0.05} value={cloud} onChange={(e) => setCloud(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">speckle {speckle.toFixed(2)}</span>
          <input type="range" min={0} max={1} step={0.05} value={speckle} onChange={(e) => setSpeckle(+e.target.value)} />
          <span className="voice-data text-ink-faint">{METAL_HUES.includes(hue) ? "metal" : "—"}</span>
        </label>
        <button type="button" data-replay onClick={replay} className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper">
          Replay
        </button>
        <span className="voice-data">play #{playKey}</span>
      </div>

      {/* confirmed values — collapsed; the summary shows them at a glance */}
      <details className="rounded-[8px] border border-rule-faint bg-paper px-4 py-2.5">
        <summary className="voice-label cursor-pointer select-none text-ink-soft">
          confirmed — spring · front · bounce {bounce.toFixed(1)}× · rotate {rotate}° · linger {linger}ms · exit {exit} {exitMs}ms
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="voice-label text-ink-faint">ease</span>
            {EASES.map((e) => (
              <button key={e} type="button" onClick={() => setEase(e)} className={chip(ease === e)}>{e}</button>
            ))}
            <span className="voice-label ml-3 text-ink-faint">exit</span>
            {EXITS.map((x) => (
              <button key={x} type="button" onClick={() => setExit(x)} className={chip(exit === x)}>{x}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
          </div>
        </div>
      </details>

      <button
        type="button"
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => { setPressed(false); replay(); }}
        onPointerLeave={() => setPressed(false)}
        title="press and release to stamp"
        className="mt-2 grid cursor-pointer touch-none select-none place-items-center rounded-[12px] border border-rule-faint bg-paper py-16"
      >
        <WaxStamp
          key={`${theme}-${hue}-${tone}`}
          playKey={playKey}
          size={size}
          glyph={glyph}
          variant="spring"
          ease={ease}
          bounce={bounce}
          rotate={rotate}
          mode={autoplay ? "loop" : "tap"}
          lingerMs={linger}
          exitMs={exitMs}
          exit={exit}
          tint={tint}
          puck={puck}
          iconScale={iconScale}
          pressed={pressed}
          speckle={speckle}
          cloud={cloud}
        />
      </button>
    </div>
  );
}
