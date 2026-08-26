#!/usr/bin/env python3
"""Memory-leak regression guard via the Chrome DevTools Protocol.

Why this and not a CPU trace: for THIS app the dominant performance risk
is iOS memory pressure (the FLAT-BOOK jetsam class), and Chromium CPU/paint
traces mislead about it — the costs are WebKit-compositor-specific and Blink
hides them (see scripts/measure-webkit-spans.py, and the FLAT-BOOK LAW in
globals.css). What DOES port across engines is a JS leak: detached DOM
nodes, and growing listener/timer sets (this app carries ~17 guard flags
and ~20 timers, see SCHEDULE-MAP.md). This lane stresses the book with many
rise/dive/scroll cycles and watches CDP Performance.getMetrics — Nodes,
JSEventListeners, JSHeapUsedSize — for unbounded growth after warmup.

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

TAP = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.click();
  return true;
}"""
PICK_DAY = """() => {
  const b = document.querySelector('[data-layer="month"] button[data-day-key]:not([disabled])');
  return b ? b.getAttribute('data-day-key') : null;
}"""


def metrics(cdp):
    m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
    return {"Nodes": m.get("Nodes"), "JSEventListeners": m.get("JSEventListeners"),
            "JSHeapUsedMB": round(m.get("JSHeapUsedSize", 0) / 1e6, 1),
            "Documents": m.get("Documents")}


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
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
                page.evaluate(TAP, "[data-cal-title]"); page.wait_for_timeout(600)
                day = page.evaluate(PICK_DAY)
            if day:
                page.evaluate(TAP, f'[data-layer="month"] button[data-day-key="{day}"]')
                page.wait_for_timeout(700)                                  # dive
            page.evaluate("() => {const s=document.querySelector('[data-book-scroller]'); if(s){s.scrollTop=Math.random()*40000;}}")
            page.wait_for_timeout(300)
            page.evaluate(TAP, "[data-cal-title]"); page.wait_for_timeout(700)  # rise -> book view
            return metrics(cdp)

        stress_then_measure()          # warm-up: first mount caches, discard
        series = [stress_then_measure() for _ in range(CYCLES)]

        first, last = series[0], series[-1]
        report = {
            "cycles": CYCLES,
            "first_sample": first,
            "last_sample": last,
            "growth_first_to_last": {k: last[k] - first[k]
                                     for k in ("Nodes", "JSEventListeners", "JSHeapUsedMB")},
            "per_cycle": {
                "nodes": round((last["Nodes"] - first["Nodes"]) / CYCLES, 1),
                "listeners": round((last["JSEventListeners"] - first["JSEventListeners"]) / CYCLES, 2),
            },
            "series_listeners": [s["JSEventListeners"] for s in series],
            "series_nodes": [s["Nodes"] for s in series],
        }
        # a real leak climbs listeners or nodes ~monotonically per cycle;
        # small noise is fine. Thresholds are per-cycle, at the same view.
        leak = report["per_cycle"]["listeners"] > 2 or report["per_cycle"]["nodes"] > 150
        report["verdict"] = "LEAK SUSPECTED" if leak else "no unbounded growth"
        (open(f"{OUT}/report.json", "w")).write(json.dumps(report, indent=2))
        page.screenshot(path=f"{OUT}/after.png")
        browser.close()
        print(json.dumps(report, indent=2))
        print("PASS —", report["verdict"]) if not leak else print("FAIL —", report["verdict"])
        return 0 if not leak else 1


if __name__ == "__main__":
    sys.exit(main())
