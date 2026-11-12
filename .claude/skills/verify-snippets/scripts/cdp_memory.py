#!/usr/bin/env python3
"""Memory-leak regression guard via the Chrome DevTools Protocol.

Why this and not a CPU trace: for THIS app the dominant performance risk
is iOS memory pressure (the FLAT-BOOK jetsam class), and Chromium CPU/paint
traces mislead about it — the costs are WebKit-compositor-specific and Blink
hides them (see scripts/measure-webkit-spans.py, and the FLAT-BOOK LAW in
globals.css). What DOES port across engines is a JS leak: detached DOM
nodes, and growing listener/timer sets (this app carries ~17 guard flags
and ~20 timers, see docs/schedule-map.md). This lane stresses the book
with many rise/dive/scroll cycles and watches CDP Performance.getMetrics —
Nodes, JSEventListeners, JSHeapUsedSize — for unbounded growth after warmup.

A leak here would also leak on iOS, so a Blink-engine check is legitimate.
Run under with_server.py (see SKILL.md, Launch), or against a live :3000.

    python3 .claude/skills/verify-snippets/scripts/cdp_memory.py [cycles]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from personas import ios_pwa_page
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/cdp-memory"
CYCLES = int(sys.argv[1]) if len(sys.argv) > 1 else 20

PICK_DAY = """() => {
  const b = document.querySelector('[data-layer="month"] button[data-day-key]:not([disabled])');
  return b ? b.getAttribute('data-day-key') : null;
}"""


def tap(page, sel):
    # ONE trusted activation (see cdp_frames.py): a synthetic pointerup plus
    # el.click() double-activates and can navigate the run to about:blank.
    try:
        page.click(sel, timeout=2500)
        return True
    except Exception:
        return False


def metrics(cdp):
    m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
    return {"Nodes": m.get("Nodes"), "JSEventListeners": m.get("JSEventListeners"),
            "JSHeapUsedMB": round(m.get("JSHeapUsedSize", 0) / 1e6, 1),
            "Documents": m.get("Documents")}


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        # --expose-gc so window.gc() is real; without it transient allocations
        # that GC would reclaim read as a per-cycle leak (a false positive an
        # eval caught, 2026-08). Force GC before every measurement below.
        browser = p.chromium.launch(args=["--js-flags=--expose-gc"])
        page = ios_pwa_page(browser)
        cdp = page.context.new_cdp_session(page)
        cdp.send("Performance.enable")
        page.goto(f"{BASE}/calendar?seed=400&years=5", wait_until="load")
        page.wait_for_timeout(8000)

        # One cycle = stress (dive + scroll) then RETURN to the book view and
        # measure there, so every sample is the same view state — a per-cycle
        # climb across those samples is the leak signal, immune to whichever
        # view the loop happens to pause on.
        def stress_then_measure():
            day = page.evaluate(PICK_DAY)
            if not day:  # already in book view; rise to month to pick a day
                tap(page, "[data-cal-title]"); page.wait_for_timeout(600)
                day = page.evaluate(PICK_DAY)
            if day:
                tap(page, f'[data-layer="month"] button[data-day-key="{day}"]')
                page.wait_for_timeout(700)                                  # dive
            page.evaluate("() => {const s=document.querySelector('[data-book-scroller]'); if(s){s.scrollTop=Math.random()*40000;}}")
            page.wait_for_timeout(300)
            tap(page, "[data-cal-title]"); page.wait_for_timeout(700)       # rise -> book view
            page.evaluate("() => { if (window.gc) { window.gc(); window.gc(); } }")
            page.wait_for_timeout(200)                                       # let GC settle before measuring
            return metrics(cdp)

        stress_then_measure()          # warm-up: first mount caches, discard
        series = [stress_then_measure() for _ in range(CYCLES)]

        # self-check: refuse a run that navigated off /calendar (the false-clean
        # bug an eval caught, 2026-08).
        if "/calendar" not in page.url or not page.evaluate("!!document.querySelector('[data-book-scroller]')"):
            print(json.dumps({"verdict": "INCONCLUSIVE — navigated off /calendar mid-run", "url": page.url}))
            browser.close()
            return 2

        # Verdict from the FLOOR of the POST-WARMUP plateau. A real leak raises
        # the baseline floor every cycle; transient mid-dive allocations spike a
        # single sample and revert. Two false-positive traps an eval caught
        # (2026-08): (1) first-vs-last endpoints fire when the last sample lands
        # on a spike; (2) the first cycles are a cold warmup (caches filling),
        # so a floor over the whole series compares the cold low against the
        # saturated plateau and reads the ramp as a leak. So discard the warmup
        # third, then compare the floor of the plateau's first half to its last.
        def floor(key, s):
            return min(x[key] for x in s)

        keys = ("Nodes", "JSEventListeners", "JSHeapUsedMB")
        warm = max(2, CYCLES // 3)
        plateau = series[warm:] or series
        n = max(1, len(plateau))
        half = max(1, n // 2)
        first_floor = {k: floor(k, plateau[:half]) for k in keys}
        last_floor = {k: floor(k, plateau[half:]) for k in keys}
        report = {
            "cycles": CYCLES,
            "warmup_discarded": warm,
            "floor_plateau_first_half": first_floor,
            "floor_plateau_last_half": last_floor,
            "per_cycle_floor_growth": {
                "nodes": round((last_floor["Nodes"] - first_floor["Nodes"]) / n, 2),
                "listeners": round((last_floor["JSEventListeners"] - first_floor["JSEventListeners"]) / n, 2),
            },
            "series_listeners": [s["JSEventListeners"] for s in series],
            "series_nodes": [s["Nodes"] for s in series],
        }
        pc = report["per_cycle_floor_growth"]
        leak = pc["listeners"] > 1 or pc["nodes"] > 100
        report["verdict"] = "LEAK SUSPECTED" if leak else "no unbounded growth"
        (open(f"{OUT}/report.json", "w")).write(json.dumps(report, indent=2))
        page.screenshot(path=f"{OUT}/after.png")
        browser.close()
        print(json.dumps(report, indent=2))
        print("PASS —", report["verdict"]) if not leak else print("FAIL —", report["verdict"])
        return 0 if not leak else 1


if __name__ == "__main__":
    sys.exit(main())
