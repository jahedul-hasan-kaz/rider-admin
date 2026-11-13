import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/driver/trips/current — the active trip, or null.
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_current_trip"));
  return ok(data, requestId);
});
