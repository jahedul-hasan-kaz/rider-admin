import { quoteSchema } from "@/lib/schemas/api";
import { serverEnv } from "@/server/env";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { getRoute } from "@/server/services/routing";

// POST /api/v1/quotes — route distance/ETA from the routing provider (estimate fallback),
// then the database prices it from the live fare rule (docs/spec/04-business-logic.md §3).
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "quote", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(quoteSchema);
  const env = serverEnv();
  const route = await getRoute(input.pickup, input.destination, {
    provider: env.ROUTING_PROVIDER,
    apiKey: env.ROUTING_API_KEY,
  });
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("create_quote", {
      p_category_id: input.category_id,
      p_pickup_lat: input.pickup.lat,
      p_pickup_lng: input.pickup.lng,
      p_pickup_label: orNull(input.pickup.label),
      p_destination_lat: input.destination.lat,
      p_destination_lng: input.destination.lng,
      p_destination_label: orNull(input.destination.label),
      p_distance_m: route.distanceM,
      p_duration_s: route.durationS,
    }),
  );
  return ok({ ...(data as Record<string, unknown>), route_source: route.source }, requestId, { status: 201 });
});
