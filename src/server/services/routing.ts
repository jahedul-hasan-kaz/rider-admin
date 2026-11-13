import { log } from "@/server/log";

// Route distance/ETA for quotes (docs/spec/README.md A6). The RoutingProvider interface keeps
// the vendor swappable; the haversine estimate is the always-available fallback.

export type LatLng = { lat: number; lng: number };
/** `polyline`: Google encoded polyline of the road route, when a provider returned one (drawn by the passenger app). */
export type RouteEstimate = { distanceM: number; durationS: number; source: "google" | "haversine"; polyline?: string };

export interface RoutingProvider {
  route(from: LatLng, to: LatLng, signal: AbortSignal): Promise<{ distanceM: number; durationS: number; polyline?: string }>;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight line × road factor, at an average city speed. Used when no provider is configured or it fails. */
export function estimateRoute(from: LatLng, to: LatLng, roadFactor = 1.35, speedKmh = 25): RouteEstimate {
  const distanceM = Math.round(haversineM(from, to) * roadFactor);
  const durationS = Math.round(distanceM / ((speedKmh * 1000) / 3600));
  return { distanceM, durationS: Math.max(durationS, 30), source: "haversine" };
}

/** Google Routes API returns durations like "1234s". */
export function parseGoogleDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Math.round(Number(match[1])) : null;
}

export function googleProvider(apiKey: string, fetchImpl: typeof fetch = fetch): RoutingProvider {
  return {
    async route(from, to, signal) {
      const res = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: "DRIVE",
        }),
      });
      if (!res.ok) throw new Error(`routing provider answered ${res.status}`);
      const body = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] };
      const first = body.routes?.[0];
      const durationS = parseGoogleDuration(first?.duration);
      if (typeof first?.distanceMeters !== "number" || durationS === null) throw new Error("routing provider returned no route");
      const polyline = first.polyline?.encodedPolyline;
      return { distanceM: first.distanceMeters, durationS, ...(polyline && polyline.length <= 20_000 ? { polyline } : {}) };
    },
  };
}

type Config = { provider: string; apiKey?: string; roadFactor?: number; speedKmh?: number; timeoutMs?: number };

/**
 * Best route available: the configured provider with a short timeout, else the
 * estimate. A provider outage degrades accuracy, never availability.
 */
export async function getRoute(from: LatLng, to: LatLng, config: Config, providerOverride?: RoutingProvider): Promise<RouteEstimate> {
  const fallback = estimateRoute(from, to, config.roadFactor, config.speedKmh);
  let provider = providerOverride;
  if (!provider) {
    if (config.provider === "google" && config.apiKey) provider = googleProvider(config.apiKey);
    else if (config.provider === "barikoi") log.warn("ROUTING_PROVIDER=barikoi is not implemented; using the estimate");
  }
  if (!provider) return fallback;

  try {
    const result = await provider.route(from, to, AbortSignal.timeout(config.timeoutMs ?? 2000));
    if (!Number.isFinite(result.distanceM) || !Number.isFinite(result.durationS) || result.distanceM <= 0) return fallback;
    return {
      distanceM: Math.round(result.distanceM),
      durationS: Math.max(Math.round(result.durationS), 30),
      source: "google",
      ...(result.polyline ? { polyline: result.polyline } : {}),
    };
  } catch (error) {
    log.warn({ err: error }, "routing provider failed; using the estimate");
    return fallback;
  }
}
