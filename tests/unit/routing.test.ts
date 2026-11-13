import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { estimateRoute, getRoute, googleProvider, haversineM, parseGoogleDuration } = await import("@/server/services/routing");

const GULSHAN = { lat: 23.7925, lng: 90.4078 };
const DHANMONDI = { lat: 23.7461, lng: 90.376 };

describe("haversineM", () => {
  it("is zero for the same point and symmetric", () => {
    expect(haversineM(GULSHAN, GULSHAN)).toBe(0);
    expect(haversineM(GULSHAN, DHANMONDI)).toBeCloseTo(haversineM(DHANMONDI, GULSHAN), 6);
  });

  it("measures Gulshan to Dhanmondi at roughly 6 km", () => {
    const d = haversineM(GULSHAN, DHANMONDI);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(6500);
  });
});

describe("estimateRoute", () => {
  it("applies the road factor and an average speed", () => {
    const straight = haversineM(GULSHAN, DHANMONDI);
    const r = estimateRoute(GULSHAN, DHANMONDI, 1.5, 30);
    expect(r.distanceM).toBe(Math.round(straight * 1.5));
    expect(r.durationS).toBe(Math.round(r.distanceM / (30_000 / 3600)));
    expect(r.source).toBe("haversine");
  });

  it("never returns less than 30 seconds", () => {
    expect(estimateRoute(GULSHAN, { lat: 23.79251, lng: 90.40781 }).durationS).toBe(30);
  });
});

describe("parseGoogleDuration", () => {
  it.each([["1234s", 1234], ["12.6s", 13]])("%s -> %s", (input, expected) => expect(parseGoogleDuration(input)).toBe(expected));
  it.each([[undefined], ["12m"], [12], [null]])("rejects %s", (input) => expect(parseGoogleDuration(input)).toBeNull());
});

describe("getRoute", () => {
  const config = { provider: "google", apiKey: "k", timeoutMs: 500 };

  it("uses the estimate when no provider is configured", async () => {
    const r = await getRoute(GULSHAN, DHANMONDI, { provider: "haversine" });
    expect(r.source).toBe("haversine");
  });

  it("uses the provider result when it answers", async () => {
    const provider = { route: vi.fn().mockResolvedValue({ distanceM: 7421.4, durationS: 1310.2 }) };
    const r = await getRoute(GULSHAN, DHANMONDI, config, provider);
    expect(r).toEqual({ distanceM: 7421, durationS: 1310, source: "google" });
  });

  it("falls back to the estimate when the provider fails or returns nonsense", async () => {
    const failing = { route: vi.fn().mockRejectedValue(new Error("boom")) };
    expect((await getRoute(GULSHAN, DHANMONDI, config, failing)).source).toBe("haversine");
    const nonsense = { route: vi.fn().mockResolvedValue({ distanceM: 0, durationS: 10 }) };
    expect((await getRoute(GULSHAN, DHANMONDI, config, nonsense)).source).toBe("haversine");
  });
});

describe("googleProvider", () => {
  it("sends the key in a header, not the URL, and parses the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 5000, duration: "900s" }] }),
    });
    const result = await googleProvider("secret-key", fetchMock as unknown as typeof fetch).route(GULSHAN, DHANMONDI, AbortSignal.timeout(500));
    expect(result).toEqual({ distanceM: 5000, durationS: 900 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("secret-key");
    expect((init as RequestInit).headers).toMatchObject({ "X-Goog-Api-Key": "secret-key" });
  });

  it("throws on a non-OK response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(googleProvider("k", fetchMock as unknown as typeof fetch).route(GULSHAN, DHANMONDI, AbortSignal.timeout(500))).rejects.toThrow("403");
  });
});
