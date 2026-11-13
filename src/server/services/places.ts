import { log } from "@/server/log";

// Place search and reverse geocoding for the passenger app (rider-passenger gap B10). Keys stay on the server.
// Provider "none" (the default) returns no results with `source: "none"`, and the app then uses the phone's own
// geocoder, so search degrades instead of breaking.

export type LatLng = { lat: number; lng: number };
export type PlaceResult = { title: string; subtitle: string | null; lat: number; lng: number };
export type PlacesConfig = { provider: string; apiKey?: string; timeoutMs?: number };
export type PlacesAnswer = { results: PlaceResult[]; source: "google" | "none" };

const BIAS_RADIUS_M = 30_000;

/** Google Places API (New) Text Search, biased to the passenger's position and to Bangladesh. */
export async function searchPlaces(query: string, near: LatLng | null, config: PlacesConfig, fetchImpl: typeof fetch = fetch): Promise<PlacesAnswer> {
  const q = query.trim();
  if (q.length < 2 || config.provider !== "google" || !config.apiKey) return { results: [], source: "none" };
  try {
    const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: AbortSignal.timeout(config.timeoutMs ?? 2500),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: q,
        regionCode: "BD",
        maxResultCount: 8,
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`places provider answered ${res.status}`);
    const body = (await res.json()) as {
      places?: { displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[];
    };
    const results = (body.places ?? [])
      .filter((p) => typeof p.location?.latitude === "number" && typeof p.location?.longitude === "number" && p.displayName?.text)
      .map((p) => ({
        title: p.displayName!.text!.slice(0, 200),
        subtitle: p.formattedAddress ? p.formattedAddress.slice(0, 200) : null,
        lat: p.location!.latitude!,
        lng: p.location!.longitude!,
      }));
    return { results, source: "google" };
  } catch (error) {
    log.warn({ err: error }, "place search failed");
    return { results: [], source: "none" };
  }
}

/** Google Geocoding API reverse lookup: the most specific address for a point. */
export async function reverseGeocode(at: LatLng, config: PlacesConfig, fetchImpl: typeof fetch = fetch): Promise<PlacesAnswer> {
  if (config.provider !== "google" || !config.apiKey) return { results: [], source: "none" };
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${at.lat},${at.lng}`);
    url.searchParams.set("key", config.apiKey);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(config.timeoutMs ?? 2500) });
    if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
    const body = (await res.json()) as { results?: { formatted_address?: string }[] };
    const address = body.results?.[0]?.formatted_address;
    if (!address) return { results: [], source: "google" };
    const [title, ...rest] = address.split(", ");
    return { results: [{ title: title!.slice(0, 200), subtitle: rest.join(", ").slice(0, 200) || null, lat: at.lat, lng: at.lng }], source: "google" };
  } catch (error) {
    log.warn({ err: error }, "reverse geocoding failed");
    return { results: [], source: "none" };
  }
}
