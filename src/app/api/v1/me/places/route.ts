import { savedPlaceSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/me/places — the passenger's saved places (gap B6).
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("list_saved_places"));
  return ok(data, requestId);
});

// POST /api/v1/me/places — save a place. Saving Home or Office replaces the previous one.
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(savedPlaceSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("save_place", {
      p_kind: input.kind,
      p_name: orNull(input.name),
      p_label: input.label,
      p_subtitle: orNull(input.subtitle),
      p_lat: input.lat,
      p_lng: input.lng,
      p_driver_note: orNull(input.driver_note),
      p_suggest_mornings: input.suggest_mornings ?? false,
    }),
  );
  return ok(data, requestId, { status: 201 });
});
