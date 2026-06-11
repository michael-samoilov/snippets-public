import Link from "next/link";
import { ShellNav, ShellTabs } from "@/components/shell/shell-nav";
import { CommandMenu } from "@/components/command-menu";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[42rem] flex-col px-5 sm:px-8">
      <header className="flex items-baseline justify-between pb-6 pt-6 sm:pt-10">
        <Link
          href="/"
          className="voice-display text-[1.35rem] italic leading-none tracking-tight"
        >
          Snippets
          <span aria-hidden="true" className="ml-1.5 inline-block size-[7px] -translate-y-[1px] rounded-full bg-wax" />
        </Link>
        <ShellNav />
      </header>

      <main className="flex-1 pb-28 sm:pb-16">{children}</main>

      <footer className="hidden pb-10 pt-4 sm:block">
        <p className="voice-meta">
          Kept on this device · yours alone
        </p>
      </footer>

      <ShellTabs />
      <CommandMenu />
    </div>
  );
}
