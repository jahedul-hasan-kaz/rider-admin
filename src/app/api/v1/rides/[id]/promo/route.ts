import { z } from "zod";
import { promoSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/rides/{id}/promo — apply a promotion code to an open request. The budget is reserved
// atomically; the real discount is settled when the trip completes.
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(promoSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("apply_promo", { p_request_id: id.data, p_code: input.code }));
  return ok(data, requestId);
});
