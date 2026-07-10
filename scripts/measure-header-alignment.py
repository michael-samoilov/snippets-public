"""Measure — FROM RENDERED SCREENSHOTS, not element geometry — that the back
chevron and header hairline of the sub-pages (Settings, Privacy) sit at the
exact pixel position of the calendar's schedule-view month header, so nothing
jitters when navigating between them.

Why raster and not getBoundingClientRect: the chevron is an inline SVG whose
painted position depends on baseline alignment rules that differ by layout
context (inline flow vs flex) — the box can measure "equal" while the ink
paints a pixel or two apart. The screenshot is the truth the eye sees.

Method: screenshot each page at 390×844, device_scale_factor=3 (⅓-CSS-px
resolution). In the header band, ink pixels (luminance < 170 against the
paper) form two clusters: the chevron, then — past the mr-1.5 gap — the
title. The chevron is the SAME glyph on every page, so its ink bounding box
must be identical. The hairline is found as the darkest row band below the
title. Prints every box and the deltas; exits non-zero past ±1 device px
(⅓ CSS px). Annotated crops land in scripts/.header-align/ (gitignored).

Run against a running production build (port 3000):
  pkill -9 -f "next[-]server"
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 \
    -- python3 scripts/measure-header-alignment.py
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), ".header-align")
os.makedirs(OUT, exist_ok=True)
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
DSF = 3  # device pixels per CSS px
TOL = 1  # allowed delta, device px

STUB = (
    "window.SpeechRecognition=window.SpeechRecognition||function(){this.start=()=>{};"
    "this.stop=()=>{};this.abort=()=>{};this.addEventListener=()=>{};};"
    "window.webkitSpeechRecognition=window.webkitSpeechRecognition||window.SpeechRecognition;"
)

PAGES = [
    ("calendar", "http://localhost:3000/calendar", 2600),
    ("settings", "http://localhost:3000/settings", 2600),
    ("privacy", "http://localhost:3000/privacy", 2600),
]

# the header band, CSS px: chevron+title live around y 80..110, x 20..200;
# the hairline lands around y 125..135. One generous crop covers both.
BAND = (0, 60, 240, 150)  # x0, y0, x1, y1


def ink_mask(arr: np.ndarray) -> np.ndarray:
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    return lum < 170


def chevron_box(mask: np.ndarray):
    """Bounding box of the first ink cluster from the left (the chevron),
    separated from the title cluster by the mr-1.5 gap (≥3 CSS px clear)."""
    cols = mask.any(axis=0)
    xs = np.flatnonzero(cols)
    if xs.size == 0:
        return None
    gap = 2 * DSF  # a clear run ≥ 2 CSS px ends the chevron cluster
    start = xs[0]
    end = start
    run = 0
    for x in range(start, mask.shape[1]):
        if cols[x]:
            end = x
            run = 0
        else:
            run += 1
            if run >= gap:
                break
    sub = mask[:, start : end + 1]
    ys = np.flatnonzero(sub.any(axis=1))
    return (int(start), int(ys[0]), int(end), int(ys[-1]))


def hairline_y(arr: np.ndarray, below: int) -> int | None:
    """The first row below `below` distinctly darker than the paper across
    most of the band — the header's bottom rule. The rule is FAINT (far
    lighter than ink), so it's found against the local paper level, not the
    ink threshold."""
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    rows = lum[below:]
    paper = float(np.median(rows))
    for y in range(rows.shape[0]):
        row = rows[y]
        if float(np.median(row)) < paper - 4 and (row < paper - 2).mean() > 0.9:
            return below + y
    return None


def main() -> int:
    results = {}
    with sync_playwright() as p:
        b = p.chromium.launch(
            executable_path=CHROME,
            args=["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist",
                  "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
        )
        c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=DSF)
        for name, url, wait in PAGES:
            pg = c.new_page()
            pg.add_init_script(STUB)
            pg.add_init_script("try{localStorage.setItem('theme','light')}catch(e){}")
            pg.goto(url, wait_until="networkidle")
            pg.wait_for_timeout(wait)  # page-settle must finish (see skeleton harness)
            path = os.path.join(OUT, f"{name}.png")
            pg.screenshot(path=path)
            pg.close()

            img = Image.open(path).convert("RGB")
            crop = img.crop(tuple(v * DSF for v in BAND))
            arr = np.asarray(crop, dtype=np.float32)
            mask = ink_mask(arr)
            # ignore the hairline region for the chevron pass
            chev = chevron_box(mask[: 55 * DSF])
            hair = hairline_y(arr, 55 * DSF)
            results[name] = {"chevron": chev, "hairline": hair}

            note = crop.copy()
            d = ImageDraw.Draw(note)
            if chev:
                d.rectangle(chev[:2] + chev[2:], outline=(220, 40, 40), width=1)
            if hair is not None:
                d.line([(0, hair), (note.width, hair)], fill=(30, 90, 220), width=1)
            note.save(os.path.join(OUT, f"{name}-annotated.png"))
        b.close()

    print(f"device px = 1/{DSF} CSS px; band origin ({BAND[0]},{BAND[1]}) CSS")
    for name, r in results.items():
        print(f"{name:9s} chevron box {r['chevron']}  hairline row {r['hairline']}")

    ok = True
    ref = results["calendar"]
    if ref["chevron"] is None or ref["hairline"] is None:
        print("FAIL calendar reference not found in raster")
        return 1
    for name in ("settings", "privacy"):
        r = results[name]
        if r["chevron"] is None or r["hairline"] is None:
            ok = False
            print(f"FAIL {name} chevron/hairline not found in raster")
            continue
        for i, edge in enumerate(("left", "top", "right", "bottom")):
            dv = r["chevron"][i] - ref["chevron"][i]
            if abs(dv) > TOL:
                ok = False
                print(f"FAIL {name} chevron {edge} off by {dv} device px ({dv/DSF:+.2f} CSS px)")
        dh = r["hairline"] - ref["hairline"]
        if abs(dh) > TOL:
            ok = False
            print(f"FAIL {name} hairline off by {dh} device px ({dh/DSF:+.2f} CSS px)")

    print("HEADERS ALIGNED (raster)" if ok else "HEADERS MISALIGNED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
