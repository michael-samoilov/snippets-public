"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { KindMark } from "@/components/kind-mark";
import { useAllSnippets, useSearch } from "@/hooks/use-snippets";
import { exportJSON, exportMarkdown } from "@/lib/export";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();

  const all = useAllSnippets();
  const results = useSearch(query, all).slice(0, 6);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (action: () => void) => {
    setOpen(false);
    setQuery("");
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command menu"
      description="Search the collection or jump somewhere"
      className="border-rule bg-paper-raised"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search, or jump somewhere…"
        className="font-serif"
      />
      <CommandList>
        <CommandEmpty className="voice-prose py-6 text-center italic text-ink-soft">
          Nothing found.
        </CommandEmpty>

        {query.trim() && results.length > 0 && (
          <>
            <CommandGroup heading="In the collection">
              {results.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.id} ${s.title ?? ""} ${s.text.slice(0, 60)}`}
                  onSelect={() =>
                    run(() =>
                      router.push(`/collection?q=${encodeURIComponent(query)}`),
                    )
                  }
                  className="font-serif"
                >
                  <KindMark kind={s.kind} className="size-3.5 shrink-0" />
                  <span className="truncate">{s.title ?? s.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Go to">
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/"))}>
            Today
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/collection"))}>
            Collection
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/calendar"))}>
            Calendar
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/settings"))}>
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Do">
          <CommandItem
            className="font-serif"
            onSelect={() =>
              run(() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark"),
              )
            }
          >
            Switch to {resolvedTheme === "dark" ? "Paper" : "Lamplight"}
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => void exportJSON())}>
            Export as JSON
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => void exportMarkdown())}>
            Export as Markdown
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
