// Pure route classification used by src/proxy.ts.

export type RouteKind =
  | "api" // bearer-token REST API, webhooks, health — no cookie session handling
  | "public" // pages anyone may open without signing in (trip share links)
  | "public-auth" // login, password reset, auth callbacks
  | "mfa" // signed-in admin that still needs AAL2
  | "admin"; // everything else: admin + AAL2 required

const PUBLIC_AUTH_SEGMENTS = ["/login", "/forgot-password", "/reset-password", "/auth"];

const under = (pathname: string, segment: string) =>
  pathname === segment || pathname.startsWith(`${segment}/`);

export function classifyPath(pathname: string): RouteKind {
  if (under(pathname, "/api")) return "api";
  if (under(pathname, "/share")) return "public";
  if (under(pathname, "/mfa")) return "mfa";
  if (PUBLIC_AUTH_SEGMENTS.some((s) => under(pathname, s))) return "public-auth";
  return "admin";
}

/**
 * Returns `next` only when it is a same-origin relative path, else the fallback.
 * Prevents open redirects (docs/spec/07-security.md §5).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const url = new URL(next, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

export const IDLE_COOKIE = "ra_last_active";
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function isIdleExpired(lastActive: string | undefined, now: number, timeoutMs = ADMIN_IDLE_TIMEOUT_MS) {
  if (!lastActive) return false;
  const ts = Number(lastActive);
  return Number.isFinite(ts) && now - ts > timeoutMs;
}

/**
 * CORS for the passenger app's web preview during local development only (rider-passenger runs `expo start --web` on
 * localhost). Mobile apps don't need CORS, and staging/production never answer cross-origin requests.
 */
export function localDevCorsOrigin(origin: string | null, appEnv: string): string | null {
  if (appEnv !== "local" || !origin) return null;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin) ? origin : null;
}

export const LOCAL_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Request-Id, Accept-Language",
  "Access-Control-Expose-Headers": "X-Request-Id, Retry-After, Idempotent-Replayed",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
} as const;
