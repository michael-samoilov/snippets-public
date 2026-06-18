"use client";

/* TEMPORARY dev harness: exploring the wax-seal "S" as the wordmark's first
   letter — the seal REPLACES the wax dot, with "nippets" overlapping its right
   edge. Manual sliders (seal ratio · overlap · v-nudge) so the parameters can be
   eyeballed. Not linked anywhere; removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp } from "@/components/capture/wax-stamp";

const BASE_FONT = 20.8; // 1.3rem — the real masthead size
const BUILD = "wordmark lab · 2026-06-18 · locked + contrast tries";

// Lamplight's lighter wax blue — an alternative to deepen "n" contrast on Paper.
const LIGHT_BLUE = { wax: "#5b8cc0", bright: "#6f9fd0", shadow: "#142841" };
// fade the seal's right edge so "nippets" reads against the paper, not the wax.
const FADE_MASK = "linear-gradient(to right, #000 50%, rgba(0,0,0,0.12) 97%)";

type Treatment = "white-emboss" | "ink-emboss" | "wax" | "white-flat";
const TREATMENTS: { key: Treatment; label: string }[] = [
  { key: "white-emboss", label: "white embossed" },
  { key: "ink-emboss", label: "ink embossed" },
  { key: "wax", label: "wax embossed" },
  { key: "white-flat", label: "white on dome" },
];
// the embossed S in the text's ink colour, per theme (matches "nippets").
const INK = { light: "#241e15", dark: "#eae1cd" };

// the seal-S then "nippets" pulled left over its right edge by `overlap`.
function Mark({
  fontPx, sealRatio, overlap, vnudge, treatment, animate, fade, lightBlue, gen, themeKey,
}: {
  fontPx: number; sealRatio: number; overlap: number; vnudge: number;
  treatment: Treatment; animate: boolean; fade: boolean; lightBlue: boolean; gen: number; themeKey: string;
}) {
  const sealPx = Math.round(fontPx * sealRatio);
  const mode = treatment === "white-flat" ? "tap" : "press";
  const whiteGlyph = treatment === "white-emboss";
  const glyphColor = treatment === "ink-emboss" ? (themeKey === "dark" ? INK.dark : INK.light) : undefined;
  const still = !animate || treatment === "white-flat";
  return (
    <span
      className="voice-display inline-flex items-center italic leading-none tracking-tight text-ink"
      style={{ fontSize: fontPx }}
    >
      <span
        className="relative inline-block shrink-0"
        style={{ width: sealPx, height: sealPx, marginTop: vnudge * fontPx, WebkitMaskImage: fade ? FADE_MASK : undefined, maskImage: fade ? FADE_MASK : undefined }}
      >
        <WaxStamp
          key={`${themeKey}-${treatment}-${lightBlue ? "lt" : "tk"}-${animate ? gen : "still"}`}
          playKey={gen}
          size={sealPx}
          glyph="S"
          mode={mode}
          still={still}
          whiteGlyph={whiteGlyph}
          glyphColor={glyphColor}
          tint={lightBlue ? LIGHT_BLUE : undefined}
          variant="spring"
        />
      </span>
      <span className="relative z-10" style={{ marginLeft: -overlap * sealPx }}>nippets</span>
    </span>
  );
}

const PRESETS: { label: string; sealRatio: number; overlap: number; vnudge: number }[] = [
  { label: "snug", sealRatio: 2.1, overlap: 0.18, vnudge: 0 },
  { label: "medium", sealRatio: 2.1, overlap: 0.26, vnudge: 0 },
  { label: "deep", sealRatio: 2.1, overlap: 0.34, vnudge: 0 },
  { label: "big seal", sealRatio: 2.5, overlap: 0.30, vnudge: 0 },
];

export default function WordmarkLab() {
  const [scale, setScale] = useState(2.6);
  const [sealRatio, setSealRatio] = useState(2.1);
  const [overlap, setOverlap] = useState(0.38);
  const [vnudge, setVnudge] = useState(0.22);
  const [treatment, setTreatment] = useState<Treatment>("white-emboss");
  const [animate, setAnimate] = useState(true);
  const [fade, setFade] = useState(false);
  const [lightBlue, setLightBlue] = useState(false);
  const [gen, setGen] = useState(1);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const themeKey = theme ?? "light";

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="voice-label">wordmark lab</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">{BUILD}</span>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className={chip(false)}>
          {dark ? "Lamplight" : "Paper"}
        </button>
        <button type="button" onClick={() => setAnimate((v) => !v)} className={chip(animate)}>
          animate on load {animate ? "on" : "off"}
        </button>
        <button type="button" onClick={() => setGen((g) => g + 1)} className="rounded-[5px] bg-ink px-4 py-1.5 font-serif text-[0.9rem] text-paper">
          replay
        </button>
        {TREATMENTS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTreatment(t.key)} className={chip(treatment === t.key)}>{t.label}</button>
        ))}
      </div>

      {/* contrast alternatives for the overlapping "n" */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="voice-label text-ink-faint">contrast try</span>
        <button type="button" onClick={() => setFade((v) => !v)} className={chip(fade)}>edge fade {fade ? "on" : "off"}</button>
        <button type="button" onClick={() => setLightBlue((v) => !v)} className={chip(lightBlue)}>light blue {lightBlue ? "on" : "off"}</button>
      </div>

      {/* playground (zoomed) */}
      <div className="rounded-[10px] border border-rule-faint bg-paper py-10 pl-8 pr-6">
        <Mark fontPx={BASE_FONT * scale} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={animate} fade={fade} lightBlue={lightBlue} gen={gen} themeKey={themeKey} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">zoom ×{scale.toFixed(1)}</span>
          <input type="range" min={1} max={5} step={0.1} value={scale} onChange={(e) => setScale(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">seal ratio {sealRatio.toFixed(2)}</span>
          <input type="range" min={1.4} max={3} step={0.01} value={sealRatio} onChange={(e) => setSealRatio(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">overlap {overlap.toFixed(2)}</span>
          <input type="range" min={0} max={0.5} step={0.01} value={overlap} onChange={(e) => setOverlap(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">v-nudge {vnudge.toFixed(2)}</span>
          <input type="range" min={-0.3} max={0.3} step={0.01} value={vnudge} onChange={(e) => setVnudge(+e.target.value)} />
        </label>
      </div>

      {/* actual masthead size */}
      <div className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper py-5 pl-8 pr-6">
        <span className="voice-label w-28 shrink-0 text-ink-faint">actual size</span>
        <Mark fontPx={BASE_FONT} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={false} fade={fade} lightBlue={lightBlue} gen={gen} themeKey={themeKey} />
      </div>

      {/* overlap reference points at the current ratio/treatment */}
      <h2 className="voice-label text-ink-soft">presets (≈2×)</h2>
      <div className="flex flex-col gap-2">
        {PRESETS.map((pre) => (
          <div key={pre.label} className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper py-5 pl-8 pr-6">
            <span className="voice-label w-28 shrink-0 text-ink-faint">{pre.label}</span>
            <Mark fontPx={BASE_FONT * 2} sealRatio={pre.sealRatio} overlap={pre.overlap} vnudge={pre.vnudge} treatment={treatment} animate={false} fade={fade} lightBlue={lightBlue} gen={gen} themeKey={themeKey} />
          </div>
        ))}
      </div>
    </div>
  );
}
