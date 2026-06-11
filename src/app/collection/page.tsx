"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
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
  const pathname = usePathname();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [kindFilter, setKindFilter] = useState<SnippetKind | null>(() => {
    const k = params.get("kind");
    return KINDS.includes(k as SnippetKind) ? (k as SnippetKind) : null;
  });
  const [favoritesOnly, setFavoritesOnly] = useState(
    params.get("fav") === "1",
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // the URL carries the view, so filters and searches can be shared
  const syncUrl = useCallback(
    (q: string, kind: SnippetKind | null, fav: boolean) => {
      const next = new URLSearchParams();
      if (q.trim()) next.set("q", q.trim());
      if (kind) next.set("kind", kind);
      if (fav) next.set("fav", "1");
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const all = useAllSnippets();
  const searched = useSearch(query, all);
  const filtered = searched.filter(
    (s) =>
      (kindFilter === null || s.kind === kindFilter) &&
      (!favoritesOnly || s.favorite === 1),
  );
  const groups = groupByDay(filtered);
  const filtering = Boolean(query.trim()) || kindFilter !== null || favoritesOnly;

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
    <div className="page-settle">
      <header className="mb-6">
        <h1 className="voice-display text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          Collection
        </h1>
        {all && (
          <p className="mt-2.5 font-serif text-[0.92rem] italic text-ink-soft">
            {all.length === 0
              ? "nothing kept yet"
              : filtering
                ? `${filtered.length} of ${all.length} kept`
                : `${all.length} kept`}
          </p>
        )}
      </header>

      <div className="mb-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            syncUrl(e.target.value, kindFilter, favoritesOnly);
          }}
          placeholder="Search the collection…"
          aria-label="Search the collection"
          className="voice-prose w-full border-b border-rule bg-transparent pb-2 italic outline-none transition-colors duration-150 placeholder:text-ink-faint focus:border-ink-soft"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 py-2">
        {KINDS.map((kind) => {
          const active = kindFilter === kind;
          return (
            <motion.button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const next = active ? null : kind;
                setKindFilter(next);
                syncUrl(query, next, favoritesOnly);
              }}
              whileTap={{ scale: 0.93 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0.3 }}
              className="voice-label flex items-center gap-1.5 rounded-[5px] border px-2 py-[3px] text-[0.78rem] tracking-[0.09em] transition-colors duration-150"
              style={
                active
                  ? {
                      borderColor: KIND_META[kind].color,
                      color: KIND_META[kind].color,
                      backgroundColor: `color-mix(in srgb, ${KIND_META[kind].color} 9%, transparent)`,
                    }
                  : { borderColor: "var(--rule-faint)", color: "var(--ink-faint)" }
              }
            >
              <KindMark kind={kind} className="size-3" colored={active} />
              {KIND_META[kind].plural}
            </motion.button>
          );
        })}
        <motion.button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => {
            setFavoritesOnly((v) => {
              syncUrl(query, kindFilter, !v);
              return !v;
            });
          }}
          whileTap={{ scale: 0.93 }}
          className={cn(
            "voice-label rounded-[5px] border px-2 py-[3px] text-[0.78rem] tracking-[0.09em] transition-colors duration-150",
            favoritesOnly
              ? "border-gilt bg-gilt/10 text-gilt"
              : "border-rule-faint text-ink-faint",
          )}
        >
          ✳ Favorites
        </motion.button>
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
            <span className="voice-data">{snippets.length}</span>
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
    </div>
  );
}
