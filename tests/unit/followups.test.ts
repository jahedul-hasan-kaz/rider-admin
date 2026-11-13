import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: vi.fn() }));

const { addDays, dhakaToday, resolveRange } = await import("@/lib/date-range");
const { evidenceMatchesType } = await import("@/server/services/safety-evidence");

describe("date ranges", () => {
  const now = new Date("2026-11-05T20:30:00Z"); // 02:30 on the 6th in Dhaka
  it("uses the Dhaka calendar day, not UTC", () => {
    expect(dhakaToday(now)).toBe("2026-11-06");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-11-06", -6)).toBe("2026-10-31");
  });
  it("resolves the presets", () => {
    expect(resolveRange({ range: "today" }, now)).toEqual({ preset: "today", from: "2026-11-06", to: "2026-11-06" });
    expect(resolveRange({}, now)).toEqual({ preset: "7d", from: "2026-10-31", to: "2026-11-06" });
    expect(resolveRange({ range: "30d" }, now).from).toBe("2026-10-08");
  });
  it("accepts a valid custom range", () => {
    expect(resolveRange({ range: "custom", from: "2026-10-01", to: "2026-10-15" }, now)).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-10-15" });
  });
  it.each([
    [{ range: "custom", from: "2026-10-15", to: "2026-10-01" }],
    [{ range: "custom", from: "2024-01-01", to: "2026-10-01" }],
    [{ range: "custom", from: "not-a-date", to: "2026-10-01" }],
    [{ range: "custom", from: "2026-10-01" }],
    [{ range: "yearly" }],
  ])("falls back to the last 7 days for %j", (params) => {
    expect(resolveRange(params, now)).toEqual({ preset: "7d", from: "2026-10-31", to: "2026-11-06" });
  });
});

describe("evidence content checks", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(8)]);
  it("accepts files whose bytes match their declared type", () => {
    expect(evidenceMatchesType(png, "image/png")).toBe(true);
    expect(evidenceMatchesType(mp4, "video/mp4")).toBe(true);
    expect(evidenceMatchesType(mp4, "audio/mp4")).toBe(true);
    expect(evidenceMatchesType(Buffer.from("%PDF-1.7 ..."), "application/pdf")).toBe(true);
  });
  it("rejects a mismatch or an unknown type", () => {
    expect(evidenceMatchesType(png, "video/mp4")).toBe(false);
    expect(evidenceMatchesType(mp4, "image/png")).toBe(false);
    expect(evidenceMatchesType(Buffer.from("<script>alert(1)</script>"), "image/png")).toBe(false);
    expect(evidenceMatchesType(png, "text/html")).toBe(false);
  });
});
