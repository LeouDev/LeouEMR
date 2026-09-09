import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  // Collected as Supabase's cookie callback fires, applied once to whichever
  // response actually gets returned below — a redirect needs the same
  // refreshed session cookie as the normal continuation does.
  const cookiesToApply: Array<{ name: string; value: string; options?: CookieOptions }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          cookiesToApply.push(...cookiesToSet);
        },
      },
    },
  );

  // Refreshes the auth token and keeps the session cookie current. Supabase
  // refresh tokens are single-use: Next.js prefetches every <Link> in the
  // viewport, so a burst of simultaneous requests each racing this same
  // getUser() call can rotate the token out from under one another. The
  // real navigation still runs this — the matcher below is what stops
  // background prefetches from entering this race in the first place.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const { name, value, options } of cookiesToApply) redirectResponse.cookies.set(name, value, options);
    return redirectResponse;
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    homeUrl.search = "";
    const redirectResponse = NextResponse.redirect(homeUrl);
    for (const { name, value, options } of cookiesToApply) redirectResponse.cookies.set(name, value, options);
    return redirectResponse;
  }

  // Hands the already-verified identity forward via a request header rather
  // than letting the page's own getCurrentUser() call supabase.auth.getUser()
  // a second time. getUser() re-verifies over the network and, if the access
  // token is near expiry, can trigger its own token refresh — a second
  // independent call racing this one over the same single-use refresh token,
  // confirmed live via Supabase's auth logs showing up to 6 concurrent
  // /token refresh requests within about a second, all but one failing with
  // "Refresh Token Not Found" and bouncing a genuinely signed-in user back to
  // /login. Set with .set(), not .append(): this always overwrites whatever
  // value a client request happened to send for this header, so nothing
  // arriving from outside can impersonate another user's id.
  if (user) request.headers.set("x-user-id", user.id);

  const response = NextResponse.next({ request });
  for (const { name, value, options } of cookiesToApply) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      // Next.js's own documented pattern for excluding prefetch-only
      // requests: a real navigation never carries either header, so this
      // only skips the background loads a visible <Link> triggers on its
      // own, never an actual click or full page load.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
