import { NextResponse } from "next/server";

/**
 * Gate the lab tooling to non-production. The `/lab/*` pages (icon studio, stamp,
 * wordmark, texture, wax-wash) and their dev-only `/api/lab/*` writers are for
 * BUILDING the app, not for visitors — so they stay reachable on local dev and on
 * preview deploys (unguessable per-branch URLs; add Vercel password protection for
 * more), but 404 on the production domain. Defence in depth: the bake API already
 * refuses to write unless NODE_ENV is development, and a deployed FS is read-only
 * regardless — this also hides the pages from the public site.
 */
export function proxy() {
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/lab", "/lab/:path*", "/api/lab/:path*"],
};
