import { cn } from "@/lib/utils";

/**
 * One piece of paper on the desk. The grain (real fibers, the faintest
 * crumple) is strongest where the lamplight pools and fades out further down
 * the page — a static bitmap baked once from the paper shader (see
 * `public/textures`, re-bake via `/lab/texture`).
 *
 * It used to be a live WebGL shader. That was a heavy GPU layer iOS had to
 * re-rasterize at the pinch scale — a cause of the zoom crash on low-memory
 * iPhones — so it was shed mid-zoom, which left an ugly flat sheet. A plain
 * image folds into the sheet's own paint instead: cheap to re-raster at any
 * scale (so it can stay put through a zoom, nothing to shed) and it costs
 * nothing at startup, since the shader bundle is never loaded. Plain paper
 * beneath it always — the grain is grace, not load-bearing — and it's dropped
 * entirely under prefers-reduced-data (see globals.css).
 */
export function Sheet({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sheet", className)}>
      <div className="sheet-grain" aria-hidden="true" />
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
