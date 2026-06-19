import type { Snippet } from "@/lib/types";

/* ── how search matches ───────────────────────────────────────────
   Search here is a FILTER, not a ranked engine: every entry shown
   literally contains what was typed, and the SAME match is what the
   highlighter marks — so the filtered list and the marks can never
   disagree. (They used to: a tokenizing index filtered the list while
   plain substring search drew the marks.)

   The rules, chosen to be predictable:
   • case-insensitive;
   • quotes and apostrophes are ignored, so a curly vs straight
     apostrophe never blocks a hit and "couldn't", "couldn’t" and
     "couldnt" all match each other;
   • every OTHER character is literal — "(note" matches "(note", not
     just any word after the bracket;
   • multiple words are AND — each whitespace-separated word must
     appear (so a second word narrows, it doesn't broaden);
   • a substring matches anywhere, which also covers the word still
     being typed ("cof" finds "coffee"). */

// quotes/apostrophes dropped before matching: straight, curly, low, backtick
const QUOTE = /['‘’‚‛"“”„‟`]/;
const QUOTES_G = /['‘’‚‛"“”„‟`]/g;

export function normalize(s: string): string {
  return s.toLowerCase().replace(QUOTES_G, "");
}

/** the query's distinct terms, longest first so overlapping marks merge whole.
    A term is a whitespace-separated chunk; under two characters it neither
    filters nor marks (one letter would match nearly everything). */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(normalize(query).split(/\s+/).filter((t) => t.length >= 2)),
  ].sort((a, b) => b.length - a.length);
}

/** the entry's searchable surface — the words plus the data that never shows
    (title, tags, attribution), so an entry can be found by a hidden tag too.
    Joined with newlines a query can't contain, so no term spans two fields. */
export function searchableText(s: Snippet): string {
  return [s.text, s.title ?? "", s.tags.join(" "), s.attribution ?? ""].join("\n");
}

/** Every occurrence of any term in `text`, as ranges in the ORIGINAL text (the
    marks must land on the real glyphs), matched on the normalized form so case
    and quotes never block a hit. Merged, ordered, capped (a term can recur). */
export function allOccurrences(text: string, terms: string[]): Array<[number, number]> {
  if (!terms.length) return [];
  // normalized characters paired with the original index each came from, so a
  // normalized match maps back onto the real text — a dropped apostrophe inside
  // the match is simply spanned (matching "couldnt" still marks "couldn't").
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (QUOTE.test(c)) continue;
    const lc = c.toLowerCase();
    for (let j = 0; j < lc.length; j++) {
      norm += lc[j];
      map.push(i);
    }
  }
  const hits: Array<[number, number]> = [];
  for (const t of terms) {
    let i = norm.indexOf(t);
    while (i >= 0 && hits.length < 80) {
      hits.push([map[i], map[i + t.length - 1] + 1]);
      i = norm.indexOf(t, i + t.length);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  return merged;
}
