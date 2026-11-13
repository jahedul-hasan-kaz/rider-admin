import { z } from "zod";
import { serverEnv } from "@/server/env";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// POST /api/v1/trips/{id}/share — a link anyone can open to follow this trip live (gap B5). Works while the trip is
// active and for an hour after it ends. Creating a new link invalidates the previous one.
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const data = z
    .object({ token: z.string(), trip_id: z.uuid() })
    .parse(await rpcOrThrow(auth.supabase.schema("api").rpc("create_trip_share", { p_trip_id: id.data })));
  const env = serverEnv();
  const base = (env.SHARE_BASE_URL ?? env.APP_BASE_URL).replace(/\/+$/, "");
  return ok({ url: `${base}/share/${data.token}`, trip_id: data.trip_id }, requestId, { status: 201 });
});
