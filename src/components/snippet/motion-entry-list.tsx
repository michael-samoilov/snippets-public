"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import type { Snippet } from "@/lib/types";

/**
 * A living list: new entries settle in from the capture area above,
 * removed ones close up like a line struck from the page. Entries
 * already present at first paint don't animate — only changes do.
 */
export function MotionEntryList({
  snippets,
  showTime = true,
}: {
  snippets: Snippet[];
  showTime?: boolean;
}) {
  // entries already on the page at mount don't animate — only changes do
  const [presentAtMount] = useState(() => new Set(snippets.map((s) => s.id)));

  return (
    <ul className="entry-list divide-y divide-rule-faint">
      <AnimatePresence initial={false}>
        {snippets.map((snippet) => (
          <motion.li
            key={snippet.id}
            layout="position"
            initial={
              presentAtMount.has(snippet.id)
                ? false
                : {
                    opacity: 0,
                    y: -14,
                    scale: 0.985,
                    filter: "blur(2px)",
                  }
            }
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, height: 0, overflow: "hidden" }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.16 }}
          >
            <SnippetEntry snippet={snippet} showTime={showTime} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
