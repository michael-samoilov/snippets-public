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
  /** the bright CORE's diameter, css px */
  size: number;
  /** the core's blur */
  blur: number;
  /** the AMBIENT halo: its diameter as a multiple of the core's — sized to
      reach the whole element, the Liquid-Glass "everything lifts a little" */
  reach: number;
  /** the ambient halo's strength as a fraction of the core's */
  ambient: number;
  /** 0 = pinned to the finger; toward 1 = trails it (lerp per frame) */
  lag: number;
  /** visual bloom while pressed/focused — normalized so every surface grows
      the same visible amount regardless of its own size */
  grow: number;
  /** fraction of the glow kept while focused but not pressed */
  rest: number;
  /** how high the card floats off the desk: 0 = the house hairline + tight
      shadow; 1 = the Claude-app look — borderless, a wide soft drop. Warm
      (--shadow-hue), never gray, per the light rules. */
  lift: number;
}

/* per-theme recipes (owner-tuned), candle in both: Paper runs a big, strong
   pool with a heavy ambient — the cream leaves so little luminance headroom
   that presence has to come from area, not intensity — while Lamplight's
   candle carries at low strength, so it goes smaller, softer, and wider */
export const GLOW_DEFAULTS: GlowOpts = {
  ink: "candle",
  strength: 0.7,
  size: 410,
  blur: 32,
  reach: 2.1,
  ambient: 0.8,
  lag: 0.55,
  grow: 1.016,
  rest: 0,
  lift: 0.1,
};

export const GLOW_DEFAULTS_DARK: GlowOpts = {
  ink: "candle",
  strength: 0.4,
  size: 210,
  blur: 46,
  reach: 3.6,
  ambient: 0.35,
  lag: 0.65,
  grow: 1.016,
  rest: 0,
  lift: 0.1,
};

const defaultsFor = (theme: string | undefined) =>
  theme === "dark" ? GLOW_DEFAULTS_DARK : GLOW_DEFAULTS;

/* the card's seat on the desk, from printed-flat to floating: the shadow
   widens and softens as the border hands separation over to the light */
const liftShadows = (L: number) =>
  [
    `0 ${(2 + 10 * L).toFixed(1)}px ${(6 + 28 * L).toFixed(1)}px rgb(var(--shadow-hue) / ${(0.05 + 0.08 * L).toFixed(3)})`,
    `0 ${(1 + 2 * L).toFixed(1)}px ${(3 + 6 * L).toFixed(1)}px rgb(var(--shadow-hue) / ${(0.04 + 0.05 * L).toFixed(3)})`,
  ].join(", ");
const liftBorder = (L: number) =>
  `color-mix(in srgb, var(--rule-faint) ${Math.round((1 - L) * 100)}%, transparent)`;
/* the ghost add-card's seat: its fade mask clips anything painted outside
   the border box, so an outer box-shadow simply never renders on it — and
   filter runs BEFORE mask on the same element, so the shadow must come from
   a drop-shadow() on an unmasked parent, where it dissolves with the faded
   card beneath. Blur halved: drop-shadow blur ≈ box-shadow blur / 2 */
const liftDropShadow = (L: number) =>
  [
    `drop-shadow(0 ${(2 + 10 * L).toFixed(1)}px ${((6 + 28 * L) / 2).toFixed(1)}px rgb(var(--shadow-hue) / ${(0.05 + 0.08 * L).toFixed(3)}))`,
    `drop-shadow(0 ${(1 + 2 * L).toFixed(1)}px ${((3 + 6 * L) / 2).toFixed(1)}px rgb(var(--shadow-hue) / ${(0.04 + 0.05 * L).toFixed(3)}))`,
  ].join(" ");
const liftStyle = (L: number): React.CSSProperties => ({
  boxShadow: `inset 0 1px 0 var(--press-highlight), ${liftShadows(L)}`,
  borderColor: liftBorder(L),
});

/* the inks. Candle is the per-theme --glow-ink token (globals.css — the
   production glow shares it): in Paper it's pure white — light must
   genuinely WHITEN the sheet, pushing cream toward paper-white (a gold-only
   tint read as colour, not luminance; and the ink sits under the words, so
   the text stays dark while the page brightens); in Lamplight it's the warm
   gold that already reads as a candle. Wax mixes harder than the wash does:
   a press is a moment, not an ambience. */
const inkColor = (o: GlowOpts, a: number) =>
  o.ink === "candle"
    ? `color-mix(in srgb, var(--glow-ink) ${Math.round(a * 100)}%, transparent)`
    : `color-mix(in oklab, var(--wax) ${Math.round(a * 52)}%, transparent)`;

const coreGradient = (o: GlowOpts) =>
  `radial-gradient(circle closest-side, ${inkColor(o, o.strength)}, transparent 72%)`;
const ambientGradient = (o: GlowOpts) =>
  `radial-gradient(circle closest-side, ${inkColor(o, o.strength * o.ambient)}, transparent 78%)`;

/* Wraps a writing surface. The glow is a pre-blurred disc inside an
   overflow-hidden layer under the content, moved with translate3d only
   (composited — no repaint per move); its opacity fades on the CSS
   transition. Grow is a transform on the whole surface. Handlers live
   on the wrapper and read the live dials from a ref, so dragging a
   dial retunes every bench without remounting anything. */
function GlowSurface({
  opts,
  className,
  style,
  back,
  children,
}: {
  opts: GlowOpts;
  className?: string;
  style?: React.CSSProperties;
  /** the surface's own paint (an opaque card background), rendered UNDER
      the glow — light pools on the paper, the words sit on the light */
  back?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
    // live-retune the visual bits that aren't per-frame
    const g = glowRef.current, c = coreRef.current, amb = ambientRef.current;
    if (g && c && amb) {
      g.style.width = `${opts.size}px`;
      g.style.height = `${opts.size}px`;
      c.style.width = `${opts.size}px`;
      c.style.height = `${opts.size}px`;
      c.style.filter = `blur(${opts.blur}px)`;
      c.style.background = coreGradient(opts);
      const d = Math.round(opts.size * opts.reach);
      amb.style.width = `${d}px`;
      amb.style.height = `${d}px`;
      amb.style.filter = `blur(${opts.blur * 3}px)`;
      amb.style.background = ambientGradient(opts);
    }
  }, [opts]);

  useEffect(() => {
    const host = hostRef.current;
    const glow = glowRef.current;
    if (!host || !glow) return;
    let raf = 0;
    let down = false;
    let focused = false;
    // the scroll took the pointer, the glow rides the moving card
    let riding = false;
    // …and on iOS, touch events outlive the cancelled pointer: the finger
    // is still individually trackable while the page scrolls
    let touchLive = false;
    let settle = 0;
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
      glow.style.opacity = down || riding ? "1" : focused ? String(o.current.rest) : "0";
    };
    const scale = () => {
      if (down || focused || riding) {
        // normalize the bloom: the dial's value is calibrated on the today
        // zone (~525px diagonal); smaller surfaces scale proportionally MORE
        // so every card visibly grows by the same few pixels — a uniform
        // factor left the one-line add card's half-pixel bloom imperceptible
        const r = host.getBoundingClientRect();
        const diag = Math.max(120, Math.hypot(r.width, r.height));
        const eff = Math.min(1.06, 1 + (o.current.grow - 1) * (525 / diag));
        host.style.transform = `scale(${eff})`;
      } else {
        host.style.transform = "";
      }
    };
    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
    };
    const onDown = (e: PointerEvent) => {
      if (riding) settleRide(); // a new press takes over from a live ride
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
    /* when a drag turns into a page scroll, the browser claims the gesture
       with a pointercancel and delivers no more POINTER events — but iOS
       keeps streaming TOUCH events to the gesture's original target for the
       rest of the gesture. So while riding a scroll the glow follows the
       finger for real from touchmove (side-to-side drift included; the
       host's rect is re-read each event because the card itself is moving),
       and the ride ends when the finger lifts (touchend). Where touches die
       with the pointer (Android's touchcancel, before any move arrives),
       fall back to the pinned-card ride: in a 1:1 drag the finger and the
       content move together anyway, and the light slips away once the page
       settles (or promptly, if no scroll follows the cancel at all). */
    const settleRide = () => {
      riding = false;
      touchLive = false;
      clearTimeout(settle);
      window.removeEventListener("scroll", onScrollRide, true);
      host.removeEventListener("touchmove", onRideMove);
      host.removeEventListener("touchend", onRideEnd);
      host.removeEventListener("touchcancel", onRideEnd);
      level();
      scale();
    };
    const onScrollRide = () => {
      if (touchLive) return; // the finger is tracked; touchend ends the ride
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 220);
    };
    const onRideMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!riding || !t) return;
      touchLive = true;
      // quiet-finger guard: the light must never strand after a lift, so a
      // ride survives only while touches keep arriving — a missed touchend
      // (or a finger gone still after the pointer was cancelled) fades it
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 700);
      const r = host.getBoundingClientRect();
      tx = t.clientX - r.left;
      ty = t.clientY - r.top;
      nudge();
    };
    const onRideEnd = (e: TouchEvent) => {
      // a touchcancel before any move is the touches dying with the pointer
      // (Android) — keep the pinned ride and let the scroll settle it
      if (e.type === "touchcancel" && !touchLive) return;
      if (riding) settleRide();
    };
    const onCancel = () => {
      if (!down) return;
      down = false;
      riding = true;
      window.addEventListener("scroll", onScrollRide, true);
      host.addEventListener("touchmove", onRideMove, { passive: true });
      host.addEventListener("touchend", onRideEnd);
      host.addEventListener("touchcancel", onRideEnd);
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 340);
    };
    const onFocusIn = () => { focused = true; level(); scale(); };
    const onFocusOut = () => { focused = false; level(); scale(); };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    host.addEventListener("pointerleave", onUp);
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("scroll", onScrollRide, true);
      host.removeEventListener("touchmove", onRideMove);
      host.removeEventListener("touchend", onRideEnd);
      host.removeEventListener("touchcancel", onRideEnd);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      host.removeEventListener("pointerleave", onUp);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      // pan-y: sideways strokes belong to the glow, vertical drags may
      // become a page scroll — when the browser takes one (pointercancel),
      // the ride logic above keeps the light on the card until it settles.
      // (touch-action: none was tried; iOS scrolled anyway AND snuffed the
      // light, the worst of both)
      style={{ touchAction: "pan-y", ...style }}
      className={`relative transition-transform duration-[500ms] ease-[var(--ease-bloom)] ${className ?? ""}`}
    >
      {back}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        {/* one translated wrapper carries BOTH lights, so tracking stays a
            single compositor transform: the tight bright core at the finger,
            and the wide soft ambient halo that lifts the whole surface —
            the Liquid-Glass read (everything brightens, most at the touch) */}
        <div
          ref={glowRef}
          data-glow
          className="absolute left-0 top-0 opacity-0 transition-opacity duration-[320ms] ease-[var(--ease-out)]"
          style={{ willChange: "transform, opacity" }}
        >
          <div
            ref={ambientRef}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
          <div
            ref={coreRef}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
        </div>
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
          text ? (
            <span
              aria-hidden
              style={liftStyle(opts.lift)}
              className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule bg-paper"
            />
          ) : (
            /* two nodes, deliberately: on one element the fade mask is applied
               LAST (after filter), clipping any shadow to the border box — so
               the drop-shadow sits on an unmasked parent, shadowing the
               already-faded card. The lift dissolves with the ghost. */
            <span aria-hidden className="pointer-events-none absolute inset-0" style={{ filter: liftDropShadow(opts.lift) }}>
              <span
                className="absolute inset-0 rounded-[6px] border bg-paper [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)]"
                style={{ boxShadow: "inset 0 1px 0 var(--press-highlight)", borderColor: liftBorder(opts.lift) }}
              />
            </span>
          )
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
      className="w-[300px] rounded-[10px] border border-rule-faint bg-paper"
      style={liftStyle(opts.lift)}
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

  /* every theme flip brings back that theme's own recipe — the dials are
     per-theme tunings, not one shared draft (owner's call: tweaks don't
     carry across; reset to compare the stock recipes any time).
     Deferred a frame so it lands after hydration: the server always renders
     the Paper recipe, and swapping during the hydration pass mismatches it */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setReady(true);
      setOpts(defaultsFor(resolvedTheme));
    });
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

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
          vertical drags scroll the page: the light follows the finger through the scroll and leaves when it lifts
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
          <Dial label="core size" value={opts.size} min={100} max={480} step={10} fmt={(v) => `${v.toFixed(0)}px`} onChange={(v) => setOpts({ ...opts, size: v })} />
          <Dial label="core blur" value={opts.blur} min={0} max={60} step={2} fmt={(v) => `${v.toFixed(0)}px`} onChange={(v) => setOpts({ ...opts, blur: v })} />
          <Dial label="reach" value={opts.reach} min={1.2} max={4} step={0.1} fmt={(v) => `×${v.toFixed(1)}`} onChange={(v) => setOpts({ ...opts, reach: v })} />
          <Dial label="ambient" value={opts.ambient} min={0} max={1} step={0.05} onChange={(v) => setOpts({ ...opts, ambient: v })} />
          <Dial label="lag" value={opts.lag} min={0} max={0.95} step={0.05} onChange={(v) => setOpts({ ...opts, lag: v })} />
          <Dial label="grow" value={opts.grow} min={1} max={1.05} step={0.002} fmt={(v) => `×${v.toFixed(3)}`} onChange={(v) => setOpts({ ...opts, grow: v })} />
          <Dial label="rest" value={opts.rest} min={0} max={1} step={0.05} onChange={(v) => setOpts({ ...opts, rest: v })} />
          <Dial label="lift" value={opts.lift} min={0} max={1} step={0.05} onChange={(v) => setOpts({ ...opts, lift: v })} />
          <p className="voice-data text-[0.6rem] lowercase text-ink-faint">
            lift: the card&apos;s seat on the desk — 0 is the house hairline, 1 floats it on a wide soft shadow (the claude-app card)
          </p>
          <p className="voice-data text-[0.6rem] lowercase text-ink-faint">
            rest: how much light lingers while the field holds focus with no finger down
          </p>
          <button
            type="button"
            onClick={() => setOpts(defaultsFor(resolvedTheme))}
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
      >
        {/* gated on ready, not just resolvedTheme: next-themes knows the theme
            during hydration already, and a label the server didn't render would
            either mismatch or (suppressed) never get patched over the "…" */}
        {ready && resolvedTheme ? (resolvedTheme === "dark" ? "paper" : "lamplight") : "…"}
      </button>
    </main>
  );
}
