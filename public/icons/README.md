# App icons — source of truth

**The logo is the live 3-D wax seal, not a file in this folder.** Every shipped
icon is a render of the `WaxStamp` component
(`src/components/capture/wax-stamp.tsx`) — the same lit, lobed seal as the
masthead — composited per platform. Treat these PNGs as _build output_.

The seal's exact parameters live in **`src/lib/icon-seal.json`** (the single
source of truth): the `seed` (WaxStamp `playKey`, which fixes the lobe
silhouette — 5, 6, or 7 lobes, deterministic per seed), the navy `tint`, `puck`,
the glyph, and per-variant `fill` (how close the lobes crowd the frame) and
optical `cx`/`cy`. `src/lib/seal-spec.ts` types + reads it.

> The icon seal is intentionally a deeper **navy** than the in-app wordmark seal
> and the `--wax` accent (those are theme-tuned against the desk and stay
> `#2e5685`); the home-screen icon runs darker for contrast on the OS grid.

## Tuning + baking

**`/lab/icon-studio`** (run `pnpm dev`, open the route) is the tuner: scrub the
`seed` to the five-lobe you want (it labels the lobe count), set the navy tint +
`puck`, then per platform dial `fill` and the optical centre against live
previews — favicon on light/dark tabs, apple on cream, maskable with its safe
zone drawn. **Bake to disk** writes the PNGs and saves the spec back to
`icon-seal.json`.

**`pnpm icons`** reproduces the exact same icons headless (renders the seal via
`/lab/icon-bake`, composites with `sharp`) — for CI or a clean rebuild. Needs a
browser once: `pnpm exec playwright install chromium`.

Either path guarantees the icons match the seal and each other — change the seal
in one place, re-bake, done. Never hand-edit a PNG here.

## The shipped files

| File | Look | Notes |
| --- | --- | --- |
| `src/app/icon.png` | transparent | browser favicon / tab (512) |
| `public/icons/icon-192.png` · `icon-512.png` | transparent | PWA manifest |
| `src/app/apple-icon.png` | seal on cream `#f6f0e2` (iOS rounds corners) | a little paper so the drop shadow reads |
| `public/icons/maskable-512.png` | seal on cream | inside the maskable safe zone (adaptive circular crop) |

Manifest wiring: `src/app/manifest.ts`. `icon.png` / `apple-icon.png` are picked
up by Next's file-based metadata from `src/app/`.

_The launch-screen splash seals (`public/splash/`, `pnpm splash`) are a separate,
flat mark — see `scripts/generate-splash.mjs`. History: `f44d6d2` first baked the
icons from the live seal; `48a9def` optically centred them._
