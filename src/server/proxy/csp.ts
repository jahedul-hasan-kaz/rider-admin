// Pure helpers used by src/proxy.ts. No `server-only` import so they stay unit-testable.

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

type CspOptions = {
  nonce: string;
  isDev: boolean;
  supabaseUrl: string;
  mapStyleUrl?: string;
};

/** Nonce-based CSP (docs/spec/07-security.md §5). */
export function buildCsp({ nonce, isDev, supabaseUrl, mapStyleUrl }: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const connect = [
    "'self'",
    supabase.origin,
    `wss://${supabase.host}`,
    "https://*.ingest.sentry.io",
    ...(mapStyleUrl ? [new URL(mapStyleUrl).origin] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // Sonner, next-themes and Radix inject <style> tags and style attributes at
    // runtime without a nonce. Inline styles can't execute code, so they're
    // allowed; scripts stay nonce-only.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", supabase.origin],
    "font-src": ["'self'"],
    "connect-src": isDev ? [...connect, "ws:"] : connect,
    "worker-src": ["'self'", "blob:"],
    // PDF documents are shown from short-lived signed Storage URLs.
    "frame-src": [supabase.origin],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
