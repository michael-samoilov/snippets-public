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

const MASTER = 360; // on-screen master seal size (backing = ×dpr×superSample)

export default function IconStudio() {
  const [spec, setSpec] = useState<IconSealSpec>(() => structuredClone(ICON_SEAL));
  const [status, setStatus] = useState("");
  const masterWrap = useRef<HTMLDivElement>(null);
  const previews = useRef<Map<string, HTMLCanvasElement>>(new Map());

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
  const patchTint = (k: keyof IconSealSpec["tint"], val: string) =>
    setSpec((s) => ({ ...s, tint: { ...s.tint, [k]: val } }));
  const patchVar = (key: string, p: Partial<IconVariant>) =>
    setSpec((s) => ({ ...s, variants: s.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }));

  const nextFiveLobe = (dir: 1 | -1) => {
    let k = spec.seed;
    for (let i = 0; i < 200; i++) { k += dir; if (k > 0 && lobeCount(k) === 5) break; }
    patch({ seed: k });
  };

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
  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, margin: "4px 0", fontSize: 13 };

  return (
    <div style={{ minHeight: "100vh", background: "#d8cdb4", color: "#241e15", padding: 20, fontFamily: "ui-monospace, monospace" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", maxWidth: 1100, margin: "0 auto" }}>
        {/* master seal + shape/appearance controls */}
        <div style={{ ...box, background: "#e8dcc2" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>master seal</div>
          <div ref={masterWrap} style={{ width: MASTER, height: MASTER, display: "grid", placeItems: "center", background: "#e8dcc2" }}>
            <WaxStamp
              playKey={spec.seed}
              size={MASTER}
              glyph={spec.glyph}
              mode="press"
              still
              restGlyph
              variant="spring"
              superSample={3}
              puck={spec.puck}
              glyphScale={spec.glyphScale}
              tint={spec.tint}
              glyphColor={spec.glyphColor}
              ignoreReducedMotion
            />
          </div>
          <div style={row}>
            <button onClick={() => patch({ seed: Math.max(1, spec.seed - 1) })}>◀</button>
            <span>seed {spec.seed}</span>
            <button onClick={() => patch({ seed: spec.seed + 1 })}>▶</button>
            <b style={{ color: N === 5 ? "#1e7a3f" : "#a05a1e" }}>{N} lobes</b>
            <button onClick={() => nextFiveLobe(1)}>next 5-lobe ▶</button>
            <button onClick={() => nextFiveLobe(-1)}>◀</button>
          </div>
          <div style={row}>puck<input type="range" min={0} max={1.5} step={0.05} value={spec.puck} onChange={(e) => patch({ puck: +e.target.value })} />{spec.puck.toFixed(2)}</div>
          <div style={row}>glyph<input type="range" min={0.3} max={0.6} step={0.01} value={spec.glyphScale} onChange={(e) => patch({ glyphScale: +e.target.value })} />{spec.glyphScale.toFixed(2)}</div>
          <div style={row}>wax<input type="color" value={spec.tint.wax} onChange={(e) => patchTint("wax", e.target.value)} />{spec.tint.wax}</div>
          <div style={row}>bright<input type="color" value={spec.tint.bright} onChange={(e) => patchTint("bright", e.target.value)} /></div>
          <div style={row}>shadow<input type="color" value={spec.tint.shadow} onChange={(e) => patchTint("shadow", e.target.value)} /></div>
          <div style={row}>S ink<input type="color" value={spec.glyphColor} onChange={(e) => patch({ glyphColor: e.target.value })} /></div>
          <div style={{ marginTop: 10 }}>
            <button onClick={bake} style={{ padding: "8px 16px", fontWeight: 700, background: "#1e3a5f", color: "#eae1cd", border: "none", borderRadius: 6, cursor: "pointer" }}>Bake to disk</button>
            <button onClick={download} style={{ marginLeft: 8, padding: "8px 16px", fontWeight: 700, background: "transparent", color: "#1e3a5f", border: "1px solid #1e3a5f", borderRadius: 6, cursor: "pointer" }}>Download PNGs</button>
            <div style={{ marginTop: 6, fontSize: 12 }}>{status}</div>
          </div>
        </div>

        {/* per-variant previews + fill/centre controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minWidth: 420 }}>
          {spec.variants.map((v) => (
            <div key={v.key} style={{ ...box, background: "#e8dcc2" }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div>
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
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{v.key} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {v.file} · {v.size}px {v.bg ? "on cream" : "transparent"}{v.key === "maskable" ? " · red = safe zone" : ""}</span></div>
                  <div style={row}>fill<input type="range" min={0.6} max={1.5} step={0.005} value={v.fill} onChange={(e) => patchVar(v.key, { fill: +e.target.value })} />{v.fill.toFixed(3)}</div>
                  <div style={row}>centre x<input type="range" min={0.4} max={0.6} step={0.002} value={v.cx} onChange={(e) => patchVar(v.key, { cx: +e.target.value })} />{v.cx.toFixed(3)}</div>
                  <div style={row}>centre y<input type="range" min={0.4} max={0.6} step={0.002} value={v.cy} onChange={(e) => patchVar(v.key, { cy: +e.target.value })} />{v.cy.toFixed(3)}</div>
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
