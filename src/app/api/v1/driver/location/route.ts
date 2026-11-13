import { locationSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/location — batched points (≤ 20). The newest becomes the live position;
// during an in-progress trip every point is also kept in the trip trail (used for the final distance).
export const POST = apiRoute({ roles: ["driver"], rateLimit: "location" }, async ({ auth, requestId, body }) => {
  const { points } = body(locationSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_update_locations", { p_points: points }));
  return ok(data, requestId);
});
