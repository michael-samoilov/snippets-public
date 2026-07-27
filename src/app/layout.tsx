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
  // Canonical origin for absolute URLs in metadata (og:image etc). The custom
  // domain is the canonical one; NEXT_PUBLIC_SITE_URL overrides for previews.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.snippets.ink",
  ),
  title: {
    default: copy.app.name,
    template: copy.app.titleTemplate,
  },
  description: copy.app.description,
  applicationName: copy.app.name,
  // og:image itself comes from the file convention (src/app/opengraph-image.png
  // + opengraph-image.alt.txt, baked by `pnpm og` — scripts/bake-og.mjs) so the
  // tags can't drift from the file.
  openGraph: {
    title: copy.app.name,
    description: copy.app.description,
    siteName: copy.app.name,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
  },
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
// resize/orientation/pageshow, visualViewport resize and visualViewport scroll
// (the URL-bar keyboard leaving, the chrome settling, a pan). Freezes while the
// in-app keyboard is really up so it can't collapse the shell (useKeyboardRoom
// lifts the field instead — see the freeze test below), and skips mid-pinch so
// zooming never reflows the desk.
// …and pin --app-top the same way. The shell used to sit at top:0, i.e. glued
// to the LAYOUT viewport's top — which assumes the layout viewport and the
// visible window start at the same place. Chrome iOS (26 / Liquid Glass, two
// toolbars) breaks that assumption on a fresh tab: it parks the layout viewport
// PANNED against the visible window, so the app's head is scrolled off above
// and a strip of bare canvas shows below its foot (measured on the reporter's
// device: lamplight ran to y=1986 of a 2556px frame while the web area ran to
// 2292 — a 102pt strip of un-lit desk). Nothing was scrolled; the document
// can't scroll (html/body are 100% and the shell is fixed). So anchor the shell
// to the VISUAL viewport instead: vv.pageTop minus the document scroll is its
// offset in layout coordinates — the same read useKeyboardRoom, useContainedField
// and the today zone's kbGeom already make. Clamped at 0 (never shift the app
// down) and deadbanded at 2px so ordinary scroll noise can't jitter the desk.
// Zero on every engine that doesn't pan, so this is inert off iOS.
// The freeze tests for a REAL in-app keyboard — a page field focused AND the
// window actually shrunk past 60px of its running max — not merely for a focused
// field. A focused field alone is not a keyboard: /signin autofocuses its email
// input, so the old `activeElement is INPUT` test was true from the first tick
// and every later re-pin on that page was a silent no-op (harness-confirmed —
// the pan correction below never applied there). The running max is the same
// read useKeyboardRoom's baseVh makes, and 60px the same threshold; it resets on
// orientationchange so landscape isn't mistaken for a keyboard.
const APP_HEIGHT_SCRIPT = `(function(){var d=document.documentElement,vv=window.visualViewport,lh=-1,lt=-1,base=0;function apply(){if(vv&&vv.scale>1.01)return;var h=Math.round((vv&&vv.height)||window.innerHeight);if(!h)return;if(h>base)base=h;var a=document.activeElement;if(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA")&&h<base-60)return;if(Math.abs(h-lh)>=1){lh=h;d.style.setProperty("--app-h",h+"px")}var s=(document.scrollingElement&&document.scrollingElement.scrollTop)||0;var t=vv?Math.max(0,Math.round(vv.pageTop-s)):0;if(Math.abs(t-lt)>=2){lt=t;d.style.setProperty("--app-top",t+"px")}}function reset(){base=0;apply()}apply();addEventListener("resize",apply);addEventListener("orientationchange",reset);addEventListener("pageshow",reset);addEventListener("scroll",apply,{passive:true});if(vv){vv.addEventListener("resize",apply);vv.addEventListener("scroll",apply)}})()`;

// Before the first paint, flag an empty book so the calendar's static skeleton
// can open onto the welcome intro instead of the today zone (it carries both;
// CSS keyed on this attribute picks one — see globals.css .skeleton-empty-only).
// Without it the returning empty-book user gets a today-shell flash before the
// in-feed swap. Reads the same key db.ts's write stamps (BOOK_EMPTY_KEY), and
// only for a plain today landing (no entry/year/past-day deep-link).
const FIRST_RUN_SCRIPT = `(function(){try{if(location.pathname!=="/calendar")return;if(localStorage.getItem("snippets:book-empty")!=="1")return;var p=new URLSearchParams(location.search);if(p.has("e")||p.has("y"))return;var t=new Date(),k=t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0"),d=p.get("d");if(d&&d!==k)return;document.documentElement.setAttribute("data-first-run","")}catch(e){}})()`;

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
        <script dangerouslySetInnerHTML={{ __html: FIRST_RUN_SCRIPT }} />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
