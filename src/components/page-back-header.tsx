"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import {
  useScrollEdges,
  ScrollTerminus,
} from "@/components/ui/scroll-terminus";
import { copy } from "@/lib/copy";

/**
 * The shell every sub-page (Settings, Privacy) wears, so they can't drift
 * from each other or from the book. It is the calendar's schedule/entry
 * header, exactly: a small `--date-head` title that is itself the way back
 * (the drawn guillemet in front of it), a persistent hairline beneath —
 * the scroll area's top terminus, the same rule the month header wears —
 * and the page's content in its own scroller below, carrying the fading
 * foot terminus. The header sits ABOVE that scroller, so content never
 * bleeds under it and no painted band is needed (a flat fill over the
 * textured sheet would read as one).
 */
export function PageBackHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  // liveHeight: sections appear/disappear on sign-in and unlock, changing the
  // content height without resizing the scroller — read it live so the foot
  // terminus stays honest.
  const edges = useScrollEdges(scrollRef, [], true);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1)
      router.back();
    else router.push("/calendar");
  };

  return (
    <div className="page-settle flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={goBack}
        aria-label={copy.settings.back}
        // font-size on the button so the chevron's em scales to the title, at
        // the same 0.58em ratio and `--date-head` size it wears in the book's
        // month/entry header. NO leading override: the book's title carries
        // voice-display's own line-height, and this one must paint at the
        // identical baseline or the header jitters when navigating between
        // the calendar and these pages.
        className="pressable inline-flex shrink-0 items-baseline self-start whitespace-nowrap rounded-[5px] text-left text-(length:--date-head) hover:text-wax"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 580.5 770.7"
          className="mr-1.5 inline-block h-[0.58em] w-auto -translate-y-[0.08em] text-ink-faint"
          fill="currentColor"
        >
          <path d="M2.5 361.7Q9.2 341.0 29.6 323.6Q50.0 306.3 93.9 280.9Q194.1 222.2 270.3 175.3Q346.5 128.4 404.2 89.6Q461.8 50.7 505.6 17.8Q526.6 4.1 545.6 0.8Q564.5 -2.5 573.8 7.3Q584.0 18.1 578.7 33.0Q573.3 47.9 557.4 66.6Q528.7 98.6 492.7 135.8Q456.7 172.9 412.8 215.7Q369.0 258.5 316.2 308.1Q263.3 357.6 200.6 414.5L209.2 350.7Q254.5 428.8 286.1 494.0Q317.6 559.3 339.9 613.0Q362.2 666.7 378.3 711.2Q384.8 727.5 382.6 742.0Q380.5 756.4 367.8 764.6Q353.6 773.3 339.9 769.5Q326.2 765.8 313.8 751.2Q286.3 712.3 249.6 665.8Q212.9 619.3 162.8 564.8Q112.7 510.4 43.4 448.7Q14.2 421.7 5.3 402.8Q-3.6 383.8 2.5 361.7Z" />
        </svg>
        <h1 className="voice-display">{title}</h1>
      </button>

      {/* the scroll area's top terminus: a persistent hairline beneath the
          header — mt-5 seats it exactly where the book's weekday rail rules
          off under the month title, so the line holds still across pages */}
      <div className="mt-5 shrink-0 border-b border-rule-faint" aria-hidden="true" />

      {/* the page's own scroller — content clips at the hairline and never
          overlaps the header above it (the -mx/px pair keeps focus rings and
          selection shadows at the content edge inside the clip; pb-8 keeps
          the last control off the fold, so the foot terminus only ever
          overlaps blank paper, never a button's bottom edge) */}
      <div
        ref={scrollRef}
        className="-mx-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-8 pt-6 [scrollbar-width:none]"
      >
        {children}
        <ScrollTerminus show={edges.bottom} />
      </div>
    </div>
  );
}
