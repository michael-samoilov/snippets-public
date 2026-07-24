"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Selection-handle drag: which ancestor property eats a DOWNWARD drag?
 *
 * The bug (2026-07-24): in the entry editor, dragging the selection's bottom
 * handle down does nothing for seconds — the handle stays pinned to the line
 * it's on while the finger moves — then suddenly starts working. Sideways
 * drags along the line work throughout.
 *
 * Real WebKit clears the DOM: a synthetic drag over the app's own editor
 * extends the selection downward fine (scripts/measure-webkit-drag-select.py),
 * and elementFromPoint finds the textarea, selectable, at every step. So the
 * refusal is iOS's own gesture arbitration — UIKit deciding the pan recogniser
 * owns a vertical drag — and no engine off the device can reproduce it.
 *
 * Hence this page: the same drag against one variable at a time. Each pane is
 * a textarea inside a wrapper carrying ONE app-shaped property. Select a word
 * in the FIRST line, then drag the bottom handle straight down two lines.
 *
 * The prediction under test: 2 fails, 3 works (3 is 2 plus the shipped rule),
 * and the transform panes are innocent. If instead 4 fails, the press bloom —
 * held inflated all through an edit — is the culprit and the fix belongs in
 * press-glow, not the stylesheet.
 */

/* Short enough that panes 1–4 hold it WITHOUT scrolling. That matters: a field
   that scrolls its own words is itself a scroll container, which changes where
   the touch-action walk stops — so keeping the field un-scrolled leaves exactly
   one variable per pane. Pane 5 is the scrolling one, on purpose. */
const WORDS = `Went to a third pottery class today.

The teacher asked: “Before we sit down at the wheels, is anyone hoping to make a cup, a bowl, or a vase?”

I answer: “a cup please”`;

type Pane = {
  key: string;
  title: string;
  note: string;
  expect: string;
  /** props for the wrapper that sits between the page and the field */
  wrap: React.HTMLAttributes<HTMLDivElement> & { "data-layer"?: string };
};

const PANES: Pane[] = [
  {
    key: "bare",
    title: "1 · bare field",
    note: "no wrapper properties at all — a plain textarea",
    expect: "should work",
    wrap: {},
  },
  {
    key: "pany",
    title: "2 · ancestor touch-action: pan-y",
    note: "what the book's layers set to own the swipe-back",
    expect: "the suspect — should FAIL",
    wrap: { style: { touchAction: "pan-y" } },
  },
  {
    key: "relief",
    title: "3 · pan-y + the shipped relief",
    note: "same pan-y, but the wrapper carries data-layer, so the new rule " +
      "drops the restriction while the field has focus",
    expect: "the fix — should work",
    wrap: { "data-layer": "lab", style: { touchAction: "pan-y" } },
  },
  {
    key: "scale",
    title: "4 · ancestor transform: scale(1.0195)",
    note: "the press bloom, which stays inflated for the whole edit",
    expect: "should work (if it fails, the bloom is the cause)",
    wrap: { style: { transform: "scale(1.0195)" } },
  },
  {
    key: "both",
    title: "5 · pan-y + scale, nested scrollers",
    note: "the entry editor's real shape, with no relief",
    expect: "should FAIL like the app",
    wrap: { style: { touchAction: "pan-y", transform: "scale(1.0195)" } },
  },
];

function Pane({ pane }: { pane: Pane }) {
  const [text, setText] = useState(WORDS);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const nested = pane.key === "both";
  // grow to the words so the field never scrolls its own text — a scrolling
  // field is itself a scroll container, which would add a second variable to
  // panes meant to carry exactly one. (`rows` can't do this: how many lines the
  // words wrap to depends on the device's width.)
  useEffect(() => {
    const el = areaRef.current;
    if (!el || nested) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, nested]);
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="voice-label text-ink-soft">{pane.title}</h2>
      <p className="voice-prose-sm text-ink-faint">{pane.note}</p>
      <p className="voice-data text-ink-faint">{pane.expect}</p>
      <div {...pane.wrap}>
        <div
          className={
            "relative rounded-[10px] border [border-color:var(--card-seat-border)] " +
            "bg-paper px-4 pb-3 pt-3" +
            (nested ? " max-h-[190px] overflow-y-auto overscroll-contain" : "")
          }
        >
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`${pane.title} field`}
            className={
              "voice-prose block w-full resize-none overscroll-contain whitespace-pre-wrap " +
              "bg-transparent leading-[1.5] outline-none [overflow-wrap:anywhere]" +
              (nested ? " max-h-[164px] overflow-y-auto" : "")
            }
            rows={nested ? 7 : 9}
          />
        </div>
      </div>
    </section>
  );
}

export default function HandleDragLab() {
  return (
    <main className="mx-auto flex max-w-[46rem] flex-col gap-7 px-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="voice-display text-[1.6rem]">Selection handle drag</h1>
        <p className="voice-prose">
          In each pane: tap a word in the <em>first</em> line to select it, then
          drag the bottom handle straight down past two lines. Note which panes
          let the handle follow your finger and which pin it to the first line.
        </p>
        <p className="voice-prose-sm text-ink-faint">
          Read the panes in order — the answer is which of 2 and 3 behave
          differently. iPhone only: this is a UIKit gesture question, so a
          desktop browser will pass every pane.
        </p>
      </header>
      {PANES.map((p) => (
        <Pane key={p.key} pane={p} />
      ))}
    </main>
  );
}
