import { ticketSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/support/tickets — the caller's own tickets.
export const GET = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "read" }, async ({ auth, requestId }) => {
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("list_my_tickets"));
  return ok(data, requestId);
});

// POST /api/v1/support/tickets — open a ticket, optionally about one of the caller's trips.
export const POST = apiRoute({ roles: ["user", "passenger", "driver"], rateLimit: "write", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(ticketSchema);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("create_ticket", {
      p_trip_id: orNull(input.tripId),
      p_category: input.category,
      p_subject: input.subject,
      p_body: input.body,
    }),
  );
  return ok(data, requestId, { status: 201 });
});
