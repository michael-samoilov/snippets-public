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
    <div className="mx-auto flex h-dvh w-full max-w-[46rem] flex-col overflow-hidden px-3 pb-[calc(max(env(safe-area-inset-bottom),0.75rem)+3.9rem)] sm:h-auto sm:min-h-dvh sm:overflow-visible sm:px-8 sm:pb-8">
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
        <main
          // overflow-x hidden, explicitly: setting only overflow-y makes
          // the other axis auto per spec, and iOS pans it sideways on a
          // diagonal swipe — the page then sits "clipped" at scrollLeft>0
          // -mx/px cancel visually but move the clip boundary out, so focus
          // rings and selection shadows at the content edge survive the
          // scroll container (the Settings swatch ring was shorn)
          className="-mx-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-4 sm:overflow-visible sm:pb-6 [scrollbar-width:none]"
        >
          {children}
        </main>
      </Sheet>

      <ShellTabs />
      <CommandMenu />
    </div>
  );
}
