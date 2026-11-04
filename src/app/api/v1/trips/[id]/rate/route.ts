import { z } from "zod";
import { rateSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/trips/{id}/rate — passengers rate the driver, drivers rate the passenger, within 7 days.
export const POST = apiRoute({ roles: ["passenger", "driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(rateSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("rate_trip", { p_trip_id: id.data, p_score: input.score, p_comment: orNull(input.comment) }),
  );
  return ok(data, requestId);
});
