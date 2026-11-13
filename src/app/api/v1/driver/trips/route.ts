import { z } from "zod";
import { ok } from "@/server/http/envelope";
import { fromZodError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

const listQuery = z.object({ cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(30) });

// GET /api/v1/driver/trips?limit=&cursor= — the driver's finished trips (completed and cancelled), newest first.
export const GET = apiRoute({ roles: ["driver"], rateLimit: "read" }, async ({ auth, requestId, request }) => {
  const q = listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) throw fromZodError(q.error);
  const data = (await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_trips", { p_limit: q.data.limit, p_cursor: orNull(q.data.cursor) }),
  )) as { rows: unknown[]; next_cursor: string | null };
  return ok(data.rows, requestId, { nextCursor: data.next_cursor });
});
