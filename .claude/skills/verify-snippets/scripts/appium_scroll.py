#!/usr/bin/env python3
"""Drive real Mobile Safari through Appium and check the app's scroll
logic under a genuine iOS touch fling. Runs against a device farm or the
local iOS Simulator (set APPIUM_URL). See ../SKILL.md, Lane B.

NOT runnable from the Linux sandbox — there is no iOS here; that is the
whole reason this lane exists. First run is on the owner's device/farm.
Written against the Appium W3C protocol and the app's real selectors
([data-book-scroller], [data-day][data-warm]); adjust device caps and
settle timings to your target.

    pip install Appium-Python-Client==4.*
    APPIUM_URL=...  APP_URL=https://<deploy>/calendar \\
      DEVICE='iPhone 15'  IOS='17.5' \\
      python3 appium_scroll.py
"""
import json
import os
import sys
import time

try:
    from appium import webdriver
    from appium.options.ios import XCUITestOptions
    from selenium.webdriver.common.actions.pointer_input import PointerInput
    from selenium.webdriver.common.actions.action_builder import ActionBuilder
    from selenium.webdriver.common.actions import interaction
except ImportError:
    sys.exit("pip install Appium-Python-Client==4.*  (this runs on the owner's device/farm, not the sandbox)")

APPIUM_URL = os.environ.get("APPIUM_URL")  # farm hub URL (with creds) or http://127.0.0.1:4723
APP_URL = os.environ.get("APP_URL", "http://localhost:3000/calendar")
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/device"
if not APPIUM_URL:
    sys.exit("set APPIUM_URL to a device-farm hub or a local Appium server (see SKILL.md, Lane B)")
os.makedirs(OUT, exist_ok=True)

opts = XCUITestOptions()
opts.browser_name = "Safari"
opts.platform_version = os.environ.get("IOS", "17.5")
opts.device_name = os.environ.get("DEVICE", "iPhone 15")
# a device farm reads its own extra caps from env/config; add them here if needed.

driver = webdriver.Remote(APPIUM_URL, options=opts)
report = {}
try:
    driver.get(f"{APP_URL}?seed=1200&years=5")
    time.sleep(12)  # seed a deep book; tune to the device

    def warm():
        return driver.execute_script(
            "return [].slice.call(document.querySelectorAll('[data-day][data-warm]'))"
            ".map(function(e){return e.getAttribute('data-day');}).slice(0,3).join(',');")

    def scrolltop():
        return driver.execute_script(
            "var s=document.querySelector('[data-book-scroller]');return s?s.scrollTop:null;")

    driver.execute_script("var s=document.querySelector('[data-book-scroller]');if(s)s.scrollTop=0;")
    time.sleep(1)
    before = {"warm": warm(), "top": scrolltop()}

    # a real iOS touch fling: fast pointer drag up, released mid-motion so
    # momentum carries. On real iOS this produces genuine UIScrollView inertia.
    size = driver.get_window_size()
    cx = size["width"] // 2
    finger = PointerInput(interaction.POINTER_TOUCH, "finger")
    a = ActionBuilder(driver, mouse=finger)
    a.pointer_action.move_to_location(cx, int(size["height"] * 0.8))
    a.pointer_action.pointer_down()
    a.pointer_action.move_to_location(cx, int(size["height"] * 0.2))
    a.pointer_action.pointer_up()
    a.perform()

    time.sleep(0.1)
    top_at_release = scrolltop()
    time.sleep(1.5)  # momentum window
    after = {"warm": warm(), "top": scrolltop()}

    report = {
        "before": before,
        "top_at_release": top_at_release,
        "after_settle": after,
        "momentum_after_release_px": (after["top"] or 0) - (top_at_release or 0),
        "warm_followed": after["warm"] != before["warm"],
        "device": f'{opts.device_name} iOS {opts.platform_version}',
    }
    driver.get_screenshot_as_file(f"{OUT}/after-fling.png")
    (open(f"{OUT}/report.json", "w")).write(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    ok = report["warm_followed"] and report["momentum_after_release_px"] > 0
    print("PASS: fling scrolled with momentum and the warm window followed" if ok
          else "CHECK: momentum/warm not observed — tune timings, confirm device is real iOS")
finally:
    driver.quit()
