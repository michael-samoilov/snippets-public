import { ProfileMenu } from "@/components/shell/profile-menu";
import { Sheet } from "@/components/shell/sheet";
import { SheetScroll } from "@/components/shell/sheet-scroll";
import { CommandMenu } from "@/components/command-menu";
import { Wordmark } from "@/components/shell/wordmark";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // The desk is exactly one screen: the sheet takes the remaining height and
    // pages scroll inside it, never the page.
    //
    // The height comes from `position: fixed; inset: 0`, NOT any CSS viewport
    // unit. A no-JS probe on the reporter's device (see the git history) proved
    // that svh, lvh, AND dvh ALL resolve too tall there — their bottom edge falls
    // BELOW the visible viewport, so a full-height today zone overflowed and the
    // wax seal clipped off the bottom until a refresh. Only fixed/inset:0 — which
    // the browser sizes directly to the viewport rather than by resolving a
    // length — lands exactly at the true bottom. So the outer layer is that fixed
    // box (the correct one-screen height), and the inner column re-establishes the
    // centered, max-width desk inside it. No measurement, no --app-h script: fixed
    // inset:0 is immune to the unit mis-resolution by construction. When the
    // keyboard opens the fixed box stays full height (iOS overlays the keyboard);
    // useKeyboardRoom lifts the focused field, exactly as before.
    <div className="fixed inset-0 flex justify-center overflow-hidden">
      <div className="flex h-full w-full max-w-[46rem] flex-col overflow-hidden px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-8 sm:pb-8">
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
    </div>
  );
}
