"""Measure that the pageload skeleton lands at the SAME pixel positions as the
real app it stands in for — so nothing shifts when the real layout arrives.

Reads getBoundingClientRect() for the header, the header's bottom hairline (the
weekday rail's border-b — the scroll area's top terminus), and the today zone
box, in both the held skeleton (?skeldebug) and the real app. The real app is
seeded with one entry first, so it renders the returning-visitor stance the
skeleton assumes (pt-[19px], top hairline shown). Draws guide lines at each
measured edge and prints the deltas.

Run against a running production build (port 3000):
  pkill -9 -f "next[-]server"
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 \
    -- python3 scripts/measure-skeleton-alignment.py

Screenshots land in scripts/.skeleton-align/ (skel.png, real.png). Playwright
1.56 + the sandbox chromium; see CLAUDE.md → Visual verification.
"""

import json
import os
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), ".skeleton-align")
os.makedirs(OUT, exist_ok=True)
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

STUB = (
    "window.SpeechRecognition=window.SpeechRecognition||function(){this.start=()=>{};"
    "this.stop=()=>{};this.abort=()=>{};this.addEventListener=()=>{};};"
    "window.webkitSpeechRecognition=window.webkitSpeechRecognition||window.SpeechRecognition;"
)

MEASURE = """() => {
  const rect = (el) => { if(!el) return null; const b=el.getBoundingClientRect();
    return {top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1), height:+b.height.toFixed(1)}; };
  return {
    header: rect(document.querySelector('.sticky.top-0.z-30')),
    rail:   rect(document.querySelector('.mt-5.border-b')),   // the top hairline
    zone:   rect(document.querySelector('[data-today-zone-box]')),
  };
}"""

GUIDES = """(m) => {
  const line = (y,color,label) => { if(y==null) return;
    const d=document.createElement('div');
    d.style.cssText=`position:fixed;left:0;right:0;top:${y}px;height:1px;background:${color};z-index:99999;pointer-events:none`;
    const t=document.createElement('div'); t.textContent=label+' '+Math.round(y);
    t.style.cssText=`position:fixed;right:2px;top:${y+1}px;font:9px monospace;color:${color};background:#fff8;z-index:99999;padding:0 2px`;
    document.body.appendChild(d); document.body.appendChild(t); };
  if(m.header) line(m.header.bottom,'#2563eb','hdr.bot');
  if(m.rail)   line(m.rail.bottom,'#dc2626','HAIRLINE');
  if(m.zone)   line(m.zone.top,'#059669','zone.top');
}"""

SEED = """async () => {
  const d=new Date();
  const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const now=Date.now();
  const snip={id:'seedmeasure1',text:'A seeded memory for layout measurement.',kind:null,tags:[],
    capturedAt:now,day,source:'typed',favorite:0,enriched:'manual',updatedAt:now};
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('snippets');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  await new Promise((res,rej)=>{const tx=db.transaction('snippets','readwrite');tx.objectStore('snippets').put(snip);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
  return true;
}"""


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(
            executable_path=CHROME,
            args=["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist",
                  "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
        )
        c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)

        pg = c.new_page()
        pg.add_init_script("try{localStorage.setItem('theme','light')}catch(e){}")
        pg.goto("http://localhost:3000/calendar?skeldebug", wait_until="networkidle")
        # let page-settle finish: skeldebug re-mounts CalendarSkeleton at
        # hydration (SSR shell → held debug view), restarting the 280ms entrance;
        # measuring too early catches its 6px translateY mid-flight
        pg.wait_for_timeout(2500)
        skel = pg.evaluate(MEASURE)
        pg.evaluate(GUIDES, skel)
        pg.screenshot(path=os.path.join(OUT, "skel.png"))
        pg.close()

        pg = c.new_page()
        pg.add_init_script(STUB)
        pg.add_init_script("try{localStorage.setItem('theme','light')}catch(e){}")
        pg.goto("http://localhost:3000/calendar", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.evaluate(SEED)
        pg.wait_for_timeout(300)
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(2500)
        real = pg.evaluate(MEASURE)
        pg.evaluate(GUIDES, real)
        pg.screenshot(path=os.path.join(OUT, "real.png"))
        pg.close()
        b.close()

    print("SKELETON:", json.dumps(skel))
    print("REAL    :", json.dumps(real))
    print()
    if skel.get("rail") and real.get("rail"):
        print(f"HAIRLINE viewport-Y   skel={skel['rail']['bottom']}  real={real['rail']['bottom']}  "
              f"delta={skel['rail']['bottom'] - real['rail']['bottom']:+.1f}px")
    if skel.get("header") and skel.get("rail"):
        sa = skel["rail"]["bottom"] - skel["header"]["bottom"]
        ra = real["rail"]["bottom"] - real["header"]["bottom"]
        print(f"spacing ABOVE hairline skel={sa:.1f}  real={ra:.1f}  delta={sa - ra:+.1f}px")
    if skel.get("rail") and skel.get("zone"):
        sb = skel["zone"]["top"] - skel["rail"]["bottom"]
        rb = real["zone"]["top"] - real["rail"]["bottom"]
        print(f"spacing BELOW hairline skel={sb:.1f}  real={rb:.1f}  delta={sb - rb:+.1f}px")


if __name__ == "__main__":
    main()
