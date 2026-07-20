"use client";

// The link-preview (OG image) variant lab. Renders 1200×630 compositions at
// blocking fidelity from the app's REAL materials — resolved tokens, Fraunces,
// the paper textures, the live WaxStamp — driven by src/lib/og-variants.json
// (types in src/lib/og-spec.ts). scripts/bake-og.mjs screenshots each variant
// via ?variant=<key>; with no params this page is an index grid for browsing.
// Not user-facing (gated to non-production by src/proxy.ts).
//
// Blocking fidelity means: real color/type/texture, but a `tiltDeg` seal falls
// back to a CSS perspective tilt (labelled) until the relight module exists,
// and `plate` blocks render as labelled gray boxes until the view-plate module
// exists. Enough truth to judge a direction, cheap enough to render thirty.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { ICON_SEAL } from "@/lib/seal-spec";
import { DEEP_BLUE, LIGHT_BLUE } from "@/components/shell/wordmark";
import { copy } from "@/lib/copy";
import {
  OG_VARIANTS,
  type OgBlock,
  type OgSealBlock,
  type OgVariant,
} from "@/lib/og-spec";

const W = 1200;
const H = 630;

// the wordmark's S-ink colours (mirrors wordmark.tsx DARK_S_INK / LIGHT_S_INK)
const DARK_S_INK = "#120f0b";
const LIGHT_S_INK = "#eae1cd";

function resolveText(text: string): string {
  const now = new Date();
  switch (text) {
    case "$name":
      return copy.app.name;
    case "$tagline":
      return copy.app.description;
    case "$url":
      return "snippets.ink";
    case "$dateWeekday":
      return format(now, "EEEE");
    case "$dateFull":
      return format(now, "MMMM d");
    default:
      return text;
  }
}

const COLOR_VAR: Record<string, string> = {
  ink: "var(--ink)",
  "ink-soft": "var(--ink-soft)",
  "ink-faint": "var(--ink-faint)",
  wax: "var(--wax)",
  gilt: "var(--gilt)",
};

const VOICE_CLASS: Record<string, string> = {
  display: "voice-display",
  label: "voice-label",
  prose: "voice-prose",
  mono: "voice-data",
};

function Seal({ b, dark }: { b: OgSealBlock; dark: boolean }) {
  // tiltDeg = the real relight module; until it exists, stand in with the same
  // CSS tilt so the composition can be judged (the bake labels it a stand-in).
  const tilt = b.cssTilt ?? b.tiltDeg;
  const tint =
    b.tint === "icon" ? ICON_SEAL.tint : dark ? DEEP_BLUE : LIGHT_BLUE;
  const glyphColor =
    b.tint === "icon"
      ? ICON_SEAL.glyphColor
      : dark
        ? LIGHT_S_INK
        : DARK_S_INK;
  return (
    <div
      style={{
        position: "absolute",
        left: b.cx - b.sizePx / 2,
        top: b.cy - b.sizePx / 2,
        width: b.sizePx,
        height: b.sizePx,
        transform: [
          tilt ? `perspective(900px) rotateX(${tilt}deg)` : "",
          b.rotateDeg ? `rotate(${b.rotateDeg}deg)` : "",
        ]
          .filter(Boolean)
          .join(" "),
      }}
    >
      <WaxStamp
        playKey={ICON_SEAL.seed}
        size={b.sizePx}
        glyph={b.glyph ?? "S"}
        mode="press"
        still
        restGlyph
        variant="spring"
        superSample={2}
        puck={b.tint === "icon" ? ICON_SEAL.puck : undefined}
        glyphScale={b.tint === "icon" ? ICON_SEAL.glyphScale : undefined}
        tint={tint}
        glyphColor={glyphColor}
        ignoreReducedMotion
      />
    </div>
  );
}

function Block({ b, dark }: { b: OgBlock; dark: boolean }) {
  switch (b.kind) {
    case "text": {
      return (
        <div
          className={VOICE_CLASS[b.voice]}
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.w,
            fontSize: b.sizePx,
            textAlign: b.align ?? "left",
            color: COLOR_VAR[b.color ?? "ink"],
            fontStyle: b.italic ? "italic" : undefined,
            lineHeight: b.lineHeight ?? (b.voice === "prose" ? 1.5 : 1.1),
            letterSpacing:
              b.trackingEm !== undefined ? `${b.trackingEm}em` : undefined,
          }}
        >
          {resolveText(b.text)}
        </div>
      );
    }
    case "seal":
      return <Seal b={b} dark={dark} />;
    case "sheet":
      return (
        <div
          className="sheet"
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            transform: b.rotateDeg ? `rotate(${b.rotateDeg}deg)` : undefined,
            boxShadow: b.shadow === false ? "none" : undefined,
          }}
        >
          {b.grain !== false && <div className="sheet-grain" />}
        </div>
      );
    case "wordmark": {
      const sealPx = Math.round(b.fontPx * 2.1); // wordmark.tsx SEAL_RATIO
      return (
        <div
          className="wordmark voice-display italic tracking-tight"
          style={{
            position: "absolute",
            left: b.cx,
            top: b.cy,
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            color: "var(--ink)",
          }}
        >
          <span
            style={{
              position: "relative",
              display: "inline-block",
              flexShrink: 0,
              width: sealPx,
              height: sealPx,
              transform: `translateY(${0.04 * sealPx}px)`, // NUDGE
            }}
          >
            <WaxStamp
              playKey={ICON_SEAL.seed}
              size={sealPx}
              glyph="S"
              mode="press"
              still
              restGlyph
              variant="spring"
              superSample={2}
              tint={dark ? DEEP_BLUE : LIGHT_BLUE}
              glyphColor={dark ? LIGHT_S_INK : DARK_S_INK}
              ignoreReducedMotion
            />
          </span>
          <span
            className="wordmark-tail relative z-10"
            style={{
              marginLeft: -0.37 * sealPx, // OVERLAP
              lineHeight: `${sealPx}px`,
              fontSize: b.fontPx,
            }}
          >
            nippets
          </span>
        </div>
      );
    }
    case "plate":
      // gray-box until the view-plate module lands (Phase B)
      return (
        <div
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            transform: b.rotateDeg ? `rotate(${b.rotateDeg}deg)` : undefined,
            border: "1px dashed var(--ink-faint)",
            borderRadius: 6,
            background: "var(--paper)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="voice-data" style={{ color: "var(--ink-faint)" }}>
            {b.view} view
          </span>
        </div>
      );
    case "light": {
      const a = 0.55 * (b.strength ?? 0.5);
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(circle ${b.radius}px at ${b.cx}px ${b.cy}px, rgba(255, 234, 180, ${a}), rgba(255, 234, 180, 0) 70%)`,
          }}
        />
      );
    }
    case "box":
      return (
        <div
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            border: "1px dashed var(--ink-faint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="voice-data" style={{ color: "var(--ink-faint)" }}>
            {b.label}
          </span>
        </div>
      );
  }
}

function Stage({ v, id }: { v: OgVariant; id?: string }) {
  const dark = v.theme === "dark";
  return (
    <div
      id={id}
      className={dark ? "dark" : undefined}
      style={{
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        background: "var(--desk)",
        colorScheme: dark ? "dark" : "light",
      }}
    >
      {v.blocks.map((b, i) => (
        <Block key={i} b={b} dark={dark} />
      ))}
    </div>
  );
}

/** Bake surface: one variant at natural size. Sets data-ready="1" on #og-stage
 *  once fonts are loaded AND every seal canvas has opaque pixels, so the bake
 *  never screenshots fallback serifs or a blank canvas. */
function BakeView({ v }: { v: OgVariant }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = false;
    const canvasesReady = () => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>(
        "#og-stage canvas",
      );
      for (const c of canvases) {
        const s = Math.min(240, c.width);
        const ctx = c.getContext("2d");
        if (!ctx) return false;
        const d = ctx.getImageData(
          (c.width - s) / 2,
          (c.height - s) / 2,
          s,
          s,
        ).data;
        let n = 0;
        let ok = false;
        for (let i = 3; i < d.length; i += 4)
          if (d[i] > 10 && ++n > 300) {
            ok = true;
            break;
          }
        if (!ok) return false;
      }
      return true;
    };
    document.fonts.ready.then(() => {
      const poll = () => {
        if (stop) return;
        if (canvasesReady()) setReady(true);
        else setTimeout(poll, 150);
      };
      poll();
    });
    return () => {
      stop = true;
    };
  }, [v]);
  return (
    // above the app shell (the masthead would otherwise bleed into the shot)
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        zIndex: 9999,
        background: "#777",
      }}
    >
      <div id="og-stage-wrap" data-ready={ready ? "1" : undefined}>
        <Stage v={v} id="og-stage" />
      </div>
    </div>
  );
}

function Index() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#e8dcc2",
        color: "#241e15",
        padding: 24,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        og — link-preview variants
      </h1>
      <p style={{ color: "#6f6553", fontSize: 13, marginBottom: 20 }}>
        {OG_VARIANTS.length} candidates from src/lib/og-variants.json. Click one
        for the bake view (?variant=key). Baked by scripts/bake-og.mjs (pnpm
        og). Center 630×630 is the iMessage-safe zone.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 20,
        }}
      >
        {OG_VARIANTS.map((v) => (
          <div key={v.key}>
            <Link href={`/lab/og?variant=${encodeURIComponent(v.key)}`}>
              <div
                style={{
                  width: 360,
                  height: 189,
                  overflow: "hidden",
                  borderRadius: 4,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
              >
                <div
                  style={{
                    transform: "scale(0.3)",
                    transformOrigin: "top left",
                    width: W,
                    height: H,
                    pointerEvents: "none",
                  }}
                >
                  <Stage v={v} />
                </div>
              </div>
            </Link>
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600 }}>
              {v.key}{" "}
              <span style={{ color: "#6f6553", fontWeight: 400 }}>
                · {v.theme} · {v.lens}
                {v.needs?.length ? ` · needs ${v.needs.join("+")}` : ""}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#6f6553", maxWidth: 360 }}>
              {v.concept}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OgLabInner() {
  const params = useSearchParams();
  const key = params.get("variant");
  const v = key ? OG_VARIANTS.find((x) => x.key === key) : undefined;
  if (key && !v)
    return (
      <div style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
        unknown variant “{key}”
      </div>
    );
  return v ? <BakeView v={v} /> : <Index />;
}

export default function OgLab() {
  return (
    <Suspense fallback={null}>
      <OgLabInner />
    </Suspense>
  );
}
