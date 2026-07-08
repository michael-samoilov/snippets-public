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

// iOS launch screens. A standalone PWA paints its splash from the manifest's
// single `background_color` (light), so a Lamplight user got a light flash before
// the dark app on every cold launch. The only theme-aware lever iOS offers is
// `apple-touch-startup-image` links media-queried on prefers-color-scheme AND the
// exact device metrics — so we ship one baked image per device per theme (the desk
// the app settles into + the icon's seal, `pnpm splash` → public/splash).
// This list MIRRORS APPLE_LAUNCH in scripts/generate-splash.mjs; regenerate both
// together. Unmatched devices fall back to the manifest colour (prior behaviour).
const APPLE_LAUNCH = [
  { w: 320, h: 568, r: 2 },
  { w: 375, h: 667, r: 2 },
  { w: 414, h: 736, r: 3 },
  { w: 375, h: 812, r: 3 },
  { w: 390, h: 844, r: 3 },
  { w: 393, h: 852, r: 3 },
  { w: 402, h: 874, r: 3 },
  { w: 414, h: 896, r: 2 },
  { w: 414, h: 896, r: 3 },
  { w: 428, h: 926, r: 3 },
  { w: 430, h: 932, r: 3 },
  { w: 440, h: 956, r: 3 },
];

const startupImage = APPLE_LAUNCH.flatMap(({ w, h, r }) =>
  (["dark", "light"] as const).map((scheme) => ({
    url: `/splash/${scheme}-${w}x${h}@${r}.png`,
    media: `(prefers-color-scheme: ${scheme}) and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
  })),
);

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
    startupImage,
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
