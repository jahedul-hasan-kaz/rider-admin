import "server-only";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { isPermission, type Permission } from "@/lib/permissions";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { createSupabaseBearerClient } from "@/server/supabase/route-client";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { AppRole } from "@/types/database";

export type AdminContext = {
  userId: string;
  fullName: string;
  email: string | null;
  preferredLanguage: string;
  version: number;
  mustChangePassword: boolean;
  mfaEnrolledAt: string | null;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  isSuperAdmin: boolean;
  permissions: ReadonlySet<Permission>;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};

const adminContextSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["admin", "driver", "passenger", "user"]),
  status: z.enum(["active", "suspended", "deactivated"]),
  full_name: z.string(),
  email: z.string().nullable(),
  preferred_language: z.string(),
  version: z.number(),
  must_change_password: z.boolean(),
  mfa_enrolled_at: z.string().nullable(),
  mfa_enabled: z.boolean(),
  mfa_required: z.boolean(),
  mfa_satisfied: z.boolean(),
  is_super_admin: z.boolean(),
  permissions: z.array(z.string()),
});

/**
 * Data Access Layer entry point for admin pages and Server Actions.
 * Authoritative checks: verified JWT, AAL2, profile is an active admin.
 * One RPC round trip; memoised per request with React `cache`.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = await createSupabaseServerClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) redirect("/login");
  const { data, error } = await supabase.schema("api").rpc("my_admin_context");
  if (error) throw fromPostgrestError(error);
  if (!data) redirect("/login?error=forbidden");

  const profile = adminContextSchema.parse(data);
  // Authoritative two-factor rule (the database decides): a code is needed only for people who turned it on, or for
  // everyone when the organisation requires it.
  if (!profile.mfa_satisfied) redirect("/mfa");
  if (profile.role !== "admin") redirect("/login?error=forbidden");
  if (profile.status !== "active") redirect("/login?error=suspended");

  return {
    userId: profile.user_id,
    fullName: profile.full_name,
    email: profile.email,
    preferredLanguage: profile.preferred_language,
    version: profile.version,
    mustChangePassword: profile.must_change_password,
    mfaEnrolledAt: profile.mfa_enrolled_at,
    mfaEnabled: profile.mfa_enabled,
    mfaRequired: profile.mfa_required,
    isSuperAdmin: profile.is_super_admin,
    permissions: new Set(profile.permissions.filter(isPermission)),
    supabase,
  };
});

/** Use at the top of every admin page: renders the 403 page when the permission is missing. */
export async function requirePagePermission(permission: Permission): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx.permissions.has(permission)) forbidden();
  return ctx;
}

/** Like requirePagePermission, for pages open to holders of any one of several permissions. */
export async function requireAnyPagePermission(permissions: Permission[]): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!permissions.some((p) => ctx.permissions.has(p))) forbidden();
  return ctx;
}

/** Use at the top of every Server Action (throws a FORBIDDEN AppError). */
export async function requirePermission(permission: Permission): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx.permissions.has(permission)) throw new AppError("FORBIDDEN");
  return ctx;
}

export type ApiContext = {
  userId: string;
  role: AppRole;
  supabase: ReturnType<typeof createSupabaseBearerClient>;
};

const ROLES: ReadonlySet<string> = new Set<AppRole>(["admin", "driver", "passenger", "user"]);

/**
 * Authenticates a mobile API request from its bearer token. The role comes from
 * the JWT for routing only; the database re-checks it on every call.
 */
export async function getApiContext(request: Request, requestId: string): Promise<ApiContext> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) throw new AppError("UNAUTHENTICATED");

  const token = match[1];
  const supabase = createSupabaseBearerClient(token, requestId);
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) throw new AppError("UNAUTHENTICATED");

  const role = data.claims.app_role;
  if (typeof role !== "string" || !ROLES.has(role)) throw new AppError("ROLE_NOT_ALLOWED");
  if (data.claims.status === "suspended") throw new AppError("ACCOUNT_SUSPENDED");

  return { userId: data.claims.sub, role: role as AppRole, supabase };
}
