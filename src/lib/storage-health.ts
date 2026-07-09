"use client";

/**
 * The device-storage ledger: is this origin's data persistent (exempt
 * from the browser's pressure eviction), and how much room is left?
 * Checked at boot — persistence is *requested* once the book holds
 * anything — and surfaced as one quiet line in Settings. The eviction
 * risk is exactly the kind of silent loss this app refuses to allow.
 */
import { useSyncExternalStore } from "react";

export interface StorageHealth {
  /** null = the browser doesn't say */
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
}

let health: StorageHealth = {
  persisted: null,
  usageBytes: null,
  quotaBytes: null,
};
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER_SNAPSHOT: StorageHealth = {
  persisted: null,
  usageBytes: null,
  quotaBytes: null,
};

export function useStorageHealth(): StorageHealth {
  return useSyncExternalStore(
    subscribe,
    () => health,
    () => SERVER_SNAPSHOT,
  );
}

export async function checkStorageHealth(requestPersist: boolean): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage) return;
  try {
    let persisted: boolean | null = null;
    if (navigator.storage.persisted) {
      persisted = await navigator.storage.persisted();
      if (!persisted && requestPersist && navigator.storage.persist) {
        // browsers grant this silently on engagement signals (installed
        // PWA, bookmarks); declining is fine — the line says so
        persisted = await navigator.storage.persist();
      }
    }
    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    }
    health = { persisted, usageBytes, quotaBytes };
    listeners.forEach((fn) => fn());
  } catch {
    // no storage introspection — nothing to show, nothing to break
  }
}

/** "4 MB", "1.2 GB" — the data voice keeps it short */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}
