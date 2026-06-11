"use client";

import { motion } from "motion/react";
import { KIND_META } from "@/lib/kinds";
import { KINDS, type SnippetKind } from "@/lib/types";

/**
 * One tap to file an entry by hand. The chips behave like small stamps:
 * they depress under the finger and pop when they take.
 */
export function KindChips({
  onPick,
  value,
  label = "File under",
}: {
  onPick: (kind: SnippetKind) => void;
  value?: SnippetKind | null;
  label?: string | null;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
      {label && (
        <span className="mr-1 font-serif text-[0.82rem] italic text-ink-faint">
          {label}
        </span>
      )}
      {KINDS.map((kind) => {
        const active = value === kind;
        return (
          <motion.button
            key={kind}
            type="button"
            title={KIND_META[kind].hint}
            aria-pressed={active}
            onClick={() => onPick(kind)}
            whileTap={{ scale: 0.93 }}
            animate={active ? { scale: [1, 1.07, 1] } : { scale: 1 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.4 }}
            className="voice-label rounded-[5px] border px-2 py-[3px] text-[0.78rem] tracking-[0.09em] transition-colors duration-150"
            style={
              active
                ? {
                    borderColor: KIND_META[kind].color,
                    color: KIND_META[kind].color,
                    backgroundColor: `color-mix(in srgb, ${KIND_META[kind].color} 9%, transparent)`,
                    boxShadow: "inset 0 1px 1px rgb(0 0 0 / 0.06)",
                  }
                : { borderColor: "var(--rule)", color: "var(--ink-soft)" }
            }
          >
            {KIND_META[kind].label}
          </motion.button>
        );
      })}
    </div>
  );
}
