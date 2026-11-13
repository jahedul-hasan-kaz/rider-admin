import { trustedContactSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/me/contacts — up to three trusted contacts the passenger shares trips with (gap B7).
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("list_trusted_contacts"));
  return ok(data, requestId);
});

// POST /api/v1/me/contacts — add one.
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(trustedContactSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("add_trusted_contact", { p_name: input.name, p_phone: input.phone }));
  return ok(data, requestId, { status: 201 });
});
