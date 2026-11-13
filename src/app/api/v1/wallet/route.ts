import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/wallet — a passenger's balance and any cancellation fee still owed (collected with the next fare).
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("passenger_wallet"));
  return ok(data, requestId);
});
