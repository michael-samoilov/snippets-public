"""Measure the press glow's light envelope against the iOS Liquid Glass
reference (frame analysis of a native accessory-bar tap, 30fps screen
recording, 2026-07): the light swells to peak over ~100-200ms and leaves on
a long, near-linear ~300-400ms tail. The failure mode this guards against
is a shared snappy ease-out, which front-loads ~80% of BOTH edges into the
first ~60ms — the light flashes on and cuts off.

Run against a production build:

  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 scripts/measure-glow-onset.py
"""

from playwright.sync_api import sync_playwright

# normalized iOS reference, 33ms steps (rise from tap, decay from peak)
IOS_RISE = [0.0, 0.62, 0.89, 0.98, 1.0]
IOS_TAIL = [1.0, 0.84, 0.70, 0.52, 0.42, 0.32, 0.19, 0.16, 0.08]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 700})
    page.add_init_script(
        "window.SpeechRecognition = window.webkitSpeechRecognition = function(){ this.start=()=>{}; this.stop=()=>{}; this.abort=()=>{}; };"
    )
    page.on("pageerror", lambda e: print("pageerror:", str(e)[:120]))
    page.goto("http://localhost:3000/calendar", wait_until="networkidle")
    page.wait_for_timeout(1800)

    # the intro letter suppresses the zone's glow on an empty book — seed
    ta = page.locator("textarea[data-room-center]").first
    ta.click()
    ta.type("glow envelope measurement", delay=2)
    page.keyboard.press("Meta+Enter")
    page.wait_for_timeout(4600)

    # whole timeline in-page for clean clocks: press, sample the computed
    # opacity every rAF for 450ms, release, sample 650ms more
    result = page.evaluate(
        """() => new Promise((resolve) => {
      const zone = document.querySelector('[data-today-zone-box]');
      const glow = zone.querySelector(':scope > [aria-hidden]').firstElementChild;
      const r = zone.getBoundingClientRect();
      const opts = {bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerId: 7};
      const rise = [], tail = [];
      const t0 = performance.now();
      zone.dispatchEvent(new PointerEvent('pointerdown', opts));
      const sampleRise = () => {
        rise.push([Math.round(performance.now() - t0), +getComputedStyle(glow).opacity]);
        if (performance.now() - t0 < 450) requestAnimationFrame(sampleRise);
        else {
          const t1 = performance.now();
          zone.dispatchEvent(new PointerEvent('pointerup', opts));
          const sampleTail = () => {
            tail.push([Math.round(performance.now() - t1), +getComputedStyle(glow).opacity]);
            if (performance.now() - t1 < 650) requestAnimationFrame(sampleTail);
            else resolve({rise, tail});
          };
          requestAnimationFrame(sampleTail);
        }
      };
      requestAnimationFrame(sampleRise);
    })"""
    )
    browser.close()


def at(series, ms):
    return min(series, key=lambda s: abs(s[0] - ms))[1]


rise, tail = result["rise"], result["tail"]
print("measured rise (ms, opacity):", [(t, round(o, 2)) for t, o in rise[::3]])
print("measured tail (ms, opacity):", [(t, round(o, 2)) for t, o in tail[::3]])
print("iOS reference rise @33ms steps:", IOS_RISE)
print("iOS reference tail @33ms steps:", IOS_TAIL)

checks = [
    # the swell: a soft start (near-zero is fine — the 120ms check catches a
    # dead glow), never the old flash-on, complete by ~300ms
    ("rise@60ms <= 0.65 (no flash-on)", at(rise, 60) <= 0.65),
    ("rise@120ms in 0.40..0.95", 0.40 <= at(rise, 120) <= 0.95),
    ("rise@300ms >= 0.95 (fully lit)", at(rise, 300) >= 0.95),
    # the tail: long and gradual, gone by ~550ms
    ("tail@120ms >= 0.45 (no cut-off)", at(tail, 120) >= 0.45),
    ("tail@250ms in 0.15..0.75 (gradual)", 0.15 <= at(tail, 250) <= 0.75),
    ("tail@550ms <= 0.08 (fully out)", at(tail, 550) <= 0.08),
]
failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(1 if failed else 0)
