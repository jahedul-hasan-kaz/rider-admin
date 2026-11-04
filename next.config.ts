import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Static security headers. The Content-Security-Policy is per-request (nonce)
// and is set in src/proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const appHost = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).host : undefined;

const nextConfig: NextConfig = {
  // Cache Components / Partial Prerendering are intentionally off: every admin
  // page is authenticated and rendered per request, and the nonce-based CSP
  // (docs/spec/07-security.md §5) is incompatible with a prerendered static shell.
  poweredByHeader: false,
  typedRoutes: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    // Enables forbidden() and forbidden.tsx for permission-denied pages.
    authInterrupts: true,
    // The proxy buffers request bodies up to this size and silently truncates larger ones. Document uploads are up to
    // 10 MB plus multipart overhead, so the default (10 MB) would corrupt the largest files.
    proxyClientMaxBodySize: "12mb",
    serverActions: {
      allowedOrigins: appHost ? [appHost] : [],
      bodySizeLimit: "1mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
