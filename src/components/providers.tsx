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
      <Toaster position="bottom-center" />
    </ThemeProvider>
  );
}
