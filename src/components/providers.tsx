"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { db, purgeOldDeleted } from "@/lib/db";
import { checkStorageHealth } from "@/lib/storage-health";
import { startSync } from "@/lib/sync";
import { useSession } from "@/lib/auth";
import { KeptDraftContext, type KeptDraftStore } from "@/lib/kept-draft";
import { useZoomRelief } from "@/hooks/use-zoom-relief";
import type { Snippet } from "@/lib/types";

/**
 * Re-assert the chosen theme after a back/forward-cache restore.
 *
 * WebKit (iOS Safari) restores a page from its bfcache FROZEN: the <html>
 * class, next-themes' blocking boot script, and the provider's own React state
 * are all restored to the instant the page was cached, and none of them re-run.
 * So picking a theme in Settings and hitting Back leaves the restored book
 * wearing the OLD theme even though localStorage (and Settings) already hold the
 * new one — only a fresh navigation (tapping the wordmark) re-reads it. Observed
 * on real WebKitGTK via scripts/measure-webkit-spans.py's harness; NOT
 * reproducible on Blink, which doesn't bfcache these pages (pageshow.persisted
 * stays false), so keep the WebKit pass for any change here.
 *
 * On pageshow.persisted we read the stored choice and push it back through
 * setTheme — that recomputes the class (system + color-scheme resolution
 * included) and re-renders every useTheme consumer (e.g. the wordmark's seal),
 * so the whole app agrees with the choice again. We also flip the class in the
 * same tick so no frame of the stale theme survives the restore.
 */
function ThemeRestore() {
  const { setTheme } = useTheme();
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("theme");
      } catch {}
      const choice = stored ?? "system"; // matches ThemeProvider's defaultTheme
      const resolved =
        choice === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : choice;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
      setTheme(choice); // resync next-themes' state so consumers re-render too
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [setTheme]);
  return null;
}

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
    // Test book on previews/local only (permanent tooling — see lib/dev-seed):
    // a fresh preview auto-seeds a realistic book so there's always something to
    // test against; `?seed=N` / `?seed=clear` override. Host-gated here so the
    // chunk never loads for real users on the prod domain; dynamically imported
    // so the corpus never rides the normal bundle. Capture the search NOW — the
    // calendar rewrites the URL to `?d=…` a tick later, before this resolves.
    if (
      typeof window !== "undefined" &&
      !["snippets.ink", "www.snippets.ink"].includes(window.location.hostname)
    ) {
      const search = window.location.search;
      void import("@/lib/dev-seed")
        .then((m) => m.maybeSeedDevBook(search))
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
  // days whose live draft should render birthless (a backfill morph). Tracked
  // alongside `drafts` and cleared in lockstep.
  const [morphDays, setMorphDays] = useState<Set<string>>(() => new Set());
  // ids written at submit whose live row must stay invisible until the seal
  // choreography's beat reveals it (see KeptDraftStore.heldIds)
  const [heldIds, setHeldIds] = useState<Set<string>>(() => new Set());
  const draftStore = useMemo<KeptDraftStore>(
    () => ({
      drafts,
      morphDays,
      heldIds,
      hold: (id) =>
        setHeldIds((h) => (h.has(id) ? h : new Set(h).add(id))),
      release: (id) =>
        setHeldIds((h) => {
          if (!h.has(id)) return h;
          const n = new Set(h);
          n.delete(id);
          return n;
        }),
      set: (s, morph) => {
        setDrafts((d) => ({ ...d, [s.day]: s }));
        setMorphDays((m) => {
          const has = m.has(s.day);
          if (morph === has) return m; // no change
          const n = new Set(m);
          if (morph) n.add(s.day);
          else n.delete(s.day);
          return n;
        });
      },
      clear: (day) => {
        setDrafts((d) => {
          const n = { ...d };
          delete n[day];
          return n;
        });
        // drop the morph flag in lockstep (both setStates batch in one commit)
        setMorphDays((m) => {
          if (!m.has(day)) return m;
          const n = new Set(m);
          n.delete(day);
          return n;
        });
      },
    }),
    [drafts, morphDays, heldIds],
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
          <ThemeRestore />
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
