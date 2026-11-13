import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/rides/current — the passenger's open request or unfinished trip, or null (gap B9). The app uses it on
// launch to reopen the ride screen.
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("current_ride"));
  return ok(data ?? null, requestId);
});
