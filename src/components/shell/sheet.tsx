import { cn } from "@/lib/utils";

/**
 * One piece of paper on the desk. The grain (real fibers, the faintest
 * crumple) is strongest where the lamplight pools and fades out further down
 * the page — a static bitmap baked once from the paper shader (see
 * `public/textures`, re-bake via `/lab/texture`).
 *
 * It used to be a live WebGL shader — a heavy GPU layer, and a cause of the
 * zoom crash on low-memory iPhones. A plain image folds into the sheet's own
 * paint instead and costs nothing at startup (the shader bundle never loads).
 * Because it's a static bitmap, a pinch only re-rasters the visible tiles
 * (viewport-bounded), not the whole thing at the zoom scale, so it stays put
 * through a zoom — unlike the shader, it needn't be shed. Plain paper beneath it
 * always — the grain is grace, not load-bearing — and it's dropped under
 * prefers-reduced-data too.
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
