import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Join written and spoken text with a single space, either side empty-safe. */
export function joinText(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return `${a.replace(/\s+$/, "")} ${b}`;
}

/**
 * Whether an Enter keystroke in a writing field should file the entry. On a
 * device with a real keyboard (fine pointer + hover) Enter files and
 * Shift+Enter is a newline — the desktop compose idiom. On a touch device
 * there is no Shift+Enter, so the return key must break the line: Enter never
 * files there, the wax seal does. The pointer/hover query is the same "desktop"
 * signal the app already gates its hover affordances behind.
 */
export function enterFiles(e: { key: string; shiftKey: boolean }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}
