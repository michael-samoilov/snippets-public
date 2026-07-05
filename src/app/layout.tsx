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

// Pin --app-h to the live viewport height, measured — not the CSS svh/dvh units,
// which WebKit mis-resolves on a cold load's first paint (it hands back the
// address-bar-RETRACTED, too-tall height while the bar is actually shown, so the
// full-height today zone renders taller than the screen and the wax seal clips
// off the bottom until a manual refresh).
//
// The subtlety that cost three tries: WebKit reports that same stale, too-tall
// viewport for the FIRST FRAMES OF JS TOO, and only reconciles it a beat later —
// AND only while something keeps reading the live viewport. A single early read
// (parse + one rAF) lands entirely inside the stale window, and nothing re-pins
// after, so --app-h stays wrong. A diagnostic overlay that read innerHeight every
// frame made the bug vanish — because the continuous reads are what force the
// reconcile. So this reproduces that on purpose: read the live viewport
// (visualViewport.height, the true visible area, falling back to innerHeight)
// every frame for ~2s, re-pinning each time. Once it settles the value stops
// changing and the re-pin is a no-op. We also listen to visualViewport's own
// resize/scroll — on iOS the settle often dispatches there and NOT on
// window.resize, which is the other reason a single window-resize listener missed
// it. Skip re-pinning while a field is focused so a standalone PWA's keyboard
// (which shrinks the viewport) can't collapse the shell — the keyboard-room hook
// lifts the focused field instead.
const APP_HEIGHT_SCRIPT = `(function(){var d=document.documentElement,vv=window.visualViewport;function m(){return Math.round((vv&&vv.height)||window.innerHeight)}function apply(){var a=document.activeElement;if(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"))return;d.style.setProperty("--app-h",m()+"px")}apply();var t0=null;function loop(ts){if(t0===null)t0=ts;void window.innerHeight;if(vv)void vv.height;apply();if(ts-t0<2000)requestAnimationFrame(loop)}requestAnimationFrame(loop);addEventListener("resize",apply);addEventListener("orientationchange",apply);addEventListener("pageshow",apply);if(vv){vv.addEventListener("resize",apply);vv.addEventListener("scroll",apply)}})()`;

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
