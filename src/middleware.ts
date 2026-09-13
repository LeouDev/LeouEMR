import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { graceUntilSetting, mfaDecision, mfaExempt, todayUtc } from "@/lib/auth/mfa";
import { accessTokenFromCookies, decodeJwtPayload, isPrefetchRequest } from "@/lib/auth/session-cookie";

const PUBLIC_ROUTES = ["/login", "/auth"];

/** Set below from this function's own verification, and never by a client. */
const IDENTITY_HEADERS = ["x-user-id", "x-session-aal", "x-request-kind"] as const;

export async function middleware(request: NextRequest) {
  // Whatever a client sent under these names is gone before anything else
  // happens: the pages and actions trust them (see src/lib/auth/session.ts),
  // which is safe only because this runs on every request and always
  // decides their values itself. The matcher must never exclude a request
  // by something a client controls — it once skipped prefetches by header,
  // and a request carrying that header could then name any account.
  for (const name of IDENTITY_HEADERS) request.headers.delete(name);

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
  // rotate the token out from under one another. A prefetch is therefore
  // verified on the token as it stands — signature and expiry, never a
  // refresh — and only the real navigation refreshes. (The matcher used to
  // skip prefetches instead, which left the identity headers unguarded.)
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
  const prefetch = isPrefetchRequest(request.headers);
  const session = prefetch
    ? await prefetchSession(supabase, accessTokenFromCookies(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL))
    : await verifiedSession(supabase, request);
  const userId = session?.userId ?? null;

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

  // A role that needs the second step, on a session that has not taken it,
  // goes to the page that takes it — everywhere except the handful of pages
  // that get them there. The role comes from the token's app metadata,
  // which the Users page keeps in step with the users table; the shell
  // layout and getCurrentUser apply the same rule from the table itself,
  // so a token minted before the role was recorded there is still caught.
  if (
    session?.role &&
    session.aal !== null &&
    !mfaExempt(pathname) &&
    mfaDecision({ role: session.role, aal: session.aal, today: todayUtc(), graceUntil: graceUntilSetting() }) ===
      "enrol"
  ) {
    const mfaUrl = request.nextUrl.clone();
    mfaUrl.pathname = "/mfa";
    mfaUrl.search = "";
    const redirectResponse = NextResponse.redirect(mfaUrl);
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
  // The session's assurance level travels the same way, and so does whether
  // this request is a server action rather than a page: a session that owes
  // its second step may render the pages that get it there, but not act.
  // "unknown" is the rare verified-but-unreadable case (see verifiedSession);
  // the readers treat it as this function does, by not enforcing the step.
  request.headers.set("x-session-aal", session?.aal ?? "unknown");
  request.headers.set("x-request-kind", request.headers.has("next-action") ? "action" : "page");

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
interface VerifiedSession {
  userId: string;
  /** "aal1" or "aal2" from the token; null when only the slower path could verify it. */
  aal: string | null;
  /** The role recorded in the token's app metadata, when the Users page has put it there. */
  role: string | null;
}

type Claims = { sub?: string; aal?: string; app_metadata?: Record<string, unknown> };

function sessionFromClaims(claims: Claims): VerifiedSession | null {
  if (!claims.sub) return null;
  const role = claims.app_metadata?.role;
  return { userId: claims.sub, aal: claims.aal ?? "aal1", role: typeof role === "string" ? role : null };
}

async function verifiedSession(
  supabase: ReturnType<typeof createServerClient>,
  request: NextRequest,
): Promise<VerifiedSession | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims.sub) return sessionFromClaims(data.claims as Claims);
  if (!error || error.name === "AuthInvalidJwtError" || error.name === "AuthSessionMissingError") {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Verified over the network, so the token's own claims can be read for
  // the assurance level the slower path does not report.
  const token = accessTokenFromCookies(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL);
  const aal = token ? decodeJwtPayload(token)?.aal : undefined;
  const role = user.app_metadata?.role;
  return { userId: user.id, aal: aal === "aal1" || aal === "aal2" ? aal : null, role: typeof role === "string" ? role : null };
}

/**
 * A prefetch's session: the cookie's token verified as it stands, with no
 * refresh and no network fallback. An expired token means the prefetch
 * renders as signed out; the click that follows is a real navigation,
 * which refreshes and renders the page.
 */
async function prefetchSession(
  supabase: ReturnType<typeof createServerClient>,
  token: string | null,
): Promise<VerifiedSession | null> {
  if (!token) return null;
  const { data } = await supabase.auth.getClaims(token);
  return data?.claims ? sessionFromClaims(data.claims as Claims) : null;
}

export const config = {
  matcher: [
    // Every request but static assets. No `has`/`missing` conditions, ever:
    // a request that skipped this function would reach the pages with the
    // identity headers exactly as the client sent them (src/middleware.test.ts).
    { source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)" },
  ],
};
