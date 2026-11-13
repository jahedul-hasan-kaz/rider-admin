import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/config — feature flags evaluated for the caller plus the few settings a client needs at start-up.
export const GET = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("client_config"));
  return ok(data, requestId);
});
