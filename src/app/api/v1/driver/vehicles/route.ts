import { vehicleSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/vehicles — register a vehicle (pending until verified).
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const v = body(vehicleSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_add_vehicle", {
      p_category_id: v.category_id,
      p_make: v.make,
      p_model: v.model,
      p_color: v.color,
      p_registration_number: v.registration_number,
      p_year: v.year,
    }),
  );
  return ok(data, requestId, { status: 201 });
});
