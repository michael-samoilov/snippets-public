"use client";

import { useSyncExternalStore } from "react";

/** the reader's text-size step; maps to a root-font-size multiplier in CSS */
export type TextScale = "small" | "default" | "large" | "larger";

export interface Settings {
  /** first day of the week in the calendar grids: 0 = Sunday, 1 = Monday */
  weekStart: 0 | 1;
  /** text size (Settings → Appearance); scales the whole rem-based type system */
  textScale: TextScale;
}

const DEFAULTS: Settings = {
  weekStart: 0,
  textScale: "default",
};

/**
 * Reflect the chosen text size onto the document root. The pre-paint inline
 * script in the root layout sets this first (no size flash); this keeps it in
 * step when the reader changes it live. "default" carries no attribute, so the
 * DOM stays clean and the CSS falls back to the 1x scale.
 */
export function applyTextScale(scale: TextScale): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (scale === "default") root.removeAttribute("data-text-scale");
  else root.setAttribute("data-text-scale", scale);
}

const STORAGE_KEY = "snippets:settings";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  if (typeof window === "undefined") return DEFAULTS;
  let loaded: Settings = DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // unreadable storage — fall back to defaults
  }
  cache = loaded;
  return loaded;
}

export function getSettings(): Settings {
  return read();
}

/**
 * Read the text size straight from storage, bypassing the module cache. After a
 * bfcache restore the module's `cache` is frozen at the value from before the
 * reader left, so the pageshow re-apply must read the live localStorage instead.
 */
export function getStoredTextScale(): TextScale {
  if (typeof window === "undefined") return DEFAULTS.textScale;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Settings>).textScale : undefined;
    return v ?? DEFAULTS.textScale;
  } catch {
    return DEFAULTS.textScale;
  }
}

export function updateSettings(changes: Partial<Settings>): void {
  cache = { ...read(), ...changes };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage full or unavailable — keep the in-memory value
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
