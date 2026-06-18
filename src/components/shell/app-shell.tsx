import { ShellNav, ShellTabs } from "@/components/shell/shell-nav";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { Sheet } from "@/components/shell/sheet";
import { SheetScroll } from "@/components/shell/sheet-scroll";
import { CommandMenu } from "@/components/command-menu";
import { Wordmark } from "@/components/shell/wordmark";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // the desk is exactly one screen at every size: the sheet takes the
    // remaining height and pages scroll inside it, never the page. (An
    // indefinite min-h chain on desktop let h-full children collapse —
    // the calendar's stage shrank to its 1px border.)
    <div className="mx-auto flex h-dvh w-full max-w-[46rem] flex-col overflow-hidden px-3 pb-[calc(max(env(safe-area-inset-bottom),0.75rem)+3.9rem)] sm:px-8 sm:pb-8">
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
        <Wordmark />
        <div className="flex items-center gap-6">
          <ShellNav />
          <ProfileMenu />
        </div>
      </header>

      {/* the sheet of paper */}
      <Sheet className="flex min-h-0 flex-1 flex-col px-5 pb-2 pt-6 sm:px-10 sm:pb-3 sm:pt-9">
        {/* overflow-x hidden, explicitly: setting only overflow-y makes
            the other axis auto per spec, and iOS pans it sideways on a
            diagonal swipe — the page then sits "clipped" at scrollLeft>0
            -mx/px cancel visually but move the clip boundary out, so focus
            rings and selection shadows at the content edge survive the
            scroll container (the Settings swatch ring was shorn).
            mb (not pb) for the bottom gap: a sticky foot is constrained
            to the content box, so bottom padding would leave a strip of
            scrollport below the terminus where content shows past it —
            a margin ends the scroller exactly at the line instead. */}
        <SheetScroll className="-mx-2 mb-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:mb-6 [scrollbar-width:none]">
          {children}
        </SheetScroll>
      </Sheet>

      <ShellTabs />
      <CommandMenu />
    </div>
  );
}
