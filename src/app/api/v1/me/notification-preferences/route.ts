import { notificationPreferencesSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

const ROLES = ["user", "passenger", "driver"] as const;

// GET /api/v1/me/notification-preferences — which push categories this person wants (gap B4). Safety is always on.
export const GET = apiRoute({ roles: ROLES, rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("get_notification_preferences"));
  return ok(data, requestId);
});

// PUT /api/v1/me/notification-preferences — replaces the choices; queued pushes honour them from now on.
export const PUT = apiRoute({ roles: ROLES, rateLimit: "write" }, async ({ auth, requestId, body }) => {
  const input = body(notificationPreferencesSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("set_notification_preferences", { p_ride: input.ride, p_support: input.support, p_offers: input.offers }),
  );
  return ok(data, requestId);
});
