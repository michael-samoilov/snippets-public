"use client";

/* TEMPORARY dev harness for iterating and comparing the wax-stamp press.
   Not linked anywhere; removed before the feature ships. */

import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

// the chosen icon per type, with a per-icon size so their stroke weights match
// (quill at 0.36 is the reference; the thin Fine mic needs to be larger). S sizes
// itself, so its scale is unused. Glyphs: Zest = "e:", Fine = "c:", extras = bare.
const ICON_CHOICES: { glyph: string; label: string; scale: number }[] = [
  { glyph: "S", label: "S", scale: 0.4 },
  { glyph: "e:quill", label: "quill", scale: 0.36 },
  { glyph: "c:mic", label: "mic", scale: 0.46 },
  { glyph: "caldots", label: "calendar", scale: 0.36 },
  { glyph: "eye", label: "eye", scale: 0.36 },
  { glyph: "joke", label: "joke", scale: 0.36 },
];

const EASES = ["even", "front", "snap"] as const;
const EXITS = ["fade", "rise", "shrink", "grow"] as const;
type EaseT = (typeof EASES)[number];
type ExitT = (typeof EXITS)[number];

// candidate stamp colours to preview (the app ships ONE semantic wax blue; these
// are an exploration for the categorisation moonshot, sandboxed to the lab). Each
// hue comes in a deep tone (rich, navy-like) and a soft pastel tone. Metals
// (gold · bronze=rose · silver) are grouped at the end — they carry the cloud/glint.
const HUES = ["navy", "red", "teal", "plum", "gold", "rose", "silver"] as const;
const METAL_HUES = ["gold", "rose", "silver"];
const DEEP: Record<string, Tint | undefined> = {
  navy: { wax: "#2e5685", bright: "#3d6b9e", shadow: "#234468" }, // Paper's deep blue, fixed so Lamplight matches it
  red: { wax: "#7e2c27", bright: "#a8534a", shadow: "#2a0a07" },
  gold: { wax: "#cd8a16", bright: "#eebe54", shadow: "#3e2606" },
  teal: { wax: "#225247", bright: "#3a8475", shadow: "#082420" },
  plum: { wax: "#4f2c54", bright: "#7a4a80", shadow: "#1e1022" },
  rose: { wax: "#7c3e2c", bright: "#a86048", shadow: "#2a0f08" },
  silver: { wax: "#8a919b", bright: "#edf1f6", shadow: "#363c44" },
};
const PASTEL: Record<string, Tint> = {
  navy: { wax: "#9bb6da", bright: "#bcd0e8", shadow: "#3c587c" },
  red: { wax: "#d99e96", bright: "#e9c2bc", shadow: "#6e3a34" },
  gold: { wax: "#eaca80", bright: "#f5e0b0", shadow: "#6c501e" },
  teal: { wax: "#97c4b6", bright: "#bedfd3", shadow: "#2c5048" },
  plum: { wax: "#b89cc9", bright: "#d2c0de", shadow: "#4e3a58" },
  rose: { wax: "#d6a895", bright: "#e8c8ba", shadow: "#6e4030" },
  silver: { wax: "#e6e9ed", bright: "#f6f8fa", shadow: "#5c636b" },
};
// bump this string every push so it's obvious on-screen which build is live
const BUILD = "build 30 · 2026-06-18 · per-icon sizes + whiter pastel silver";

// shared design values handed to every wax drop in the carousel
type Design = {
  size: number; tint?: Tint; puck: number; cloud: number; speckle: number;
  iconMult: number; ease: EaseT; bounce: number; rotate: number;
  lingerMs: number; exitMs: number; exit: ExitT; restPressed: boolean; themeKey: string;
};

// a swipeable strip of wax drops, one per icon. The centred drop is emphasised
// and stampable (tap the seal to play); neighbours peek de-emphasised on either
// side. A translated flex track (not native scroll) so the de-emphasis is exact;
// drag/swipe or wheel to move, tap a neighbour to bring it centre, tap the centre
// seal to stamp it. Only the seal is a tap target — the surrounding band is not.
function IconCarousel({ d }: { d: Design }) {
  const band = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const moved = useRef(false);
  const wheelLock = useRef(0);
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pressedIdx, setPressedIdx] = useState<number | null>(null);
  const [playKeys, setPlayKeys] = useState<number[]>(() => ICON_CHOICES.map(() => 0));
  const N = ICON_CHOICES.length;
  const STEP = Math.round(d.size * 1.08);   // spacing between drop centres
  const STRIP_H = Math.round(d.size * 1.5);
  const clampIdx = (i: number) => Math.max(0, Math.min(N - 1, i));
  const stamp = (i: number) => setPlayKeys((p) => { const n = [...p]; n[i]++; return n; });

  // which drop (if any) sits under a screen point — a seal, not the band
  const idxUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const w = el?.closest("[data-idx]") as HTMLElement | null;
    return w ? Number(w.dataset.idx) : -1;
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startX.current = e.clientX; moved.current = false;
    setDragging(true);
    band.current?.setPointerCapture(e.pointerId);
    if (!d.restPressed && idxUnder(e.clientX, e.clientY) === active) setPressedIdx(active);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 4) { moved.current = true; setPressedIdx(null); }
    setDrag(dx);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    band.current?.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    setPressedIdx(null);
    const dx = e.clientX - startX.current;
    setDrag(0);
    if (moved.current) {                 // a swipe → snap by however many steps
      if (Math.abs(dx) > 8) {
        const steps = Math.round(dx / STEP);
        setActive((a) => clampIdx(a + (steps !== 0 ? -steps : dx < 0 ? 1 : -1)));
      }
      return;
    }
    const i = idxUnder(e.clientX, e.clientY);   // a tap
    if (i < 0) return;                          // tapped the band, not a seal
    if (i === active) { if (!d.restPressed) stamp(i); }
    else setActive(i);
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const dom = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(dom) < 6) return;
    const now = performance.now();
    if (now < wheelLock.current) return;
    wheelLock.current = now + 260;
    setActive((a) => clampIdx(a + (dom > 0 ? 1 : -1)));
  };

  const centre = active - drag / STEP;   // fractional centre, follows the drag
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={band}
        className="relative select-none overflow-hidden"
        style={{ height: STRIP_H, touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <div
          className="absolute top-0 left-1/2 flex h-full items-center"
          style={{
            transform: `translateX(${(-(centre * STEP) - STEP / 2).toFixed(2)}px)`,
            transition: dragging ? "none" : "transform .34s cubic-bezier(.23,1,.32,1)",
          }}
        >
          {ICON_CHOICES.map((c, i) => {
            const k = Math.max(0, 1 - Math.min(1, Math.abs(i - centre)));  // 1 centred → 0 a slide away
            return (
              <div
                key={c.glyph}
                className="flex shrink-0 items-center justify-center"
                style={{ width: STEP, height: STRIP_H, transform: `scale(${(0.6 + 0.4 * k).toFixed(3)})`, opacity: 0.5 + 0.5 * k }}
              >
                <div data-idx={i} style={{ width: d.size, height: d.size }} className="grid place-items-center">
                  <WaxStamp
                    key={`${d.themeKey}-${i}`}
                    playKey={playKeys[i]}
                    size={d.size}
                    glyph={c.glyph}
                    variant="spring"
                    ease={d.ease}
                    bounce={d.bounce}
                    rotate={d.rotate}
                    mode="tap"
                    lingerMs={d.lingerMs}
                    exitMs={d.exitMs}
                    exit={d.exit}
                    tint={d.tint}
                    puck={d.puck}
                    iconScale={c.scale * d.iconMult}
                    speckle={d.speckle}
                    cloud={d.cloud}
                    pressed={pressedIdx === i || (d.restPressed && i === active)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* edge hints: more drops to swipe to */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16" style={{ background: "linear-gradient(to right, var(--paper), transparent)" }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16" style={{ background: "linear-gradient(to left, var(--paper), transparent)" }} />
      </div>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          data-replay
          onClick={() => { if (!d.restPressed) stamp(active); }}
          className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper"
        >
          Replay
        </button>
        <span className="voice-data">{ICON_CHOICES[active].label} · play #{playKeys[active]}</span>
      </div>
    </div>
  );
}

export default function StampLab() {
  const [size, setSize] = useState(160);
  const [iconMult, setIconMult] = useState(1);
  const [ease, setEase] = useState<EaseT>("front");
  const [bounce, setBounce] = useState(1.5);
  const [rotate, setRotate] = useState(30);
  const [puck, setPuck] = useState(1);
  const [cloud, setCloud] = useState(0.5);
  const [speckle, setSpeckle] = useState(0);
  const [linger, setLinger] = useState(1000);
  const [exitMs, setExitMs] = useState(200);
  const [exit, setExit] = useState<ExitT>("grow");
  const [hue, setHue] = useState<(typeof HUES)[number]>("navy");
  const [tone, setTone] = useState<"deep" | "pastel">("deep");
  const [restPressed, setRestPressed] = useState(false);
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const tint = tone === "deep" ? DEEP[hue] : PASTEL[hue];

  const d: Design = {
    size, tint, puck, cloud, speckle, iconMult, ease, bounce, rotate,
    lingerMs: linger, exitMs, exit, restPressed, themeKey: `${theme}-${hue}-${tone}`,
  };

  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${
      active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="voice-label">wax-stamp lab</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">
        {BUILD}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className={chip(false)}>
          {dark ? "Lamplight" : "Paper"}
        </button>
        <button type="button" onClick={() => setRestPressed((v) => !v)} className={chip(restPressed)}>
          resting {restPressed ? "pressed" : "unpressed"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {(["deep", "pastel"] as const).map((tn) => (
          <div key={tn} className="flex flex-wrap items-center gap-2">
            <span className="voice-label w-14 text-ink-faint">{tn}</span>
            {HUES.map((h) => {
              const t = tn === "deep" ? DEEP[h] : PASTEL[h];
              const active = hue === h && tone === tn;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => { setHue(h); setTone(tn); }}
                  title={`${h} ${tn}`}
                  className={`size-7 rounded-full border ${active ? "border-ink ring-2 ring-wax" : "border-rule-faint"}`}
                  style={{ background: t?.wax ?? "var(--wax)" }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* the icon picker: swipe to a drop, tap the centre seal to stamp it */}
      <IconCarousel d={d} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-24">size {size}</span>
          <input type="range" min={48} max={260} step={4} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-28">icon ×{iconMult.toFixed(2)}</span>
          <input type="range" min={0.6} max={1.5} step={0.05} value={iconMult} onChange={(e) => setIconMult(+e.target.value)} />
        </label>
        <span className="voice-data text-ink-faint">{METAL_HUES.includes(hue) ? "metal" : "matte"}</span>
      </div>

      {/* confirmed/locked values — collapsed; the summary shows them at a glance */}
      <details className="rounded-[8px] border border-rule-faint bg-paper px-4 py-2.5">
        <summary className="voice-label cursor-pointer select-none text-ink-soft">
          locked — spring · front · bounce {bounce.toFixed(1)}× · rotate {rotate}° · puck {puck.toFixed(2)} · cloud {cloud.toFixed(2)} · speckle {speckle.toFixed(2)} · linger {linger}ms · exit {exit} {exitMs}ms
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="voice-label text-ink-faint">ease</span>
            {EASES.map((e) => (
              <button key={e} type="button" onClick={() => setEase(e)} className={chip(ease === e)}>{e}</button>
            ))}
            <span className="voice-label ml-3 text-ink-faint">exit</span>
            {EXITS.map((x) => (
              <button key={x} type="button" onClick={() => setExit(x)} className={chip(exit === x)}>{x}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-24">bounce {bounce.toFixed(1)}×</span>
              <input type="range" min={0} max={2.6} step={0.1} value={bounce} onChange={(e) => setBounce(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-24">rotate {rotate}°</span>
              <input type="range" min={0} max={60} step={5} value={rotate} onChange={(e) => setRotate(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-24">puck {puck.toFixed(2)}</span>
              <input type="range" min={0} max={2} step={0.05} value={puck} onChange={(e) => setPuck(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-24">cloud {cloud.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.05} value={cloud} onChange={(e) => setCloud(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-24">speckle {speckle.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.05} value={speckle} onChange={(e) => setSpeckle(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-28">linger {linger}ms</span>
              <input type="range" min={0} max={3000} step={100} value={linger} onChange={(e) => setLinger(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-28">exit {exitMs}ms</span>
              <input type="range" min={120} max={1200} step={30} value={exitMs} onChange={(e) => setExitMs(+e.target.value)} />
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
