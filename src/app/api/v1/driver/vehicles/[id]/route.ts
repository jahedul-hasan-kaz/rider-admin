import { z } from "zod";
import { updateVehicleSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// PATCH /api/v1/driver/vehicles/{id} — edits send a verified vehicle back to review.
export const PATCH = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const v = body(updateVehicleSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_update_vehicle", {
      p_vehicle_id: id.data,
      p_category_id: v.category_id,
      p_make: v.make,
      p_model: v.model,
      p_color: v.color,
      p_registration_number: v.registration_number,
      p_year: v.year,
      p_expected_version: v.expected_version,
    }),
  );
  return ok(data, requestId);
});
