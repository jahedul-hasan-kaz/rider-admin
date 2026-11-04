import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/driver/onboarding — checklist: required documents, vehicles, statuses, rejection reasons.
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("driver_onboarding_state"));
  return ok(data, requestId);
});
