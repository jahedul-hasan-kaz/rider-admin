import { z } from "zod";
import { cashCollectedSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/trips/{id}/cash-collected — the driver confirms the cash received after completion.
// Omit `amount` when the exact fare was collected; a different amount opens a support ticket.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(cashCollectedSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("confirm_cash_collected", { p_trip_id: id.data, p_amount: orNull(input.amount) }),
  );
  return ok(data, requestId);
});
