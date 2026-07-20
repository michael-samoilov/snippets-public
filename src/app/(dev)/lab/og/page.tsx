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
  const glyph = b.glyph ?? "S";
  const isIcon = glyph !== "S"; // e.g. "c:mic", "e:quill" — the app's capture faces
  // tint: "app" reads the live --wax tokens (the running today-zone seal),
  // "icon" the navy app-icon, else the wordmark blues
  const tint =
    b.tint === "app"
      ? undefined
      : b.tint === "icon"
        ? ICON_SEAL.tint
        : dark
          ? DEEP_BLUE
          : LIGHT_BLUE;
  // an icon glyph is embossed (no ink fill); "S" gets the ink/wordmark colour
  const glyphColor = isIcon
    ? undefined
    : b.tint === "icon"
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
        glyph={glyph}
        iconScale={b.iconScale ?? (glyph.includes("quill") ? 0.36 : 0.46)}
        mode="press"
        still
        restGlyph
        variant="spring"
        superSample={2}
        cloud={isIcon ? 0.5 : 0}
        puck={b.tint === "icon" ? ICON_SEAL.puck : isIcon ? 1 : undefined}
        glyphScale={b.tint === "icon" ? ICON_SEAL.glyphScale : undefined}
        tint={tint}
        glyphColor={glyphColor}
        ignoreReducedMotion
      />
    </div>
  );
}

/** An app view ("altitude") captured by `pnpm og --plates` into
 *  public/og-plates/<view>-<theme>.png (gitignored). Until that capture
 *  exists, falls back to the labelled gray box so the composition can still
 *  be judged. Sheet-like paint: paper ground, hairline, sheet shadow. */
function Plate({ b, dark }: { b: Extract<OgBlock, { kind: "plate" }>; dark: boolean }) {
  const [missing, setMissing] = useState(false);
  // portrait bleed captures live at <view>-bleed.png (light only for now);
  // the framed/stack plates use the tall <view>-<theme>.png phone captures.
  const src = b.portrait
    ? `/og-plates/${b.view}-bleed.png`
    : `/og-plates/${b.view}-${dark ? "dark" : "light"}.png`;
  const bleed = b.bleed;
  return (
    <div
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        transform: b.rotateDeg ? `rotate(${b.rotateDeg}deg)` : undefined,
        // a shared pivot (below the cards, same for every card in a fan) makes
        // an even angular fan — equal rotation step ⇒ equal corner step
        transformOrigin:
          b.originYpx !== undefined ? `50% ${b.originYpx}px` : undefined,
        border: bleed
          ? "none"
          : missing
            ? "1px dashed var(--ink-faint)"
            : "1px solid var(--ink-faint)",
        borderRadius: bleed ? 0 : 6,
        background: "var(--paper)",
        boxShadow: bleed ? "none" : "var(--sheet-shadow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {missing ? (
        <span className="voice-data" style={{ color: "var(--ink-faint)" }}>
          {b.view} view
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onError={() => setMissing(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: b.focus ?? "top center",
          }}
        />
      )}
    </div>
  );
}

/** Faithful reproduction of the app's today-zone composer (calendar/page.tsx
 *  TodayZoneFill): the date, three ruled lines with the placeholder, and the
 *  wax seal — seal glyph swappable. Reproduces the real markup so it reads as
 *  the app. Everything scales off the app's 390px reference. */
function TodayZone({
  b,
  dark,
}: {
  b: Extract<OgBlock, { kind: "todayzone" }>;
  dark: boolean;
}) {
  const now = new Date();
  // scale off the app's 390px sheet so the date/rules keep the app's proportion
  const s = b.scale ?? b.w / 390;
  const rule = 20 * s; // the app's 20px ruled rhythm
  const glyph = b.seal === "S" ? "S" : b.seal === "mic" ? "c:mic" : "e:quill";
  const iconScale = b.seal === "quill" ? 0.36 : 0.46;
  const useWordmarkTint = b.sealTint === "wordmark" || b.seal === "S";
  const sealPx = Math.round((b.sealScale ?? 118) * s);
  const even = b.distribute === "even";
  return (
    <div
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
      }}
    >
      {/* the app's paper material behind the content, raised off the desk */}
      {b.paper && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--paper)",
            borderRadius: 10,
            boxShadow: "var(--sheet-shadow)",
            overflow: "hidden",
          }}
        >
          <div
            className="sheet-grain"
            style={{ position: "absolute", inset: 0, height: "100%" }}
          />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          // space-evenly puts equal space above the date, between each element,
          // and below the seal — the even vertical rhythm the page metaphor wants
          justifyContent: even ? "space-evenly" : "center",
          gap: even ? 0 : 16 * s,
          textAlign: "center",
        }}
      >
      {/* the date, in the today-zone voice (calendar/page.tsx:7373) */}
      <div style={{ lineHeight: 1 }}>
        <p
          className="voice-label"
          style={{ fontSize: `${0.72 * s}rem`, color: "var(--ink-faint)", margin: 0 }}
        >
          {format(now, "EEEE")}
        </p>
        <h2
          className="voice-display"
          style={{
            fontSize: `${2 * s}rem`,
            lineHeight: 1,
            color: "var(--ink)",
            margin: `${0.25 * s}rem 0 0`,
            // pin opsz so the enlarged date keeps the app's sturdy 2rem cut
            fontOpticalSizing: "none",
            fontVariationSettings: '"SOFT" 0, "WONK" 0, "opsz" 30',
          }}
        >
          {format(now, "MMMM d")}
        </h2>
      </div>
      {/* three ruled lines + the resting placeholder (calendar/page.tsx:7506) */}
      <div style={{ width: "82%", minWidth: 0 }}>
        <div
          className="voice-prose"
          style={{
            fontSize: `${0.9 * s}rem`,
            lineHeight: `${rule}px`,
            minHeight: `${rule * 3}px`,
            textAlign: "left",
            fontStyle: "italic",
            color: "var(--ink-faint)",
            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${rule - 1}px, var(--rule-faint) ${rule - 1}px, var(--rule-faint) ${rule}px)`,
            backgroundPositionY: `${-4 * s}px`,
          }}
        >
          Add something else from today…
        </div>
      </div>
      {/* the wax seal — the app's mic/quill at default tint, or the brand S */}
      <div style={{ width: sealPx, height: sealPx, marginTop: even ? 0 : 8 * s }}>
        <WaxStamp
          playKey={ICON_SEAL.seed}
          size={sealPx}
          glyph={glyph}
          iconScale={iconScale}
          mode="press"
          still
          restGlyph
          variant="spring"
          superSample={2}
          cloud={0.5}
          puck={1}
          tint={useWordmarkTint ? (dark ? DEEP_BLUE : LIGHT_BLUE) : undefined}
          glyphColor={b.seal === "S" ? (dark ? LIGHT_S_INK : DARK_S_INK) : undefined}
          ignoreReducedMotion
        />
      </div>
      </div>
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
            // pin the optical-size axis so a big date keeps the app's sturdy cut
            ...(b.optical !== undefined
              ? {
                  fontOpticalSizing: "none",
                  fontVariationSettings: `"SOFT" 0, "WONK" 0, "opsz" ${b.optical}`,
                }
              : {}),
          }}
        >
          {resolveText(b.text)}
        </div>
      );
    }
    case "todayzone":
      return <TodayZone b={b} dark={dark} />;
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
      return <Plate b={b} dark={dark} />;
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
        width: v.size?.w ?? W,
        height: v.size?.h ?? H,
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
        og). iMessage shows the whole image at its aspect ratio; Facebook/X
        center-crop to ~1.91:1, so keep essentials in the vertical middle band.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
          alignItems: "start",
        }}
      >
        {OG_VARIANTS.map((v) => {
          const vw = v.size?.w ?? W;
          const vh = v.size?.h ?? H;
          const scale = 300 / vw;
          return (
          <div key={v.key}>
            <Link href={`/lab/og?variant=${encodeURIComponent(v.key)}`}>
              <div
                style={{
                  width: 300,
                  height: vh * scale,
                  overflow: "hidden",
                  borderRadius: 4,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: vw,
                    height: vh,
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
            <div style={{ fontSize: 12, color: "#6f6553", maxWidth: 300 }}>
              {v.concept}
            </div>
          </div>
          );
        })}
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
