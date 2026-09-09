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

  // Verifies the session and keeps its cookie current. Supabase refresh
  // tokens are single-use: Next.js prefetches every <Link> in the viewport,
  // so a burst of simultaneous requests each racing the same refresh can
  // rotate the token out from under one another. The real navigation still
  // runs this — the matcher below is what stops background prefetches from
  // entering that race in the first place.
  //
  // getClaims(), not getUser(): the project signs its tokens with an
  // asymmetric key (ECC P-256), so the signature is checked here with the
  // project's public key — fetched once per instance and cached for ten
  // minutes by the client — instead of a round trip to Supabase Auth on
  // every single navigation, which was the first thing every tab click
  // paid before a byte of the page could be sent. A token near expiry
  // still triggers exactly one refresh, the same as getUser() did. What is
  // given up: a user disabled or deleted at the Supabase level keeps a
  // valid token until it expires (an hour at most); an account disabled in
  // THIS app is still caught on every request, because the shell layout
  // reads users.status from the database and bounces anything not active.
  const userId = await verifiedUserId(supabase);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!userId && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const { name, value, options } of cookiesToApply) redirectResponse.cookies.set(name, value, options);
    return redirectResponse;
  }

  if (userId && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    homeUrl.search = "";
    const redirectResponse = NextResponse.redirect(homeUrl);
    for (const { name, value, options } of cookiesToApply) redirectResponse.cookies.set(name, value, options);
    return redirectResponse;
  }

  // Hands the already-verified identity forward via a request header rather
  // than letting the page's own getCurrentUser() verify a second time (see
  // src/lib/auth/session.ts for the refresh race that caused). Set with
  // .set(), not .append(): this always overwrites whatever value a client
  // request happened to send for this header, so nothing arriving from
  // outside can impersonate another user's id.
  if (userId) request.headers.set("x-user-id", userId);

  const response = NextResponse.next({ request });
  for (const { name, value, options } of cookiesToApply) response.cookies.set(name, value, options);
  return response;
}

/**
 * The signed-in user's id, or null.
 *
 * Local verification first. If that fails for any reason other than the
 * token itself being bad — the signing-key fetch failing on a cold
 * instance, say — falls back to the network verification this used to do
 * unconditionally, so a transient hiccup degrades to "slower", never to
 * "everyone is signed out".
 */
async function verifiedUserId(supabase: ReturnType<typeof createServerClient>): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims.sub) return data.claims.sub;
  if (!error || error.name === "AuthInvalidJwtError" || error.name === "AuthSessionMissingError") {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
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
