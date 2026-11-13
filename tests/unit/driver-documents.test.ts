import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: vi.fn() }));

const { matchesContentType } = await import("@/server/services/driver-documents");

describe("matchesContentType", () => {
  it("accepts real signatures", () => {
    expect(matchesContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg")).toBe(true);
    expect(matchesContentType(Buffer.from("89504e470d0a1a0a0000", "hex"), "image/png")).toBe(true);
    expect(matchesContentType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
    expect(matchesContentType(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBe(true);
  });

  it("rejects a renamed file", () => {
    expect(matchesContentType(Buffer.from("%PDF-1.7\n"), "image/jpeg")).toBe(false);
    expect(matchesContentType(Buffer.from("<script>alert(1)</script>"), "image/png")).toBe(false);
  });

  it("rejects unknown types", () => {
    expect(matchesContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/gif")).toBe(false);
  });
});
