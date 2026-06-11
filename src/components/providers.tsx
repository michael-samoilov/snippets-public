"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { purgeOldDeleted } from "@/lib/db";
import { retryPendingEnrichment } from "@/lib/enrich";

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

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster
        position="bottom-center"
        offset={{ bottom: 24 }}
        mobileOffset={{ bottom: 92 }}
        toastOptions={{
          style: {
            background: "var(--paper-raised)",
            border: "1px solid var(--rule)",
            borderRadius: "4px",
            color: "var(--ink)",
            fontFamily: "var(--font-fraunces), Georgia, serif",
            fontSize: "0.95rem",
            boxShadow:
              "0 1px 1px rgb(58 46 28 / 0.05), 0 4px 10px rgb(58 46 28 / 0.07), 0 12px 28px rgb(58 46 28 / 0.07)",
          },
        }}
      />
    </ThemeProvider>
  );
}
