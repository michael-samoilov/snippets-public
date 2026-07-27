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
    // The box is FIXED and TOP-ANCHORED, and its height is the MEASURED viewport
    // (--app-h, pinned pre-paint by the root layout's inline script), not a CSS
    // viewport unit and not the fixed box's own bottom edge. Two on-device facts
    // (see the git history) forced this shape: a no-JS probe proved svh/lvh/dvh
    // ALL resolve too tall on iOS, and frame-by-frame video proved that on a cold
    // navigation iOS lays out the very first paint against a stale, too-tall
    // viewport — with the browser chrome already visually at rest — and only
    // re-resolves fixed/inset geometry a beat later. So anything anchored to the
    // viewport's BOTTOM (inset:0) or sized by its units paints one frame (or two
    // seconds) of "today zone too tall, seal under the toolbar" before snapping.
    // A pixel height is immune: visualViewport/innerHeight read CORRECTLY from
    // the first script tick even while the CSS viewport is stale, the inline
    // script writes --app-h before first paint, and layout uses the pixel value
    // as-is. The measured height also intentionally TRACKS the URL-bar keyboard
    // on cold loads (the page simply grows as the keyboard leaves); the in-app
    // keyboard is guarded out by the script, so the shell never collapses while
    // writing — useKeyboardRoom lifts the focused field instead, as before.
    // TOP-ANCHORED means the VISIBLE window's top, not the layout viewport's:
    // --app-top is the visual viewport's offset in layout coordinates (0 unless
    // the browser parks the two out of step — Chrome iOS does it on a fresh tab,
    // see the root layout's script). top:0 put the desk's head off-screen and
    // left a strip of bare canvas below its foot whenever that happened.
    <div
      data-app-shell
      className="fixed inset-x-0 top-[var(--app-top)] flex h-[var(--app-h)] justify-center overflow-hidden"
    >
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
