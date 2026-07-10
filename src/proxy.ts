import { NextResponse, type NextRequest } from "next/server";

/**
 * Keep dev-only surfaces off the production domain. On preview deploys and local
 * dev everything works as normal; only the PRODUCTION domain is locked down.
 *
 *  - `/lab/*` + `/api/lab/*` — the build-time tooling (icon studio, stamp,
 *    skeleton gallery, the dev bake writer) 404s. (Defence in depth: the bake API
 *    also refuses to write unless NODE_ENV is development, and a deployed FS is
 *    read-only.)
 *  - the calendar's debug params — dev states held on screen for inspection
 *    (`?skeldebug` parks a page-load skeleton, `?lockdebug` forces the locked
 *    letter); not something a visitor should land in, so they're stripped
 *    (redirect to the clean URL) in production.
 */
const CALENDAR_DEBUG_PARAMS = ["skeldebug", "lockdebug"];

export function proxy(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;

  if (pathname === "/lab" || pathname.startsWith("/lab/") || pathname.startsWith("/api/lab/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const held = CALENDAR_DEBUG_PARAMS.filter((p) => searchParams.has(p));
  if (held.length > 0) {
    const url = req.nextUrl.clone();
    for (const p of held) url.searchParams.delete(p);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/lab", "/lab/:path*", "/api/lab/:path*", "/calendar"],
};
