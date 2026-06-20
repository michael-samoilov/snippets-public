"use client";

/* TEMPORARY dev harness: every keep-seal variant playing at once, side by side,
   so the differences are easy to compare. Two axes — WHERE the seal presses
   (corner / centre / travel) and HOW it leaves (grow / rise / shrink / fade).
   Not linked in production; removed before ship. */

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { motion, MotionConfig, useAnimationControls } from "motion/react";
import Link from "next/link";
import { WaxStamp, type Exit } from "@/components/capture/wax-stamp";
import type { SealPos } from "@/components/schedule/keep-sequence";
import { cn } from "@/lib/utils";

// the seal-row inner width, so the centre/travel offset is predictable
const ROW_W = 210;
const SEAL = 48;
const CENTRE = -((ROW_W - SEAL) / 2);

function Cell({
  play,
  pos,
  exit,
  title,
  desc,
}: {
  play: number;
  pos: SealPos;
  exit: Exit;
  title: string;
  desc: string;
}) {
  // travel glides corner → centre on each press; centre snaps; corner stays.
  // animation controls (not setState) so the seal canvas never remounts
  const controls = useAnimationControls();
  useEffect(() => {
    if (pos === "travel") {
      controls.set({ x: 0 });
      void controls.start({ x: CENTRE, transition: { duration: 1.2, ease: [0.23, 1, 0.32, 1] } });
    } else {
      void controls.start({
        x: pos === "centre" ? CENTRE : 0,
        transition: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
      });
    }
  }, [play, pos, controls]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex flex-col gap-2 rounded-[10px] border border-rule-faint bg-paper-raised p-3"
        style={{ width: ROW_W + 24 }}
      >
        {/* the kept card (already in place — the press is what we're comparing) */}
        <div
          className="rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
          style={{ width: ROW_W }}
        >
          <p className="voice-prose text-[0.82rem] leading-[1.4]">
            A small thing worth keeping.
          </p>
        </div>
        {/* the seal row */}
        <div className="flex justify-end" style={{ width: ROW_W, height: SEAL }}>
          <motion.div animate={controls} initial={{ x: pos === "centre" ? CENTRE : 0 }}>
            <WaxStamp
              playKey={play}
              size={SEAL}
              glyph="e:quill"
              iconScale={0.36}
              mode="tap"
              lingerMs={500}
              exitMs={520}
              exit={exit}
              variant="spring"
              ease="front"
              bounce={1.5}
              rotate={30}
              superSample={4}
              ignoreReducedMotion
            />
          </motion.div>
        </div>
      </div>
      <div className="text-center" style={{ width: ROW_W + 24 }}>
        <p className="voice-label text-[0.74rem] text-ink">{title}</p>
        <p className="voice-prose mt-0.5 text-[0.72rem] leading-snug text-ink-soft">{desc}</p>
      </div>
    </div>
  );
}

export default function KeepCompare() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  // one shared clock so every cell presses in unison — easy to compare
  const [play, setPlay] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setPlay((p) => p + 1), 4400);
    return () => clearInterval(i);
  }, []);

  const positions: { pos: SealPos; title: string; desc: string }[] = [
    { pos: "corner", title: "Corner", desc: "Presses where the button sits — bottom-right. The seal never moves." },
    { pos: "centre", title: "Centre", desc: "Slides to the row's middle (over the new card), then presses there." },
    { pos: "travel", title: "Travel", desc: "Starts at the corner and glides to the centre as it presses." },
  ];
  const exits: { exit: Exit; title: string; desc: string }[] = [
    { exit: "grow", title: "Swell", desc: "Swells outward as it fades — a satisfied release." },
    { exit: "rise", title: "Rise", desc: "Floats upward as it fades — lifting off the page." },
    { exit: "shrink", title: "Shrink", desc: "Draws down into the page as it fades." },
    { exit: "fade", title: "Fade", desc: "Simply dissolves in place — the quiet option." },
  ];

  return (
    <MotionConfig reducedMotion="never">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h1 className="voice-display text-[1.4rem]">Keep-seal comparison</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTheme(dark ? "light" : "dark")}
                className="voice-label rounded-full bg-paper-recessed px-3 py-1 text-[0.7rem] text-ink-soft"
              >
                {dark ? "lamplight" : "paper"}
              </button>
              <button
                type="button"
                onClick={() => setPlay((p) => p + 1)}
                className="voice-label rounded-full bg-wax px-3 py-1 text-[0.7rem] text-paper"
              >
                replay
              </button>
              <Link
                href="/lab/schedule-submit"
                className="voice-label rounded-full bg-paper-recessed px-3 py-1 text-[0.7rem] text-ink-soft"
              >
                full lab ↗
              </Link>
            </div>
          </div>
          <p className="voice-prose max-w-2xl text-[0.9rem] text-ink-soft">
            The press, the kept card, and the composer wipe are the same in every
            option now. What still differs is the seal itself, on two axes:
            <strong className="text-ink"> where it presses</strong> and
            <strong className="text-ink"> how it leaves</strong>. They all replay
            together every few seconds.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="voice-label text-[0.82rem] text-ink-soft">Where the seal presses</h2>
          <div className="flex flex-wrap gap-6">
            {positions.map((p) => (
              <Cell key={p.pos} play={play} pos={p.pos} exit="grow" title={p.title} desc={p.desc} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="voice-label text-[0.82rem] text-ink-soft">How the seal leaves (pressing at the corner)</h2>
          <div className="flex flex-wrap gap-6">
            {exits.map((e) => (
              <Cell key={e.exit} play={play} pos="corner" exit={e.exit} title={e.title} desc={e.desc} />
            ))}
          </div>
        </section>

        <p className={cn("voice-data text-[0.62rem] text-ink-faint")}>
          build 2026-06-20d · keep-seal compare
        </p>
      </div>
    </MotionConfig>
  );
}
