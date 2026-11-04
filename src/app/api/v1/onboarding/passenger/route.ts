import { onboardingSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/onboarding/passenger — role user -> passenger (one way, backend only).
export const POST = apiRoute({ roles: ["user"], rateLimit: "auth", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(onboardingSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("onboard_passenger", { p_full_name: input.full_name }));
  return ok(data, requestId, { status: 201 });
});
