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
import { useAllSnippets, useSearch } from "@/hooks/use-snippets";
import { exportJSON, exportMarkdown } from "@/lib/export";
import { dayKey } from "@/lib/dates";
import { copy } from "@/lib/copy";

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
    // opened by keyboard dozens of times a day — no entrance theater
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={copy.commandMenu.title}
      description={copy.commandMenu.description}
      className="float border-none bg-paper-raised duration-100 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={copy.search.command}
        className="font-serif"
      />
      <CommandList>
        <CommandEmpty className="voice-prose py-6 text-center italic text-ink-soft">
          {copy.commandMenu.empty}
        </CommandEmpty>

        {query.trim() && results.length > 0 && (
          <>
            <CommandGroup heading={copy.commandMenu.inTheBook}>
              {results.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.id} ${s.title ?? ""} ${s.text.slice(0, 60)}`}
                  onSelect={() => run(() => router.push(`/calendar?d=${s.day}`))}
                  className="font-serif"
                >
                  <span className="truncate">{s.title ?? s.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading={copy.commandMenu.goTo}>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push(`/calendar?d=${dayKey()}`))}>
            {copy.nav.today}
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/calendar"))}>
            {copy.nav.calendar}
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => router.push("/settings"))}>
            {copy.settings.title}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={copy.commandMenu.do}>
          <CommandItem
            className="font-serif"
            onSelect={() =>
              run(() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark"),
              )
            }
          >
            {copy.commandMenu.switchTo(resolvedTheme === "dark" ? copy.themes.paper : copy.themes.lamplight)}
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => void exportJSON())}>
            {copy.commandMenu.exportJSON}
          </CommandItem>
          <CommandItem className="font-serif" onSelect={() => run(() => void exportMarkdown())}>
            {copy.commandMenu.exportMarkdown}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
