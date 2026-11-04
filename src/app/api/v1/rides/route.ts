import { rideSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { z } from "zod";
import { fromZodError } from "@/server/http/errors";

// POST /api/v1/rides — request a ride from a quote. Dispatch starts in the same transaction.
export const POST = apiRoute({ roles: ["passenger"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(rideSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("create_ride_request", {
      p_quote_id: input.quote_id,
      p_payment_method: input.payment_method,
      p_pickup_note: orNull(input.pickup_note),
    }),
  );
  return ok(data, requestId, { status: 201 });
});

const listQuery = z.object({ cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

// GET /api/v1/rides — history, newest first, keyset pagination.
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ auth, requestId, request }) => {
  const query = listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw fromZodError(query.error);
  const data = (await rpcOrThrow(
    auth.supabase.schema("api").rpc("list_my_rides", { p_limit: query.data.limit, p_cursor: orNull(query.data.cursor) }),
  )) as { rows: unknown[]; next_cursor: string | null };
  return ok(data.rows, requestId, { nextCursor: data.next_cursor });
});
