import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/admin-client", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env.public", () => ({ publicEnv: { NEXT_PUBLIC_APP_ENV: "local" } }));

const { sendExpoPush } = await import("@/server/services/notify");
const { searchPlaces, reverseGeocode } = await import("@/server/services/places");
const { googleProvider, getRoute } = await import("@/server/services/routing");
const { savedPlaceSchema, trustedContactSchema, placeSearchQuerySchema, rideSchema } = await import("@/lib/schemas/api");
const { SHARE_TOKEN } = await import("@/server/services/trip-share");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const message = {
  id: "11111111-1111-4111-8111-111111111111",
  channel: "push" as const,
  to: null,
  subject: "Driver found",
  body: "Karim is on the way · DHA-1",
  link: "/ride/22222222-2222-4222-8222-222222222222",
  attempts: 1,
  tokens: ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]", "not-an-expo-token"],
  data: { type: "ride.driver_assigned", ride_id: "22222222-2222-4222-8222-222222222222" },
  category: "ride",
};

describe("Expo push adapter", () => {
  it("sends one message per Expo token with data, deep link and channel", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ status: "ok" }, { status: "ok" }] }));
    const result = await sendExpoPush(message, { EXPO_ACCESS_TOKEN: "tok" }, vi.fn(), fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ accepted: 2, removed: 0 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const sent = JSON.parse(String(init.body));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[aaa]",
      title: "Driver found",
      channelId: "ride",
      priority: "high",
      data: { type: "ride.driver_assigned", url: "/ride/22222222-2222-4222-8222-222222222222" },
    });
  });

  it("removes tokens Expo no longer recognises and still succeeds when one device took it", async () => {
    const forget = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }, { status: "ok" }] }));
    const result = await sendExpoPush(message, {}, forget, fetchImpl as unknown as typeof fetch);
    expect(forget).toHaveBeenCalledWith(["ExponentPushToken[aaa]"]);
    expect(result).toEqual({ accepted: 1, removed: 1 });
  });

  it("is done (not retried) when every device is gone", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }, { status: "error", details: { error: "DeviceNotRegistered" } }] }),
    );
    await expect(sendExpoPush(message, {}, vi.fn(async () => undefined), fetchImpl as unknown as typeof fetch)).resolves.toEqual({ accepted: 0, removed: 2 });
  });

  it("throws so the outbox retries when Expo rejects for another reason", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ status: "error", details: { error: "MessageRateExceeded" } }, { status: "error" }] }));
    await expect(sendExpoPush(message, {}, vi.fn(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(/MessageRateExceeded/);
  });

  it("refuses when there is no Expo token at all", async () => {
    await expect(sendExpoPush({ ...message, tokens: ["fcm-raw-token"] }, {}, vi.fn())).rejects.toThrow(/no Expo push tokens/);
  });
});

describe("place search", () => {
  it("returns nothing with source none when no provider is configured", async () => {
    const fetchImpl = vi.fn();
    expect(await searchPlaces("Dhanmondi", null, { provider: "none" }, fetchImpl as unknown as typeof fetch)).toEqual({ results: [], source: "none" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps Google Text Search results and biases to the pickup", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ places: [{ displayName: { text: "Dhanmondi 27" }, formattedAddress: "Road 16, Dhaka", location: { latitude: 23.75, longitude: 90.37 } }, { displayName: {} }] }),
    );
    const answer = await searchPlaces("dhanm", { lat: 23.79, lng: 90.4 }, { provider: "google", apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(answer).toEqual({ source: "google", results: [{ title: "Dhanmondi 27", subtitle: "Road 16, Dhaka", lat: 23.75, lng: 90.37 }] });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.locationBias.circle.center).toEqual({ latitude: 23.79, longitude: 90.4 });
    expect(body.regionCode).toBe("BD");
  });

  it("degrades to source none when the provider fails", async () => {
    const fetchImpl = vi.fn(async () => json({}, 500));
    expect(await searchPlaces("Gulshan", null, { provider: "google", apiKey: "k" }, fetchImpl as unknown as typeof fetch)).toEqual({ results: [], source: "none" });
  });

  it("splits a reverse-geocoded address into title and subtitle", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [{ formatted_address: "House 42, Road 11, Banani, Dhaka 1213" }] }));
    const answer = await reverseGeocode({ lat: 23.79, lng: 90.4 }, { provider: "google", apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    expect(answer.results[0]).toMatchObject({ title: "House 42", subtitle: "Road 11, Banani, Dhaka 1213" });
  });
});

describe("route polyline", () => {
  it("passes Google's encoded polyline through with the route", async () => {
    const fetchImpl = vi.fn(async () => json({ routes: [{ distanceMeters: 6200, duration: "1320s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] }));
    const route = await getRoute({ lat: 23.79, lng: 90.4 }, { lat: 23.75, lng: 90.37 }, { provider: "google", apiKey: "k" }, googleProvider("k", fetchImpl as unknown as typeof fetch));
    expect(route).toEqual({ distanceM: 6200, durationS: 1320, source: "google", polyline: "_p~iF~ps|U_ulLnnqC" });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toContain("routes.polyline.encodedPolyline");
  });

  it("has no polyline on the estimate", async () => {
    const route = await getRoute({ lat: 23.79, lng: 90.4 }, { lat: 23.75, lng: 90.37 }, { provider: "haversine" });
    expect(route.polyline).toBeUndefined();
  });
});

describe("request schemas", () => {
  it("needs a name for other places and valid coordinates", () => {
    expect(savedPlaceSchema.safeParse({ kind: "other", label: "Gym", lat: 23.7, lng: 90.4 }).success).toBe(false);
    expect(savedPlaceSchema.safeParse({ kind: "home", label: "Home", lat: 123, lng: 90.4 }).success).toBe(false);
    expect(savedPlaceSchema.safeParse({ kind: "home", label: "Road 11", lat: 23.7, lng: 90.4, extra: 1 }).success).toBe(false);
  });

  it("accepts only international phone numbers for contacts", () => {
    expect(trustedContactSchema.safeParse({ name: "Ayesha", phone: "+8801711111111" }).success).toBe(true);
    expect(trustedContactSchema.safeParse({ name: "Ayesha", phone: "01711111111" }).success).toBe(false);
  });

  it("needs both lat and lng, or neither, for place search", () => {
    expect(placeSearchQuerySchema.safeParse({ q: "Gulshan", lat: "23.7" }).success).toBe(false);
    expect(placeSearchQuerySchema.safeParse({ q: "G" }).success).toBe(false);
    expect(placeSearchQuerySchema.safeParse({ q: "Gulshan" }).success).toBe(true);
  });

  it("takes an optional promo code on ride requests", () => {
    expect(rideSchema.safeParse({ quote_id: "11111111-1111-4111-8111-111111111111", promo_code: "WELCOME" }).success).toBe(true);
    expect(rideSchema.safeParse({ quote_id: "11111111-1111-4111-8111-111111111111", promo_code: "x" }).success).toBe(false);
  });

  it("accepts only well-formed share tokens", () => {
    expect(SHARE_TOKEN.test("lUaGcIiH-6xgZGsNxJesspjHYEbrj_abcd")).toBe(true);
    expect(SHARE_TOKEN.test("short")).toBe(false);
    expect(SHARE_TOKEN.test("has spaces and ../ in it 1234567890")).toBe(false);
  });
});

describe("expoChannel (driver categories)", async () => {
  const { expoChannel } = await import("@/server/services/notify");
  it("maps driver categories to driver app channels at high priority", () => {
    expect(expoChannel("driver.offers")).toEqual({ channelId: "offers", priority: "high", ttl: 30 });
    expect(expoChannel("driver.trip")).toEqual({ channelId: "trip", priority: "high" });
    expect(expoChannel("driver.account")).toEqual({ channelId: "account", priority: "high" });
  });
  it("keeps passenger categories as they were", () => {
    expect(expoChannel("offers")).toEqual({ channelId: "offers", priority: "normal" });
    expect(expoChannel("ride")).toEqual({ channelId: "ride", priority: "high" });
    expect(expoChannel(null)).toEqual({ channelId: "ride", priority: "high" });
  });
});
