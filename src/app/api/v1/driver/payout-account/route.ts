import { payoutAccountSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// PUT /api/v1/driver/payout-account — set the account weekly payouts go to. It must be verified by finance
// before it is used; the number is stored encrypted and only ever shown masked.
export const PUT = apiRoute({ roles: ["driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(payoutAccountSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_set_payout_account", { p_method: input.method, p_holder: input.holder, p_ref: input.ref }),
  );
  return ok(data, requestId);
});
