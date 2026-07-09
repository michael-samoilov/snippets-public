"use client";

import { cn } from "@/lib/utils";

/**
 * A raised paper button: lit on top, it depresses when pressed.
 * The house's quiet workhorse for settings-grade actions (the capture
 * surfaces have their own wax physics).
 */
export function PaperButton({
  children,
  onClick,
  disabled = false,
  type = "button",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[5px] bg-paper-raised px-3.5 py-1.5 font-serif text-[0.92rem] text-ink",
        "shadow-[inset_0_1px_0_var(--press-highlight),inset_0_-1px_0_rgb(0_0_0/0.05),0_0_0_1px_rgb(var(--shadow-hue)/0.1),0_1px_2px_rgb(var(--shadow-hue)/0.12),0_2px_6px_rgb(var(--shadow-hue)/0.07)]",
        "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "active:translate-y-px active:scale-[0.98] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12),0_0_0_1px_rgb(var(--shadow-hue)/0.1)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
