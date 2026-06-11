"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

/** Desktop: quiet mono-caps links across the top. */
export function ShellNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden gap-5 sm:flex">
      {LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "voice-meta transition-colors duration-150",
              active ? "text-ink" : "hover:text-ink-soft",
            )}
          >
            {label}
            <span
              aria-hidden="true"
              className={cn(
                "mx-auto mt-1 block h-[3px] w-[3px] rounded-full transition-opacity duration-150",
                active ? "bg-wax opacity-100" : "opacity-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile: a typographic tab bar — words, not icons. */
export function ShellTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="mx-auto flex max-w-[42rem] items-stretch justify-around">
        {LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "voice-meta flex flex-col items-center gap-1 px-3 pb-2.5 pt-3 transition-colors duration-150",
                active ? "text-ink" : "",
              )}
            >
              {label}
              <span
                aria-hidden="true"
                className={cn(
                  "block h-[3px] w-[3px] rounded-full",
                  active ? "bg-wax" : "bg-transparent",
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
