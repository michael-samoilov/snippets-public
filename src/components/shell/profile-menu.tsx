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
 * The account mark on the desk's top edge — the door to sign-in and
 * to Settings. While the session is still loading it renders as
 * signed-out; no flicker states.
 */
export function ProfileMenu() {
  const router = useRouter();
  const { user } = useSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={copy.account.label}
        className="pressable flex size-8 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-raised text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.08)] hover:text-ink data-[state=open]:text-ink"
      >
        {user ? (
          <span className="voice-label text-[0.72rem] leading-none">
            {user.name
              .split(/\s+/)
              .map((w) => w[0])
              .slice(0, 2)
              .join("")}
          </span>
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
            {copy.account.signIn}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          {copy.account.settings}
        </DropdownMenuItem>
        {user && (
          <DropdownMenuItem onSelect={() => void signOut()}>
            {copy.account.signOut}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
