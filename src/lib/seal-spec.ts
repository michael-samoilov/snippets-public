/**
 * THE OFFICIAL APP-ICON SEAL — the single source of truth for the wax seal in
 * the favicons and app icons. The tuned parameters live in ./icon-seal.json; the
 * studio at /lab/icon-studio edits + bakes them, and `pnpm icons`
 * (scripts/bake-icons.mjs) reproduces the same icons headless. Change the seal
 * THERE (or in the studio) and re-bake — never hand-edit a PNG. See
 * public/icons/README.md.
 *
 * NOTE: this ICON seal is intentionally a deeper navy than the in-app wordmark
 * seal / `--wax` accent (those are theme-tuned against the desk and stay #2e5685);
 * the home-screen icon runs darker for contrast on the OS grid.
 */
import type { Tint } from "@/components/capture/wax-stamp";
import spec from "./icon-seal.json";

export interface IconVariant {
  key: string;
  file: string;
  size: number;
  bg: string | null;
  fill: number; // seal canvas as a fraction of the icon frame
  cx: number; // frame-space optical centre, 0..1
  cy: number;
}

export interface IconSealSpec {
  seed: number; // WaxStamp playKey — picks the deterministic lobe silhouette
  puck: number;
  glyph: string;
  glyphColor: string;
  glyphScale: number;
  tint: Tint;
  renderSize: number;
  superSample: number;
  variants: IconVariant[];
}

export const ICON_SEAL = spec as IconSealSpec;

// mirrors wax-stamp.tsx: the silhouette is seeded by playKey, so the lobe count
// is deterministic per seed. Lets the studio label a seed 5-/6-/7-lobed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lobeCount(seed: number): 5 | 6 | 7 {
  const u = mulberry32(Math.imul(seed, 0x9e3779b1) >>> 0)();
  return u < 3 / 6 ? 5 : u < 5 / 6 ? 6 : 7;
}
