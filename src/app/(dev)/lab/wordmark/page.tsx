"use client";

/* TEMPORARY dev harness: the wax-seal "S" wordmark. Locked Paper look = lighter
   blue seal + deeper ink S. Dark mode has its own recipe (compared here), with a
   small drop shadow on "nippets" to match the seal's rendered shadow. Removed
   before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

const BASE_FONT = 20.8; // 1.3rem — the real masthead size
const BUILD = "wordmark lab · 2026-06-18 · wired to masthead";

const LIGHT_BLUE: Tint = { wax: "#5b8cc0", bright: "#6f9fd0", shadow: "#142841" };
const DEEP_BLUE: Tint = { wax: "#2e5685", bright: "#3d6b9e", shadow: "#0a1a2e" };
const INK = { light: "#241e15", dark: "#eae1cd" };
const DARK_INK = "#16110a"; // a dark S ink when the seal stays light in dark mode
// soft drop shadow for "nippets", echoing the seal's rendered contact shadow
const TEXT_SHADOW = "0 0.035em 0.06em rgba(6,12,22,0.55), 0 0.09em 0.22em rgba(6,12,22,0.32)";

type Treatment = "ink-emboss" | "white-emboss" | "wax" | "white-flat";
const TREATMENTS: { key: Treatment; label: string }[] = [
  { key: "ink-emboss", label: "ink embossed" },
  { key: "white-emboss", label: "white embossed" },
  { key: "wax", label: "wax embossed" },
  { key: "white-flat", label: "white on dome" },
];

function darken(hex: string, t: number): string {
  const m = hex.replace("#", "");
  const c = (i: number) => Math.round(parseInt(m.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0");
  return `#${c(0)}${c(2)}${c(4)}`;
}

// the seal-S then "nippets" pulled left over its right edge by `overlap`.
function Mark({
  fontPx, sealRatio, overlap, vnudge, treatment, animate, sealTint, ink, textColor, textShadow, gen, themeKey,
}: {
  fontPx: number; sealRatio: number; overlap: number; vnudge: number; treatment: Treatment;
  animate: boolean; sealTint: Tint; ink: string; textColor: string; textShadow: boolean; gen: number; themeKey: string;
}) {
  const sealPx = Math.round(fontPx * sealRatio);
  const mode = treatment === "white-flat" ? "tap" : "press";
  const whiteGlyph = treatment === "white-emboss";
  const glyphColor = treatment === "ink-emboss" ? ink : undefined;
  const still = !animate || treatment === "white-flat";
  return (
    <span className="voice-display inline-flex items-center italic leading-none tracking-tight" style={{ fontSize: fontPx, color: textColor }}>
      <span className="relative inline-block shrink-0" style={{ width: sealPx, height: sealPx, marginTop: vnudge * fontPx }}>
        <WaxStamp
          key={`${themeKey}-${treatment}-${sealTint.wax}-${ink}-${animate ? gen : "still"}`}
          playKey={gen}
          size={sealPx}
          glyph="S"
          mode={mode}
          still={still}
          whiteGlyph={whiteGlyph}
          glyphColor={glyphColor}
          tint={sealTint}
          variant="spring"
        />
      </span>
      <span className="relative z-10" style={{ marginLeft: -overlap * sealPx, textShadow: textShadow ? TEXT_SHADOW : undefined }}>nippets</span>
    </span>
  );
}

export default function WordmarkLab() {
  const [scale, setScale] = useState(2.6);
  const [sealRatio, setSealRatio] = useState(2.1);
  const [overlap, setOverlap] = useState(0.38);
  const [vnudge, setVnudge] = useState(0.22);
  const [inkDark, setInkDark] = useState(0.5);
  const [treatment, setTreatment] = useState<Treatment>("ink-emboss");
  const [animate, setAnimate] = useState(true);
  const [darkSeal, setDarkSeal] = useState<"deep" | "light">("deep");
  const [gen, setGen] = useState(1);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const themeKey = `${theme ?? "light"}-${darkSeal}`;

  // per-theme recipe. Paper: light-blue seal + deeper ink S. Lamplight: either a
  // deep-blue seal with a light S, or a light-blue seal with a dark S.
  const sealTint = dark ? (darkSeal === "deep" ? DEEP_BLUE : LIGHT_BLUE) : LIGHT_BLUE;
  const ink = dark ? (darkSeal === "deep" ? INK.dark : DARK_INK) : darken(INK.light, inkDark);
  const textColor = dark ? INK.dark : INK.light;
  const textShadow = dark;

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

  const common = { sealRatio, vnudge, sealTint, ink, themeKey };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="voice-label">wordmark lab</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">{BUILD}</span>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className={chip(false)}>{dark ? "Lamplight" : "Paper"}</button>
        <button type="button" onClick={() => setAnimate((v) => !v)} className={chip(animate)}>animate {animate ? "on" : "off"}</button>
        <button type="button" onClick={() => setGen((g) => g + 1)} className="rounded-[5px] bg-ink px-4 py-1.5 font-serif text-[0.9rem] text-paper">replay</button>
        {TREATMENTS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTreatment(t.key)} className={chip(treatment === t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="voice-label text-ink-faint">dark seal</span>
        <button type="button" onClick={() => setDarkSeal("deep")} className={chip(darkSeal === "deep")}>deep + light S</button>
        <button type="button" onClick={() => setDarkSeal("light")} className={chip(darkSeal === "light")}>light + dark S</button>
      </div>

      {/* playground (zoomed) */}
      <div className="rounded-[10px] border border-rule-faint bg-paper py-10 pl-10 pr-6">
        <Mark fontPx={BASE_FONT * scale} overlap={overlap} treatment={treatment} animate={animate} textColor={textColor} textShadow={textShadow} gen={gen} {...common} />
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
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">S ink dark {inkDark.toFixed(2)}</span>
          <input type="range" min={0} max={0.8} step={0.02} value={inkDark} onChange={(e) => setInkDark(+e.target.value)} />
        </label>
      </div>

      {/* actual masthead size */}
      <div className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper py-5 pl-10 pr-6">
        <span className="voice-label w-28 shrink-0 text-ink-faint">actual size</span>
        <Mark fontPx={BASE_FONT} overlap={overlap} treatment={treatment} animate={false} textColor={textColor} textShadow={textShadow} gen={gen} {...common} />
      </div>
    </div>
  );
}
