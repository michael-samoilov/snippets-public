"use client";

/**
 * Icon studio — tune the OFFICIAL app-icon seal and bake it.
 *
 * The seal shape is deterministic per SEED (WaxStamp playKey → 5/6/7 lobes); pick
 * the five-lobe you want, dial the navy tint + puck, then per platform set FILL
 * (how close the lobes crowd the edge) and the optical CENTRE (h+v). Previews are
 * WYSIWYG with the bake. "Bake" writes the PNGs + saves the spec to
 * src/lib/icon-seal.json (so `pnpm icons` reproduces it). Dev-only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { ICON_SEAL, lobeCount, type IconSealSpec, type IconVariant } from "@/lib/seal-spec";

// hex ⇄ HSL, so the tint can be tuned by hue / saturation / lightness (the wax
// reads unsaturated as raw hex; a saturation slider is the intuitive control).
function hexToHsl(hex: string) {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255,
    g = parseInt(m.slice(2, 4), 16) / 255,
    b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export default function IconStudio() {
  const [spec, setSpec] = useState<IconSealSpec>(() => structuredClone(ICON_SEAL));
  const [status, setStatus] = useState("");
  const masterWrap = useRef<HTMLDivElement>(null);
  const previews = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // the master seal sizes to the viewport so it never overflows on a phone
  // (backing = this × dpr × superSample, so the bake stays high-res regardless)
  const [vw, setVw] = useState(1024);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const masterSize = Math.max(160, Math.min(340, vw - 88));
  const RENDER = 400; // fixed render resolution; scaled to masterSize for display

  // load the persisted spec (so the studio opens on whatever was last baked)
  useEffect(() => {
    fetch("/api/lab/bake-icons")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setSpec(structuredClone(s)))
      .catch(() => {});
  }, []);

  const masterCanvas = () =>
    masterWrap.current?.querySelector("canvas") as HTMLCanvasElement | null;

  const composeInto = useCallback(
    (cv: HTMLCanvasElement, v: IconVariant, px: number, safeZone = false) => {
      const g = cv.getContext("2d");
      const m = masterCanvas();
      if (!g || !m) return;
      cv.width = px;
      cv.height = px;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high"; // clean downscale of the hi-res master → no jaggies
      g.clearRect(0, 0, px, px);
      if (v.bg) { g.fillStyle = v.bg; g.fillRect(0, 0, px, px); }
      const d = v.fill * px;
      g.drawImage(m, v.cx * px - d / 2, v.cy * px - d / 2, d, d);
      if (safeZone) {
        // maskable safe zone: an adaptive circular crop keeps ~80% diameter
        g.strokeStyle = "rgba(220,60,60,0.8)";
        g.setLineDash([4, 4]);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(px / 2, px / 2, px * 0.4, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    },
    [],
  );

  // redraw every preview from the master each frame (the master repaints itself
  // when seed/tint/puck change; this just mirrors it)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const v of spec.variants) {
        const cv = previews.current.get(v.key);
        if (cv) composeInto(cv, v, cv.dataset.px ? +cv.dataset.px : 150, v.key === "maskable");
      }
      // favicon at real small sizes, on light + dark
      for (const [id, px] of [["fav-l-16", 16], ["fav-l-32", 32], ["fav-d-16", 16], ["fav-d-32", 32]] as const) {
        const cv = previews.current.get(id);
        const fav = spec.variants.find((v) => v.key === "favicon");
        if (cv && fav) composeInto(cv, fav, px);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec, composeInto]);

  const patch = (p: Partial<IconSealSpec>) => setSpec((s) => ({ ...s, ...p }));
  const patchVar = (key: string, p: Partial<IconVariant>) =>
    setSpec((s) => ({ ...s, variants: s.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }));

  const nextFiveLobe = (dir: 1 | -1) => {
    let k = spec.seed;
    for (let i = 0; i < 200; i++) { k += dir; if (k > 0 && lobeCount(k) === 5) break; }
    patch({ seed: k });
  };

  // the wax as H/S/L; moving one slider re-derives the whole tint (wax + a
  // lighter specular `bright` + a much darker `shadow`) so it stays coherent.
  const waxHsl = hexToHsl(spec.tint.wax);
  const setWax = (p: { h?: number; s?: number; l?: number }) => {
    const h = p.h ?? waxHsl.h, s = p.s ?? waxHsl.s, l = p.l ?? waxHsl.l;
    setSpec((sp) => ({
      ...sp,
      tint: {
        wax: hslToHex(h, s, l),
        bright: hslToHex(h, Math.max(0, s - 4), Math.min(100, l + 11)),
        shadow: hslToHex(h, Math.min(100, s + 16), Math.max(0, Math.round(l * 0.3))),
      },
    }));
  };

  // seed candidates — pin seeds you like and hop between them; persisted locally
  const [cands, setCands] = useState<number[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("iconSeedCands");
      // deferred (not synchronous in the effect body) — runs post-hydration, so
      // no server/client mismatch on the pinned row
      if (raw) queueMicrotask(() => setCands(JSON.parse(raw)));
    } catch { /* none saved */ }
  }, []);
  const saveCands = (next: number[]) => {
    setCands(next);
    try { localStorage.setItem("iconSeedCands", JSON.stringify(next)); } catch { /* private mode */ }
  };

  // ── automatic optical balancing ───────────────────────────────────
  // The wax is a lobed, asymmetric shape, so a geometrically-centred disc reads
  // shifted. Find the seal's optical anchor from its actual mass — the centroid
  // of the OPAQUE wax (soft shadow excluded), blended halfway to the bounding-box
  // centre so it doesn't over-correct toward the rim (the 48a9def method) — then
  // per variant place THAT point at the frame centre. It depends on fill, so it's
  // recomputed per variant, and re-run whenever the seal's shape changes.
  const opticalAnchor = () => {
    const m = masterCanvas();
    const g = m?.getContext("2d");
    if (!m || !g) return { x: 0.5, y: 0.5 };
    const { data, width, height } = g.getImageData(0, 0, m.width, m.height);
    let minx = width, miny = height, maxx = 0, maxy = 0, sx = 0, sy = 0, n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 180) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    if (!n) return { x: 0.5, y: 0.5 };
    return {
      x: ((minx + maxx) / 2 + sx / n) / 2 / width,
      y: ((miny + maxy) / 2 + sy / n) / 2 / height,
    };
  };
  const clamp46 = (v: number) => Math.max(0.4, Math.min(0.6, +v.toFixed(3)));
  const centreFor = (a: { x: number; y: number }, fill: number) => ({
    cx: clamp46(0.5 - (a.x - 0.5) * fill),
    cy: clamp46(0.5 - (a.y - 0.5) * fill),
  });
  const balanceAll = useCallback(() => {
    const a = opticalAnchor();
    setSpec((s) => ({ ...s, variants: s.variants.map((v) => ({ ...v, ...centreFor(a, v.fill) })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // rebalance ONE variant against its current fill — the optical centre depends on
  // scale, so this recomputes the best position for that variant's size alone,
  // leaving the others (and any manual tweaks) untouched.
  const balanceOne = (key: string) => {
    const a = opticalAnchor();
    setSpec((s) => ({
      ...s,
      variants: s.variants.map((v) => (v.key === key ? { ...v, ...centreFor(a, v.fill) } : v)),
    }));
  };

  const [autoBal, setAutoBal] = useState(true);
  // re-balance when the SHAPE changes — after a beat, so the master canvas has
  // repainted the new seal for us to measure.
  useEffect(() => {
    if (!autoBal) return;
    const id = setTimeout(balanceAll, 220);
    return () => clearTimeout(id);
  }, [spec.seed, spec.puck, spec.glyphScale, autoBal, balanceAll]);

  // changing a variant's fill shifts its optical centre too — keep it balanced
  const setFill = (key: string, fill: number) =>
    setSpec((s) => ({
      ...s,
      variants: s.variants.map((v) =>
        v.key === key ? { ...v, fill, ...(autoBal ? centreFor(opticalAnchor(), fill) : {}) } : v,
      ),
    }));

  const composeFiles = () =>
    spec.variants.map((v) => {
      const cv = document.createElement("canvas");
      composeInto(cv, v, v.size);
      return { file: v.file, name: v.file.split("/").pop()!, dataUrl: cv.toDataURL("image/png") };
    });

  const save = (name: string, dataUrl: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    a.click();
  };
  const specDataUrl = () =>
    "data:application/json," + encodeURIComponent(JSON.stringify(spec, null, 2));

  // download the composed PNGs + spec to the browser — works anywhere (prod too)
  const download = () => {
    const files = composeFiles();
    for (const f of files) save(f.name, f.dataUrl);
    save("icon-seal.json", specDataUrl());
    setStatus(`downloaded ${files.length} PNGs + icon-seal.json`);
  };

  // write straight into the repo — only works against the dev-only API (local
  // `pnpm dev`). On prod the FS is read-only + the route 404s, so fall back to a
  // download so the studio is still useful there.
  const bake = async () => {
    setStatus("baking…");
    const files = composeFiles();
    try {
      const res = await fetch("/api/lab/bake-icons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, files }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("baked ✓ wrote 5 icons + saved spec");
    } catch {
      for (const f of files) save(f.name, f.dataUrl);
      save("icon-seal.json", specDataUrl());
      setStatus("no disk writer here (prod) — downloaded the 5 PNGs + spec instead");
    }
  };

  const N = useMemo(() => lobeCount(spec.seed), [spec.seed]);

  const box: React.CSSProperties = { border: "1px solid #8884", borderRadius: 8, padding: 10 };
  const row: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "4px 0", fontSize: 13 };
  const rng: React.CSSProperties = { flex: "1 1 90px", minWidth: 80, maxWidth: 220 };
  const btn: React.CSSProperties = { fontFamily: "inherit", fontSize: 15, padding: "8px 12px", borderRadius: 6, border: "1px solid #8886", background: "#fdf9ef", cursor: "pointer", minWidth: 40 };

  return (
    // fixed full-viewport surface with its OWN scroll — the studio is a full-page
    // tool, so it breaks out of the app's fixed-height desk/sheet (which would
    // otherwise clip it and can't scroll it) and owns the whole screen.
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background: "#d8cdb4",
        color: "#241e15",
        padding: 14,
        fontFamily: "ui-monospace, monospace",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 1100, margin: "0 auto" }}>
        {/* master seal + shape/appearance controls */}
        <div style={{ ...box, background: "#e8dcc2", flex: "1 1 300px", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>master seal</div>
          {/* the seal renders at a FIXED high resolution (RENDER) and is scaled DOWN
              for display, so the on-screen seal — and the previews/bake composed from
              its canvas — stay crisp on any screen, not tied to the display size. */}
          <div
            ref={masterWrap}
            style={{ position: "relative", width: masterSize, height: masterSize, margin: "0 auto", background: "#e8dcc2", overflow: "hidden" }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: RENDER,
                height: RENDER,
                transform: `translate(-50%, -50%) scale(${masterSize / RENDER})`,
              }}
            >
              <WaxStamp
                playKey={spec.seed}
                size={RENDER}
                glyph={spec.glyph}
                mode="press"
                still
                restGlyph
                variant="spring"
                superSample={2}
                puck={spec.puck}
                glyphScale={spec.glyphScale}
                tint={spec.tint}
                glyphColor={spec.glyphColor}
                ignoreReducedMotion
              />
            </div>
          </div>
          <div style={{ ...row, gap: 6 }}>
            <button style={btn} onClick={() => patch({ seed: Math.max(1, spec.seed - 1) })}>◀</button>
            <span>seed</span>
            <input
              type="number"
              min={1}
              value={spec.seed}
              onChange={(e) => patch({ seed: Math.max(1, Math.floor(+e.target.value) || 1) })}
              style={{ width: 66, fontFamily: "inherit", fontSize: 15, padding: "7px 6px", textAlign: "center", borderRadius: 6, border: "1px solid #8886" }}
            />
            <button style={btn} onClick={() => patch({ seed: spec.seed + 1 })}>▶</button>
            <b style={{ color: N === 5 ? "#1e7a3f" : "#a05a1e" }}>{N} lobes</b>
          </div>
          <div style={{ ...row, gap: 6 }}>
            <button style={btn} onClick={() => nextFiveLobe(-1)}>◀ 5-lobe</button>
            <button style={btn} onClick={() => nextFiveLobe(1)}>5-lobe ▶</button>
            <button style={btn} onClick={() => { if (!cands.includes(spec.seed)) saveCands([...cands, spec.seed]); }}>☆ pin {spec.seed}</button>
          </div>
          {cands.length > 0 && (
            <div style={{ ...row, gap: 6 }}>
              <span style={{ color: "#6f6553", fontSize: 12 }}>pinned</span>
              {cands.map((n) => (
                <span key={n} style={{ display: "inline-flex", alignItems: "center", border: n === spec.seed ? "2px solid #1e3a5f" : "1px solid #8886", borderRadius: 6, overflow: "hidden" }}>
                  <button style={{ ...btn, border: "none", borderRadius: 0, background: n === spec.seed ? "#dfeaf6" : "#fdf9ef", fontWeight: n === spec.seed ? 700 : 400 }} onClick={() => patch({ seed: n })}>{n}</button>
                  <button style={{ ...btn, border: "none", borderRadius: 0, background: "transparent", padding: "8px 8px", color: "#993b26", minWidth: 0 }} onClick={() => saveCands(cands.filter((x) => x !== n))} title="remove">×</button>
                </span>
              ))}
            </div>
          )}
          <div style={row}>puck<input style={rng} type="range" min={0} max={1.5} step={0.05} value={spec.puck} onChange={(e) => patch({ puck: +e.target.value })} />{spec.puck.toFixed(2)}</div>
          <div style={row}>glyph<input style={rng} type="range" min={0.3} max={0.6} step={0.01} value={spec.glyphScale} onChange={(e) => patch({ glyphScale: +e.target.value })} />{spec.glyphScale.toFixed(2)}</div>
          <div style={{ ...row, marginTop: 8, fontWeight: 700 }}>navy tint</div>
          <div style={row}>hue<input style={rng} type="range" min={180} max={260} step={1} value={waxHsl.h} onChange={(e) => setWax({ h: +e.target.value })} />{waxHsl.h}°</div>
          <div style={row}>saturation<input style={rng} type="range" min={0} max={100} step={1} value={waxHsl.s} onChange={(e) => setWax({ s: +e.target.value })} />{waxHsl.s}%</div>
          <div style={row}>lightness<input style={rng} type="range" min={5} max={55} step={1} value={waxHsl.l} onChange={(e) => setWax({ l: +e.target.value })} />{waxHsl.l}%</div>
          <div style={row}>wax<span style={{ display: "inline-block", width: 34, height: 18, background: spec.tint.wax, border: "1px solid #0004", borderRadius: 3 }} />{spec.tint.wax}</div>
          <div style={row}>S ink<input type="color" value={spec.glyphColor} onChange={(e) => patch({ glyphColor: e.target.value })} /></div>
          <label style={{ ...row, cursor: "pointer" }}>
            <input type="checkbox" checked={autoBal} onChange={(e) => setAutoBal(e.target.checked)} />
            auto optical-balance ⊙
            <button onClick={balanceAll} title="re-balance now">balance now</button>
          </label>
          <div style={{ marginTop: 10 }}>
            <button onClick={bake} style={{ padding: "8px 16px", fontWeight: 700, background: "#1e3a5f", color: "#eae1cd", border: "none", borderRadius: 6, cursor: "pointer" }}>Bake to disk</button>
            <button onClick={download} style={{ marginLeft: 8, padding: "8px 16px", fontWeight: 700, background: "transparent", color: "#1e3a5f", border: "1px solid #1e3a5f", borderRadius: 6, cursor: "pointer" }}>Download PNGs</button>
            <div style={{ marginTop: 6, fontSize: 12 }}>{status}</div>
          </div>
        </div>

        {/* per-variant previews + fill/centre controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 300px", minWidth: 0 }}>
          {spec.variants.map((v) => (
            <div key={v.key} style={{ ...box, background: "#e8dcc2", boxSizing: "border-box" }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 auto" }}>
                  {v.key === "favicon" ? (
                    <FaviconPreviews previews={previews} />
                  ) : (
                    <canvas
                      ref={(el) => { if (el) previews.current.set(v.key, el); }}
                      data-px="150"
                      style={{ width: 150, height: 150, borderRadius: v.key === "apple" ? 33 : 0, boxShadow: "0 1px 3px #0004" }}
                    />
                  )}
                </div>
                <div style={{ flex: "1 1 190px", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{v.key} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {v.file} · {v.size}px {v.bg ? "on cream" : "transparent"}{v.key === "maskable" ? " · red = safe zone" : ""}</span></div>
                  <div style={row}>fill<input style={rng} type="range" min={0.6} max={1.5} step={0.005} value={v.fill} onChange={(e) => setFill(v.key, +e.target.value)} />{v.fill.toFixed(3)}</div>
                  <div style={row}>centre x<input style={rng} type="range" min={0.4} max={0.6} step={0.002} value={v.cx} onChange={(e) => patchVar(v.key, { cx: +e.target.value })} />{v.cx.toFixed(3)}</div>
                  <div style={row}>centre y<input style={rng} type="range" min={0.4} max={0.6} step={0.002} value={v.cy} onChange={(e) => patchVar(v.key, { cy: +e.target.value })} />{v.cy.toFixed(3)}</div>
                  <button onClick={() => balanceOne(v.key)} title="recompute the optical centre for this size">⊙ rebalance</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// the favicon at real tab sizes, on a light and a dark tab
function FaviconPreviews({ previews }: { previews: React.RefObject<Map<string, HTMLCanvasElement>> }) {
  const reg = (id: string) => (el: HTMLCanvasElement | null) => { if (el) previews.current?.set(id, el); };
  const cell = (bg: string, id: string, px: number) => (
    <div style={{ background: bg, padding: 6, borderRadius: 4, display: "grid", placeItems: "center" }}>
      <canvas ref={reg(id)} style={{ width: px, height: px }} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 150 }}>
      <div style={{ display: "flex", gap: 6 }}>{cell("#fafafa", "fav-l-16", 16)}{cell("#fafafa", "fav-l-32", 32)}<span style={{ fontSize: 11, alignSelf: "center" }}>light tab</span></div>
      <div style={{ display: "flex", gap: 6 }}>{cell("#1a1a1e", "fav-d-16", 16)}{cell("#1a1a1e", "fav-d-32", 32)}<span style={{ fontSize: 11, alignSelf: "center" }}>dark tab</span></div>
      <canvas ref={reg("favicon")} data-px="128" style={{ width: 128, height: 128 }} />
    </div>
  );
}
