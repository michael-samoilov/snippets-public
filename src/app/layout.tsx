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

// Pin --app-h (the shell's height, see AppShell) to the MEASURED viewport before
// the first paint. On a cold navigation iOS lays out the first frames against a
// stale, too-tall viewport — the chrome already looks settled, but fixed/inset
// geometry and every CSS viewport unit resolve past the toolbar, so the today
// zone painted too tall (seal under the toolbar) and only snapped right a beat
// later. visualViewport.height (fallback innerHeight) reads CORRECTLY from the
// very first script tick even while the CSS viewport is stale — verified on the
// reporter's device — so writing it as a pixel value pre-paint makes the first
// painted frame the right size. Event-driven only (no polling): re-applies on
// resize/orientation/pageshow and visualViewport resize (the URL-bar keyboard
// leaving, the chrome settling). Skips while a page field is focused so the
// in-app keyboard can't collapse the shell (useKeyboardRoom lifts the field
// instead), and skips mid-pinch so zooming never reflows the desk.
const APP_HEIGHT_SCRIPT = `(function(){var d=document.documentElement,vv=window.visualViewport,last=-1;function apply(){var a=document.activeElement;if(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"))return;if(vv&&vv.scale>1.01)return;var h=Math.round((vv&&vv.height)||window.innerHeight);if(!h||Math.abs(h-last)<1)return;last=h;d.style.setProperty("--app-h",h+"px")}apply();addEventListener("resize",apply);addEventListener("orientationchange",apply);addEventListener("pageshow",apply);if(vv)vv.addEventListener("resize",apply)})()`;

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
