"use server";

import { updateTag } from "next/cache";
import { adminStatusSchema } from "@/lib/schemas/admins";
import { runAdminAction } from "@/server/actions/run";
import { fromPostgrestError } from "@/server/http/errors";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

// Effectively permanent; lifted on reactivation.
const SUSPENDED_BAN = "876000h";

/**
 * Suspends an admin. The DB change blocks access immediately (every permission
 * check reads profiles.status); the Auth ban also stops token refresh so no new
 * sessions can start (docs/spec/02-roles-permissions.md §5.8).
 */
export async function suspendAdmin(input: unknown) {
  return runAdminAction("admins.suspend", adminStatusSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("suspend_admin", {
      p_admin_id: data.adminId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);

    const admin = createSupabaseAdminClient("admin.revoke_sessions");
    const { error: banError } = await admin.auth.admin.updateUserById(data.adminId, { ban_duration: SUSPENDED_BAN });
    if (banError) log.error({ err: banError, adminId: data.adminId }, "auth ban after suspension failed");

    updateTag(`admin:${data.adminId}`);
    return { sessionsRevoked: !banError };
  });
}

export async function reactivateAdmin(input: unknown) {
  return runAdminAction("admins.suspend", adminStatusSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("reactivate_admin", {
      p_admin_id: data.adminId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);

    const admin = createSupabaseAdminClient("admin.revoke_sessions");
    const { error: unbanError } = await admin.auth.admin.updateUserById(data.adminId, { ban_duration: "none" });
    if (unbanError) log.error({ err: unbanError, adminId: data.adminId }, "auth unban after reactivation failed");

    updateTag(`admin:${data.adminId}`);
    return { signInRestored: !unbanError };
  });
}
