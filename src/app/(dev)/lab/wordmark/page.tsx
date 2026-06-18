"use client";

/* TEMPORARY dev harness: the wax-seal "S" as the wordmark's first letter — the
   seal REPLACES the wax dot. The word "Snippets" is laid out normally with an
   invisible "S" holding its natural advance, and the seal is overlaid centred on
   that S, so size / kerning / baseline all come from the font. "nippets" paints
   ON TOP of the seal. Not linked anywhere; removed before the feature ships. */

import { useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp } from "@/components/capture/wax-stamp";

const BASE_FONT = 20.8; // 1.3rem — the real masthead size
const BUILD = "wordmark lab · 2026-06-18 · seal-S, natural fit";

// bakeGlyph draws the "S" at 0.46 of the seal, so a seal 1/0.46× the font size
// renders the embossed S at exactly the text's S size. (Independent of the glyph.)
const S_GLYPH_SCALE = 0.46;
const SEAL_RATIO = 1 / S_GLYPH_SCALE; // ≈ 2.174
// the embossed glyph's ink centre sits at 0.46 of the seal height (bakeGlyph).
const SEAL_GLYPH_CY = 0.46;
// a scratch 2-D context for measuring real font metrics (S ink centre / baseline)
const MEASURE = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;

type Treatment = "white-emboss" | "wax" | "white-flat";
const TREATMENTS: { key: Treatment; label: string }[] = [
  { key: "white-emboss", label: "white embossed" },
  { key: "wax", label: "wax embossed" },
  { key: "white-flat", label: "white on dome" },
];

function Mark({
  fontPx, sizeMul, vnudge, hnudge, treatment, animate, gen, themeKey,
}: {
  fontPx: number; sizeMul: number; vnudge: number; hnudge: number;
  treatment: Treatment; animate: boolean; gen: number; themeKey: string;
}) {
  const sref = useRef<HTMLSpanElement>(null);
  const [c, setC] = useState<{ x: number; y: number } | null>(null);
  const sealPx = Math.round(fontPx * SEAL_RATIO * sizeMul);

  useLayoutEffect(() => {
    const measure = () => {
      const s = sref.current;
      if (!s) return;
      const x = s.offsetLeft + s.offsetWidth / 2;       // S advance centre (natural kerning)
      let y = s.offsetTop + s.offsetHeight / 2;          // fallback: box centre
      // exact: place the seal so the embossed S's ink centre lands on the real S's
      // ink centre — so v-nudge 0 is the standard letter height.
      const mctx = MEASURE;
      if (mctx) {
        const cs = getComputedStyle(s);
        mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = mctx.measureText("S");
        const fpx = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight);
        const lineH = Number.isNaN(lh) ? fpx : lh;
        if (m.fontBoundingBoxAscent != null && m.actualBoundingBoxAscent != null) {
          const baseFromTop = (lineH + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
          y = s.offsetTop + baseFromTop - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        }
      }
      setC({ x, y });
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {}); // metrics shift once Fraunces loads
  }, [fontPx, treatment, themeKey, sealPx]);

  const mode = treatment === "white-flat" ? "tap" : "press";
  const whiteGlyph = treatment === "white-emboss";
  const still = !animate || treatment === "white-flat";
  // keep the seal's left overhang inside the line (it extends left of the S)
  const overhang = c ? Math.max(0, sealPx / 2 - c.x) : 0;

  return (
    <span
      className="voice-display relative isolate inline-block whitespace-nowrap italic leading-none tracking-tight text-ink"
      style={{ fontSize: fontPx, paddingLeft: overhang }}
      aria-label="Snippets"
    >
      {c && (
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ left: overhang + c.x - sealPx / 2 + hnudge * fontPx, top: c.y - SEAL_GLYPH_CY * sealPx + vnudge * fontPx, zIndex: 0 }}
        >
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
      )}
      <span ref={sref} aria-hidden style={{ visibility: "hidden" }}>S</span>
      <span className="relative" style={{ zIndex: 1 }}>nippets</span>
    </span>
  );
}

export default function WordmarkLab() {
  const [scale, setScale] = useState(2.6);
  const [sizeMul, setSizeMul] = useState(1);
  const [vnudge, setVnudge] = useState(0);
  const [hnudge, setHnudge] = useState(0);
  const [treatment, setTreatment] = useState<Treatment>("white-emboss");
  const [animate, setAnimate] = useState(false);
  const [gen, setGen] = useState(1);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const themeKey = theme ?? "light";

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

  const common = { sizeMul, vnudge, hnudge, treatment, gen, themeKey };

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

      {/* playground (zoomed) */}
      <div className="rounded-[10px] border border-rule-faint bg-paper py-10 pl-20 pr-6">
        <Mark fontPx={BASE_FONT * scale} animate={animate} {...common} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">zoom ×{scale.toFixed(1)}</span>
          <input type="range" min={1} max={5} step={0.1} value={scale} onChange={(e) => setScale(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">S size ×{sizeMul.toFixed(2)}</span>
          <input type="range" min={0.8} max={1.3} step={0.01} value={sizeMul} onChange={(e) => setSizeMul(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">v-nudge {vnudge.toFixed(2)}</span>
          <input type="range" min={-0.3} max={0.3} step={0.01} value={vnudge} onChange={(e) => setVnudge(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">h-nudge {hnudge.toFixed(2)}</span>
          <input type="range" min={-0.3} max={0.3} step={0.01} value={hnudge} onChange={(e) => setHnudge(+e.target.value)} />
        </label>
      </div>

      {/* actual masthead size */}
      <div className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper py-5 pl-12 pr-6">
        <span className="voice-label w-28 shrink-0 text-ink-faint">actual size</span>
        <Mark fontPx={BASE_FONT} animate={false} {...common} />
      </div>

      {/* mid size, against the real wordmark for comparison */}
      <div className="flex items-center gap-4 rounded-[10px] border border-rule-faint bg-paper py-6 pl-16 pr-6">
        <span className="voice-label w-28 shrink-0 text-ink-faint">≈2×</span>
        <Mark fontPx={BASE_FONT * 2} animate={false} {...common} />
      </div>
    </div>
  );
}
