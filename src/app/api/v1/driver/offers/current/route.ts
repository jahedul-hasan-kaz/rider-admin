import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/driver/offers/current — the pending offer, if any (also pushed on driver:{id}).
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_current_offer"));
  return ok(data, requestId);
});
