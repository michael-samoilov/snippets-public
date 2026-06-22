"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { purgeOldDeleted } from "@/lib/db";
import { retryPendingEnrichment } from "@/lib/enrich";
import { KeptDraftContext, type KeptDraftStore } from "@/lib/kept-draft";
import type { Snippet } from "@/lib/types";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    purgeOldDeleted().catch(() => {});
    retryPendingEnrichment();
    const onOnline = () => retryPendingEnrichment();
    window.addEventListener("online", onOnline);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => window.removeEventListener("online", onOnline);
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
