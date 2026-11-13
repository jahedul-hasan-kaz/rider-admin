import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { deliverNotificationsSoon } from "@/server/services/notify-soon";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/driver/trips/{id}/complete — in_progress -> completed; the server computes the final fare. Idempotent.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("complete_trip", { p_trip_id: id.data }));
  // The passenger gets a push for this change (driver found / arrived / started / finished / cancelled).
  deliverNotificationsSoon();
  return ok(data, requestId);
});
