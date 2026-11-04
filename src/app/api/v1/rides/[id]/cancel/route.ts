import { z } from "zod";
import { cancelRideSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/rides/{id}/cancel — free while searching or inside the free window; otherwise
// the rule's cancellation fee applies (see GET …/cancel-preview).
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(cancelRideSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("cancel_ride", { p_request_id: id.data, p_reason: orNull(input.reason) }),
  );
  return ok(data, requestId);
});
