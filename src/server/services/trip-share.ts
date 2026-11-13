import "server-only";
import { z } from "zod";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

// Public trip share (rider-passenger gap B5). The token is the only credential; the database looks it up by hash and
// returns a deliberately small view: no phone numbers, no passenger identity, no fare.

export const SHARE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export const sharedTripSchema = z.object({
  status: z.string(),
  pickup_label: z.string().nullable(),
  destination_label: z.string().nullable(),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  driver_first_name: z.string().nullable(),
  vehicle: z.object({
    registration_number: z.string(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    color: z.string().nullable(),
  }),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  driver_location: z.object({ lat: z.number(), lng: z.number(), heading: z.number().nullable(), updated_at: z.string() }).nullable(),
});
export type SharedTrip = z.infer<typeof sharedTripSchema>;

/** Throws AppError NOT_FOUND for a malformed, unknown or expired token. */
export async function getSharedTrip(token: string): Promise<SharedTrip> {
  if (!SHARE_TOKEN.test(token)) throw new AppError("NOT_FOUND");
  const admin = createSupabaseAdminClient("share.read");
  const { data, error } = await admin.schema("api").rpc("get_shared_trip", { p_token: token });
  if (error) throw fromPostgrestError(error);
  return sharedTripSchema.parse(data);
}
