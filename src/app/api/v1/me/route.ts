import { updateMeSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

const ANY_ROLE = ["admin", "driver", "passenger", "user"] as const;

// GET /api/v1/me — docs/spec/05-api.md §2.1. Own profile including own phone/email.
export const GET = apiRoute({ roles: ANY_ROLE, rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("get_my_profile"));
  return ok(data, requestId);
});

// PATCH /api/v1/me — name and language, with optimistic concurrency.
export const PATCH = apiRoute({ roles: ANY_ROLE, rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(updateMeSchema);
  await rpcOrThrow(
    auth.supabase.schema("api").rpc("update_own_profile", {
      p_full_name: input.full_name,
      p_preferred_language: input.preferred_language,
      p_expected_version: input.expected_version,
    }),
  );
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("get_my_profile"));
  return ok(data, requestId);
});
