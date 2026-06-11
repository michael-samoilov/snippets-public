"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/collection", label: "Collection" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
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

/** Mobile: a floating dock of words on the desk. */
export function ShellTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:hidden"
    >
      <div className="float flex items-center gap-1 rounded-full px-2 py-1">
        {LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "voice-label pressable relative rounded-full px-3 py-2 text-[0.8rem]",
                active ? "text-ink" : "text-ink-faint",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-ink"
                  aria-hidden="true"
                  transition={underlineSpring}
                  className="absolute inset-0 rounded-full bg-accent"
                />
              )}
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
