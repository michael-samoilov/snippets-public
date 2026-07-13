"use client";

import { useEffect, useRef, useState } from "react";
import { useScrollEdges } from "@/components/ui/scroll-terminus";
import { cn } from "@/lib/utils";

/* A/B: the entry card's hand-rolled foot fade vs shadcn's scroll-fade-b.
   Scroll each card — the fade only lives while more words lie below, and
   clears at the last line. Dev-only harness. */

const TEXT = `On the bus home at around 6PM, a man got on with a cello case nearly as tall as he was and looked for a spot a few seats away from me.

He asked the driver if he could stand in the aisle with it for two more stops; the driver nodded: "hold on to the rail and you're fine by me."

The woman opposite him said "here, take my seat, the case will fit better by the window", and moved to the back before he could answer.

Then the bus took the corner hard, the case tipped, and three of us caught it at once, laughing about it for the rest of the ride.

I keep turning it over. The ordinary kindness of the woman across the aisle. My own hesitation, which was its own kind of answer. The way the doors opened and the street just carried on, unhurried, warm, lit.`;

function Frame({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="voice-data text-ink-soft">{label}</span>
        <span className="voice-data text-ink-faint">{note}</span>
      </div>
      <div
        className="relative flex h-[300px] flex-col overflow-hidden rounded-[10px] border bg-paper"
        style={{
          borderColor: "var(--card-seat-border)",
          boxShadow: "var(--card-seat)",
        }}
      >
        {children}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
          style={{ boxShadow: "inset 0 1px 0 var(--press-highlight)" }}
        />
      </div>
    </div>
  );
}

const proseCls =
  "voice-prose whitespace-pre-wrap leading-[1.5] text-[0.95rem]";
const scrollerCls =
  "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-3 [overflow-anchor:none] [overflow-wrap:anywhere] [scrollbar-width:none]";

/* A — the current hand-rolled foot fade (overlay + paper band + hairline),
   driven by the useScrollEdges hook. Lifted from EntryBody. */
function DiyCard() {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref, [], false);
  return (
    <Frame label="a · diy (current)" note="overlay + hairline · js">
      <div ref={ref} className={scrollerCls}>
        <p className={proseCls}>{TEXT}</p>
      </div>
      <div className="relative shrink-0">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full z-[6] h-8 transition-opacity duration-200",
            edges.bottom ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="absolute inset-x-0 top-0 bottom-[2px] bg-gradient-to-t from-paper to-transparent" />
          <div className="absolute inset-x-0 bottom-[-4px] h-[6px] bg-paper" />
          <div className="absolute inset-x-4 bottom-0 border-t border-rule-faint" />
        </div>
        <div className="h-9" />
      </div>
    </Frame>
  );
}

/* B/C — shadcn scroll-fade-b: a scroll-driven mask on the scroller itself.
   No JS, no overlay, no hairline. Optionally sized to match the DIY 2rem. */
function ShadcnCard({ sized }: { sized?: boolean }) {
  return (
    <Frame
      label={sized ? "c · scroll-fade-b-8" : "b · scroll-fade-b"}
      note={sized ? "mask · 2rem (matches diy)" : "mask · default 12%"}
    >
      <div
        className={cn(scrollerCls, "scroll-fade-b", sized && "scroll-fade-b-8")}
      >
        <p className={proseCls}>{TEXT}</p>
      </div>
      <div className="h-9 shrink-0" />
    </Frame>
  );
}

export default function ScrollFadeLab() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(
      typeof CSS !== "undefined" &&
        CSS.supports("animation-timeline: scroll()"),
    );
  }, []);
  return (
    <main
      className="min-h-dvh px-5 py-10"
      style={{ background: "var(--desk)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="voice-display text-xl text-ink">scroll fade — a/b</h1>
          <p className="voice-data text-ink-faint">
            scroll each card. scroll-driven animations{" "}
            {supported === null
              ? "…"
              : supported
                ? "supported here"
                : "NOT supported here → shadcn fades degrade to none"}
          </p>
        </header>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <DiyCard />
          <ShadcnCard />
          <ShadcnCard sized />
        </div>
      </div>
    </main>
  );
}
