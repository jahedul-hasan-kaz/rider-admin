import { consentSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/me/consent — records which version of the terms and privacy policy the person accepted (gap B13).
export const POST = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(consentSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("record_consent", { p_terms_version: input.terms_version }));
  return ok(data, requestId);
});
