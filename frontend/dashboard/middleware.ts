import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic route gate. The api is the REAL authority (every /v1/* route
 * verifies the session server-side); this middleware only checks for the
 * presence of the session cookie to redirect unauthenticated visitors to
 * /sign-in and keep signed-in users off the auth pages. The session cookie is
 * host-only for `localhost`, so the browser sends it to the dashboard (:3000)
 * even though the api (:4000) set it.
 */
const AUTH_PAGES = new Set(["/sign-in", "/sign-up"]);
// The marketing page is the one route a signed-out visitor should actually
// reach — everything else (the real dashboard at /agents, /status) stays
// behind the gate.
const PUBLIC_ROUTES = new Set(["/"]);

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;
  const isAuthPage = AUTH_PAGES.has(pathname);
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  if (!sessionCookie && !isAuthPage && !isPublicRoute) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (sessionCookie && isAuthPage) {
    return NextResponse.redirect(new URL("/agents", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static files. The dashboard has
  // no local API routes (auth lives on the api server), so nothing else is
  // excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
