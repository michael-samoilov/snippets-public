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
import { copy } from "@/lib/copy";
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
      toast(copy.settings.toasts.restored(count));
    } catch (error) {
      toast(copy.settings.toasts.importFailed, {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <div className="page-settle">
      <header className="mb-8">
        <h1 className="voice-display ink-bleed text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          {copy.settings.title}
        </h1>
      </header>

      <div className="space-y-10">
        <section aria-label={copy.settings.appearance.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.appearance.heading}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3" role="radiogroup" aria-label={copy.settings.appearance.themeLabel}>
            <ThemeSwatch
              label={copy.themes.paper}
              active={mounted && theme === "light"}
              onPick={() => setTheme("light")}
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
            <ThemeSwatch
              label={copy.themes.lamplight}
              active={mounted && theme === "dark"}
              onPick={() => setTheme("dark")}
              paper="#1d1812"
              desk="#0f0c08"
              ink="#eae1cd"
            />
            <ThemeSwatch
              label={copy.themes.system}
              active={mounted && theme === "system"}
              onPick={() => setTheme("system")}
              split
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
          </div>
        </section>

        <section aria-label={copy.settings.calendar.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.calendar.heading}</h2>
          <div className="mt-4 flex items-center justify-between gap-6">
            <div>
              <p className="font-serif text-[0.98rem]">{copy.settings.calendar.startWeek}</p>
              <p className="voice-prose mt-0.5 max-w-[42ch] text-[0.9rem] text-ink-soft">
                {copy.settings.calendar.startWeekHint}
              </p>
            </div>
            <WeekStartChoice
              value={settings.weekStart}
              onChange={(v) => updateSettings({ weekStart: v })}
            />
          </div>
        </section>

        <section aria-label={copy.settings.filing.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.filing.heading}</h2>
          <div className="mt-4 flex items-start justify-between gap-6">
            <div>
              <p className="font-serif text-[0.98rem]">{copy.settings.filing.auto}</p>
              <p className="voice-prose mt-0.5 max-w-[42ch] text-[0.9rem] text-ink-soft">
                {copy.settings.filing.autoHint}
              </p>
            </div>
            <Switch
              checked={settings.autoFile}
              onCheckedChange={(checked) => updateSettings({ autoFile: checked })}
              aria-label={copy.settings.filing.auto}
            />
          </div>
        </section>

        <section aria-label={copy.settings.data.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.data.heading}</h2>
          <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
            {copy.settings.data.lead}
            {stats && stats.total > 0 && (
              <> {copy.settings.data.countSoFar(stats.total)}</>
            )}{" "}
            {copy.settings.data.takeCopy}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <PaperButton onClick={() => void exportJSON()}>
              {copy.settings.data.exportJSON}
            </PaperButton>
            <PaperButton onClick={() => void exportMarkdown()}>
              {copy.settings.data.exportMarkdown}
            </PaperButton>
            <PaperButton onClick={() => fileRef.current?.click()}>
              {copy.settings.data.restore}
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
              className="px-0 font-serif text-ember hover:bg-transparent hover:text-ember-deep"
              onClick={() => setEraseOpen(true)}
            >
              {copy.settings.data.eraseAll}
            </Button>
          </div>
        </section>

        <section aria-label={copy.settings.about.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.about.heading}</h2>
          <p className="voice-prose mt-4 max-w-[48ch] text-[0.9rem] text-ink-soft">
            {copy.settings.about.lead}
            <em>{copy.settings.about.workTitle}</em>
            {copy.settings.about.rest}
          </p>
        </section>
      </div>

      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent className="float border-none bg-paper-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="voice-display text-left text-lg">
              {copy.settings.erase.title}
            </DialogTitle>
            <DialogDescription className="voice-prose text-left text-[0.92rem] text-ink-soft">
              {copy.settings.erase.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="font-serif"
              onClick={() => setEraseOpen(false)}
            >
              {copy.settings.erase.cancel}
            </Button>
            <HoldToErase
              onComplete={async () => {
                await db.snippets.clear();
                setEraseOpen(false);
                toast(copy.settings.toasts.erased);
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A two-way segmented choice: a raised paper chip sits in a recessed trough. */
function WeekStartChoice({
  value,
  onChange,
}: {
  value: 0 | 1;
  onChange: (v: 0 | 1) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={copy.settings.calendar.startWeek}
      className="inline-flex shrink-0 gap-0.5 rounded-[7px] bg-paper-recessed p-0.5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.1)]"
    >
      {([
        [0, copy.settings.calendar.sunday],
        [1, copy.settings.calendar.monday],
      ] as const).map(([v, label]) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn(
              "pressable rounded-[5px] px-3.5 py-1.5 font-serif text-[0.9rem]",
              active
                ? "bg-paper-raised text-ink shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.12)]"
                : "text-ink-faint",
            )}
          >
            {label}
          </button>
        );
      })}
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
        "pressable hover-lift group flex w-full flex-col items-center gap-1.5 rounded-[8px] p-1.5",
        active && "shadow-[0_0_0_1.5px_var(--wax)]",
      )}
    >
      <span
        className="relative grid h-16 w-full place-items-center overflow-hidden rounded-[5px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_3px_rgb(var(--shadow-hue)/0.25)]"
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
            style={{ background: "#2e5685" }}
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
      className="relative select-none overflow-hidden rounded-[5px] bg-ember px-4 py-2 font-serif text-[0.95rem] text-paper-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_3px_rgb(var(--shadow-hue)/0.3)]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-ember-deep"
        style={{
          clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: holding
            ? "clip-path 1.4s linear"
            : "clip-path 200ms var(--ease-out)",
        }}
      />
      <span className="relative">
        {holding ? copy.settings.erase.holding : copy.settings.erase.hold}
      </span>
    </button>
  );
}
