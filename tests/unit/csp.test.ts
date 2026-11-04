import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/server/proxy/csp";

const base = { supabaseUrl: "https://abc.supabase.co" };

describe("buildCsp", () => {
  it("uses the nonce with strict-dynamic and no unsafe-eval in production", () => {
    const csp = buildCsp({ ...base, nonce: "n0nce", isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows Supabase REST, Realtime and document frames", () => {
    const csp = buildCsp({ ...base, nonce: "n", isDev: false });
    expect(csp).toContain("https://abc.supabase.co");
    expect(csp).toContain("wss://abc.supabase.co");
    expect(csp).toContain("frame-src https://abc.supabase.co");
  });

  it("allows the map style origin for tiles and glyphs", () => {
    const csp = buildCsp({ ...base, nonce: "n", isDev: false, mapStyleUrl: "https://tiles.openfreemap.org/styles/liberty" });
    expect(csp).toMatch(/connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  });

  it("adds unsafe-eval only in development", () => {
    expect(buildCsp({ ...base, nonce: "n", isDev: true })).toContain("'unsafe-eval'");
  });
});

describe("createNonce", () => {
  it("is unique and base64", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(createNonce());
  });
});
