import { availabilitySchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/availability — only approved drivers with an active
// vehicle, inside an active service zone, can go online (M1 exit criterion).
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(availabilitySchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_set_availability", {
      p_online: input.online,
      p_lat: input.lat ?? 0,
      p_lng: input.lng ?? 0,
      p_accuracy_m: input.accuracy,
    }),
  );
  return ok(data, requestId);
});
