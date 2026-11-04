import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/driver/wallet — balance (negative means cash owed to the platform), unpaid earnings, open payout.
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_wallet"));
  return ok(data, requestId);
});
