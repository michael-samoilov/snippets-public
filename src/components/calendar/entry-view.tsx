"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { useScrollEdges } from "@/components/ui/scroll-terminus";
import { PressGlow } from "@/components/capture/press-glow";
import { useContainedField } from "@/hooks/use-contained-field";
import { updateSnippet } from "@/lib/db";
import { copy } from "@/lib/copy";
import type { Snippet } from "@/lib/types";
import { allOccurrences, queryTerms } from "@/lib/search";
import { cn, enterFiles } from "@/lib/utils";
import { autosizeArea } from "./shared";

/* ── the focused entry: one card, the whole stage ────────────────── */

function EntryViewBase({
  snippet,
  onLetGo,
}: {
  snippet: Snippet | null;
  onLetGo: (snippet: Snippet) => void | Promise<void>;
}) {
  // one tile, grown to fill the stage — the same paper material as the
  // schedule card it expanded from, so the FLIP reads as that very card
  // opening. The zoom drives [data-entry-card]'s box and fades the
  // content in; the date now lives in the header, so no header here.
  return (
    // the bloom wrapper: the open/close zoom owns the CARD's transform (and
    // its 0,0 origin), so the press bloom lifts this layout-neutral shell
    // instead — its own transition, nothing else animates it. h-full, not
    // max-h: the card's max-h-full needs a DEFINITE height above it to cap
    // a long entry (a shrink-wrapped wrapper would resolve it to none and
    // let the card overflow the stage)
    <div className="flex h-full min-h-0 flex-col transition-transform duration-[500ms] ease-[var(--ease-bloom)]">
    {/* max-h, not h: a short entry's card reaches only as far as its
        words; only a long one fills the stage and scrolls inside, with
        the card's own bottom rule marking where the scroll terminates */}
    <div
      data-entry-card
      className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[10px] border [border-color:var(--card-seat-border)] bg-paper [box-shadow:var(--card-seat)]"
      style={{ transformOrigin: "0 0" }}
    >
      {/* light pools under a press on the words (the rewrite affordance made
          visible); the bloom rides the wrapper above. This card WRAPS ITS OWN
          SCROLLER (a long entry scrolls inside), so the press bloom must wait
          out the scroll-vs-press decision — a scale written to this ancestor
          at touchdown cancels the scroll iOS was about to start (the finger
          blooms the card instead of moving it). Held ~110ms: a drag scrolls,
          a hold blooms; the light itself is instant either way. */}
      <PressGlow grow="parent" growConfirmMs={110} />
      {snippet ? (
        <EntryBody key={snippet.id} snippet={snippet} onLetGo={onLetGo} />
      ) : (
        <div data-entry-card-content className="px-4 pb-4 pt-3">
          <p className="voice-prose italic text-ink-soft">{copy.deleteEntry.toast}</p>
        </div>
      )}
      {/* the card's lit top edge, kept ABOVE the scrolling ink: the ink
          multiplies into the paper, so left below it the words would
          darken the highlight away as they pass — the depth cue must
          read at every scroll position */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_1px_0_var(--press-highlight)]"
      />
    </div>
    </div>
  );
}
// the focused entry is null while the reader is in the book, so this
// skips the scroll-spy's re-renders — only a real change of entry
// (or focus) brings it back
export const EntryView = memo(EntryViewBase);

/**
 * The entry's words. Pressing them opens them for rewriting in place —
 * the words themselves become the field — and a wax quill stamp at the
 * foot confirms (the same as dismissing the keyboard). A quiet ember
 * trash, across from it, lets the entry go.
 */
function EntryBody({
  snippet,
  onLetGo,
}: {
  snippet: Snippet;
  onLetGo: (snippet: Snippet) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(snippet.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // while rewriting, the field is CONTAINED to the visible area above the
  // keyboard: it autosizes up to that cap and scrolls its own words past it,
  // so the caret (and its spacebar-trackpad walks) stay inside the box and
  // the card never moves. This replaced the generic keyboard-room padding,
  // which reserved a whole keyboard of blank reach below the card.
  useContainedField(areaRef, editing);
  // The foot fade is a CSS scroll-driven mask (scroll-fade below) — but
  // `animation-timeline: scroll()` is missing on older Safari/Firefox, where
  // the mask is simply absent AND the scrollbar is hidden: a long entry there
  // gave no sign at all that more words lay below. On those browsers only,
  // fall back to the old JS terminus (useScrollEdges + the fade/hairline
  // overlay this card used before adopting the mask).
  const cssScrollFade = useMemo(
    () =>
      typeof CSS !== "undefined" &&
      CSS.supports("animation-timeline: scroll()"),
    [],
  );
  // liveHeight: one entry's scrollHeight is a cheap read, and its words can
  // re-wrap with no dep firing (a late font load) — same contract as before
  // the mask adoption. Consulted only on the fallback path.
  const edges = useScrollEdges(contentRef, [editing, draft, snippet.text], true);
  // a long entry that overflows the card reads at the schedule-preview size
  // (smaller) rather than full prose. We can't trust the live scroll edges
  // for this: as the card opens it FLIPs from a small tile up to the full
  // stage, so mid-flight a short entry momentarily overflows and would
  // latch compact on. Instead wait for the card height to settle (steady
  // for a few frames), then measure once — same +1 threshold the foot fade
  // uses, so a short entry that fits gets neither the small text nor the fade.
  const [compact, setCompact] = useState(false);
  // the text the standing verdict was measured for. A verdict is only valid
  // for its own words: an edit cycle that comes back with the text unchanged
  // must NOT re-measure — the entry is already rendered at the compact size,
  // where "fits" says nothing about full prose, and re-measuring flashed the
  // large text for a frame before the observer re-latched it small.
  const measuredFor = useRef<string | null>(null);
  useEffect(() => {
    if (editing) return;
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    let stable = 0;
    let frames = 0;
    let ro: ResizeObserver | null = null;
    const tick = () => {
      frames += 1;
      const h = el.clientHeight;
      if (h === last) stable += 1;
      else {
        stable = 0;
        last = h;
      }
      if (stable >= 3 || frames > 90) {
        if (measuredFor.current !== snippet.text) {
          measuredFor.current = snippet.text;
          // measured at whatever size is rendered. Overflowing while compact
          // still means compact (never a trip through prose); only a text
          // that fits at the small size gets to try full prose again, and
          // the observer below re-latches it if prose turns out too big.
          setCompact(el.scrollHeight > el.clientHeight + 1);
        }
        // …and stay live afterwards. The one-shot alone missed real
        // overflow: a save flips `editing` back before the live query
        // delivers the longer text, and a late font load re-wraps the
        // words — either way the entry sat at full prose while the foot
        // fade (which tracks live) showed more below. One-way only: at
        // the compact size, "fits" says nothing about whether full prose
        // would fit, so the observer never un-compacts — a fresh
        // measure (new text) is what resets it.
        ro = new ResizeObserver(() => {
          if (el.scrollHeight > el.clientHeight + 1) setCompact(true);
        });
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [snippet.text, editing]);
  // belt to stopEdit's braces: whatever path ends an edit, the hidden field
  // must never keep its autosize height (see stopEdit). Layout effect, so a
  // straggler is shed before the exited state can paint with phantom overflow.
  useLayoutEffect(() => {
    if (!editing && areaRef.current) areaRef.current.style.height = "";
  }, [editing]);
  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== snippet.text) {
      try {
        await updateSnippet(snippet.id, { text: trimmed });
      } catch {
        toast(copy.data.keepFailed);
      }
    }
  };
  // where the press landed: a click only counts as a tap — and opens the
  // rewrite — if the finger didn't wander. iOS can deliver the click at the
  // RELEASE point's element (drag from the words, let go over the foot),
  // which used to open editing from what was really a drag.
  const pressAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const recordPress = (e: React.PointerEvent) => {
    pressAt.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const wasTap = (e: React.MouseEvent) => {
    const d = pressAt.current;
    if (!d) return true; // no pointer record (keyboard/AT) — allow
    return performance.now() - d.t < 600 && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 12;
  };
  const startEdit = () => {
    if (editing) return;
    setDraft(snippet.text);
    // the contained field replaces the prose from the card's TOP — bring the
    // card's own scroll home so the box isn't half above the fold
    contentRef.current?.scrollTo({ top: 0 });
    // focus synchronously, inside the tap — iOS won't raise the
    // keyboard for a focus that arrives by timer
    const el = areaRef.current;
    if (el) {
      el.value = snippet.text;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setEditing(true);
    requestAnimationFrame(() => {
      if (areaRef.current) autosizeArea(areaRef.current);
    });
  };
  const stopEdit = () => {
    void save();
    // shed the autosize height NOW, synchronously, before the exit ever
    // paints: the field stays mounted (hidden, absolute) and an inline
    // height would beat its h-px class — a tall invisible box inside the
    // relative scroller adds phantom scrollable overflow below the words
    // (blank space to scroll into, and a foot hairline that never clears
    // because there really is "more" — of nothing — below the fold).
    if (areaRef.current) areaRef.current.style.height = "";
    setEditing(false);
    areaRef.current?.blur(); // confirming is dismissing the keyboard
  };
  // iOS dismisses the keyboard (chevron-down) WITHOUT blurring the
  // field, so onBlur never fires and the quill would linger. Watch the
  // visual viewport: once the keyboard has been up and then grows back,
  // the writer has put the keyboard away — end the edit.
  const stopEditRef = useRef(stopEdit);
  useEffect(() => {
    stopEditRef.current = stopEdit;
  });
  useEffect(() => {
    if (!editing) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardWasUp = false;
    const onResize = () => {
      const covered = window.innerHeight - vv.height;
      if (covered > 120) keyboardWasUp = true;
      else if (keyboardWasUp) stopEditRef.current();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [editing]);
  // `e` opens the words for rewriting while the entry is up (the keyboard
  // shortcut for the same tap). Stands down while already editing or when a
  // field/menu holds focus, so it never eats a keystroke meant for typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      startEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the parent owns the deletion (it marks the close as a dissolve, soft-deletes,
  // and raises the undo toast) so the camera knows not to shrink back to the slot
  const letGo = () => void onLetGo(snippet);

  return (
    <>
      <div
        ref={contentRef}
        data-entry-card-content
        // pressing the words opens them — a focusable div, NOT a
        // role=button, so the global selection lock doesn't apply and a
        // long-press can still select and copy. overflow-x hidden +
        // wrap-anywhere keep a long token from scrolling sideways
        tabIndex={editing ? -1 : 0}
        onPointerDown={editing ? undefined : recordPress}
        onClick={editing ? undefined : (e) => wasTap(e) && startEdit()}
        onKeyDown={(e) => {
          if (editing) {
            if (e.key === "Escape") stopEdit();
          } else if (e.key === "Enter") {
            e.preventDefault();
            startEdit();
          }
        }}
        aria-label={editing ? undefined : copy.entry.rewrite}
        // flex-initial (basis auto), NOT flex-1 (basis 0): the card is
        // max-h, so a short entry must size to its words and show them
        // all; only a long one shrinks to fill the stage and scrolls.
        //
        // The head and foot dissolve via shadcn's scroll-fade mask (a
        // scroll-driven mask on this very scroller — no JS): scroll-fade-8
        // makes each fade 2rem, and --scroll-fade-reveal ties the fade's
        // recede to that same 2rem, so the foot stays covered until the last
        // line is fully in view (a longer reveal leaves it hard-clipped). A
        // short entry that fits isn't scrollable → the timeline is inactive →
        // no fade. Held OFF while editing (below): the field autoscrolls to
        // the caret every keystroke, and a masked caret edge is worse than a
        // hard one. Where scroll-driven animation is unsupported the mask is
        // absent — the JS terminus in the foot (below) stands in there.
        className={cn(
          "relative min-h-0 flex-initial overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-3 [overflow-anchor:none] [overflow-wrap:anywhere]",
          !editing && "scroll-fade scroll-fade-8",
        )}
        style={
          { scrollbarWidth: "none", "--scroll-fade-reveal": "2rem" } as React.CSSProperties
        }
      >
        {!editing && <SnippetEntry snippet={snippet} dense compact={compact} />}
        {/* the field is always mounted (a hidden one can't take the
            gesture's synchronous focus); writing, it wears the exact
            metrics of the words it replaces */}
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
            autosizeArea(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") stopEdit();
            // Desktop: Enter commits the edit, Shift+Enter is a newline. Touch:
            // Enter is always a newline; the edit commits on blur or the stamp.
            else if (enterFiles(e)) {
              e.preventDefault();
              stopEdit();
            }
          }}
          onBlur={() => {
            if (editing) stopEdit();
          }}
          aria-label={copy.entry.words}
          tabIndex={editing ? 0 : -1}
          className={cn(
            // block (not the textarea's default inline-block) so it
            // sits in no baseline line-box — its height then matches the
            // prose it replaces exactly, and edit-toggling never resizes
            // the card around the text. Internal scrolling past the
            // contained cap (see useContainedField): the box follows its
            // own caret; overscroll-contain keeps that from chaining out.
            "voice-prose block resize-none overflow-y-auto overscroll-contain whitespace-pre-wrap bg-transparent outline-none [overflow-wrap:anywhere]",
            compact ? "text-[1rem] leading-[1.42]" : "leading-[1.5]",
            // hidden: inset-x-4 (not left-4 + w-full) so its box can't
            // poke past the right padding and force a sideways scroll
            editing
              ? "w-full"
              : "pointer-events-none absolute inset-x-4 top-3 h-px opacity-0",
          )}
        />
      </div>
      <div
        data-entry-foot
        // pressing the foot's empty band edits too — not only the words
        // (same tap guard: a drag that ends here must not open the rewrite)
        onPointerDown={editing ? undefined : recordPress}
        onClick={editing ? undefined : (e) => wasTap(e) && startEdit()}
        className="relative shrink-0"
      >
        {/* the words dissolve at the foot via the scroller's own scroll-fade
            mask (above). Where scroll-driven animation is unsupported, the
            old JS terminus stands back in: a soft fade + hairline while more
            words lie below (edges.bottom), hidden mid-edit like the mask. */}
        {!cssScrollFade && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-full z-[6] h-8 transition-opacity duration-200",
              edges.bottom && !editing ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="absolute inset-x-0 top-0 bottom-[2px] bg-gradient-to-t from-paper to-transparent" />
            <div className="absolute inset-x-0 bottom-[-4px] h-[6px] bg-paper" />
            <div className="absolute inset-x-4 bottom-0 border-t border-rule-faint" />
          </div>
        )}
        <div
          // constant padding: the foot never changes the card's height
          // as the terminus comes and goes (it sets the gap from the
          // words/hairline down to the trash mark)
          className="flex items-center justify-end px-3 pb-3 pt-2.5"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // not a press-to-edit
              void letGo();
            }}
            aria-label={copy.entry.letGo}
            className="pressable grid size-[34px] place-items-center rounded-full text-ember hover:bg-ember/10"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-[1.05rem]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.8 5.6h12.4M8 5.4V3.6h4v1.8M5.4 5.8l.9 10a1.6 1.6 0 0 0 1.6 1.4h4.2a1.6 1.6 0 0 0 1.6-1.4l.9-10" />
              <path d="M8.3 8.6v5.6M11.7 8.6v5.6" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}


/* ── the found words, marked ──────────────────────────────────────
   A search tile shows its match under a real highlighter, and if the
   match lives past the six-line clamp, the preview re-windows so it
   shows — leading with EARLIER context (a story builds forward, so
   the lines before the match explain it; the lines after follow
   anyway in whatever clamp room remains). */

/* queryTerms + allOccurrences live in src/lib/search.ts, shared with the filter
   (useSearch), so the words a tile marks and the reason it was filtered in are
   always the same match. */

const PREVIEW_LINES = 6;

/** The tile's words, found terms under the marker. The preview is a
    true six-line window onto the entry, MEASURED at the tile's real
    wrap, not estimated from a character budget:
    - if the first match already shows in the first six lines, the
      window stays at the top and only the occurrences ON those lines
      are marked — matches further down are neither shown nor drawn;
    - otherwise the window slides down a whole line at a time until the
      match is inside it (kept a line off the bottom for slack), the
      cut lines replaced by a leading ellipsis.
    The highlighter mounts inside the clipped window, so a band for an
    off-window match can never float free of its text. */
export function MarkedPreview({
  text,
  query,
  isQuote,
}: {
  text: string;
  query: string;
  isQuote: boolean;
}) {
  const terms = useMemo(() => queryTerms(query), [query]);
  const occ = useMemo(
    () => (terms.length ? allOccurrences(text, terms) : []),
    [text, terms],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const pRef = useRef<HTMLParagraphElement>(null);
  const [layout, setLayout] = useState<null | {
    key: string;
    slice: number;
    lead: boolean;
    marks: Array<[number, number]>;
  }>(null);
  const key = `${text} ${query}`;

  // measure the real wrap from the full-text render, then window it
  useLayoutEffect(() => {
    if (!occ.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (layout) setLayout(null);
      return;
    }
    if (layout && layout.key === key) return; // already settled for this key
    const p = pRef.current;
    const node = p?.firstChild; // the measuring pass renders one text node
    if (!p || !node) return;
    const cs = getComputedStyle(p);
    let lh = parseFloat(cs.lineHeight);
    if (!lh || Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.42;
    const len = text.length;
    const topAt = (off: number) => {
      const r = document.createRange();
      r.setStart(node, Math.min(off, len));
      r.setEnd(node, Math.min(off + 1, len));
      const rects = r.getClientRects();
      return (rects.length ? rects[0] : r.getBoundingClientRect()).top;
    };
    const base = topAt(0);
    const lineOf = (off: number) => Math.round((topAt(off) - base) / lh);

    const firstLine = lineOf(occ[0][0]);
    let slice = 0;
    let lead = false;
    if (firstLine > PREVIEW_LINES - 1) {
      // slide down so the first match rests a line off the bottom — the
      // slack absorbs the leading ellipsis's own reflow of line one
      const target = Math.max(0, firstLine - (PREVIEW_LINES - 2));
      let lo = 0;
      let hi = len;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lineOf(mid) >= target) hi = mid;
        else lo = mid + 1;
      }
      while (lo < len && /\s/.test(text[lo])) lo++;
      slice = lo;
      lead = true;
    }
    const floor = slice ? lineOf(slice) : 0;
    const marks: Array<[number, number]> = [];
    for (const [s, e] of occ) {
      if (s < slice) continue; // above the window — cut away
      if (lineOf(s) > floor + PREVIEW_LINES - 1) continue; // below it — unmarked
      marks.push([s - slice, e - slice]);
    }
    setLayout({ key, slice, lead, marks });
  }, [key, occ, layout, text]);

  // the lines rewrap only when the width changes — re-measure then
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      setLayout(null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measured = layout !== null && layout.key === key;
  let body: React.ReactNode;
  if (!occ.length) {
    body = text;
  } else if (!measured) {
    body = text; // the measuring pass: full text, a single text node
  } else {
    const sliced = text.slice(layout.slice);
    const nodes: React.ReactNode[] = layout.lead ? ["… "] : [];
    let cur = 0;
    layout.marks.forEach(([s, e], i) => {
      if (s > cur) nodes.push(sliced.slice(cur, s));
      nodes.push(<RoughMark key={i}>{sliced.slice(s, e)}</RoughMark>);
      cur = e;
    });
    if (cur < sliced.length) nodes.push(sliced.slice(cur));
    body = nodes;
  }

  return (
    <div
      ref={wrapRef}
      data-mark-clip
      className="relative overflow-hidden"
      style={{ maxHeight: `calc(1rem * 1.42 * ${PREVIEW_LINES})` }}
    >
      <p
        ref={pRef}
        className={cn(
          "voice-prose whitespace-pre-wrap text-[1rem] leading-[1.42]",
          // once windowed, clamp to the 6-line view so the last visible line
          // gets a trailing "…" (the measuring pass renders the full text, so
          // it must stay unclamped for the line maths to be right)
          (measured || !occ.length) && "line-clamp-6",
          isQuote && "hang-quotes italic",
        )}
      >
        {body}
      </p>
    </div>
  );
}

/** One found phrase under a drawn highlighter (@highlighters/core):
    wet ink with frayed edges, one band per wrapped line, the bands
    joined across the wrap. Its overlay mounts in the nearest
    positioned ancestor and reflows itself on layout shifts; the ink
    is the marker token, resolved here at draw time. */
function RoughMark({ children }: { children: string }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // @highlighters/core is heavy and only ever needed here (the rough mark on
    // search-matched words), never on the first book view — so load it on demand.
    // The <mark> already carries its flat CSS highlight; this rough overlay paints
    // a beat later once the chunk arrives, keeping it out of the initial bundle.
    let h: { remove: () => void } | undefined;
    let cancelled = false;
    void import("@highlighters/core").then(({ highlight }) => {
      if (cancelled || !ref.current) return;
      const color =
        getComputedStyle(el).getPropertyValue("--marker").trim() || "#e8c558";
      h = highlight(
        el,
        {
          color,
          opacity: 0.8,
        // the owner's hand: a fine nib at a slight slant, generous wet
        // flow with full streak lanes, soft capillary fray, round caps
        // on gently wavering rails — and the parameter that matters
        // most, touchdown/lift pooling, at full
        tip: {
          type: "fine",
          angle: 5,
          overshoot: 2,
          overshootJitter: 0,
          angleJitter: 0,
        },
        ink: {
          flow: 0.8,
          feathering: 0.5,
          streakiness: 1,
          dryout: 0,
          flowFade: 0.5,
          startEndBuildup: 1,
        },
        edge: {
          waviness: 1,
          frequency: 40,
          cap: "round",
          radius: 6,
        },
        paper: { absorbency: 0.1 },
        animation: { draw: true, duration: 380 },
      },
      // mount the band inside the clipped preview window: element
      // targets default their overlay to document.body (which would
      // stand still while the filtered book scrolls), and the clip box
      // shears off any band that strays past the six visible lines
        (el.closest("[data-mark-clip]") as HTMLElement | null) ??
          el.closest("button") ??
          undefined,
      );
    });
    return () => {
      cancelled = true;
      h?.remove();
    };
  }, [children]);
  return (
    <mark ref={ref} className="snippet-mark">
      {children}
    </mark>
  );
}
