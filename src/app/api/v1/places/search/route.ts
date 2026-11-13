import { placeSearchQuerySchema } from "@/lib/schemas/api";
import { serverEnv } from "@/server/env";
import { ok } from "@/server/http/envelope";
import { fromZodError } from "@/server/http/errors";
import { apiRoute } from "@/server/http/handler";
import { searchPlaces } from "@/server/services/places";

// GET /api/v1/places/search?q=&lat=&lng= — place suggestions for the passenger app (gap B10), biased to the pickup.
// `source: "none"` means no provider is configured; the app then uses the phone's geocoder.
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ requestId, request }) => {
  const query = placeSearchQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw fromZodError(query.error);
  const env = serverEnv();
  const near = query.data.lat !== undefined && query.data.lng !== undefined ? { lat: query.data.lat, lng: query.data.lng } : null;
  const data = await searchPlaces(query.data.q, near, { provider: env.PLACES_PROVIDER, apiKey: env.PLACES_API_KEY ?? env.ROUTING_API_KEY });
  return ok(data, requestId);
});
