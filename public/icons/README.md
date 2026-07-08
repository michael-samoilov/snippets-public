# App icons — source of truth

**The logo is the live 3-D wax seal, not a file in this folder.** Every shipped
icon is a high-res render of the `WaxStamp` component
(`src/components/capture/wax-stamp.tsx`) — the same lit, lobed seal as the
masthead wordmark. Treat these PNGs as _build output_, and re-bake them from the
seal whenever the seal changes.

There is **no `pnpm icons` command**, on purpose. A flat SVG generator used to
live here and wrote to these exact paths, so running it silently replaced the
crafted 3-D icons with a pale flat stand-in. It's gone. `pnpm splash` only
touches `public/splash/` (the iOS launch screens) and never these files.

## The shipped files

| File | Look | Seal size |
| --- | --- | --- |
| `src/app/icon.png` | transparent (browser favicon / tab) | 94% of frame |
| `public/icons/icon-192.png` | transparent (PWA manifest) | 94% |
| `public/icons/icon-512.png` | transparent (PWA manifest) | 94% |
| `src/app/apple-icon.png` | seal on cream `#f6f0e2` (iOS rounds the corners) | 88% (paper margin so the drop shadow reads) |
| `public/icons/maskable-512.png` | seal on cream, inside the maskable safe zone | 80% (an adaptive circular crop must never clip the wax) |

Manifest wiring: `src/app/manifest.ts`. `icon.png` / `apple-icon.png` are picked
up by Next's file-based metadata from `src/app/`.

## How to re-bake (the real process)

1. **Render the seal at HD.** Mount `WaxStamp` at a large size (the last bake used
   **3840px**) in its settled state — `mode="press"`, `still`, `restGlyph`,
   `superSample` up — with the shipped tint (deep-blue wax `#2e5685`, cream `S`
   `#eae1cd`). Capture the canvas to a transparent PNG master. The `/lab/stamp`
   route renders this seal and is the place to eyeball tint/lighting.
2. **Optically centre it.** The wax is a lobed, asymmetric shape whose mass sits
   left of its bounding-box centre, so a bbox-centred disc reads shifted left.
   Re-centre on a **blend of the bbox centre and the mass centroid** (weighted so
   it doesn't over-correct toward the rim), then trim to a square.
3. **Composite each variant** from that one master at the sizes in the table
   (transparent for the manifest/favicon; on cream `#f6f0e2` for apple-icon and
   maskable, with the safe-zone margins above).

Keep the tint colour-matched between the wordmark seal, these icons, and the
splash seal (`scripts/generate-splash.mjs`) so the identity is one blue
everywhere.

_History: `f44d6d2` (re-bake from the live seal at 3840px) and `48a9def`
(optical centring) are the reference commits._
