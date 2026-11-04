import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { Database } from "@/types/database";

type Input = {
  role: "passenger" | "driver";
  fullName: string;
  email: string;
  phone: string;
  password: string;
  homeZoneId: string | null;
  reason: string;
};

/**
 * Staff create a passenger or driver: the sign-in identity is made with the secret key (only the auth service can do
 * that), then the admin's own session gives it its role, so the permission check, validation and audit happen in the
 * database as the admin. Profiles are never deleted, so a create that fails half-way leaves an unused identity; the
 * next attempt with the same email picks it up instead of reporting the email as taken.
 */
export async function createAccount(adminSession: SupabaseClient<Database>, input: Input) {
  const api = adminSession.schema("api");
  // Without a password the person sets their own through "Forgot password".
  const password = input.password || randomBytes(24).toString("base64url");
  const created = await createSupabaseAdminClient("admin.create_user").auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  let userId = created.data.user?.id;
  if (!userId) {
    if (!/already|registered|exists/i.test(created.error?.message ?? "")) {
      log.error({ err: created.error?.message }, "create user failed");
      throw new AppError("UPSTREAM_UNAVAILABLE", "Could not create the account. Try again.");
    }
    const unused = await api.rpc("admin_find_unused_account", { p_email: input.email });
    if (unused.error) throw fromPostgrestError(unused.error);
    if (!unused.data) {
      throw new AppError("ALREADY_EXISTS", undefined, { fields: [{ path: "email", message: "An account with this email already exists." }] });
    }
    userId = unused.data as string;
  }

  const { data, error } = await api.rpc("admin_setup_account", {
    p_user_id: userId,
    p_role: input.role,
    p_full_name: input.fullName,
    p_phone: (input.phone || null) as string,
    p_home_zone_id: input.homeZoneId as string,
    p_reason: input.reason,
  });
  if (error) throw fromPostgrestError(error);
  return data as { user_id: string; role: string; driver_id: string | null };
}
