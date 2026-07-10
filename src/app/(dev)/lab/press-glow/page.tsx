"use client";

/* Dev lab for the press glow — the composer micro-interaction from the
   Claude mobile app: touching a writing surface pools light under the
   finger (a soft radial that tracks a drag) while the surface itself
   grows a hair. Analyzed from a screen recording: the whole card
   brightens with the light concentrated at the touch, the centre of
   mass follows the finger, and text-edge ghosting in the frame diffs
   shows a ~1.01 scale while pressed.

   Implementation notes (the two standard ways):
   - a CSS-variable radial-gradient background (circle at var(--x)
     var(--y)) — simplest, but every move repaints the surface;
   - a pre-blurred glow layer moved with transform: translate3d — the
     move is compositor-only, no repaint. That's what this lab uses:
     phones are the target, and the caret drags that trigger it are
     exactly when the main thread is busiest.

   Four benches mirror the app's writing surfaces: the today zone, the
   "add something" card at rest (the initial press), the same card
   mid-edit, and an entry opened for rewriting. One dial column drives
   them all. Inks: candle (--press-highlight, light pooling under the
   hand) or wax (the recording blue — semantically loaded, here to
   compare). Theme flips live via the floating chip.

   The lab ignores reduced motion on purpose — motion is the subject;
   a production adoption must honor it. */

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

/* ── the glow surface ──────────────────────────────────────────────── */

interface GlowOpts {
  ink: "candle" | "wax";
  /** peak strength while the finger is down, 0..1 */
  strength: number;
  /** glow diameter, css px */
  size: number;
  blur: number;
  /** 0 = pinned to the finger; toward 1 = trails it (lerp per frame) */
  lag: number;
  /** scale while pressed/focused */
  grow: number;
  /** fraction of the glow kept while focused but not pressed */
  rest: number;
}

export const GLOW_DEFAULTS: GlowOpts = {
  ink: "candle",
  strength: 0.85,
  size: 340,
  blur: 24,
  lag: 0.55,
  grow: 1.012,
  rest: 0,
};

const inkGradient = (o: GlowOpts) =>
  o.ink === "candle"
    ? `radial-gradient(circle closest-side, color-mix(in srgb, var(--press-highlight) ${Math.round(o.strength * 100)}%, transparent), transparent 72%)`
    : `radial-gradient(circle closest-side, color-mix(in oklab, var(--wax) ${Math.round(o.strength * 34)}%, transparent), transparent 72%)`;

/* Wraps a writing surface. The glow is a pre-blurred disc inside an
   overflow-hidden layer under the content, moved with translate3d only
   (composited — no repaint per move); its opacity fades on the CSS
   transition. Grow is a transform on the whole surface. Handlers live
   on the wrapper and read the live dials from a ref, so dragging a
   dial retunes every bench without remounting anything. */
function GlowSurface({
  opts,
  className,
  back,
  children,
}: {
  opts: GlowOpts;
  className?: string;
  /** the surface's own paint (an opaque card background), rendered UNDER
      the glow — light pools on the paper, the words sit on the light */
  back?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
    // live-retune the visual bits that aren't per-frame
    const g = glowRef.current;
    if (g) {
      g.style.width = `${opts.size}px`;
      g.style.height = `${opts.size}px`;
      g.style.filter = `blur(${opts.blur}px)`;
      g.style.background = inkGradient(opts);
    }
  }, [opts]);

  useEffect(() => {
    const host = hostRef.current;
    const glow = glowRef.current;
    if (!host || !glow) return;
    let raf = 0;
    let down = false;
    let focused = false;
    // finger target and the glow's eased position, host-local
    let tx = 0, ty = 0, x = 0, y = 0;

    const place = () => {
      glow.style.transform = `translate3d(${x - o.current.size / 2}px, ${y - o.current.size / 2}px, 0)`;
    };
    const step = () => {
      raf = 0;
      const k = 1 - Math.min(0.95, o.current.lag);
      x += (tx - x) * k;
      y += (ty - y) * k;
      place();
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(step);
    };
    const nudge = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const level = () => {
      glow.style.opacity = down ? "1" : focused ? String(o.current.rest) : "0";
    };
    const scale = () => {
      host.style.transform = down || focused ? `scale(${o.current.grow})` : "";
    };
    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
    };
    const onDown = (e: PointerEvent) => {
      down = true;
      local(e);
      // first light lands where the finger did — no glide-in from a stale spot
      x = tx; y = ty;
      place();
      level();
      scale();
    };
    const onMove = (e: PointerEvent) => {
      if (!down && !(focused && o.current.rest > 0)) return;
      local(e);
      nudge();
    };
    const onUp = () => {
      down = false;
      level();
      scale();
    };
    const onFocusIn = () => { focused = true; level(); scale(); };
    const onFocusOut = () => { focused = false; level(); scale(); };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("pointerleave", onUp);
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("pointerleave", onUp);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      // touch-action none: on a phone, a finger dragged across the surface
      // must paint the glow — without this the browser claims the gesture
      // for page scrolling and a pointercancel snuffs the light mid-stroke.
      // The page still scrolls from the margins between benches.
      style={{ touchAction: "none" }}
      className={`relative transition-transform duration-[240ms] ease-[var(--ease-out)] ${className ?? ""}`}
    >
      {back}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <div
          ref={glowRef}
          data-glow
          className="absolute left-0 top-0 rounded-full opacity-0 transition-opacity duration-[320ms] ease-[var(--ease-out)]"
          style={{ willChange: "transform, opacity" }}
        />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

/* ── the four writing surfaces, mocked ─────────────────────────────── */

const RULES =
  "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--rule-faint) 19px, var(--rule-faint) 20px)";

function TodayBench({ opts }: { opts: GlowOpts }) {
  return (
    <GlowSurface opts={opts} className="h-[430px] w-[300px] rounded-2xl border border-wax/45">
      <div className="flex h-full flex-col items-center px-4 py-6 text-center">
        <div className="mt-10 leading-none">
          <p className="voice-label text-[0.72rem] text-ink-faint">Thursday</p>
          <h2 className="voice-display mt-1 text-[1.6rem] leading-none text-ink">July 9</h2>
        </div>
        <div className="flex-1" />
        <textarea
          rows={3}
          placeholder="What happened today…"
          className="voice-prose w-[calc(100%-28px)] resize-none bg-transparent p-0 text-[0.9rem] leading-[20px] outline-none placeholder:italic placeholder:text-wax/75"
          style={{ backgroundImage: RULES, backgroundAttachment: "local" }}
        />
        <div className="flex-1" />
        <div
          className="mb-6 size-[72px] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 28%, var(--wax-bright) 0%, var(--wax) 48%, var(--wax-deep) 100%)",
            boxShadow:
              "inset 0 1.5px 2px rgb(255 255 255/0.3), inset 0 -3px 5px rgb(0 0 0/0.3), 0 5px 12px -2px var(--wax-shadow)",
          }}
        />
      </div>
    </GlowSurface>
  );
}

function AddCardBench({ opts, editing }: { opts: GlowOpts; editing: boolean }) {
  const [text, setText] = useState(
    editing ? "Lunch with Celine's parents. Logan beforehand texts: “Good luck at brunch mish”" : "",
  );
  return (
    <div className="w-[300px]">
      <GlowSurface
        opts={opts}
        className="rounded-[6px]"
        back={
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 rounded-[6px] border bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] ${
              text ? "border-rule" : "border-rule-faint [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)]"
            }`}
          />
        }
      >
        <textarea
          rows={editing ? 4 : 1}
          value={text}
          placeholder="Add something from yesterday…"
          onChange={(e) => setText(e.target.value)}
          className="voice-prose relative block w-full resize-none bg-transparent p-2.5 text-[0.9rem] leading-[1.42] outline-none placeholder:italic placeholder:text-ink-faint"
        />
      </GlowSurface>
    </div>
  );
}

function EntryBench({ opts }: { opts: GlowOpts }) {
  const [text, setText] = useState(
    "On the bus home at around 6PM, a man got on with a cello case nearly as tall as he was and looked for a spot a few seats away from me, then asked to stand in the aisle for two more stops.",
  );
  return (
    <GlowSurface
      opts={opts}
      className="w-[300px] rounded-[10px] border border-rule-faint bg-paper shadow-[0_1px_3px_rgb(var(--shadow-hue)/0.08)]"
    >
      <div className="px-4 pt-3">
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="voice-prose block w-full resize-none whitespace-pre-wrap bg-transparent leading-[1.5] outline-none"
        />
      </div>
      <div className="flex items-center justify-end px-3 pb-3 pt-2.5">
        <span className="voice-data text-[0.62rem] lowercase text-ink-faint">rewriting…</span>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_var(--press-highlight)]"
      />
    </GlowSurface>
  );
}

/* ── the desk ──────────────────────────────────────────────────────── */

function Dial({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[0.85rem]">
      <span className="voice-data w-28 shrink-0 lowercase">
        {label} {(fmt ?? ((v: number) => v.toFixed(2)))(value)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full min-w-0"
      />
    </label>
  );
}

export default function PressGlowLab() {
  const [opts, setOpts] = useState<GlowOpts>(GLOW_DEFAULTS);
  const { resolvedTheme, setTheme } = useTheme();

  const benches: { key: string; label: string; note: string; node: React.ReactNode }[] = [
    { key: "today", label: "today zone", note: "light pooling on the open page", node: <TodayBench opts={opts} /> },
    { key: "add-rest", label: "add something · at rest", note: "the initial press, before the keyboard", node: <AddCardBench opts={opts} editing={false} /> },
    { key: "add-edit", label: "add something · editing", note: "mid-entry, caret drags included", node: <AddCardBench opts={opts} editing /> },
    { key: "entry", label: "entry view · rewriting", note: "an opened entry, words as the field", node: <EntryBench opts={opts} /> },
  ];

  return (
    <main className="fixed inset-0 z-50 overflow-auto bg-[var(--desk)] p-4 sm:p-8" data-glow-lab>
      <header className="mb-6 flex items-center gap-4">
        <h1 className="voice-display text-[1.4rem] text-ink">press glow</h1>
      </header>
      <section className="mb-10">
        <h2 className="voice-label text-[0.78rem] text-ink-soft">the desk</h2>
        <p className="voice-data mb-4 text-[0.62rem] lowercase text-ink-faint">
          touch any surface and drag — the light follows; one dial column drives all four.
          on a phone the surfaces own their touches, so scroll the page from the space between them
        </p>
        <div className="mb-8 flex w-[300px] flex-col gap-2.5 sm:w-72">
          <div className="flex items-center gap-2">
            <span className="voice-data w-28 shrink-0 lowercase">ink</span>
            {(["candle", "wax"] as const).map((ink) => (
              <button
                key={ink}
                type="button"
                onClick={() => setOpts({ ...opts, ink })}
                className={`voice-label pressable rounded-full border px-3 py-1 text-[0.68rem] ${
                  opts.ink === ink ? "border-ink text-ink" : "border-rule text-ink-soft"
                }`}
              >
                {ink}
              </button>
            ))}
          </div>
          <Dial label="strength" value={opts.strength} min={0.1} max={1} step={0.05} onChange={(v) => setOpts({ ...opts, strength: v })} />
          <Dial label="size" value={opts.size} min={120} max={560} step={10} fmt={(v) => `${v.toFixed(0)}px`} onChange={(v) => setOpts({ ...opts, size: v })} />
          <Dial label="blur" value={opts.blur} min={0} max={80} step={2} fmt={(v) => `${v.toFixed(0)}px`} onChange={(v) => setOpts({ ...opts, blur: v })} />
          <Dial label="lag" value={opts.lag} min={0} max={0.95} step={0.05} onChange={(v) => setOpts({ ...opts, lag: v })} />
          <Dial label="grow" value={opts.grow} min={1} max={1.05} step={0.002} fmt={(v) => `×${v.toFixed(3)}`} onChange={(v) => setOpts({ ...opts, grow: v })} />
          <Dial label="rest" value={opts.rest} min={0} max={1} step={0.05} onChange={(v) => setOpts({ ...opts, rest: v })} />
          <p className="voice-data text-[0.6rem] lowercase text-ink-faint">
            rest: how much light lingers while the field holds focus with no finger down
          </p>
          <button
            type="button"
            onClick={() => setOpts(GLOW_DEFAULTS)}
            className="voice-label pressable mt-1 self-start rounded-full border border-rule px-3 py-1 text-[0.68rem] text-ink-soft"
          >
            reset
          </button>
        </div>
        <div className="flex flex-wrap items-start gap-8">
          {benches.map((b) => (
            <figure key={b.key} className="m-0">
              {b.node}
              <figcaption className="voice-label mt-2 text-center text-[0.72rem] text-ink-soft">
                {b.label}
                <span className="voice-data block text-[0.62rem] lowercase text-ink-faint">{b.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      {/* paper ↔ lamplight without leaving the lab */}
      <button
        type="button"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="voice-label pressable float fixed bottom-5 right-5 z-10 rounded-full px-4 py-2 text-[0.72rem] text-ink-soft"
        suppressHydrationWarning
      >
        {resolvedTheme ? (resolvedTheme === "dark" ? "paper" : "lamplight") : "…"}
      </button>
    </main>
  );
}
