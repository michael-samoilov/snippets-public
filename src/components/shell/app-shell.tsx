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
    // svh, not dvh: the book never scrolls the PAGE (overscroll-behavior:none;
    // the feeds scroll inside), so the browser chrome never retracts and svh ==
    // the live viewport. Crucially svh is a STATIC small-viewport value, so it
    // can't over-report on iOS's first paint the way dvh does (dvh there can
    // measure the address-bar-RETRACTED height, then never re-lay-out when the
    // bar settles — which left the full-viewport today zone taller than the
    // screen until a refresh).
    <div className="mx-auto flex h-svh w-full max-w-[46rem] flex-col overflow-hidden px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-8 sm:pb-8">
      {/* desk chrome — the book is the only page now, so there's no nav: just
          the wordmark and the account mark on the desk's top edge */}
      <header className="flex shrink-0 items-center justify-between px-2 pb-2 pt-2 sm:px-1 sm:pb-3 sm:pt-4">
        <Wordmark />
        <ProfileMenu />
      </header>

      {/* the sheet of paper */}
      <Sheet className="flex min-h-0 flex-1 flex-col px-5 pb-2 pt-5 sm:px-10 sm:pb-3 sm:pt-9">
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
        <SheetScroll className="-mx-2 mb-2.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:mb-6 [scrollbar-width:none]">
          {children}
        </SheetScroll>
      </Sheet>

      <CommandMenu />
    </div>
  );
}
