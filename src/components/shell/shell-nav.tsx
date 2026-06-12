"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/calendar", label: "Calendar" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const underlineSpring = { type: "spring", stiffness: 480, damping: 40 } as const;

/** Desktop: small-caps serif links; an ink underline glides between them. */
export function ShellNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden gap-6 sm:flex">
      {LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "voice-label pressable relative pb-1",
              active ? "text-ink" : "hover:text-ink",
            )}
          >
            {label}
            {active && (
              <motion.span
                layoutId="nav-ink"
                aria-hidden="true"
                transition={underlineSpring}
                className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* the dock's two marks: a quill for the day's page, a calendar for the
   book — hand-drawn strokes in the ink, owner-sanctioned iconography */

function QuillIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.4 15.6C5.2 10.2 9 5.6 16 3.8c.5 2.7-.7 6.6-3.2 9.1-1.9 1.9-4.9 2.7-8.4 2.7Z" />
      <path d="M4.4 15.6 12.6 7" />
      <path d="M4.4 15.6 3.4 17.6" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <rect x="3.2" y="4.6" width="13.6" height="12" rx="2.2" />
      <path d="M6.8 2.8v3.4M13.2 2.8v3.4M3.2 9h13.6" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "today", Icon: QuillIcon },
  { href: "/calendar", label: "calendar", Icon: CalendarIcon },
] as const;

/** Mobile: a floating dock on the desk — two marks with small words. */
export function ShellTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:hidden"
    >
      <div className="float flex items-center gap-1 rounded-full px-2 py-1">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={cn(
                "pressable relative flex flex-col items-center gap-0.5 rounded-[1.25rem] px-5 pb-1 pt-1.5",
                active ? "text-ink" : "text-ink-faint",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-ink"
                  aria-hidden="true"
                  transition={underlineSpring}
                  className="absolute inset-0 rounded-[1.25rem] bg-accent"
                />
              )}
              <Icon className="relative size-5" />
              <span className="voice-label relative text-[0.6rem] leading-none">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
