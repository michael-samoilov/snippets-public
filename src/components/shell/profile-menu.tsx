"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth";
import { copy } from "@/lib/copy";

/**
 * The account mark on the desk's top edge — a single tap to Settings,
 * whose Account tab opens first (sign-in, or the signed-in address and
 * sign-out). No dropdown: the destination is one screen for every intent,
 * so the menu was a click in the way. While the session is still loading
 * it renders as signed-out; no flicker states.
 */
export function ProfileMenu() {
  const { user } = useSession();

  const initials = user
    ? user.name
        .split(/\s+/)
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <Link
      href="/settings"
      aria-label={copy.account.label}
      // focus ring is a box-shadow, not the global square outline, so it
      // hugs the round button; the base inset highlight + drop shadow ride
      // along on focus
      className="pressable flex size-8 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-raised text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.08)] hover:text-ink focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--wax),inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.08)]"
    >
      {user ? (
        // optical centring by glyph geometry (no pixel nudge): the text is
        // anchored to the exact middle of the 32×32 box on both axes
        <svg viewBox="0 0 32 32" className="size-full" aria-hidden="true">
          <text
            x="16"
            y="16.5"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-current font-serif"
            fontSize="12.5"
            fontWeight={500}
          >
            {initials}
          </text>
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-[17px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="10" cy="7" r="3.1" />
          <path d="M4.2 16.4c1.2-2.9 3.3-4.3 5.8-4.3s4.6 1.4 5.8 4.3" />
        </svg>
      )}
    </Link>
  );
}
