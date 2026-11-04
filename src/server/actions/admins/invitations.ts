"use server";

import { updateTag } from "next/cache";
import { cancelInvitationSchema, inviteAdminSchema } from "@/lib/schemas/admins";
import { runAdminAction } from "@/server/actions/run";
import { serverEnv } from "@/server/env";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/**
 * Records the invitation (permission + escalation checks in the DB), then sends
 * the Supabase invite email. The auth.users trigger turns the invited sign-up
 * into an admin; nothing the user controls can.
 */
export async function inviteAdmin(input: unknown) {
  return runAdminAction("admins.invite", inviteAdminSchema, input, async (ctx, data) => {
    const { data: invitationId, error } = await ctx.supabase.schema("api").rpc("invite_admin", {
      p_email: data.email,
      p_full_name: data.fullName,
      p_template_ids: data.templateIds,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);

    const admin = createSupabaseAdminClient("admin.invite");
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: `${serverEnv().APP_BASE_URL}/auth/accept-invite`,
      data: { full_name: data.fullName },
    });

    if (inviteError) {
      log.error({ err: inviteError, invitationId }, "admin invite email failed");
      await ctx.supabase.schema("api").rpc("cancel_admin_invitation", {
        p_invitation_id: invitationId,
        p_reason: "Invitation email could not be sent",
      });
      throw new AppError("UPSTREAM_UNAVAILABLE", "The invitation email could not be sent. Try again.");
    }

    updateTag("admins");
    return { invitationId };
  });
}

export async function cancelAdminInvitation(input: unknown) {
  return runAdminAction("admins.invite", cancelInvitationSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("cancel_admin_invitation", {
      p_invitation_id: data.invitationId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag("admins");
  });
}
