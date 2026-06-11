import type { SnippetKind } from "@/lib/types";
import { KIND_META } from "@/lib/kinds";
import { cn } from "@/lib/utils";

/**
 * Printers' marks, hand-drawn — the marginalia of the collection.
 * story ¶ · joke ‽ · quote ❞ · idea ✳ · phrase ~ · observation ◉
 * Drawn as SVG so they render identically everywhere (text glyphs for
 * these codepoints are unreliable across platforms).
 */

const MARKS: Record<SnippetKind, React.ReactNode> = {
  // pilcrow — a paragraph, a story
  story: (
    <>
      <path
        d="M8 2.9 H6.3 a2.9 2.9 0 0 0 0 5.8 H8 Z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M8 2.9 V13.1 M11 2.9 V13.1 M11 2.9 H6.3" strokeWidth="1.5" />
    </>
  ),
  // interrobang — surprise and a question, the anatomy of a joke
  joke: (
    <>
      <path
        d="M4.9 5.4 a3.2 3.2 0 1 1 5.4 2.5 c-1 .9-2.3 1.3-2.3 2.9"
        strokeWidth="1.5"
      />
      <path d="M8 2.4 V10.8" strokeWidth="1.5" />
      <circle cx="8" cy="13.4" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  // closing quotation primes
  quote: (
    <path
      d="M6.4 3.6 L4.9 9.2 M11.4 3.6 L9.9 9.2"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  // six-ray asterisk — the footnote spark
  idea: (
    <path
      d="M8 2.6 V13.4 M3.3 5.3 L12.7 10.7 M3.3 10.7 L12.7 5.3"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  // swung dash — kept for the language itself
  phrase: (
    <path
      d="M2.8 9 C4.3 6.4 6.3 6.4 8 8 C9.7 9.6 11.7 9.6 13.2 7"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  ),
  // surveyor's point — something seen, plainly
  observation: (
    <>
      <circle cx="8" cy="8" r="5" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
};

export function KindMark({
  kind,
  className,
  colored = true,
}: {
  kind: SnippetKind | null;
  className?: string;
  colored?: boolean;
}) {
  if (kind === null) {
    // an unfiled entry wears a faint middle dot
    return (
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={cn("size-4 text-ink-faint/60", className)}
        fill="none"
        stroke="currentColor"
      >
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={KIND_META[kind].label}
      className={cn("size-4", className)}
      style={colored ? { color: KIND_META[kind].color } : undefined}
      fill="none"
      stroke="currentColor"
    >
      {MARKS[kind]}
    </svg>
  );
}
