"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { db, purgeOldDeleted } from "@/lib/db";
import { checkStorageHealth } from "@/lib/storage-health";
import { startSync } from "@/lib/sync";
import { useSession } from "@/lib/auth";
import { KeptDraftContext, type KeptDraftStore } from "@/lib/kept-draft";
import { useZoomRelief } from "@/hooks/use-zoom-relief";
import type { Snippet } from "@/lib/types";

/** Sync follows the session: signed in → the engine runs; out → it rests. */
function SyncManager() {
  const { user, status } = useSession();
  const userId = status === "signed-in" ? user?.id : undefined;
  useEffect(() => {
    if (!userId) return;
    return startSync(userId);
  }, [userId]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // shed the heavy GPU layers the instant a pinch begins (the zoom-crash fix)
  useZoomRelief();

  useEffect(() => {
    // dev-only book seeder (preview branch): with ?seed=… on the URL, populate
    // IndexedDB so the crash/scroll work can be felt on a big book without a
    // real sign-in. Dynamic import so the corpus never rides the normal bundle;
    // the module strips the param and no-ops on a normal load. Capture the
    // search NOW — the calendar's own load effect rewrites the URL to ?d=… a
    // tick later, before this dynamic import resolves.
    if (
      typeof window !== "undefined" &&
      window.location.search.includes("seed=")
    ) {
      const search = window.location.search;
      void import("@/lib/dev-seed")
        .then((m) => m.runDevSeedFromUrl(search))
        .catch(() => {});
    }

    purgeOldDeleted().catch(() => {});
    // ask the browser to hold this origin's data once the book holds
    // anything; the answer (and the room left) shows in Settings
    db.snippets
      .count()
      .then((count) => checkStorageHealth(count > 0))
      .catch(() => {});

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // optimistic kept cards: the composer publishes the just-kept snippet here so
  // its card renders in its final slot the instant the seal lands, never
  // blinking out while the Dexie live query catches up
  const [drafts, setDrafts] = useState<Record<string, Snippet>>({});
  const draftStore = useMemo<KeptDraftStore>(
    () => ({
      drafts,
      set: (s) => setDrafts((d) => ({ ...d, [s.day]: s })),
      clear: (day) => setDrafts((d) => { const n = { ...d }; delete n[day]; return n; }),
    }),
    [drafts],
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <KeptDraftContext.Provider value={draftStore}>
          <SyncManager />
          {children}
        </KeptDraftContext.Provider>
      </MotionConfig>
      <Toaster
        position="bottom-center"
        offset={{ bottom: 24 }}
        mobileOffset={{ bottom: 24 }}
        toastOptions={{
          style: {
            background: "var(--paper-raised)",
            borderRadius: "8px",
            border: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-fraunces), Georgia, serif",
            fontSize: "0.95rem",
            boxShadow: "var(--float-shadow)",
          },
        }}
      />
    </ThemeProvider>
  );
}
