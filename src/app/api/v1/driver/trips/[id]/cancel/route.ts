import { z } from "zod";
import { driverCancelSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { deliverNotificationsSoon } from "@/server/services/notify-soon";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/trips/{id}/cancel — before the ride starts; a reason is required.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(driverCancelSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_trip_cancel", { p_trip_id: id.data, p_reason: input.reason }),
  );
  // The passenger gets a push for this change (driver found / arrived / started / finished / cancelled).
  deliverNotificationsSoon();
  return ok(data, requestId);
});
