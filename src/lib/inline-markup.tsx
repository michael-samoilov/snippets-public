import type { ReactNode } from "react";

/**
 * A deliberately tiny inline renderer for the few prose spots that want
 * emphasis or a source link — the first-run intro, to start. It knows
 * exactly two marks, composable: `_italic_` and `[text](url)`. Links are
 * parsed before italics (so an underscore inside a URL is never mistaken
 * for emphasis) and open in a new tab. This is NOT a Markdown engine —
 * just enough that copy stays authorable as plain strings in copy.ts.
 */
function italics(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /_([^_]+)_/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<em key={`${key}-em${i++}`}>{m[1]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderInline(text: string, key = "il"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last)
      out.push(...italics(text.slice(last, m.index), `${key}-t${i}`));
    out.push(
      <a
        key={`${key}-a${i}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-ink-faint underline-offset-2 transition-colors hover:decoration-ink"
      >
        {italics(m[1], `${key}-al${i}`)}
      </a>,
    );
    i++;
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...italics(text.slice(last), `${key}-t${i}`));
  return out;
}
