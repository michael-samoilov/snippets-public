"use client";

import { AnimatePresence, motion } from "motion/react";
import { copy } from "@/lib/copy";

/** A single keycap — a small raised chip with the sheet's light story (inset
 *  top highlight + a hair of shadow), serif like every other control. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-[5px] border border-rule bg-paper px-1.5 py-[3px] font-serif text-[0.72rem] leading-none text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_1px_rgb(var(--shadow-hue)/0.08)]">
      {children}
    </kbd>
  );
}

/** One shortcut row: its keys, then what it does. `keys` is a list of chip
 *  groups; a space between chips reads as "then/plus". */
function Row({ keys, label }: { keys: React.ReactNode[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[7px]">
      <span className="voice-prose text-[0.9rem] text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{keys}</span>
    </div>
  );
}

/**
 * The keyboard cheat sheet (`?`). Opened often enough to want a calm entrance
 * but not so often it should be instant; it floats over a soft ink scrim and
 * dismisses on Esc (handled by the shell), `?`, or a tap outside.
 */
export function KeyboardShortcuts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const c = copy.shortcuts;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          onClick={onClose}
        >
          {/* the sanctioned overlay tint — a fixed warm-dark veil that recedes
              the page in both Paper and Lamplight (matches DialogOverlay) */}
          <div aria-hidden className="absolute inset-0 bg-[rgb(24_19_13/0.45)]" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={c.title}
            className="float relative max-h-[85vh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-paper-raised px-6 py-5"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="voice-label mb-1 text-[0.7rem] text-ink-faint">
              {c.title}
            </h2>

            <section className="border-t border-rule-faint pt-2">
              <h3 className="voice-label mb-1 text-[0.62rem] text-ink-faint">{c.groups.move}</h3>
              <Row keys={[<Key key="e">Esc</Key>]} label={c.back} />
              <Row keys={[<Key key="s">/</Key>]} label={c.search} />
              <Row keys={[<Key key="t">t</Key>]} label={c.today} />
              <Row keys={[<Key key="j">j</Key>, <Key key="k">k</Key>]} label={c.step} />
              <Row keys={[<Key key="g">g</Key>, <Key key="m">m</Key>]} label={c.goCanvas} />
              <Row keys={[<Key key="g">g</Key>, <Key key="y">y</Key>]} label={c.goGlance} />
            </section>

            <section className="mt-2 border-t border-rule-faint pt-2">
              <h3 className="voice-label mb-1 text-[0.62rem] text-ink-faint">{c.groups.write}</h3>
              <Row keys={[<Key key="c">c</Key>]} label={c.capture} />
              <Row keys={[<Key key="e">e</Key>]} label={c.edit} />
              <Row keys={[<Key key="ent">↵</Key>]} label={c.file} />
              <Row keys={[<Key key="sh">⇧</Key>, <Key key="ent">↵</Key>]} label={c.newline} />
            </section>

            <section className="mt-2 border-t border-rule-faint pt-2">
              <h3 className="voice-label mb-1 text-[0.62rem] text-ink-faint">{c.groups.grid}</h3>
              <Row keys={[<Key key="l">←</Key>, <Key key="r">→</Key>]} label={c.dayStep} />
              <Row keys={[<Key key="u">↑</Key>, <Key key="d">↓</Key>]} label={c.weekStep} />
              <Row keys={[<Key key="pu">⇞</Key>, <Key key="pd">⇟</Key>]} label={c.monthStep} />
              <Row keys={[<Key key="sh">⇧</Key>, <Key key="pg">⇞⇟</Key>]} label={c.yearStep} />
              <Row keys={[<Key key="ent">↵</Key>]} label={c.openDay} />
            </section>

            <section className="mt-2 border-t border-rule-faint pt-2">
              <h3 className="voice-label mb-1 text-[0.62rem] text-ink-faint">{c.groups.global}</h3>
              <Row keys={[<Key key="cmd">⌘</Key>, <Key key="k">K</Key>]} label={c.command} />
              <Row keys={[<Key key="q">?</Key>]} label={c.thisSheet} />
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
