"use client";

import { Component, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/** The texture is grace, not load-bearing: if WebGL misbehaves on some
 *  device, the plain paper beneath simply shows through. */
class TextureBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const PaperTexture = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.PaperTexture),
  { ssr: false },
);

const mounted = {
  subscribe: () => () => {},
  client: () => true,
  server: () => false,
};

function saveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  return conn?.saveData === true;
}

/**
 * One piece of paper on the desk. The texture is a static GPU material
 * (real fibers, the faintest crumple) strongest where the lamplight
 * pools, fading out further down the page. Plain paper beneath it
 * always — the shader is grace, not load-bearing.
 */
export function Sheet({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMounted = useSyncExternalStore(
    mounted.subscribe,
    mounted.client,
    mounted.server,
  );
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  // While the page is pinch-zoomed in, iOS re-rasterizes the composited page at
  // the zoom scale; a full-sheet WebGL layer on top of that GPU load can tip a
  // low-memory device over (the app crashing on extreme zoom). The texture is
  // grace, not load-bearing, so shed it past a modest zoom and bring it back on
  // the way out — one fewer heavy layer exactly when memory is tight.
  const [zoomedIn, setZoomedIn] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onZoom = () => setZoomedIn(vv.scale > 1.2);
    vv.addEventListener("resize", onZoom);
    return () => vv.removeEventListener("resize", onZoom);
  }, []);

  return (
    <div className={cn("sheet", className)}>
      {isMounted && !saveData() && !zoomedIn && (
        <TextureBoundary>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden rounded-[inherit]"
          style={{
            height: "min(135vh, 100%)",
            maskImage:
              "linear-gradient(to bottom, black 55%, transparent 98%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 55%, transparent 98%)",
          }}
        >
          <PaperTexture
            key={dark ? "dark" : "light"}
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
            style={{ width: "100%", height: "100%", opacity: dark ? 0.5 : 0.65 }}
          />
        </div>
        </TextureBoundary>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
