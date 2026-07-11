"use client";

import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useSession } from "@/lib/auth";
import { copy } from "@/lib/copy";

/**
 * The account mark on the desk's top edge — the door to sign-in,
 * Settings, the privacy policy, and out. While the session is still
 * loading it renders as signed-out; no flicker states.
 */
export function ProfileMenu() {
  const router = useRouter();
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
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={copy.account.label}
        // focus ring is a box-shadow, not the global square outline, so it
        // hugs the round button; the base inset highlight + drop shadow ride
        // along on focus
        className="pressable flex size-8 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-raised text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.08)] hover:text-ink focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--wax),inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.08)] data-[state=open]:text-ink"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="float origin-(--radix-dropdown-menu-content-transform-origin) border-none font-serif data-[state=closed]:duration-100 data-[state=open]:duration-150"
      >
        {user ? (
          <DropdownMenuLabel className="max-w-[16rem] truncate font-normal text-ink-faint">
            {user.email}
          </DropdownMenuLabel>
        ) : (
          <DropdownMenuItem onSelect={() => router.push("/signin")}>
            <MenuRow icon={<PersonIcon />}>{copy.account.signIn}</MenuRow>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <MenuRow icon={<GearIcon />}>{copy.account.settings}</MenuRow>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/privacy")}>
          <MenuRow icon={<ShieldIcon />}>{copy.account.privacy}</MenuRow>
        </DropdownMenuItem>
        {user && (
          <DropdownMenuItem onSelect={() => void signOut()}>
            <MenuRow icon={<SignOutIcon />}>{copy.account.signOut}</MenuRow>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A menu row: a quiet ink line-glyph, then the label. */
function MenuRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="text-ink-faint">{icon}</span>
      {children}
    </span>
  );
}

/**
 * One set (Feather), one weight: 1.8 on a 24 viewBox renders the same
 * line as the app's 1.5-on-20 marks (the mic, the search glass) at
 * this 16px size. Stroke-drawn, round caps — kin to the hand-drawn
 * dock strokes, never a filled icon-font glyph.
 */
const iconProps = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// the Feather shield with a padlock set inside — protection that reads
// specifically as a LOCK (kept identical wherever a shield appears)
function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <rect x="8.8" y="10.2" width="6.4" height="4" rx="0.95" />
      <path d="M10.1 10.2v-1.35a1.9 1.9 0 0 1 3.8 0v1.35" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
