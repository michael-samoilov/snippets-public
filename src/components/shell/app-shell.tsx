import Link from "next/link";
import { ShellNav, ShellTabs } from "@/components/shell/shell-nav";
import { Sheet } from "@/components/shell/sheet";
import { CommandMenu } from "@/components/command-menu";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[46rem] flex-col px-3 sm:px-8">
      {/* desk chrome */}
      <header className="flex items-baseline justify-between px-2 pb-4 pt-5 sm:px-1 sm:pt-7">
        <Link
          href="/"
          className="voice-display pressable text-[1.3rem] italic leading-none tracking-tight"
        >
          Snippets
          <svg
            aria-hidden="true"
            viewBox="0 0 10 10"
            className="ml-1.5 inline-block size-[9px] -translate-y-px"
          >
            <circle cx="5" cy="5" r="5" fill="var(--wax-deep)" />
            <circle cx="5" cy="5" r="4.2" fill="var(--wax)" />
            <circle cx="3.6" cy="3.4" r="1.6" fill="var(--wax-bright)" opacity="0.7" />
          </svg>
        </Link>
        <ShellNav />
      </header>

      {/* the sheet of paper */}
      <Sheet className="flex-1 px-5 py-7 sm:px-10 sm:py-9">
        <main className="pb-6">{children}</main>
      </Sheet>

      <footer className="px-2 pb-24 pt-5 text-center sm:pb-8 sm:text-left">
        <p className="font-serif text-[0.8rem] italic text-ink-faint">
          kept on this device, yours alone
        </p>
      </footer>

      <ShellTabs />
      <CommandMenu />
    </div>
  );
}
