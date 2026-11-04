"use server";

import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";
import { runAdminAction } from "@/server/actions/run";
import { fromPostgrestError } from "@/server/http/errors";

/** The RPC checks drivers.update or passengers.update depending on whose account it is. */
export async function restoreAccount(input: unknown) {
  return runAdminAction(null, z.strictObject({ requestId: z.uuid(), reason: reasonSchema }), input, async (ctx, d) => {
    const { error } = await ctx.supabase.schema("api").rpc("restore_account", { p_request_id: d.requestId, p_reason: d.reason });
    if (error) throw fromPostgrestError(error);
  });
}
