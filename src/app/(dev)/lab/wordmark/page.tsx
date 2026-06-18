"use client";

/* TEMPORARY dev harness: exploring the wax-seal "S" as the wordmark's first
   letter — the seal REPLACES the wax dot, with "nippets" overlapping its right
   edge. Not linked anywhere; removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp } from "@/components/capture/wax-stamp";

const BASE_FONT = 20.8; // 1.3rem — the real masthead size
const BUILD = "wordmark lab · 2026-06-18 · seal-S in the masthead";

type Treatment = "wax" | "white-emboss" | "white-flat";
const TREATMENTS: { key: Treatment; label: string }[] = [
  { key: "wax", label: "wax embossed" },
  { key: "white-emboss", label: "white embossed" },
  { key: "white-flat", label: "white on dome" },
];

// one wordmark: the seal-S then "nippets" tucked over its right edge.
function Mark({
  fontPx, sealRatio, overlap, vnudge, treatment, animate, gen, themeKey,
}: {
  fontPx: number; sealRatio: number; overlap: number; vnudge: number;
  treatment: Treatment; animate: boolean; gen: number; themeKey: string;
}) {
  const sealPx = Math.round(fontPx * sealRatio);
  const mode = treatment === "white-flat" ? "tap" : "press";
  const whiteGlyph = treatment === "white-emboss";
  const still = !animate || treatment === "white-flat";
  return (
    <span
      className="voice-display inline-flex items-center italic leading-none tracking-tight text-ink"
      style={{ fontSize: fontPx }}
    >
      <span className="relative inline-block shrink-0" style={{ width: sealPx, height: sealPx, marginTop: vnudge * fontPx }}>
        <WaxStamp
          key={`${themeKey}-${treatment}-${animate ? gen : "still"}`}
          playKey={gen}
          size={sealPx}
          glyph="S"
          mode={mode}
          still={still}
          whiteGlyph={whiteGlyph}
          variant="spring"
        />
      </span>
      <span style={{ marginLeft: -overlap * sealPx }}>nippets</span>
    </span>
  );
}

const PRESETS: { label: string; treatment: Treatment; sealRatio: number; overlap: number; vnudge: number }[] = [
  { label: "wax · snug", treatment: "wax", sealRatio: 2.0, overlap: 0.20, vnudge: 0 },
  { label: "wax · deep overlap", treatment: "wax", sealRatio: 2.0, overlap: 0.34, vnudge: 0 },
  { label: "wax · big seal", treatment: "wax", sealRatio: 2.5, overlap: 0.28, vnudge: 0 },
  { label: "white embossed", treatment: "white-emboss", sealRatio: 2.0, overlap: 0.22, vnudge: 0 },
  { label: "white on dome", treatment: "white-flat", sealRatio: 2.0, overlap: 0.22, vnudge: 0 },
  { label: "white embossed · big", treatment: "white-emboss", sealRatio: 2.5, overlap: 0.30, vnudge: 0 },
];

export default function WordmarkLab() {
  const [scale, setScale] = useState(2.4);
  const [sealRatio, setSealRatio] = useState(2.1);
  const [overlap, setOverlap] = useState(0.24);
  const [vnudge, setVnudge] = useState(0);
  const [treatment, setTreatment] = useState<Treatment>("wax");
  const [animate, setAnimate] = useState(false);
  const [gen, setGen] = useState(1);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const themeKey = theme ?? "light";
  const fontPx = BASE_FONT * scale;

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

      {/* playground */}
      <div className="rounded-[10px] border border-rule-faint bg-paper px-6 py-8">
        <Mark fontPx={fontPx} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={animate} gen={gen} themeKey={themeKey} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">zoom ×{scale.toFixed(1)}</span>
          <input type="range" min={1} max={4} step={0.1} value={scale} onChange={(e) => setScale(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">seal ratio {sealRatio.toFixed(2)}</span>
          <input type="range" min={1.6} max={3} step={0.05} value={sealRatio} onChange={(e) => setSealRatio(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">overlap {overlap.toFixed(2)}</span>
          <input type="range" min={0} max={0.45} step={0.01} value={overlap} onChange={(e) => setOverlap(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">v-nudge {vnudge.toFixed(2)}</span>
          <input type="range" min={-0.25} max={0.25} step={0.01} value={vnudge} onChange={(e) => setVnudge(+e.target.value)} />
        </label>
      </div>

      {/* actual masthead size, for a true-to-life read */}
      <div className="flex items-center gap-3 rounded-[10px] border border-rule-faint bg-paper px-6 py-4">
        <span className="voice-label w-28 text-ink-faint">actual size</span>
        <Mark fontPx={BASE_FONT} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={false} gen={gen} themeKey={themeKey} />
      </div>

      {/* presets to compare */}
      <h2 className="voice-label text-ink-soft">presets</h2>
      <div className="flex flex-col gap-2">
        {PRESETS.map((pre) => (
          <div key={pre.label} className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper px-6 py-5">
            <span className="voice-label w-40 shrink-0 text-ink-faint">{pre.label}</span>
            <Mark fontPx={BASE_FONT * 2.2} sealRatio={pre.sealRatio} overlap={pre.overlap} vnudge={pre.vnudge} treatment={pre.treatment} animate={false} gen={gen} themeKey={themeKey} />
          </div>
        ))}
      </div>
    </div>
  );
}
