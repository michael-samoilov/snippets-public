"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { useContainedField } from "@/hooks/use-contained-field";
import { updateSnippet } from "@/lib/db";
import { copy } from "@/lib/copy";
import type { Snippet } from "@/lib/types";
import { allOccurrences, queryTerms } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useScrollEdges } from "@/components/ui/scroll-terminus";
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
    // max-h, not h: a short entry's card reaches only as far as its
    // words; only a long one fills the stage and scrolls inside, with
    // the card's own bottom rule marking where the scroll terminates
    <div
      data-entry-card
      className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper shadow-[0_1px_3px_rgb(var(--shadow-hue)/0.08)]"
      style={{ transformOrigin: "0 0" }}
    >
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
  // a long entry that overflows the card reads at the schedule-preview size
  // (smaller) rather than full prose. We can't trust the live scroll edges
  // for this: as the card opens it FLIPs from a small tile up to the full
  // stage, so mid-flight a short entry momentarily overflows and would
  // latch compact on. Instead wait for the card height to settle (steady
  // for a few frames), then measure once — same +1 threshold the foot fade
  // uses, so a short entry that fits gets neither the small text nor the fade.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (editing) return;
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    let stable = 0;
    let frames = 0;
    const tick = () => {
      frames += 1;
      const h = el.clientHeight;
      if (h === last) stable += 1;
      else {
        stable = 0;
        last = h;
      }
      if (stable >= 3 || frames > 90) {
        setCompact(el.scrollHeight > el.clientHeight + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.text, editing]);
  // the foot terminus shows while more words lie below, and clears at the last
  // line (or if they all fit). compact is a dep because shrinking the font
  // changes the scroll height WITHOUT resizing the scroller, which the
  // ResizeObserver alone misses — leaving the terminus lit at the very bottom.
  const edges = useScrollEdges(contentRef, [editing, draft, compact]);

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
        onClick={editing ? undefined : startEdit}
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
        // No bottom padding, so the terminus hairline rides the true
        // bottom edge and the words clip cleanly beneath it.
        className="relative min-h-0 flex-initial overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-3 [overflow-anchor:none] [overflow-wrap:anywhere]"
        style={{ scrollbarWidth: "none" }}
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
            compact ? "text-[0.9rem] leading-[1.42]" : "leading-[1.5]",
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
        onClick={editing ? undefined : startEdit}
        className="relative shrink-0"
      >
        {/* the scroll terminus — a soft fade + hairline marking that the words
            run on below. It sits just ABOVE the foot (OUTSIDE the scroller), so
            the scroller's sub-pixel clip can't leak a sliver of the next line
            beneath the rule; it clears once the last line is in view. Paper on
            paper, so an overscroll never flashes it. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full z-[6] h-8 transition-opacity duration-200",
            // hidden while rewriting: as the field autosizes and the keyboard
            // room scrolls to follow the caret, the foot crosses the bottom
            // threshold every keystroke — which would flicker the hairline. The
            // caret is kept in view by useKeyboardRoom, so the marker isn't
            // needed mid-edit anyway.
            edges.bottom && !editing ? "opacity-100" : "opacity-0",
          )}
        >
          {/* the soft fade, dissolving to solid paper just above the rule */}
          <div className="absolute inset-x-0 top-0 bottom-[2px] bg-gradient-to-t from-paper to-transparent" />
          {/* an opaque paper band straddling the scroller's bottom edge — a
              couple px above the rule, down a few px into the foot — so no
              sliver of the next line can leak under the rule (WebKit clips a
              hair low). It's outside the scroller, so it adds no scroll
              overflow; and it shows only WITH the fade, so the last line is
              never covered once it's fully in view. */}
          <div className="absolute inset-x-0 bottom-[-4px] h-[6px] bg-paper" />
          {/* the rule itself is inset to the words' own margins (the scroller's
              px-4), not spanning the whole card */}
          <div className="absolute inset-x-4 bottom-0 border-t border-rule-faint" />
        </div>
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
      style={{ maxHeight: `calc(0.9rem * 1.42 * ${PREVIEW_LINES})` }}
    >
      <p
        ref={pRef}
        className={cn(
          "voice-prose whitespace-pre-wrap text-[0.9rem] leading-[1.42]",
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
