"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { db } from "@/lib/db";
import { exportJSON, exportMarkdown, importJSON } from "@/lib/export";
import { updateSettings, useSettings } from "@/lib/settings";
import { useStats } from "@/hooks/use-snippets";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Paper" },
  { value: "dark", label: "Lamplight" },
  { value: "system", label: "System" },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const stats = useStats();
  const fileRef = useRef<HTMLInputElement>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  // theme is unknowable server-side; render the chips neutral until hydrated
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const onImport = async (file: File) => {
    try {
      const count = await importJSON(file);
      toast(`Restored ${count} ${count === 1 ? "entry" : "entries"}.`);
    } catch (error) {
      toast("That file couldn't be read.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <header className="mb-8">
        <h1 className="voice-display text-[1.9rem] leading-tight sm:text-[2.2rem]">
          Settings
        </h1>
      </header>

      <div className="space-y-10">
        <section aria-label="Appearance">
          <h2 className="voice-meta border-b border-rule pb-2">Appearance</h2>
          <div className="mt-4 flex gap-1.5">
            {THEMES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={mounted && theme === value}
                className={cn(
                  "rounded-[3px] border px-3 py-1.5 font-serif text-[0.92rem] transition-colors duration-150",
                  mounted && theme === value
                    ? "border-ink text-ink"
                    : "border-rule text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Filing">
          <h2 className="voice-meta border-b border-rule pb-2">Filing</h2>
          <div className="mt-4 flex items-start justify-between gap-6">
            <div>
              <p className="font-serif text-[0.98rem]">Automatic filing</p>
              <p className="voice-prose mt-0.5 max-w-[42ch] text-[0.9rem] text-ink-soft">
                New entries get a title, a kind, and tags on their own, via
                Claude. Needs an API key on the server; without one, the
                one-tap chips do the job. Your words stay on this device
                either way — only the entry text is sent for filing.
              </p>
            </div>
            <Switch
              checked={settings.autoFile}
              onCheckedChange={(checked) => updateSettings({ autoFile: checked })}
              aria-label="Automatic filing"
            />
          </div>
        </section>

        <section aria-label="Your data">
          <h2 className="voice-meta border-b border-rule pb-2">Your data</h2>
          <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
            Everything lives in this browser, on this device.
            {stats && stats.total > 0 && (
              <> {stats.total} {stats.total === 1 ? "entry" : "entries"} so far.</>
            )}{" "}
            Take a copy whenever you like.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              className="border-rule font-serif"
              onClick={() => void exportJSON()}
            >
              Export JSON
            </Button>
            <Button
              variant="outline"
              className="border-rule font-serif"
              onClick={() => void exportMarkdown()}
            >
              Export Markdown
            </Button>
            <Button
              variant="outline"
              className="border-rule font-serif"
              onClick={() => fileRef.current?.click()}
            >
              Restore from JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImport(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="mt-8 border-t border-rule-faint pt-4">
            <Button
              variant="ghost"
              className="px-0 font-serif text-wax hover:bg-transparent hover:text-wax-deep"
              onClick={() => setEraseOpen(true)}
            >
              Let everything go…
            </Button>
          </div>
        </section>

        <section aria-label="About">
          <h2 className="voice-meta border-b border-rule pb-2">About</h2>
          <p className="voice-prose mt-4 max-w-[48ch] text-[0.9rem] text-ink-soft">
            Snippets is a pocket commonplace book, made in the spirit of
            Matthew Dicks&rsquo; <em>Homework for Life</em>: at the end of each
            day, keep the most storyworthy thing that happened. Jokes, quotes,
            and stray phrases are welcome too — good lines shouldn&rsquo;t go
            to waste.
          </p>
        </section>
      </div>

      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent className="border-rule bg-paper-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="voice-display text-left text-lg">
              Let everything go?
            </DialogTitle>
            <DialogDescription className="voice-prose text-left text-[0.92rem] text-ink-soft">
              This erases every entry on this device, permanently. If you want
              a copy first, export before you do this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="font-serif"
              onClick={() => setEraseOpen(false)}
            >
              Keep everything
            </Button>
            <Button
              className="bg-wax font-serif text-paper-raised hover:bg-wax-deep"
              onClick={async () => {
                await db.snippets.clear();
                setEraseOpen(false);
                toast("The page is blank again.");
              }}
            >
              Erase it all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
