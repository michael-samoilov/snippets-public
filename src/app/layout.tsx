import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { copy } from "@/lib/copy";
import { Analytics } from "@vercel/analytics/next";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: copy.app.name,
    template: copy.app.titleTemplate,
  },
  description: copy.app.description,
  applicationName: copy.app.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: copy.app.name,
  },
  formatDetection: { telephone: false },
};

// Pin --app-h to the live viewport height BEFORE the first paint. iOS Safari
// mis-resolves the CSS small/dynamic-viewport units (svh/dvh) on a cold load's
// first paint — it can hand back the address-bar-RETRACTED (large) height while
// the bar is actually shown, so the shell (and the full-height today zone it
// contains) renders taller than the screen and the wax seal clips off the
// bottom until a manual refresh. window.innerHeight is a live measurement, not a
// predicted unit, so it reports the real visible height; the shell reads
// var(--app-h). Runs synchronously during HTML parsing, before the shell paints,
// so there's no flash and no resize snap. Skip keyboard-driven shrinks (a
// focused field) so a standalone PWA's keyboard can't collapse the whole shell —
// the keyboard-room hook lifts the focused field instead, and Safari leaves
// innerHeight untouched by the keyboard regardless.
const APP_HEIGHT_SCRIPT = `(function(){var d=document.documentElement;function apply(){var a=document.activeElement;if(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"))return;d.style.setProperty("--app-h",window.innerHeight+"px")}function update(){apply();requestAnimationFrame(apply)}update();addEventListener("resize",update);addEventListener("orientationchange",update);addEventListener("pageshow",update)})()`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // iOS auto-zooms onto focused fields it deems small; a capped scale
  // declines that jump (pinch zoom itself stays available — Safari
  // ignores the cap for the accessibility gesture)
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8dcc2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0c08" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: APP_HEIGHT_SCRIPT }} />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
