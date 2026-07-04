"use client";

/* TEMPORARY dev/baking harness for the sheet's paper texture. The texture is a
   static (speed=0) WebGL shader — a heavy GPU layer that iOS must re-rasterize
   at the pinch scale (the zoom crash) and that we'd otherwise have to shed
   mid-zoom, leaving an ugly flat sheet. This page renders the shader full-bleed
   at opacity 1 so it can be baked once to a static bitmap (see
   scripts/bake-texture.mjs / the webapp-testing capture), after which the app
   ships a plain background image and never loads WebGL at all.

   ?theme=dark bakes the Lamplight variant. Keep this route for re-baking if the
   shader params below ever change — they must mirror src/components/shell/sheet.tsx. */

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const PaperTexture = dynamic(
  () => import("@/vendor/paper-shaders/react/shaders/paper-texture").then((m) => m.PaperTexture),
  { ssr: false },
);

function Bake() {
  const dark = useSearchParams().get("theme") === "dark";
  return (
    <div
      data-texture-bake
      style={{ position: "fixed", inset: 0, background: dark ? "#1d1812" : "#f7f1e3" }}
    >
      <PaperTexture
        colorBack={dark ? "#1d1812" : "#f7f1e3"}
        colorFront={dark ? "#322a1d" : "#ddd0b2"}
        contrast={0.16}
        roughness={0.18}
        fiber={0.55}
        fiberSize={0.1}
        crumples={0.1}
        crumpleSize={0.3}
        folds={0}
        foldCount={1}
        drops={0.06}
        fade={0}
        seed={7}
        scale={1}
        speed={0}
        style={{ width: "100%", height: "100%", opacity: 1 }}
      />
    </div>
  );
}

export default function TextureLab() {
  return (
    <Suspense fallback={null}>
      <Bake />
    </Suspense>
  );
}
