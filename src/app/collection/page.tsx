"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { KindMark } from "@/components/kind-mark";
import { groupByDay, useAllSnippets, useSearch } from "@/hooks/use-snippets";
import { friendlyDay } from "@/lib/dates";
import { KIND_META } from "@/lib/kinds";
import { KINDS, type SnippetKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function CollectionPage() {
  return (
    <Suspense>
      <Collection />
    </Suspense>
  );
}

function Collection() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [kindFilter, setKindFilter] = useState<SnippetKind | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const all = useAllSnippets();
  const searched = useSearch(query, all);
  const filtered = searched.filter(
    (s) =>
      (kindFilter === null || s.kind === kindFilter) &&
      (!favoritesOnly || s.favorite === 1),
  );
  const groups = groupByDay(filtered);

  // "/" reaches for the search field, like flipping to the index
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="mb-6">
        <h1 className="voice-display text-[1.9rem] leading-tight sm:text-[2.2rem]">
          Collection
        </h1>
        {all && (
          <p className="voice-meta mt-1.5">
            {all.length === 0
              ? "Nothing kept yet"
              : `${all.length} kept${query || kindFilter || favoritesOnly ? ` · ${filtered.length} shown` : ""}`}
          </p>
        )}
      </header>

      <div className="mb-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the collection…"
          aria-label="Search the collection"
          className="voice-prose w-full border-b border-rule bg-transparent pb-2 italic outline-none transition-colors duration-150 placeholder:text-ink-faint focus:border-ink-soft"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 py-2">
        {KINDS.map((kind) => {
          const active = kindFilter === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => setKindFilter(active ? null : kind)}
              className="flex items-center gap-1.5 rounded-[3px] border px-2 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-[0.07em] transition-colors duration-150"
              style={
                active
                  ? { borderColor: KIND_META[kind].color, color: KIND_META[kind].color }
                  : { borderColor: "var(--rule-faint)", color: "var(--ink-faint)" }
              }
            >
              <KindMark kind={kind} className="size-3" colored={active} />
              {KIND_META[kind].plural}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((v) => !v)}
          className={cn(
            "rounded-[3px] border px-2 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-[0.07em] transition-colors duration-150",
            favoritesOnly
              ? "border-gilt text-gilt"
              : "border-rule-faint text-ink-faint",
          )}
        >
          ✳ Favorites
        </button>
      </div>

      {all && all.length === 0 && (
        <p className="voice-prose mt-8 max-w-prose italic text-ink-soft">
          The collection begins on the Today page — catch something small and
          it will be kept here.
        </p>
      )}

      {all && all.length > 0 && filtered.length === 0 && (
        <p className="voice-prose mt-8 italic text-ink-soft">
          Nothing found{query ? <> for &ldquo;{query}&rdquo;</> : null}. Try
          fewer words, or let the filters go.
        </p>
      )}

      {groups.map(({ day, snippets }) => (
        <section key={day} className="mt-7" aria-label={friendlyDay(day)}>
          <header className="flex items-baseline justify-between border-b border-rule pb-1.5">
            <h2 className="voice-display text-[1.12rem]">{friendlyDay(day)}</h2>
            <span className="voice-meta">{snippets.length}</span>
          </header>
          <ul className="entry-list divide-y divide-rule-faint">
            {snippets.map((snippet, i) => (
              <li key={snippet.id}>
                <SnippetEntry snippet={snippet} stagger={i} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
