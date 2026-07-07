"use client";

import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";

/**
 * A page title that is also the way back — the drawn guillemet from the
 * schedule header sits in front of it, and pressing it returns to
 * wherever you came from (falling back to the book on a cold load).
 * Shared by Settings and Privacy so the two can't drift.
 */
export function PageBackHeader({ title }: { title: string }) {
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1)
      router.back();
    else router.push("/calendar");
  };
  return (
    <header className="mb-8">
      <button
        type="button"
        onClick={goBack}
        aria-label={copy.settings.back}
        // font-size on the button so the chevron's em scales to the title,
        // at the same 0.58em ratio it wears against the month header
        className="pressable inline-flex items-baseline rounded-[5px] text-left text-[2.5rem] leading-[1.02] hover:text-wax sm:text-[2.9rem]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 580.5 770.7"
          className="mr-1.5 inline-block h-[0.58em] w-auto -translate-y-[0.08em] text-ink-faint"
          fill="currentColor"
        >
          <path d="M2.5 361.7Q9.2 341.0 29.6 323.6Q50.0 306.3 93.9 280.9Q194.1 222.2 270.3 175.3Q346.5 128.4 404.2 89.6Q461.8 50.7 505.6 17.8Q526.6 4.1 545.6 0.8Q564.5 -2.5 573.8 7.3Q584.0 18.1 578.7 33.0Q573.3 47.9 557.4 66.6Q528.7 98.6 492.7 135.8Q456.7 172.9 412.8 215.7Q369.0 258.5 316.2 308.1Q263.3 357.6 200.6 414.5L209.2 350.7Q254.5 428.8 286.1 494.0Q317.6 559.3 339.9 613.0Q362.2 666.7 378.3 711.2Q384.8 727.5 382.6 742.0Q380.5 756.4 367.8 764.6Q353.6 773.3 339.9 769.5Q326.2 765.8 313.8 751.2Q286.3 712.3 249.6 665.8Q212.9 619.3 162.8 564.8Q112.7 510.4 43.4 448.7Q14.2 421.7 5.3 402.8Q-3.6 383.8 2.5 361.7Z" />
        </svg>
        <h1 className="voice-display leading-[1.02]">{title}</h1>
      </button>
    </header>
  );
}
