import { deactivateSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/me/deactivate — delete my account. The account is deactivated at once (sign-in is blocked) and the
// personal details are anonymised after the grace period; financial and safety records are kept. Refused while a ride is
// in progress or money is owed either way. `confirm: true` is required so a stray call can never do this.
export const POST = apiRoute({ roles: ["passenger", "driver", "user"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(deactivateSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("request_account_deletion", { p_reason: orNull(input.reason) }));
  return ok(data, requestId);
});
