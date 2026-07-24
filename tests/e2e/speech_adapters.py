"""
Wire-protocol harness for the streaming speech adapters (soniox,
speechmatics). Drives the REAL capture pipeline — fake mic via Chromium
flags, real AudioContext/worklet/downsampler, real use-speech engine —
against a recording FakeWebSocket, then injects each provider's
documented server messages and asserts (a) the exact frames our
adapters put on the wire (auth/config first frame, raw binary PCM,
finalize) and (b) that partial/final transcripts land in the composer.

The token routes are stubbed at the network layer, so this runs with no
API keys and no internet; what it proves is OUR side of each protocol.

Run:
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 tests/e2e/speech_adapters.py
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


FAKE_WS = """
(() => {
  class FakeWS extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.protocols = protocols;
      this.readyState = 0;
      this.stringFrames = [];
      this.binaryFrames = 0;
      this.binaryBytes = 0;
      (window.__sockets = window.__sockets || []).push(this);
      setTimeout(() => {
        this.readyState = 1;
        const e = new Event("open");
        this.dispatchEvent(e);
        if (this.onopen) this.onopen(e);
      }, 30);
    }
    send(d) {
      if (typeof d === "string") this.stringFrames.push(d);
      else {
        this.binaryFrames += 1;
        this.binaryBytes += d.byteLength ?? d.size ?? 0;
      }
    }
    close(code) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const e = new CloseEvent("close", { code: code ?? 1000, wasClean: true });
      this.dispatchEvent(e);
      if (this.onclose) this.onclose(e);
    }
    __emit(data) {
      const e = new MessageEvent("message", { data });
      this.dispatchEvent(e);
      if (this.onmessage) this.onmessage(e);
    }
    __serverClose(code) { this.close(code); }
  }
  window.WebSocket = FakeWS;
})();
"""


def wire(context, provider):
    """Stub the token routes: only `provider` is available."""

    def handle(route):
        url = route.request.url
        if "/api/soniox-token" in url:
            if provider != "soniox":
                route.fulfill(status=200, json={"available": False})
            elif route.request.method == "GET":
                route.fulfill(json={"available": True})
            else:
                route.fulfill(json={
                    "token": "tk-soniox", "model": "stt-rt-v5",
                    "ws": "wss://stub-soniox", "expiresIn": 300,
                })
            return
        if "/api/speechmatics-token" in url:
            if provider != "speechmatics":
                route.fulfill(status=200, json={"available": False})
            elif route.request.method == "GET":
                route.fulfill(json={"available": True})
            else:
                route.fulfill(json={
                    "token": "tk-sm", "scheme": "query", "model": "enhanced",
                    "language": "en", "ws": "wss://stub-sm/v2", "expiresIn": 300,
                })
            return
        if "/api/deepgram-token" in url or "/api/scribe-token" in url:
            route.fulfill(status=200, json={"available": False})
            return
        if "/api/transcribe" in url:
            route.fulfill(status=503, json={"error": "transcription_unconfigured"})
            return
        route.fallback()

    context.route("**/api/**", handle)
    context.add_init_script(FAKE_WS)
    # no audio devices exist in this sandbox (fake-device flags included) —
    # synthesize a REAL MediaStream from an oscillator so the genuine
    # worklet/downsample pipeline still runs and real PCM reaches the socket
    context.add_init_script("""
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        return dst.stream;
      };
    """)
    context.add_init_script(
        'try { localStorage.setItem("devSeed:v1", "cleared") } catch {}'
    )


def emit(page, message):
    page.evaluate(
        "(m) => window.__sockets[window.__sockets.length - 1].__emit(m)",
        json.dumps(message) if isinstance(message, dict) else message,
    )


def socket_state(page):
    return page.evaluate("""() => {
      const s = (window.__sockets || [])[ (window.__sockets || []).length - 1 ];
      return s ? { url: s.url, stringFrames: s.stringFrames,
                   binaryFrames: s.binaryFrames, binaryBytes: s.binaryBytes } : null;
    }""")


def start_take(page):
    page.goto(f"{BASE}/calendar")
    btn = page.get_by_role("button", name="Speak today's entry")
    # the seal breathes (opacity/scale animation), so "visible" can flap —
    # attached + force-click is the house pattern for it
    btn.wait_for(state="attached", timeout=20000)
    page.wait_for_timeout(2000)  # engine probe + warm grant settle
    btn.click(force=True)
    deadline = time.time() + 15
    while time.time() < deadline:
        s = socket_state(page)
        if s:
            return s
        page.wait_for_timeout(200)
    return None


def wait_binary(page, minimum=3, timeout=12):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = socket_state(page)
        if s and s["binaryFrames"] >= minimum:
            return s
        page.wait_for_timeout(200)
    return socket_state(page)


def textarea_value(page):
    return page.locator("textarea").first.input_value()


def run_soniox(browser):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        service_workers="block",
        permissions=["microphone"],
    )
    wire(ctx, "soniox")
    page = ctx.new_page()
    s = start_take(page)
    check("soniox: socket opened", s is not None)
    if not s:
        ctx.close()
        return
    check("soniox: correct endpoint",
          s["url"] == "wss://stub-soniox/transcribe-websocket", s["url"])

    deadline = time.time() + 5
    while not s["stringFrames"] and time.time() < deadline:
        page.wait_for_timeout(100)
        s = socket_state(page)
    cfg = json.loads(s["stringFrames"][0]) if s["stringFrames"] else {}
    check("soniox: first frame is the config with the temp key",
          cfg.get("api_key") == "tk-soniox"
          and cfg.get("model") == "stt-rt-v5"
          and cfg.get("audio_format") == "pcm_s16le"
          and cfg.get("sample_rate") == 16000
          and cfg.get("num_channels") == 1,
          json.dumps({k: cfg.get(k) for k in ("api_key", "model", "audio_format")}))

    s = wait_binary(page)
    check("soniox: raw binary PCM flows", s["binaryFrames"] >= 3,
          f"{s['binaryFrames']} frames / {s['binaryBytes']} bytes")

    emit(page, {"tokens": [{"text": "Hello", "is_final": False}]})
    page.wait_for_timeout(400)
    check("soniox: non-final tokens surface as interim",
          "Hello" in page.locator("textarea").first.input_value()
          or page.get_by_text("Hello").count() > 0)
    emit(page, {"tokens": [
        {"text": "Hello", "is_final": True},
        {"text": " world", "is_final": True},
        {"text": "<end>", "is_final": True},
    ]})
    page.wait_for_timeout(400)

    # stop the take (the seal reads "Stop listening" while live) →
    # the adapter must flush with an EMPTY frame
    page.get_by_role("button", name="Stop listening").click(force=True)
    page.wait_for_timeout(600)
    s = socket_state(page)
    check("soniox: finalize is the empty frame",
          s["stringFrames"] and s["stringFrames"][-1] == "",
          repr(s["stringFrames"][-1] if s["stringFrames"] else None))
    emit(page, {"tokens": [], "finished": True})
    page.evaluate("() => window.__sockets[window.__sockets.length-1].__serverClose(1000)")
    deadline = time.time() + 8
    while "Hello world" not in textarea_value(page) and time.time() < deadline:
        page.wait_for_timeout(200)
    check("soniox: finals settle into the composer",
          "Hello world" in textarea_value(page), repr(textarea_value(page)))
    ctx.close()


def run_speechmatics(browser):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        service_workers="block",
        permissions=["microphone"],
    )
    wire(ctx, "speechmatics")
    page = ctx.new_page()
    s = start_take(page)
    check("speechmatics: socket opened", s is not None)
    if not s:
        ctx.close()
        return
    check("speechmatics: JWT rides the query",
          s["url"].startswith("wss://stub-sm/v2?jwt=tk-sm"), s["url"])

    deadline = time.time() + 5
    while not s["stringFrames"] and time.time() < deadline:
        page.wait_for_timeout(100)
        s = socket_state(page)
    start = json.loads(s["stringFrames"][0]) if s["stringFrames"] else {}
    check("speechmatics: StartRecognition is the first frame",
          start.get("message") == "StartRecognition"
          and start.get("audio_format", {}).get("encoding") == "pcm_s16le"
          and start.get("audio_format", {}).get("sample_rate") == 16000
          and start.get("transcription_config", {}).get("enable_partials") is True
          and start.get("transcription_config", {}).get("language") == "en",
          json.dumps(start)[:120])

    s = wait_binary(page)
    check("speechmatics: raw binary AddAudio frames flow", s["binaryFrames"] >= 3,
          f"{s['binaryFrames']} frames")

    emit(page, {"message": "AddPartialTranscript",
                "metadata": {"transcript": "Bonjour"}})
    page.wait_for_timeout(400)
    check("speechmatics: partials surface as interim",
          "Bonjour" in page.locator("textarea").first.input_value()
          or page.get_by_text("Bonjour").count() > 0)
    emit(page, {"message": "AddTranscript",
                "metadata": {"transcript": "Bonjour le monde."}})
    page.wait_for_timeout(400)

    page.get_by_role("button", name="Stop listening").click(force=True)
    page.wait_for_timeout(600)
    s = socket_state(page)
    last = json.loads(s["stringFrames"][-1]) if s["stringFrames"] else {}
    check("speechmatics: EndOfStream carries the sent-frame count",
          last.get("message") == "EndOfStream"
          and last.get("last_seq_no") == s["binaryFrames"],
          f"last_seq_no={last.get('last_seq_no')} vs sent={s['binaryFrames']}")
    emit(page, {"message": "EndOfTranscript"})
    deadline = time.time() + 8
    while "Bonjour le monde." not in textarea_value(page) and time.time() < deadline:
        page.wait_for_timeout(200)
    check("speechmatics: finals settle into the composer",
          "Bonjour le monde." in textarea_value(page), repr(textarea_value(page)))
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-fake-device-for-media-capture",
            "--use-fake-ui-for-media-stream",
        ])
        run_soniox(browser)
        run_speechmatics(browser)
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        sys.exit(1)
    print("ALL CHECKS PASSED — both adapters speak their documented protocols.")


if __name__ == "__main__":
    main()
