import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/driver/trips/{id}
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("get_driver_trip", { p_trip_id: id.data }));
  return ok(data, requestId);
});
