import { z } from "zod";
import { rejectOfferSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/offers/{id}/reject — the request moves on to the next driver.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(rejectOfferSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("reject_offer", { p_offer_id: id.data, p_reason: orNull(input.reason) }),
  );
  return ok(data, requestId);
});
