import { NextResponse, type NextRequest } from "next/server";

/**
 * Keep dev-only surfaces off the production domain. On preview deploys and local
 * dev everything works as normal; only the PRODUCTION domain is locked down.
 *
 *  - `/lab/*` + `/api/lab/*` — the build-time tooling (icon studio, stamp,
 *    skeleton gallery, the dev bake writer) 404s. (Defence in depth: the bake API
 *    also refuses to write unless NODE_ENV is development, and a deployed FS is
 *    read-only.)
 *  - `?skeldebug` on the calendar — the page-load skeletons are held on screen for
 *    inspection; that's a dev state, not something a visitor should land in, so the
 *    param is stripped (redirect to the clean URL) in production.
 */
export function proxy(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;

  if (pathname === "/lab" || pathname.startsWith("/lab/") || pathname.startsWith("/api/lab/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (searchParams.has("skeldebug")) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("skeldebug");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/lab", "/lab/:path*", "/api/lab/:path*", "/calendar"],
};
