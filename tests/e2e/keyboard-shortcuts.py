# Keyboard-shortcut end-to-end checks. Seeds ~8 months of fake history into
# IndexedDB, then drives every shortcut and asserts the outcome (altitude via
# the URL, focus via activeElement, filing via the DB count).
#
#   pnpm build && python3 .claude/skills/webapp-testing/scripts/with_server.py \
#     --server "node_modules/.bin/next start" --port 3000 -- python3 tests/e2e/keyboard-shortcuts.py
#
import time
from playwright.sync_api import sync_playwright

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
BASE = "http://localhost:3000/calendar"

SEED = """
async () => {
  const open = indexedDB.open('snippets');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const names = Array.from(db.objectStoreNames);
  if (!names.includes('snippets')) { db.close(); return 'no-store'; }
  const tx = db.transaction('snippets', 'readwrite');
  const st = tx.objectStore('snippets');
  const p2 = (n) => String(n).padStart(2, '0');
  const day = (off) => { const d = new Date(); d.setDate(d.getDate() - off);
    return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; };
  // history across ~8 months: entries on many days, incl. today (0) & yesterday (1)
  for (let off = 0; off <= 240; off += 3) {
    const n = 1 + (off % 3);
    for (let k = 0; k < n; k++) {
      const t = Date.now() - off * 864e5 + k * 36e5;
      st.put({ id: String(t).padStart(15,'0') + k,
        text: `Seeded entry ${off}-${k}: a remembered line with a few words to it`,
        kind: null, tags: [], capturedAt: t, day: day(off), source: 'typed',
        favorite: 0, enriched: 'done', updatedAt: t, _dirty: 0 });
    }
  }
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
  return 'ok';
}
"""

PASS, FAIL = [], []
def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{'' if cond else '  <<< ' + str(extra)}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE, wait_until="networkidle"); time.sleep(1.0)
    seeded = pg.evaluate(SEED)
    print("seed:", seeded)
    pg.reload(wait_until="networkidle"); time.sleep(1.8)

    today = pg.evaluate("() => { const d=new Date(); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }")
    def altitude():
        s = pg.evaluate("() => window.location.search")
        if "e=" in s: return "entry"
        if "d=" in s: return "schedule"
        if "y=" in s: return "year"
        return "month"
    def active_day():
        return pg.evaluate("() => document.activeElement?.getAttribute('data-day-key')")
    def press(k, delay=0.35):
        pg.keyboard.press(k); time.sleep(delay)
    def type_(t): pg.keyboard.type(t)

    print(f"\ntoday={today}  start altitude={altitude()}")

    # ============ Global shortcuts (from the canvas) ============
    print("\n[ global navigation ]")
    # ensure we're at the canvas (month). Press Escape a couple times if needed.
    for _ in range(3):
        if altitude() != "month": press("Escape", 0.4)
    check("start at canvas (month)", altitude() == "month", altitude())

    # `?` opens the cheat sheet; Escape closes it
    press("?")
    sheet = pg.query_selector('[role="dialog"][aria-label="Keyboard"]')
    check("? opens the cheat sheet", sheet is not None)
    press("Escape")
    check("Esc closes the cheat sheet", pg.query_selector('[role="dialog"][aria-label="Keyboard"]') is None)

    # `t` -> today (still month altitude, on the current month)
    press("t", 0.6)
    check("t keeps/goes to canvas today", altitude() == "month")

    # `g y` -> year glance
    press("g", 0.1); press("y", 0.6)
    check("g y climbs to the year glance", altitude() == "year", altitude())
    # `g m` -> back to canvas
    press("g", 0.1); press("m", 0.6)
    check("g m drops to the canvas", altitude() == "month", altitude())

    # `/` opens search (an input gets focus)
    press("/", 0.5)
    searching = pg.evaluate("() => { const a=document.activeElement; return a && a.tagName==='INPUT'; }")
    check("/ focuses search", searching)
    press("Escape", 0.5)

    # ============ Date-grid arrow navigation ============
    print("\n[ date grid arrows ]")
    # focus the selected day (Tab reaches the single grid tab stop)
    pg.evaluate("() => { const b=document.querySelector('button[data-day-key][tabindex=\"0\"]'); if(b) b.focus(); }")
    start = active_day()
    if not start:
        # fall back: focus any day
        pg.evaluate("() => { const b=document.querySelector('button[data-day-key]'); if(b){b.tabIndex=0;b.focus();} }")
        start = active_day()
    check("a day cell is focusable", start is not None, start)
    if start:
        from datetime import date, timedelta
        def d(k): y,m,dd = map(int,k.split('-')); return date(y,m,dd)
        # anchor two weeks back so every direction stays in the (reachable) past
        press("ArrowUp"); press("ArrowUp")
        base = d(active_day())
        press("ArrowLeft"); check("ArrowLeft = -1 day", active_day() == str(base - timedelta(days=1)), active_day())
        press("ArrowRight"); press("ArrowRight")
        check("ArrowRight = +1 day", active_day() == str(base + timedelta(days=1)), active_day())
        cur = d(active_day())
        press("ArrowUp"); check("ArrowUp = -1 week", active_day() == str(cur - timedelta(days=7)), active_day())
        cur = d(active_day())
        press("ArrowDown"); check("ArrowDown = +1 week", active_day() == str(cur + timedelta(days=7)), active_day())
        press("Home"); check("Home = week start", d(active_day()).weekday() in (6, 0), active_day())  # Sun or Mon depending on weekStart
        cur = d(active_day())
        press("PageUp", 0.6); check("PageUp = -1 month", d(active_day()).month == (cur.month-2)%12+1, active_day())
        cur = d(active_day())
        press("PageDown", 0.6); check("PageDown = +1 month", d(active_day()).month == cur.month%12+1, active_day())
        # future clamp: arrowing toward today never crosses into tomorrow
        pg.evaluate(f"() => {{ const b=document.querySelector('button[data-day-key=\"{today}\"]'); if(b){{b.tabIndex=0;b.focus();}} }}")
        if active_day() == today:
            press("ArrowRight"); check("ArrowRight past today is blocked", active_day() == today, active_day())

    # ============ Dive + Escape climb ============
    print("\n[ dive & escape climb ]")
    # click a past day to dive into the book
    pg.evaluate(f"() => {{ const b=document.querySelector('button[data-day-key=\"{today}\"]') || document.querySelector('button[data-day-key]:not([disabled])'); b && b.click(); }}")
    time.sleep(0.9)
    check("clicking a day dives to the book", altitude() == "schedule", altitude())
    # open an entry (click an entry card in the book)
    pg.evaluate("() => { const e=document.querySelector('[data-entry]'); e && e.click(); }")
    time.sleep(0.9)
    check("clicking an entry opens it", altitude() == "entry", altitude())
    # `e` starts editing (a textarea gains focus inside the entry)
    press("e", 0.6)
    editing = pg.evaluate("() => { const a=document.activeElement; return a && a.tagName==='TEXTAREA'; }")
    check("e rewrites the open entry", editing)
    press("Escape", 0.6)  # stop editing
    # Escape climbs entry -> schedule
    press("Escape", 0.8)
    check("Esc climbs entry->book", altitude() in ("schedule", "month"), altitude())
    if altitude() == "schedule":
        press("Escape", 0.8)
        check("Esc climbs book->canvas", altitude() == "month", altitude())

    # ============ j / k feed step (month) ============
    print("\n[ j / k step ]")
    for _ in range(2):
        if altitude() != "month": press("Escape", 0.4)
    title_before = pg.evaluate("() => document.querySelector('h1, [data-cal-title]')?.textContent || ''")
    press("k", 0.6)  # step back a month
    title_after = pg.evaluate("() => document.querySelector('h1, [data-cal-title]')?.textContent || ''")
    check("k steps the feed (title changes)", title_before != title_after, f"{title_before!r}->{title_after!r}")
    press("j", 0.6)  # forward again
    check("j steps the feed back", pg.evaluate("() => document.querySelector('h1, [data-cal-title]')?.textContent || ''") == title_before)

    # ============ c quick-capture + Enter/Shift+Enter ============
    print("\n[ quick capture + enter/shift+enter ]")
    press("c", 2.2)
    focused_field = pg.evaluate("() => { const a=document.activeElement; return a && a.tagName==='TEXTAREA' && a.hasAttribute('data-room-center'); }")
    check("c focuses today's capture field", focused_field, altitude())
    if focused_field:
        db_before = pg.evaluate("""async () => {
          const o = indexedDB.open('snippets'); const db = await new Promise(r=>{o.onsuccess=()=>r(o.result)});
          const c = await new Promise(r=>{const t=db.transaction('snippets').objectStore('snippets').count(); t.onsuccess=()=>r(t.result)}); db.close(); return c;
        }""")
        type_("first line"); press("Shift+Enter", 0.2); type_("second line"); time.sleep(0.3)
        val = pg.evaluate("() => document.activeElement.value")
        check("Shift+Enter inserts a newline (no submit)", "\n" in val and "first line" in val and "second line" in val, repr(val))
        press("Enter", 2.6)  # Enter submits -> keep animation files it
        db_after = pg.evaluate("""async () => {
          const o = indexedDB.open('snippets'); const db = await new Promise(r=>{o.onsuccess=()=>r(o.result)});
          const c = await new Promise(r=>{const t=db.transaction('snippets').objectStore('snippets').count(); t.onsuccess=()=>r(t.result)}); db.close(); return c;
        }""")
        check("Enter files the entry (db grew)", db_after == db_before + 1, f"{db_before}->{db_after}")

    print("\npage errors:", errs or "none")
    print(f"\n==== {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL: print("FAILED:", FAIL)
    b.close()
