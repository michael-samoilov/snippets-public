"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const stats = useStats();
  const fileRef = useRef<HTMLInputElement>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  // theme is unknowable server-side; render the swatches neutral until hydrated
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
      toast("That file couldn’t be read.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <div className="page-settle">
      <header className="mb-8">
        <h1 className="voice-display ink-bleed text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          Settings
        </h1>
      </header>

      <div className="space-y-10">
        <section aria-label="Appearance">
          <h2 className="voice-label border-b border-rule pb-1.5">Appearance</h2>
          <div className="mt-4 flex gap-3" role="radiogroup" aria-label="Theme">
            <ThemeSwatch
              label="Paper"
              active={mounted && theme === "light"}
              onPick={() => setTheme("light")}
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
            <ThemeSwatch
              label="Lamplight"
              active={mounted && theme === "dark"}
              onPick={() => setTheme("dark")}
              paper="#1d1812"
              desk="#0f0c08"
              ink="#eae1cd"
            />
            <ThemeSwatch
              label="System"
              active={mounted && theme === "system"}
              onPick={() => setTheme("system")}
              split
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
          </div>
        </section>

        <section aria-label="Filing">
          <h2 className="voice-label border-b border-rule pb-1.5">Filing</h2>
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
          <h2 className="voice-label border-b border-rule pb-1.5">Your data</h2>
          <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
            Everything lives in this browser — kept on this device, yours
            alone.
            {stats && stats.total > 0 && (
              <>
                {" "}
                {stats.total} {stats.total === 1 ? "entry" : "entries"} so far.
              </>
            )}{" "}
            Take a copy whenever you like.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <PaperButton onClick={() => void exportJSON()}>
              Export JSON
            </PaperButton>
            <PaperButton onClick={() => void exportMarkdown()}>
              Export Markdown
            </PaperButton>
            <PaperButton onClick={() => fileRef.current?.click()}>
              Restore from JSON…
            </PaperButton>
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
          <h2 className="voice-label border-b border-rule pb-1.5">About</h2>
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
        <DialogContent className="float border-none bg-paper-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="voice-display text-left text-lg">
              Let everything go?
            </DialogTitle>
            <DialogDescription className="voice-prose text-left text-[0.92rem] text-ink-soft">
              This erases every entry on this device, permanently. If you want
              a copy first, export before you do this. Hold the button down to
              be sure.
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
            <HoldToErase
              onComplete={async () => {
                await db.snippets.clear();
                setEraseOpen(false);
                toast("The page is blank again.");
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A miniature of the theme itself: the desk, the sheet, a few lines of ink. */
function ThemeSwatch({
  label,
  active,
  onPick,
  paper,
  desk,
  ink,
  split = false,
}: {
  label: string;
  active: boolean;
  onPick: () => void;
  paper: string;
  desk: string;
  ink: string;
  split?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={cn(
        "pressable hover-lift group flex flex-col items-center gap-1.5 rounded-[8px] p-1.5",
        active && "shadow-[0_0_0_1.5px_var(--wax)]",
      )}
    >
      <span
        className="relative grid h-16 w-20 place-items-center overflow-hidden rounded-[5px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_3px_rgb(var(--shadow-hue)/0.25)]"
        style={{ background: desk }}
        aria-hidden="true"
      >
        {split && (
          <span
            className="absolute inset-0"
            style={{
              background: "linear-gradient(115deg, transparent 50%, #0f0c08 50%)",
            }}
          />
        )}
        <span
          className="relative h-11 w-14 rounded-[2.5px] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.18),0_3px_6px_rgb(0_0_0/0.12)]"
          style={{ background: paper }}
        >
          <span className="block h-[2.5px] w-7 rounded-full" style={{ background: ink, opacity: 0.85 }} />
          <span className="mt-1 block h-[2px] w-9 rounded-full" style={{ background: ink, opacity: 0.3 }} />
          <span className="mt-[3px] block h-[2px] w-8 rounded-full" style={{ background: ink, opacity: 0.3 }} />
          <span
            className="mt-1.5 block size-2 rounded-full"
            style={{ background: "#993b26" }}
          />
        </span>
      </span>
      <span
        className={cn(
          "voice-label text-[0.8rem] transition-colors duration-150",
          active ? "text-ink" : "text-ink-faint group-hover:text-ink-soft",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** A raised paper button: lit on top, it depresses when pressed. */
function PaperButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[5px] bg-paper-raised px-3.5 py-1.5 font-serif text-[0.92rem] text-ink",
        "shadow-[inset_0_1px_0_var(--press-highlight),inset_0_-1px_0_rgb(0_0_0/0.05),0_0_0_1px_rgb(var(--shadow-hue)/0.1),0_1px_2px_rgb(var(--shadow-hue)/0.12),0_2px_6px_rgb(var(--shadow-hue)/0.07)]",
        "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "active:translate-y-px active:scale-[0.98] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12),0_0_0_1px_rgb(var(--shadow-hue)/0.1)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Hold to erase — slow where the writer is deciding, fast where the
 * system responds. The wax fills the button while held; release and
 * it drains back instantly.
 */
function HoldToErase({ onComplete }: { onComplete: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (timer.current) return;
    setHolding(true);
    navigator.vibrate?.(20);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onComplete();
    }, 1400);
  };
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  };
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className="relative select-none overflow-hidden rounded-[5px] bg-wax px-4 py-2 font-serif text-[0.95rem] text-paper-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_3px_rgb(var(--shadow-hue)/0.3)]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-wax-deep"
        style={{
          clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: holding
            ? "clip-path 1.4s linear"
            : "clip-path 200ms var(--ease-out)",
        }}
      />
      <span className="relative">
        {holding ? "Hold…" : "Hold to erase"}
      </span>
    </button>
  );
}
