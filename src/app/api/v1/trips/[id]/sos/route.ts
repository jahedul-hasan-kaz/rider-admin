import { after } from "next/server";
import { z } from "zod";
import { sosSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { log } from "@/server/log";
import { runNotifyJob } from "@/server/services/notify";

// POST /api/v1/trips/{id}/sos — raises a critical incident with the latest location and alerts the safety team.
// Deliberately not behind an idempotency key: the database already returns the same incident while one is open,
// and a panic button must never be rejected for a missing header.
export const POST = apiRoute({ roles: ["passenger", "driver"], rateLimit: "write" }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(sosSchema);
  const data = await rpcOrThrow(auth.supabase.schema("api").rpc("trigger_sos", { p_trip_id: id.data, p_note: orNull(input.note) }));
  // Send the email/SMS/push alerts right away instead of waiting for the next scheduled run.
  after(() => runNotifyJob(20).catch((err) => log.error({ err }, "post-SOS delivery failed")));
  return ok(data, requestId);
});
