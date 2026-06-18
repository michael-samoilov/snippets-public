"use client";

/* TEMPORARY dev harness: the wax-seal "S" as the wordmark's first letter (the
   seal replaces the wax dot). Iterating from the chosen look — light-blue seal,
   ink-coloured embossed S — with two tries: a darker S ink, and embossing every
   letter with the same relief (WaxText). Removed before the feature ships. */

import { useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { WaxText } from "@/components/capture/wax-text";

const BASE_FONT = 20.8; // 1.3rem — the real masthead size
const BUILD = "wordmark lab · 2026-06-18 · LOCKED: light blue + deeper ink S";

const LIGHT_BLUE = { wax: "#5b8cc0", bright: "#6f9fd0", shadow: "#142841" };
const FADE_MASK = "linear-gradient(to right, #000 50%, rgba(0,0,0,0.12) 97%)";
const INK = { light: "#241e15", dark: "#eae1cd" };

type Treatment = "ink-emboss" | "white-emboss" | "wax" | "white-flat";
const TREATMENTS: { key: Treatment; label: string }[] = [
  { key: "ink-emboss", label: "ink embossed" },
  { key: "white-emboss", label: "white embossed" },
  { key: "wax", label: "wax embossed" },
  { key: "white-flat", label: "white on dome" },
];

// darken a hex toward black by t (0 = unchanged, 1 = black)
function darken(hex: string, t: number): string {
  const m = hex.replace("#", "");
  const c = (i: number) => Math.round(parseInt(m.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0");
  return `#${c(0)}${c(2)}${c(4)}`;
}

// the seal-S then "nippets" pulled left over its right edge by `overlap`.
function Mark({
  fontPx, sealRatio, overlap, vnudge, treatment, animate, fade, lightBlue, ink, gen, themeKey,
}: {
  fontPx: number; sealRatio: number; overlap: number; vnudge: number; treatment: Treatment;
  animate: boolean; fade: boolean; lightBlue: boolean; ink: string; gen: number; themeKey: string;
}) {
  const sealPx = Math.round(fontPx * sealRatio);
  const mode = treatment === "white-flat" ? "tap" : "press";
  const whiteGlyph = treatment === "white-emboss";
  const glyphColor = treatment === "ink-emboss" ? ink : undefined;
  const still = !animate || treatment === "white-flat";
  return (
    <span className="voice-display inline-flex items-center italic leading-none tracking-tight text-ink" style={{ fontSize: fontPx }}>
      <span
        className="relative inline-block shrink-0"
        style={{ width: sealPx, height: sealPx, marginTop: vnudge * fontPx, WebkitMaskImage: fade ? FADE_MASK : undefined, maskImage: fade ? FADE_MASK : undefined }}
      >
        <WaxStamp
          key={`${themeKey}-${treatment}-${lightBlue ? "lt" : "tk"}-${ink}-${animate ? gen : "still"}`}
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

// every letter embossed (WaxText), with a blank wax disc behind the "S".
function EmbossMark({ fontPx, sealRatio, vnudge, lightBlue, ink, themeKey }: {
  fontPx: number; sealRatio: number; vnudge: number; lightBlue: boolean; ink: string; themeKey: string;
}) {
  const [s, setS] = useState<{ sCenterX: number; sCenterY: number } | null>(null);
  const sealPx = Math.round(fontPx * sealRatio);
  const padL = s ? Math.max(0, sealPx / 2 - s.sCenterX) : sealPx / 2;
  return (
    <span style={{ position: "relative", display: "inline-block", paddingLeft: padL }}>
      {s && (
        <span style={{ position: "absolute", left: padL + s.sCenterX - sealPx / 2, top: s.sCenterY - 0.46 * sealPx + vnudge * fontPx, zIndex: 0 }}>
          <WaxStamp key={`${themeKey}-blank-${lightBlue ? "lt" : "tk"}`} playKey={1} size={sealPx} glyph="" mode="press" still tint={lightBlue ? LIGHT_BLUE : undefined} variant="spring" />
        </span>
      )}
      <span style={{ position: "relative", zIndex: 10, display: "block" }}>
        <WaxText text="Snippets" fontPx={fontPx} ink={ink} themeKey={themeKey} onLayout={setS} />
      </span>
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
  const [fade, setFade] = useState(false);
  const [lightBlue, setLightBlue] = useState(true);
  const [embossAll, setEmbossAll] = useState(false);
  const [gen, setGen] = useState(1);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const themeKey = theme ?? "light";
  const ink = dark ? INK.dark : darken(INK.light, inkDark);

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

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
        <button type="button" onClick={() => setFade((v) => !v)} className={chip(fade)}>edge fade {fade ? "on" : "off"}</button>
        <button type="button" onClick={() => setLightBlue((v) => !v)} className={chip(lightBlue)}>light blue {lightBlue ? "on" : "off"}</button>
        <button type="button" onClick={() => setEmbossAll((v) => !v)} className={chip(embossAll)}>emboss all letters {embossAll ? "on" : "off"}</button>
      </div>

      {/* playground (zoomed) */}
      <div className="rounded-[10px] border border-rule-faint bg-paper py-10 pl-10 pr-6">
        {embossAll
          ? <EmbossMark fontPx={BASE_FONT * scale} sealRatio={sealRatio} vnudge={vnudge} lightBlue={lightBlue} ink={ink} themeKey={themeKey} />
          : <Mark fontPx={BASE_FONT * scale} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={animate} fade={fade} lightBlue={lightBlue} ink={ink} gen={gen} themeKey={themeKey} />}
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
        {embossAll
          ? <EmbossMark fontPx={BASE_FONT} sealRatio={sealRatio} vnudge={vnudge} lightBlue={lightBlue} ink={ink} themeKey={themeKey} />
          : <Mark fontPx={BASE_FONT} sealRatio={sealRatio} overlap={overlap} vnudge={vnudge} treatment={treatment} animate={false} fade={fade} lightBlue={lightBlue} ink={ink} gen={gen} themeKey={themeKey} />}
      </div>
    </div>
  );
}
