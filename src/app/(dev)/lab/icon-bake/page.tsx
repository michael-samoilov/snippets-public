"use client";

// Headless bake surface for `pnpm icons`: renders ONLY the official icon seal,
// from src/lib/icon-seal.json (via seal-spec), settled and still, on a transparent
// field. scripts/bake-icons.mjs loads this, reads the seal canvas at full
// resolution, and composites every variant from it — matching /lab/icon-studio.
// Not user-facing.
import { WaxStamp } from "@/components/capture/wax-stamp";
import { ICON_SEAL } from "@/lib/seal-spec";

export default function IconBake() {
  return (
    <div
      id="icon-bake"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      <WaxStamp
        playKey={ICON_SEAL.seed}
        size={ICON_SEAL.renderSize}
        glyph={ICON_SEAL.glyph}
        mode="press"
        still
        restGlyph
        variant="spring"
        superSample={ICON_SEAL.superSample}
        puck={ICON_SEAL.puck}
        glyphScale={ICON_SEAL.glyphScale}
        tint={ICON_SEAL.tint}
        glyphColor={ICON_SEAL.glyphColor}
        ignoreReducedMotion
      />
    </div>
  );
}
