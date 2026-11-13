import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// DELETE /api/v1/me/places/{id} — remove a saved place (soft delete; history is kept).
export const DELETE = apiRoute({ roles: ["passenger"], rateLimit: "write" }, async ({ auth, requestId, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  await rpcOrThrow(auth.supabase.schema("api").rpc("remove_saved_place", { p_id: id.data }));
  return ok({ removed: true }, requestId);
});
