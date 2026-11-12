"""
Route-level harness for the voice routes' gate (src/server/speech-guard.ts).
Unlike speech_adapters.py, nothing here stubs our own routes: the REAL
build serves the REAL /api/deepgram-token and /api/transcribe, which call
a stub provider this script runs on 127.0.0.1:3999. It proves, in a real
browser with the browser's own request headers:

  1. a take on the app's own page mints through the gate and streams
     (Deepgram socket opened with the stub's token, words land),
  2. the batch engine's real upload passes the gate and its words land,
  3. a page on another site cannot reach the provider through the routes,
  4. a burst from one address is cut off at the budget,
  5. every address in one IPv6 /64 draws on one budget, and the next /64
     has its own. `next start` takes the caller's address from
     `x-real-ip`, so this step sets it; on Vercel the platform's proxy
     overwrites that header.

Run (the provider env points the routes at the stub):
  python3 .claude/skills/webapp-testing/scripts/with_server.py \\
    --server "env DEEPGRAM_API_KEY=stub DEEPGRAM_REST_URL=http://127.0.0.1:3999 \\
      TRANSCRIBE_API_KEY=stub TRANSCRIBE_BASE_URL=http://127.0.0.1:3999/v1 \\
      node_modules/.bin/next start" --port 3000 -- \\
    python3 tests/e2e/speech_routes.py
"""

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
STUB_PORT = 3999
TOKEN_BUDGET = 30  # SPEECH_BUDGETS.token.limit
failures = []
provider_calls = {"grant": 0, "transcribe": 0, "upload_bytes": []}


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


EVIL_PAGE = """<!doctype html><title>another site</title><script>
window.__results = [];
async function spend() {
  for (const path of ["/api/deepgram-token", "/api/transcribe"]) {
    try {
      const body = path.endsWith("transcribe") ? (() => {
        const f = new FormData();
        f.append("file", new Blob([new Uint8Array(2048)], { type: "audio/webm" }));
        return f;
      })() : undefined;
      const r = await fetch("http://127.0.0.1:3000" + path, { method: "POST", body, mode: "no-cors" });
      window.__results.push(path + " sent (opaque " + r.type + ")");
    } catch (e) { window.__results.push(path + " error " + e); }
  }
  window.__done = true;
}
spend();
</script>"""


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/evil.html":
            data = EVIL_PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        if self.path == "/v1/auth/grant":
            provider_calls["grant"] += 1
            ttl = json.loads(body or b"{}").get("ttl_seconds")
            self._json({"access_token": "stub-jwt", "expires_in": ttl})
            return
        if self.path == "/v1/audio/transcriptions":
            provider_calls["transcribe"] += 1
            provider_calls["upload_bytes"].append(len(body))
            self._json({"text": "the batch words came back"})
            return
        self._json({"error": "not found"}, 404)


FAKE_WS = """
(() => {
  class FakeWS extends EventTarget {
    constructor(url, protocols) {
      super();
      this.url = String(url); this.protocols = protocols; this.readyState = 0;
      this.binaryFrames = 0; this.stringFrames = [];
      (window.__sockets = window.__sockets || []).push(this);
      setTimeout(() => { this.readyState = 1; const e = new Event("open");
        this.dispatchEvent(e); if (this.onopen) this.onopen(e); }, 30);
    }
    send(d) { if (typeof d === "string") this.stringFrames.push(d); else this.binaryFrames += 1; }
    close(code) { if (this.readyState === 3) return; this.readyState = 3;
      const e = new CloseEvent("close", { code: code ?? 1000, wasClean: true });
      this.dispatchEvent(e); if (this.onclose) this.onclose(e); }
    __emit(data) { const e = new MessageEvent("message", { data });
      this.dispatchEvent(e); if (this.onmessage) this.onmessage(e); }
  }
  window.WebSocket = FakeWS;
})();
"""

OSCILLATOR_MIC = """
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const dst = ctx.createMediaStreamDestination();
  osc.connect(dst); osc.start();
  return dst.stream;
};
"""


def new_context(browser):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        service_workers="block",
        permissions=["microphone"],
    )
    ctx.add_init_script(OSCILLATOR_MIC)
    ctx.add_init_script('try { localStorage.setItem("devSeed:v1", "cleared") } catch {}')
    return ctx


def watch_routes(page):
    seen = []
    page.on("response", lambda r: seen.append((r.request.method, r.url.replace(BASE, ""), r.status))
            if "/api/" in r.url else None)
    return seen


def textarea_value(page):
    return page.locator("textarea").first.input_value()


def open_seal(page):
    page.goto(f"{BASE}/calendar")
    btn = page.get_by_role("button", name="Speak today's entry")
    btn.wait_for(state="attached", timeout=20000)
    page.wait_for_timeout(2500)  # engine probes + warm grant settle
    return btn


def run_stream(browser):
    ctx = new_context(browser)
    ctx.add_init_script(FAKE_WS)
    page = ctx.new_page()
    seen = watch_routes(page)
    btn = open_seal(page)
    mints = [s for s in seen if s[0] == "POST" and s[1] == "/api/deepgram-token"]
    check("stream: the page's own token mint passes the gate",
          bool(mints) and all(s[2] == 200 for s in mints), json.dumps(mints))
    btn.click(force=True)
    sock = None
    deadline = time.time() + 15
    while time.time() < deadline and not sock:
        sock = page.evaluate("() => { const s = (window.__sockets||[]).at(-1); "
                             "return s ? { url: s.url, protocols: s.protocols } : null }")
        page.wait_for_timeout(200)
    check("stream: socket opened with the token the real route minted",
          bool(sock) and sock["protocols"] == ["bearer", "stub-jwt"]
          and "mip_opt_out=true" in sock["url"], json.dumps(sock)[:160])
    page.evaluate("""() => window.__sockets.at(-1).__emit(JSON.stringify({
      type: "Results", is_final: true,
      channel: { alternatives: [{ transcript: "words through the gate" }] } }))""")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Stop listening").click(force=True)
    page.wait_for_timeout(400)
    page.evaluate("() => window.__sockets.at(-1).close(1000)")
    deadline = time.time() + 8
    while "words through the gate" not in textarea_value(page) and time.time() < deadline:
        page.wait_for_timeout(200)
    check("stream: the take's words land in the composer",
          "words through the gate" in textarea_value(page), repr(textarea_value(page)))
    page.screenshot(path="/tmp/speech-routes-stream.png")
    ctx.close()


def run_batch(browser):
    ctx = new_context(browser)
    # only the streaming probe is faked unavailable, so the hook picks the
    # batch engine; the upload itself goes to the real /api/transcribe
    ctx.route("**/api/deepgram-token", lambda r: r.fulfill(json={"available": False})
              if r.request.method == "GET" else r.fallback())
    page = ctx.new_page()
    seen = watch_routes(page)
    btn = open_seal(page)
    btn.click(force=True)
    page.wait_for_timeout(2500)  # record ~2.5 s of the oscillator
    page.get_by_role("button", name="Stop listening").click(force=True)
    deadline = time.time() + 15
    while "the batch words came back" not in textarea_value(page) and time.time() < deadline:
        page.wait_for_timeout(200)
    uploads = [s for s in seen if s[0] == "POST" and s[1] == "/api/transcribe"]
    check("batch: the real upload passes the gate", bool(uploads) and uploads[-1][2] == 200,
          json.dumps(uploads))
    check("batch: the provider got real audio",
          provider_calls["transcribe"] >= 1 and max(provider_calls["upload_bytes"] or [0]) > 1000,
          f"{provider_calls['transcribe']} upload(s), bytes={provider_calls['upload_bytes']}")
    check("batch: the words land in the composer",
          "the batch words came back" in textarea_value(page), repr(textarea_value(page)))
    page.screenshot(path="/tmp/speech-routes-batch.png")
    ctx.close()


def run_cross_site(browser):
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    statuses = []
    page.on("response", lambda r: statuses.append((r.url, r.status)) if "/api/" in r.url else None)
    grants, uploads = provider_calls["grant"], provider_calls["transcribe"]
    # localhost and 127.0.0.1 are different sites, so this is cross-site
    page.goto(f"http://localhost:{STUB_PORT}/evil.html")
    page.wait_for_function("() => window.__done === true", timeout=15000)
    page.wait_for_timeout(500)
    check("cross-site: the routes answer 403",
          len(statuses) == 2 and all(s == 403 for _, s in statuses), json.dumps(statuses))
    check("cross-site: the provider was never called",
          provider_calls["grant"] == grants and provider_calls["transcribe"] == uploads,
          f"grants {grants}->{provider_calls['grant']}, uploads {uploads}->{provider_calls['transcribe']}")
    ctx.close()


def run_burst(browser):
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    page.goto(f"{BASE}/privacy")
    before = provider_calls["grant"]
    result = page.evaluate(f"""async () => {{
      const out = [];
      for (let i = 0; i < {TOKEN_BUDGET + 5}; i++) {{
        const r = await fetch("/api/deepgram-token", {{ method: "POST" }});
        out.push([r.status, r.headers.get("retry-after")]);
      }}
      return out;
    }}""")
    codes = [s for s, _ in result]
    ok = [s for s in codes if s == 200]
    limited = [r for r in result if r[0] == 429]
    check("burst: one address gets at most the budget in a window",
          len(ok) <= TOKEN_BUDGET and codes[-1] == 429,
          f"{len(ok)} x 200, {len(limited)} x 429 (earlier steps already spent some)")
    check("burst: refusals carry Retry-After",
          bool(limited) and all(r[1] and int(r[1]) > 0 for r in limited), json.dumps(limited[:2]))
    check("burst: refused requests never reach the provider",
          provider_calls["grant"] - before == len(ok),
          f"provider grants {provider_calls['grant'] - before} vs passes {len(ok)}")
    ctx.close()


def run_ipv6_network(browser):
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    page.goto(f"{BASE}/privacy")
    before = provider_calls["grant"]
    result = page.evaluate(f"""async () => {{
      const mint = async (ip) => (await fetch("/api/deepgram-token", {{
        method: "POST", headers: {{ "x-real-ip": ip }} }})).status;
      const first = [];
      for (let i = 0; i < {TOKEN_BUDGET}; i++) first.push(await mint("2001:db8:5:6::1"));
      return {{
        first,
        sibling: await mint("2001:db8:5:6:ffff:ffff:ffff:fffe"),
        nextNetwork: await mint("2001:db8:5:7::1"),
      }};
    }}""")
    check("ipv6: one address spends the whole budget",
          result["first"] == [200] * TOKEN_BUDGET, json.dumps(result["first"]))
    check("ipv6: another address in the same /64 is refused",
          result["sibling"] == 429, str(result["sibling"]))
    check("ipv6: the next /64 has its own budget",
          result["nextNetwork"] == 200, str(result["nextNetwork"]))
    check("ipv6: the provider saw only the passes",
          provider_calls["grant"] - before == TOKEN_BUDGET + 1,
          f"provider grants {provider_calls['grant'] - before}")
    ctx.close()


def main():
    stub = ThreadingHTTPServer(("0.0.0.0", STUB_PORT), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=[
                "--use-fake-device-for-media-capture",
                "--use-fake-ui-for-media-stream",
            ])
            run_stream(browser)
            run_batch(browser)
            run_cross_site(browser)
            run_burst(browser)
            run_ipv6_network(browser)
            browser.close()
    finally:
        stub.shutdown()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        sys.exit(1)
    print("ALL CHECKS PASSED — the gate lets the app through and keeps others out.")


if __name__ == "__main__":
    main()
