import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env.public";
import { buildCsp, createNonce } from "@/server/proxy/csp";
import {
  ADMIN_IDLE_TIMEOUT_MS,
  IDLE_COOKIE,
  classifyPath,
  isIdleExpired,
  safeNextPath,
} from "@/server/proxy/routes";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/http/request-id";

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * Optimistic gate only (docs/spec/02-roles-permissions.md §4). The database and
 * getAdminContext() remain the authoritative checks.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const kind = classifyPath(pathname);

  if (kind === "api") {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  // Refresh the Supabase session cookie and read verified JWT claims.
  const pendingCookies: PendingCookie[] = [];
  const cacheHeaders: Record<string, string> = {};
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const c of cookiesToSet) {
            request.cookies.set(c.name, c.value);
            pendingCookies.push(c);
          }
          Object.assign(cacheHeaders, headers);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const isAdmin = claims?.app_role === "admin";
  const now = Date.now();

  const finalize = (response: NextResponse) => {
    for (const c of pendingCookies) response.cookies.set(c.name, c.value, c.options);
    for (const [k, v] of Object.entries(cacheHeaders)) response.headers.set(k, v);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  const redirectTo = (path: string, params: Record<string, string> = {}) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = new URLSearchParams(params).toString();
    return finalize(NextResponse.redirect(url));
  };

  if (kind === "admin" || kind === "mfa") {
    if (!claims) return redirectTo("/login", { next: safeNextPath(pathname + search) });
    if (!isAdmin) {
      await supabase.auth.signOut({ scope: "local" });
      return redirectTo("/login", { error: "forbidden" });
    }
    if (isIdleExpired(request.cookies.get(IDLE_COOKIE)?.value, now)) {
      await supabase.auth.signOut({ scope: "local" });
      const response = redirectTo("/login", { reason: "idle" });
      response.cookies.delete(IDLE_COOKIE);
      return response;
    }
    // People who turned two-factor on go to the code page; the rule itself is decided by the database (getAdminContext).
    if (kind === "admin" && claims.aal !== "aal2" && claims.mfa_enrolled === true) {
      return redirectTo("/mfa", { next: safeNextPath(pathname + search) });
    }
    if (kind === "mfa" && claims.aal === "aal2") {
      return redirectTo(safeNextPath(request.nextUrl.searchParams.get("next")));
    }
  }

  if (kind === "public-auth" && isAdmin && (claims?.aal === "aal2" || claims?.mfa_enrolled === false) && pathname === "/login") {
    return redirectTo("/dashboard");
  }

  // Per-request nonce CSP; Next.js applies the nonce to its own scripts.
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    mapStyleUrl: publicEnv.NEXT_PUBLIC_MAP_STYLE_URL,
  });

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = finalize(NextResponse.next({ request: { headers } }));
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  if (claims) {
    response.cookies.set(IDLE_COOKIE, String(now), {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      path: "/",
      maxAge: Math.ceil(ADMIN_IDLE_TIMEOUT_MS / 1000),
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|vendor/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
