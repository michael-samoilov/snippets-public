#!/usr/bin/env python3
"""Frame-budget / main-thread-jank guard for the 60fps target.

60fps means the main thread must yield every 16.7ms. What a headless-Blink
harness can honestly measure is MAIN-THREAD BLOCKING: a long synchronous
task (layout, a big loop, a sync IndexedDB read) stalls frames on any
engine, so catching it here is a portable regression guard. What it CANNOT
certify is the real 60fps verdict on an iPhone — GPU/compositor cost is
WebKit-specific and Blink hides it (see measure-webkit-spans.py and the
FLAT-BOOK LAW), and WebKitGTK under Xvfb is software-rendered with no idle
rAF. So: this lane fails on main-thread jank regressions; the true 60fps
sign-off is the WebKitGTK marks plus the on-device pass.

It records long tasks (PerformanceObserver 'longtask') and inter-frame
gaps (rAF deltas) while driving the reader's real interactions — rise,
dive, scroll, and a keystroke into the composer — then reports the worst
frame, dropped-frame count, and total blocking time.

    python3 .claude/skills/verify-snippets/scripts/cdp_frames.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from personas import ios_pwa_page
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/cdp-frames"
BUDGET_MS = 16.7                      # one frame at 60fps
JANK_MS = float(os.environ.get("JANK_MS", "100"))  # a long task this size fails

_INSTRUMENT = """
  window.__frames = [];
  window.__longtasks = [];
  let last = performance.now();
  function tick(now) { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}
"""
TAP = """(sel) => { const el=document.querySelector(sel); if(!el) return false;
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.click(); return true; }"""
PICK_DAY = """() => { const b=document.querySelector('[data-layer="month"] button[data-day-key]:not([disabled])');
  return b ? b.getAttribute('data-day-key') : null; }"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = ios_pwa_page(browser)
        page.add_init_script(_INSTRUMENT)
        page.goto(f"{BASE}/calendar?seed=400&years=5", wait_until="load")
        page.wait_for_timeout(8000)
        page.evaluate("window.__frames = []; window.__longtasks = [];")  # drop load-time noise

        # the reader's interactions, the ones a paint regression would hit
        for _ in range(6):
            page.evaluate(TAP, "[data-cal-title]"); page.wait_for_timeout(500)   # rise
            day = page.evaluate(PICK_DAY)
            if day:
                page.evaluate(TAP, f'[data-layer="month"] button[data-day-key="{day}"]')
            page.wait_for_timeout(500)                                            # dive
            page.evaluate("() => {const s=document.querySelector('[data-book-scroller]'); if(s) s.scrollTop=Math.random()*40000;}")
            page.wait_for_timeout(300)
        ta = 'textarea[aria-label^="Write an entry for"]'
        if page.query_selector(ta):
            page.evaluate(TAP, ta)
            for ch in "the light through the kitchen window":
                page.keyboard.type(ch, delay=12)

        frames = page.evaluate("window.__frames") or []
        longtasks = page.evaluate("window.__longtasks") or []
        over = [round(f, 1) for f in frames if f > BUDGET_MS]
        report = {
            "frames_sampled": len(frames),
            "worst_frame_ms": round(max(frames), 1) if frames else None,
            "dropped_frames_over_16_7ms": len(over),
            "dropped_frame_pct": round(100 * len(over) / len(frames), 1) if frames else None,
            "long_tasks": sorted(longtasks, reverse=True)[:8],
            "total_blocking_ms": sum(max(0, t - 50) for t in longtasks),
            "worst_long_task_ms": max(longtasks) if longtasks else 0,
        }
        # portable jank gate: a single main-thread block past JANK_MS is a
        # real regression on any engine. Dropped-frame % is reported, not
        # gated (Blink absolute timing is not the iOS truth).
        jank = report["worst_long_task_ms"] > JANK_MS
        report["verdict"] = f"main-thread block {report['worst_long_task_ms']}ms > {JANK_MS}ms" if jank else "no main-thread jank over budget"
        report["_note"] = ("dropped_frame_pct is unreliable on headless Blink (no vsync) — "
                           "informational only. The long-task metrics are the real gate. "
                           "True 60fps is the WebKitGTK marks + the on-device pass.")
        (open(f"{OUT}/report.json", "w")).write(json.dumps(report, indent=2))
        browser.close()
        print(json.dumps(report, indent=2))
        print("PASS —", report["verdict"]) if not jank else print("FAIL —", report["verdict"])
        return 1 if jank else 0


if __name__ == "__main__":
    sys.exit(main())
