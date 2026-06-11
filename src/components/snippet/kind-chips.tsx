"use client";

import { KIND_META } from "@/lib/kinds";
import { KINDS, type SnippetKind } from "@/lib/types";
import { KindMark } from "@/components/kind-mark";

/** One tap to file an entry by hand when automatic filing didn't run. */
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
      {label && <span className="voice-meta mr-1">{label}</span>}
      {KINDS.map((kind) => {
        const active = value === kind;
        return (
          <button
            key={kind}
            type="button"
            title={KIND_META[kind].hint}
            aria-pressed={active}
            onClick={() => onPick(kind)}
            className="flex items-center gap-1.5 rounded-[3px] border px-2 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-[0.07em] transition-colors duration-150"
            style={
              active
                ? {
                    borderColor: KIND_META[kind].color,
                    color: KIND_META[kind].color,
                  }
                : { borderColor: "var(--rule)", color: "var(--ink-soft)" }
            }
          >
            <KindMark kind={kind} className="size-3" colored={active} />
            {KIND_META[kind].label}
          </button>
        );
      })}
    </div>
  );
}
