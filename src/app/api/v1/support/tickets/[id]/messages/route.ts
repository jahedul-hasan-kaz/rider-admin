import { z } from "zod";
import { ticketReplySchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/support/tickets/{id}/messages — reply to the support team (reopens a resolved ticket).
export const POST = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(ticketReplySchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("reply_my_ticket", { p_id: id.data, p_body: input.body }));
  return ok(data, requestId);
});
