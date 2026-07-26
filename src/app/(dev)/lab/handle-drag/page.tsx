"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Selection-handle drag: what eats a DOWNWARD drag in the entry editor?
 *
 * The bug (2026-07-24): with a selection standing in the entry editor, dragging
 * its bottom handle down does nothing for seconds — the handle stays pinned to
 * the line it is on while the finger moves — then suddenly starts working.
 * Sideways drags along the line work throughout.
 *
 * BOTH ROUNDS CAME BACK CLEAN, and then the bug stopped reproducing on the
 * device at all. Round one added one app property at a time to a bare field
 * (pan-y, the press bloom's scale, the shipped touch-action relief); round two
 * — what this page is now — starts from the editor's FULL shape and behaviour
 * and removes exactly one thing per pane:
 *
 *   A the whole editor · B minus the 1.2s useContainedField re-fit ·
 *   C minus the field's own scrolling · D minus pan-y · E minus the press
 *   bloom · F minus overscroll-contain
 *
 * Every pane of both rounds let the handle through, so neither any single CSS
 * property nor the editor's shape is the cause. The write-up, with everything
 * ruled out, is BACKLOG.md #19.
 *
 * WHEN IT RECURS, READ THIS FIRST: round two was run in a SAFARI TAB, and the
 * recording was made in the standalone PWA — where iOS handles the keyboard,
 * viewport and gestures differently. So the environment that actually fails has
 * never been tested. Open this page from the HOME-SCREEN ICON before anything
 * else; pane A alone may well answer it.
 *
 * If A passes there too, the remaining hypothesis is COST rather than shape (a
 * five-element page cannot reproduce a main-thread stall over a book of
 * hundreds of live cards) — weight this page, or A/B inside the real app.
 *
 * One pane at a time, chips and field first, so the keyboard can never hide the
 * field: that is what made round one's deepest pane unreachable.
 */

const WORDS = `Went to a third pottery class today.

The teacher asked: “Before we sit down at the wheels, is anyone hoping to make a cup, a bowl, or a vase?”

I answer: “a cup on my end, but nothing with a handle yet, the last one fell off in the kiln”

Threw 2 cups out of 5 tries, and the clay was still soft by the end of it

The walk back took the long way round the square, past the fountain that hasn't run since spring, and nobody said anything about it.

Enough words here that the capped field genuinely has to scroll its own — a box that fits is a box nothing can pan, which is half of what's being tested.`;

type Cfg = {
  /** the field scrolls its own words under a max-height cap */
  capped: boolean;
  /** that cap is rewritten every 1.2s, as useContainedField does */
  refit: boolean;
  /** a scrolling card-content box between the field and the card */
  nested: boolean;
  /** the layer's swipe-back gesture claim */
  panY: boolean;
  /** the press bloom, held inflated for the whole edit */
  scale: boolean;
  /** overscroll-contain on the field and its scroller (allows a local bounce) */
  contain: boolean;
};

const APP: Cfg = {
  capped: true, refit: true, nested: true, panY: true, scale: true, contain: true,
};

const VARIANTS: { key: string; title: string; note: string; cfg: Cfg }[] = [
  {
    key: "app",
    title: "A · the editor, whole",
    note: "the baseline — start here",
    cfg: APP,
  },
  {
    key: "norefit",
    title: "B · minus the 1.2s re-fit",
    note: "its height is written once, not on a timer",
    cfg: { ...APP, refit: false },
  },
  {
    key: "nocap",
    title: "C · minus the field's own scrolling",
    note: "it grows to its words, so nothing under the finger pans",
    cfg: { ...APP, capped: false, refit: false },
  },
  {
    key: "nopany",
    title: "D · minus touch-action: pan-y",
    note: "no wrapper claims the gesture",
    cfg: { ...APP, panY: false },
  },
  {
    key: "noscale",
    title: "E · minus the press bloom",
    note: "the card isn't held at scale(1.0195)",
    cfg: { ...APP, scale: false },
  },
  {
    key: "nocontain",
    title: "F · minus overscroll-contain",
    note: "the field declines its rubber-band bounce",
    cfg: { ...APP, contain: false },
  },
];

function Field({ cfg }: { cfg: Cfg }) {
  const [text, setText] = useState(WORDS);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // the cap, exactly as useContainedField computes it: the visible bottom read
  // from the visual viewport (iOS reports offsetTop document-relative, so
  // pageTop minus the document scroll is the offset in layout coordinates),
  // minus the field's top. Re-fit on an interval only when the variant says so.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // grow to the words first — the app autosizes the field and THEN caps it
    // (autosizeArea + useContainedField). Without the grow a capped textarea
    // sits at its default two rows, which is no test of anything.
    el.style.maxHeight = "";
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (!cfg.capped) return;
    const vv = window.visualViewport;
    const fit = () => {
      const a = areaRef.current;
      if (!a) return;
      const doc = document.scrollingElement?.scrollTop ?? 0;
      const visBottom = vv ? vv.pageTop - doc + vv.height : window.innerHeight;
      const top = a.getBoundingClientRect().top;
      a.style.maxHeight = `${Math.max(120, Math.round(visBottom - top - 12))}px`;
    };
    fit();
    const timers = [300, 700].map((ms) => setTimeout(fit, ms));
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    const iv = cfg.refit ? setInterval(fit, 1200) : undefined;
    return () => {
      timers.forEach(clearTimeout);
      if (iv) clearInterval(iv);
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
    };
  }, [cfg.capped, cfg.refit, text]);

  const field = (
    <textarea
      ref={areaRef}
      value={text}
      onChange={(e) => setText(e.target.value)}
      aria-label="test field"
      className={
        "voice-prose block w-full resize-none whitespace-pre-wrap bg-transparent " +
        "text-[0.9rem] leading-[1.42] outline-none [overflow-wrap:anywhere]" +
        (cfg.capped ? " overflow-y-auto" : "") +
        (cfg.contain ? " overscroll-contain" : "")
      }
      style={cfg.contain ? undefined : { overscrollBehavior: "auto" }}
    />
  );

  // card content scroller → card → bloom wrapper → layer, outward
  let tree = cfg.nested ? (
    <div
      className={
        "relative min-h-0 flex-initial overflow-y-auto overflow-x-hidden px-4 pt-3" +
        (cfg.contain ? " overscroll-contain" : "")
      }
    >
      {field}
    </div>
  ) : (
    <div className="px-4 pt-3">{field}</div>
  );

  tree = (
    <div
      className={
        "relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[10px] " +
        "border [border-color:var(--card-seat-border)] bg-paper pb-3"
      }
    >
      {tree}
    </div>
  );
  if (cfg.scale) tree = <div style={{ transform: "scale(1.0195)" }}>{tree}</div>;
  if (cfg.panY) tree = <div style={{ touchAction: "pan-y" }}>{tree}</div>;
  return tree;
}

export default function HandleDragLab() {
  const [pick, setPick] = useState(0);
  const v = VARIANTS[pick];
  return (
    <main className="flex flex-col gap-3 px-1 pb-8 pt-1">
      <div className="flex flex-wrap gap-1.5">
        {VARIANTS.map((x, i) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setPick(i)}
            className={
              "pressable voice-label rounded-full border px-3 py-1.5 text-[0.72rem] " +
              (i === pick
                ? "border-transparent bg-ink text-paper"
                : "[border-color:var(--rule-faint)] bg-paper text-ink-soft")
            }
          >
            {x.title.split(" · ")[0]}
          </button>
        ))}
      </div>

      {/* The field comes FIRST, right under the chips: with the keyboard up
          there is barely 400px of screen, and prose above the field is what
          pushed the last round's deepest pane off it entirely. The lit chip
          says which pane you're on; the words below are for reading before you
          start, when the keyboard is still down.

          Remounted on every change of variant, so no pane inherits another's
          field state — a half-scrolled box would confound the next reading. */}
      <Field key={v.key} cfg={v.cfg} />

      <p className="voice-label text-ink-soft">
        {v.title} — <span className="text-ink-faint">{v.note}</span>
      </p>
      <p className="voice-prose-sm text-ink-faint">
        Select a word in line one, then drag the bottom handle down two lines.
        Try each pane a few times, and again after a reload.
      </p>
      <p className="voice-prose-sm text-ink-faint">
        Open this from the home-screen icon, not a Safari tab — the installed
        app is where the drag has failed, and it is the one place these panes
        have never been tried.
      </p>
    </main>
  );
}
