import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/trips/{id}/arriving — driver_assigned -> driver_arriving. Idempotent.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_trip_arriving", { p_trip_id: id.data }));
  return ok(data, requestId);
});
