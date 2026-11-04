import { z } from "zod";
import { startTripSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError, isErrorCode } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/trips/{id}/start — arrived -> in_progress (starts the trip trail). Idempotent.
// When the pickup_pin flag is on for the ride, `pin` (the passenger's 4 digits) is required; five wrong guesses lock it
// until the passenger renews the PIN.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(startTripSchema);
  const data = (await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_trip_start", { p_trip_id: id.data, p_pin: orNull(input.pin) }),
  )) as Record<string, unknown>;
  if (typeof data.pin_error === "string" && isErrorCode(data.pin_error)) {
    throw new AppError(data.pin_error, undefined, { attempts_left: data.attempts_left });
  }
  return ok(data, requestId);
});
