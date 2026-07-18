"""
AUTOMATED proxy for the calendar→schedule dive's input delay — the part no
other harness could see. On the device the dive's first frame (HUD `pt`) is
65-200ms while every other transition's is ~14ms, and it SCALES WITH THE
DESTINATION PAGE'S CONTENT DENSITY (owner device trials 2026-07-17: ~110 sparse,
~150+ dense; removing the book's camera scale made it WORSE by showing MORE
cards). The cost is rasterizing the destination schedule cards.

WebKitGTK+Xvfb can't price paint (no real compositor; the app's rf-a reads ~4ms
regardless). Chromium CAN, via CDP RasterTask. WebKit rasters the destination on
the pt frame and Chromium at the join frame, but the TOTAL card raster is the
same and scales with density either way — so this is a headless metric a FIX can
be iterated against: cut the dense-day raster here and the device pt should
fall too.

Reports median RasterTask (ms) across N dives into the DENSEST visible day vs
the SPARSEST, on a deep multi-year book. A real fix drops the dense number.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-dive-raster.py
"""
import os
import statistics
import sys

from playwright.sync_api import sync_playwright

CATS = ",".join(
    ["disabled-by-default-devtools.timeline", "devtools.timeline", "blink.user_timing"]
)
SEED = int(os.environ.get("SNIPPETS_SEED", "1500"))
YEARS = int(os.environ.get("SNIPPETS_YEARS", "6"))
TRIALS = int(os.environ.get("DIVE_RASTER_TRIALS", "4"))
# OPEN=bare selects the bare-land dive variant (?open=bare) so a fix can be A/B'd
# against base without touching the code. "" (default) = base.
OPEN = os.environ.get("DIVE_OPEN", "")


def rise(pg):
    pg.evaluate(
        """()=>new Promise(res=>{const el=document.querySelector('[data-cal-title]');const r=el.getBoundingClientRect();
      const ev=t=>new PointerEvent(t,{bubbles:true,pointerId:5,pointerType:'touch',isPrimary:true,clientX:r.left+8,clientY:r.top+8});
      el.dispatchEvent(ev('pointerdown'));setTimeout(()=>{el.dispatchEvent(ev('pointerup'));setTimeout(res,1500)},120)})"""
    )


def dive_raster(pg, cdp, sel):
    coll = []
    cdp.on("Tracing.dataCollected", lambda p: coll.extend(p.get("value", [])))
    cdp.send("Tracing.start", {"categories": CATS, "transferMode": "ReportEvents"})
    pg.evaluate(
        f"""()=>new Promise(res=>{{const el=document.querySelector('{sel}');const r=el.getBoundingClientRect();
      const ev=t=>new PointerEvent(t,{{bubbles:true,pointerId:6,pointerType:'touch',isPrimary:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}});
      el.dispatchEvent(ev('pointerdown'));setTimeout(()=>el.dispatchEvent(ev('pointerup')),120);setTimeout(res,700)}})"""
    )
    cdp.send("Tracing.end")
    pg.wait_for_timeout(400)
    ev = [e for e in coll if "ts" in e and "dur" in e]
    tmax = max((e["ts"] for e in ev), default=0)
    lo = tmax - 750_000
    raster = (
        sum(e.get("dur",0) for e in coll if e.get("name") == "RasterTask" and e.get("ts", 0) >= lo)
        / 1000
    )
    rise(pg)
    return round(raster, 1)


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3)
        pg = ctx.new_page()
        cdp = ctx.new_cdp_session(pg)
        openq = f"&open={OPEN}" if OPEN else ""
        pg.goto(f"http://localhost:3000/calendar?seed={SEED}&years={YEARS}&perf=1", wait_until="load")
        pg.wait_for_timeout(5000)
        pg.goto(f"http://localhost:3000/calendar?perf=1{openq}", wait_until="load")
        pg.wait_for_timeout(5000)
        rise(pg)
        days = pg.evaluate(
            """()=>{const st=document.querySelector('[data-layer=month]').getBoundingClientRect();
          const all=[...document.querySelectorAll('[data-layer=month] button[data-day-key]:not([disabled])')]
            .map(b=>({k:b.getAttribute('data-day-key'),dots:b.querySelectorAll('[class*=rounded-full]').length,r:b.getBoundingClientRect()}))
            .filter(x=>x.r.top>st.top+60&&x.r.bottom<st.bottom-60&&x.r.height>0);
          all.sort((a,b)=>b.dots-a.dots);
          return {dense:all[0], sparse:all[all.length-1]};}"""
        )
        results = {}
        for label, d in [("dense", days["dense"]), ("sparse", days["sparse"])]:
            sel = f'[data-layer=month] button[data-day-key="{d["k"]}"]'
            rs = [dive_raster(pg, cdp, sel) for _ in range(TRIALS)]
            med = statistics.median(rs)
            results[label] = med
            print(f"  {label:6} {d['k']} (dots={d['dots']}): raster {rs}  median={med}ms")
        b.close()
    print(f"\n  DIVE DESTINATION RASTER [{OPEN or 'base'}] — dense {results['dense']}ms / sparse {results['sparse']}ms")
    print("  (a fix must drop the dense number; this is the device-pt proxy)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
