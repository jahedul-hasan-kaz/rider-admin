import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

const deviceSchema = z.strictObject({ platform: z.enum(["android", "ios", "web"]), token: z.string().min(20).max(4096) });

// PUT /api/v1/me/devices — register this device for push notifications (the token moves to whoever registered it last).
export const PUT = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "write" }, async ({ auth, requestId, body }) => {
  const input = body(deviceSchema);
  await rpcOrThrow(auth.supabase.schema("api").rpc("register_device", { p_platform: input.platform, p_token: input.token }));
  return ok({ registered: true }, requestId);
});

// DELETE /api/v1/me/devices — stop push notifications for this device (call on sign-out).
export const DELETE = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "write" }, async ({ auth, requestId, body }) => {
  const input = body(z.strictObject({ token: z.string().min(20).max(4096) }));
  await rpcOrThrow(auth.supabase.schema("api").rpc("unregister_device", { p_token: input.token }));
  return ok({ registered: false }, requestId);
});
