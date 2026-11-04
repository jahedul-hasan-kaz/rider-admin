import { driverDetailsSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// PATCH /api/v1/driver/details — licence number (stored encrypted), expiry, home zone.
export const PATCH = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(driverDetailsSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_update_details", {
      p_licence_number: orNull(input.licence_number),
      p_licence_expiry: orNull(input.licence_expiry),
      p_home_zone_id: orNull(input.home_zone_id),
    }),
  );
  return ok(data, requestId);
});
