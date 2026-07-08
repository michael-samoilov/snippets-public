"use client";

import { useSyncExternalStore } from "react";

export interface Settings {
  /** first day of the week in the calendar grids: 0 = Sunday, 1 = Monday */
  weekStart: 0 | 1;
}

const DEFAULTS: Settings = {
  weekStart: 0,
};

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
