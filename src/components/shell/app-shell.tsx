import Link from "next/link";
import { ShellNav, ShellTabs } from "@/components/shell/shell-nav";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { Sheet } from "@/components/shell/sheet";
import { CommandMenu } from "@/components/command-menu";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // on phones the desk is exactly one screen: the sheet takes the
    // remaining height and pages scroll inside it, never the page —
    // the paper's bottom edge stays above the dock
    <div className="mx-auto flex h-dvh w-full max-w-[46rem] flex-col overflow-hidden px-3 sm:h-auto sm:min-h-dvh sm:overflow-visible sm:px-8">
      {/* ink-bleed: a hair of edge wobble for masthead type */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <filter id="ink-bleed" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.22"
            numOctaves="2"
            seed="3"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="1.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      {/* desk chrome */}
      <header className="flex shrink-0 items-center justify-between px-2 pb-4 pt-5 sm:px-1 sm:pt-7">
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
        <div className="flex items-center gap-6">
          <ShellNav />
          <ProfileMenu />
        </div>
      </header>

      {/* the sheet of paper */}
      <Sheet className="flex min-h-0 flex-1 flex-col px-5 py-6 sm:px-10 sm:py-9">
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 sm:overflow-visible sm:pb-6 [scrollbar-width:none]">
          {children}
        </main>
      </Sheet>

      <footer className="shrink-0 px-2 pb-[4.75rem] pt-3 text-center sm:pb-8 sm:pt-5 sm:text-left">
        <p className="font-serif text-[0.8rem] italic text-ink-faint">
          kept on this device, yours alone
        </p>
      </footer>

      <ShellTabs />
      <CommandMenu />
    </div>
  );
}
